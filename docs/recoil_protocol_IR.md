# Infrared Protocol for the Recoil Gun

Markdown based IR protocol documentation, extracted from <https://github.com/SkyRocketToys/Recoil_Documentation/blob/master/Recoil_Protocol_IR.docx>

## Overview

This document defines the **Infrared (IR) communication protocol** used by the Recoil Gun system.

---

## Hardware Details

### Transmitter

- LED: Vishay TSAL6100 (940nm)

### Receiver

- Vishay TSOP53338
  - 38kHz carrier
  - 13.16µs on/off
  - 6-cycle minimum burst (158µs)
  - 10-cycle minimum gap (263µs)

### Alternative Receivers

- TSOP4838
- YL20170309-366Y

---

## Protocol Options

### Timing

- Uses Manchester encoding
- Supported timings:
  - 400µs / 800µs
  - 600µs (increased range)

Polling resolution:

- 50µs interrupt (20kHz)

---

## Supported Protocols

- NEC32
- NEC20
- MAN20
- MAN16
- NEC9
- MAN9
- **MAN20A (used by gun)**
- NEC12
- **NEC4 (used by grenade)**

---

## Low-Level Format

### Encoding Types

#### NEC Encoding

- 0 → `MS`
- 1 → `MSSS`

#### Manchester Encoding

- 0 → `SM`
- 1 → `MS`

### Header

- NEC32: `16M + 8S`
- Others: `8M + 4S`

---

## Packet Format (MAN20A - Gun)

- Total: **20 bits**
  - 16-bit payload
  - 4-bit CRC

### Bit Layout

| Bits | Field |
|------|------|
| 15–10 | Shooter ID |
| 9–6 | Weapon ID |
| 5–0 | Shot Counter |

### Field Definitions

- **Shooter ID (A)**: 1–16 players  
- **Weapon ID (W)**:  
  - 0–11 = weapons  
  - 12–15 = grenade  
- **Shot Counter (C)**: increments per shot  
- **Rounds (R)**: `(RRR + 1) * 4`  
- **Grenade ID (G)**: hashed identifier  
- **Random (J)**: collision avoidance  
- **State (S)**: countdown / state  

---

## Rounds in Shot

Used to represent:

- Damage
- Simulated fire rate

---

## Packet Spacing

To avoid receiver saturation:

- Example strategy:
  - burst packets every 30ms
  - pause 100ms

---

## Sensor Independence

- 4 independent IR sensors
- Improves hit detection robustness

---

## Grenade Timing

- Broadcast sequentially across LEDs
- Encodes countdown (10 → 0)

---

## Grenade States

| ID | Name | ID | Name |
|----|------|----|------|
| 0 | Unarmed | 8 | State 6 |
| 1 | Cancelled | 9 | State 5 |
| 2 | Priming | 10 | State 4 |
| 3 | Primed | 11 | State 3 |
| 4 | 10 | 12 | State 2 |
| 5 | 9 | 13 | State 1 |
| 6 | 8 | 14 | Explode |
| 7 | 7 | 15 | Waiting |

---

## Grenade State Logic

### Key Behavior

| State | Description |
|------|------------|
| Unarmed | Initial state |
| Priming | Button held |
| Primed | Ready |
| Countdown | 10 → 1 |
| Explode | Damage applied |
| Cancelled | Aborted |

### Rules

- <0.25s press → start countdown
- >1s press → named kill mode
- Explosion occurs at state 14

---

## Alternative Grenade Protocols

### NEC12

- Header: `2400µs mark + space`
- 12-bit payload
- 4-bit CRC

#### Encoding

- 0 → `MS`
- 1 → `MSS`

#### Payload

| Field | Bits |
|------|------|
| CRC (P) | 4 |
| Random (J) | 4 |
| State (S) | 4 |

---

### NEC4

- Shortened version
- 4-bit payload

#### Format

- Header: same as NEC12
- Stop bit included

#### Payload

| Bits | Field |
|------|------|
| 3–0 | State |

---

## Notes

- Designed for **low latency gameplay**
- Uses **robust encoding and redundancy**
- IR packets carry key gameplay data:
  - Player ID
  - Weapon type
  - Shot count
  - Grenade state

---
