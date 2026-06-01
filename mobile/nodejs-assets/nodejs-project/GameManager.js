import { randomUUID } from 'crypto';
import { S2C, C2S, GAME_STATES, GAME_MODES, TEAMS } from './shared/messages.js';
import { PowerupManager } from './PowerupManager.js';
import { FFA } from './modes/FFA.js';
import { TeamDeathmatch } from './modes/TeamDeathmatch.js';

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
      timeLimit: 7,
      scoreLimit: 20,
      friendlyFire: false,
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
    this.players.delete(player.id);
    if (player.id === this._hostId) {
      this._hostId = this.players.keys().next().value ?? null;
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

      case C2S.GAME_CONFIG:
        if (player.id !== this._hostId) return;
        const prevMode = this.config.mode;
        this.config = { ...this.config, ...msg };
        delete this.config.type;
        if (this.config.mode !== prevMode) this._reassignTeams();
        this._broadcastLobby();
        break;

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

  _reassignTeams() {
    for (const p of this.players.values()) p.team = TEAMS.NONE;
    if (this.config.mode !== GAME_MODES.FFA) {
      for (const p of this.players.values()) this._assignTeam(p);
    }
  }

  _allReady() {
    if (this.players.size < 1) return false;
    return [...this.players.values()].every(p => p.ready);
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
    });

    const ModeClass = this.config.mode === GAME_MODES.TEAM_DEATHMATCH ? TeamDeathmatch : FFA;
    this._mode = new ModeClass(
      this.players,
      this.config,
      msg => this.broadcast(msg),
      this._powerupManager,
      (finalScores, winner) => this._endGame(finalScores, winner),
    );
    this._mode.start();

    this._powerupTimer = setInterval(() => this._broadcastPowerups(), POWERUP_BROADCAST_INTERVAL_MS);
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
    this.broadcast({ type: S2C.GAME_ENDED, gameId: this.gameId, roundId: this._roundId, finalScores, winner });
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
      [...this.players.values()].map(p => p.gunSlotId).filter(s => s !== null),
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
    });
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
      gameId: this.gameId,
      roomName: this.roomName,
      players: [...this.players.values()].map(p => p.toPublic()),
      config: this.config,
      hostId: this._hostId,
      state: this.state,
    };
  }

  _broadcastLobby() {
    this.broadcast({ type: S2C.LOBBY_UPDATE, ...this._lobbyState() });
  }
}
