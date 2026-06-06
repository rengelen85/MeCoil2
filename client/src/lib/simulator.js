/**
 * Phase 1 keyboard gun simulator.
 * Keys: T = trigger (fire), R = reload, H = hit received (irEvent), A = ammo +5
 *
 * In Phase 2 this module is replaced by ble.js.
 */
import { sendFire, sendHit } from './network.js';
import { ammo, isReloading, isAlive, maxAmmo, reloadDelaySecs, gunLocked } from '../stores/game.js';
import { get } from 'svelte/store';
import { playReload } from './audio.js';

const FAKE_SHOOTER_WEAPON_ID = 0;

let enabled = false;
let _activeMode = 'auto';

export function setSimulatorMode(mode) {
  _activeMode = mode;
}

export function startSimulator() {
  if (enabled) return;
  enabled = true;
  window.addEventListener('keydown', _onKey);
}

export function stopSimulator() {
  enabled = false;
  window.removeEventListener('keydown', _onKey);
}

function _onKey(e) {
  if (!enabled) return;
  // Ignore keypresses in input fields
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

  switch (e.key.toLowerCase()) {
    case 't': _fire(); break;
    case 'r': _reload(); break;
    case 'h': _hit(); break;
    case 'a': ammo.update(v => Math.min(v + 5, get(maxAmmo))); break;
  }
}

function _fire() {
  if (!get(isAlive)) return; // can't fire while dead
  if (get(gunLocked)) return; // Infection: non-infected can't fire
  const current = get(ammo);
  if (current <= 0 || get(isReloading)) return;
  if (_activeMode === 'plasma') {
    // Plasma fires all loaded rounds in one shot; damage scales with ammo count on the server.
    ammo.set(0);
    sendFire('plasma', current);
  } else {
    ammo.update(v => Math.max(0, v - 1));
    sendFire(_activeMode, current);
  }
}

function _reload() {
  if (get(isReloading)) return;
  isReloading.set(true);
  playReload();
  setTimeout(() => {
    ammo.set(get(maxAmmo));
    isReloading.set(false);
  }, get(reloadDelaySecs) * 1_000);
}

function _hit() {
  // Simulate being hit by another player
  sendHit(FAKE_SHOOTER_WEAPON_ID);
}
