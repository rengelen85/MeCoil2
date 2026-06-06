import { writable, derived } from 'svelte/store';
import { GAME_STATES, GAME_MODES, TEAMS } from '../../../shared/messages.js';

export const screen = writable('setup'); // 'setup' | 'lobby' | 'ingame' | 'end'

export const myId = writable(null);
export const isHost = writable(false);
export const username = writable('');

export const gameState = writable(GAME_STATES.WAITING);
export const gameConfig = writable({
  mode: GAME_MODES.FFA,
  timeLimit: 7,
  scoreLimit: 20,
  bulletsPerMag: 30,
  hpPerPlayer: 100,
  reloadDelaySecs: 3,
  respawnDelaySecs: 10,
});
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
export const radarActive = writable(false);     // enemies revealed on my map
export const airstrikeReady = writable(0);       // held airstrikes available to deploy
export const airstrikeArmed = writable(false);   // armed: next map tap calls the strike

// Health / respawn state (host-tunable, set from GAME_STARTED)
export const hp = writable(100);
export const maxHp = writable(100);
export const isAlive = writable(true);
export const respawnCountdown = writable(null); // seconds left while dead, else null
export const killedBy = writable(null);         // username of last killer, null when alive
export const lastHitAt = writable(null);        // timestamp of last damage hit (for flash)

// Host-tunable gameplay settings consumed by the gun/simulator
export const bulletsPerMag = writable(30);
export const reloadDelaySecs = writable(3);

// BLE connection state — persists across game resets
export const bleConnected = writable(false);
export const gunSlotId = writable(0);

// Multi-room state
export const rooms = writable([]);     // [{ id, name, playerCount, state }]
export const roomName = writable('');

export const myPlayer = derived([players, myId], ([$players, $myId]) =>
  $players.find(p => p.id === $myId) ?? null
);

// My live score entry, resolved across FFA (flat) and TDM (nested teams) shapes.
export const myScore = derived([scores, myId], ([$scores, $myId]) => {
  for (const entry of $scores) {
    if (entry.players) {
      const found = entry.players.find(p => p.id === $myId);
      if (found) return found;
    } else if (entry.id === $myId) {
      return entry;
    }
  }
  return null;
});

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
  radarActive.set(false);
  airstrikeReady.set(0);
  airstrikeArmed.set(false);
  isAlive.set(true);
  respawnCountdown.set(null);
  killedBy.set(null);
  lastHitAt.set(null);
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
