// Single-player AR target practice — pure game logic shared by the web and
// mobile clients. Runs entirely on the device: no server, no network.
//
// Coordinate frames
//   World:  x = east, y = north, z = up (the frame of W3C deviceorientation and
//           Android's rotation-vector sensor). The player stands at the origin.
//   Device: x = right, y = top, z = out of the screen, in the phone's natural
//           (portrait) orientation. The rear camera looks along -z.
//   Screen: the device frame rotated by the screen orientation angle, so
//           "screen up" stays up when the UI is in landscape.
//
// Orientation is a unit quaternion { x, y, z, w } rotating device vectors into
// the world frame. The crosshair sits at the screen centre, which is where a
// phone mounted on the gun is aiming.

export const AR_ROUND_SECS = 60;
export const AR_MAGAZINE_SIZE = 20;
export const AR_COUNTDOWN_SECS = 3;
// Horizontal field of view assumed for the rear camera across the screen's
// long side. Only affects how big/where targets are drawn, not hit detection.
export const AR_CAMERA_HFOV_DEG = 62;

const DEG = Math.PI / 180;

export const AR_TARGET_KINDS = {
  standard: { radiusM: 0.4, minDistM: 4, maxDistM: 9, points: 100 },
  mover: { radiusM: 0.4, minDistM: 5, maxDistM: 10, points: 150 },
  bonus: { radiusM: 0.3, minDistM: 10, maxDistM: 15, points: 300 },
};

// How long a hit "+points" popup lives, in ms.
const POPUP_MS = 900;

// ── Vector / quaternion math ─────────────────────────────────────────────────

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v) {
  return Math.sqrt(dot(v, v));
}

function quatMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function quatAxis(axis, angleRad) {
  const s = Math.sin(angleRad / 2);
  return {
    w: Math.cos(angleRad / 2),
    x: axis === 'x' ? s : 0,
    y: axis === 'y' ? s : 0,
    z: axis === 'z' ? s : 0,
  };
}

// Rotate vector v by unit quaternion q (q v q*).
export function rotateVector(q, v) {
  const p = quatMul(quatMul(q, { w: 0, ...v }), {
    w: q.w,
    x: -q.x,
    y: -q.y,
    z: -q.z,
  });
  return { x: p.x, y: p.y, z: p.z };
}

// W3C deviceorientation angles (degrees) → device-to-world quaternion.
// The spec defines the rotation as intrinsic Z (alpha), X' (beta), Y'' (gamma).
export function quatFromDeviceOrientation(alpha, beta, gamma) {
  return quatMul(
    quatMul(
      quatAxis('z', (alpha || 0) * DEG),
      quatAxis('x', (beta || 0) * DEG),
    ),
    quatAxis('y', (gamma || 0) * DEG),
  );
}

// Camera basis in world coordinates for a device pose and screen orientation
// angle (degrees, as screen.orientation.angle / Android display rotation).
export function cameraBasis(q, screenAngleDeg = 0) {
  const dx = rotateVector(q, { x: 1, y: 0, z: 0 });
  const dy = rotateVector(q, { x: 0, y: 1, z: 0 });
  const dz = rotateVector(q, { x: 0, y: 0, z: 1 });
  const c = Math.cos(screenAngleDeg * DEG);
  const s = Math.sin(screenAngleDeg * DEG);
  const combine = (a, ka, b, kb) => ({
    x: a.x * ka + b.x * kb,
    y: a.y * ka + b.y * kb,
    z: a.z * ka + b.z * kb,
  });
  return {
    forward: { x: -dz.x, y: -dz.y, z: -dz.z },
    right: combine(dx, c, dy, -s),
    up: combine(dx, s, dy, c),
  };
}

// Compass-style azimuth (degrees, clockwise from +y) the camera points at.
export function aimAzimuthDeg(basis) {
  return Math.atan2(basis.forward.x, basis.forward.y) / DEG;
}

// Focal length in pixels for a viewport, using the long side for the HFOV.
export function focalLengthPx(width, height, hfovDeg = AR_CAMERA_HFOV_DEG) {
  return Math.max(width, height) / 2 / Math.tan((hfovDeg * DEG) / 2);
}

// World position of a target (metres from the player).
export function targetPosition(t) {
  const az = t.azimuthDeg * DEG;
  const el = t.elevationDeg * DEG;
  return {
    x: t.distanceM * Math.cos(el) * Math.sin(az),
    y: t.distanceM * Math.cos(el) * Math.cos(az),
    z: t.distanceM * Math.sin(el),
  };
}

// Project a world point onto the screen. Returns pixel coordinates, the
// apparent size of `radiusM` in pixels, whether it is on screen and — for the
// off-screen indicator — the direction to turn as an angle in radians
// (0 = right, π/2 = up).
export function projectPoint(basis, p, viewport, radiusM = 0) {
  const { width, height, focalPx } = viewport;
  const depth = dot(p, basis.forward);
  const sx = dot(p, basis.right);
  const sy = dot(p, basis.up);
  const direction = Math.atan2(sy, sx);
  if (depth < 0.1) {
    return { visible: false, direction, x: 0, y: 0, sizePx: 0 };
  }
  const x = width / 2 + (focalPx * sx) / depth;
  const y = height / 2 - (focalPx * sy) / depth;
  const sizePx = (2 * focalPx * radiusM) / depth;
  const visible =
    x > -sizePx && x < width + sizePx && y > -sizePx && y < height + sizePx;
  return { visible, direction, x, y, sizePx };
}

// Angle (radians) between the aim direction and a world point.
function aimErrorRad(basis, p) {
  const cos = dot(p, basis.forward) / length(p);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

// ── Game state ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} ArTarget
 * @property {number} id
 * @property {'standard' | 'mover' | 'bonus'} kind
 * @property {number} azimuthDeg
 * @property {number} elevationDeg
 * @property {number} distanceM
 * @property {number} radiusM
 * @property {number} points
 * @property {number} bornAt
 * @property {number} expiresAt
 * @property {number} angularSpeedDegPerSec
 */

/**
 * @typedef {object} ArPopup
 * @property {number} id
 * @property {number} at
 * @property {string} text
 * @property {number} azimuthDeg
 * @property {number} elevationDeg
 * @property {number} distanceM
 */

export function createArGame({
  nowMs,
  durationSecs = AR_ROUND_SECS,
  rng = Math.random,
}) {
  return {
    rng,
    startedAt: nowMs,
    endsAt: nowMs + durationSecs * 1_000,
    lastTickAt: nowMs,
    over: false,
    targets: /** @type {ArTarget[]} */ ([]),
    popups: /** @type {ArPopup[]} */ ([]),
    nextId: 1,
    nextSpawnAt: nowMs + 300,
    score: 0,
    shots: 0,
    hits: 0,
    targetsHit: 0,
    targetsMissed: 0,
    streak: 0,
    bestStreak: 0,
  };
}

// 0 → 1 over the round; drives the difficulty ramp.
function progress(state, nowMs) {
  const total = state.endsAt - state.startedAt;
  return Math.min(1, Math.max(0, (nowMs - state.startedAt) / total));
}

function between(rng, min, max) {
  return min + rng() * (max - min);
}

function pickKind(rng, p) {
  const r = rng();
  if (r < 0.08 + 0.07 * p) return 'bonus';
  if (r < 0.25 + 0.35 * p) return 'mover';
  return 'standard';
}

function angularGapDeg(a, b) {
  const d = Math.abs((((a - b) % 360) + 540) % 360) - 180;
  return Math.abs(d);
}

function spawnTarget(state, nowMs, aimAzDeg) {
  const { rng } = state;
  const p = progress(state, nowMs);
  const kind = pickKind(rng, p);
  const cfg = AR_TARGET_KINDS[kind];

  // Spawn around where the player is looking, sometimes just outside the view
  // so they have to turn. Retry a few times to avoid stacking targets.
  let azimuthDeg = aimAzDeg;
  let elevationDeg = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    azimuthDeg = aimAzDeg + between(rng, -1, 1) * (40 + 40 * p);
    elevationDeg = between(rng, -6, 14);
    const clear = state.targets.every(
      (t) =>
        angularGapDeg(t.azimuthDeg, azimuthDeg) > 12 ||
        Math.abs(t.elevationDeg - elevationDeg) > 10,
    );
    if (clear) break;
  }

  const lifetimeMs =
    kind === 'bonus' ? 2_800 - 600 * p : between(rng, 5_500, 7_000) - 2_500 * p;
  const target = {
    id: state.nextId++,
    kind,
    azimuthDeg,
    elevationDeg,
    distanceM: between(rng, cfg.minDistM, cfg.maxDistM),
    radiusM: cfg.radiusM,
    points: cfg.points,
    bornAt: nowMs,
    expiresAt: nowMs + lifetimeMs,
    // Movers orbit the player sideways, switching direction at random.
    angularSpeedDegPerSec:
      kind === 'mover'
        ? (rng() < 0.5 ? -1 : 1) * between(rng, 8, 14 + 12 * p)
        : 0,
  };
  state.targets.push(target);
  return target;
}

// Advance the game to `nowMs`. `aimAzDeg` is the current aim azimuth, used to
// place new targets in front of the player. Returns the targets that expired
// unshot this tick.
export function tickArGame(state, nowMs, aimAzDeg = 0) {
  if (state.over) return [];
  const dt = Math.max(0, (nowMs - state.lastTickAt) / 1_000);
  state.lastTickAt = nowMs;

  if (nowMs >= state.endsAt) {
    state.over = true;
    state.targets = [];
    return [];
  }

  for (const t of state.targets) {
    t.azimuthDeg += t.angularSpeedDegPerSec * dt;
    if (t.angularSpeedDegPerSec && state.rng() < 0.4 * dt) {
      t.angularSpeedDegPerSec = -t.angularSpeedDegPerSec;
    }
  }

  const expired = state.targets.filter((t) => nowMs >= t.expiresAt);
  if (expired.length) {
    state.targets = state.targets.filter((t) => nowMs < t.expiresAt);
    state.targetsMissed += expired.length;
    state.streak = 0;
  }
  state.popups = state.popups.filter((pp) => nowMs - pp.at < POPUP_MS);

  const p = progress(state, nowMs);
  const maxTargets = 2 + Math.round(3 * p);
  if (nowMs >= state.nextSpawnAt && state.targets.length < maxTargets) {
    spawnTarget(state, nowMs, aimAzDeg);
    state.nextSpawnAt = nowMs + between(state.rng, 900, 1_600) - 500 * p;
  }
  return expired;
}

// Fire one shot along the camera's aim. `rounds` is the number of rounds the
// shot used — plasma charges several, widening the hit cone and letting one
// shot take down every target inside it. Returns the targets hit (possibly
// none) and the points scored.
export function fireArShot(
  state,
  basis,
  nowMs,
  { mode = 'semi', rounds = 1 } = {},
) {
  if (state.over) return { hits: [], points: 0 };
  state.shots++;

  const plasma = mode === 'plasma';
  const cone = plasma ? Math.min(2.5, 1 + 0.15 * Math.max(0, rounds - 1)) : 1;

  const candidates = state.targets
    .map((t) => {
      const p = targetPosition(t);
      const allowed = Math.atan(t.radiusM / t.distanceM) * cone;
      return { t, error: aimErrorRad(basis, p), allowed };
    })
    .filter((c) => c.error <= c.allowed)
    .sort((a, b) => a.t.distanceM - b.t.distanceM);
  const hitTargets = (plasma ? candidates : candidates.slice(0, 1)).map(
    (c) => c.t,
  );

  if (!hitTargets.length) {
    state.streak = 0;
    return { hits: [], points: 0 };
  }

  state.hits++;
  let points = 0;
  for (const t of hitTargets) {
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.targetsHit++;
    // Streak bonus: +10% per consecutive hit, up to double points.
    const earned = Math.round(
      t.points * (1 + Math.min(state.streak - 1, 10) * 0.1),
    );
    points += earned;
    state.popups.push({
      id: t.id,
      at: nowMs,
      text: `+${earned}`,
      azimuthDeg: t.azimuthDeg,
      elevationDeg: t.elevationDeg,
      distanceM: t.distanceM,
    });
  }
  state.score += points;
  const hitIds = new Set(hitTargets.map((t) => t.id));
  state.targets = state.targets.filter((t) => !hitIds.has(t.id));
  return { hits: hitTargets, points };
}

export function arResults(state) {
  return {
    score: state.score,
    shots: state.shots,
    hits: state.hits,
    accuracy: state.shots ? Math.round((state.hits / state.shots) * 100) : 0,
    targetsHit: state.targetsHit,
    targetsMissed: state.targetsMissed,
    bestStreak: state.bestStreak,
  };
}

export function arSecondsLeft(state, nowMs) {
  return Math.max(0, Math.ceil((state.endsAt - nowMs) / 1_000));
}
