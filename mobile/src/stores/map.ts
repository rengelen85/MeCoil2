import { create } from 'zustand';
import Geolocation from '@react-native-community/geolocation';
import CompassHeading from 'react-native-compass-heading';

export interface Position {
  lat: number;
  lng: number;
}

export interface PlayerPosition extends Position {
  id: number;
  username?: string;
}

export interface PowerupPosition extends Position {
  id: number;
  type: string;
}

interface MapStore {
  myPosition: Position | null;
  teammates: PlayerPosition[];
  firingEnemies: PlayerPosition[];
  powerups: PowerupPosition[];
  gpsError: string | null;
  heading: number | null;

  setMyPosition: (pos: Position | null) => void;
  setTeammates: (t: PlayerPosition[]) => void;
  setFiringEnemies: (e: PlayerPosition[]) => void;
  setPowerups: (p: PowerupPosition[]) => void;
  setGpsError: (err: string | null) => void;
  setHeading: (h: number | null) => void;
  startGPS: (onPosition: (lat: number, lng: number) => void) => void;
  stopGPS: () => void;
  startHeading: () => void;
  stopHeading: () => void;
}

let _watchId: number | null = null;
let _headingStarted = false;

export const useMapStore = create<MapStore>((set, _get) => ({
  myPosition: null,
  teammates: [],
  firingEnemies: [],
  powerups: [],
  gpsError: null,
  heading: null,

  setMyPosition: pos => set({ myPosition: pos }),
  setTeammates: t => set({ teammates: t }),
  setFiringEnemies: e => set({ firingEnemies: e }),
  setPowerups: p => set({ powerups: p }),
  setGpsError: err => set({ gpsError: err }),
  setHeading: h => set({ heading: h }),

  startGPS: onPosition => {
    if (_watchId !== null) return;
    Geolocation.requestAuthorization();
    _watchId = Geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        set({ myPosition: { lat, lng } });
        onPosition(lat, lng);
      },
      err => set({ gpsError: err.message }),
      { enableHighAccuracy: true, distanceFilter: 1 },
    );
  },

  stopGPS: () => {
    if (_watchId !== null) {
      Geolocation.clearWatch(_watchId);
      _watchId = null;
    }
  },

  startHeading: () => {
    if (_headingStarted) return;
    _headingStarted = true;
    CompassHeading.start(3, ({ heading }) => {
      set({ heading });
    });
  },

  stopHeading: () => {
    if (!_headingStarted) return;
    _headingStarted = false;
    CompassHeading.stop();
    set({ heading: null });
  },
}));
