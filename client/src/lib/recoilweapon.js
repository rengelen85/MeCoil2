// ES-module port of the Scope project's recoilweapon.js (DroopCat/Scope)
// Converted from IIFE + window global to a named export singleton.

const CONFIG_UUID      = 'e6f59d14-8230-4a5c-b22f-c062b1d329e3';
const TELEMETRY_UUID   = 'e6f59d12-8230-4a5c-b22f-c062b1d329e3';
const CONTROL_UUID     = 'e6f59d13-8230-4a5c-b22f-c062b1d329e3';
const SERVICE_UUID     = 'e6f59d10-8230-4a5c-b22f-c062b1d329e3';

function isBitSet(position, byte) {
  return (byte >> position) & 1;
}

// Module-level state — safe because we only ever create one RecoilGun instance.
let lastAmmo = 0;
let lastButtonCount = { trigger: 0, reload: 0, radio: 0, reset: 0, power: 0, recoil: 0 };
let lastShotCount = 0;
let packetCounter = null;

class RecoilGun {
  constructor() {
    this._EVENTS   = {};
    this._CONFIGCHAR    = null;
    this._CONTROLCHAR   = null;
    this._TELEMETRYCHAR = null;
    this._QUEUE    = [];
    this._WORKING  = false;

    this.gunSettings = {
      shotId: 0,
      currentWeaponSlot: 0,
      ammo: 0,
      recoil: true,
      flashOnShot: true,
      weaponOverride: 0xff,
    };

    this.isConnected = false;
    this.telemetry   = {};
    this.buttons     = {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._queue(() => this._connect().then(resolve).catch(reject));
    });
  }

  _connect() {
    return new Promise(async (resolve, reject) => {
      try {
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ namePrefix: 'SRG' }],
          optionalServices: [SERVICE_UUID],
        });

        device.addEventListener('gattserverdisconnected', this._disconnect.bind(this));
        const server  = await device.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);

        this._CONTROLCHAR   = await service.getCharacteristic(CONTROL_UUID);
        this._CONFIGCHAR    = await service.getCharacteristic(CONFIG_UUID);
        this._TELEMETRYCHAR = await service.getCharacteristic(TELEMETRY_UUID);

        this.isConnected = true;
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  startTelemetry() {
    return new Promise(async (resolve, reject) => {
      try {
        this._TELEMETRYCHAR.addEventListener(
          'characteristicvaluechanged',
          this._handleTelemetry.bind(this),
        );
        this._queue(() => this._TELEMETRYCHAR.startNotifications().then(resolve));
      } catch (e) {
        reject(e);
      }
    });
  }

  stopTelemetry() {
    return new Promise(async (resolve, reject) => {
      try {
        await this._TELEMETRYCHAR.stopNotifications();
        this._TELEMETRYCHAR.removeEventListener(
          'characteristicvaluechanged',
          this._handleTelemetry.bind(this),
        );
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  switchWeapon(slot) {
    this.gunSettings.currentWeaponSlot = slot;
    this.sendControlPacket(0x0000);
  }

  setGunId(shotId) {
    this.gunSettings.shotId = shotId;
    this.sendControlPacket(0x0000);
  }

  powerOff()          { this.sendControlPacket(0x0020); }
  recoil()            { this.sendControlPacket(0x0008); }
  flash()             { this.sendControlPacket(0x0010); }
  shoot()             { this.sendControlPacket(0x0001); }
  removeClip()        { this.sendControlPacket(0x0002); }

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
    this._EVENTS['disconnected']?.();
  }

  sendControlPacket(controlAction) {
    this._queue(() => this._sendControlPacket(controlAction));
  }

  _sendControlPacket(controlAction) {
    return new Promise(async (resolve, reject) => {
      packetCounter = (packetCounter === null ? 0 : packetCounter + 1) % 16;
      const buffer = new ArrayBuffer(7);
      const view   = new DataView(buffer);
      view.setUint8(0,  packetCounter << 4);
      view.setUint16(2, controlAction, true);
      view.setUint8(4,  this.gunSettings.shotId);
      view.setUint8(5,  this.gunSettings.currentWeaponSlot);
      view.setUint8(6,  this.gunSettings.ammo);
      try {
        await this._CONTROLCHAR.writeValue(buffer);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  _updateShotConfig() {
    return new Promise(async (resolve, reject) => {
      let autoFeedback = 0x00;
      if (this.gunSettings.flashOnShot) autoFeedback |= 0x2;
      if (this.gunSettings.recoil)      autoFeedback |= 0x1;

      const buffer = new ArrayBuffer(5);
      const view   = new DataView(buffer);
      view.setUint16(0, 16, true);
      view.setUint8(2, 2);
      view.setUint8(3, autoFeedback);
      view.setUint8(4, this.gunSettings.weaponOverride);
      try {
        await this._CONFIGCHAR.writeValue(buffer);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  _handleTelemetry(event) {
    const value    = event.target.value;
    const telemetry = {};

    const buttonByte = value.getUint8(2);
    telemetry.buttons = {
      trigger: isBitSet(0, buttonByte),
      reload:  isBitSet(1, buttonByte),
      radio:   isBitSet(2, buttonByte),
      power:   isBitSet(4, buttonByte),
      recoil:  isBitSet(5, buttonByte),
    };
    this.buttons = telemetry.buttons;

    telemetry.buttonCount = {
      trigger: value.getUint8(3) & 0x0f,
      reload:  (value.getUint8(3) & 0xf0) >> 4,
      radio:   value.getUint8(4) & 0x0f,
      reset:   (value.getUint8(4) & 0xf0) >> 4,
      power:   value.getUint8(5) & 0x0f,
      recoil:  (value.getUint8(5) & 0xf0) >> 4,
    };

    const counts = telemetry.buttonCount;
    if (counts.trigger !== lastButtonCount.trigger) this._EVENTS['triggerBtn']?.(counts.trigger);
    if (counts.reload  !== lastButtonCount.reload)  this._EVENTS['reloadBtn']?.(counts.reload);
    if (counts.radio   !== lastButtonCount.radio)   this._EVENTS['radioBtn']?.(counts.radio);
    if (counts.reset   !== lastButtonCount.reset)   this._EVENTS['resetBtn']?.(counts.reset);
    if (counts.power   !== lastButtonCount.power)   this._EVENTS['powerBtn']?.(counts.power);
    if (counts.recoil  !== lastButtonCount.recoil)  this._EVENTS['recoilBtn']?.(counts.recoil);
    lastButtonCount = { ...counts };

    telemetry.batteryVoltage = value.getInt16(6, true);
    telemetry.ammo           = value.getUint8(14);
    telemetry.flags          = value.getUint8(15);
    telemetry.weaponType     = value.getUint8(16);

    if (telemetry.ammo !== lastAmmo) {
      this._EVENTS['ammoChanged']?.(telemetry.ammo);
      lastAmmo = telemetry.ammo;
    }

    // IR Event 1
    const ir1 = {
      rawPayload:   value.getUint16(8, true),
      sensor:       (value.getUint8(10) & 0xf0) >> 4,
      shooterID:    value.getUint8(9) >> 2,
      weaponID:     (value.getUint16(8, true) >> 6) & 0x0f,
      plasmaRounds: (value.getUint8(8) >> 3) & 0x07,
      shotCount:    value.getUint8(8) & 0x07,
      eventCount:   value.getUint8(10) & 0x0f,
    };
    ir1.exists = ir1.sensor !== 0;
    if (ir1.exists && ir1.shotCount !== lastShotCount) {
      this._EVENTS['irEvent']?.(ir1);
      lastShotCount = ir1.shotCount;
    }

    // IR Event 2
    const ir2 = {
      rawPayload:   value.getUint16(11, true),
      sensor:       (value.getUint8(13) & 0xf0) >> 4,
      shooterID:    value.getUint8(12) >> 2,
      weaponID:     (value.getUint16(11, true) >> 6) & 0x0f,
      plasmaRounds: (value.getUint8(11) >> 3) & 0x07,
      shotCount:    value.getUint8(11) & 0x07,
      eventCount:   value.getUint8(13) & 0x0f,
    };
    ir2.exists = ir2.sensor !== 0;
    if (ir2.exists && ir2.shotCount !== lastShotCount) {
      this._EVENTS['irEvent']?.(ir2);
      lastShotCount = ir2.shotCount;
    }

    this._EVENTS['telemetry']?.(telemetry);
    this.telemetry = telemetry;
  }

  setWeaponProfile(weaponProfile, slot) {
    return new Promise((resolve, reject) => {
      this._queue(() => this._setWeaponProfile(weaponProfile, slot).then(resolve).catch(reject));
    });
  }

  _setWeaponProfile(weaponProfile, slot) {
    return new Promise(async (resolve, reject) => {
      const id     = Math.min(Math.max(slot, 0), 11);
      const buffer = new ArrayBuffer(12);
      const view   = new DataView(buffer);
      view.setUint16(0, id, true);
      view.setUint8(2,  0x09);
      view.setUint8(3,  weaponProfile.triggerMode);
      view.setUint8(4,  weaponProfile.rateOfFire);
      view.setUint8(5,  weaponProfile.narrowIrPower);
      view.setUint8(6,  weaponProfile.wideIrPower);
      view.setUint8(7,  weaponProfile.muzzleLedPower);
      view.setUint8(8,  0xff);
      view.setUint8(9,  weaponProfile.motorPower);
      // byte 10: FlashLED1 (high nibble) | FlashLED2 (low nibble, unused = 0)
      view.setUint8(10, ((weaponProfile.muzzleFlashMode & 0x0f) << 4) | 0x00);
      // byte 11: FlashParam1 (high nibble) | FlashParam2 (low nibble)
      view.setUint8(11, ((weaponProfile.flashParam1 & 0x0f) << 4) | (weaponProfile.flashParam2 & 0x0f));
      try {
        await this._CONFIGCHAR.writeValue(buffer);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  on(eventName, handler) {
    this._EVENTS[eventName] = handler;
  }

  _queue(fn) {
    const run = () => {
      if (!this._QUEUE.length) { this._WORKING = false; return; }
      this._WORKING = true;
      this._QUEUE.shift()().then(run);
    };
    this._QUEUE.push(fn);
    if (!this._WORKING) run();
  }
}

export const gun = new RecoilGun();
