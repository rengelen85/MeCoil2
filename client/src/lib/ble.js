import { gun } from './recoilweapon.js';
import { sendFire, sendHit } from './network.js';
import { ammo, maxAmmo, isReloading, isAlive, bleConnected, bulletsPerMag, reloadDelaySecs, gunSlotId } from '../stores/game.js';
import { get } from 'svelte/store';

// Weapon trigger modes (the profile's TriggerMode byte), per the gun firmware:
//   0       = plasma  (charge while held, fire accumulated shot on release)
//   1       = single shot (one round per trigger press) — our "SEMI"
//   2–253   = N-round burst
//   254     = full auto (repeat one round per rate-of-fire period while held)
// Burst/auto/plasma all repeat on the rate-of-fire period, so rateOfFire must
// be non-zero (see DEFAULT_PROFILE) for AUTO to actually fire continuously.
export const TRIGGER_MODE = { AUTO: 0xfe, SEMI: 0x01 };

// Fallbacks used before a game starts and host settings arrive.
const DEFAULT_MAGAZINE_SIZE = 10;
const DEFAULT_RELOAD_MS     = 2_500;

const magazineSize = () => get(bulletsPerMag) || DEFAULT_MAGAZINE_SIZE;
const reloadMs     = () => (get(reloadDelaySecs) || 0) * 1_000 || DEFAULT_RELOAD_MS;

// Default weapon profile — RK-45 equivalent.
// Field names match recoilweapon.js _setWeaponProfile expectations.
const DEFAULT_PROFILE = {
  triggerMode:    0xfe, // full auto
  rateOfFire:     2,    // 50ms units → ~10 rounds/sec; MUST be >0 or auto/burst never repeats
  narrowIrPower:  80,
  wideIrPower:    0,
  muzzleLedPower: 255,
  motorPower:     18,
  muzzleFlashMode: 0,
  flashParam2:    3,
};

// The profile currently written to the active weapon slot. Tracked so a mode
// toggle can rewrite only the TriggerMode byte without resetting the rest of
// the profile back to DEFAULT_PROFILE.
let _activeProfile = DEFAULT_PROFILE;

export function isBleAvailable() {
  return !!navigator.bluetooth;
}

export function bleErrorMessage(e) {
  if (e.name === 'NotFoundError')
    return 'No device was selected. Make sure your gun is powered on, then try again.';
  if (e.name === 'SecurityError')
    return 'Bluetooth requires HTTPS. Open this page from the Network address shown in the server terminal.';
  if (e.name === 'NotSupportedError')
    return 'Web Bluetooth is not supported in this browser. Use Chrome or Edge on Android.';
  return `Could not connect: ${e.message}`;
}

export async function connectBle() {
  await gun.connect();

  gun.on('triggerBtn', _onTrigger);
  gun.on('reloadBtn',  _onReload);
  gun.on('irEvent',    _onIrEvent);
  gun.on('ammoChanged', count => {
    ammo.set(count);
    maxAmmo.set(magazineSize());
  });
  gun.on('disconnected', () => bleConnected.set(false));

  await gun.startTelemetry();
  bleConnected.set(true);
}

// Called from InGame.svelte after the game starts and the server assigns a gun slot.
export async function applyGunAssignment(slotId, profile = DEFAULT_PROFILE) {
  if (!get(bleConnected)) return;
  const mag = magazineSize();
  _activeProfile = profile;
  await gun.setWeaponProfile(profile, slotId);
  gun.setGunId(slotId);
  // Make the slot we just configured the active weapon, otherwise the firmware
  // keeps firing slot 0's default profile and ignores everything we wrote
  // (including the trigger mode) for any player whose slot isn't 0.
  gun.switchWeapon(slotId);
  // Write the ShotConfig (ID 16). Without this the firmware never gets told to
  // do per-shot recoil/flash feedback, and any TriggerOverride left over from a
  // previous session is never cleared — both of which make AUTO feel inert /
  // refuse to fire continuously. weaponOverride 0xff = no override (use the
  // per-weapon TriggerMode we just wrote).
  gun.updateSettings({ recoil: true, flashOnShot: true, weaponOverride: 0xff });
  gun.loadClip(mag);
  ammo.set(mag);
  maxAmmo.set(mag);
}

// Switch the connected gun between automatic and semi-automatic fire.
// `mode` is 'auto' or 'semi'. Rewrites the active slot's profile, changing only
// the TriggerMode byte and preserving the rest of the applied profile.
export async function setGunMode(mode) {
  if (!get(bleConnected)) return;
  const triggerMode = mode === 'semi' ? TRIGGER_MODE.SEMI : TRIGGER_MODE.AUTO;
  _activeProfile = { ..._activeProfile, triggerMode };
  await gun.setWeaponProfile(_activeProfile, get(gunSlotId));
}

function _onTrigger() {
  if (get(isReloading) || !get(isAlive)) return;
  sendFire();
}

function _onReload() {
  if (get(isReloading)) return;
  isReloading.set(true);
  gun.removeClip();
  setTimeout(() => {
    gun.loadClip(magazineSize());
    isReloading.set(false);
  }, reloadMs());
}

function _onIrEvent(ev) {
  sendHit(ev.shooterID);
}
