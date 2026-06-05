// Synthesized game sound effects — the React Native mirror of
// client/src/lib/audio.js. react-native-audio-api implements the Web Audio API
// on native, so the same oscillator-based synthesis is reused (no audio assets).
//
// NOTE: react-native-audio-api is a native module. After pulling this change run
//   cd mobile && npm install && npm run android
// to link it and rebuild. Every call is wrapped in try/catch so a missing/failed
// audio backend can never break gameplay — sounds just go silent.

import { AudioContext } from 'react-native-audio-api';

let _ctx: AudioContext | null = null;
let _enabled = true;

function ctx(): AudioContext | null {
  if (_ctx) return _ctx;
  try {
    _ctx = new AudioContext();
  } catch {
    _ctx = null;
  }
  return _ctx;
}

type ToneOpts = {
  type?: OscillatorType;
  from: number;
  to?: number;
  start?: number;
  dur: number;
  gain?: number;
};

// Play a single oscillator tone with a linear frequency sweep and an
// attack/decay gain envelope. Times are in seconds, frequencies in Hz.
function tone(
  c: AudioContext,
  { type = 'sine', from, to = from, start = 0, dur, gain = 0.25 }: ToneOpts,
) {
  const t0 = c.currentTime + start;
  const t1 = t0 + dur;

  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.linearRampToValueAtTime(to, t1);

  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.02, dur / 2));
  g.gain.exponentialRampToValueAtTime(0.0001, t1);

  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

function play(builder: (c: AudioContext) => void) {
  if (!_enabled) return;
  try {
    const c = ctx();
    if (!c) return;
    builder(c);
  } catch {
    // Never let a sound effect break gameplay.
  }
}

export function setAudioEnabled(on: boolean) {
  _enabled = on;
}

// Mechanical "cha-chunk": a low clunk (clip out) followed by a higher one (clip in).
export function playReload() {
  play(c => {
    tone(c, { type: 'square', from: 320, to: 180, start: 0,    dur: 0.08, gain: 0.18 });
    tone(c, { type: 'square', from: 200, to: 420, start: 0.14, dur: 0.10, gain: 0.18 });
  });
}

// Downward "you died" sweep — a descending sawtooth that decays away.
export function playKilled() {
  play(c => {
    tone(c, { type: 'sawtooth', from: 440, to: 70, start: 0,    dur: 0.6, gain: 0.3 });
    tone(c, { type: 'square',   from: 220, to: 55, start: 0.05, dur: 0.5, gain: 0.12 });
  });
}

// Bright rising "respawn" chime — an ascending triangle, hopeful and short.
export function playRespawn() {
  play(c => {
    tone(c, { type: 'triangle', from: 330, to: 660, start: 0,    dur: 0.18, gain: 0.25 });
    tone(c, { type: 'triangle', from: 494, to: 988, start: 0.16, dur: 0.22, gain: 0.22 });
  });
}
