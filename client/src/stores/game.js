import { writable, derived } from 'svelte/store';
import { GAME_STATES, GAME_MODES, TEAMS } from '../../../shared/messages.js';

export const screen = writable('setup'); // 'setup' | 'lobby' | 'ingame' | 'end'

export const myId = writable(null);
export const isHost = writable(false);
export const username = writable('');

export const gameState = writable(GAME_STATES.WAITING);
export const gameConfig = writable({ mode: GAME_MODES.FFA, timeLimit: 7, scoreLimit: 20 });
export const players = writable([]);
export const hostId = writable(null);
export const scores = writable([]);
export const timeRemaining = writable(0);
export const killFeed = writable([]);
export const countdownAt = writable(null);
export const finalScores = writable(null);
export const winner = writable(null);

export const gameId = writable(null);   // stable for the room's lifetime
export const roundId = writable(null);  // new UUID each game round

// Gun / ammo state (updated by BLE or simulator)
export const ammo = writable(30);
export const maxAmmo = writable(30);
export const isReloading = writable(false);
export const shieldActive = writable(false);
export const stealthActive = writable(false);

// BLE connection state — persists across game resets
export const bleConnected = writable(false);
export const gunSlotId = writable(0);

// Multi-room state
export const rooms = writable([]);     // [{ id, name, playerCount, state }]
export const roomName = writable('');

export const myPlayer = derived([players, myId], ([$players, $myId]) =>
  $players.find(p => p.id === $myId) ?? null
);

export function resetGame() {
  scores.set([]);
  timeRemaining.set(0);
  killFeed.set([]);
  countdownAt.set(null);
  finalScores.set(null);
  winner.set(null);
  ammo.set(30);
  isReloading.set(false);
  shieldActive.set(false);
  stealthActive.set(false);
}

export function saveSession(name) {
  localStorage.setItem('mecoil_username', name);
}

export function loadSession() {
  return localStorage.getItem('mecoil_username');
}

export function clearSession() {
  localStorage.removeItem('mecoil_username');
  username.set('');
  myId.set(null);
  screen.set('setup');
}
