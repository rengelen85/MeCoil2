/**
 * BLE adapter for the Goliath Recoil gun using react-native-ble-plx.
 *
 * Service: E6F59D10-...  (full UUID in docs/recoil_protocol_BLE.md)
 * Characteristics:
 *   Telemetry  E6F59D12  notify  — button events, IR hit events, ammo
 *   Control    E6F59D13  rw      — fire/reload commands
 *   Config     E6F59D14  write   — weapon profile TLV
 *
 * The logic mirrors client/src/lib/ble.js + recoilweapon.js from the web app.
 */

import { BleManager, Device, Characteristic, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { sendFire, sendHit } from './network.js';
import { useGameStore } from '../stores/game.js';
import { playReload } from './audio.js';

const SERVICE_UUID      = 'e6f59d10-8230-4a5c-b22f-c062b1d329e3';
const CHAR_TELEMETRY    = 'e6f59d12-8230-4a5c-b22f-c062b1d329e3';
const CHAR_CONTROL      = 'e6f59d13-8230-4a5c-b22f-c062b1d329e3';
const CHAR_CONFIG       = 'e6f59d14-8230-4a5c-b22f-c062b1d329e3';
const DEVICE_NAME_PREFIX = 'SRG';

// Control-characteristic Action bitmask (see docs/recoil_protocol_BLE.md).
const ACTION_RELOAD_MODE  = 0x0002; // enter reload (clip empty)
const ACTION_END_RELOAD   = 0x0004; // end reload + set ammo (byte 6)
const ACTION_MUZZLE_FLASH = 0x0010; // pulse the muzzle LED

// After the first gun is seen, keep scanning this long to let other nearby guns
// advertise, then connect to the strongest signal (the closest = in-hand gun).
const SCAN_SETTLE_MS = 1_500;

// Fallbacks used before a game starts and host settings arrive.
const DEFAULT_MAGAZINE_SIZE = 10;
const DEFAULT_RELOAD_MS     = 2_500;

const magazineSize = (): number =>
  useGameStore.getState().bulletsPerMag || DEFAULT_MAGAZINE_SIZE;
const reloadMs = (): number =>
  useGameStore.getState().reloadDelaySecs * 1_000 || DEFAULT_RELOAD_MS;

// Muzzle-flash (FlashLED1) modes — see docs/Recoil_Gun_Firmware_Config_Guide.md.
//   square wave: flashParam1 = flashes per shot, flashParam2 = flash duration (100ms units)
//   glow:        flashParam1 = flashes on release, flashParam2 = glow period (500ms units)
const FLASH = { NONE: 0, SQUARE: 1, GLOW: 2, SOLID: 3 };

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

// Selectable fire modes. The firmware's TriggerMode byte encodes the mode and,
// for burst, doubles as the burst length N (2–253). rateOfFire is in 50ms units
// and sets the repeat/charge period (irrelevant for single shot).
// See docs/Recoil_Gun_Firmware_Config_Guide.md.
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
  // label, TriggerMode/RateOfFire, plus per-mode muzzle flash (mode + params).
  semi:   { label: 'SEMI',   triggerMode: 0x01,         rateOfFire: 20, flashMode: FLASH.SQUARE, flashParam1: 1,            flashParam2: 3 }, // single shot
  burst:  { label: 'BURST',  triggerMode: BURST_LENGTH, rateOfFire: 2,  flashMode: FLASH.SQUARE, flashParam1: BURST_LENGTH, flashParam2: 3 }, // N rounds at full-auto cadence
  auto:   { label: 'AUTO',   triggerMode: 0xfe,         rateOfFire: 2,  flashMode: FLASH.SQUARE, flashParam1: 4,            flashParam2: 3 }, // full auto, ~100ms cadence
  plasma: { label: 'PLASMA', triggerMode: 0x00,         rateOfFire: 20, flashMode: FLASH.GLOW,   flashParam1: 15,           flashParam2: 4 }, // charge-up glow, fire on release
};
// Order the in-game button cycles through.
export const GUN_MODE_CYCLE: GunMode[] = ['semi', 'burst', 'auto', 'plasma'];

const bleManager = new BleManager();
let _device: Device | null = null;
let _gunId = 0;
// The profile currently written to the gun. Tracked so a mode toggle rewrites
// only the TriggerMode byte instead of resetting the rest to DEFAULT_PROFILE.
let _activeProfile = DEFAULT_PROFILE;
// The current fire-mode key. Sent with each shot so the server can apply
// mode-appropriate damage. DEFAULT_PROFILE is full auto.
let _activeMode: GunMode = 'auto';

// Nibble counters from previous telemetry frame — used for edge detection
let _prevTrigger = 0;
let _prevReload  = 0;

// Control-packet counter (high nibble of byte 0). The firmware uses it to reject
// duplicate commands, so it must increment per write. Plus the last ammo value
// we told the gun, stamped into every control packet's WeaponAmmo byte.
let _pktCounter = 0;
let _ammoState  = 0;

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

// Resolve once the BLE adapter is powered on. Scanning before this throws
// "Cannot start scanning operation"; the manager also needs a moment to report
// its initial state after construction. Rejects if Bluetooth is off/unsupported.
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
    }, true); // emitCurrentState: fire immediately with the present state
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
  await _subscribeToTelemetry(_device);

  useGameStore.getState().setBleConnected(true);

  // Blink the muzzle LED so the player can see which gun connected.
  _confirmPairingFeedback(_device);

  _device.onDisconnected(() => {
    _device = null;
    useGameStore.getState().setBleConnected(false);
  });
}

export async function disconnectBle(): Promise<void> {
  if (_device) {
    await _device.cancelConnection();
    _device = null;
  }
}

export async function applyGunAssignment(
  slotId: number,
  profile = DEFAULT_PROFILE,
): Promise<void> {
  const game = useGameStore.getState();
  if (!game.bleConnected || !_device) return;

  const mag = magazineSize();
  _activeProfile = profile;
  _activeMode = 'auto'; // matches DEFAULT_PROFILE; the in-game toggle re-syncs it
  await _writeWeaponProfile(_device, profile, slotId);
  _gunId = slotId;
  _loadClip(_device, mag);
  game.setAmmo(mag);
  game.setMaxAmmo(mag);
}

// Switch the connected gun's fire mode (a key of GUN_MODES). Rewrites the
// current slot's profile, changing the TriggerMode and RateOfFire bytes while
// preserving the rest of the applied profile.
export async function setGunMode(mode: GunMode): Promise<void> {
  const game = useGameStore.getState();
  if (!game.bleConnected || !_device) return;
  const cfg = GUN_MODES[mode] ?? GUN_MODES.auto;
  _activeMode = GUN_MODES[mode] ? mode : 'auto';
  _activeProfile = {
    ..._activeProfile,
    triggerMode:     cfg.triggerMode,
    rateOfFire:      cfg.rateOfFire,
    muzzleFlashMode: cfg.flashMode,
    flashParam1:     cfg.flashParam1,
    flashParam2:     cfg.flashParam2,
  };
  await _writeWeaponProfile(_device, _activeProfile, _gunId);
}

// ── Scanning / connecting ────────────────────────────────────────────────────

function _scanAndConnect(): Promise<Device> {
  return new Promise((resolve, reject) => {
    // Scan with no UUID filter (null): the gun does NOT advertise SERVICE_UUID in
    // its advertising packet, so filtering by it returns nothing. Match by name
    // prefix instead — mirrors the web client's `namePrefix: 'SRG'` filter.
    //
    // When several guns are in range, connect to the strongest signal — the gun
    // closest to the phone, i.e. the one in the player's hands. Collect matches
    // for a short settle window after the first sighting, then pick the best RSSI.
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
        // Each advertisement may be a fresh Device with updated RSSI; keep the latest.
        candidates.set(device.id, device);
        if (!settleTimer) settleTimer = setTimeout(connectStrongest, SCAN_SETTLE_MS);
      }
    });

    // Overall timeout if no gun is ever seen.
    const overallTimer = setTimeout(
      () => finish(new Error('Scan timed out — gun not found')),
      15_000,
    );
  });
}

// ── Telemetry parsing ────────────────────────────────────────────────────────

function _subscribeToTelemetry(device: Device) {
  return device.monitorCharacteristicForService(
    SERVICE_UUID,
    CHAR_TELEMETRY,
    (err, char) => {
      if (err || !char?.value) return;
      _parseTelemetry(char);
    },
  );
}

function _parseTelemetry(char: Characteristic) {
  if (!char.value) return;
  // Telemetry is base64-encoded by react-native-ble-plx; decode to bytes
  const bytes = _base64ToBytes(char.value);
  if (bytes.length < 16) return;

  // Nibble counters for button edge detection (see recoilweapon.js)
  const triggerNibble = bytes[0] & 0x0f;
  const reloadNibble  = (bytes[0] >> 4) & 0x0f;

  if (_nibbleEdge(triggerNibble, _prevTrigger)) _onTrigger();
  if (_nibbleEdge(reloadNibble,  _prevReload))  _onReload();
  _prevTrigger = triggerNibble;
  _prevReload  = reloadNibble;

  // Ammo counter is at byte 5
  const ammo = bytes[5];
  if (ammo >= 0) useGameStore.getState().setAmmo(ammo);

  // IR event slots at bytes 8–11 and 12–15 (20-bit MAN20A packets)
  _parseIrSlot(bytes, 8);
  _parseIrSlot(bytes, 12);
}

function _nibbleEdge(current: number, previous: number): boolean {
  return current !== previous && current !== 0;
}

function _parseIrSlot(bytes: number[], offset: number) {
  const word = (bytes[offset] << 12) | (bytes[offset + 1] << 4) | (bytes[offset + 2] >> 4);
  if (word === 0) return;
  // Bits 15–10 = shooter ID (slot), bits 9–6 = weapon ID, bits 5–0 = shot counter
  const shooterId = (word >> 14) & 0x3f;
  sendHit(shooterId);
}

// ── Control commands ─────────────────────────────────────────────────────────

// Build and write a 7-byte Control packet (mirrors recoilweapon.js
// _sendControlPacket). Layout: [pktCounter<<4][IR_ack][action LE ×2][GunID]
// [WeaponSlot][Ammo].
function _sendControlPacket(device: Device, action: number, ammo = _ammoState) {
  _pktCounter = (_pktCounter + 1) % 16;
  _ammoState = ammo;
  const pkt = new Uint8Array(7);
  pkt[0] = _pktCounter << 4;
  pkt[1] = 0;                    // IR_ack (none)
  pkt[2] = action & 0xff;        // Action U16, little-endian
  pkt[3] = (action >> 8) & 0xff;
  pkt[4] = _gunId;               // GunID (shooter id)
  pkt[5] = _gunId;               // WeaponType / slot
  pkt[6] = ammo;                 // WeaponAmmo
  return device.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    CHAR_CONTROL,
    _bytesToBase64(pkt),
  );
}

function _loadClip(device: Device, ammoCount: number) {
  _sendControlPacket(device, ACTION_END_RELOAD, ammoCount);
}

function _removeClip(device: Device) {
  _sendControlPacket(device, ACTION_RELOAD_MODE);
}

// Pulse the muzzle LED a few times as visible confirmation of which gun paired.
// Best-effort: a write failure here must not fail the connection.
async function _confirmPairingFeedback(device: Device) {
  for (let i = 0; i < 3; i++) {
    try {
      await _sendControlPacket(device, ACTION_MUZZLE_FLASH);
    } catch {
      return;
    }
    await new Promise<void>(r => setTimeout(() => r(), 250));
  }
}

// ── Weapon profile TLV write ──────────────────────────────────────────────────

async function _writeWeaponProfile(
  device: Device,
  profile: typeof DEFAULT_PROFILE,
  gunId: number,
) {
  const tlv = new Uint8Array([
    0x01, 0x01, profile.triggerMode,
    0x02, 0x01, profile.rateOfFire,
    0x03, 0x01, profile.narrowIrPower,
    0x04, 0x01, profile.wideIrPower,
    0x05, 0x01, profile.muzzleLedPower,
    0x06, 0x01, profile.motorPower,
    0x07, 0x01, profile.muzzleFlashMode,
    0x08, 0x01, profile.flashParam1,
    0x09, 0x01, profile.flashParam2,
    0x0a, 0x01, gunId,
  ]);
  await device.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    CHAR_CONFIG,
    _bytesToBase64(tlv),
  );
}

// ── Event handlers ───────────────────────────────────────────────────────────

function _onTrigger() {
  const game = useGameStore.getState();
  if (game.isReloading || !game.isAlive) return;
  if (_activeMode === 'plasma') {
    // Plasma fires a variable number of rounds depending on charge time (4 rounds/period).
    // triggerBtn and setAmmo are processed in the same telemetry packet but triggerBtn fires
    // first, so game.ammo is still pre-shot here. Defer until setAmmo has run, then send
    // rounds actually fired (ammoBefore - ammoAfter) as the damage input.
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
  if (game.isReloading || !_device) return;
  game.setIsReloading(true);
  playReload();
  // Plasma (TriggerMode 0) fires on trigger *release* and keeps charging through
  // the normal "reload mode" control action, so the gun fires continuously for
  // the whole reload window. Force the clip empty instead (ammo 0): the firmware
  // will not auto-fire a plasma shot with an empty clip, so the gun stays silent
  // until the reload completes. Other modes fire on press, where "reload mode"
  // correctly suppresses firing, so they keep the original behaviour.
  if (_activeProfile.triggerMode === GUN_MODES.plasma.triggerMode) {
    _loadClip(_device, 0);
  } else {
    _removeClip(_device);
  }
  setTimeout(() => {
    if (_device) _loadClip(_device, magazineSize());
    useGameStore.getState().setIsReloading(false);
  }, reloadMs());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _base64ToBytes(b64: string): number[] {
  const binary = atob(b64);
  return Array.from(binary, c => c.charCodeAt(0));
}

function _bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
