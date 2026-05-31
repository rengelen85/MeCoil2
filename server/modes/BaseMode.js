import { S2C, GAME_STATES } from '../../shared/messages.js';

const STATE_INTERVAL_MS = 1_000;
const POSITION_INTERVAL_MS = 1_000;
const ENEMY_VISIBLE_MS = 3_000;

export class BaseMode {
  constructor(players, config, broadcast, powerupManager) {
    this.players = players;
    this.config = config;
    this.broadcast = broadcast;
    this.powerupManager = powerupManager;
    this.killFeed = [];
    this._stateTimer = null;
    this._posTimer = null;
    this._endAt = null;
  }

  start() {
    const durationMs = (this.config.timeLimit ?? 7) * 60 * 1_000;
    this._endAt = Date.now() + durationMs;

    for (const p of this.players.values()) {
      p.resetForGame();
    }

    // Use first known position as power-up spawn center
    const first = [...this.players.values()].find(p => p.lat !== null);
    if (first) {
      this.powerupManager.start(first.lat, first.lng);
    }

    this._stateTimer = setInterval(() => {
      this._tick();
    }, STATE_INTERVAL_MS);

    this._posTimer = setInterval(() => {
      this._broadcastPositions();
    }, POSITION_INTERVAL_MS);
  }

  stop() {
    clearInterval(this._stateTimer);
    clearInterval(this._posTimer);
    this.powerupManager.stop();
  }

  _tick() {
    const remaining = Math.max(0, this._endAt - Date.now());
    this.broadcast({
      type: S2C.GAME_STATE,
      scores: this._buildScores(),
      timeRemaining: Math.ceil(remaining / 1_000),
      killFeed: this.killFeed.slice(-10),
    });

    if (remaining === 0) {
      this._end();
    }
  }

  _end() {
    this.stop();
    this.broadcast({
      type: S2C.GAME_ENDED,
      finalScores: this._buildScores(),
      winner: this._determineWinner(),
    });
  }

  _broadcastPositions() {
    const now = Date.now();
    for (const [_id, player] of this.players) {
      const teammates = [];
      const firingEnemies = [];

      for (const [, other] of this.players) {
        if (other.id === player.id) continue;
        if (other.lat === null) continue;

        const isTeammate = this._areTeammates(player, other);
        if (isTeammate) {
          teammates.push({ id: other.id, username: other.username, lat: other.lat, lng: other.lng });
        } else if (other.lastFireAt && now - other.lastFireAt < ENEMY_VISIBLE_MS && !this._isStealth(other)) {
          firingEnemies.push({ id: other.id, lat: other.lat, lng: other.lng });
        }
      }

      player.send({ type: S2C.POSITIONS, teammates, firingEnemies });
    }
  }

  _isStealth(player) {
    return Date.now() < player.stealthUntil;
  }

  // Override in subclasses:
  _areTeammates(_a, _b) { return false; }
  _buildScores() { return []; }
  _determineWinner() { return null; }

  // Called by GameManager when a hit is reported
  registerHit(shooterWeaponId, victim) {
    const shooter = [...this.players.values()].find(p => p.gunSlotId === shooterWeaponId);
    if (!shooter || shooter.id === victim.id) return;
    if (victim.shieldHits > 0) {
      victim.shieldHits--;
      return;
    }
    shooter.kills++;
    victim.deaths++;
    this.killFeed.push({
      at: Date.now(),
      shooterName: shooter.username,
      victimName: victim.username,
    });

    const scoreLimit = this.config.scoreLimit ?? Infinity;
    if (this._checkWinCondition(shooter, scoreLimit)) {
      this._end();
    }
  }

  // eslint-disable-next-line no-unused-vars
  _checkWinCondition(_scorer, _limit) { return false; }

  applyPowerup(player, pkg) {
    switch (pkg.type) {
      case 'fullReload':
        player.ammo = 30;
        break;
      case 'shield':
        player.shieldHits = 2;
        break;
      case 'stealth':
        player.stealthUntil = Date.now() + 30_000;
        break;
    }
  }
}
