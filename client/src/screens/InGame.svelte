<script>
import { onDestroy, onMount } from 'svelte';
import { get } from 'svelte/store';
import { GAME_MODES } from '../../../shared/messages.js';
import AmmoBar from '../components/AmmoBar.svelte';
import HealthBar from '../components/HealthBar.svelte';
import KillFeed from '../components/KillFeed.svelte';
import GameMap from '../components/Map.svelte';
import ScoreBoard from '../components/ScoreBoard.svelte';
import {
  applyGunAssignment,
  bleErrorMessage,
  connectBle,
  GUN_MODE_CYCLE,
  GUN_MODES,
  isBleAvailable,
  setGunMode,
} from '../lib/ble.js';
import { isInArea } from '../lib/geometry.js';
import {
  sendDeployAirstrike,
  sendLeaveRoom,
  sendPosition,
  sendStopGame,
} from '../lib/network.js';
import {
  setSimulatorMode,
  startSimulator,
  stopSimulator,
} from '../lib/simulator.js';
import {
  activeGunMode,
  airstrikeArmed,
  airstrikePreview,
  airstrikeReady,
  amIInfected,
  bleConnected,
  ctfState,
  dominationState,
  gameArea,
  gameConfig,
  gunLocked,
  gunSlotId,
  hostId,
  infectionState,
  isAlive,
  killedBy,
  lastHitAt,
  lastShotHitAt,
  myId,
  myPlayer,
  myScore,
  radarActive,
  radarCountdown,
  respawnCountdown,
  roundId,
  timeRemaining,
} from '../stores/game.js';
import {
  airstrikes,
  gpsError,
  myPosition,
  startGPS,
  startHeading,
  stopGPS,
  stopHeading,
} from '../stores/map.js';

let showScores = false;
let bleConnecting = false;
let bleError = '';
$: gunMode = $activeGunMode;

let hitFlashActive = false;
let hitFlashTimer = null;
$: if ($lastHitAt) {
  hitFlashActive = true;
  if (hitFlashTimer) clearTimeout(hitFlashTimer);
  hitFlashTimer = setTimeout(() => {
    hitFlashActive = false;
  }, 350);
}

let shotHitActive = false;
let shotHitTimer = null;
$: if ($lastShotHitAt) {
  shotHitActive = true;
  if (shotHitTimer) clearTimeout(shotHitTimer);
  shotHitTimer = setTimeout(() => {
    shotHitActive = false;
  }, 600);
}

async function cycleGunMode() {
  const i = GUN_MODE_CYCLE.indexOf($activeGunMode);
  const next = GUN_MODE_CYCLE[(i + 1) % GUN_MODE_CYCLE.length];
  if (usingBle) {
    try {
      await setGunMode(next); // setGunMode updates activeGunMode store internally
    } catch (e) {
      bleError = bleErrorMessage(e);
    }
  } else {
    activeGunMode.set(next);
    setSimulatorMode(next);
  }
}

async function connectGunMidGame() {
  if (!isBleAvailable()) {
    bleError =
      'Web Bluetooth not available. Use Chrome or Edge on Android over HTTPS.';
    return;
  }
  bleConnecting = true;
  bleError = '';
  try {
    await connectBle();
    stopSimulator();
    usingBle = true;
    await applyGunAssignment(get(gunSlotId));
  } catch (e) {
    bleError = bleErrorMessage(e);
  } finally {
    bleConnecting = false;
  }
}

function formatTime(secs) {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

let usingBle = false;

// 1s ticker so the incoming-airstrike countdown updates live.
let now = Date.now();
let nowTimer = null;

// Seconds until the soonest inbound airstrike detonates (null if none).
$: incomingStrike = $airstrikes.length
  ? Math.max(
      0,
      Math.ceil(
        (Math.min(...$airstrikes.map((a) => a.detonateAt)) - now) / 1000,
      ),
    )
  : null;

function toggleAirstrike() {
  if ($airstrikeReady <= 0) return;
  airstrikePreview.set(null);
  airstrikeArmed.update((v) => !v);
}

function confirmAirstrike() {
  const pos = get(airstrikePreview);
  if (!pos) return;
  sendDeployAirstrike(pos.lat, pos.lng);
  airstrikePreview.set(null);
  airstrikeReady.update((n) => Math.max(0, n - 1));
}

function cancelAirstrike() {
  airstrikePreview.set(null);
}

onMount(() => {
  startGPS((lat, lng) => sendPosition(lat, lng));
  startHeading();
  nowTimer = setInterval(() => {
    now = Date.now();
  }, 1000);
  if (get(bleConnected)) {
    usingBle = true;
    applyGunAssignment(get(gunSlotId));
  } else {
    startSimulator();
  }
});

onDestroy(() => {
  stopGPS();
  stopHeading();
  if (nowTimer) clearInterval(nowTimer);
  if (!usingBle) stopSimulator();
});

$: outOfBounds =
  $gameArea && $myPosition
    ? !isInArea($myPosition.lat, $myPosition.lng, $gameArea)
    : false;

$: modeLabel =
  $gameConfig.mode === GAME_MODES.FFA
    ? 'FFA'
    : $gameConfig.mode === GAME_MODES.TEAM_DEATHMATCH
      ? 'TDM'
      : $gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG
        ? 'CTF'
        : $gameConfig.mode === GAME_MODES.DOMINATION
          ? 'DOM'
          : 'INF';

$: isTeamMode =
  $gameConfig.mode === GAME_MODES.TEAM_DEATHMATCH ||
  $gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG ||
  $gameConfig.mode === GAME_MODES.DOMINATION;

$: myTeam = $myPlayer?.team ?? null;

// CTF: captures from the score for quick display in the top bar
$: ctfCaptures =
  $gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG && $ctfState
    ? $ctfState.captures
    : null;

// Infection: immunity state for the local player
$: myImmunity = $infectionState?.immunePlayers?.[$myId] ?? null;
$: immunityActive =
  myImmunity?.hasImmunity ||
  (myImmunity?.gracePeriodUntil && Date.now() < myImmunity.gracePeriodUntil);
</script>

<div class="ingame">
  <!-- Full-screen map -->
  <div class="map-wrap">
    <GameMap />
  </div>

  <!-- Top HUD bar -->
  <div class="hud-top">
    <div class="mode-badge">{modeLabel}</div>
    {#if isTeamMode && myTeam && myTeam !== 'none'}
      <div class="team-badge team-badge-{myTeam}">{myTeam.toUpperCase()}</div>
    {/if}
    <div class="timer" class:urgent={$timeRemaining <= 30}>
      {formatTime($timeRemaining)}
    </div>
    <button class="scores-toggle" on:click={() => showScores = !showScores}>
      {showScores ? '✕' : '⊞'}
    </button>
  </div>

  <!-- Incoming airstrike warning -->
  {#if incomingStrike !== null}
    <div class="airstrike-warning">
      ⚠ INCOMING AIRSTRIKE
      <span class="airstrike-count">{incomingStrike}s — CLEAR THE ZONE</span>
    </div>
  {/if}

  <!-- Out-of-bounds warning -->
  {#if outOfBounds}
    <div class="oob-warning">⚠ OUT OF BOUNDS — RETURN TO PLAY AREA</div>
  {/if}

  <!-- Radar active indicator -->
  {#if $radarActive}
    <div class="radar-badge">📡 RADAR {$radarCountdown !== null ? `${Math.floor($radarCountdown / 60)}:${String($radarCountdown % 60).padStart(2, '0')}` : ''}</div>
  {/if}

  <!-- CTF: flag capture scores -->
  {#if ctfCaptures !== null}
    <div class="ctf-bar">
      <span class="ctf-red">🚩 RED {ctfCaptures.red ?? 0}</span>
      <span class="ctf-sep">—</span>
      <span class="ctf-blue">BLUE {ctfCaptures.blue ?? 0} 🚩</span>
    </div>
  {/if}

  <!-- Domination: zone status + team point scores -->
  {#if $gameConfig.mode === GAME_MODES.DOMINATION && $dominationState}
    <div class="dom-bar">
      <span class="dom-team dom-red">{$dominationState.teamPoints?.red ?? 0}</span>
      <div class="dom-zones">
        {#each $dominationState.zones as zone}
          <div
            class="dom-zone dom-zone-{zone.owner}"
            class:dom-zone-contested={zone.contested}
            title="Zone {zone.id}: {zone.contested ? 'CONTESTED' : zone.owner}"
          >
            <span class="dom-zone-id">{zone.id}</span>
            {#if zone.owner === 'neutral' || zone.contested}
              <div class="dom-zone-bar">
                <div
                  class="dom-zone-fill dom-fill-{zone.capturingTeam ?? 'neutral'}"
                  style="width:{Math.round(Math.abs(zone.controlValue ?? 0) * 100)}%"
                ></div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <span class="dom-team dom-blue">{$dominationState.teamPoints?.blue ?? 0}</span>
    </div>
  {/if}

  <!-- Infection: role indicator + gun lock -->
  {#if $gameConfig.mode === GAME_MODES.INFECTION && $infectionState}
    <div class="inf-role" class:inf-infected={$amIInfected} class:inf-survivor={!$amIInfected}>
      {$amIInfected ? '🧟 INFECTED' : '🧍 SURVIVOR'}
      {#if immunityActive}
        <span class="inf-immune">🛡 IMMUNE</span>
      {/if}
    </div>
    {#if $gunLocked}
      <div class="gun-locked">🔒 GUN LOCKED</div>
    {/if}
  {/if}

  <!-- Bottom-right: HP bar above, personal stats below -->
  <div class="hud-bottom-right">
    <div class="health-wrap">
      <HealthBar />
    </div>
    <div class="stats-bar">
      <div class="stat" title="Kills"><span class="stat-icon">💀</span>{$myScore?.kills ?? 0}</div>
      <div class="stat" title="Hits landed"><span class="stat-icon">🎯</span>{$myScore?.hits ?? 0}</div>
      <div class="stat" title="Times you were hit"><span class="stat-icon">🩸</span>{$myScore?.timesHit ?? 0}</div>
    </div>
  </div>

  <!-- Hit flash overlay -->
  {#if hitFlashActive}
    <div class="hit-flash"></div>
  {/if}

  <!-- Shot hit indicator -->
  {#if shotHitActive}
    <div class="shot-hit">HIT</div>
  {/if}

  <!-- Respawn overlay -->
  {#if !$isAlive}
    <div class="respawn-overlay">
      <div class="respawn-title">YOU ARE DOWN</div>
      {#if $killedBy}
        <div class="respawn-killer">Killed by <span class="killer-name">{$killedBy}</span></div>
      {/if}
      {#if $gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG}
        <div class="respawn-count">Return to your base to respawn</div>
        {#if $respawnCountdown != null}
          <div class="respawn-count respawn-ctf-timer">{$respawnCountdown}s</div>
        {/if}
      {:else if $gameConfig.mode === GAME_MODES.DOMINATION}
        <div class="respawn-count">Respawning in {$respawnCountdown ?? 0}…</div>
        <div class="respawn-hint">Head to a friendly zone after respawn</div>
      {:else}
        <div class="respawn-count">Respawning in {$respawnCountdown ?? 0}…</div>
      {/if}
    </div>
  {/if}

  <!-- Score overlay -->
  {#if showScores}
    <div class="scores-overlay">
      <ScoreBoard />
      {#if $roundId}
        <div class="round-id" title={$roundId}>Round {$roundId.slice(0, 8)}</div>
      {/if}
      <div class="score-actions">
        {#if $myId === $hostId}
          <button class="btn-end-game" on:click={sendStopGame}>End Game</button>
        {/if}
        <button class="btn-leave-game" on:click={sendLeaveRoom}>Leave</button>
      </div>
    </div>
  {/if}

  <!-- Kill feed (top right) -->
  <div class="killfeed-wrap">
    <KillFeed />
  </div>

  <!-- Bottom HUD -->
  <div class="hud-bottom">
    <AmmoBar />
    {#if $airstrikePreview}
      <div class="airstrike-confirm-row">
        <button class="btn-confirm-strike" on:click={confirmAirstrike}>✓ Confirm Strike</button>
        <button class="btn-cancel-strike" on:click={cancelAirstrike}>✗ Cancel</button>
      </div>
      <div class="airstrike-hint">Tap the map to reposition · confirm when ready</div>
    {:else if $airstrikeReady > 0}
      <button class="btn-airstrike" class:armed={$airstrikeArmed} on:click={toggleAirstrike}>
        🚀 Airstrike ({$airstrikeReady})
      </button>
      {#if $airstrikeArmed}
        <div class="airstrike-hint">Tap the map to place the strike zone</div>
      {/if}
    {/if}
    {#if $gpsError}
      <div class="gps-error">GPS: {$gpsError}</div>
    {/if}
    {#if usingBle}
      <div class="ble-active-row">
        <span class="sim-hint ble-hint">BLE gun active</span>
        <button class="btn-gun-mode" data-mode={gunMode} on:click={cycleGunMode}>
          {GUN_MODES[gunMode].label}
        </button>
      </div>
    {:else}
      <div class="ble-connect-row">
        <button class="btn-connect-gun" on:click={connectGunMidGame} disabled={bleConnecting}>
          {bleConnecting ? 'Connecting…' : 'Connect gun'}
        </button>
        <span class="sim-hint"><kbd>T</kbd> fire · <kbd>R</kbd> reload · <kbd>H</kbd> hit</span>
        <button class="btn-gun-mode" data-mode={gunMode} on:click={cycleGunMode}>
          {GUN_MODES[gunMode].label}
        </button>
      </div>
      {#if bleError}
        <p class="ble-error-inline">{bleError}</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .ingame {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }

  .map-wrap {
    position: absolute;
    inset: 0;
  }

  .hud-top {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 1000;
    pointer-events: none;
  }
  .hud-top > * { pointer-events: all; }

  .mode-badge {
    background: rgba(0,0,0,0.75);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2px;
    color: var(--accent);
  }

  .team-badge {
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 2px;
  }
  .team-badge-red {
    background: rgba(255,82,82,0.2);
    border: 1px solid rgba(255,82,82,0.7);
    color: #ff5252;
  }
  .team-badge-blue {
    background: rgba(68,138,255,0.2);
    border: 1px solid rgba(68,138,255,0.7);
    color: #448aff;
  }

  .timer {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    font-size: 28px;
    font-weight: 900;
    letter-spacing: 3px;
    font-variant-numeric: tabular-nums;
    color: #fff;
    text-shadow: 0 0 12px rgba(0,0,0,0.8);
    transition: color 0.3s;
  }
  .timer.urgent {
    color: #ff5252;
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse { from { opacity: 1; } to { opacity: 0.5; } }

  .scores-toggle {
    background: rgba(0,0,0,0.75);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: #fff;
    padding: 6px 10px;
    font-size: 16px;
    cursor: pointer;
  }

  .hud-bottom-right {
    position: absolute;
    bottom: 16px;
    right: 12px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .stats-bar {
    display: flex;
    gap: 6px;
  }
  .stat {
    background: rgba(0,0,0,0.7);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .stat-icon { font-size: 12px; }

  .health-wrap {
    align-self: stretch;
  }

  .hit-flash {
    position: absolute;
    inset: 0;
    z-index: 1400;
    background: rgba(255, 30, 30, 0.45);
    pointer-events: none;
    animation: hitfade 0.35s ease-out forwards;
  }
  @keyframes hitfade {
    from { opacity: 1; }
    to   { opacity: 0; }
  }

  .shot-hit {
    position: absolute;
    top: 42%;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1300;
    color: #00e676;
    font-size: 28px;
    font-weight: 900;
    letter-spacing: 5px;
    text-shadow: 0 0 16px rgba(0, 230, 118, 0.8);
    pointer-events: none;
    animation: shothit 0.6s ease-out forwards;
  }
  @keyframes shothit {
    0%   { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-14px); }
  }

  .respawn-overlay {
    position: absolute;
    inset: 0;
    z-index: 1500;
    background: rgba(20,0,0,0.45);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
  .respawn-title {
    font-size: 32px;
    font-weight: 900;
    letter-spacing: 4px;
    color: #ff5252;
    text-shadow: 0 0 20px rgba(255,82,82,0.6);
  }
  .respawn-killer {
    font-size: 15px;
    color: rgba(255,255,255,0.7);
    letter-spacing: 1px;
  }
  .killer-name {
    color: #fff;
    font-weight: 700;
  }
  .respawn-count {
    font-size: 18px;
    color: #fff;
    letter-spacing: 1px;
    font-variant-numeric: tabular-nums;
  }
  .respawn-ctf-timer {
    font-size: 42px;
    font-weight: 900;
    color: #ff5252;
    text-shadow: 0 0 16px rgba(255,82,82,0.6);
    letter-spacing: 2px;
  }

  .scores-overlay {
    position: absolute;
    top: 56px;
    left: 12px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .round-id {
    font-size: 10px;
    font-family: monospace;
    color: rgba(255,255,255,0.35);
    letter-spacing: 1px;
    cursor: default;
  }

  .score-actions {
    display: flex;
    gap: 8px;
  }

  .btn-end-game {
    background: rgba(255, 82, 82, 0.15);
    border: 1px solid #ff5252;
    border-radius: 8px;
    color: #ff5252;
    font-size: 13px;
    font-weight: 700;
    padding: 8px 16px;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 1px;
  }

  .btn-leave-game {
    background: rgba(0,0,0,0.6);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 700;
    padding: 8px 16px;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 1px;
  }
  .btn-leave-game:hover { color: #fff; }

  .killfeed-wrap {
    position: absolute;
    top: 56px;
    right: 12px;
    z-index: 1000;
    max-width: 220px;
  }

  .airstrike-warning {
    position: absolute;
    top: 92px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1400;
    background: rgba(40,0,0,0.85);
    border: 1px solid #ff1744;
    border-radius: 8px;
    padding: 6px 14px;
    color: #ff5252;
    font-weight: 900;
    font-size: 14px;
    letter-spacing: 1px;
    text-align: center;
    white-space: nowrap;
    pointer-events: none;
    animation: pulse 0.6s ease-in-out infinite alternate;
  }
  .airstrike-count {
    display: block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #fff;
    margin-top: 2px;
  }

  .oob-warning {
    position: absolute;
    top: 126px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1400;
    background: rgba(40, 25, 0, 0.9);
    border: 1px solid #ff9800;
    border-radius: 8px;
    padding: 6px 14px;
    color: #ff9800;
    font-weight: 900;
    font-size: 13px;
    letter-spacing: 1px;
    text-align: center;
    white-space: nowrap;
    pointer-events: none;
    animation: pulse 0.8s ease-in-out infinite alternate;
  }

  .radar-badge {
    position: absolute;
    top: 56px;
    left: 12px;
    z-index: 1000;
    background: rgba(0,0,0,0.7);
    border: 1px solid rgba(0,229,255,0.5);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 1px;
  }

  .ctf-bar {
    position: absolute;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    background: rgba(0,0,0,0.75);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    padding: 4px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1px;
    white-space: nowrap;
  }
  .ctf-red { color: #ff5252; }
  .ctf-blue { color: #448aff; }
  .ctf-sep { color: rgba(255,255,255,0.3); }

  .dom-bar {
    position: absolute;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    background: rgba(0,0,0,0.78);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    padding: 4px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1px;
    white-space: nowrap;
  }
  .dom-team { font-size: 16px; font-variant-numeric: tabular-nums; min-width: 36px; text-align: center; }
  .dom-red { color: #ff5252; }
  .dom-blue { color: #448aff; }
  .dom-zones { display: flex; gap: 6px; align-items: center; }
  .dom-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    border-radius: 5px;
    border: 1px solid rgba(255,255,255,0.15);
    min-width: 30px;
  }
  .dom-zone-red { background: rgba(255,82,82,0.25); border-color: rgba(255,82,82,0.6); }
  .dom-zone-blue { background: rgba(68,138,255,0.25); border-color: rgba(68,138,255,0.6); }
  .dom-zone-neutral { background: rgba(255,255,255,0.06); }
  .dom-zone-contested { animation: pulse 0.6s ease-in-out infinite alternate; }
  .dom-zone-id { font-size: 11px; font-weight: 900; letter-spacing: 1px; color: #fff; }
  .dom-zone-bar {
    width: 26px; height: 3px;
    background: rgba(255,255,255,0.15);
    border-radius: 2px;
    overflow: hidden;
  }
  .dom-zone-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.8s ease;
  }
  .dom-fill-red { background: #ff5252; }
  .dom-fill-blue { background: #448aff; }
  .dom-fill-neutral { background: rgba(255,255,255,0.4); }

  .respawn-hint {
    font-size: 13px;
    color: rgba(255,255,255,0.5);
    letter-spacing: 0.5px;
  }

  .inf-role {
    position: absolute;
    top: 56px;
    left: 12px;
    z-index: 1000;
    background: rgba(0,0,0,0.75);
    border-radius: 8px;
    padding: 4px 12px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .inf-role.inf-infected {
    border: 1px solid rgba(255,82,82,0.6);
    color: #ff5252;
  }
  .inf-role.inf-survivor {
    border: 1px solid rgba(0,200,83,0.6);
    color: #00c853;
  }
  .inf-immune {
    font-size: 11px;
    color: #ffd740;
    letter-spacing: 0.5px;
  }

  .gun-locked {
    position: absolute;
    top: 92px;
    left: 12px;
    z-index: 1000;
    background: rgba(40,0,0,0.8);
    border: 1px solid rgba(255,82,82,0.5);
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 700;
    color: #ff5252;
    letter-spacing: 1px;
  }

  .btn-airstrike {
    background: rgba(255, 23, 68, 0.15);
    border: 1px solid rgba(255, 23, 68, 0.5);
    border-radius: 8px;
    color: #ff5252;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 14px;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 1px;
  }
  .btn-airstrike.armed {
    background: #ff1744;
    color: #fff;
    animation: pulse 0.6s ease-in-out infinite alternate;
  }
  .airstrike-hint {
    font-size: 11px;
    color: #ff8a80;
    letter-spacing: 0.5px;
  }
  .airstrike-confirm-row {
    display: flex;
    gap: 8px;
  }
  .btn-confirm-strike {
    background: #ff9800;
    border: none;
    border-radius: 8px;
    color: #000;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 14px;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.5px;
    animation: pulse 0.6s ease-in-out infinite alternate;
  }
  .btn-cancel-strike {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 8px;
    color: #aaa;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 14px;
    cursor: pointer;
    font-family: inherit;
  }

  .hud-bottom {
    position: absolute;
    bottom: 16px;
    left: 12px;
    right: 12px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .gps-error {
    background: rgba(255,82,82,0.15);
    border: 1px solid #ff5252;
    border-radius: 6px;
    color: #ff5252;
    font-size: 12px;
    padding: 4px 10px;
  }

  .ble-connect-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .btn-connect-gun {
    background: rgba(0, 229, 255, 0.12);
    border: 1px solid rgba(0, 229, 255, 0.4);
    border-radius: 6px;
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    padding: 5px 10px;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .btn-connect-gun:disabled { opacity: 0.5; cursor: default; }

  .ble-error-inline {
    font-size: 11px;
    color: #ff5252;
    line-height: 1.4;
    margin: 0;
    max-width: 280px;
  }

  .sim-hint {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
  }
  .ble-hint { color: #00c853; }

  .ble-active-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .btn-gun-mode {
    background: rgba(0, 229, 255, 0.12);
    border: 1px solid rgba(0, 229, 255, 0.4);
    border-radius: 6px;
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 4px 12px;
    cursor: pointer;
    font-family: inherit;
    min-width: 64px;
  }
  /* AUTO uses the default cyan accent. */
  .btn-gun-mode[data-mode="semi"] {
    background: rgba(255, 193, 7, 0.15);
    border-color: rgba(255, 193, 7, 0.5);
    color: #ffc107;
  }
  .btn-gun-mode[data-mode="burst"] {
    background: rgba(255, 152, 0, 0.15);
    border-color: rgba(255, 152, 0, 0.5);
    color: #ff9800;
  }
  .btn-gun-mode[data-mode="plasma"] {
    background: rgba(224, 64, 251, 0.15);
    border-color: rgba(224, 64, 251, 0.5);
    color: #e040fb;
  }
  kbd {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 10px;
    font-family: inherit;
  }
</style>
