# RecoilGun BLE Protocol

Version 2.4, Matteo Scordino, 16 Aug 2017.

Markdown based BLE protocol documentation, extracted from <https://github.com/SkyRocketToys/Recoil_Documentation/blob/master/Recoil_Protocol_BLE.docx>

## Introduction

The recoil gun firmware system interfaces with applications using BLE (Bluetooth Low Energy).

- BLE communicates via **Services**
- Each Service contains **Characteristics**
- Each Characteristic is a **20-byte data chunk**
- Characteristics can be:
  - Readable
  - Writable
  - Notified (push updates)

The data exchanged is **bit-packed** within these 20-byte chunks.

---

## Definitions

Example breakdown of a data chunk:

| Name | DataType | Description |
|------|--------|-------------|
| 1st bits | U4 | |
| 2nd bits | U4 | |
| 3rd bits | U8 | |

### Data Types

- **U4** = Unsigned 4-bit value; first the low nibble, then the high nibble of a byte
- **U8** = Unsigned 8-bit byte
- **U16** = Unsigned 16-bit little-endian word
- **S16** = Signed 2's complement 16-bit little-endian word
- **U32** = Unsigned 32-bit little-endian word
- **GUID** = 128-bit globally unique identifier, shown in hexadecimal

---

## Protocol

### BLE Advertising

- Interval: **187.5 ms**
- Contains:
  - Connectable flag
  - Service ID: `0x9D10`
  - Device Local Name

#### Device Local Name Format

- Normal: ASCII `SRG1_` prefix followed by the 16 hex characters of the device UUID (also available in the ID characteristic), e.g. `SRG1_BF7EB8569758B65F`
- Bootloader: `SRBX_YYYYYY`
  - `X` = 1 for rifles, 2 for pistols
  - `YYYYYY` = first 6 characters of the hex UUID, e.g. `SRB2_BF7EB8`

---

## BLE Services

The device implements:

The gun acts as a BLE peripheral and implements:

- `1800` (Generic Access)
- `1801` (Generic Attribute)
- **RecoilGun Service**

The original document also describes `180A` (Device Information, standard GATT) below. It is listed there as a service to implement for Apple test tools such as LightBlue, though the list of implemented services above names only 1800, 1801 and RecoilGun.

---

## Generic Access Service (1800)

- Characteristic: **Device Name**
  - GUID: `2A00`
  - Read/Write
  - Format: `SRG1_<UUID>` (e.g. `SRG1_BF7EB8569758B65F`)

---

## Device Information Service (180A)

Standard GATT service. Apple devices running test programs such as LightBlue prefer to have it implemented.

- Characteristic: Manufacturer Name String
  - GUID: `2A29`
  - Read

---

## RecoilGun Service

GUID: `E6F59D10-8230-4a5c-B22F-C062B1D329E3`

This service contains all the content from the gun. The gun needs only implement this service and the standard services. It contains at least 4 BLE characteristics.

---

## Characteristic: ID

GUID: `E6F59D11-8230-4a5c-B22F-C062B1D329E3`  
**Read**

Information about the gun identity. Lets the app detect which type of gun is connected (e.g. to show an image of that model).

| Field | Type | Description |
|------|-----|------------|
| Version | U16 | Firmware version: the SVN revision of the build. 0 = built with uncommitted changes (cannot be rebuilt from a clean checkout) |
| UUID | U8*8 | Unique, fixed identifier for this gun |
| GunModel | U8 | 1=Rifle, 2=Pistol |
| Padding | U8*3 | N/A |
| ConfigCRC | U32 | CRC32 of the current configuration |
| BL Version | U16 | Bootloader version: the SVN revision of the build. 0 = built with uncommitted changes |

> **Note:** the UUID is unrelated to the GunID used in Telemetry and Control. The UUID is a hardware-generated, globally unique ID (like a MAC address). The GunID is a logical ID supplied by the app, used to identify shots and bind them to the shooter.

---

## Characteristic: Telemetry

GUID: `E6F59D12-8230-4a5c-B22F-C062B1D329E3`  
**Read + Notify**

The app is expected to subscribe to this characteristic. It carries telemetry and controller values from the gun.

| Field | Type | Description |
|------|-----|------------|
| PktCnt | U4 | Counter of this packet |
| CmdCnt | U4 | Latest command counter received from the app |
| GunID | U8 | Identifier for this gun. `0x01`…`0x10` is valid, 0 is invalid |
| Buttons | U8 | Digital buttons from controller, one bit per button |
| Pressed | U4*6 | Number of times each button has been pressed (mod 16): trigger, reload, walkie talkie, reset, power, recoil cnt |
| Voltage | S16 | Battery voltage (mV). Formally signed, but a negative value is not expected |
| IrEvents | Struct{}*2 | Two IR events, see below |
| WeaponAmmo | U8 | Amount of ammo remaining for firing independently |
| GunFlags | U8 | Bit map, see below |
| Selected Weapon Type | U8 | Currently selected weapon type |
| Reserved | U8*3 | Reserved for future expansion |

### Button Bitmask

- `0x01` Trigger  
- `0x02` Reload  
- `0x04` Walkie-talkie  
- `0x08` Reset  
- `0x10` Power  
- `0x20` Recoil cnt  

### GunFlags

- `0x01` Reload mode (clip out, can't fire)
- `0x02` Clip-on IR sensor disconnected
- Other values are reserved for future use

### IR Events

Each of the two events is split across the packet:

- The 2 MSBs of each struct (bytes 8,9 and 11,12 of the packet) hold a **U16 infrared payload**, laid out as in the IR protocol document:
- The LSB of each struct (bytes 10 and 13 of the packet) holds:
  - U4 = counter of this event
  - U4 = which sensor it came from (0 = invalid; 1, 2, 4, 8 = IR sensor as a bit map)

| Bits | F | E | D | C | B | A | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
|------|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Type | Shooter ID | | | | | | Weapon ID | | | | Shot counter | | | | | |
| Grenade | G | G | G | G | G | G | 1 | 1 | J | J | J | J | S | S | S | S |
| Gun | A | A | A | A | A | A | W | W | W | W | R | R | R | C | C | C |

- **A** = id of the shooter as set by the application (1..16; default grenade id is 50)
- **W** = Weapon ID the shot comes from (0–11 for the gun, 12–15 for the grenade)
- **C** = counter of shots fired (counts up from 0 and wraps)
- **R** = rounds in a plasma shot: `rounds = (RRR + 1) * 4` (`RRR=0` → 4, `RRR=7` → 32)
- **G** = grenade id (6-bit hash of the 16-bit serial number)
- **J** = grenade random (4-bit random counter) for distinguishing grenade ids
- **S** = grenade state (mostly acts as a countdown timer)

When the gun is hit by another player's IR beam, the app sees it via an IrEvent containing:

- **Sensor ID**: there are 4 sensors that can receive the hit; this could be used to work out the direction of the hit.
- **Shot counter**: each bullet has a shot count so damage is only taken once. The firmware condenses the same shot seen by several sensors into one hit event, and the app can check that the shot ID differs between hit events so it never applies damage twice for one bullet.
- **Weapon type**: the weapon type currently set on the shooter's gun firmware.
- **Gun ID**: the id of the shooter, so the app can identify who it was.

---

## Characteristic: Control

GUID: `E6F59D13-8230-4a5c-B22F-C062B1D329E3`  
**Read + Write**

The app writes to this characteristic on occasion to control or guide the gun during gameplay.

| Field | Type | Description |
|------|-----|------------|
| PktCounter | U4 | Counter of this packet. The packet is ignored if this has not changed since the previous transmission |
| CmdCounter | U4 | Increments each time the following packet should be acted upon. Allows retransmission without duplicate actions |
| IR_ack | U8 | Sequence of infrared events that have been received |
| Action | U16 | Control actions to exert (bit mask) |
| GunID | U8 | Gun ID for shooting |
| WeaponType | U8 | Weapon id to use for firing (0–11 is valid, 12–15 is reserved for the grenade) |
| WeaponAmmo | U8 | Ammo remaining for firing independently. Only applied if the "Unset Reloading mode" action is set |
| Reserved | U8*13 | Reserved for future expansion. Sending these bytes is optional |

### Action Bitmask

| Value | Action |
|------|-------|
| 0x0000 | Do nothing |
| 0x0001 | Shoot gun, uses LED1, LED2 or both per selected weapon type |
| 0x0002 | Set reloading mode: cannot fire, "clip is out" |
| 0x0004 | Unset reloading mode and set ammo. Has priority over "Set reloading" if contemporaneous |
| 0x0008 | Recoil, per selected weapon type (currently fixed to 500ms, motor behaviour is not defined) |
| 0x0010 | Muzzle flash, per selected weapon type |
| 0x0020 | Turn power off in one second |
| 0x0040 | Output stats on UART (debug only) |
| 0x0080 | Sync (forget outstanding actions and IR events) |
| 0x0100 | Reboot to bootloader mode |

> **Ammo:** trigger presses are hardwired to the IR emitters in the firmware, so reloading is handled by the firmware's ammo count. To reload, the app sets the ammo count to the clip size; the firmware decrements it per shot and ignores the trigger at zero. When shooting via the BLE Shoot action the ammo count is **not** checked or decremented, so the app must implement its own ammo logic in that case.

---

## Characteristic: Config

GUID: `E6F59D14-8230-4a5c-B22F-C062B1D329E3`  
**Write**

The app writes to this characteristic whenever the config table CRC (see ID characteristic) does not match the CRC the app has. It alters the configuration table using TLV (Tag, Length, Value) format:

| Field | Type | Description |
|------|-----|------------|
| Tag | U16 | The config parameter to write to |
| Length | U8 | Length of the following value, in bytes |
| Value | U8*Length | Value to be written |

---

## Configuration Table

| ID | Name | Length (bytes) |
|----|------|----------------|
| 0–11 | WD0 to WD11 (Weapon Definition; ID n defines weapon n) | 9 |
| 16 | ShotConfig | 2 |
| 17 | IRConfig | 3 |
| 18–21 | TBD | |

### Weapon Definition (IDs 0–11, 9 bytes)

| Field | Type | Description |
|------|-----|------------|
| TriggerMode | U8 | Fire mode (see below) |
| RateOfFire | U8 | Repeat period, 50ms units (e.g. 2 = 100ms ≈ 10 rounds/sec) |
| PowerIR1 | U8 | Power for IR LED1 (long range). Internally scaled to 0–18 (18 = 100%), rounding down: 25 gives 25*18/255 = 1 (5.5% duty cycle) |
| PowerIR2 | U8 | Power for IR LED2 (short range), same scaling as PowerIR1 |
| PowerLED1 | U8 | Power for the green "muzzle" LED |
| PowerLED2 | U8 | Power for the white "power" LED. Only used in debug builds, LED2 is meant for power indication only |
| PowerMotor | U8 | Time the recoil motor runs, in units of 5ms. Default 18 (90ms, one recoil per shot). Corrected for battery voltage (motor is on unregulated VBAT) |

#### TriggerMode values

| Value | Mode | Behaviour |
|------|------|-----------|
| 0 | Plasma | Charges while held (4 rounds per rate-of-fire period), fires one accumulated shot on release |
| 1 | Single shot | One round per trigger press; nothing more until released (default) |
| 2–253 | N-round burst | One round on press, then one more per rate-of-fire period, up to N rounds (or trigger release / empty clip) |
| 254 | Full auto | One round on press, then one more per rate-of-fire period until trigger release or empty clip |
| 255 | Reserved | |

> **Note:** Burst, full-auto, and plasma all repeat on the **rate-of-fire period**. With `RateOfFire = 0` there is no period, so full auto fires only the single press shot and never repeats — it must be non-zero to fire continuously.

---

### Flash Settings

| Field | Type | Description |
|------|-----|------------|
| FlashLED1 | U4 | LED1 flash mode for gunshot: 0 = none, 1 = square wave (once per shot), 2 = glow (follows trigger and ammo, then starts a square wave on release), 3 = on (follows trigger) |
| FlashLED2 | U4 | LED2 flash mode, same values. Only used in debug builds |
| FlashParam1 | U4 | Square wave: number of flashes. Glow: number of flashes in the square wave on trigger release. Unused otherwise |
| FlashParam2 | U4 | Square wave: length of flash in 100ms steps. Glow: length of the first glow period in 500ms steps (gets faster while the trigger is held) and length of the final square wave flash in 100ms steps. Unused otherwise |

---

### ShotConfig (ID 16)

| Field | Type | Description |
|------|-----|------------|
| AutoFeedback | U4 | Bitmask, default `0x3`: `0x1` = auto recoil ON, `0x2` = auto flash on shooting ON (which LEDs flash depends on the weapon), `0x4` = auto flash on being shot ON (power LED flashes; debug builds only) |
| Unused | U4 | |
| TriggerOverride | U8 | Overrides the weapon-defined trigger mode. Default `0xFF` = use weapon-defined mode; `0x00` = plasma, `0x01`–`0xFD` = burst of up to N shots, `0xFE` = full auto |

---

### IRConfig (ID 17)

| Field | Type | Description |
|------|-----|------------|
| TXRepeats | U4 | Times each "bullet" packet is repeated over IR. Default 2. Too high a value makes the total transmission time exceed the rate-of-fire period, so bullets overlap and cancel each other out |
| TXFlags | U4 | Bitmask, default `0x1` = randomise TX times (with TXRepeats > 1 this makes simultaneous shots at one target less likely to cancel out) |
| RXEnable | U8 | Mask enabling each IR sensor. Default `0xF`. The source lists `0x01` = sensor 0 (gun), `0x02` = sensor 1 (gun), `0x03` = sensor 2 (gun), `0x04` = sensor 3 (clip-on); `0x03` is not a single bit, so the sensors are presumably bits 0–3 (`0x01`, `0x02`, `0x04`, `0x08`) as in the Telemetry sensor bit map |
| ClipCheckInterval | U8 | Period between presence tests of the clip-on sensor, in 500ms units. Absence is declared after 3 consecutive failed tests; presence is detected immediately. Each test disables the clip-on sensor for a few ms, so too low a value risks missed shots |

IRConfig deviations from the defaults can break the IR emitters and sensors and should be thoroughly tested.

---

## Notes

- The firmware is optimised to minimise lag between trigger press and output (IR beam, recoil, muzzle flash), so gun output is hooked directly to the trigger in firmware. The feedback details are essentially hardcoded.
- A "trigger mode" defines how the gun's systems activate on trigger press (e.g. plasma: muzzle LEDs glow while held, IR fires on release; burst: flash and fire IR repeatedly while held).
- A "weapon mode" tunes a trigger mode (e.g. muzzle LED brightness). The original document says up to 16 weapon modes can be activated in game, although the configuration table defines weapons 0–11 (IDs 12–15 are reserved for the grenade).
- The weapon mode also sets the weapon type sent in the IR beam when firing.

---

``
