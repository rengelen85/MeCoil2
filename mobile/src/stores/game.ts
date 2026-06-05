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

export interface GameConfig {
  mode: string;
  timeLimit: number;
  scoreLimit: number;
  friendlyFire?: boolean;
  bulletsPerMag?: number;
  hpPerPlayer?: number;
  hpCostPerHit?: number;
  reloadDelaySecs?: number;
  respawnDelaySecs?: number;
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
  ammo: number;
  maxAmmo: number;
  isReloading: boolean;
  shieldActive: boolean;
  stealthActive: boolean;
  radarActive: boolean;
  airstrikeReady: number;
  airstrikeArmed: boolean;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  respawnCountdown: number | null;
  bulletsPerMag: number;
  reloadDelaySecs: number;
  bleConnected: boolean;
  gunSlotId: number;
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
  setAmmo: (n: number) => void;
  setMaxAmmo: (n: number) => void;
  setIsReloading: (v: boolean) => void;
  setShieldActive: (v: boolean) => void;
  setStealthActive: (v: boolean) => void;
  setRadarActive: (v: boolean) => void;
  setAirstrikeReady: (n: number) => void;
  setAirstrikeArmed: (v: boolean) => void;
  setHp: (n: number) => void;
  setMaxHp: (n: number) => void;
  setIsAlive: (v: boolean) => void;
  setRespawnCountdown: (n: number | null) => void;
  setBulletsPerMag: (n: number) => void;
  setReloadDelaySecs: (n: number) => void;
  setBleConnected: (v: boolean) => void;
  setGunSlotId: (id: number) => void;
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
    timeLimit: 7,
    scoreLimit: 20,
    bulletsPerMag: 30,
    hpPerPlayer: 100,
    hpCostPerHit: 25,
    reloadDelaySecs: 3,
    respawnDelaySecs: 10,
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
  ammo: 30,
  maxAmmo: 30,
  isReloading: false,
  shieldActive: false,
  stealthActive: false,
  radarActive: false,
  airstrikeReady: 0,
  airstrikeArmed: false,
  hp: 100,
  maxHp: 100,
  isAlive: true,
  respawnCountdown: null,
  bulletsPerMag: 30,
  reloadDelaySecs: 3,
  bleConnected: false,
  gunSlotId: 0,
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
  setAmmo: n => set({ ammo: n }),
  setMaxAmmo: n => set({ maxAmmo: n }),
  setIsReloading: v => set({ isReloading: v }),
  setShieldActive: v => set({ shieldActive: v }),
  setStealthActive: v => set({ stealthActive: v }),
  setRadarActive: v => set({ radarActive: v }),
  setAirstrikeReady: n => set({ airstrikeReady: n }),
  setAirstrikeArmed: v => set({ airstrikeArmed: v }),
  setHp: n => set({ hp: n }),
  setMaxHp: n => set({ maxHp: n }),
  setIsAlive: v => set({ isAlive: v }),
  setRespawnCountdown: n => set({ respawnCountdown: n }),
  setBulletsPerMag: n => set({ bulletsPerMag: n }),
  setReloadDelaySecs: n => set({ reloadDelaySecs: n }),
  setBleConnected: v => set({ bleConnected: v }),
  setGunSlotId: id => set({ gunSlotId: id }),
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
      stealthActive: false,
      radarActive: false,
      airstrikeReady: 0,
      airstrikeArmed: false,
      isAlive: true,
      respawnCountdown: null,
    }),

}));

// ── Session persistence ───────────────────────────────────────────────────────
// These are module-level helpers, not store state, to avoid async return-type
// issues with Zustand's type inference.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const saveSession = (name: string) =>
  AsyncStorage.setItem('mecoil_username', name);

export const loadSession = (): Promise<string | null> =>
  AsyncStorage.getItem('mecoil_username');
