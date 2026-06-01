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
    this.ammo = 0;
    this.shieldHits = 0;
    this.stealthUntil = 0;

    // Map state
    this.lat = null;
    this.lng = null;
    this.lastFireAt = 0;
  }

  send(obj) {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  resetForGame() {
    this.kills = 0;
    this.deaths = 0;
    this.ammo = 0;
    this.shieldHits = 0;
    this.stealthUntil = 0;
    this.lastFireAt = 0;
  }

  toPublic() {
    return {
      id: this.id,
      username: this.username,
      team: this.team,
      ready: this.ready,
      kills: this.kills,
      deaths: this.deaths,
    };
  }
}
