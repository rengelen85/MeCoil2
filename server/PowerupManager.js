import { POWERUP_TYPES } from '../shared/messages.js';

const POWERUP_INTERVAL_MS = 30_000;
const COLLECTION_RADIUS_M = 15;
const SPAWN_RADIUS_M = 100;
const ALL_TYPES = Object.values(POWERUP_TYPES);

let nextId = 1;

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

function randomOffset(meters) {
  const deg = meters / 111_320;
  const angle = Math.random() * 2 * Math.PI;
  return { dLat: Math.cos(angle) * deg, dLng: Math.sin(angle) * deg };
}

export class PowerupManager {
  constructor(onUpdate) {
    this.packages = new Map();
    this.onUpdate = onUpdate;
    this._timer = null;
    this._centerLat = null;
    this._centerLng = null;
  }

  start(centerLat, centerLng) {
    this._centerLat = centerLat;
    this._centerLng = centerLng;
    this._spawn();
    this._timer = setInterval(() => this._spawn(), POWERUP_INTERVAL_MS);
  }

  stop() {
    clearInterval(this._timer);
    this.packages.clear();
  }

  _spawn() {
    if (this._centerLat === null) return;
    const { dLat, dLng } = randomOffset(Math.random() * SPAWN_RADIUS_M);
    const pkg = {
      id: nextId++,
      lat: this._centerLat + dLat,
      lng: this._centerLng + dLng,
      type: ALL_TYPES[Math.floor(Math.random() * ALL_TYPES.length)],
    };
    this.packages.set(pkg.id, pkg);
    this.onUpdate();
  }

  // Returns the collected package if within range, null otherwise.
  tryCollect(powerupId, playerLat, playerLng) {
    const pkg = this.packages.get(powerupId);
    if (!pkg) return null;
    const dist = haversineMeters(pkg.lat, pkg.lng, playerLat, playerLng);
    if (dist > COLLECTION_RADIUS_M) return null;
    this.packages.delete(powerupId);
    this.onUpdate();
    return pkg;
  }

  getAll() {
    return [...this.packages.values()];
  }
}
