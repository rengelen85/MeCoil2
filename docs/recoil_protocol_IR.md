# Infrared Protocol for the Recoil Gun

Markdown based IR protocol documentation, extracted from <https://github.com/SkyRocketToys/Recoil_Documentation/blob/master/Recoil_Protocol_IR.docx>

| Version | Author | Date | Change |
|---------|--------|------|--------|
| 1.0 | Carl Muller | 6 February 2016 | Initial version |
| 1.1 | Carl Muller | 19 May 2017 | Specify grenade logic and states |
| 1.2 | Carl Muller | 24 May 2017 | Change logic for priming |
| 1.3 | Carl Muller | 21 June 2017 | Change protocol format to attempt to increase grenade range |

## Overview

This is a proposal for the **Infrared (IR) protocol** for the Recoil Gun project.

---

## Hardware Details

### Transmitter

- LED: Vishay TSAL6100 (940nm peak wavelength), [datasheet](http://www.vishay.com/docs/81009/tsal6100.pdf), or a cheaper Chinese equivalent.

### Receiver

- Vishay TSOP53338, [datasheet](http://www.vishay.com/docs/82745/tsop531.pdf)
  - 38kHz carrier (13.16µs on, 13.16µs off)
  - 6-cycle minimum burst length (158µs)
  - 10-cycle minimum gap (263µs) after a burst of 6 to 35 cycles

### Alternative Receivers

Depending on stock availability these may be used instead:

- Vishay TSOP4838
- Y-lin YL20170309-366Y

---

## Protocol Options

Two defines independently control the format of the IR protocol: the tick (timing) and `SUPPORT_PROTOCOL`.

### Timing

The tick controls the timing of the output pulses (mark and space).

- `SUPPORT_FAST_TICK` is no longer supported on the grenade. It used to be:
  - 0 = 560µs (TV remote control standard, ~21 pulses)
  - 1 = 320µs (~12 pulses)
  - 2 = 420µs (16 pulses)
- It was replaced by 400µs / 800µs marks and spaces (~15 or ~30 pulses), since the carrier is 38kHz and Manchester (bi-phase) coding is used.
- As of 21 June (v1.3), 600µs marks and spaces are supported to try to increase range.

When polling, the interrupt runs 8 times faster than the tick (reading a 400µs pulse requires a 50µs interrupt, i.e. 20kHz).

### SUPPORT_PROTOCOL

| Protocol | Description |
|----------|-------------|
| `PROTOCOL_NEC32` | NEC protocol with 32-bit payload (16-bit id) and full length header (TV remote control standard). Other protocols use shorter header pulses |
| `PROTOCOL_NEC20` | NEC protocol with 20-bit payload |
| `PROTOCOL_MAN20` | Manchester protocol with 20-bit payload (13-bit id) |
| `PROTOCOL_MAN16` | Manchester protocol with 16-bit payload (pure serial number) |
| `PROTOCOL_NEC9` | NEC protocol with 9-bit payload (4-bit id) |
| `PROTOCOL_MAN9` | Manchester protocol with 9-bit payload (4-bit id) |
| **`PROTOCOL_MAN20A`** | Manchester protocol with 20-bit payload (16-bit id). **This is the one used for the gun** |
| `PROTOCOL_NEC12` | Shortened NEC protocol with 12-bit payload |
| **`PROTOCOL_NEC4`** | Shortened NEC protocol with 4-bit payload. **This is the one used for the grenade** |

---

## Low-Level Format

Two methods of coding bits are supported: NEC and Manchester. In the notation below, `M` (Mark) is a burst of pulses on a 38kHz carrier and `S` (Space) is an absence of carrier.

### NEC Encoding

- 0 → `MS`
- 1 → `MSSS`

### Manchester Encoding

- 0 → `SM`
- 1 → `MS`

### Header

Both formats begin with a long header pulse.

- NEC32: `MMMMMMMMMMMMMMMMSSSSSSSS` (16 marks, 8 spaces; at the 560µs tick this is a 9ms pulse and a 4.5ms gap)
- Other protocols: `MMMMMMMMSSSS` (8 marks, 4 spaces)

---

## Packet Format (MAN20A)

The MAN20A packet has **16 bits of payload and 4 bits of CRC** (20 bits in total).

The payload includes the id of the shooter (6 bits, to allow expansion to 64 players), the weapon type (4 bits, 0..11 for normal weapons and 12..15 reserved for grenades) and the shot counter.

### Bit Layout (payload)

| Bits | 15 | 14 | 13 | 12 | 11 | 10 | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
|------|----|----|----|----|----|----|---|---|---|---|---|---|---|---|---|---|
| Type | Shooter ID | | | | | | Weapon ID | | | | Shot counter | | | | | |
| Grenade | G | G | G | G | G | G | 1 | 1 | J | J | J | J | S | S | S | S |
| Gun | A | A | A | A | A | A | W | W | W | W | R | R | R | C | C | C |

For a gun the 6-bit shot counter field is split into 3 bits of rounds (`R`, bits 5–3) and a 3-bit shot counter (`C`, bits 2–0).

### Field Definitions

- **A** = id of the gun as set by the application (1..16; default grenade id is 50)
- **W** = Weapon ID the shot comes from (0–11 for the gun, 12–15 for the grenade)
- **C** = counter of shots fired (counts up from 0 and wraps)
- **R** = rounds in a plasma shot: `rounds = (RRR + 1) * 4`, e.g. `RRR=0` → 4 rounds, `RRR=7` → 32 rounds
- **G** = grenade id (6-bit hash of the 16-bit serial number)
- **J** = grenade random (4-bit random counter) for distinguishing grenade ids
- **S** = grenade state (mostly acts as a countdown timer)

---

## Rounds in the Shot

Used to convey the "damage dealt" by a plasma mode shot. It could also be used to artificially increase the in-game rate of fire without increasing the actual data rate (10 packets per second each containing 2 rounds would give a simulated in-game rate of fire of 20Hz).

---

## Packet Spacing

Packets should be paced so that the infrared receiver is not saturated.

One method used on a previous project was several packets at 30ms intervals, then a 100ms gap.

---

## Sensor Independence

There are 4 independent IR sensors on the gun. They need to be processed independently to make signal reception more robust.

---

## Grenade Timing

The firmware cycles through the connected LED pairs, outputting the same codes to each LED sequentially. The codes include the timing of the explosion in seconds: 0 during the explosion, 10 to 1 in the countdown to the explosion.

### Grenade States

| ID | Name | ID | Name |
|----|------|----|------|
| 0 | state_unarmed | 8 | state_6 |
| 1 | state_cancelled | 9 | state_5 |
| 2 | state_priming | 10 | state_4 |
| 3 | state_primed | 11 | state_3 |
| 4 | state_10 | 12 | state_2 |
| 5 | state_9 | 13 | state_1 |
| 6 | state_8 | 14 | state_explode |
| 7 | state_7 | 15 | state_waiting |

### Grenade State Logic

Initial state: if the button is held down after 0.25 seconds then set the state to "waiting" (for named kills: if the button is held for 1 second, else "10"), otherwise set the state to "10" (anonymous kill).

End state name: "off".

| # | Name | Button Up | Time out | LED | App |
|---|------|-----------|----------|-----|-----|
| 0 | Unarmed | X | X | X | (Does not see this state) |
| 1 | Cancelled | X | Off | Off | Could tell the user "that was close!" |
| 2 | Priming | Primed | X | Fast | Could give sfx to user |
| 3 | Primed | X | 10 | Solid | Must remember for awarding kills. Could give sfx to user |
| 4 | 10 | Cancelled | 9 | Slow | Could give ticking sfx to user |
| 5 | 9 | Cancelled | 8 | Slow | Could give ticking sfx to user |
| 6 | 8 | Cancelled | 7 | Slow | Could give ticking sfx to user |
| 7 | 7 | Cancelled | 6 | Slow | Could give ticking sfx to user |
| 8 | 6 | Cancelled | 5 | Medium | Could give ticking sfx to user |
| 9 | 5 | Cancelled | 4 | Medium | Could give ticking sfx to user |
| 10 | 4 | Cancelled | 3 | Medium | Could give ticking sfx to user |
| 11 | 3 | Cancelled | 2 | Fast | Could give ticking sfx to user |
| 12 | 2 | Cancelled | 1 | Fast | Could give ticking sfx to user |
| 13 | 1 | Cancelled | Explode | Fast | Could give ticking sfx to user |
| 14 | Explode | X | Off | Solid | Give damage to user |
| 15 | Waiting | 10 | Priming | Solid | (Does not see this state) |

`X` means the input is ignored in that state.

---

## Alternative Grenade Protocol: NEC12

Used by the grenade to provide greater range when using Y-lin receivers. The test gun firmware just detects the header pulse.

Packet format: `(header) (12 data bits) (stop bit)`

- Header: 2400µs mark followed by 2400µs space (`MMMMSSSS`)
- 0 bit: 600µs mark followed by 600µs space (`MS`)
- 1 bit: 600µs mark followed by 1200µs space (`MSS`, shorter than standard NEC codes)

The grenade packet has **8 bits of payload and 4 bits of CRC** (12 bits in total).

| Bits | 11 | 10 | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
|------|----|----|---|---|---|---|---|---|---|---|---|---|
| Grenade | P | P | P | P | J | J | J | J | S | S | S | S |

- **P** = parity/CRC for the packet (the sum of the lower two nybbles of a CRC)
- **J** = grenade random (4-bit random counter) for distinguishing grenade ids
- **S** = grenade state (mostly acts as a countdown timer)

---

## Alternative Grenade Protocol: NEC4

Used by the grenade to provide greater range when using Y-lin receivers.

Packet format: `(header) (4 data bits) (stop bit)`

- Header: 2400µs mark followed by 2400µs space (`MMMMSSSS`)
- 0 bit: 600µs mark followed by 600µs space (`MS`)
- 1 bit: 600µs mark followed by 1200µs space (`MSS`, shorter than standard NEC codes)
- Stop bit: 600µs mark (`MSSSSSSS`)

The grenade packet has 4 bits of payload.

| Bits | 3 | 2 | 1 | 0 |
|------|---|---|---|---|
| Grenade | S | S | S | S |

- **S** = grenade state (mostly acts as a countdown timer)
