import { writable } from 'svelte/store';

export const myPosition = writable(null); // { lat, lng }
export const teammates = writable([]);    // [{ id, username, lat, lng }]
export const firingEnemies = writable([]); // [{ id, lat, lng }]
export const powerups = writable([]);     // [{ id, lat, lng, type }]
export const gpsError = writable(null);

let watchId = null;

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
