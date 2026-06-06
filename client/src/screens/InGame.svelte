<script>
  import { onMount, onDestroy } from 'svelte';
  import Map from '../components/Map.svelte';
  import ScoreBoard from '../components/ScoreBoard.svelte';
  import KillFeed from '../components/KillFeed.svelte';
  import AmmoBar from '../components/AmmoBar.svelte';
  import HealthBar from '../components/HealthBar.svelte';
  import { get } from 'svelte/store';
  import { timeRemaining, gameConfig, bleConnected, gunSlotId, myId, hostId, roundId, myScore, isAlive, respawnCountdown, killedBy, lastHitAt, radarActive, airstrikeReady, airstrikeArmed } from '../stores/game.js';
  import { startGPS, stopGPS, startHeading, stopHeading, gpsError, airstrikes } from '../stores/map.js';
  import { startSimulator, stopSimulator, setSimulatorMode } from '../lib/simulator.js';
  import { applyGunAssignment, connectBle, isBleAvailable, bleErrorMessage, setGunMode, GUN_MODES, GUN_MODE_CYCLE } from '../lib/ble.js';
  import { sendPosition, sendStopGame, sendLeaveRoom } from '../lib/network.js';
  import { GAME_MODES } from '../../../shared/messages.js';

  let showScores = false;
  let bleConnecting = false;
  let bleError = '';
  let gunMode = 'auto'; // key of GUN_MODES

  let hitFlashActive = false;
  let hitFlashTimer = null;
  $: if ($lastHitAt) {
    hitFlashActive = true;
    if (hitFlashTimer) clearTimeout(hitFlashTimer);
    hitFlashTimer = setTimeout(() => { hitFlashActive = false; }, 350);
  }

  async function cycleGunMode() {
    const i = GUN_MODE_CYCLE.indexOf(gunMode);
    gunMode = GUN_MODE_CYCLE[(i + 1) % GUN_MODE_CYCLE.length];
    if (usingBle) {
      try {
        await setGunMode(gunMode);
      } catch (e) {
        bleError = bleErrorMessage(e);
      }
    } else {
      setSimulatorMode(gunMode);
    }
  }

  async function connectGunMidGame() {
    if (!isBleAvailable()) {
      bleError = 'Web Bluetooth not available. Use Chrome or Edge on Android over HTTPS.';
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
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  let usingBle = false;

  // 1s ticker so the incoming-airstrike countdown updates live.
  let now = Date.now();
  let nowTimer = null;

  // Seconds until the soonest inbound airstrike detonates (null if none).
  $: incomingStrike = $airstrikes.length
    ? Math.max(0, Math.ceil((Math.min(...$airstrikes.map(a => a.detonateAt)) - now) / 1000))
    : null;

  function toggleAirstrike() {
    if ($airstrikeReady <= 0) return;
    airstrikeArmed.update(v => !v);
  }

  onMount(() => {
    startGPS((lat, lng) => sendPosition(lat, lng));
    startHeading();
    nowTimer = setInterval(() => { now = Date.now(); }, 1000);
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

  $: modeLabel = $gameConfig.mode === GAME_MODES.FFA ? 'FFA'
               : $gameConfig.mode === GAME_MODES.TEAM_DEATHMATCH ? 'TDM'
               : 'CTF';
</script>

<div class="ingame">
  <!-- Full-screen map -->
  <div class="map-wrap">
    <Map />
  </div>

  <!-- Top HUD bar -->
  <div class="hud-top">
    <div class="mode-badge">{modeLabel}</div>
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

  <!-- Radar active indicator -->
  {#if $radarActive}
    <div class="radar-badge">📡 RADAR</div>
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

  <!-- Respawn overlay -->
  {#if !$isAlive}
    <div class="respawn-overlay">
      <div class="respawn-title">YOU ARE DOWN</div>
      {#if $killedBy}
        <div class="respawn-killer">Killed by <span class="killer-name">{$killedBy}</span></div>
      {/if}
      <div class="respawn-count">Respawning in {$respawnCountdown ?? 0}…</div>
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
    {#if $airstrikeReady > 0}
      <button class="btn-airstrike" class:armed={$airstrikeArmed} on:click={toggleAirstrike}>
        🚀 Airstrike ({$airstrikeReady})
      </button>
      {#if $airstrikeArmed}
        <div class="airstrike-hint">Tap the map to call the strike</div>
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

  .timer {
    flex: 1;
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

  .respawn-overlay {
    position: absolute;
    inset: 0;
    z-index: 1500;
    background: rgba(20,0,0,0.78);
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
