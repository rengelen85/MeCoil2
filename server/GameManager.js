import { S2C, C2S, GAME_STATES, GAME_MODES, TEAMS } from '../shared/messages.js';
import { PowerupManager } from './PowerupManager.js';
import { FFA } from './modes/FFA.js';
import { TeamDeathmatch } from './modes/TeamDeathmatch.js';

const COUNTDOWN_SECS = 5;
const POWERUP_BROADCAST_INTERVAL_MS = 2_000;

export class GameManager {
  constructor() {
    this.players = new Map(); // id -> Player
    this.state = GAME_STATES.WAITING;
    this.config = {
      mode: GAME_MODES.FFA,
      timeLimit: 7,
      scoreLimit: 20,
    };
    this._mode = null;
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
  }

  removePlayer(player) {
    this.players.delete(player.id);
    if (player.id === this._hostId) {
      this._hostId = this.players.keys().next().value ?? null;
    }
    this._broadcastLobby();
  }

  handleMessage(player, msg) {
    switch (msg.type) {
      case C2S.READY:
        player.ready = msg.ready;
        this._broadcastLobby();
        if (this._allReady()) this._startCountdown();
        break;

      case C2S.GAME_CONFIG:
        if (player.id !== this._hostId) return;
        this.config = { ...this.config, ...msg };
        delete this.config.type;
        this._broadcastLobby();
        break;

      case C2S.START_GAME:
        if (player.id !== this._hostId) return;
        this._startCountdown();
        break;

      case C2S.POSITION:
        player.lat = msg.lat;
        player.lng = msg.lng;
        break;

      case C2S.FIRE:
        if (this.state !== GAME_STATES.PLAYING) return;
        player.lat = msg.lat ?? player.lat;
        player.lng = msg.lng ?? player.lng;
        player.lastFireAt = Date.now();
        break;

      case C2S.HIT:
        if (this.state !== GAME_STATES.PLAYING) return;
        this._mode?.registerHit(msg.shooterWeaponId, player);
        break;

      case C2S.COLLECT:
        if (this.state !== GAME_STATES.PLAYING) return;
        this._tryCollect(player, msg.powerupId);
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
    if (this.config.mode === GAME_MODES.FFA) return;
    const counts = { [TEAMS.RED]: 0, [TEAMS.BLUE]: 0 };
    for (const p of this.players.values()) {
      if (p.team !== TEAMS.NONE) counts[p.team]++;
    }
    player.team = counts[TEAMS.RED] <= counts[TEAMS.BLUE] ? TEAMS.RED : TEAMS.BLUE;
  }

  _allReady() {
    if (this.players.size < 1) return false;
    return [...this.players.values()].every(p => p.ready);
  }

  _startCountdown() {
    if (this.state !== GAME_STATES.WAITING) return;
    this.state = GAME_STATES.COUNTDOWN;
    const startsAt = Date.now() + COUNTDOWN_SECS * 1_000;
    this.broadcast({ type: S2C.COUNTDOWN, startsAt });
    setTimeout(() => this._startGame(), COUNTDOWN_SECS * 1_000);
  }

  _startGame() {
    this.state = GAME_STATES.PLAYING;

    // Assign gun slot IDs
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
      mode: this.config.mode,
      timeLimit: this.config.timeLimit,
      scoreLimit: this.config.scoreLimit,
      gunAssignments,
    });

    const ModeClass = this.config.mode === GAME_MODES.TEAM_DEATHMATCH ? TeamDeathmatch : FFA;
    this._mode = new ModeClass(this.players, this.config, msg => this.broadcast(msg), this._powerupManager);
    this._mode.start();

    this._powerupTimer = setInterval(() => this._broadcastPowerups(), POWERUP_BROADCAST_INTERVAL_MS);
  }

  _broadcastPowerups() {
    this.broadcast({ type: S2C.POWERUPS, packages: this._powerupManager.getAll() });
  }

  _tryCollect(player, powerupId) {
    if (player.lat === null) return;
    const pkg = this._powerupManager.tryCollect(powerupId, player.lat, player.lng);
    if (!pkg) return;
    this._mode?.applyPowerup(player, pkg);
    this.broadcast({
      type: S2C.GAME_STATE,
      scores: this._mode?._buildScores() ?? [],
      timeRemaining: null,
      killFeed: [],
      event: { powerupCollected: { playerId: player.id, username: player.username, type: pkg.type } },
    });
  }

  _lobbyState() {
    return {
      players: [...this.players.values()].map(p => p.toPublic()),
      config: this.config,
      hostId: this._hostId,
    };
  }

  _broadcastLobby() {
    this.broadcast({ type: S2C.LOBBY_UPDATE, ...this._lobbyState() });
  }
}
