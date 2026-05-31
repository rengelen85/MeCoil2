/**
 * Phase 1 keyboard gun simulator.
 * Keys: T = trigger (fire), R = reload, H = hit received (irEvent), A = ammo +5
 *
 * In Phase 2 this module is replaced by ble.js.
 */
import { sendFire, sendHit } from './network.js';
import { ammo, isReloading } from '../stores/game.js';
import { get } from 'svelte/store';

const RELOAD_TIME_MS = 2_000;
const MAX_AMMO = 30;
const FAKE_SHOOTER_WEAPON_ID = 0;

let enabled = false;

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
    case 'a': ammo.update(v => Math.min(v + 5, MAX_AMMO)); break;
  }
}

function _fire() {
  const current = get(ammo);
  if (current <= 0 || get(isReloading)) return;
  ammo.update(v => Math.max(0, v - 1));
  sendFire();
}

function _reload() {
  if (get(isReloading)) return;
  isReloading.set(true);
  setTimeout(() => {
    ammo.set(MAX_AMMO);
    isReloading.set(false);
  }, RELOAD_TIME_MS);
}

function _hit() {
  // Simulate being hit by another player
  sendHit(FAKE_SHOOTER_WEAPON_ID);
}
