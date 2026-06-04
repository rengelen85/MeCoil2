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

import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { sendFire, sendHit } from './network.js';
import { useGameStore } from '../stores/game.js';

const SERVICE_UUID      = 'E6F59D10-E878-41BA-A3CE-3B5999FA3D7B';
const CHAR_TELEMETRY    = 'E6F59D12-E878-41BA-A3CE-3B5999FA3D7B';
const CHAR_CONTROL      = 'E6F59D13-E878-41BA-A3CE-3B5999FA3D7B';
const CHAR_CONFIG       = 'E6F59D14-E878-41BA-A3CE-3B5999FA3D7B';
const DEVICE_NAME_PREFIX = 'SRG';

// Fallbacks used before a game starts and host settings arrive.
const DEFAULT_MAGAZINE_SIZE = 10;
const DEFAULT_RELOAD_MS     = 2_500;

const magazineSize = (): number =>
  useGameStore.getState().bulletsPerMag || DEFAULT_MAGAZINE_SIZE;
const reloadMs = (): number =>
  useGameStore.getState().reloadDelaySecs * 1_000 || DEFAULT_RELOAD_MS;

const DEFAULT_PROFILE = {
  triggerMode:     0xfe, // full auto
  rateOfFire:      2,    // 50ms units → ~10 rounds/sec; MUST be >0 or auto/burst never repeats
  narrowIrPower:   80,
  wideIrPower:     0,
  muzzleLedPower:  255,
  motorPower:      18,
  muzzleFlashMode: 0,
  flashParam2:     3,
};

// Weapon trigger modes (the profile's TriggerMode byte), per the gun firmware:
//   0       = plasma  (charge while held, fire accumulated shot on release)
//   1       = single shot (one round per trigger press) — our "SEMI"
//   2–253   = N-round burst
//   254     = full auto (repeat one round per rate-of-fire period while held)
// Burst/auto/plasma all repeat on the rate-of-fire period, so rateOfFire must
// be non-zero (see DEFAULT_PROFILE) for AUTO to actually fire continuously.
export const TRIGGER_MODE = { AUTO: 0xfe, SEMI: 0x01 };

const bleManager = new BleManager();
let _device: Device | null = null;
let _gunId = 0;
// The profile currently written to the gun. Tracked so a mode toggle rewrites
// only the TriggerMode byte instead of resetting the rest to DEFAULT_PROFILE.
let _activeProfile = DEFAULT_PROFILE;

// Nibble counters from previous telemetry frame — used for edge detection
let _prevTrigger = 0;
let _prevReload  = 0;

// ── Permissions ──────────────────────────────────────────────────────────────

async function _requestPermissions() {
  if (Platform.OS !== 'android') return;
  const sdkInt = parseInt(String(Platform.Version), 10);
  if (sdkInt >= 31) {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
  } else {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function isBleAvailable(): boolean {
  return true; // react-native-ble-plx is always present on native
}

export async function connectBle(): Promise<void> {
  await _requestPermissions();
  _device = await _scanAndConnect();

  await _device.discoverAllServicesAndCharacteristics();
  await _subscribeToTelemetry(_device);

  useGameStore.getState().setBleConnected(true);

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
  await _writeWeaponProfile(_device, profile, slotId);
  _gunId = slotId;
  _loadClip(_device, mag);
  game.setAmmo(mag);
  game.setMaxAmmo(mag);
}

// Switch the connected gun between automatic and semi-automatic fire.
// Rewrites the current slot's profile, changing only the TriggerMode byte and
// preserving the rest of the applied profile.
export async function setGunMode(mode: 'auto' | 'semi'): Promise<void> {
  const game = useGameStore.getState();
  if (!game.bleConnected || !_device) return;
  const triggerMode = mode === 'semi' ? TRIGGER_MODE.SEMI : TRIGGER_MODE.AUTO;
  _activeProfile = { ..._activeProfile, triggerMode };
  await _writeWeaponProfile(_device, _activeProfile, _gunId);
}

// ── Scanning / connecting ────────────────────────────────────────────────────

function _scanAndConnect(): Promise<Device> {
  return new Promise((resolve, reject) => {
    bleManager.startDeviceScan([SERVICE_UUID], null, (error, device) => {
      if (error) {
        reject(error);
        return;
      }
      if (device?.name?.startsWith(DEVICE_NAME_PREFIX)) {
        bleManager.stopDeviceScan();
        device
          .connect()
          .then(resolve)
          .catch(reject);
      }
    });

    // Timeout after 15 s
    setTimeout(() => {
      bleManager.stopDeviceScan();
      reject(new Error('Scan timed out — gun not found'));
    }, 15_000);
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

function _loadClip(device: Device, ammoCount: number) {
  const cmd = new Uint8Array([0x01, ammoCount]);
  device.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    CHAR_CONTROL,
    _bytesToBase64(cmd),
  );
}

function _removeClip(device: Device) {
  const cmd = new Uint8Array([0x02]);
  device.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    CHAR_CONTROL,
    _bytesToBase64(cmd),
  );
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
    0x08, 0x01, profile.flashParam2,
    0x09, 0x01, gunId,
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
  sendFire();
}

function _onReload() {
  const game = useGameStore.getState();
  if (game.isReloading || !_device) return;
  game.setIsReloading(true);
  _removeClip(_device);
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
