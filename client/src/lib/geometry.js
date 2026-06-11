const EARTH_R = 6_371_000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Ray-casting point-in-polygon. Works directly on lat/lng coordinates since
// we're dealing with small areas where Cartesian approximation is fine.
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

// Returns true if lat/lng is within the given area, or if area is null/undefined.
export function isInArea(lat, lng, area) {
  if (!area) return true;
  if (area.type === 'circle') {
    return haversineMeters(lat, lng, area.lat, area.lng) <= area.radiusM;
  }
  if (area.type === 'polygon') {
    return isInPolygon(lat, lng, area.points);
  }
  return true;
}
