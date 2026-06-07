import { writable, derived } from 'svelte/store';
import { GAME_STATES, GAME_MODES } from '../../../shared/messages.js';

export const screen = writable('setup'); // 'setup' | 'lobby' | 'ingame' | 'end'
export const isReconnecting = writable(false); // true while auto-reconnect is in progress

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
export const shieldCountdown = writable(null); // seconds remaining while shield is active
export const stealthActive = writable(false);
export const stealthCountdown = writable(null); // seconds remaining while stealth is active
export const fastReloadActive = writable(false);
export const fastReloadCountdown = writable(null); // seconds remaining while fast reload is active
export const radarActive = writable(false);     // enemies revealed on my map
export const airstrikeReady = writable(0);       // held airstrikes available to deploy
export const airstrikeArmed = writable(false);   // armed: next map tap places a preview circle
export const airstrikePreview = writable(null);  // { lat, lng } pending confirmation, or null

// Health / respawn state (host-tunable, set from GAME_STARTED)
export const hp = writable(100);
export const maxHp = writable(100);
export const isAlive = writable(true);
export const respawnCountdown = writable(null); // seconds left while dead, else null
export const killedBy = writable(null);         // username of last killer, null when alive
export const lastHitAt = writable(null);        // timestamp of last damage hit (for flash)
export const lastShotHitAt = writable(null);    // timestamp of last confirmed outgoing hit (for HIT indicator)

// Host-tunable gameplay settings consumed by the gun/simulator
export const bulletsPerMag = writable(30);
export const reloadDelaySecs = writable(3);

// BLE connection state — persists across game resets
export const bleConnected = writable(false);
export const gunSlotId = writable(0);
export const activeGunMode = writable('auto'); // key of GUN_MODES; updated by BLE and on-screen toggle

// CTF mode state
export const ctfState = writable(null); // { flags: { red, blue }, captures: { red, blue }, bases: { red, blue } }

// Infection mode state
export const infectionState = writable(null); // { infectedIds: [], immunePlayers: {} }

// Optional play area boundary — null | { type:'circle', lat, lng, radiusM } | { type:'polygon', points:[{lat,lng}] }
export const gameArea = writable(null);

// Multi-room state
export const rooms = writable([]);     // [{ id, name, playerCount, state }]
export const roomName = writable('');

export const myPlayer = derived([players, myId], ([$players, $myId]) =>
  $players.find(p => p.id === $myId) ?? null
);

// My live score entry, resolved across FFA (flat) and TDM/CTF/Infection (nested teams) shapes.
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

// True when the local player is infected (Infection mode only)
export const amIInfected = derived([gameConfig, infectionState, myId], ([$gameConfig, $infectionState, $myId]) => {
  if ($gameConfig?.mode !== GAME_MODES.INFECTION) return false;
  if (!$infectionState) return false;
  return $infectionState.infectedIds.includes($myId);
});

// True when the local player cannot fire (non-infected in Infection mode)
export const gunLocked = derived([gameConfig, infectionState, myId], ([$gameConfig, $infectionState, $myId]) => {
  if ($gameConfig?.mode !== GAME_MODES.INFECTION) return false;
  if (!$infectionState) return false; // before first tick, allow firing
  return !$infectionState.infectedIds.includes($myId);
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
  shieldCountdown.set(null);
  stealthActive.set(false);
  stealthCountdown.set(null);
  fastReloadActive.set(false);
  fastReloadCountdown.set(null);
  radarActive.set(false);
  airstrikeReady.set(0);
  airstrikeArmed.set(false);
  airstrikePreview.set(null);
  isAlive.set(true);
  respawnCountdown.set(null);
  killedBy.set(null);
  lastHitAt.set(null);
  lastShotHitAt.set(null);
  ctfState.set(null);
  infectionState.set(null);
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
