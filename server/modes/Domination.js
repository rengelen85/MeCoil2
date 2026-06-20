import { POWERUP_TYPES, S2C, TEAMS } from '../../shared/messages.js';
import { BaseMode } from './BaseMode.js';

// Radius (metres) a player must be within to contest or capture a zone.
const ZONE_RADIUS_M = 7.5;

// controlValue progress gained per alive player per second while uncontested.
// One player alone caps a neutral zone in 1 / 0.05 = 20 seconds.
const CAPTURE_RATE_BASE = 0.05;

// Random powerup types available as deathstreak rewards.
const DEATHSTREAK_POOL = [
  POWERUP_TYPES.HEALTH_PACK,
  POWERUP_TYPES.SHIELD,
  POWERUP_TYPES.RADAR,
  POWERUP_TYPES.FAST_RELOAD,
];

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

export class Domination extends BaseMode {
  constructor(players, config, broadcast, powerupManager, onEnd) {
    super(players, config, broadcast, powerupManager, onEnd);

    // Internal zones. _controlValue: -1 = fully blue, 0 = neutral, +1 = fully red.
    this._zones = (config.domZones ?? []).map((z) => ({
      id: z.id,
      lat: z.lat,
      lng: z.lng,
      _controlValue: 0,
      _contested: false,
      _activeTeam: null, // team currently making capture progress
    }));

    this._teamPoints = { [TEAMS.RED]: 0, [TEAMS.BLUE]: 0 };
    this._scoringTickMs = (config.dominationTickSecs ?? 2) * 1_000;
    this._nextScoringTick = 0; // fires on first _tick (zones are neutral, so no early points)

    this._deathstreakEnabled = config.deathstreakEnabled ?? false;
    this._deathstreakCount = config.deathstreakCount ?? 3;
    this._deathStreaks = new Map(); // playerId → consecutive deaths since last kill
    this._deathTimes = new Map(); // playerId → ms timestamp of death
  }

  _areTeammates(a, b) {
    return a.team !== TEAMS.NONE && a.team === b.team;
  }

  _tick() {
    this._tryStartPowerups();
    this._updateZones();
    this._scorePoints();

    const remaining = Math.max(0, this._endAt - Date.now());
    this.broadcast({
      type: S2C.GAME_STATE,
      scores: this._buildScores(),
      timeRemaining: Math.ceil(remaining / 1_000),
      killFeed: this.killFeed.slice(-10),
      dominationState: this._dominationPayload(),
    });

    if (remaining === 0) {
      this._end();
    }
  }

  // Run once per game tick (1 s). Each alive player inside a zone contributes
  // CAPTURE_RATE_BASE to their team's controlValue progress; contested = no movement.
  _updateZones() {
    for (const zone of this._zones) {
      if (zone.lat === null || zone.lng === null) continue;

      let redCount = 0;
      let blueCount = 0;
      for (const p of this.players.values()) {
        if (!p.isAlive || p.lat === null) continue;
        if (haversineMeters(p.lat, p.lng, zone.lat, zone.lng) > ZONE_RADIUS_M)
          continue;
        if (p.team === TEAMS.RED) redCount++;
        else if (p.team === TEAMS.BLUE) blueCount++;
      }

      zone._contested = redCount > 0 && blueCount > 0;

      if (zone._contested) {
        zone._activeTeam = null;
      } else if (redCount > 0) {
        zone._activeTeam = TEAMS.RED;
        zone._controlValue = Math.min(
          1,
          zone._controlValue + CAPTURE_RATE_BASE * redCount,
        );
      } else if (blueCount > 0) {
        zone._activeTeam = TEAMS.BLUE;
        zone._controlValue = Math.max(
          -1,
          zone._controlValue - CAPTURE_RATE_BASE * blueCount,
        );
      } else {
        zone._activeTeam = null;
      }
    }

    // If a dead player was waiting for location-based respawn (no timer scheduled)
    // but their team now owns no zones, start a fallback auto-respawn timer.
    const respawnSecs = this.config.respawnDelaySecs ?? 10;
    for (const player of this.players.values()) {
      if (player.isAlive || player.respawnTimer !== null) continue;
      if (this._ownedZonesFor(player.team).length === 0) {
        const elapsed = Date.now() - (this._deathTimes.get(player.id) ?? 0);
        const remaining = Math.max(0, respawnSecs * 1_000 - elapsed);
        player.respawnAt = Date.now() + remaining;
        player.respawnTimer = setTimeout(
          () => this._respawn(player),
          remaining,
        );
      }
    }
  }

  _ownedZonesFor(team) {
    return this._zones.filter((z) =>
      team === TEAMS.RED ? z._controlValue >= 1.0 : z._controlValue <= -1.0,
    );
  }

  // Award points to each team for every zone they fully own, on each scoring tick.
  _scorePoints() {
    const now = Date.now();
    if (now < this._nextScoringTick) return;
    this._nextScoringTick = now + this._scoringTickMs;

    for (const zone of this._zones) {
      if (zone._controlValue >= 1.0) this._teamPoints[TEAMS.RED]++;
      else if (zone._controlValue <= -1.0) this._teamPoints[TEAMS.BLUE]++;
    }

    const scoreLimit = this.config.scoreLimit ?? 1000;
    if (
      this._teamPoints[TEAMS.RED] >= scoreLimit ||
      this._teamPoints[TEAMS.BLUE] >= scoreLimit
    ) {
      this._end();
    }
  }

  _dominationPayload() {
    return {
      zones: this._zones.map((z) => {
        const cv = z._controlValue;
        const owner =
          cv >= 1.0 ? TEAMS.RED : cv <= -1.0 ? TEAMS.BLUE : 'neutral';
        return {
          id: z.id,
          lat: z.lat,
          lng: z.lng,
          owner,
          // 0 = neutral, 1 = fully owned; positive = red side, negative = blue side
          controlValue: cv,
          capturingTeam: z._activeTeam,
          contested: z._contested,
        };
      }),
      teamPoints: { ...this._teamPoints },
    };
  }

  _buildScores() {
    return [TEAMS.RED, TEAMS.BLUE]
      .map((team) => ({
        team,
        points: this._teamPoints[team],
        kills: this._teamKills(team),
        players: [...this.players.values()]
          .filter((p) => p.team === team)
          .map((p) => ({
            id: p.id,
            username: p.username,
            kills: p.kills,
            deaths: p.deaths,
            hits: p.hits,
            timesHit: p.timesHit,
            hp: p.hp,
            maxHp: p.maxHp,
            isAlive: p.isAlive,
          })),
      }))
      .sort((a, b) => b.points - a.points);
  }

  _determineWinner() {
    const red = this._teamPoints[TEAMS.RED];
    const blue = this._teamPoints[TEAMS.BLUE];
    if (red > blue) return TEAMS.RED;
    if (blue > red) return TEAMS.BLUE;
    return 'draw';
  }

  _checkWinCondition(_scorer, _limit) {
    // Win condition is checked in _scorePoints rather than on kills.
    return false;
  }

  _teamKills(team) {
    return [...this.players.values()]
      .filter((p) => p.team === team)
      .reduce((sum, p) => sum + p.kills, 0);
  }

  // Override: track deathstreaks and use zone-based respawn with a fallback timer.
  _killPlayer(victim, killer) {
    const credited = killer && killer.id !== victim.id;

    if (this._deathstreakEnabled) {
      const streak = (this._deathStreaks.get(victim.id) ?? 0) + 1;
      this._deathStreaks.set(victim.id, streak);

      if (streak % this._deathstreakCount === 0) {
        const enemyTeam = victim.team === TEAMS.RED ? TEAMS.BLUE : TEAMS.RED;
        if (this._teamPoints[victim.team] < this._teamPoints[enemyTeam]) {
          victim._pendingDeathstreakPowerup = true;
        }
      }

      if (credited) this._deathStreaks.set(killer.id, 0);
    }

    victim.deaths++;
    victim.isAlive = false;
    victim.shieldUntil = 0;
    if (credited) killer.kills++;
    this._deathTimes.set(victim.id, Date.now());
    this.killFeed.push({
      at: Date.now(),
      shooterName: credited ? killer.username : 'Airstrike',
      victimName: victim.username,
    });

    // If the team owns at least one zone, use location-based respawn so the player
    // must walk to a friendly zone. Otherwise fall back to a timed auto-respawn.
    const ownedZones = this._ownedZonesFor(victim.team);
    // Enable this log line to debug respawn behavior when a player dies.
    // console.log('[DOM] _killPlayer debug — victim.team:', victim.team, 'zones:', this._zones.map(z => ({ id: z.id, cv: z._controlValue })), 'ownedZones:', ownedZones.length);
    const hasZone = ownedZones.length > 0;
    const respawnSecs = this.config.respawnDelaySecs ?? 10;

    this.broadcast({
      type: S2C.PLAYER_DEAD,
      playerId: victim.id,
      username: victim.username,
      killerId: credited ? killer.id : null,
      killerName: credited ? killer.username : null,
      respawnIn: hasZone ? null : respawnSecs,
      lat: victim.lat,
      lng: victim.lng,
    });

    if (victim.respawnTimer) clearTimeout(victim.respawnTimer);
    if (hasZone) {
      victim.respawnTimer = null; // onPositionUpdate handles zone-proximity respawn
    } else {
      victim.respawnAt = Date.now() + respawnSecs * 1_000;
      victim.respawnTimer = setTimeout(
        () => this._respawn(victim),
        respawnSecs * 1_000,
      );
    }
  }

  // Location-based respawn: fires on every position update for dead players.
  onPositionUpdate(player) {
    if (player.lat === null || player.isAlive || player.respawnTimer !== null)
      return;

    const elapsed = Date.now() - (this._deathTimes.get(player.id) ?? 0);
    if (elapsed < (this.config.respawnDelaySecs ?? 10) * 1_000) return;

    for (const zone of this._ownedZonesFor(player.team)) {
      if (
        haversineMeters(player.lat, player.lng, zone.lat, zone.lng) <=
        ZONE_RADIUS_M
      ) {
        this._respawn(player);
        return;
      }
    }
  }

  // Override: apply pending deathstreak powerup before resuming play.
  _respawn(player) {
    if (player._pendingDeathstreakPowerup) {
      player._pendingDeathstreakPowerup = false;
      const type =
        DEATHSTREAK_POOL[Math.floor(Math.random() * DEATHSTREAK_POOL.length)];
      this.applyPowerup(player, { type });
      this.broadcast({
        type: S2C.GAME_STATE,
        scores: this._buildScores(),
        timeRemaining: null,
        killFeed: [],
        event: {
          powerupCollected: {
            playerId: player.id,
            username: player.username,
            type,
          },
        },
      });
    }
    super._respawn(player);
  }
}
