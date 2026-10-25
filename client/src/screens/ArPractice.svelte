<script>
// Single-player AR target practice. Runs fully on the device: the camera feed
// is the backdrop, the phone's orientation sensor aims the crosshair, and
// targets/scoring come from shared/arGame.js. Nothing is sent to the server.
import { onDestroy, onMount } from 'svelte';
import { get } from 'svelte/store';
import {
  AR_COUNTDOWN_SECS,
  AR_MAGAZINE_SIZE,
  aimAzimuthDeg,
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
import AmmoBar from '../components/AmmoBar.svelte';
import { playReload, playTargetHit } from '../lib/audio.js';
import {
  applyGunAssignment,
  GUN_MODES,
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
let hitMarker = false;
let hitMarkerTimer = null;
let raf = null;
let wakeLock = null;

let results = null;
let best = loadBest();
let newBest = false;

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    localStorage.setItem(BEST_KEY, String(value));
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
    applyGunAssignment(0).catch(() => {});
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
  results = arResults(game);
  newBest = results.score > best;
  if (newBest) {
    best = results.score;
    saveBest(best);
  }
  sprites = [];
  indicators = [];
  popups = [];
}

function exit() {
  screen.set(get(arReturnScreen));
}

function onShot(mode, rounds) {
  if (phase !== 'playing' || !game) return;
  const { hits } = fireArShot(game, basis, performance.now(), {
    mode,
    rounds,
  });
  if (hits.length) {
    playTargetHit();
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
      game = createArGame({ nowMs: now });
      phase = 'playing';
    }
  }
  if (phase !== 'playing') return;

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
      <div class="stat">
        <span class="stat-label">TIME</span>
        <span class="stat-value" class:low={phase === 'playing' && timeLeft <= 10}>{phase === 'playing' ? timeLeft : '–'}</span>
      </div>
      <div class="stat">
        <span class="stat-label">STREAK</span>
        <span class="stat-value">{streak > 1 ? `×${streak}` : '–'}</span>
      </div>
    </div>

    {#if phase === 'countdown'}
      <div class="countdown">{countdownLeft}</div>
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
        <h1>AR Target Practice</h1>
        <p class="sub">Single player · no server needed</p>
        <p>
          Look around through your camera. Targets appear in the space around
          you. Put the crosshair on them and pull the trigger. You have 60
          seconds.
        </p>
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
        <h1>{newBest ? 'New best score!' : "Time's up!"}</h1>
        <div class="big-score">{results.score}</div>
        <div class="results-grid">
          <span>Targets hit</span><strong>{results.targetsHit}</strong>
          <span>Targets missed</span><strong>{results.targetsMissed}</strong>
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
  .gun-status { font-size: 12px; color: var(--text-muted); }
  .gun-status.ok { color: #00c853; font-weight: 600; }
  .best { font-size: 13px; color: #ffd600; font-weight: 700; }
  .big-score { font-size: 56px; font-weight: 900; color: var(--accent); text-align: center; line-height: 1; }
  .results-grid { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; }
  .results-grid span { color: var(--text-muted); }

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
