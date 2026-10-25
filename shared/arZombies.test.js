import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraBasis, quatFromDeviceOrientation } from './arGame.js';
import {
  AR_BITE_DIST_M,
  AR_FREEZE_MS,
  AR_ZOMBIE_KINDS,
  createZombieGame,
  fireZombieShot,
  tickZombieGame,
  waveSize,
  zombieBestKey,
  zombiePosition,
  zombieResults,
} from './arZombies.js';

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function zombie(id, overrides = {}) {
  const cfg = AR_ZOMBIE_KINDS.walker;
  return {
    id,
    kind: 'walker',
    azimuthDeg: 0,
    distanceM: 8,
    hp: cfg.hp,
    maxHp: cfg.hp,
    speedMps: 1,
    lateralMps: 0,
    swayHz: 0,
    swayPhase: 0,
    heightM: cfg.heightM,
    halfWidthM: cfg.halfWidthM,
    points: cfg.points,
    bornAt: 0,
    ...overrides,
  };
}

// Aim at a world point from the origin (azimuth clockwise from north).
function aimAt(p) {
  const az = Math.atan2(p.x, p.y) * (180 / Math.PI);
  const el = Math.atan2(p.z, Math.hypot(p.x, p.y)) * (180 / Math.PI);
  return cameraBasis(quatFromDeviceOrientation(-az, 90 + el, 0), 0);
}

// Game in the middle of wave 1 with nothing spawning on its own.
function quietGame() {
  const game = createZombieGame({ nowMs: 0, rng: seeded(5) });
  tickZombieGame(game, 600, 0);
  assert.equal(game.wave, 1);
  game.waveSpawned = game.waveTotal = 99;
  game.nextSpawnAt = Number.POSITIVE_INFINITY;
  game.nextPowerUpAt = Number.POSITIVE_INFINITY;
  return game;
}

test('waves start, grow and spawn zombies far away', () => {
  assert.ok(waveSize(5) > waveSize(1));
  const game = createZombieGame({ nowMs: 0, rng: seeded(2) });
  tickZombieGame(game, 600, 0);
  assert.equal(game.wave, 1);
  assert.equal(game.banner.text, 'Wave 1');
  tickZombieGame(game, 1_500, 0);
  assert.equal(game.zombies.length, 1);
  assert.ok(game.zombies[0].distanceM > 10);
});

test('zombies walk in and bite; running out of lives ends the game', () => {
  const game = quietGame();
  game.lives = 2;
  game.zombies.push(zombie(1, { distanceM: AR_BITE_DIST_M + 0.5 }));
  tickZombieGame(game, 1_000, 0);
  assert.equal(game.zombies.length, 1, 'not close enough yet');
  const { bites } = tickZombieGame(game, 1_600, 0);
  assert.equal(bites, 1);
  assert.equal(game.lives, 1);
  assert.equal(game.zombies.length, 0);
  assert.equal(game.over, false);

  game.zombies.push(zombie(2, { distanceM: AR_BITE_DIST_M + 0.1 }));
  tickZombieGame(game, 1_800, 0);
  assert.equal(game.lives, 0);
  assert.equal(game.over, true);
});

test('clearing a wave awards a bonus and the next wave follows', () => {
  const game = createZombieGame({ nowMs: 0, rng: seeded(9) });
  tickZombieGame(game, 600, 0);
  game.waveSpawned = game.waveTotal;
  const { waveCleared } = tickZombieGame(game, 700, 0);
  assert.equal(waveCleared, true);
  assert.equal(game.score, 100);
  assert.equal(game.stage, 'break');
  tickZombieGame(game, 700 + 4_000, 0);
  assert.equal(game.wave, 2);
  assert.equal(game.stage, 'wave');
});

test('shooting a zombie kills it; a miss breaks the streak', () => {
  const game = quietGame();
  const z = zombie(1, { azimuthDeg: 25 });
  game.zombies.push(z);
  const aim = aimAt(zombiePosition(z));

  const shot = fireZombieShot(game, aim, 1_000);
  assert.equal(shot.kills.length, 1);
  assert.equal(shot.points, 100);
  assert.equal(game.zombies.length, 0);
  assert.equal(game.streak, 1);

  const miss = fireZombieShot(game, aim, 1_100);
  assert.equal(miss.hit, false);
  assert.equal(game.streak, 0);
  const r = zombieResults(game);
  assert.equal(r.kills, 1);
  assert.equal(r.accuracy, 50);
});

test('brutes take several hits; headshots do double damage', () => {
  const game = quietGame();
  const cfg = AR_ZOMBIE_KINDS.brute;
  const brute = zombie(1, { kind: 'brute', ...cfg, maxHp: cfg.hp });
  game.zombies.push(brute);
  const body = aimAt(zombiePosition(brute));
  const centre = zombiePosition(brute);
  const head = aimAt({ ...centre, z: centre.z + brute.heightM / 2 - 0.1 });

  assert.equal(fireZombieShot(game, body, 100).kills.length, 0);
  assert.equal(brute.hp, 3);
  assert.equal(fireZombieShot(game, head, 200).kills.length, 0);
  assert.equal(brute.hp, 1);
  const last = fireZombieShot(game, head, 300);
  assert.equal(last.kills.length, 1);
  assert.equal(last.headshot, true);
  assert.equal(game.headshots, 1);
});

test('a shot hits only the nearest zombie in line', () => {
  const game = quietGame();
  game.zombies.push(zombie(1, { distanceM: 10 }));
  game.zombies.push(zombie(2, { distanceM: 5 }));
  const aim = aimAt(zombiePosition(game.zombies[1]));
  const shot = fireZombieShot(game, aim, 100);
  assert.deepEqual(
    shot.kills.map((z) => z.id),
    [2],
  );
  assert.equal(game.zombies.length, 1);
});

test('power-ups: medkit heals, freeze stops zombies, bomb clears them', () => {
  const game = quietGame();
  const base = {
    azimuthDeg: -40,
    elevationDeg: 5,
    distanceM: 6,
    radiusM: 0.45,
    bornAt: 0,
    expiresAt: 100_000,
  };
  const aim = cameraBasis(quatFromDeviceOrientation(40, 95, 0), 0);

  game.lives = 2;
  game.powerUps.push({ ...base, id: 50, kind: 'medkit' });
  assert.equal(fireZombieShot(game, aim, 1_000).powerUp, 'medkit');
  assert.equal(game.lives, 3);
  assert.equal(game.powerUps.length, 0);

  game.zombies.push(zombie(1, { azimuthDeg: 90, distanceM: 8 }));
  game.powerUps.push({ ...base, id: 51, kind: 'freeze' });
  fireZombieShot(game, aim, 2_000);
  tickZombieGame(game, 2_000, 0);
  tickZombieGame(game, 4_000, 0);
  assert.equal(game.zombies[0].distanceM, 8, 'frozen in place');
  tickZombieGame(game, 2_000 + AR_FREEZE_MS + 1_000, 0);
  assert.ok(game.zombies[0].distanceM < 8, 'moving again');

  game.zombies.push(zombie(2, { azimuthDeg: 180 }));
  game.powerUps.push({ ...base, id: 52, kind: 'bomb' });
  const boom = fireZombieShot(game, aim, 9_000);
  assert.equal(boom.kills.length, 2);
  assert.equal(game.zombies.length, 0);
  assert.equal(game.kills, 2);
});

test('best score keys per difficulty', () => {
  assert.equal(zombieBestKey('k', 'normal'), 'k');
  assert.equal(zombieBestKey('k', 'hard'), 'k_hard');
});
