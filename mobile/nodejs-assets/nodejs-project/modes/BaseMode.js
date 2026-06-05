import { S2C, POWERUP_TYPES } from '../shared/messages.js';

const STATE_INTERVAL_MS = 1_000;
const POSITION_INTERVAL_MS = 1_000;
const ENEMY_VISIBLE_MS = 3_000;

export class BaseMode {
  constructor(players, config, broadcast, powerupManager, onEnd) {
    this.players = players;
    this.config = config;
    this.broadcast = broadcast;
    this.powerupManager = powerupManager;
    this.onEnd = onEnd;
    this.killFeed = [];
    this._stateTimer = null;
    this._posTimer = null;
    this._endAt = null;
    this._ended = false;
    this._powerupsStarted = false;
  }

  start() {
    const durationMs = (this.config.timeLimit ?? 7) * 60 * 1_000;
    this._endAt = Date.now() + durationMs;

    for (const p of this.players.values()) {
      p.resetForGame(this.config.hpPerPlayer ?? 100);
    }

    // Try to start power-up spawning immediately; if no player has a GPS fix yet
    // (clients only start GPS once they reach the in-game screen), _tick keeps
    // retrying until a position is known so power-ups still appear.
    this._tryStartPowerups();

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
    for (const p of this.players.values()) {
      if (p.respawnTimer) {
        clearTimeout(p.respawnTimer);
        p.respawnTimer = null;
      }
    }
    this.powerupManager.stop();
  }

  // Power-up spawning needs a center point (the first known player position).
  // At game start no client has sent a GPS fix yet, so this is retried each tick
  // until a position is available, then the spawner runs for the rest of the game.
  _tryStartPowerups() {
    if (this._powerupsStarted) return;
    const first = [...this.players.values()].find(p => p.lat !== null);
    if (!first) return;
    this.powerupManager.start(first.lat, first.lng);
    this._powerupsStarted = true;
  }

  _tick() {
    this._tryStartPowerups();
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
    if (this._ended) return;
    this._ended = true;
    this.stop();
    this.onEnd(this._buildScores(), this._determineWinner());
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
          teammates.push({
            id: other.id,
            username: other.username,
            lat: other.lat,
            lng: other.lng,
            hp: other.hp,
            maxHp: other.maxHp,
            isAlive: other.isAlive,
          });
        } else if (other.isAlive && other.lastFireAt && now - other.lastFireAt < ENEMY_VISIBLE_MS && !this._isStealth(other)) {
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

  // Called by GameManager when a hit is reported. Damage is HP-based: each hit
  // subtracts `hpCostPerHit`; a kill is only registered when HP reaches zero.
  registerHit(shooterWeaponId, victim) {
    const shooter = [...this.players.values()].find(p => p.gunSlotId === shooterWeaponId);
    if (!shooter || shooter.id === victim.id) return;
    if (!shooter.isAlive || !victim.isAlive) return; // dead players neither deal nor take damage
    if (!this.config.friendlyFire && this._areTeammates(shooter, victim)) return;

    const hpCost = this.config.hpCostPerHit ?? 25;
    victim.hp = Math.max(0, victim.hp - hpCost);
    shooter.hits++;
    victim.timesHit++;

    this.broadcast({
      type: S2C.PLAYER_HP,
      playerId: victim.id,
      hp: victim.hp,
      maxHp: victim.maxHp,
      shooterId: shooter.id,
    });

    if (victim.hp <= 0) {
      this._registerKill(shooter, victim);
    }
  }

  _registerKill(shooter, victim) {
    shooter.kills++;
    victim.deaths++;
    victim.isAlive = false;
    this.killFeed.push({
      at: Date.now(),
      shooterName: shooter.username,
      victimName: victim.username,
    });

    const respawnSecs = this.config.respawnDelaySecs ?? 10;
    this.broadcast({
      type: S2C.PLAYER_DEAD,
      playerId: victim.id,
      killerId: shooter.id,
      respawnIn: respawnSecs,
    });

    victim.respawnTimer = setTimeout(() => this._respawn(victim), respawnSecs * 1_000);

    const scoreLimit = this.config.scoreLimit ?? Infinity;
    if (this._checkWinCondition(shooter, scoreLimit)) {
      this._end();
    }
  }

  _respawn(player) {
    player.respawnTimer = null;
    player.hp = player.maxHp;
    player.isAlive = true;
    this.broadcast({
      type: S2C.PLAYER_RESPAWN,
      playerId: player.id,
      hp: player.hp,
      maxHp: player.maxHp,
    });
  }

  // eslint-disable-next-line no-unused-vars
  _checkWinCondition(_scorer, _limit) { return false; }

  applyPowerup(player, pkg) {
    switch (pkg.type) {
      case POWERUP_TYPES.FULL_RELOAD:
        player.ammo = this.config.bulletsPerMag ?? 30;
        break;
      case POWERUP_TYPES.HEALTH_PACK:
        player.hp = player.maxHp;
        this.broadcast({
          type: S2C.PLAYER_HP,
          playerId: player.id,
          hp: player.hp,
          maxHp: player.maxHp,
        });
        break;
      case POWERUP_TYPES.SHIELD:
        // Shields stack bonus HP on top of max (can exceed maxHp).
        player.hp += Math.floor(player.maxHp * 0.5);
        this.broadcast({
          type: S2C.PLAYER_HP,
          playerId: player.id,
          hp: player.hp,
          maxHp: player.maxHp,
        });
        break;
      case POWERUP_TYPES.STEALTH:
        player.stealthUntil = Date.now() + 30_000;
        break;
    }
  }
}
