import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aimAzimuthDeg,
  arResults,
  cameraBasis,
  createArGame,
  fireArShot,
  focalLengthPx,
  projectPoint,
  quatFromDeviceOrientation,
  targetPosition,
  tickArGame,
} from './arGame.js';

const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function closeVec(v, expected) {
  close(v.x, expected.x);
  close(v.y, expected.y);
  close(v.z, expected.z);
}

// Deterministic RNG so spawns are reproducible.
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

test('phone held upright in portrait, facing north, aims north', () => {
  const basis = cameraBasis(quatFromDeviceOrientation(0, 90, 0), 0);
  closeVec(basis.forward, { x: 0, y: 1, z: 0 });
  closeVec(basis.right, { x: 1, y: 0, z: 0 });
  closeVec(basis.up, { x: 0, y: 0, z: 1 });
  close(aimAzimuthDeg(basis), 0);
});

test('phone flat on its back aims at the ground', () => {
  const basis = cameraBasis(quatFromDeviceOrientation(0, 0, 0), 0);
  closeVec(basis.forward, { x: 0, y: 0, z: -1 });
});

test('alpha turns the aim counter-clockwise (west for alpha=90)', () => {
  const basis = cameraBasis(quatFromDeviceOrientation(90, 90, 0), 0);
  closeVec(basis.forward, { x: -1, y: 0, z: 0 });
  close(aimAzimuthDeg(basis), -90);
});

test('landscape (screen angle 90) keeps screen-up pointing at the sky', () => {
  // Upright facing north, then rotated 90° counter-clockwise about the screen
  // normal (top edge to the left): Rx(90°) · Rz(90°).
  const basis = cameraBasis({ w: 0.5, x: 0.5, y: -0.5, z: 0.5 }, 90);
  closeVec(basis.right, { x: 1, y: 0, z: 0 });
  closeVec(basis.up, { x: 0, y: 0, z: 1 });
  closeVec(basis.forward, { x: 0, y: 1, z: 0 });
});

test('projectPoint puts a straight-ahead point at the screen centre', () => {
  const basis = cameraBasis(quatFromDeviceOrientation(0, 90, 0), 0);
  const viewport = {
    width: 400,
    height: 800,
    focalPx: focalLengthPx(400, 800),
  };
  const centre = projectPoint(basis, { x: 0, y: 5, z: 0 }, viewport, 0.5);
  assert.equal(centre.visible, true);
  close(centre.x, 200);
  close(centre.y, 400);
  assert.ok(centre.sizePx > 0);

  const behind = projectPoint(basis, { x: 0, y: -5, z: 0 }, viewport);
  assert.equal(behind.visible, false);

  const right = projectPoint(basis, { x: 5, y: 5, z: 0 }, viewport);
  assert.ok(right.x > 200);
  const above = projectPoint(basis, { x: 0, y: 5, z: 1 }, viewport);
  assert.ok(above.y < 400);
});

test('targets spawn, expire, and the round ends on time', () => {
  const game = createArGame({ nowMs: 0, durationSecs: 10, rng: seeded(3) });
  tickArGame(game, 500, 0);
  assert.equal(game.targets.length, 1);
  const first = game.targets[0];

  const expired = tickArGame(game, first.expiresAt + 1, 0);
  assert.ok(expired.some((t) => t.id === first.id));
  assert.equal(game.targetsMissed >= 1, true);

  tickArGame(game, 10_000, 0);
  assert.equal(game.over, true);
  assert.equal(game.targets.length, 0);
});

test('shooting at a target hits it and scores; missing breaks the streak', () => {
  const game = createArGame({ nowMs: 0, rng: seeded(7) });
  game.targets.push({
    id: 99,
    kind: 'standard',
    azimuthDeg: 30,
    elevationDeg: 5,
    distanceM: 6,
    radiusM: 0.4,
    points: 100,
    bornAt: 0,
    expiresAt: 10_000,
    angularSpeedDegPerSec: 0,
  });

  // Aim directly at the target.
  const aim = cameraBasis(quatFromDeviceOrientation(-30, 95, 0), 0);
  const p = targetPosition(game.targets[0]);
  const cos =
    (p.x * aim.forward.x + p.y * aim.forward.y + p.z * aim.forward.z) / 6;
  const err = Math.acos(Math.min(1, cos));
  assert.ok(err < Math.atan(0.4 / 6), 'test aim lines up with the target');

  const hit = fireArShot(game, aim, 1_000);
  assert.equal(hit.hits.length, 1);
  assert.equal(hit.points, 100);
  assert.equal(game.targets.length, 0);
  assert.equal(game.streak, 1);

  const miss = fireArShot(game, aim, 1_100);
  assert.equal(miss.hits.length, 0);
  assert.equal(game.streak, 0);

  const results = arResults(game);
  assert.equal(results.shots, 2);
  assert.equal(results.hits, 1);
  assert.equal(results.accuracy, 50);
  assert.equal(results.bestStreak, 1);
});

test('a charged plasma shot widens the cone and hits several targets', () => {
  const game = createArGame({ nowMs: 0, rng: seeded(11) });
  const base = {
    kind: 'standard',
    elevationDeg: 0,
    distanceM: 6,
    radiusM: 0.4,
    points: 100,
    bornAt: 0,
    expiresAt: 10_000,
    angularSpeedDegPerSec: 0,
  };
  // Both ~5° off-centre: outside a normal shot's ~3.8° cone, inside plasma's.
  game.targets.push({ ...base, id: 1, azimuthDeg: 5 });
  game.targets.push({ ...base, id: 2, azimuthDeg: -5 });
  const aim = cameraBasis(quatFromDeviceOrientation(0, 90, 0), 0);

  assert.equal(fireArShot(game, aim, 100).hits.length, 0);
  const plasma = fireArShot(game, aim, 200, { mode: 'plasma', rounds: 8 });
  assert.equal(plasma.hits.length, 2);
  // Second hit in the streak earns the +10% bonus.
  assert.equal(plasma.points, 100 + 110);
});
