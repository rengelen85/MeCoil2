<script>
// Single-player AR practice: target practice or zombie survival. Runs fully on
// the device: the camera feed is the backdrop, the phone's orientation sensor
// aims the crosshair, and targets/zombies/scoring come from shared/arGame.js
// and shared/arZombies.js. Nothing is sent to the server.
import { onDestroy, onMount } from 'svelte';
import { get } from 'svelte/store';
import {
  AR_COUNTDOWN_SECS,
  AR_DEFAULT_DIFFICULTY,
  AR_DIFFICULTIES,
  AR_MAGAZINE_SIZE,
  AR_ROUND_OPTIONS_SECS,
  AR_ROUND_SECS,
  aimAzimuthDeg,
  arBestKey,
  arResults,
  arSecondsLeft,
  cameraBasis,
  createArGame,
  fireArShot,
  focalLengthPx,
  projectPoint,
  quatFromDeviceOrientation,
  targetPosition,
  tickArGame,
} from '../../../shared/arGame.js';
import {
  AR_ZOMBIE_DIFFICULTIES,
  createZombieGame,
  fireZombieShot,
  isFrozen,
  tickZombieGame,
  zombieBestKey,
  zombiePosition,
  zombieResults,
} from '../../../shared/arZombies.js';
import AmmoBar from '../components/AmmoBar.svelte';
import {
  playKilled,
  playPowerUp,
  playReload,
  playTargetHit,
  playZombieBite,
} from '../lib/audio.js';
import {
  applyGunAssignment,
  GUN_MODES,
  setGunMode,
  setLocalShotHandler,
} from '../lib/ble.js';
import {
  activeGunMode,
  ammo,
  arReturnScreen,
  bleConnected,
  bulletsPerMag,
  fastReloadActive,
  gunSlotId,
  isReloading,
  maxAmmo,
  resetGame,
  screen,
} from '../stores/game.js';

const BEST_KEY = 'mecoil_ar_best';
const ZOMBIE_BEST_KEY = 'mecoil_ar_zombie_best';
const ZOMBIE_FRAMES = Object.fromEntries(
  Object.entries(
    import.meta.glob('../assets/zombies/*.png', {
      eager: true,
      import: 'default',
    }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4), url]),
);
// Two-frame shamble; the sprite is 2:3 and its figure fills about 90% of the height.
const ZOMBIE_FRAME_MS = 380;
const ZOMBIE_ASPECT = 2 / 3;
const ZOMBIE_HEIGHT_SCALE = 1.1;
const POWERUP_EMOJI = { medkit: '❤️', bomb: '💣', freeze: '❄️' };
const BITE_FLASH_MS = 450;

let mode = 'targets'; // 'targets' | 'zombies'
let phase = 'intro'; // 'intro' | 'countdown' | 'playing' | 'results'
let stage;
let video;
let stream = null;
let cameraError = '';
let starting = false;

let width = 0;
let height = 0;

// Orientation: sensor quaternion once the first event arrives; until then
// (e.g. a desktop browser) the view is aimed by dragging.
let sensorQuat = null;
let dragYaw = 0;
let dragPitch = 0;
let dragFrom = null;
let basis = cameraBasis(quatFromDeviceOrientation(0, 90, 0));

let game = null;
let countdownEndsAt = 0;
let countdownLeft = AR_COUNTDOWN_SECS;
let timeLeft = 0;
let score = 0;
let streak = 0;
let sprites = [];
let indicators = [];
let popups = [];
let zombieSprites = [];
let powerUpSprites = [];
let wave = 0;
let lives = 0;
let banner = '';
let frozen = false;
let biteFlash = 0;
let hitMarker = false;
let hitMarkerTimer = null;
let raf = null;
let wakeLock = null;

let roundSecs = AR_ROUND_SECS;
let difficulty = AR_DEFAULT_DIFFICULTY;
let results = null;
let best = loadBest(mode, roundSecs, difficulty);
let newBest = false;

// Best scores are kept per mode and difficulty, and per round length for
// target practice.
function selectMode(m) {
  mode = m;
  best = loadBest(m, roundSecs, difficulty);
}

function selectRound(secs) {
  roundSecs = secs;
  best = loadBest(mode, secs, difficulty);
}

function selectDifficulty(key) {
  difficulty = key;
  best = loadBest(mode, roundSecs, key);
}

function bestKey(m, secs, diff) {
  return m === 'zombies'
    ? zombieBestKey(ZOMBIE_BEST_KEY, diff)
    : arBestKey(BEST_KEY, secs, diff);
}

function loadBest(m, secs, diff) {
  try {
    return Number(localStorage.getItem(bestKey(m, secs, diff))) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    localStorage.setItem(bestKey(mode, roundSecs, difficulty), String(value));
  } catch {}
}

function screenAngle() {
  return window.screen?.orientation?.angle ?? window.orientation ?? 0;
}

function onOrientation(e) {
  if (e.alpha == null && e.beta == null) return;
  sensorQuat = quatFromDeviceOrientation(e.alpha, e.beta, e.gamma);
}

function onPointerDown(e) {
  if (sensorQuat) return;
  dragFrom = { x: e.clientX, y: e.clientY, yaw: dragYaw, pitch: dragPitch };
}

function onPointerMove(e) {
  if (!dragFrom || sensorQuat) return;
  const degPerPx = 60 / Math.max(width, 1);
  dragYaw = dragFrom.yaw - (e.clientX - dragFrom.x) * degPerPx;
  dragPitch = Math.max(
    -60,
    Math.min(60, dragFrom.pitch + (e.clientY - dragFrom.y) * degPerPx),
  );
}

function onPointerUp() {
  dragFrom = null;
}

async function requestOrientationPermission() {
  // iOS Safari gates motion sensors behind a user-gesture permission prompt.
  const DOE = window.DeviceOrientationEvent;
  if (typeof DOE?.requestPermission === 'function') {
    try {
      await DOE.requestPermission();
    } catch {}
  }
}

async function startCamera() {
  if (stream) return;
  cameraError = '';
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError =
      'Camera needs HTTPS. Targets will appear on a dark background instead.';
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch {
    cameraError =
      'Could not open the camera. Targets will appear on a dark background instead.';
  }
}

function stopCamera() {
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
}

async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {}
}

// Fill the magazine and, with a gun connected, program it for practice. The
// gun keeps its own ammo count; shots reach onShot via ble.js. Practice always
// has fast reload: ble.js then refills the clip without the reload delay.
function prepareGun() {
  bulletsPerMag.set(AR_MAGAZINE_SIZE);
  fastReloadActive.set(true);
  maxAmmo.set(AR_MAGAZINE_SIZE);
  ammo.set(AR_MAGAZINE_SIZE);
  isReloading.set(false);
  if (get(bleConnected)) {
    gunSlotId.set(0);
    // Practice starts in semi; applyGunAssignment resets the gun to auto.
    applyGunAssignment(0)
      .then(() => setGunMode('semi'))
      .catch(() => {});
  }
}

async function start() {
  if (starting) return;
  starting = true;
  await requestOrientationPermission();
  await startCamera();
  keepAwake();
  prepareGun();
  countdownEndsAt = performance.now() + AR_COUNTDOWN_SECS * 1_000;
  countdownLeft = AR_COUNTDOWN_SECS;
  results = null;
  phase = 'countdown';
  starting = false;
}

function finish() {
  phase = 'results';
  results = mode === 'zombies' ? zombieResults(game) : arResults(game);
  newBest = results.score > best;
  if (newBest) {
    best = results.score;
    saveBest(best);
  }
  sprites = [];
  indicators = [];
  popups = [];
  zombieSprites = [];
  powerUpSprites = [];
  banner = '';
  frozen = false;
}

function exit() {
  screen.set(get(arReturnScreen));
}

function onShot(gunMode, rounds) {
  if (phase !== 'playing' || !game) return;
  const opts = { mode: gunMode, rounds };
  let hit;
  if (mode === 'zombies') {
    const shot = fireZombieShot(game, basis, performance.now(), opts);
    hit = shot.hit;
    if (shot.powerUp) playPowerUp();
    else if (shot.kills.length) playTargetHit();
  } else {
    hit = fireArShot(game, basis, performance.now(), opts).hits.length > 0;
    if (hit) playTargetHit();
  }
  if (hit) {
    hitMarker = true;
    clearTimeout(hitMarkerTimer);
    hitMarkerTimer = setTimeout(() => {
      hitMarker = false;
    }, 180);
  }
}

// On-screen trigger / keyboard, used when no gun is connected.
function fireLocal() {
  if (get(bleConnected) || get(isReloading) || get(ammo) <= 0) return;
  ammo.update((v) => v - 1);
  onShot('semi', 1);
}

// Instant, like the gun's reload with fast reload always on.
function reloadLocal() {
  if (get(bleConnected)) return;
  playReload();
  ammo.set(AR_MAGAZINE_SIZE);
}

function onKey(e) {
  const key = e.key.toLowerCase();
  if (key === 't' || key === ' ') fireLocal();
  else if (key === 'r') reloadLocal();
}

function frame() {
  raf = requestAnimationFrame(frame);
  const now = performance.now();
  const q =
    sensorQuat ?? quatFromDeviceOrientation(-dragYaw, 90 + dragPitch, 0);
  basis = cameraBasis(q, screenAngle());

  if (phase === 'countdown') {
    countdownLeft = Math.ceil((countdownEndsAt - now) / 1_000);
    if (countdownLeft <= 0) {
      game =
        mode === 'zombies'
          ? createZombieGame({ nowMs: now, difficulty })
          : createArGame({ nowMs: now, durationSecs: roundSecs, difficulty });
      phase = 'playing';
    }
  }
  if (phase !== 'playing') return;
  if (mode === 'zombies') {
    zombieFrame(now);
    return;
  }

  tickArGame(game, now, aimAzimuthDeg(basis));
  if (game.over) {
    finish();
    return;
  }
  timeLeft = arSecondsLeft(game, now);
  score = game.score;
  streak = game.streak;

  const viewport = { width, height, focalPx: focalLengthPx(width, height) };
  const edge = Math.min(width, height) / 2 - 36;
  const projected = game.targets.map((t) => ({
    id: t.id,
    kind: t.kind,
    expiring: t.expiresAt - now < 1_000,
    ...projectPoint(basis, targetPosition(t), viewport, t.radiusM),
  }));
  sprites = projected.filter((s) => s.visible);
  indicators = projected
    .filter((s) => !s.visible)
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      x: width / 2 + Math.cos(s.direction) * edge,
      y: height / 2 - Math.sin(s.direction) * edge,
      deg: (-s.direction * 180) / Math.PI,
    }));
  popups = game.popups
    .map((pp) => ({
      id: pp.id,
      text: pp.text,
      age: (now - pp.at) / 900,
      ...projectPoint(basis, targetPosition(pp), viewport),
    }))
    .filter((pp) => pp.visible);
}

// Off-screen marker at the screen edge for a projected point.
function edgeMarker(id, kind, s) {
  const edge = Math.min(width, height) / 2 - 36;
  return {
    id,
    kind,
    x: width / 2 + Math.cos(s.direction) * edge,
    y: height / 2 - Math.sin(s.direction) * edge,
    deg: (-s.direction * 180) / Math.PI,
  };
}

function zombieFrame(now) {
  const { bites } = tickZombieGame(game, now, aimAzimuthDeg(basis));
  if (bites) {
    playZombieBite();
    if (navigator.vibrate) navigator.vibrate(200);
  }
  if (game.over) {
    playKilled();
    finish();
    return;
  }
  score = game.score;
  wave = game.wave;
  lives = game.lives;
  frozen = isFrozen(game, now);
  banner = game.banner ? game.banner.text : '';
  biteFlash = Math.max(0, 1 - (now - game.lastBiteAt) / BITE_FLASH_MS);

  const viewport = { width, height, focalPx: focalLengthPx(width, height) };
  const nextIndicators = [];
  // Draw far zombies first so near ones overlap them.
  zombieSprites = [];
  for (const z of [...game.zombies].sort((a, b) => b.distanceM - a.distanceM)) {
    const s = projectPoint(basis, zombiePosition(z), viewport, z.heightM / 2);
    const near = z.distanceM < 4;
    if (s.visible) {
      zombieSprites.push({
        id: z.id,
        // Frozen zombies hold their pose; the rest alternate frames, out of step.
        src: ZOMBIE_FRAMES[
          `${z.kind}-${frozen ? 1 : ((Math.floor(now / ZOMBIE_FRAME_MS) + z.id) % 2) + 1}`
        ],
        flip: z.id % 2 === 1,
        x: s.x,
        y: s.y,
        size: Math.max(16, s.sizePx),
        hp: z.maxHp > 1 ? z.hp / z.maxHp : null,
        near,
      });
    } else {
      nextIndicators.push(edgeMarker(z.id, near ? 'near' : 'zombie', s));
    }
  }
  powerUpSprites = [];
  for (const p of game.powerUps) {
    const s = projectPoint(basis, targetPosition(p), viewport, p.radiusM);
    if (s.visible) {
      powerUpSprites.push({
        id: p.id,
        kind: p.kind,
        emoji: POWERUP_EMOJI[p.kind],
        x: s.x,
        y: s.y,
        size: Math.max(28, s.sizePx),
        expiring: p.expiresAt - now < 1_500,
      });
    } else {
      nextIndicators.push(edgeMarker(p.id, p.kind, s));
    }
  }
  indicators = nextIndicators;
  popups = game.popups
    .map((pp) => ({
      id: pp.id,
      text: pp.text,
      age: (now - pp.at) / 900,
      ...projectPoint(basis, targetPosition(pp), viewport),
    }))
    .filter((pp) => pp.visible);
}

function onResize() {
  width = stage?.clientWidth ?? window.innerWidth;
  height = stage?.clientHeight ?? window.innerHeight;
}

onMount(() => {
  onResize();
  setLocalShotHandler(onShot);
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);
  raf = requestAnimationFrame(frame);
});

onDestroy(() => {
  cancelAnimationFrame(raf);
  clearTimeout(hitMarkerTimer);
  setLocalShotHandler(null);
  window.removeEventListener('deviceorientation', onOrientation);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onKey);
  stopCamera();
  wakeLock?.release().catch(() => {});
  gunSlotId.set(null);
  resetGame();
});
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="ar-screen"
  bind:this={stage}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerUp}
>
  <!-- svelte-ignore a11y-media-has-caption -->
  <video bind:this={video} class="camera" playsinline muted></video>

  {#each sprites as s (s.id)}
    <div
      class="target {s.kind}"
      class:expiring={s.expiring}
      style="left:{s.x}px; top:{s.y}px; width:{Math.max(18, s.sizePx)}px; height:{Math.max(18, s.sizePx)}px"
    ></div>
  {/each}

  {#each zombieSprites as z (z.id)}
    <div
      class="zombie"
      class:near={z.near}
      class:frozen
      style="left:{z.x}px; top:{z.y}px; width:{z.size * ZOMBIE_HEIGHT_SCALE * ZOMBIE_ASPECT}px; height:{z.size * ZOMBIE_HEIGHT_SCALE}px"
    >
      <img src={z.src} alt="" class:flip={z.flip} draggable="false" />
      {#if z.hp != null}
        <span class="hp"><span style="width:{z.hp * 100}%"></span></span>
      {/if}
    </div>
  {/each}

  {#each powerUpSprites as p (p.id)}
    <div
      class="powerup {p.kind}"
      class:expiring={p.expiring}
      style="left:{p.x}px; top:{p.y}px; width:{p.size}px; height:{p.size}px; font-size:{p.size * 0.55}px"
    >{p.emoji}</div>
  {/each}

  {#if frozen}
    <div class="freeze-tint"></div>
  {/if}
  {#if biteFlash > 0}
    <div class="bite-flash" style="opacity:{biteFlash}"></div>
  {/if}

  {#each indicators as ind (ind.id)}
    <div
      class="indicator {ind.kind}"
      style="left:{ind.x}px; top:{ind.y}px; transform:translate(-50%, -50%) rotate({ind.deg}deg)"
    >➤</div>
  {/each}

  {#each popups as pp (pp.id)}
    <div
      class="popup"
      style="left:{pp.x}px; top:{pp.y - pp.age * 40}px; opacity:{1 - pp.age}"
    >{pp.text}</div>
  {/each}

  {#if phase === 'playing' || phase === 'countdown'}
    <div class="crosshair" class:hit={hitMarker}>
      <span class="ch-h"></span><span class="ch-v"></span><span class="ch-dot"></span>
    </div>

    <div class="hud-top">
      <button class="btn-exit" on:click|stopPropagation={exit} aria-label="Exit">✕</button>
      <div class="stat">
        <span class="stat-label">SCORE</span>
        <span class="stat-value">{score}</span>
      </div>
      {#if mode === 'zombies'}
        <div class="stat">
          <span class="stat-label">WAVE</span>
          <span class="stat-value">{phase === 'playing' && wave ? wave : '–'}</span>
        </div>
        <div class="stat">
          <span class="stat-label">LIVES</span>
          <span class="stat-value lives" class:low={phase === 'playing' && lives <= 1}>{phase === 'playing' ? '❤'.repeat(lives) || '–' : '–'}</span>
        </div>
      {:else}
        <div class="stat">
          <span class="stat-label">TIME</span>
          <span class="stat-value" class:low={phase === 'playing' && timeLeft <= 10}>{phase === 'playing' ? timeLeft : '–'}</span>
        </div>
        <div class="stat">
          <span class="stat-label">STREAK</span>
          <span class="stat-value">{streak > 1 ? `×${streak}` : '–'}</span>
        </div>
      {/if}
    </div>

    {#if phase === 'countdown'}
      <div class="countdown">{countdownLeft}</div>
    {/if}
    {#if banner}
      <div class="banner">{banner}</div>
    {/if}

    <div class="hud-bottom">
      <div class="ammo">
        <AmmoBar />
        {#if $bleConnected}
          <span class="mode-badge">{GUN_MODES[$activeGunMode]?.label ?? ''}</span>
        {/if}
      </div>
      {#if !$bleConnected}
        <div class="controls">
          <button class="btn-reload" on:click|stopPropagation={reloadLocal} disabled={$isReloading}>
            RELOAD
          </button>
          <button class="btn-fire" on:pointerdown|stopPropagation={fireLocal} disabled={$isReloading || $ammo <= 0}>
            FIRE
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if phase === 'intro'}
    <div class="panel-wrap">
      <div class="panel">
        <h1>{mode === 'zombies' ? 'AR Zombie Survival' : 'AR Target Practice'}</h1>
        <p class="sub">Single player · no server needed</p>
        <div class="round-picker" role="group" aria-label="Mode">
          <button
            class="round-opt"
            class:selected={mode === 'targets'}
            on:click|stopPropagation={() => selectMode('targets')}
          >
            🎯 Targets
          </button>
          <button
            class="round-opt"
            class:selected={mode === 'zombies'}
            on:click|stopPropagation={() => selectMode('zombies')}
          >
            🧟 Zombies
          </button>
        </div>
        {#if mode === 'zombies'}
          <p>
            Waves of zombies close in on you from all sides. Shoot them before
            they get close enough to bite. Each bite costs a life. Every wave
            brings more, faster zombies. Pick the difficulty.
          </p>
        {:else}
          <p>
            Look around through your camera. Targets appear in the space around
            you. Put the crosshair on them and pull the trigger. Pick the round
            length and difficulty.
          </p>
          <div class="round-picker" role="group" aria-label="Round length">
            {#each AR_ROUND_OPTIONS_SECS as secs}
              <button
                class="round-opt"
                class:selected={roundSecs === secs}
                on:click|stopPropagation={() => selectRound(secs)}
              >
                {secs}s
              </button>
            {/each}
          </div>
        {/if}
        <div class="round-picker" role="group" aria-label="Difficulty">
          {#each Object.entries(mode === 'zombies' ? AR_ZOMBIE_DIFFICULTIES : AR_DIFFICULTIES) as [key, cfg]}
            <button
              class="round-opt"
              class:selected={difficulty === key}
              on:click|stopPropagation={() => selectDifficulty(key)}
            >
              {cfg.label}
            </button>
          {/each}
        </div>
        {#if mode === 'zombies'}
          <ul class="legend">
            <li><img class="icon" src={ZOMBIE_FRAMES['walker-1']} alt="" /> Walker: 100 pts</li>
            <li><img class="icon" src={ZOMBIE_FRAMES['runner-1']} alt="" /> Runner: 150 pts, fast (from wave 2)</li>
            <li><img class="icon" src={ZOMBIE_FRAMES['brute-1']} alt="" /> Brute: 400 pts, takes 4 hits (from wave 3)</li>
            <li><span class="icon">❤️</span> Medkit: +1 life</li>
            <li><span class="icon">💣</span> Bomb: wipes out every zombie</li>
            <li><span class="icon">❄️</span> Freeze: zombies stop for 5 s</li>
          </ul>
          <p class="small">
            Shoot a floating power-up to collect it. Headshots do double damage
            and score +50%. Hits in a row raise your streak bonus (up to double
            points). Clearing a wave earns a bonus. A charged plasma shot hits
            every zombie in a wider cone. Reloads are instant.
          </p>
        {:else}
          <ul class="legend">
            <li><span class="dot standard"></span> Target: 100 pts</li>
            <li><span class="dot mover"></span> Moving target: 150 pts</li>
            <li><span class="dot bonus"></span> Gold target: 300 pts, gone fast</li>
          </ul>
          <p class="small">
            Hits in a row raise your streak bonus (up to double points). A missed
            shot or an escaped target resets it. A charged plasma shot hits every
            target in a wider cone. Reloads are instant.
          </p>
        {/if}
        <p class="gun-status" class:ok={$bleConnected}>
          {$bleConnected
            ? '● Gun connected'
            : 'No gun connected: use the FIRE and RELOAD buttons (or T / R).'}
        </p>
        {#if best > 0}
          <p class="best">Best score: {best}</p>
        {/if}
        <button class="btn-primary" on:click|stopPropagation={start} disabled={starting}>
          {starting ? 'Starting…' : 'Start'}
        </button>
        <button class="btn-secondary" on:click|stopPropagation={exit}>Back</button>
      </div>
    </div>
  {/if}

  {#if phase === 'results' && results}
    <div class="panel-wrap">
      <div class="panel">
        <h1>
          {newBest ? 'New best score!' : mode === 'zombies' ? 'You got eaten!' : "Time's up!"}
        </h1>
        <div class="big-score">{results.score}</div>
        <div class="results-grid">
          {#if mode === 'zombies'}
            <span>Wave reached</span><strong>{results.wave}</strong>
            <span>Zombies killed</span><strong>{results.kills}</strong>
            <span>Headshots</span><strong>{results.headshots}</strong>
            <span>Power-ups</span><strong>{results.powerUps}</strong>
          {:else}
            <span>Targets hit</span><strong>{results.targetsHit}</strong>
            <span>Targets missed</span><strong>{results.targetsMissed}</strong>
          {/if}
          <span>Accuracy</span><strong>{results.accuracy}%</strong>
          <span>Best streak</span><strong>{results.bestStreak}</strong>
          <span>Best score</span><strong>{best}</strong>
        </div>
        <button class="btn-primary" on:click|stopPropagation={start} disabled={starting}>
          Play again
        </button>
        <button class="btn-secondary" on:click|stopPropagation={exit}>Exit</button>
      </div>
    </div>
  {/if}

  {#if cameraError && phase !== 'results'}
    <p class="camera-error">{cameraError}</p>
  {/if}
</div>

<style>
  .ar-screen {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #05060a;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .camera {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Targets: bullseye rings, centred on their projected position. */
  .target {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    pointer-events: none;
    background: radial-gradient(
      circle,
      #fff 0 12%,
      #ff1744 12% 30%,
      #fff 30% 48%,
      #ff1744 48% 66%,
      #fff 66% 84%,
      #ff1744 84% 100%
    );
    box-shadow: 0 0 12px rgba(255, 23, 68, 0.7);
  }
  .target.mover {
    background: radial-gradient(
      circle,
      #fff 0 12%,
      #ff9100 12% 30%,
      #fff 30% 48%,
      #ff9100 48% 66%,
      #fff 66% 84%,
      #ff9100 84% 100%
    );
    box-shadow: 0 0 12px rgba(255, 145, 0, 0.7);
  }
  .target.bonus {
    background: radial-gradient(
      circle,
      #fff8e1 0 15%,
      #ffd600 15% 40%,
      #fff8e1 40% 60%,
      #ffd600 60% 100%
    );
    box-shadow: 0 0 20px #ffd600;
  }
  .target.expiring {
    animation: blink 0.25s steps(2) infinite;
  }
  @keyframes blink {
    50% { opacity: 0.35; }
  }

  .indicator {
    position: absolute;
    font-size: 26px;
    color: #ff1744;
    text-shadow: 0 0 8px rgba(0, 0, 0, 0.8);
    pointer-events: none;
  }
  .indicator.mover { color: #ff9100; }
  .indicator.bonus { color: #ffd600; }
  .indicator.zombie { color: #76ff03; }
  .indicator.near { color: #ff1744; font-size: 34px; }
  .indicator.medkit { color: #ff4081; }
  .indicator.bomb { color: #ffab40; }
  .indicator.freeze { color: #40c4ff; }

  /* Zombies: a painted sprite, its height set to the body's apparent height. */
  .zombie {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
    filter: drop-shadow(0 0 6px rgba(118, 255, 3, 0.6));
  }
  .zombie img { width: 100%; height: 100%; display: block; }
  .zombie img.flip { transform: scaleX(-1); }
  .zombie.near { filter: drop-shadow(0 0 10px #ff1744); }
  .zombie.frozen { filter: drop-shadow(0 0 8px #40c4ff) saturate(0.4) brightness(1.2); }
  .hp {
    position: absolute;
    left: 15%;
    right: 15%;
    top: -6px;
    height: 5px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }
  .hp span { display: block; height: 100%; background: #ff1744; }

  .powerup {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0.05));
    border: 2px solid #fff;
    box-shadow: 0 0 18px #fff;
    animation: bob 1s ease-in-out infinite alternate;
  }
  .powerup.medkit { border-color: #ff4081; box-shadow: 0 0 18px #ff4081; }
  .powerup.bomb { border-color: #ffab40; box-shadow: 0 0 18px #ffab40; }
  .powerup.freeze { border-color: #40c4ff; box-shadow: 0 0 18px #40c4ff; }
  .powerup.expiring { animation: blink 0.25s steps(2) infinite; }
  @keyframes bob {
    to { margin-top: -6px; }
  }

  .freeze-tint {
    position: absolute;
    inset: 0;
    background: rgba(64, 196, 255, 0.15);
    box-shadow: inset 0 0 80px rgba(64, 196, 255, 0.6);
    pointer-events: none;
  }
  .bite-flash {
    position: absolute;
    inset: 0;
    background: rgba(255, 23, 68, 0.25);
    box-shadow: inset 0 0 120px #ff1744;
    pointer-events: none;
  }
  .banner {
    position: absolute;
    left: 16px;
    right: 16px;
    top: 22%;
    text-align: center;
    font-size: 30px;
    font-weight: 900;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #76ff03;
    text-shadow: 0 0 12px #000;
    pointer-events: none;
  }

  .popup {
    position: absolute;
    transform: translate(-50%, -50%);
    color: #00e676;
    font-weight: 900;
    font-size: 22px;
    text-shadow: 0 0 6px #000;
    pointer-events: none;
  }

  .crosshair {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
    pointer-events: none;
    --ch: rgba(255, 255, 255, 0.9);
  }
  .crosshair.hit { --ch: #00e676; transform: translate(-50%, -50%) scale(1.25); }
  .ch-h,
  .ch-v,
  .ch-dot {
    position: absolute;
    background: var(--ch);
    box-shadow: 0 0 3px #000;
  }
  .ch-h { left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; }
  .ch-v { top: 0; bottom: 0; left: 50%; width: 2px; margin-left: -1px; }
  .ch-dot { left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; }

  .hud-top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: linear-gradient(rgba(0, 0, 0, 0.6), transparent);
  }
  .btn-exit {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.3);
    background: rgba(0, 0, 0, 0.4);
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .stat { flex: 1; display: flex; flex-direction: column; align-items: center; }
  .stat-label { font-size: 10px; letter-spacing: 1px; color: rgba(255, 255, 255, 0.7); }
  .stat-value { font-size: 22px; font-weight: 900; color: #fff; text-shadow: 0 0 4px #000; }
  .stat-value.low { color: #ff5252; }
  .stat-value.lives { color: #ff1744; font-size: 18px; letter-spacing: 1px; }

  .countdown {
    position: absolute;
    left: 50%;
    top: 32%;
    transform: translate(-50%, -50%);
    font-size: 96px;
    font-weight: 900;
    color: var(--accent);
    text-shadow: 0 0 24px rgba(0, 229, 255, 0.6);
    pointer-events: none;
  }

  .hud-bottom {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: flex-end;
    gap: 12px;
    padding: 16px;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
  }
  .ammo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .mode-badge {
    align-self: flex-start;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 2px 6px;
  }
  .controls { display: flex; gap: 10px; align-items: flex-end; }
  .btn-fire,
  .btn-reload {
    border: none;
    border-radius: 50%;
    font-family: inherit;
    font-weight: 900;
    letter-spacing: 1px;
    cursor: pointer;
  }
  .btn-fire { width: 84px; height: 84px; background: #ff1744; color: #fff; font-size: 16px; }
  .btn-reload { width: 60px; height: 60px; background: rgba(255, 255, 255, 0.15); color: #fff; font-size: 10px; }
  .btn-fire:disabled,
  .btn-reload:disabled { opacity: 0.4; }

  .panel-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.55);
    overflow-y: auto;
  }
  .panel {
    width: 100%;
    max-width: 380px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 14px;
    line-height: 1.5;
  }
  h1 { font-size: 22px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
  .sub { color: var(--accent); font-size: 12px; letter-spacing: 1px; text-transform: uppercase; margin-top: -8px; }
  .small { font-size: 12px; color: var(--text-muted); }
  .legend { list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .legend li { display: flex; align-items: center; gap: 8px; }
  .dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
  .dot.standard { background: #ff1744; }
  .dot.mover { background: #ff9100; }
  .dot.bonus { background: #ffd600; }
  .icon { width: 14px; text-align: center; display: inline-block; }
  img.icon { width: 20px; height: 30px; object-fit: contain; vertical-align: middle; }
  .gun-status { font-size: 12px; color: var(--text-muted); }
  .gun-status.ok { color: #00c853; font-weight: 600; }
  .best { font-size: 13px; color: #ffd600; font-weight: 700; }
  .big-score { font-size: 56px; font-weight: 900; color: var(--accent); text-align: center; line-height: 1; }
  .results-grid { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; }
  .results-grid span { color: var(--text-muted); }

  .round-picker { display: flex; gap: 6px; }
  .round-opt {
    flex: 1;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 8px 0;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .round-opt.selected { background: var(--accent); border-color: var(--accent); color: #000; }

  .btn-primary:disabled { opacity: 0.5; }
  .btn-secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 10px;
    padding: 12px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .camera-error {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 120px;
    text-align: center;
    font-size: 12px;
    color: #ffcc80;
    text-shadow: 0 0 4px #000;
    pointer-events: none;
  }
</style>
