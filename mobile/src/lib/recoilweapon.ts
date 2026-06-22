/**
 * React Native port of the web client's recoilweapon.js (client/src/lib/),
 * adapted to react-native-ble-plx. The telemetry byte layout, control-packet
 * format, weapon-profile TLV and ShotConfig writes are kept byte-for-byte
 * identical to the web driver — that is the source of truth for how the gun
 * behaves. Web Bluetooth's DataView/ArrayBuffer API is replaced with base64
 * <-> byte helpers, and the per-op queue is a serial promise chain.
 *
 * Service: E6F59D10  (full UUID in docs/recoil_protocol_BLE.md)
 *   Telemetry  E6F59D12  notify  — button events, IR hit events, ammo
 *   Control    E6F59D13  rw      — fire/reload/sync commands
 *   Config     E6F59D14  write   — weapon profile TLV + ShotConfig
 */

import { Device, Subscription } from 'react-native-ble-plx';

const SERVICE_UUID = 'e6f59d10-8230-4a5c-b22f-c062b1d329e3';
const TELEMETRY_UUID = 'e6f59d12-8230-4a5c-b22f-c062b1d329e3';
const CONTROL_UUID = 'e6f59d13-8230-4a5c-b22f-c062b1d329e3';
const CONFIG_UUID = 'e6f59d14-8230-4a5c-b22f-c062b1d329e3';

// Control characteristic action bitmask (see docs/recoil_protocol_BLE.md).
const ACTION = { NONE: 0x0000, SYNC: 0x0080 };

export interface WeaponProfile {
  triggerMode: number;
  rateOfFire: number;
  narrowIrPower: number;
  wideIrPower: number;
  muzzleLedPower: number;
  motorPower: number;
  muzzleFlashMode: number;
  flashParam1: number;
  flashParam2: number;
}

export interface IrEvent {
  shooterID: number;
  weaponID: number;
  shotCount: number;
  sensor: number;
  exists: boolean;
}

type Handler = (...args: any[]) => void;

// Per-shooter IR shot de-duplication (port of irDedup.js). Each gun stamps a
// 3-bit shot counter into its IR packets; a telemetry frame can also carry the
// same shot in both IR slots. A hit is a duplicate only when THIS shooter's
// counter is unchanged from the last hit accepted for that same shooter.
function createIrDeduper() {
  const lastShotByShooter = new Map<number, number>();
  return {
    reset() {
      lastShotByShooter.clear();
    },
    isNewShot(shooterID: number, shotCount: number): boolean {
      if (lastShotByShooter.get(shooterID) === shotCount) return false;
      lastShotByShooter.set(shooterID, shotCount);
      return true;
    },
  };
}

export class RecoilGun {
  private _device: Device | null = null;
  private _events: Record<string, Handler> = {};
  private _telemetrySub: Subscription | null = null;
  private _chain: Promise<unknown> = Promise.resolve();

  private _packetCounter: number | null = null;
  private _lastAmmo = 0;
  private _lastButtonCount = {
    trigger: 0,
    reload: 0,
    radio: 0,
    reset: 0,
    power: 0,
    recoil: 0,
  };
  private _irDeduper = createIrDeduper();

  // Shooter ID the gun has acknowledged (telemetry byte 16). Used to confirm a
  // setGunId()/SYNC actually latched.
  acceptedGunId: number | null = null;

  gunSettings = {
    shotId: 0,
    currentWeaponSlot: 0,
    ammo: 0,
    recoil: true,
    flashOnShot: true,
    weaponOverride: 0xff,
  };

  // Bind to a freshly-connected, services-discovered device. Resets per-session
  // state so a stale counter from a previous session can't mask the first hit.
  attach(device: Device) {
    this._device = device;
    this._packetCounter = null;
    this._lastAmmo = 0;
    this._lastButtonCount = {
      trigger: 0,
      reload: 0,
      radio: 0,
      reset: 0,
      power: 0,
      recoil: 0,
    };
    this._irDeduper.reset();
    this.acceptedGunId = null;
  }

  detach() {
    this._telemetrySub?.remove();
    this._telemetrySub = null;
    this._device = null;
  }

  on(eventName: string, handler: Handler) {
    this._events[eventName] = handler;
  }

  // ── Telemetry ────────────────────────────────────────────────────────────

  startTelemetry() {
    if (!this._device) return;
    this._telemetrySub = this._device.monitorCharacteristicForService(
      SERVICE_UUID,
      TELEMETRY_UUID,
      (err, char) => {
        if (err || !char?.value) return;
        this._handleTelemetry(char.value);
      },
    );
  }

  private _handleTelemetry(base64: string) {
    const view = base64ToDataView(base64);
    if (view.byteLength < 18) return;

    // Button edge detection via per-button counters (bytes 3–5, packed nibbles).
    const counts = {
      trigger: view.getUint8(3) & 0x0f,
      reload: (view.getUint8(3) & 0xf0) >> 4,
      radio: view.getUint8(4) & 0x0f,
      reset: (view.getUint8(4) & 0xf0) >> 4,
      power: view.getUint8(5) & 0x0f,
      recoil: (view.getUint8(5) & 0xf0) >> 4,
    };
    if (counts.trigger !== this._lastButtonCount.trigger)
      this._events.triggerBtn?.(counts.trigger);
    if (counts.reload !== this._lastButtonCount.reload)
      this._events.reloadBtn?.(counts.reload);
    if (counts.radio !== this._lastButtonCount.radio)
      this._events.radioBtn?.(counts.radio);
    if (counts.reset !== this._lastButtonCount.reset)
      this._events.resetBtn?.(counts.reset);
    if (counts.power !== this._lastButtonCount.power)
      this._events.powerBtn?.(counts.power);
    if (counts.recoil !== this._lastButtonCount.recoil)
      this._events.recoilBtn?.(counts.recoil);
    this._lastButtonCount = counts;

    const ammo = view.getUint8(14);
    // Byte 16 echoes the shooter ID the gun has latched; used by confirmGunId().
    this.acceptedGunId = view.getUint8(16);

    if (ammo !== this._lastAmmo) {
      this._events.ammoChanged?.(ammo);
      this._lastAmmo = ammo;
    }

    // IR Event 1 (bytes 8–10) and IR Event 2 (bytes 11–13).
    this._emitIrHit({
      shooterID: view.getUint8(9) >> 2,
      weaponID: (view.getUint16(8, true) >> 6) & 0x0f,
      shotCount: view.getUint8(8) & 0x07,
      sensor: (view.getUint8(10) & 0xf0) >> 4,
      exists: ((view.getUint8(10) & 0xf0) >> 4) !== 0,
    });
    this._emitIrHit({
      shooterID: view.getUint8(12) >> 2,
      weaponID: (view.getUint16(11, true) >> 6) & 0x0f,
      shotCount: view.getUint8(11) & 0x07,
      sensor: (view.getUint8(13) & 0xf0) >> 4,
      exists: ((view.getUint8(13) & 0xf0) >> 4) !== 0,
    });
  }

  private _emitIrHit(ev: IrEvent) {
    if (!ev.exists) return;
    if (!this._irDeduper.isNewShot(ev.shooterID, ev.shotCount)) return;
    this._events.irEvent?.(ev);
  }

  // ── Control commands ──────────────────────────────────────────────────────

  switchWeapon(slot: number) {
    this.gunSettings.currentWeaponSlot = slot;
    this._enqueue(() => this._sendControlPacket(0x0000));
  }

  // Assign this gun its shooter ID. Control byte 4 is what the gun stamps into
  // every outgoing IR shot; it must be latched with the SYNC action. A plain
  // settings write (0x0000) does not commit it.
  setGunId(shotId: number) {
    this.gunSettings.shotId = shotId;
    this._enqueue(() => this._sendControlPacket(ACTION.SYNC));
  }

  flash() {
    this._enqueue(() => this._sendControlPacket(0x0010));
  }

  removeClip() {
    this._enqueue(() => this._sendControlPacket(0x0002));
  }

  loadClip(ammoCount: number) {
    this.gunSettings.ammo = ammoCount;
    this._enqueue(() => this._sendControlPacket(0x0004));
  }

  updateSettings(newSettings: Partial<typeof this.gunSettings>) {
    Object.assign(this.gunSettings, newSettings);
    this._enqueue(() => this._updateShotConfig());
    this._enqueue(() => this._sendControlPacket(0x0000));
  }

  // Verify the gun latched the shooter ID we sent (telemetry byte 16 echoes the
  // accepted id). Re-send SYNC up to `retries` times. Non-fatal: resolves false.
  async confirmGunId(
    expectedId: number,
    { retries = 2, timeoutMs = 600 } = {},
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (await this._waitFor(() => this.acceptedGunId === expectedId, timeoutMs))
        return true;
      this.setGunId(expectedId); // re-send SYNC and wait again
    }
    return this.acceptedGunId === expectedId;
  }

  private _waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
      if (predicate()) return resolve(true);
      const start = Date.now();
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - start >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, 50);
    });
  }

  private async _sendControlPacket(controlAction: number) {
    if (!this._device) return;
    this._packetCounter =
      (this._packetCounter === null ? 0 : this._packetCounter + 1) % 16;
    const pkt = new Uint8Array(7);
    pkt[0] = this._packetCounter << 4;
    pkt[1] = 0;
    pkt[2] = controlAction & 0xff; // Action U16, little-endian
    pkt[3] = (controlAction >> 8) & 0xff;
    pkt[4] = this.gunSettings.shotId;
    pkt[5] = this.gunSettings.currentWeaponSlot;
    pkt[6] = this.gunSettings.ammo;
    await this._device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CONTROL_UUID,
      bytesToBase64(pkt),
    );
  }

  private async _updateShotConfig() {
    if (!this._device) return;
    let autoFeedback = 0x00;
    if (this.gunSettings.flashOnShot) autoFeedback |= 0x2;
    if (this.gunSettings.recoil) autoFeedback |= 0x1;
    const pkt = new Uint8Array(5);
    // ShotConfig ID 16, length 2: [autoFeedback, weaponOverride].
    pkt[0] = 16 & 0xff;
    pkt[1] = (16 >> 8) & 0xff;
    pkt[2] = 2;
    pkt[3] = autoFeedback;
    pkt[4] = this.gunSettings.weaponOverride;
    await this._device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CONFIG_UUID,
      bytesToBase64(pkt),
    );
  }

  // ── Weapon profile ────────────────────────────────────────────────────────

  setWeaponProfile(profile: WeaponProfile, slot: number): Promise<void> {
    return this._enqueue(() => this._setWeaponProfile(profile, slot));
  }

  private async _setWeaponProfile(profile: WeaponProfile, slot: number) {
    if (!this._device) return;
    const id = Math.min(Math.max(slot, 0), 11);
    const pkt = new Uint8Array(12);
    pkt[0] = id & 0xff; // weapon slot, little-endian U16
    pkt[1] = (id >> 8) & 0xff;
    pkt[2] = 0x09; // field count
    pkt[3] = profile.triggerMode;
    pkt[4] = profile.rateOfFire;
    pkt[5] = profile.narrowIrPower;
    pkt[6] = profile.wideIrPower;
    pkt[7] = profile.muzzleLedPower;
    pkt[8] = 0xff;
    pkt[9] = profile.motorPower;
    // byte 10: FlashLED1 (high nibble) | FlashLED2 (low nibble, unused = 0)
    pkt[10] = ((profile.muzzleFlashMode & 0x0f) << 4) | 0x00;
    // byte 11: FlashParam1 (high nibble) | FlashParam2 (low nibble)
    pkt[11] = ((profile.flashParam1 & 0x0f) << 4) | (profile.flashParam2 & 0x0f);
    await this._device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CONFIG_UUID,
      bytesToBase64(pkt),
    );
  }

  // ── Serial op queue ──────────────────────────────────────────────────────
  // ble-plx can drop or error concurrent writes to the same characteristic, so
  // every BLE operation is chained behind the previous one (mirrors the web
  // driver's _queue). Failures are swallowed so the chain never wedges.
  private _enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this._chain.then(fn, fn) as Promise<T>;
    this._chain = run.catch(() => undefined);
    return run;
  }
}

export const gun = new RecoilGun();

// ── base64 <-> bytes helpers ──────────────────────────────────────────────────

function base64ToDataView(b64: string): DataView {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new DataView(bytes.buffer);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
