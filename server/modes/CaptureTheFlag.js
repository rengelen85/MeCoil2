import { BaseMode } from './BaseMode.js';
import { S2C, TEAMS } from '../../shared/messages.js';

const BASE_RADIUS_M = 7.5;
const FLAG_INTERACT_RADIUS_M = 10;

const FLAG_STATE = {
  AT_BASE: 'atBase',
  CARRIED: 'carried',
  DROPPED: 'dropped',
};

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

export class CaptureTheFlag extends BaseMode {
  constructor(players, config, broadcast, powerupManager, onEnd) {
    super(players, config, broadcast, powerupManager, onEnd);

    this._redBase = config.redBase ?? null;   // { lat, lng } or null if not set
    this._blueBase = config.blueBase ?? null;

    this._flags = {
      [TEAMS.RED]: { state: FLAG_STATE.AT_BASE, lat: null, lng: null, carrierId: null },
      [TEAMS.BLUE]: { state: FLAG_STATE.AT_BASE, lat: null, lng: null, carrierId: null },
    };

    this._captures = { [TEAMS.RED]: 0, [TEAMS.BLUE]: 0 };
    this._deathTimes = new Map(); // playerId → ms timestamp of death
  }

  start() {
    // Place flags at their base centers
    if (this._redBase) {
      this._flags[TEAMS.RED].lat = this._redBase.lat;
      this._flags[TEAMS.RED].lng = this._redBase.lng;
    }
    if (this._blueBase) {
      this._flags[TEAMS.BLUE].lat = this._blueBase.lat;
      this._flags[TEAMS.BLUE].lng = this._blueBase.lng;
    }
    super.start();
  }

  _areTeammates(a, b) {
    return a.team !== TEAMS.NONE && a.team === b.team;
  }

  // Position update hook called by GameManager after each C2S.POSITION.
  onPositionUpdate(player) {
    if (player.lat === null) return;

    if (!player.isAlive) {
      // Dead player at own base AND ≥10s since death → respawn
      const base = player.team === TEAMS.RED ? this._redBase : this._blueBase;
      if (base && haversineMeters(player.lat, player.lng, base.lat, base.lng) <= BASE_RADIUS_M) {
        const elapsed = Date.now() - (this._deathTimes.get(player.id) ?? 0);
        if (elapsed >= 10_000) {
          this._respawnAtBase(player);
        }
      }
      return;
    }

    this._checkFlagInteractions(player);
  }

  _checkFlagInteractions(player) {
    const enemyTeam = player.team === TEAMS.RED ? TEAMS.BLUE : TEAMS.RED;
    const ownTeam = player.team;
    const enemyFlag = this._flags[enemyTeam];
    const ownFlag = this._flags[ownTeam];
    const ownBase = ownTeam === TEAMS.RED ? this._redBase : this._blueBase;
    const enemyBase = enemyTeam === TEAMS.RED ? this._redBase : this._blueBase;

    // Pick up enemy flag if it's available (at base or dropped)
    if (enemyFlag.state !== FLAG_STATE.CARRIED && enemyFlag.lat !== null) {
      const dist = haversineMeters(player.lat, player.lng, enemyFlag.lat, enemyFlag.lng);
      if (dist <= FLAG_INTERACT_RADIUS_M) {
        this._pickUpFlag(player, enemyTeam, enemyBase);
        return;
      }
    }

    // Capture: carrying enemy flag and touching own base
    if (enemyFlag.carrierId === player.id && ownBase) {
      const dist = haversineMeters(player.lat, player.lng, ownBase.lat, ownBase.lng);
      if (dist <= BASE_RADIUS_M) {
        this._captureFlag(player, enemyTeam, enemyBase);
        return;
      }
    }

    // Return own flag if it was dropped
    if (ownFlag.state === FLAG_STATE.DROPPED && ownFlag.lat !== null) {
      const dist = haversineMeters(player.lat, player.lng, ownFlag.lat, ownFlag.lng);
      if (dist <= FLAG_INTERACT_RADIUS_M) {
        this._returnFlag(player, ownTeam, ownBase);
      }
    }
  }

  _pickUpFlag(player, flagTeam, _base) {
    const flag = this._flags[flagTeam];
    flag.state = FLAG_STATE.CARRIED;
    flag.carrierId = player.id;
    this.killFeed.push({
      at: Date.now(),
      shooterName: player.username,
      victimName: `${flagTeam} flag`,
      event: 'pickup',
    });
    this._broadcastCTFState();
  }

  _captureFlag(player, flagTeam, enemyBase) {
    const flag = this._flags[flagTeam];
    const scoringTeam = player.team;

    this._captures[scoringTeam]++;
    flag.state = FLAG_STATE.AT_BASE;
    flag.carrierId = null;
    flag.lat = enemyBase?.lat ?? null;
    flag.lng = enemyBase?.lng ?? null;

    this.killFeed.push({
      at: Date.now(),
      shooterName: player.username,
      victimName: `${flagTeam} flag`,
      event: 'capture',
    });

    this._broadcastCTFState();

    if (this._captures[scoringTeam] >= (this.config.scoreLimit ?? Infinity)) {
      this._end();
    }
  }

  _returnFlag(player, flagTeam, ownBase) {
    const flag = this._flags[flagTeam];
    flag.state = FLAG_STATE.AT_BASE;
    flag.carrierId = null;
    flag.lat = ownBase?.lat ?? null;
    flag.lng = ownBase?.lng ?? null;

    this.killFeed.push({
      at: Date.now(),
      shooterName: player.username,
      victimName: `${flagTeam} flag`,
      event: 'returned',
    });

    this._broadcastCTFState();
  }

  // Override: drop flag on death and use location-based respawn
  _killPlayer(victim, killer) {
    this._dropFlagOf(victim);

    const credited = killer && killer.id !== victim.id;
    victim.deaths++;
    victim.isAlive = false;
    this._deathTimes.set(victim.id, Date.now());
    if (credited) killer.kills++;
    this.killFeed.push({
      at: Date.now(),
      shooterName: credited ? killer.username : 'Airstrike',
      victimName: victim.username,
    });

    this.broadcast({
      type: S2C.PLAYER_DEAD,
      playerId: victim.id,
      username: victim.username,
      killerId: credited ? killer.id : null,
      killerName: credited ? killer.username : null,
      respawnIn: null, // CTF: no timer — player walks to base to respawn
      lat: victim.lat,
      lng: victim.lng,
    });

    // No respawn timer — location-based respawn handled by onPositionUpdate
  }

  _dropFlagOf(player) {
    for (const team of [TEAMS.RED, TEAMS.BLUE]) {
      const flag = this._flags[team];
      if (flag.carrierId === player.id) {
        flag.state = FLAG_STATE.DROPPED;
        flag.lat = player.lat ?? flag.lat;
        flag.lng = player.lng ?? flag.lng;
        flag.carrierId = null;
        this._broadcastCTFState();
        break;
      }
    }
  }

  _respawnAtBase(player) {
    player.hp = player.maxHp;
    player.isAlive = true;
    this.broadcast({
      type: S2C.PLAYER_RESPAWN,
      playerId: player.id,
      hp: player.hp,
      maxHp: player.maxHp,
    });
  }

  _tick() {
    this._tryStartPowerups();

    // Keep carried flag positions in sync with carrier location
    for (const team of [TEAMS.RED, TEAMS.BLUE]) {
      const flag = this._flags[team];
      if (flag.state === FLAG_STATE.CARRIED && flag.carrierId) {
        const carrier = this.players.get(flag.carrierId);
        if (carrier?.lat !== null) {
          flag.lat = carrier.lat;
          flag.lng = carrier.lng;
        }
      }
    }

    const remaining = Math.max(0, this._endAt - Date.now());
    this.broadcast({
      type: S2C.GAME_STATE,
      scores: this._buildScores(),
      timeRemaining: Math.ceil(remaining / 1_000),
      killFeed: this.killFeed.slice(-10),
      ctfState: this._ctfPayload(),
    });

    if (remaining === 0) {
      this._end();
    }
  }

  _broadcastCTFState() {
    this.broadcast({
      type: S2C.GAME_STATE,
      scores: this._buildScores(),
      timeRemaining: null,
      killFeed: this.killFeed.slice(-10),
      ctfState: this._ctfPayload(),
    });
  }

  _ctfPayload() {
    return {
      flags: {
        [TEAMS.RED]: { ...this._flags[TEAMS.RED] },
        [TEAMS.BLUE]: { ...this._flags[TEAMS.BLUE] },
      },
      captures: { ...this._captures },
      bases: {
        [TEAMS.RED]: this._redBase,
        [TEAMS.BLUE]: this._blueBase,
      },
    };
  }

  _teamKills(team) {
    return [...this.players.values()]
      .filter(p => p.team === team)
      .reduce((sum, p) => sum + p.kills, 0);
  }

  _buildScores() {
    return [TEAMS.RED, TEAMS.BLUE].map(team => ({
      team,
      captures: this._captures[team],
      kills: this._teamKills(team),
      players: [...this.players.values()]
        .filter(p => p.team === team)
        .map(p => {
          const enemyTeam = p.team === TEAMS.RED ? TEAMS.BLUE : TEAMS.RED;
          return {
            id: p.id,
            username: p.username,
            kills: p.kills,
            deaths: p.deaths,
            hp: p.hp,
            maxHp: p.maxHp,
            isAlive: p.isAlive,
            hasFlag: this._flags[enemyTeam].carrierId === p.id,
          };
        }),
    })).sort((a, b) => b.captures - a.captures || b.kills - a.kills);
  }

  _determineWinner() {
    const red = this._captures[TEAMS.RED];
    const blue = this._captures[TEAMS.BLUE];
    if (red > blue) return TEAMS.RED;
    if (blue > red) return TEAMS.BLUE;
    return 'draw';
  }

  _checkWinCondition(_scorer, _limit) {
    // Win condition is checked explicitly in _captureFlag; nothing to do here.
    return false;
  }
}
