import { create } from 'zustand';
import { GAME_STATES, GAME_MODES, TEAMS } from 'shared/messages.js';

export type Screen = 'setup' | 'roomselect' | 'lobby' | 'ingame' | 'end';
export type GameState = (typeof GAME_STATES)[keyof typeof GAME_STATES];
export type Team = (typeof TEAMS)[keyof typeof TEAMS];

export interface PlayerInfo {
  id: number;
  username: string;
  team: Team;
  ready: boolean;
  kills: number;
  deaths: number;
  hits?: number;
  timesHit?: number;
  hp?: number;
  maxHp?: number;
  isAlive?: boolean;
}

export interface ScoreEntry {
  id: number;
  username: string;
  team: Team;
  kills: number;
  deaths: number;
  hits?: number;
  timesHit?: number;
  hp?: number;
  maxHp?: number;
  isAlive?: boolean;
  players?: ScoreEntry[]; // present on TDM team rows
}

export interface KillFeedEntry {
  at: number;
  shooterName: string;
  victimName: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type GameArea =
  | { type: 'circle'; lat: number; lng: number; radiusM: number }
  | { type: 'polygon'; points: LatLng[] };

export interface DomZoneSpot {
  id: string;
  lat: number;
  lng: number;
}

// ── Live game-mode state (mirrors the web client's stores/game.js shapes) ──────
export interface FlagState {
  state: string; // 'base' | 'carried' | 'dropped'
  lat: number | null;
  lng: number | null;
  carrierId?: number | null;
}

export interface CtfState {
  flags?: { red: FlagState | null; blue: FlagState | null };
  captures?: { red: number; blue: number };
  bases?: { red: LatLng | null; blue: LatLng | null };
}

export interface ImmunityState {
  hasImmunity?: boolean;
  gracePeriodUntil?: number;
}

export interface InfectionState {
  infectedIds: number[];
  immunePlayers?: Record<number, ImmunityState>;
}

export interface DomZone {
  id: string;
  lat: number | null;
  lng: number | null;
  owner: string; // 'red' | 'blue' | 'neutral'
  controlValue?: number;
  capturingTeam?: string | null;
  contested?: boolean;
}

export interface DominationState {
  zones: DomZone[];
  teamPoints?: { red: number; blue: number };
}

export interface GameConfig {
  mode: string;
  timeLimit: number;
  scoreLimit: number;
  friendlyFire?: boolean;
  bulletsPerMag?: number;
  hpPerPlayer?: number;
  reloadDelaySecs?: number;
  respawnDelaySecs?: number;
  // Optional play-area boundary (circle or polygon), or null for no limit.
  gameArea?: GameArea | null;
  // Capture the Flag — team base / flag spawn locations.
  redBase?: LatLng | null;
  blueBase?: LatLng | null;
  // Domination — placed control-point zones plus tuning.
  domZones?: DomZoneSpot[];
  dominationTickSecs?: number;
  deathstreakEnabled?: boolean;
  deathstreakCount?: number;
}

export interface RoomInfo {
  id: number;
  name: string;
  playerCount: number;
  state: GameState;
}

interface GameStore {
  screen: Screen;
  myId: number | null;
  isHost: boolean;
  username: string;
  gameState: GameState;
  gameConfig: GameConfig;
  players: PlayerInfo[];
  hostId: number | null;
  scores: ScoreEntry[];
  timeRemaining: number;
  killFeed: KillFeedEntry[];
  countdownAt: number | null;
  finalScores: ScoreEntry[] | null;
  winner: string | null;
  gameId: string | null;
  roundId: string | null;
  isReconnecting: boolean;
  ammo: number;
  maxAmmo: number;
  isReloading: boolean;
  shieldActive: boolean;
  shieldCountdown: number | null;
  stealthActive: boolean;
  stealthCountdown: number | null;
  fastReloadActive: boolean;
  fastReloadCountdown: number | null;
  radarActive: boolean;
  radarCountdown: number | null;
  airstrikeReady: number;
  airstrikeArmed: boolean;
  airstrikePreview: { lat: number; lng: number } | null;
  apacheReady: number;
  apacheArmed: boolean;
  apachePreview: { lat: number; lng: number } | null;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  respawnCountdown: number | null;
  killedBy: string | null;
  lastHitAt: number | null;
  lastShotHitAt: number | null;
  bulletsPerMag: number;
  reloadDelaySecs: number;
  bleConnected: boolean;
  // null until the server assigns a slot in GAME_STARTED. Never default to a
  // real slot (0): that is the host's slot, and assuming it makes hits between
  // this player and the host resolve as self-hits the server drops.
  gunSlotId: number | null;
  // Live game-mode state, set from GAME_STATE ticks (null when not in that mode).
  ctfState: CtfState | null;
  infectionState: InfectionState | null;
  dominationState: DominationState | null;
  // Optional play-area boundary, mirrored out of gameConfig for the map/HUD.
  gameArea: GameArea | null;
  // Current fire mode (a key of GUN_MODES). Updated by the on-screen toggle and
  // by the gun's power button, read by the in-game HUD.
  activeGunMode: 'semi' | 'burst' | 'auto' | 'plasma';
  rooms: RoomInfo[];
  roomName: string;

  setScreen: (s: Screen) => void;
  setMyId: (id: number | null) => void;
  setIsHost: (v: boolean) => void;
  setUsername: (name: string) => void;
  setGameState: (s: GameState) => void;
  setGameConfig: (cfg: Partial<GameConfig>) => void;
  setPlayers: (p: PlayerInfo[]) => void;
  setHostId: (id: number | null) => void;
  setScores: (s: ScoreEntry[]) => void;
  setTimeRemaining: (t: number) => void;
  setKillFeed: (kf: KillFeedEntry[]) => void;
  setCountdownAt: (t: number | null) => void;
  setFinalScores: (s: ScoreEntry[] | null) => void;
  setWinner: (w: string | null) => void;
  setGameId: (id: string | null) => void;
  setRoundId: (id: string | null) => void;
  setIsReconnecting: (v: boolean) => void;
  setAmmo: (n: number) => void;
  setMaxAmmo: (n: number) => void;
  setIsReloading: (v: boolean) => void;
  setShieldActive: (v: boolean) => void;
  setShieldCountdown: (n: number | null) => void;
  setStealthActive: (v: boolean) => void;
  setStealthCountdown: (n: number | null) => void;
  setFastReloadActive: (v: boolean) => void;
  setFastReloadCountdown: (n: number | null) => void;
  setRadarActive: (v: boolean) => void;
  setRadarCountdown: (n: number | null) => void;
  setAirstrikeReady: (n: number) => void;
  setAirstrikeArmed: (v: boolean) => void;
  setAirstrikePreview: (pos: { lat: number; lng: number } | null) => void;
  setApacheReady: (n: number) => void;
  setApacheArmed: (v: boolean) => void;
  setApachePreview: (pos: { lat: number; lng: number } | null) => void;
  setHp: (n: number) => void;
  setMaxHp: (n: number) => void;
  setIsAlive: (v: boolean) => void;
  setRespawnCountdown: (n: number | null) => void;
  setKilledBy: (name: string | null) => void;
  setLastHitAt: (t: number | null) => void;
  setLastShotHitAt: (t: number | null) => void;
  setBulletsPerMag: (n: number) => void;
  setReloadDelaySecs: (n: number) => void;
  setBleConnected: (v: boolean) => void;
  setGunSlotId: (id: number | null) => void;
  setCtfState: (s: CtfState | null) => void;
  setInfectionState: (s: InfectionState | null) => void;
  setDominationState: (s: DominationState | null) => void;
  setGameArea: (a: GameArea | null) => void;
  setActiveGunMode: (m: 'semi' | 'burst' | 'auto' | 'plasma') => void;
  setRooms: (r: RoomInfo[]) => void;
  setRoomName: (name: string) => void;
  resetGame: () => void;
}

export const useGameStore = create<GameStore>((set, _get) => ({
  screen: 'setup',
  myId: null,
  isHost: false,
  username: '',
  gameState: GAME_STATES.WAITING,
  gameConfig: {
    mode: GAME_MODES.FFA,
    timeLimit: 15,
    scoreLimit: 5,
    friendlyFire: false,
    bulletsPerMag: 30,
    hpPerPlayer: 100,
    reloadDelaySecs: 3,
    respawnDelaySecs: 10,
    gameArea: null,
    redBase: null,
    blueBase: null,
    domZones: [],
    dominationTickSecs: 2,
    deathstreakEnabled: false,
    deathstreakCount: 3,
  },
  players: [],
  hostId: null,
  scores: [],
  timeRemaining: 0,
  killFeed: [],
  countdownAt: null,
  finalScores: null,
  winner: null,
  gameId: null,
  roundId: null,
  isReconnecting: false,
  ammo: 30,
  maxAmmo: 30,
  isReloading: false,
  shieldActive: false,
  shieldCountdown: null,
  stealthActive: false,
  stealthCountdown: null,
  fastReloadActive: false,
  fastReloadCountdown: null,
  radarActive: false,
  radarCountdown: null,
  airstrikeReady: 0,
  airstrikeArmed: false,
  airstrikePreview: null,
  apacheReady: 0,
  apacheArmed: false,
  apachePreview: null,
  hp: 100,
  maxHp: 100,
  isAlive: true,
  respawnCountdown: null,
  killedBy: null,
  lastHitAt: null,
  lastShotHitAt: null,
  bulletsPerMag: 30,
  reloadDelaySecs: 3,
  bleConnected: false,
  gunSlotId: null,
  ctfState: null,
  infectionState: null,
  dominationState: null,
  gameArea: null,
  activeGunMode: 'auto',
  rooms: [],
  roomName: '',

  setScreen: s => set({ screen: s }),
  setMyId: id => set({ myId: id }),
  setIsHost: v => set({ isHost: v }),
  setUsername: name => set({ username: name }),
  setGameState: s => set({ gameState: s }),
  setGameConfig: cfg =>
    set(state => ({ gameConfig: { ...state.gameConfig, ...cfg } })),
  setPlayers: p => set({ players: p }),
  setHostId: id => set({ hostId: id }),
  setScores: s => set({ scores: s }),
  setTimeRemaining: t => set({ timeRemaining: t }),
  setKillFeed: kf => set({ killFeed: kf }),
  setCountdownAt: t => set({ countdownAt: t }),
  setFinalScores: s => set({ finalScores: s }),
  setWinner: w => set({ winner: w }),
  setGameId: id => set({ gameId: id }),
  setRoundId: id => set({ roundId: id }),
  setIsReconnecting: v => set({ isReconnecting: v }),
  setAmmo: n => set({ ammo: n }),
  setMaxAmmo: n => set({ maxAmmo: n }),
  setIsReloading: v => set({ isReloading: v }),
  setShieldActive: v => set({ shieldActive: v }),
  setShieldCountdown: n => set({ shieldCountdown: n }),
  setStealthActive: v => set({ stealthActive: v }),
  setStealthCountdown: n => set({ stealthCountdown: n }),
  setFastReloadActive: v => set({ fastReloadActive: v }),
  setFastReloadCountdown: n => set({ fastReloadCountdown: n }),
  setRadarActive: v => set({ radarActive: v }),
  setRadarCountdown: n => set({ radarCountdown: n }),
  setAirstrikeReady: n => set({ airstrikeReady: n }),
  setAirstrikeArmed: v => set({ airstrikeArmed: v }),
  setAirstrikePreview: pos => set({ airstrikePreview: pos }),
  setApacheReady: n => set({ apacheReady: n }),
  setApacheArmed: v => set({ apacheArmed: v }),
  setApachePreview: pos => set({ apachePreview: pos }),
  setHp: n => set({ hp: n }),
  setMaxHp: n => set({ maxHp: n }),
  setIsAlive: v => set({ isAlive: v }),
  setRespawnCountdown: n => set({ respawnCountdown: n }),
  setKilledBy: name => set({ killedBy: name }),
  setLastHitAt: t => set({ lastHitAt: t }),
  setLastShotHitAt: t => set({ lastShotHitAt: t }),
  setBulletsPerMag: n => set({ bulletsPerMag: n }),
  setReloadDelaySecs: n => set({ reloadDelaySecs: n }),
  setBleConnected: v => set({ bleConnected: v }),
  setGunSlotId: id => set({ gunSlotId: id }),
  setCtfState: s => set({ ctfState: s }),
  setInfectionState: s => set({ infectionState: s }),
  setDominationState: s => set({ dominationState: s }),
  setGameArea: a => set({ gameArea: a }),
  setActiveGunMode: m => set({ activeGunMode: m }),
  setRooms: r => set({ rooms: r }),
  setRoomName: name => set({ roomName: name }),

  resetGame: () =>
    set({
      scores: [],
      timeRemaining: 0,
      killFeed: [],
      countdownAt: null,
      finalScores: null,
      winner: null,
      ammo: 30,
      isReloading: false,
      shieldActive: false,
      shieldCountdown: null,
      stealthActive: false,
      stealthCountdown: null,
      fastReloadActive: false,
      fastReloadCountdown: null,
      radarActive: false,
      radarCountdown: null,
      airstrikeReady: 0,
      airstrikeArmed: false,
      airstrikePreview: null,
      apacheReady: 0,
      apacheArmed: false,
      apachePreview: null,
      isAlive: true,
      respawnCountdown: null,
      killedBy: null,
      lastHitAt: null,
      lastShotHitAt: null,
      ctfState: null,
      infectionState: null,
      dominationState: null,
    }),

}));

// ── Session persistence ───────────────────────────────────────────────────────
// These are module-level helpers, not store state, to avoid async return-type
// issues with Zustand's type inference.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const saveSession = (name: string, playerId?: number | null) => {
  AsyncStorage.setItem('mecoil_username', name);
  if (playerId != null) {
    AsyncStorage.setItem('mecoil_player_id', String(playerId));
  }
};

export const loadSession = (): Promise<string | null> =>
  AsyncStorage.getItem('mecoil_username');

export const clearStoredPlayerId = () =>
  AsyncStorage.removeItem('mecoil_player_id');

export const saveServerUrl = (url: string) =>
  AsyncStorage.setItem('mecoil_server', url);

export const loadServerUrl = (): Promise<string | null> =>
  AsyncStorage.getItem('mecoil_server');

export const saveMapStyle = (style: string) =>
  AsyncStorage.setItem('mecoil_map_style', style);

export const loadMapStyle = (): Promise<string | null> =>
  AsyncStorage.getItem('mecoil_map_style');
