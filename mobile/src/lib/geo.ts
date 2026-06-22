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
