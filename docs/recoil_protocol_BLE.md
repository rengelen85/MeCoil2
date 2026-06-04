# RecoilGun BLE Protocol

Markdown based BLE protocol documentation, extracted from https://github.com/SkyRocketToys/Recoil_Documentation/blob/master/Recoil_Protocol_BLE.docx

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
- **U4** = Unsigned 4-bit
- **U8** = Unsigned 8-bit
- **U16** = Unsigned 16-bit (little-endian)
- **S16** = Signed 16-bit
- **U32** = Unsigned 32-bit
- **GUID** = 128-bit identifier

---

## Protocol

### BLE Advertising
- Interval: **187.5 ms**
- Contains:
  - Connectable flag
  - Service ID: `0x9D10`
  - Device Name

#### Device Name Format
- Normal: `SRG1_<UUID>`
- Bootloader:
  - `SRB1_XXXXXX` (rifle)
  - `SRB2_XXXXXX` (pistol)

---

## BLE Services

The device implements:
- `1800` (Generic Access)
- `180A` (Device Information)
- **RecoilGun Service**

---

## Generic Access Service (1800)

- Characteristic: **Device Name**
  - GUID: `2A00`
  - Read/Write
  - Format: `SRG1_<UUID>`

---

## Device Information Service (180A)

- Characteristic: Manufacturer Name
  - GUID: `2A29`
  - Read

---

## RecoilGun Service

GUID: `E6F59D10-8230-4a5c-B22F-C062B1D329E3`

Contains multiple characteristics.

---

## Characteristic: ID

GUID: `E6F59D11-...`

| Field | Type | Description |
|------|-----|------------|
| Version | U16 | Firmware version |
| UUID | U8*8 | Unique device ID |
| GunModel | U8 | 1=Rifle, 2=Pistol |
| Padding | U8*3 | |
| ConfigCRC | U32 | Config checksum |
| BL Version | U16 | Bootloader version |

---

## Characteristic: Telemetry

GUID: `E6F59D12-...`  
**Read + Notify**

| Field | Type | Description |
|------|-----|------------|
| PktCnt | U4 | Packet counter |
| CmdCnt | U4 | Last command counter |
| GunID | U8 | Gun identifier |
| Buttons | U8 | Bitmask inputs |
| Pressed | U4*6 | Button press counts |
| Voltage | S16 | Battery voltage (mV) |

### Button Bitmask
- `0x01` Trigger  
- `0x02` Reload  
- `0x04` Walkie-talkie  
- `0x08` Reset  
- `0x10` Power  
- `0x20` Recoil  

### IR Events

Includes:
- Shooter ID
- Weapon type
- Shot counter
- Sensor source

Used for:
- Hit detection
- Duplicate filtering
- Player identification

---

## Characteristic: Control

GUID: `E6F59D13-...`  
**Read + Write**

| Field | Type | Description |
|------|-----|------------|
| PktCounter | U4 | Must increment |
| CmdCounter | U4 | Prevent duplication |
| IR_ack | U8 | ACK received IR |
| Action | U16 | Bitmask actions |
| GunID | U8 | Shooter ID |
| WeaponType | U8 | Weapon |
| WeaponAmmo | U8 | Ammo |

### Action Bitmask

| Value | Action |
|------|-------|
| 0x0001 | Shoot |
| 0x0002 | Reload mode |
| 0x0004 | End reload + set ammo |
| 0x0008 | Recoil |
| 0x0010 | Muzzle flash |
| 0x0020 | Power off |
| 0x0080 | Sync |
| 0x0100 | Reboot |

---

## Characteristic: Config

GUID: `E6F59D14-...`  
**Write**

Uses TLV format:

| Field | Type |
|------|-----|
| Tag | U16 |
| Length | U8 |
| Value | bytes |

---

## Configuration Table

### Weapon Definition (IDs 0–11)

| Field | Type | Description |
|------|-----|------------|
| TriggerMode | U8 | Fire mode (see below) |
| RateOfFire | U8 | Repeat period, 50ms units (e.g. 2 = 100ms ≈ 10 rounds/sec) |
| PowerIR1 | U8 | Long-range IR |
| PowerIR2 | U8 | Short-range IR |
| PowerLED1 | U8 | Muzzle LED |
| PowerLED2 | U8 | Debug LED |
| PowerMotor | U8 | Recoil duration |

#### TriggerMode values

| Value | Mode | Behaviour |
|------|------|-----------|
| 0 | Plasma | Charges while held (4 rounds per rate-of-fire period), fires one accumulated shot on release |
| 1 | Single shot | One round per trigger press; nothing more until released |
| 2–253 | N-round burst | One round on press, then one more per rate-of-fire period, up to N rounds (or trigger release / empty clip) |
| 254 | Full auto | One round on press, then one more per rate-of-fire period until trigger release or empty clip |

> **Note:** Burst, full-auto, and plasma all repeat on the **rate-of-fire period**. With `RateOfFire = 0` there is no period, so full auto fires only the single press shot and never repeats — it must be non-zero to fire continuously.

---

### Flash Settings

| Field | Type | Description |
|------|-----|------------|
| FlashLED1 | U4 | LED1 mode |
| FlashLED2 | U4 | LED2 mode |
| FlashParam1 | U4 | Mode parameter |
| FlashParam2 | U4 | Mode parameter |

---

### ShotConfig (ID 16)

| Field | Type | Description |
|------|-----|------------|
| AutoFeedback | U4 | Recoil/flash flags |
| TriggerOverride | U8 | Override mode |

---

### IRConfig (ID 17)

| Field | Type | Description |
|------|-----|------------|
| TXRepeats | U4 | Repeat count |
| TXFlags | U4 | Randomization |
| RXEnable | U8 | Sensor enable |
| ClipCheckInterval | U8 | Check interval |

---

## Notes

- Firmware prioritizes **low latency**
- Trigger handling is **hardware-bound**
- Up to **16 weapon modes**
- Trigger modes define firing behavior

---
``