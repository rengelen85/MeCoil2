// Single-player AR zombie survival — pure game logic shared by the web and
// mobile clients, on top of the camera/orientation math in arGame.js. Runs
// entirely on the device: no server, no network.
//
// Waves of zombies walk in from the distance towards the player (standing at
// the origin, same world frame as arGame.js). Shoot them before they get
// within biting range; every bite costs a life. Each wave brings more, faster
// and tougher zombies. Floating power-ups can be shot to collect them.

import { AR_DEFAULT_DIFFICULTY, targetPosition } from './arGame.js';

// Difficulty presets: zombie speed, how many come per wave, starting lives and
// how forgiving the hit box is.
export const AR_ZOMBIE_DIFFICULTIES = {
  easy: {
    label: 'Easy',
    speedScale: 0.75,
    countScale: 0.75,
    lives: 5,
    hitScale: 1.25,
  },
  normal: {
    label: 'Normal',
    speedScale: 1,
    countScale: 1,
    lives: 3,
    hitScale: 1,
  },
  hard: {
    label: 'Hard',
    speedScale: 1.25,
    countScale: 1.3,
    lives: 2,
    hitScale: 0.85,
  },
};

// Storage key for the best score of a difficulty. Normal keeps the bare key.
export function zombieBestKey(baseKey, difficulty) {
  return difficulty === AR_DEFAULT_DIFFICULTY
    ? baseKey
    : `${baseKey}_${difficulty}`;
}

export const AR_MAX_LIVES = 6;
// Height of the phone above the ground; zombies stand on the ground.
export const AR_EYE_HEIGHT_M = 1.4;
// A zombie this close bites.
export const AR_BITE_DIST_M = 0.9;
export const AR_WAVE_BREAK_MS = 4_000;
export const AR_FREEZE_MS = 5_000;
// How long the "Wave N" / "Wave cleared" banner stays up, in ms.
export const AR_BANNER_MS = 2_000;

// heightM/halfWidthM give the body's hit box; speeds are metres per second.
export const AR_ZOMBIE_KINDS = {
  walker: {
    hp: 1,
    speedMps: 0.9,
    lateralMps: 0.25,
    swayHz: 0.4,
    heightM: 1.7,
    halfWidthM: 0.3,
    points: 100,
  },
  runner: {
    hp: 1,
    speedMps: 1.8,
    lateralMps: 0.9,
    swayHz: 0.9,
    heightM: 1.6,
    halfWidthM: 0.28,
    points: 150,
  },
  brute: {
    hp: 4,
    speedMps: 0.6,
    lateralMps: 0.15,
    swayHz: 0.3,
    heightM: 2.1,
    halfWidthM: 0.45,
    points: 400,
  },
};

export const AR_POWERUP_KINDS = {
  medkit: { label: 'Medkit', text: '+1 ❤' },
  bomb: { label: 'Bomb', text: 'BOOM!' },
  freeze: { label: 'Freeze', text: 'FREEZE!' },
};
const POWERUP_RADIUS_M = 0.45;
const POWERUP_LIFETIME_MS = 7_000;

// Top part of the body that counts as a headshot (double damage, +50% points).
const HEAD_M = 0.3;
const POPUP_MS = 900;
const SPAWN_MIN_DIST_M = 14;
const SPAWN_MAX_DIST_M = 18;
const DEG = Math.PI / 180;

function between(rng, min, max) {
  return min + rng() * (max - min);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// World position of a zombie's body centre.
export function zombiePosition(z) {
  const az = z.azimuthDeg * DEG;
  return {
    x: z.distanceM * Math.sin(az),
    y: z.distanceM * Math.cos(az),
    z: z.heightM / 2 - AR_EYE_HEIGHT_M,
  };
}

// Popups are stored as azimuth/elevation/distance so targetPosition() places
// them, like arGame.js popups.
function popupAt(p) {
  const horiz = Math.hypot(p.x, p.y);
  return {
    azimuthDeg: Math.atan2(p.x, p.y) / DEG,
    elevationDeg: Math.atan2(p.z, horiz) / DEG,
    distanceM: Math.hypot(horiz, p.z),
  };
}

function addPopup(state, nowMs, text, p) {
  state.popups.push({ id: state.nextId++, at: nowMs, text, ...popupAt(p) });
}

// ── Waves ────────────────────────────────────────────────────────────────────

export function waveSize(wave, countScale = 1) {
  return Math.max(2, Math.round((4 + 2 * (wave - 1)) * countScale));
}

function maxAlive(wave) {
  return Math.min(12, 3 + wave);
}

function speedFactor(state) {
  return (
    Math.min(1.8, 1 + 0.07 * (state.wave - 1)) * state.difficulty.speedScale
  );
}

function pickKind(rng, wave) {
  const r = rng();
  const brute = wave >= 3 ? Math.min(0.25, 0.06 * (wave - 2)) : 0;
  const runner = wave >= 2 ? Math.min(0.35, 0.1 * (wave - 1)) : 0;
  if (r < brute) return 'brute';
  if (r < brute + runner) return 'runner';
  return 'walker';
}

function startWave(state, nowMs) {
  state.wave++;
  state.stage = 'wave';
  state.waveTotal = waveSize(state.wave, state.difficulty.countScale);
  state.waveSpawned = 0;
  state.nextSpawnAt = nowMs + 800;
  state.nextPowerUpAt = nowMs + between(state.rng, 6_000, 12_000);
  state.banner = { text: `Wave ${state.wave}`, at: nowMs };
}

function spawnZombie(state, nowMs, aimAzDeg) {
  const { rng, wave } = state;
  const kind = pickKind(rng, wave);
  const cfg = AR_ZOMBIE_KINDS[kind];
  // The first waves come from in front; later ones from all around.
  const spread = Math.min(180, 50 + 20 * (wave - 1));
  const zombie = {
    id: state.nextId++,
    kind,
    azimuthDeg: aimAzDeg + between(rng, -1, 1) * spread,
    distanceM: between(rng, SPAWN_MIN_DIST_M, SPAWN_MAX_DIST_M),
    hp: cfg.hp,
    maxHp: cfg.hp,
    speedMps: cfg.speedMps * speedFactor(state) * between(rng, 0.85, 1.15),
    lateralMps: cfg.lateralMps,
    swayHz: cfg.swayHz,
    swayPhase: rng() * Math.PI * 2,
    heightM: cfg.heightM,
    halfWidthM: cfg.halfWidthM * state.difficulty.hitScale,
    points: cfg.points,
    bornAt: nowMs,
  };
  state.zombies.push(zombie);
  state.waveSpawned++;
  return zombie;
}

function spawnPowerUp(state, nowMs, aimAzDeg) {
  const { rng } = state;
  const kinds =
    state.lives < state.maxLives
      ? ['medkit', 'bomb', 'freeze']
      : ['bomb', 'freeze'];
  const kind = kinds[Math.floor(rng() * kinds.length)];
  const powerUp = {
    id: state.nextId++,
    kind,
    azimuthDeg: aimAzDeg + between(rng, -50, 50),
    elevationDeg: between(rng, 2, 12),
    distanceM: between(rng, 6, 10),
    radiusM: POWERUP_RADIUS_M * state.difficulty.hitScale,
    bornAt: nowMs,
    expiresAt: nowMs + POWERUP_LIFETIME_MS,
  };
  state.powerUps.push(powerUp);
  return powerUp;
}

// ── Game state ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} ArZombie
 * @property {number} id
 * @property {'walker' | 'runner' | 'brute'} kind
 * @property {number} azimuthDeg
 * @property {number} distanceM
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} speedMps
 * @property {number} lateralMps
 * @property {number} swayHz
 * @property {number} swayPhase
 * @property {number} heightM
 * @property {number} halfWidthM
 * @property {number} points
 * @property {number} bornAt
 */

/**
 * @typedef {object} ArPowerUp
 * @property {number} id
 * @property {'medkit' | 'bomb' | 'freeze'} kind
 * @property {number} azimuthDeg
 * @property {number} elevationDeg
 * @property {number} distanceM
 * @property {number} radiusM
 * @property {number} bornAt
 * @property {number} expiresAt
 */

export function createZombieGame({
  nowMs,
  difficulty = AR_DEFAULT_DIFFICULTY,
  rng = Math.random,
}) {
  const diff =
    AR_ZOMBIE_DIFFICULTIES[difficulty] ?? AR_ZOMBIE_DIFFICULTIES.normal;
  return {
    rng,
    difficulty: diff,
    startedAt: nowMs,
    lastTickAt: nowMs,
    over: false,
    lives: diff.lives,
    maxLives: Math.max(diff.lives, AR_MAX_LIVES),
    // 'break' between waves, 'wave' while one is running.
    stage: 'break',
    breakUntil: nowMs + 500,
    wave: 0,
    waveTotal: 0,
    waveSpawned: 0,
    nextSpawnAt: 0,
    nextPowerUpAt: 0,
    frozenUntil: 0,
    lastBiteAt: Number.NEGATIVE_INFINITY,
    banner: /** @type {{ text: string, at: number } | null} */ (null),
    zombies: /** @type {ArZombie[]} */ ([]),
    powerUps: /** @type {ArPowerUp[]} */ ([]),
    popups: /** @type {import('./arGame.js').ArPopup[]} */ ([]),
    nextId: 1,
    score: 0,
    shots: 0,
    hits: 0,
    kills: 0,
    headshots: 0,
    powerUpsCollected: 0,
    streak: 0,
    bestStreak: 0,
  };
}

export function isFrozen(state, nowMs) {
  return nowMs < state.frozenUntil;
}

// Advance the game to `nowMs`. `aimAzDeg` is the current aim azimuth, used to
// place new zombies and power-ups. Returns the number of bites this tick and
// whether a wave was cleared.
export function tickZombieGame(state, nowMs, aimAzDeg = 0) {
  if (state.over) return { bites: 0, waveCleared: false };
  const dt = Math.max(0, (nowMs - state.lastTickAt) / 1_000);
  state.lastTickAt = nowMs;
  state.popups = state.popups.filter((pp) => nowMs - pp.at < POPUP_MS);
  if (state.banner && nowMs - state.banner.at >= AR_BANNER_MS) {
    state.banner = null;
  }

  if (state.stage === 'break' && nowMs >= state.breakUntil) {
    startWave(state, nowMs);
  }

  // Zombies shuffle towards the player, swaying from side to side.
  if (!isFrozen(state, nowMs)) {
    const t = (nowMs - state.startedAt) / 1_000;
    for (const z of state.zombies) {
      z.distanceM -= z.speedMps * dt;
      const lateral =
        z.lateralMps * Math.sin(2 * Math.PI * z.swayHz * t + z.swayPhase);
      z.azimuthDeg += (lateral * dt) / Math.max(1, z.distanceM) / DEG;
    }
  }

  const biters = state.zombies.filter((z) => z.distanceM <= AR_BITE_DIST_M);
  if (biters.length) {
    state.zombies = state.zombies.filter((z) => z.distanceM > AR_BITE_DIST_M);
    state.lives = Math.max(0, state.lives - biters.length);
    state.streak = 0;
    state.lastBiteAt = nowMs;
    if (state.lives === 0) {
      state.over = true;
      state.zombies = [];
      state.powerUps = [];
      return { bites: biters.length, waveCleared: false };
    }
  }

  state.powerUps = state.powerUps.filter((p) => nowMs < p.expiresAt);

  let waveCleared = false;
  if (state.stage === 'wave') {
    if (
      state.waveSpawned < state.waveTotal &&
      state.zombies.length < maxAlive(state.wave) &&
      nowMs >= state.nextSpawnAt
    ) {
      spawnZombie(state, nowMs, aimAzDeg);
      state.nextSpawnAt =
        nowMs +
        Math.max(500, between(state.rng, 1_400, 2_400) - 120 * state.wave);
    }
    if (!state.powerUps.length && nowMs >= state.nextPowerUpAt) {
      spawnPowerUp(state, nowMs, aimAzDeg);
      state.nextPowerUpAt = nowMs + between(state.rng, 10_000, 18_000);
    }
    if (state.waveSpawned >= state.waveTotal && !state.zombies.length) {
      const bonus = 100 * state.wave;
      state.score += bonus;
      state.stage = 'break';
      state.breakUntil = nowMs + AR_WAVE_BREAK_MS;
      state.banner = {
        text: `Wave ${state.wave} cleared +${bonus}`,
        at: nowMs,
      };
      waveCleared = true;
    }
  }
  return { bites: biters.length, waveCleared };
}

// How far (metres) the aim ray passes from a zombie's body, and where along
// the body it passes closest (offset from the centre, + is up). Null if the
// zombie is behind the camera.
function aimMiss(basis, z) {
  const c = zombiePosition(z);
  const half = z.heightM / 2;
  let best = null;
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const s = -half + (2 * half * i) / steps;
    const q = { x: c.x, y: c.y, z: c.z + s };
    const depth = dot(q, basis.forward);
    if (depth <= 0) continue;
    const miss = Math.sqrt(Math.max(0, dot(q, q) - depth * depth));
    if (!best || miss < best.miss) best = { miss, offset: s, depth };
  }
  return best;
}

function kill(state, z, nowMs, earned) {
  state.kills++;
  state.score += earned;
  addPopup(state, nowMs, `+${earned}`, zombiePosition(z));
}

function collect(state, p, nowMs) {
  state.powerUpsCollected++;
  addPopup(state, nowMs, AR_POWERUP_KINDS[p.kind].text, targetPosition(p));
  if (p.kind === 'medkit') {
    state.lives = Math.min(state.maxLives, state.lives + 1);
  } else if (p.kind === 'freeze') {
    state.frozenUntil = nowMs + AR_FREEZE_MS;
  } else if (p.kind === 'bomb') {
    for (const z of state.zombies) kill(state, z, nowMs, z.points);
    state.zombies = [];
  }
}

// Fire one shot along the camera's aim. `rounds` is the number of rounds the
// shot used: a burst does that much damage, a charged plasma shot widens the
// hit cone, hits everything inside it and does more damage the longer it was
// charged. Returns the zombies killed, whether one was a headshot, the
// power-up collected (if any) and the points scored.
export function fireZombieShot(
  state,
  basis,
  nowMs,
  { mode = 'semi', rounds = 1 } = {},
) {
  const none = { hit: false, kills: [], headshot: false, powerUp: null };
  if (state.over) return { ...none, points: 0 };
  state.shots++;
  const scoreBefore = state.score;

  const plasma = mode === 'plasma';
  const cone = plasma ? Math.min(2.5, 1 + 0.15 * Math.max(0, rounds - 1)) : 1;
  const damage = plasma ? 1 + Math.floor(rounds / 4) : Math.max(1, rounds);

  const candidates = [];
  for (const z of state.zombies) {
    const m = aimMiss(basis, z);
    if (m && m.miss <= z.halfWidthM * cone) {
      candidates.push({ zombie: z, depth: m.depth, offset: m.offset });
    }
  }
  for (const p of state.powerUps) {
    const pos = targetPosition(p);
    const depth = dot(pos, basis.forward);
    if (depth <= 0) continue;
    const miss = Math.sqrt(Math.max(0, dot(pos, pos) - depth * depth));
    if (miss <= p.radiusM * cone) candidates.push({ powerUp: p, depth });
  }
  candidates.sort((a, b) => a.depth - b.depth);
  const struck = plasma ? candidates : candidates.slice(0, 1);

  if (!struck.length) {
    state.streak = 0;
    return { ...none, points: 0 };
  }

  state.hits++;
  state.streak++;
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  // Streak bonus: +10% per consecutive hit, up to double points.
  const streakMul = 1 + Math.min(state.streak - 1, 10) * 0.1;

  const result = { ...none, hit: true, kills: [] };
  const powerUps = [];
  const dead = new Set();
  for (const c of struck) {
    if (c.powerUp) {
      powerUps.push(c.powerUp);
      continue;
    }
    const z = c.zombie;
    const head = c.offset >= z.heightM / 2 - HEAD_M;
    z.hp -= head ? damage * 2 : damage;
    if (z.hp <= 0) {
      if (head) {
        state.headshots++;
        result.headshot = true;
      }
      kill(
        state,
        z,
        nowMs,
        Math.round(z.points * streakMul * (head ? 1.5 : 1)),
      );
      dead.add(z.id);
      result.kills.push(z);
    }
  }
  state.zombies = state.zombies.filter((z) => !dead.has(z.id));

  // Power-ups apply after the shot's own kills, so a bomb doesn't double-count.
  for (const p of powerUps) {
    const before = new Set(state.zombies);
    collect(state, p, nowMs);
    for (const z of before) {
      if (!state.zombies.includes(z)) result.kills.push(z);
    }
    result.powerUp = p.kind;
  }
  const taken = new Set(powerUps.map((p) => p.id));
  state.powerUps = state.powerUps.filter((p) => !taken.has(p.id));

  return { ...result, points: state.score - scoreBefore };
}

export function zombieResults(state) {
  return {
    score: state.score,
    wave: state.wave,
    kills: state.kills,
    headshots: state.headshots,
    powerUps: state.powerUpsCollected,
    shots: state.shots,
    hits: state.hits,
    accuracy: state.shots ? Math.round((state.hits / state.shots) * 100) : 0,
    bestStreak: state.bestStreak,
  };
}
