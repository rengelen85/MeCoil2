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

// Gun / ammo state (updated by BLE or simulator)
export const ammo = writable(30);
export const maxAmmo = writable(30);
export const isReloading = writable(false);
export const shieldActive = writable(false);
export const stealthActive = writable(false);

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
