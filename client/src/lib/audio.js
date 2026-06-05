// Synthesized game sound effects (no audio assets, no dependencies).
//
// All sounds are generated on the fly with the Web Audio API so they work
// offline and are trivial to tweak. The AudioContext is created lazily on first
// use and resumed on every play — browsers suspend audio until a user gesture,
// and by the time these fire in-game the player has already interacted with the
// page (register / ready / connect), so playback is unlocked.

let _ctx = null;
let _enabled = true;

function ctx() {
  if (_ctx) return _ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  _ctx = new AC();
  return _ctx;
}

// Play a single oscillator tone with a linear frequency sweep and an
// attack/decay gain envelope. Times are in seconds, frequencies in Hz.
function tone(c, { type = 'sine', from, to = from, start = 0, dur, gain = 0.25 }) {
  const t0 = c.currentTime + start;
  const t1 = t0 + dur;

  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.linearRampToValueAtTime(to, t1);

  const g = c.createGain();
  // Quick attack, then exponential-ish decay to near silence.
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.02, dur / 2));
  g.gain.exponentialRampToValueAtTime(0.0001, t1);

  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

function play(builder) {
  if (!_enabled) return;
  const c = ctx();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  try {
    builder(c);
  } catch {
    // Never let a sound effect break gameplay.
  }
}

export function setAudioEnabled(on) {
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
    tone(c, { type: 'sawtooth', from: 440, to: 70,  start: 0,    dur: 0.6,  gain: 0.3 });
    tone(c, { type: 'square',   from: 220, to: 55,  start: 0.05, dur: 0.5,  gain: 0.12 });
  });
}

// Bright rising "respawn" chime — an ascending triangle, hopeful and short.
export function playRespawn() {
  play(c => {
    tone(c, { type: 'triangle', from: 330, to: 660, start: 0,    dur: 0.18, gain: 0.25 });
    tone(c, { type: 'triangle', from: 494, to: 988, start: 0.16, dur: 0.22, gain: 0.22 });
  });
}
