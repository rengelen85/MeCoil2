import { S2C, POWERUP_TYPES, GUN_MODE_DAMAGE, PLASMA_DAMAGE_PER_AMMO, AIRSTRIKE_RADIUS_M } from '../shared/messages.js';

const STATE_INTERVAL_MS = 1_000;
const POSITION_INTERVAL_MS = 1_000;
const ENEMY_VISIBLE_MS = 3_000;
const RADAR_DURATION_MS = 60_000;   // radar reveals all enemies for one minute
const SHIELD_PICKUP_MS = 120_000;   // shield from a power-up lasts 2 minutes
const SHIELD_RESPAWN_MS = 20_000;   // shield granted on respawn lasts 20 seconds
const AIRSTRIKE_WARNING_MS = 8_000; // evacuation window before detonation

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let nextAirstrikeId = 1;

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
    this._airstrikeTimers = [];
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
    for (const t of this._airstrikeTimers) clearTimeout(t);
    this._airstrikeTimers = [];
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
      // While radar is active this player sees every living enemy, even stealthed
      // ones; otherwise enemies only blip when they fire.
      const hasRadar = this._isRadar(player);

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
        } else if (
          other.isAlive &&
          (hasRadar ||
            (other.lastFireAt && now - other.lastFireAt < ENEMY_VISIBLE_MS && !this._isStealth(other)))
        ) {
          firingEnemies.push({ id: other.id, lat: other.lat, lng: other.lng });
        }
      }

      player.send({ type: S2C.POSITIONS, teammates, firingEnemies });
    }
  }

  _isStealth(player) {
    return Date.now() < player.stealthUntil;
  }

  _isRadar(player) {
    return Date.now() < player.radarUntil;
  }

  // Override in subclasses:
  _areTeammates(_a, _b) { return false; }
  _buildScores() { return []; }
  _determineWinner() { return null; }

  // Called by GameManager when a hit is reported. Damage is HP-based; a kill is
  // only registered when HP reaches zero.
  registerHit(shooterWeaponId, victim) {
    const shooter = [...this.players.values()].find(p => p.gunSlotId === shooterWeaponId);
    if (!shooter || shooter.id === victim.id) return;
    if (!shooter.isAlive || !victim.isAlive) return; // dead players neither deal nor take damage
    if (!this.config.friendlyFire && this._areTeammates(shooter, victim)) return;

    let hpCost = this._damageFor(shooter);
    if (Date.now() < victim.shieldUntil) hpCost = Math.ceil(hpCost / 2);
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

  // HP removed by a single hit, derived from the shooter's most recent fire mode.
  // PLASMA scales with the rounds that were loaded when it fired; the other modes
  // are fixed (see GUN_MODE_DAMAGE). Falls back to AUTO damage when no mode was
  // reported (e.g. the keyboard simulator).
  _damageFor(shooter) {
    if (shooter.lastFireMode === 'plasma') {
      return Math.max(0, shooter.lastFireAmmo) * PLASMA_DAMAGE_PER_AMMO;
    }
    return GUN_MODE_DAMAGE[shooter.lastFireMode] ?? GUN_MODE_DAMAGE.auto;
  }

  _registerKill(shooter, victim) {
    this._killPlayer(victim, shooter);
  }

  // Lethal takedown shared by gunfire and airstrikes. `killer` may be null or the
  // victim themselves (e.g. caught in their own blast) — then it's an uncredited death.
  _killPlayer(victim, killer) {
    const credited = killer && killer.id !== victim.id;
    victim.deaths++;
    victim.isAlive = false;
    victim.shieldUntil = 0;
    if (credited) killer.kills++;
    this.killFeed.push({
      at: Date.now(),
      shooterName: credited ? killer.username : 'Airstrike',
      victimName: victim.username,
    });

    const respawnSecs = this.config.respawnDelaySecs ?? 10;
    this.broadcast({
      type: S2C.PLAYER_DEAD,
      playerId: victim.id,
      username: victim.username,
      killerId: credited ? killer.id : null,
      respawnIn: respawnSecs,
      // Last-known position of the victim, so clients can drop a tombstone marker
      // where they fell. May be null if the victim never had a GPS fix.
      lat: victim.lat,
      lng: victim.lng,
    });

    if (victim.respawnTimer) clearTimeout(victim.respawnTimer);
    victim.respawnTimer = setTimeout(() => this._respawn(victim), respawnSecs * 1_000);

    const scoreLimit = this.config.scoreLimit ?? Infinity;
    if (credited && this._checkWinCondition(killer, scoreLimit)) {
      this._end();
    }
  }

  _respawn(player) {
    if (this._ended) return;
    player.respawnTimer = null;
    player.hp = player.maxHp;
    player.ammo = this.config.bulletsPerMag ?? 30;
    player.isAlive = true;
    player.shieldUntil = Date.now() + SHIELD_RESPAWN_MS;
    this.broadcast({
      type: S2C.PLAYER_RESPAWN,
      playerId: player.id,
      hp: player.hp,
      maxHp: player.maxHp,
      ammo: player.ammo,
      shieldMs: SHIELD_RESPAWN_MS,
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
        player.shieldUntil = Date.now() + SHIELD_PICKUP_MS;
        break;
      case POWERUP_TYPES.STEALTH:
        player.stealthUntil = Date.now() + 30_000;
        break;
      case POWERUP_TYPES.RADAR:
        player.radarUntil = Date.now() + RADAR_DURATION_MS;
        break;
      case POWERUP_TYPES.AIRSTRIKE:
        // Not an instant effect — the player holds it and deploys it later.
        player.airstrikesAvailable++;
        break;
    }
  }

  // A player calls in one of their held airstrikes at a chosen map point. Everyone
  // is warned immediately and has AIRSTRIKE_WARNING_MS to clear the blast radius.
  deployAirstrike(deployer, lat, lng) {
    if (!deployer || !deployer.isAlive) return;
    if (deployer.airstrikesAvailable <= 0) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    deployer.airstrikesAvailable--;

    const id = nextAirstrikeId++;
    const detonateAt = Date.now() + AIRSTRIKE_WARNING_MS;
    this.broadcast({
      type: S2C.AIRSTRIKE_INCOMING,
      id,
      lat,
      lng,
      radius: AIRSTRIKE_RADIUS_M,
      detonateAt,
      by: deployer.username,
    });

    const timer = setTimeout(
      () => this._detonateAirstrike(deployer, id, lat, lng),
      AIRSTRIKE_WARNING_MS,
    );
    this._airstrikeTimers.push(timer);
  }

  _detonateAirstrike(deployer, id, lat, lng) {
    if (this._ended) return;

    const victims = [];
    for (const p of this.players.values()) {
      if (!p.isAlive || p.lat === null) continue;
      if (haversineMeters(lat, lng, p.lat, p.lng) > AIRSTRIKE_RADIUS_M) continue;
      // Respect friendly fire: spare the caller and teammates unless it's enabled.
      if (!this.config.friendlyFire && (p.id === deployer.id || this._areTeammates(deployer, p))) continue;
      victims.push(p);
    }

    this.broadcast({ type: S2C.AIRSTRIKE_HIT, id, lat, lng, radius: AIRSTRIKE_RADIUS_M });

    for (const victim of victims) {
      if (this._ended) break;
      victim.hp = 0;
      victim.timesHit++;
      this.broadcast({
        type: S2C.PLAYER_HP,
        playerId: victim.id,
        hp: victim.hp,
        maxHp: victim.maxHp,
      });
      this._killPlayer(victim, deployer);
    }
  }
}
