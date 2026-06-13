// ES-module port of the Scope project's recoilweapon.js (DroopCat/Scope)
// Converted from IIFE + window global to a named export singleton.

import { createIrDeduper } from './irDedup.js';

const CONFIG_UUID = 'e6f59d14-8230-4a5c-b22f-c062b1d329e3';
const TELEMETRY_UUID = 'e6f59d12-8230-4a5c-b22f-c062b1d329e3';
const CONTROL_UUID = 'e6f59d13-8230-4a5c-b22f-c062b1d329e3';
const ID_UUID = 'e6f59d11-8230-4a5c-b22f-c062b1d329e3';
const SERVICE_UUID = 'e6f59d10-8230-4a5c-b22f-c062b1d329e3';

// Control characteristic action bitmask (see docs/recoil_protocol_BLE.md).
const ACTION = { NONE: 0x0000, SYNC: 0x0080 };

function isBitSet(position, byte) {
  return (byte >> position) & 1;
}

// Module-level state — safe because we only ever create one RecoilGun instance.
let lastAmmo = 0;
let lastButtonCount = {
  trigger: 0,
  reload: 0,
  radio: 0,
  reset: 0,
  power: 0,
  recoil: 0,
};
// Per-shooter IR de-duplication (see irDedup.js for the why).
const irDeduper = createIrDeduper();
let packetCounter = null;

const BLE_LAST_DEVICE_KEY = 'ble_last_device';

class RecoilGun {
  constructor() {
    this._EVENTS = {};
    this._CONFIGCHAR = null;
    this._CONTROLCHAR = null;
    this._TELEMETRYCHAR = null;
    this._QUEUE = [];
    this._WORKING = false;
    this._device = null;
    this._onGattDisconnected = this._disconnect.bind(this);
    this._onTelemetry = this._handleTelemetry.bind(this);

    this.gunSettings = {
      shotId: 0,
      currentWeaponSlot: 0,
      ammo: 0,
      recoil: true,
      flashOnShot: true,
      weaponOverride: 0xff,
    };

    this.isConnected = false;
    this.telemetry = {};
    this.buttons = {};

    // Device info read from the ID characteristic on connect.
    this.gunModel = 'unknown'; // 'rifle' | 'pistol' | 'unknown'
    this.firmwareVersion = null;
    // Shooter ID the gun has acknowledged (telemetry byte 16). Used to confirm
    // that a setGunId()/SYNC actually latched.
    this.acceptedGunId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._queue(() => this._connect().then(resolve).catch(reject));
    });
  }

  // Reconnect to the same physical device without showing a picker. Returns
  // true on success, false if no stored device or connection fails.
  tryAutoConnect() {
    return new Promise((resolve, reject) => {
      this._queue(() => this._tryAutoConnect().then(resolve).catch(reject));
    });
  }

  // Reconnect to the already-stored device reference (mid-session recovery).
  // Returns true on success.
  reconnect() {
    return new Promise((resolve, reject) => {
      this._queue(() => this._reconnect().then(resolve).catch(reject));
    });
  }

  async _connect(providedDevice = null) {
    let device = providedDevice;
    if (!device) {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'SRG' }],
        optionalServices: [SERVICE_UUID],
      });
    }

    this._device = device;
    try {
      localStorage.setItem(BLE_LAST_DEVICE_KEY, device.name ?? '');
    } catch {}
    device.addEventListener('gattserverdisconnected', this._onGattDisconnected);

    const server = await device.gatt.connect();
    await this._initFromServer(server);

    irDeduper.reset();
    this.acceptedGunId = null;
    this.isConnected = true;
  }

  async _tryAutoConnect() {
    if (!navigator.bluetooth?.getDevices) {
      console.info(
        '[BLE] getDevices() not available — browser may not support it',
      );
      return false;
    }
    const devices = await navigator.bluetooth.getDevices();
    if (!devices.length) {
      console.info('[BLE] No previously-granted devices found');
      return false;
    }
    const lastName = localStorage.getItem(BLE_LAST_DEVICE_KEY) ?? '';
    const device =
      devices.find((d) => lastName && d.name === lastName) ??
      devices.find((d) => d.name?.startsWith('SRG'));
    if (!device) {
      console.info(
        '[BLE] No SRG device in granted list — found:',
        devices.map((d) => d.name),
      );
      return false;
    }
    console.info(`[BLE] Attempting auto-connect to ${device.name}…`);
    // After a page refresh the gun may need a moment to drop the previous
    // connection and start advertising again. Retry up to 3 times with a
    // short delay so transient failures don't silently prevent reconnection.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this._connect(device);
        return true;
      } catch (e) {
        console.info(
          `[BLE] Auto-connect attempt ${attempt}/3 failed:`,
          e.message ?? e,
        );
        if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
      }
    }
    return false;
  }

  async _reconnect() {
    if (!this._device || this.isConnected) return false;
    try {
      const server = await this._device.gatt.connect();
      await this._initFromServer(server);
      irDeduper.reset();
      this.isConnected = true;
      return true;
    } catch {
      return false;
    }
  }

  async _initFromServer(server) {
    const service = await server.getPrimaryService(SERVICE_UUID);
    this._CONTROLCHAR = await service.getCharacteristic(CONTROL_UUID);
    this._CONFIGCHAR = await service.getCharacteristic(CONFIG_UUID);
    this._TELEMETRYCHAR = await service.getCharacteristic(TELEMETRY_UUID);

    // Read the ID characteristic once: byte 10 is the gun model (1 = rifle,
    // 2 = pistol) and bytes 0-1 are the firmware version (little-endian). A
    // failed read must not abort the connection.
    try {
      const idChar = await service.getCharacteristic(ID_UUID);
      const id = await idChar.readValue();
      this.firmwareVersion = id.getUint16(0, true);
      this.gunModel = { 1: 'rifle', 2: 'pistol' }[id.getUint8(10)] ?? 'unknown';
    } catch {
      this.gunModel = 'unknown';
    }
  }

  startTelemetry() {
    return new Promise((resolve, reject) => {
      try {
        this._TELEMETRYCHAR.addEventListener(
          'characteristicvaluechanged',
          this._onTelemetry,
        );
        this._queue(() =>
          this._TELEMETRYCHAR.startNotifications().then(resolve),
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  async stopTelemetry() {
    await this._TELEMETRYCHAR.stopNotifications();
    this._TELEMETRYCHAR.removeEventListener(
      'characteristicvaluechanged',
      this._onTelemetry,
    );
  }

  switchWeapon(slot) {
    this.gunSettings.currentWeaponSlot = slot;
    this.sendControlPacket(0x0000);
  }

  // Assign this gun its shooter ID. Control byte 4 is what the gun stamps into
  // every outgoing IR shot (payload bits 10-15), so it must be latched with the
  // SYNC action. A plain settings write (0x0000) does not commit it. Confirmed
  // in the official Recoil app, SimpleCoil and FreeCoil.
  setGunId(shotId) {
    this.gunSettings.shotId = shotId;
    this.sendControlPacket(ACTION.SYNC);
  }

  // Verify the gun latched the shooter ID we sent. Telemetry byte 16 echoes the
  // accepted shooter ID; re-send SYNC up to `retries` times if it hasn't been
  // acknowledged yet. Non-fatal: resolves false (caller logs) rather than
  // throwing. The byte-16 meaning is reverse-engineered (FreeCoil) and should be
  // validated against real hardware.
  async confirmGunId(expectedId, { retries = 2, timeoutMs = 600 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (
        await this._waitFor(() => this.acceptedGunId === expectedId, timeoutMs)
      )
        return true;
      this.setGunId(expectedId); // re-send SYNC and wait again
    }
    return this.acceptedGunId === expectedId;
  }

  _waitFor(predicate, timeoutMs) {
    return new Promise((resolve) => {
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

  powerOff() {
    this.sendControlPacket(0x0020);
  }
  recoil() {
    this.sendControlPacket(0x0008);
  }
  flash() {
    this.sendControlPacket(0x0010);
  }
  shoot() {
    this.sendControlPacket(0x0001);
  }
  removeClip() {
    this.sendControlPacket(0x0002);
  }

  loadClip(ammoCount) {
    this.gunSettings.ammo = ammoCount;
    this.sendControlPacket(0x0004);
  }

  updateSettings(newSettings) {
    Object.assign(this.gunSettings, newSettings);
    this._queue(() => this._updateShotConfig());
    this.sendControlPacket(0x0000);
  }

  _disconnect() {
    this.isConnected = false;
    // Discard any pending queue items — they'd fail against a dead GATT server
    // and leave _WORKING=true, which would block the subsequent reconnect call.
    this._QUEUE.length = 0;
    this._WORKING = false;
    this._EVENTS.disconnected?.();
  }

  sendControlPacket(controlAction) {
    this._queue(() => this._sendControlPacket(controlAction));
  }

  async _sendControlPacket(controlAction) {
    packetCounter = (packetCounter === null ? 0 : packetCounter + 1) % 16;
    const buffer = new ArrayBuffer(7);
    const view = new DataView(buffer);
    view.setUint8(0, packetCounter << 4);
    view.setUint16(2, controlAction, true);
    view.setUint8(4, this.gunSettings.shotId);
    view.setUint8(5, this.gunSettings.currentWeaponSlot);
    view.setUint8(6, this.gunSettings.ammo);
    await this._CONTROLCHAR.writeValue(buffer);
  }

  async _updateShotConfig() {
    let autoFeedback = 0x00;
    if (this.gunSettings.flashOnShot) autoFeedback |= 0x2;
    if (this.gunSettings.recoil) autoFeedback |= 0x1;

    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint16(0, 16, true);
    view.setUint8(2, 2);
    view.setUint8(3, autoFeedback);
    view.setUint8(4, this.gunSettings.weaponOverride);
    await this._CONFIGCHAR.writeValue(buffer);
  }

  _handleTelemetry(event) {
    const value = event.target.value;
    const telemetry = {};

    const buttonByte = value.getUint8(2);
    telemetry.buttons = {
      trigger: isBitSet(0, buttonByte),
      reload: isBitSet(1, buttonByte),
      radio: isBitSet(2, buttonByte),
      power: isBitSet(4, buttonByte),
      recoil: isBitSet(5, buttonByte),
    };
    this.buttons = telemetry.buttons;

    telemetry.buttonCount = {
      trigger: value.getUint8(3) & 0x0f,
      reload: (value.getUint8(3) & 0xf0) >> 4,
      radio: value.getUint8(4) & 0x0f,
      reset: (value.getUint8(4) & 0xf0) >> 4,
      power: value.getUint8(5) & 0x0f,
      recoil: (value.getUint8(5) & 0xf0) >> 4,
    };

    const counts = telemetry.buttonCount;
    if (counts.trigger !== lastButtonCount.trigger)
      this._EVENTS.triggerBtn?.(counts.trigger);
    if (counts.reload !== lastButtonCount.reload)
      this._EVENTS.reloadBtn?.(counts.reload);
    if (counts.radio !== lastButtonCount.radio)
      this._EVENTS.radioBtn?.(counts.radio);
    if (counts.reset !== lastButtonCount.reset)
      this._EVENTS.resetBtn?.(counts.reset);
    if (counts.power !== lastButtonCount.power)
      this._EVENTS.powerBtn?.(counts.power);
    if (counts.recoil !== lastButtonCount.recoil)
      this._EVENTS.recoilBtn?.(counts.recoil);
    lastButtonCount = { ...counts };

    telemetry.batteryVoltage = value.getInt16(6, true);
    telemetry.ammo = value.getUint8(14);
    telemetry.flags = value.getUint8(15);
    // Byte 16 echoes the shooter ID the gun has latched; byte 17 echoes the
    // active weapon-profile slot (FreeCoil decode). Used to confirm setGunId().
    telemetry.playerIdAccepted = value.getUint8(16);
    telemetry.weaponProfileEcho = value.getUint8(17);
    this.acceptedGunId = telemetry.playerIdAccepted;

    if (telemetry.ammo !== lastAmmo) {
      this._EVENTS.ammoChanged?.(telemetry.ammo);
      lastAmmo = telemetry.ammo;
    }

    // IR Event 1
    const ir1 = {
      rawPayload: value.getUint16(8, true),
      sensor: (value.getUint8(10) & 0xf0) >> 4,
      shooterID: value.getUint8(9) >> 2,
      weaponID: (value.getUint16(8, true) >> 6) & 0x0f,
      plasmaRounds: (value.getUint8(8) >> 3) & 0x07,
      shotCount: value.getUint8(8) & 0x07,
      eventCount: value.getUint8(10) & 0x0f,
    };
    ir1.exists = ir1.sensor !== 0;
    this._emitIrHit(ir1);

    // IR Event 2
    const ir2 = {
      rawPayload: value.getUint16(11, true),
      sensor: (value.getUint8(13) & 0xf0) >> 4,
      shooterID: value.getUint8(12) >> 2,
      weaponID: (value.getUint16(11, true) >> 6) & 0x0f,
      plasmaRounds: (value.getUint8(11) >> 3) & 0x07,
      shotCount: value.getUint8(11) & 0x07,
      eventCount: value.getUint8(13) & 0x0f,
    };
    ir2.exists = ir2.sensor !== 0;
    this._emitIrHit(ir2);

    this._EVENTS.telemetry?.(telemetry);
    this.telemetry = telemetry;
  }

  // Emit an IR hit unless it duplicates this shooter's previous shot.
  _emitIrHit(ev) {
    if (!ev.exists) return;
    if (!irDeduper.isNewShot(ev.shooterID, ev.shotCount)) return;
    this._EVENTS.irEvent?.(ev);
  }

  setWeaponProfile(weaponProfile, slot) {
    return new Promise((resolve, reject) => {
      this._queue(() =>
        this._setWeaponProfile(weaponProfile, slot).then(resolve).catch(reject),
      );
    });
  }

  async _setWeaponProfile(weaponProfile, slot) {
    const id = Math.min(Math.max(slot, 0), 11);
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);
    view.setUint16(0, id, true);
    view.setUint8(2, 0x09);
    view.setUint8(3, weaponProfile.triggerMode);
    view.setUint8(4, weaponProfile.rateOfFire);
    view.setUint8(5, weaponProfile.narrowIrPower);
    view.setUint8(6, weaponProfile.wideIrPower);
    view.setUint8(7, weaponProfile.muzzleLedPower);
    view.setUint8(8, 0xff);
    view.setUint8(9, weaponProfile.motorPower);
    // byte 10: FlashLED1 (high nibble) | FlashLED2 (low nibble, unused = 0)
    view.setUint8(10, ((weaponProfile.muzzleFlashMode & 0x0f) << 4) | 0x00);
    // byte 11: FlashParam1 (high nibble) | FlashParam2 (low nibble)
    view.setUint8(
      11,
      ((weaponProfile.flashParam1 & 0x0f) << 4) |
        (weaponProfile.flashParam2 & 0x0f),
    );
    await this._CONFIGCHAR.writeValue(buffer);
  }

  on(eventName, handler) {
    this._EVENTS[eventName] = handler;
  }

  _queue(fn) {
    const run = () => {
      if (!this._QUEUE.length) {
        this._WORKING = false;
        return;
      }
      this._WORKING = true;
      this._QUEUE.shift()().then(run, run);
    };
    this._QUEUE.push(fn);
    if (!this._WORKING) run();
  }
}

export const gun = new RecoilGun();
