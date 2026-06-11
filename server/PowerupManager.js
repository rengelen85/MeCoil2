import { POWERUP_TYPES } from '../shared/messages.js';

const POWERUP_INTERVAL_MS = 30_000;
const COLLECTION_RADIUS_M = 15;
const SPAWN_RADIUS_M = 100;
const ALL_STANDARD_TYPES = Object.values(POWERUP_TYPES).filter(
  (t) => t !== POWERUP_TYPES.IMMUNITY,
);

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

function isInPolygon(lat, lng, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng,
      yi = points[i].lat;
    const xj = points[j].lng,
      yj = points[j].lat;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function randomSpawnPoint(centerLat, centerLng, gameArea) {
  if (gameArea?.type === 'circle') {
    const r = Math.random() * gameArea.radiusM;
    const { dLat, dLng } = randomOffset(r);
    return { lat: gameArea.lat + dLat, lng: gameArea.lng + dLng };
  }
  if (gameArea?.type === 'polygon' && gameArea.points.length >= 3) {
    const lats = gameArea.points.map((p) => p.lat);
    const lngs = gameArea.points.map((p) => p.lng);
    const minLat = Math.min(...lats),
      maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs),
      maxLng = Math.max(...lngs);
    // Rejection sampling: pick random point in bounding box, retry if outside polygon
    for (let attempt = 0; attempt < 50; attempt++) {
      const lat = minLat + Math.random() * (maxLat - minLat);
      const lng = minLng + Math.random() * (maxLng - minLng);
      if (isInPolygon(lat, lng, gameArea.points)) return { lat, lng };
    }
    // Fallback to centroid if sampling keeps missing (very thin/concave polygon)
    return {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
    };
  }
  // No area set: use the first-player center with a 100m radius
  const { dLat, dLng } = randomOffset(Math.random() * SPAWN_RADIUS_M);
  return { lat: centerLat + dLat, lng: centerLng + dLng };
}

export class PowerupManager {
  constructor(onUpdate) {
    this.packages = new Map();
    this.onUpdate = onUpdate;
    this._timer = null;
    this._centerLat = null;
    this._centerLng = null;
  }

  start(centerLat, centerLng, allowedTypes = null, gameArea = null) {
    this._centerLat = centerLat;
    this._centerLng = centerLng;
    this._allowedTypes = allowedTypes ?? ALL_STANDARD_TYPES;
    this._gameArea = gameArea;
    this._spawn();
    this._timer = setInterval(() => this._spawn(), POWERUP_INTERVAL_MS);
  }

  stop() {
    clearInterval(this._timer);
    this.packages.clear();
  }

  _spawn() {
    if (this._centerLat === null) return;
    const { lat, lng } = randomSpawnPoint(
      this._centerLat,
      this._centerLng,
      this._gameArea,
    );
    const types = this._allowedTypes ?? ALL_STANDARD_TYPES;
    const pkg = {
      id: nextId++,
      lat,
      lng,
      type: types[Math.floor(Math.random() * types.length)],
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
