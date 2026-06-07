import { TEAMS } from './shared/messages.js';

let nextId = 1;

export class Player {
  constructor(ws, username) {
    this.id = nextId++;
    this.ws = ws;
    this.username = username;
    this.team = TEAMS.NONE;
    this.ready = false;
    this.gunSlotId = null;

    // Game state (reset each match)
    this.kills = 0;
    this.deaths = 0;
    this.hits = 0;        // shots that landed on an enemy
    this.timesHit = 0;    // shots that landed on this player
    this.ammo = 0;
    this.stealthUntil = 0;
    this.radarUntil = 0;        // sees all enemies until this timestamp
    this.shieldUntil = 0;       // damage is halved until this timestamp
    this.airstrikesAvailable = 0; // held airstrikes ready to deploy

    // Health / respawn
    this.maxHp = 100;
    this.hp = 100;
    this.isAlive = true;
    this.respawnTimer = null;

    // Map state
    this.lat = null;
    this.lng = null;
    this.lastFireAt = 0;
    this.lastFireMode = null; // gun mode of the most recent shot (drives hit damage)
    this.lastFireAmmo = 0;    // rounds loaded when the most recent shot fired (plasma damage)
  }

  send(obj) {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  resetForGame(maxHp = 100) {
    this.kills = 0;
    this.deaths = 0;
    this.hits = 0;
    this.timesHit = 0;
    this.ammo = 0;
    this.stealthUntil = 0;
    this.radarUntil = 0;
    this.shieldUntil = 0;
    this.airstrikesAvailable = 0;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.isAlive = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    this.lastFireAt = 0;
    this.lastFireMode = null;
    this.lastFireAmmo = 0;
  }

  toPublic() {
    return {
      id: this.id,
      username: this.username,
      team: this.team,
      ready: this.ready,
      kills: this.kills,
      deaths: this.deaths,
      hits: this.hits,
      timesHit: this.timesHit,
      hp: this.hp,
      maxHp: this.maxHp,
      isAlive: this.isAlive,
    };
  }
}
