import { writable } from 'svelte/store';

export const myPosition = writable(null); // { lat, lng }
export const teammates = writable([]);    // [{ id, username, lat, lng }]
export const firingEnemies = writable([]); // [{ id, lat, lng }]
export const powerups = writable([]);     // [{ id, lat, lng, type }]
export const airstrikes = writable([]);   // [{ id, lat, lng, radius, detonateAt }] inbound strikes
export const gpsError = writable(null);
export const heading = writable(null);    // degrees clockwise from North, null if unavailable

let watchId = null;
let _headingCleanup = null;

export function startGPS(onPosition) {
  if (!navigator.geolocation) {
    gpsError.set('Geolocation not supported');
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      myPosition.set({ lat, lng });
      onPosition(lat, lng);
    },
    err => gpsError.set(err.message),
    { enableHighAccuracy: true, maximumAge: 1000 }
  );
}

export function stopGPS() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

export function startHeading() {
  if (_headingCleanup) return;

  function onOrientation(e) {
    if (e.webkitCompassHeading != null) {
      // iOS: already degrees clockwise from North
      heading.set(e.webkitCompassHeading);
    } else if (e.alpha != null) {
      // Android absolute: alpha is counterclockwise from North
      heading.set((360 - e.alpha) % 360);
    }
  }

  // Android Chrome 83+ exposes absolute compass via this event
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', onOrientation);
    _headingCleanup = () => window.removeEventListener('deviceorientationabsolute', onOrientation);
  } else {
    // iOS uses standard deviceorientation with webkitCompassHeading
    window.addEventListener('deviceorientation', onOrientation);
    _headingCleanup = () => window.removeEventListener('deviceorientation', onOrientation);
  }
}

export function stopHeading() {
  _headingCleanup?.();
  _headingCleanup = null;
  heading.set(null);
}
