import { randomUUID } from 'node:crypto';
import {
  C2S,
  GAME_MODES,
  GAME_STATES,
  S2C,
  TEAMS,
} from '../shared/messages.js';
import { CaptureTheFlag } from './modes/CaptureTheFlag.js';
import { Domination } from './modes/Domination.js';
import { FFA } from './modes/FFA.js';
import { Infection } from './modes/Infection.js';
import { TeamDeathmatch } from './modes/TeamDeathmatch.js';
import { PowerupManager } from './PowerupManager.js';

const COUNTDOWN_SECS = 5;
const POWERUP_BROADCAST_INTERVAL_MS = 2_000;

export class GameManager {
  constructor(roomName = 'Game', onStateChange = null) {
    this.gameId = randomUUID();
    this.roomName = roomName;
    this._onStateChange = onStateChange;
    this.players = new Map(); // id -> Player
    this.state = GAME_STATES.WAITING;
    this.config = {
      mode: GAME_MODES.FFA,
      timeLimit: 15,
      scoreLimit: 5,
      friendlyFire: false,
      // Host-tunable gameplay settings
      bulletsPerMag: 30,
      hpPerPlayer: 100,
      reloadDelaySecs: 3,
      respawnDelaySecs: 10,
      // Optional play area: null | { type:'circle', lat, lng, radiusM } | { type:'polygon', points:[{lat,lng}] }
      gameArea: null,
      // Domination-specific (ignored by other modes)
      domZones: [], // [{ id:'A'|'B'|'C', lat, lng }]
      dominationTickSecs: 2,
      deathstreakEnabled: false,
      deathstreakCount: 3,
    };
    this._mode = null;
    this._roundId = null;
    this._hostId = null;
    this._powerupManager = new PowerupManager(() => this._broadcastPowerups());
    this._powerupTimer = null;
  }

  addPlayer(player) {
    if (this.players.size === 0) {
      this._hostId = player.id;
    }
    this.players.set(player.id, player);
    this._assignTeam(player);
    player.send({
      type: S2C.JOINED,
      playerId: player.id,
      isHost: player.id === this._hostId,
      lobbyState: this._lobbyState(),
    });
    this._broadcastLobby();

    // Drop late joiners straight into the running game
    if (this.state === GAME_STATES.PLAYING) {
      this._joinMidGame(player);
    }
  }

  removePlayer(player) {
    // Let the active mode clean up any state tied to this player (e.g. a CTF
    // carrier leaving must drop its flag) before we forget about them.
    this._mode?.onPlayerLeft?.(player);
    this.players.delete(player.id);
    if (player.id === this._hostId) {
      // Prefer a connected player as the new host
      this._hostId =
        [...this.players.values()].find((p) => !p.disconnected)?.id ??
        this.players.keys().next().value ??
        null;
    }
    this._broadcastLobby();
  }

  // Called by RoomManager when a disconnected player's WebSocket is restored within
  // the grace period. Re-delivers current game state without touching their stats.
  onPlayerRejoined(player) {
    player.send({
      type: S2C.JOINED,
      playerId: player.id,
      isHost: player.id === this._hostId,
      lobbyState: this._lobbyState(),
    });

    if (this.state === GAME_STATES.PLAYING) {
      // Preserve kills/deaths/hits across the rejoin reset
      const { kills, deaths, hits, timesHit } = player;
      player.resetForGame(player.maxHp);
      player.kills = kills;
      player.deaths = deaths;
      player.hits = hits;
      player.timesHit = timesHit;

      player.send({
        type: S2C.GAME_STARTED,
        gameId: this.gameId,
        roundId: this._roundId,
        mode: this.config.mode,
        timeLimit: this.config.timeLimit,
        scoreLimit: this.config.scoreLimit,
        gunAssignments: { [player.id]: player.gunSlotId },
        gameArea: this.config.gameArea ?? null,
        ...this._gameplaySettings(),
      });
    }

    this._broadcastLobby();
  }

  handleMessage(player, msg) {
    switch (msg.type) {
      case C2S.READY:
        if (this.state !== GAME_STATES.WAITING) return;
        player.ready = msg.ready;
        this._broadcastLobby();
        if (this._allReady()) this._startCountdown();
        break;

      case C2S.GAME_CONFIG: {
        if (player.id !== this._hostId) return;
        const prevMode = this.config.mode;
        this.config = { ...this.config, ...msg };
        delete this.config.type;
        if (this.config.mode !== prevMode) this._reassignTeams();
        this._broadcastLobby();
        break;
      }

      case C2S.START_GAME:
        if (player.id !== this._hostId) return;
        this._startCountdown();
        break;

      case C2S.STOP_GAME:
        if (player.id !== this._hostId) return;
        if (this.state !== GAME_STATES.PLAYING) return;
        this._endGame(this._mode?._buildScores() ?? [], null);
        break;

      case C2S.POSITION:
        player.lat = msg.lat;
        player.lng = msg.lng;
        if (this.state === GAME_STATES.PLAYING) {
          this._mode?.onPositionUpdate?.(player);
        }
        break;

      case C2S.SET_BASE:
        if (player.id !== this._hostId) return;
        if (this.config.mode !== GAME_MODES.CAPTURE_THE_FLAG) return;
        if (msg.team !== TEAMS.RED && msg.team !== TEAMS.BLUE) return;
        if (typeof msg.lat !== 'number' || typeof msg.lng !== 'number') return;
        this.config[msg.team === TEAMS.RED ? 'redBase' : 'blueBase'] = {
          lat: msg.lat,
          lng: msg.lng,
        };
        this._broadcastLobby();
        break;

      case C2S.SET_DOM_ZONE: {
        if (player.id !== this._hostId) return;
        if (this.config.mode !== GAME_MODES.DOMINATION) return;
        if (!['A', 'B', 'C'].includes(msg.zoneId)) return;
        if (typeof msg.lat !== 'number' || typeof msg.lng !== 'number') return;
        const zones = [...(this.config.domZones ?? [])];
        const idx = zones.findIndex((z) => z.id === msg.zoneId);
        const newZone = { id: msg.zoneId, lat: msg.lat, lng: msg.lng };
        if (idx >= 0) zones[idx] = newZone;
        else zones.push(newZone);
        this.config.domZones = zones;
        this._broadcastLobby();
        break;
      }

      case C2S.SET_GAME_AREA: {
        if (player.id !== this._hostId) return;
        const area = msg.area ?? null;
        if (area === null) {
          this.config.gameArea = null;
        } else if (area.type === 'circle') {
          if (
            typeof area.lat !== 'number' ||
            typeof area.lng !== 'number' ||
            typeof area.radiusM !== 'number'
          )
            return;
          if (area.radiusM <= 0 || area.radiusM > 10_000) return;
          this.config.gameArea = {
            type: 'circle',
            lat: area.lat,
            lng: area.lng,
            radiusM: area.radiusM,
          };
        } else if (area.type === 'polygon') {
          if (!Array.isArray(area.points) || area.points.length < 3) return;
          const points = area.points.map((p) => ({
            lat: Number(p.lat),
            lng: Number(p.lng),
          }));
          if (points.some((p) => isNaN(p.lat) || isNaN(p.lng))) return;
          this.config.gameArea = { type: 'polygon', points };
        } else {
          return;
        }
        this._broadcastLobby();
        break;
      }

      case C2S.FIRE:
        if (this.state !== GAME_STATES.PLAYING) return;
        if (!player.isAlive) return; // dead players can't fire
        player.lat = msg.lat ?? player.lat;
        player.lng = msg.lng ?? player.lng;
        player.lastFireAt = Date.now();
        // Carries the shooter's current fire mode (and loaded ammo for plasma) so
        // the next hit it produces deals mode-appropriate damage.
        player.lastFireMode = msg.mode ?? null;
        player.lastFireAmmo = msg.ammo ?? 0;
        break;

      case C2S.HIT:
        if (this.state !== GAME_STATES.PLAYING) return;
        this._mode?.registerHit(msg.shooterWeaponId, player);
        break;

      case C2S.COLLECT:
        if (this.state !== GAME_STATES.PLAYING) return;
        this._tryCollect(player, msg.powerupId);
        break;

      case C2S.SWITCH_TEAM:
        if (this.state !== GAME_STATES.WAITING) return;
        if (
          this.config.mode !== GAME_MODES.TEAM_DEATHMATCH &&
          this.config.mode !== GAME_MODES.CAPTURE_THE_FLAG &&
          this.config.mode !== GAME_MODES.DOMINATION
        )
          return;
        if (player.team === TEAMS.RED) player.team = TEAMS.BLUE;
        else if (player.team === TEAMS.BLUE) player.team = TEAMS.RED;
        else return;
        player.ready = false;
        this._broadcastLobby();
        break;

      case C2S.DEPLOY_AIRSTRIKE:
        if (this.state !== GAME_STATES.PLAYING) return;
        this._mode?.deployAirstrike(player, msg.lat, msg.lng);
        break;
    }
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws.readyState === 1) p.ws.send(data);
    }
  }

  _assignTeam(player) {
    if (
      this.config.mode === GAME_MODES.FFA ||
      this.config.mode === GAME_MODES.INFECTION
    )
      return;
    const counts = { [TEAMS.RED]: 0, [TEAMS.BLUE]: 0 };
    for (const p of this.players.values()) {
      if (p.team !== TEAMS.NONE) counts[p.team]++;
    }
    player.team =
      counts[TEAMS.RED] <= counts[TEAMS.BLUE] ? TEAMS.RED : TEAMS.BLUE;
  }

  _reassignTeams() {
    for (const p of this.players.values()) p.team = TEAMS.NONE;
    if (this.config.mode !== GAME_MODES.FFA) {
      for (const p of this.players.values()) this._assignTeam(p);
    }
  }

  _allReady() {
    if (this.players.size < 1) return false;
    return [...this.players.values()].every((p) => p.ready);
  }

  _startCountdown() {
    if (this.state !== GAME_STATES.WAITING) return;
    this.state = GAME_STATES.COUNTDOWN;
    this._onStateChange?.();
    const startsAt = Date.now() + COUNTDOWN_SECS * 1_000;
    this.broadcast({ type: S2C.COUNTDOWN, startsAt });
    setTimeout(() => this._startGame(), COUNTDOWN_SECS * 1_000);
  }

  _startGame() {
    // Guard: host may have stopped or another start raced
    if (this.state !== GAME_STATES.COUNTDOWN) return;
    this.state = GAME_STATES.PLAYING;
    this._onStateChange?.();
    this._roundId = randomUUID();

    let slotId = 0;
    for (const p of this.players.values()) {
      p.gunSlotId = slotId++;
    }

    const gunAssignments = {};
    for (const p of this.players.values()) {
      gunAssignments[p.id] = p.gunSlotId;
    }

    this.broadcast({
      type: S2C.GAME_STARTED,
      gameId: this.gameId,
      roundId: this._roundId,
      mode: this.config.mode,
      timeLimit: this.config.timeLimit,
      scoreLimit: this.config.scoreLimit,
      gunAssignments,
      gameArea: this.config.gameArea ?? null,
      ...this._gameplaySettings(),
    });

    const ModeClass =
      {
        [GAME_MODES.TEAM_DEATHMATCH]: TeamDeathmatch,
        [GAME_MODES.CAPTURE_THE_FLAG]: CaptureTheFlag,
        [GAME_MODES.INFECTION]: Infection,
        [GAME_MODES.DOMINATION]: Domination,
      }[this.config.mode] ?? FFA;
    this._mode = new ModeClass(
      this.players,
      this.config,
      (msg) => this.broadcast(msg),
      this._powerupManager,
      (finalScores, winner) => this._endGame(finalScores, winner),
    );
    this._mode.start();

    this._powerupTimer = setInterval(
      () => this._broadcastPowerups(),
      POWERUP_BROADCAST_INTERVAL_MS,
    );
  }

  _endGame(finalScores, winner) {
    if (this.state !== GAME_STATES.PLAYING) return;
    this._mode?.stop();
    clearInterval(this._powerupTimer);
    this._powerupTimer = null;
    this._mode = null;
    this.state = GAME_STATES.WAITING;
    this._onStateChange?.();
    for (const p of this.players.values()) p.ready = false;
    this.broadcast({
      type: S2C.GAME_ENDED,
      gameId: this.gameId,
      roundId: this._roundId,
      finalScores,
      winner,
    });
    this._roundId = null;
    // Small delay so GAME_ENDED arrives before LOBBY_UPDATE
    setTimeout(() => this._broadcastLobby(), 150);
  }

  destroy() {
    this._mode?.stop();
    clearInterval(this._powerupTimer);
    this._powerupTimer = null;
  }

  _joinMidGame(player) {
    const usedSlots = new Set(
      [...this.players.values()]
        .map((p) => p.gunSlotId)
        .filter((s) => s !== null),
    );
    let slot = 0;
    while (usedSlots.has(slot)) slot++;
    player.gunSlotId = slot;
    player.resetForGame();
    player.send({
      type: S2C.GAME_STARTED,
      gameId: this.gameId,
      roundId: this._roundId,
      mode: this.config.mode,
      timeLimit: this.config.timeLimit,
      scoreLimit: this.config.scoreLimit,
      gunAssignments: { [player.id]: slot },
      gameArea: this.config.gameArea ?? null,
      ...this._gameplaySettings(),
    });
  }

  // Host-tunable settings shipped to clients at game start so guns/UI can
  // reflect magazine size, HP, reload and respawn timing.
  _gameplaySettings() {
    return {
      bulletsPerMag: this.config.bulletsPerMag,
      hpPerPlayer: this.config.hpPerPlayer,
      reloadDelaySecs: this.config.reloadDelaySecs,
      respawnDelaySecs: this.config.respawnDelaySecs,
    };
  }

  _broadcastPowerups() {
    this.broadcast({
      type: S2C.POWERUPS,
      packages: this._powerupManager.getAll(),
    });
  }

  _tryCollect(player, powerupId) {
    if (player.lat === null) return;
    const pkg = this._powerupManager.tryCollect(
      powerupId,
      player.lat,
      player.lng,
    );
    if (!pkg) return;
    this._mode?.applyPowerup(player, pkg);
    this.broadcast({
      type: S2C.GAME_STATE,
      scores: this._mode?._buildScores() ?? [],
      timeRemaining: null,
      killFeed: [],
      event: {
        powerupCollected: {
          playerId: player.id,
          username: player.username,
          type: pkg.type,
        },
      },
    });
  }

  _lobbyState() {
    return {
      gameId: this.gameId,
      roomName: this.roomName,
      players: [...this.players.values()].map((p) => p.toPublic()),
      config: this.config,
      hostId: this._hostId,
      state: this.state,
    };
  }

  _broadcastLobby() {
    this.broadcast({ type: S2C.LOBBY_UPDATE, ...this._lobbyState() });
  }
}
