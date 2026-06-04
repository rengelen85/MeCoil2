/**
 * Phase 1 keyboard gun simulator.
 * Keys: T = trigger (fire), R = reload, H = hit received (irEvent), A = ammo +5
 *
 * In Phase 2 this module is replaced by ble.js.
 */
import { sendFire, sendHit } from './network.js';
import { ammo, isReloading, isAlive, maxAmmo, reloadDelaySecs } from '../stores/game.js';
import { get } from 'svelte/store';

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
    case 'a': ammo.update(v => Math.min(v + 5, get(maxAmmo))); break;
  }
}

function _fire() {
  if (!get(isAlive)) return; // can't fire while dead
  const current = get(ammo);
  if (current <= 0 || get(isReloading)) return;
  ammo.update(v => Math.max(0, v - 1));
  sendFire();
}

function _reload() {
  if (get(isReloading)) return;
  isReloading.set(true);
  setTimeout(() => {
    ammo.set(get(maxAmmo));
    isReloading.set(false);
  }, get(reloadDelaySecs) * 1_000);
}

function _hit() {
  // Simulate being hit by another player
  sendHit(FAKE_SHOOTER_WEAPON_ID);
}
