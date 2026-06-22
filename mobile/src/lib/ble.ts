/**
 * BLE adapter for the Goliath Recoil gun. Mirrors client/src/lib/ble.js — the
 * scan/connect/permission plumbing is react-native-ble-plx specific, but the
 * gun dynamics (fire modes, reload, power-button mode cycle, gun assignment
 * sequence) are kept identical to the web client. The low-level telemetry
 * parsing and control writes live in ./recoilweapon.ts (a port of the web
 * recoilweapon.js).
 */

import { BleManager, Device, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { sendFire, sendHit } from './network.js';
import { useGameStore } from '../stores/game.js';
import { playReload } from './audio.js';
import { gun, WeaponProfile, IrEvent } from './recoilweapon.js';

const DEVICE_NAME_PREFIX = 'SRG';

// After the first gun is seen, keep scanning this long to let other nearby guns
// advertise, then connect to the strongest signal (the closest = in-hand gun).
const SCAN_SETTLE_MS = 1_500;

// Fallbacks used before a game starts and host settings arrive.
const DEFAULT_MAGAZINE_SIZE = 10;
const DEFAULT_RELOAD_MS = 2_500;

const magazineSize = (): number =>
  useGameStore.getState().bulletsPerMag || DEFAULT_MAGAZINE_SIZE;
const reloadMs = (): number =>
  useGameStore.getState().reloadDelaySecs * 1_000 || DEFAULT_RELOAD_MS;

// Muzzle-flash (FlashLED1) modes — see docs/Recoil_Gun_Firmware_Config_Guide.md.
//   square wave: flashParam1 = flashes per shot, flashParam2 = flash duration (100ms units)
//   glow:        flashParam1 = flashes on release, flashParam2 = glow period (500ms units)
const FLASH = { NONE: 0, SQUARE: 1, GLOW: 2, SOLID: 3 };

// Default weapon profile — RK-45 equivalent (matches the AUTO mode below).
const DEFAULT_PROFILE: WeaponProfile = {
  triggerMode: 0xfe, // full auto
  rateOfFire: 2, // 50ms units → ~10 rounds/sec; MUST be >0 or auto/burst never repeats
  narrowIrPower: 80,
  wideIrPower: 0,
  muzzleLedPower: 255,
  motorPower: 18,
  muzzleFlashMode: FLASH.SQUARE,
  flashParam1: 4,
  flashParam2: 3,
};

// Selectable fire modes. The firmware's TriggerMode byte encodes the mode and,
// for burst, doubles as the burst length N (2–253). rateOfFire is in 50ms units
// and sets the repeat/charge period (irrelevant for single shot).
//   plasma 0    — charge while held (4 rounds / period), fire on release
//   semi   1    — one round per trigger press
//   burst  N    — one round on press, then up to N total, one per period
//   auto   254  — one round on press, then one per period until release/empty
const BURST_LENGTH = 3;
export type GunMode = 'semi' | 'burst' | 'auto' | 'plasma';
type GunModeConfig = {
  label: string;
  triggerMode: number;
  rateOfFire: number;
  flashMode: number;
  flashParam1: number;
  flashParam2: number;
};
export const GUN_MODES: Record<GunMode, GunModeConfig> = {
  semi:   { label: 'SEMI',   triggerMode: 0x01,         rateOfFire: 20, flashMode: FLASH.SQUARE, flashParam1: 1,            flashParam2: 3 },
  burst:  { label: 'BURST',  triggerMode: BURST_LENGTH, rateOfFire: 2,  flashMode: FLASH.SQUARE, flashParam1: BURST_LENGTH, flashParam2: 3 },
  auto:   { label: 'AUTO',   triggerMode: 0xfe,         rateOfFire: 2,  flashMode: FLASH.SQUARE, flashParam1: 4,            flashParam2: 3 },
  plasma: { label: 'PLASMA', triggerMode: 0x00,         rateOfFire: 20, flashMode: FLASH.GLOW,   flashParam1: 15,           flashParam2: 4 },
};
// Order the in-game button cycles through.
export const GUN_MODE_CYCLE: GunMode[] = ['semi', 'burst', 'auto', 'plasma'];

const bleManager = new BleManager();
let _device: Device | null = null;

// The profile currently written to the active weapon slot. Tracked so a mode
// toggle rewrites only the TriggerMode byte instead of resetting the rest.
let _activeProfile: WeaponProfile = DEFAULT_PROFILE;
// The current fire-mode key. Sent with each shot so the server can apply
// mode-appropriate damage. DEFAULT_PROFILE is full auto.
let _activeMode: GunMode = 'auto';

// Local reload timer handle so a reload can't be double-scheduled.
let _handlersWired = false;

// ── Permissions ──────────────────────────────────────────────────────────────

async function _requestPermissions() {
  if (Platform.OS !== 'android') return;
  const sdkInt = parseInt(String(Platform.Version), 10);
  const granted = PermissionsAndroid.RESULTS.GRANTED;
  if (sdkInt >= 31) {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    if (
      res[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] !== granted ||
      res[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] !== granted
    ) {
      throw new Error('Bluetooth permission denied — enable it in Settings to pair your gun.');
    }
  } else {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (res !== granted) {
      throw new Error('Location permission denied — required for Bluetooth scanning.');
    }
  }
}

// Resolve once the BLE adapter is powered on. Scanning before this throws.
function _waitForPoweredOn(timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sub = bleManager.onStateChange(state => {
      if (state === State.PoweredOn) {
        clearTimeout(timer);
        sub.remove();
        resolve();
      } else if (state === State.PoweredOff || state === State.Unsupported) {
        clearTimeout(timer);
        sub.remove();
        reject(new Error('Bluetooth is turned off — enable it and try again.'));
      }
    }, true);
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Bluetooth not ready — try again.'));
    }, timeoutMs);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export function isBleAvailable(): boolean {
  return true; // react-native-ble-plx is always present on native
}

export async function connectBle(): Promise<void> {
  await _requestPermissions();
  await _waitForPoweredOn();
  _device = await _scanAndConnect();

  await _device.discoverAllServicesAndCharacteristics();

  gun.attach(_device);
  _setupGunHandlers();
  gun.startTelemetry();

  useGameStore.getState().setBleConnected(true);

  // Blink the muzzle LED so the player can see which gun connected.
  for (let i = 0; i < 3; i++) gun.flash();

  _device.onDisconnected(() => {
    gun.detach();
    _device = null;
    useGameStore.getState().setBleConnected(false);
  });
}

export async function disconnectBle(): Promise<void> {
  if (_device) {
    await _device.cancelConnection();
    gun.detach();
    _device = null;
  }
}

function _setupGunHandlers() {
  if (_handlersWired) return;
  _handlersWired = true;
  gun.on('triggerBtn', _onTrigger);
  gun.on('reloadBtn', _onReload);
  gun.on('powerBtn', _onResetBtn);
  gun.on('irEvent', _onIrEvent);
  gun.on('ammoChanged', (count: number) => {
    const game = useGameStore.getState();
    game.setAmmo(count);
    game.setMaxAmmo(magazineSize());
  });
}

// Called from InGameScreen after the game starts and the server assigns a slot.
export async function applyGunAssignment(
  slotId: number | null,
  profile: WeaponProfile = DEFAULT_PROFILE,
): Promise<void> {
  const game = useGameStore.getState();
  if (!game.bleConnected || !_device) return;
  if (slotId == null) return;

  const mag = magazineSize();
  _activeProfile = profile;
  _activeMode = 'auto'; // matches DEFAULT_PROFILE; the in-game toggle re-syncs it
  game.setActiveGunMode('auto');

  await gun.setWeaponProfile(profile, slotId);
  gun.setGunId(slotId);
  // Make the slot we just configured the active weapon, otherwise the firmware
  // keeps firing slot 0's default profile and ignores everything we wrote.
  gun.switchWeapon(slotId);
  // Write the ShotConfig (ID 16): without it the firmware never does per-shot
  // recoil/flash feedback and any leftover TriggerOverride is never cleared —
  // both make AUTO feel inert / refuse to fire continuously. weaponOverride
  // 0xff = no override (use the per-weapon TriggerMode we just wrote).
  gun.updateSettings({ recoil: true, flashOnShot: true, weaponOverride: 0xff });
  gun.loadClip(mag);
  game.setAmmo(mag);
  game.setMaxAmmo(mag);

  // Confirm the gun actually latched its shooter ID (SYNC). Non-fatal.
  if (!(await gun.confirmGunId(slotId))) {
    console.warn(
      `Gun did not confirm shooter ID ${slotId}; hits may be misattributed.`,
    );
  }
}

// Switch the connected gun's fire mode. Rewrites the active slot's profile,
// changing the TriggerMode/RateOfFire/flash bytes while preserving the rest.
export async function setGunMode(mode: GunMode): Promise<void> {
  const game = useGameStore.getState();
  if (!game.bleConnected || !_device || game.gunSlotId == null) return;
  const cfg = GUN_MODES[mode] ?? GUN_MODES.auto;
  _activeMode = GUN_MODES[mode] ? mode : 'auto';
  game.setActiveGunMode(_activeMode);
  _activeProfile = {
    ..._activeProfile,
    triggerMode: cfg.triggerMode,
    rateOfFire: cfg.rateOfFire,
    muzzleFlashMode: cfg.flashMode,
    flashParam1: cfg.flashParam1,
    flashParam2: cfg.flashParam2,
  };
  await gun.setWeaponProfile(_activeProfile, game.gunSlotId);
}

// ── Event handlers (mirror client/src/lib/ble.js) ─────────────────────────────

// Power button cycles the fire mode in-game.
function _onResetBtn() {
  const i = GUN_MODE_CYCLE.indexOf(_activeMode);
  const next = GUN_MODE_CYCLE[(i + 1) % GUN_MODE_CYCLE.length];
  setGunMode(next).catch(() => {});
}

function _onTrigger() {
  const game = useGameStore.getState();
  if (game.isReloading || !game.isAlive) return;
  if (_activeMode === 'plasma') {
    // Plasma fires a variable number of rounds depending on charge time.
    // triggerBtn and ammoChanged arrive in the same telemetry packet but
    // triggerBtn fires first, so game.ammo is still pre-shot here. Defer until
    // ammoChanged has run, then send rounds actually fired as the damage input.
    const ammoBefore = game.ammo;
    Promise.resolve().then(() =>
      sendFire('plasma', ammoBefore - useGameStore.getState().ammo),
    );
  } else {
    sendFire(_activeMode, game.ammo);
  }
}

function _onReload() {
  const game = useGameStore.getState();
  if (game.isReloading) return;
  game.setIsReloading(true);
  playReload();
  // Plasma (TriggerMode 0) fires on trigger *release* and keeps charging through
  // the normal "reload mode" control action, so force the clip empty (ammo 0):
  // the firmware won't auto-fire a plasma shot with an empty clip, so the gun
  // stays silent until the reload completes. Other modes fire on press, where
  // "reload mode" correctly suppresses firing.
  if (_activeProfile.triggerMode === GUN_MODES.plasma.triggerMode) {
    gun.loadClip(0);
  } else {
    gun.removeClip();
  }
  setTimeout(() => {
    gun.loadClip(magazineSize());
    useGameStore.getState().setIsReloading(false);
  }, reloadMs());
}

function _onIrEvent(ev: IrEvent) {
  sendHit(ev.shooterID);
}

// ── Scanning / connecting ────────────────────────────────────────────────────

function _scanAndConnect(): Promise<Device> {
  return new Promise((resolve, reject) => {
    // Scan with no UUID filter (null): the gun does NOT advertise SERVICE_UUID,
    // so filtering by it returns nothing. Match by name prefix instead. When
    // several guns are in range, connect to the strongest signal (closest = the
    // gun in the player's hands).
    const candidates = new Map<string, Device>();
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const finish = (err: Error | null, device?: Device) => {
      if (done) return;
      done = true;
      if (settleTimer) clearTimeout(settleTimer);
      clearTimeout(overallTimer);
      bleManager.stopDeviceScan();
      if (err) {
        reject(err);
      } else {
        device!.connect().then(resolve).catch(reject);
      }
    };

    const connectStrongest = () => {
      const best = [...candidates.values()].sort(
        (a, b) => (b.rssi ?? -999) - (a.rssi ?? -999),
      )[0];
      finish(best ? null : new Error('Scan timed out — gun not found'), best);
    };

    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        finish(error);
        return;
      }
      if (device?.name?.startsWith(DEVICE_NAME_PREFIX)) {
        candidates.set(device.id, device);
        if (!settleTimer) settleTimer = setTimeout(connectStrongest, SCAN_SETTLE_MS);
      }
    });

    const overallTimer = setTimeout(
      () => finish(new Error('Scan timed out — gun not found')),
      15_000,
    );
  });
}
