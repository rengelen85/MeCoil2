import { gun } from './recoilweapon.js';
import { sendFire, sendHit } from './network.js';
import { playReload } from './audio.js';
import { ammo, maxAmmo, isReloading, isAlive, bleConnected, bulletsPerMag, reloadDelaySecs, gunSlotId, gunLocked, activeGunMode } from '../stores/game.js';
import { get } from 'svelte/store';

// Muzzle-flash (FlashLED1) modes — see docs/Recoil_Gun_Firmware_Config_Guide.md.
//   square wave: flashParam1 = flashes per shot, flashParam2 = flash duration (100ms units)
//   glow:        flashParam1 = flashes on release, flashParam2 = glow period (500ms units)
const FLASH = { NONE: 0, SQUARE: 1, GLOW: 2, SOLID: 3 };

// Selectable fire modes. The firmware's TriggerMode byte encodes the mode and,
// for burst, doubles as the burst length N (2–253). rateOfFire is in 50ms units
// and sets the repeat/charge period (irrelevant for single shot).
// See docs/Recoil_Gun_Firmware_Config_Guide.md.
//   plasma 0    — charge while held (4 rounds / period), fire on release
//   semi   1    — one round per trigger press
//   burst  N    — one round on press, then up to N total, one per period
//   auto   254  — one round on press, then one per period until release/empty
const BURST_LENGTH = 3;
export const GUN_MODES = {
  // label, TriggerMode/RateOfFire, plus per-mode muzzle flash (mode + params).
  semi:   { label: 'SEMI',   triggerMode: 0x01,         rateOfFire: 20, flashMode: FLASH.SQUARE, flashParam1: 1,            flashParam2: 3 }, // single shot
  burst:  { label: 'BURST',  triggerMode: BURST_LENGTH, rateOfFire: 2,  flashMode: FLASH.SQUARE, flashParam1: BURST_LENGTH, flashParam2: 3 }, // N rounds at full-auto cadence
  auto:   { label: 'AUTO',   triggerMode: 0xfe,         rateOfFire: 2,  flashMode: FLASH.SQUARE, flashParam1: 4,            flashParam2: 3 }, // full auto, ~100ms cadence
  plasma: { label: 'PLASMA', triggerMode: 0x00,         rateOfFire: 20, flashMode: FLASH.GLOW,   flashParam1: 15,           flashParam2: 4 }, // charge-up glow, fire on release
};
// Order the in-game button cycles through.
export const GUN_MODE_CYCLE = ['semi', 'burst', 'auto', 'plasma'];

// Fallbacks used before a game starts and host settings arrive.
const DEFAULT_MAGAZINE_SIZE = 10;
const DEFAULT_RELOAD_MS     = 2_500;

const magazineSize = () => get(bulletsPerMag) || DEFAULT_MAGAZINE_SIZE;
const reloadMs     = () => (get(reloadDelaySecs) || 0) * 1_000 || DEFAULT_RELOAD_MS;

// Default weapon profile — RK-45 equivalent (matches the AUTO mode below).
// Field names match recoilweapon.js _setWeaponProfile expectations.
const DEFAULT_PROFILE = {
  triggerMode:     0xfe, // full auto
  rateOfFire:      2,    // 50ms units → ~10 rounds/sec; MUST be >0 or auto/burst never repeats
  narrowIrPower:   80,
  wideIrPower:     0,
  muzzleLedPower:  255,
  motorPower:      18,
  muzzleFlashMode: FLASH.SQUARE,
  flashParam1:     4,
  flashParam2:     3,
};

// The profile currently written to the active weapon slot. Tracked so a mode
// toggle can rewrite only the TriggerMode byte without resetting the rest of
// the profile back to DEFAULT_PROFILE.
let _activeProfile = DEFAULT_PROFILE;

// The current fire-mode key (a key of GUN_MODES). Sent with each shot so the
// server can apply mode-appropriate damage. DEFAULT_PROFILE is full auto.
let _activeMode = 'auto';

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
  gun.on('powerBtn',   _onResetBtn);
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
  _activeMode = 'auto'; // matches DEFAULT_PROFILE; the in-game toggle re-syncs it
  activeGunMode.set('auto');
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

// Switch the connected gun's fire mode (a key of GUN_MODES). Rewrites the active
// slot's profile, changing the TriggerMode and RateOfFire bytes while preserving
// the rest of the applied profile.
export async function setGunMode(mode) {
  if (!get(bleConnected)) return;
  const cfg = GUN_MODES[mode] ?? GUN_MODES.auto;
  _activeMode = GUN_MODES[mode] ? mode : 'auto';
  activeGunMode.set(_activeMode);
  _activeProfile = {
    ..._activeProfile,
    triggerMode:     cfg.triggerMode,
    rateOfFire:      cfg.rateOfFire,
    muzzleFlashMode: cfg.flashMode,
    flashParam1:     cfg.flashParam1,
    flashParam2:     cfg.flashParam2,
  };
  await gun.setWeaponProfile(_activeProfile, get(gunSlotId));
}

function _onResetBtn() {
  const i = GUN_MODE_CYCLE.indexOf(_activeMode);
  const next = GUN_MODE_CYCLE[(i + 1) % GUN_MODE_CYCLE.length];
  setGunMode(next).catch(() => {});
}

function _onTrigger() {
  if (get(isReloading) || !get(isAlive) || get(gunLocked)) return;
  if (_activeMode === 'plasma') {
    // Plasma fires a variable number of rounds depending on charge time (4 rounds/period).
    // triggerBtn and ammoChanged arrive in the same BLE packet but triggerBtn fires first,
    // so get(ammo) is still pre-shot here. Defer until ammoChanged has updated the store,
    // then send rounds actually fired (ammoBefore - ammoAfter) as the damage input.
    const ammoBefore = get(ammo);
    Promise.resolve().then(() => sendFire('plasma', ammoBefore - get(ammo)));
  } else {
    sendFire(_activeMode, get(ammo));
  }
}

function _onReload() {
  if (get(isReloading)) return;
  isReloading.set(true);
  playReload();
  // Plasma (TriggerMode 0) fires on trigger *release* and keeps charging through
  // the normal "reload mode" control action, so the gun fires continuously for
  // the whole reload window. Force the clip empty instead (ammo 0): the firmware
  // will not auto-fire a plasma shot with an empty clip, so the gun stays silent
  // until the reload completes. Other modes fire on press, where "reload mode"
  // correctly suppresses firing, so they keep the original behaviour.
  if (_activeProfile.triggerMode === GUN_MODES.plasma.triggerMode) {
    gun.loadClip(0);
  } else {
    gun.removeClip();
  }
  setTimeout(() => {
    gun.loadClip(magazineSize());
    isReloading.set(false);
  }, reloadMs());
}

function _onIrEvent(ev) {
  sendHit(ev.shooterID);
}
