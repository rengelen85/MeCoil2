import { gun } from './recoilweapon.js';
import { sendFire, sendHit } from './network.js';
import { ammo, maxAmmo, isReloading, bleConnected } from '../stores/game.js';
import { get } from 'svelte/store';

const MAGAZINE_SIZE = 10;
const RELOAD_MS     = 2_500;

// Default weapon profile — RK-45 equivalent.
// Field names match recoilweapon.js _setWeaponProfile expectations.
const DEFAULT_PROFILE = {
  triggerMode:    0xfe, // full auto
  rateOfFire:     0,
  narrowIrPower:  80,
  wideIrPower:    0,
  muzzleLedPower: 255,
  motorPower:     18,
  muzzleFlashMode: 0,
  flashParam2:    3,
};

export function isBleAvailable() {
  return !!navigator.bluetooth;
}

export async function connectBle() {
  await gun.connect();

  gun.on('triggerBtn', _onTrigger);
  gun.on('reloadBtn',  _onReload);
  gun.on('irEvent',    _onIrEvent);
  gun.on('ammoChanged', count => {
    ammo.set(count);
    maxAmmo.set(MAGAZINE_SIZE);
  });
  gun.on('disconnected', () => bleConnected.set(false));

  await gun.startTelemetry();
  bleConnected.set(true);
}

// Called from InGame.svelte after the game starts and the server assigns a gun slot.
export async function applyGunAssignment(slotId, profile = DEFAULT_PROFILE) {
  if (!get(bleConnected)) return;
  await gun.setWeaponProfile(profile, slotId);
  gun.setGunId(slotId);
  gun.loadClip(MAGAZINE_SIZE);
  ammo.set(MAGAZINE_SIZE);
  maxAmmo.set(MAGAZINE_SIZE);
}

function _onTrigger() {
  if (get(isReloading)) return;
  sendFire();
}

function _onReload() {
  if (get(isReloading)) return;
  isReloading.set(true);
  gun.removeClip();
  setTimeout(() => {
    gun.loadClip(MAGAZINE_SIZE);
    isReloading.set(false);
  }, RELOAD_MS);
}

function _onIrEvent(ev) {
  sendHit(ev.weaponID);
}
