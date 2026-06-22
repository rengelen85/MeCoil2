// Geometry helpers for MapLibre. MapLibre works in GeoJSON coordinate order
// [longitude, latitude] and has no built-in metre-radius circle, so we build the
// shapes ourselves.

export type Lng = number;
export type Lat = number;
export type LngLat = [Lng, Lat];

const EARTH_R = 6378137; // metres

/**
 * Approximate a geographic circle (centre + radius in metres) as a GeoJSON
 * polygon so it can be drawn with a Fill/Line layer.
 */
export function circleFeature(
  lat: number,
  lng: number,
  radiusM: number,
  steps = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: LngLat[] = [];
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusM / EARTH_R) * (180 / Math.PI);
  const dLng = dLat / Math.cos(latRad);
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

export function polygonFeature(points: { lat: number; lng: number }[]): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring: LngLat[] = points.map(p => [p.lng, p.lat]);
  if (ring.length > 0) ring.push(ring[0]); // close the ring
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

export function lineFeature(points: { lat: number; lng: number }[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat]) },
  };
}

type LatLngPt = { lat: number; lng: number };
type Area =
  | { type: 'circle'; lat: number; lng: number; radiusM: number }
  | { type: 'polygon'; points: LatLngPt[] };

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Ray-casting point-in-polygon on lat/lng directly — fine for the small areas
// involved. Mirrors client/src/lib/geometry.js.
function isInPolygon(lat: number, lng: number, points: LatLngPt[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng;
    const yi = points[i].lat;
    const xj = points[j].lng;
    const yj = points[j].lat;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True if lat/lng is inside the given play area, or if area is null. */
export function isInArea(lat: number, lng: number, area: Area | null | undefined): boolean {
  if (!area) return true;
  if (area.type === 'circle') {
    return haversineMeters(lat, lng, area.lat, area.lng) <= area.radiusM;
  }
  if (area.type === 'polygon') {
    return isInPolygon(lat, lng, area.points);
  }
  return true;
}

/**
 * Bounding box [west, south, east, north] enclosing all points, or null if none.
 * Matches MapLibre's `LngLatBounds` tuple order.
 */
export function boundsOf(points: { lat: number; lng: number }[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  return [west, south, east, north];
}
