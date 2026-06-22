import { create } from 'zustand';
import Geolocation from '@react-native-community/geolocation';
import CompassHeading from 'react-native-compass-heading';
import type { FlagState, DomZone } from './game.js';

export interface Position {
  lat: number;
  lng: number;
}

export interface CtfBases {
  red: Position | null;
  blue: Position | null;
}

export interface CtfFlags {
  red: FlagState | null;
  blue: FlagState | null;
}

export interface PlayerPosition extends Position {
  id: number;
  username?: string;
}

export interface PowerupPosition extends Position {
  id: number;
  type: string;
}

export interface AirstrikePosition extends Position {
  id: number;
  radius: number;
  detonateAt: number;
}

export interface ApachePosition extends Position {
  id: number;
  radius: number;
  endsAt: number;
}

export interface GravePosition extends Position {
  id: number;
  username?: string;
}

interface MapStore {
  myPosition: Position | null;
  teammates: PlayerPosition[];
  firingEnemies: PlayerPosition[];
  powerups: PowerupPosition[];
  airstrikes: AirstrikePosition[];
  apaches: ApachePosition[];
  graves: GravePosition[];
  ctfBases: CtfBases;
  ctfFlags: CtfFlags;
  domZones: DomZone[];
  gpsError: string | null;
  heading: number | null;

  setMyPosition: (pos: Position | null) => void;
  setTeammates: (t: PlayerPosition[]) => void;
  setFiringEnemies: (e: PlayerPosition[]) => void;
  setPowerups: (p: PowerupPosition[]) => void;
  setAirstrikes: (a: AirstrikePosition[]) => void;
  setApaches: (a: ApachePosition[]) => void;
  setGraves: (g: GravePosition[]) => void;
  setCtfBases: (b: CtfBases) => void;
  setCtfFlags: (f: CtfFlags) => void;
  setDomZones: (z: DomZone[]) => void;
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
  airstrikes: [],
  apaches: [],
  graves: [],
  ctfBases: { red: null, blue: null },
  ctfFlags: { red: null, blue: null },
  domZones: [],
  gpsError: null,
  heading: null,

  setMyPosition: pos => set({ myPosition: pos }),
  setTeammates: t => set({ teammates: t }),
  setFiringEnemies: e => set({ firingEnemies: e }),
  setPowerups: p => set({ powerups: p }),
  setAirstrikes: a => set({ airstrikes: a }),
  setApaches: a => set({ apaches: a }),
  setGraves: g => set({ graves: g }),
  setCtfBases: b => set({ ctfBases: b }),
  setCtfFlags: f => set({ ctfFlags: f }),
  setDomZones: z => set({ domZones: z }),
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
