import { POWERUP_TYPES, S2C } from '../../shared/messages.js';
import { BaseMode } from './BaseMode.js';

const IMMUNITY_GRACE_MS = 20_000; // window after being shot while immune

export class Infection extends BaseMode {
  constructor(players, config, broadcast, powerupManager, onEnd) {
    super(players, config, broadcast, powerupManager, onEnd);
    this._infected = new Set(); // player IDs
    // immunity map: playerId -> { hasImmunity: bool, gracePeriodUntil: timestamp|null }
    this._immunity = new Map();
  }

  start() {
    // Select a random player as patient zero
    const all = [...this.players.values()];
    if (all.length > 0) {
      const patient0 = all[Math.floor(Math.random() * all.length)];
      this._infected.add(patient0.id);
    }
    super.start();
  }

  // Only spawn immunity power-ups in this mode
  _tryStartPowerups() {
    if (this._powerupsStarted) return;
    const first = [...this.players.values()].find((p) => p.lat !== null);
    if (!first) return;
    this.powerupManager.start(first.lat, first.lng, [POWERUP_TYPES.IMMUNITY]);
    this._powerupsStarted = true;
  }

  _isInfected(player) {
    return this._infected.has(player.id);
  }

  _areTeammates(a, b) {
    return this._isInfected(a) === this._isInfected(b);
  }

  // Show all players on each other's maps — infected hunt survivors, survivors dodge infected
  _broadcastPositions() {
    for (const [, player] of this.players) {
      const teammates = [];
      const firingEnemies = [];

      for (const [, other] of this.players) {
        if (other.id === player.id) continue;
        if (other.lat === null) continue;

        if (this._areTeammates(player, other)) {
          teammates.push({
            id: other.id,
            username: other.username,
            lat: other.lat,
            lng: other.lng,
            hp: other.hp,
            maxHp: other.maxHp,
            isAlive: other.isAlive,
          });
        } else {
          // Always show enemies in infection — infected need to find survivors
          firingEnemies.push({ id: other.id, lat: other.lat, lng: other.lng });
        }
      }

      player.send({ type: S2C.POSITIONS, teammates, firingEnemies });
    }
  }

  // Completely replace hit handling: shots from non-infected do nothing;
  // shots from infected spread the infection (respecting immunity).
  registerHit(shooterWeaponId, victim) {
    const shooter = [...this.players.values()].find(
      (p) => p.gunSlotId === shooterWeaponId,
    );
    if (!shooter || shooter.id === victim.id) return;
    if (!shooter.isAlive || !victim.isAlive) return;
    if (!this._isInfected(shooter)) return; // non-infected shots are ignored
    if (this._isInfected(victim)) return; // can't re-infect

    const imm = this._immunity.get(victim.id);

    if (imm?.hasImmunity) {
      // Consume the immunity token and start the grace period
      imm.hasImmunity = false;
      imm.gracePeriodUntil = Date.now() + IMMUNITY_GRACE_MS;
      this._broadcastInfectionState();
      return;
    }

    if (imm?.gracePeriodUntil && Date.now() < imm.gracePeriodUntil) {
      // Still within the grace window — protected
      return;
    }

    this._infect(victim, shooter);
  }

  _infect(victim, shooter) {
    this._infected.add(victim.id);
    this._immunity.delete(victim.id);

    shooter.kills++;
    victim.deaths++;
    this.killFeed.push({
      at: Date.now(),
      shooterName: shooter.username,
      victimName: victim.username,
      event: 'infected',
    });

    this._broadcastInfectionState();

    // Check if all players are infected
    if (this._checkWinCondition()) {
      this._end();
    }
  }

  applyPowerup(player, pkg) {
    if (pkg.type !== POWERUP_TYPES.IMMUNITY) return; // all other powerups disabled
    if (this._isInfected(player)) return; // infected can't use immunity

    const existing = this._immunity.get(player.id);
    if (existing) {
      existing.hasImmunity = true;
    } else {
      this._immunity.set(player.id, {
        hasImmunity: true,
        gracePeriodUntil: null,
      });
    }
    this._broadcastInfectionState();
  }

  _tick() {
    this._tryStartPowerups();
    const remaining = Math.max(0, this._endAt - Date.now());
    this.broadcast({
      type: S2C.GAME_STATE,
      scores: this._buildScores(),
      timeRemaining: Math.ceil(remaining / 1_000),
      killFeed: this.killFeed.slice(-10),
      infectionState: this._infectionPayload(),
    });

    if (remaining === 0) {
      this._end();
    }
  }

  _broadcastInfectionState() {
    this.broadcast({
      type: S2C.GAME_STATE,
      scores: this._buildScores(),
      timeRemaining: null,
      killFeed: this.killFeed.slice(-10),
      infectionState: this._infectionPayload(),
    });
  }

  _infectionPayload() {
    const immunePlayers = {};
    for (const [id, imm] of this._immunity) {
      if (
        imm.hasImmunity ||
        (imm.gracePeriodUntil && Date.now() < imm.gracePeriodUntil)
      ) {
        immunePlayers[id] = {
          hasImmunity: imm.hasImmunity,
          gracePeriodUntil: imm.gracePeriodUntil,
        };
      }
    }
    return {
      infectedIds: [...this._infected],
      immunePlayers,
    };
  }

  _buildScores() {
    const infectedPlayers = [...this.players.values()].filter((p) =>
      this._isInfected(p),
    );
    const survivors = [...this.players.values()].filter(
      (p) => !this._isInfected(p),
    );
    return [
      {
        team: 'infected',
        count: infectedPlayers.length,
        players: infectedPlayers.map((p) => ({
          id: p.id,
          username: p.username,
          kills: p.kills,
          deaths: p.deaths,
          isAlive: p.isAlive,
        })),
      },
      {
        team: 'survivors',
        count: survivors.length,
        players: survivors.map((p) => ({
          id: p.id,
          username: p.username,
          kills: 0,
          deaths: p.deaths,
          isAlive: p.isAlive,
        })),
      },
    ];
  }

  _determineWinner() {
    const survivors = [...this.players.values()].filter(
      (p) => !this._isInfected(p),
    );
    return survivors.length === 0 ? 'infected' : 'survivors';
  }

  _checkWinCondition() {
    return [...this.players.values()].every((p) => this._isInfected(p));
  }
}
