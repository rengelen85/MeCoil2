<script>
  import { onMount, onDestroy } from 'svelte';
  import Map from '../components/Map.svelte';
  import ScoreBoard from '../components/ScoreBoard.svelte';
  import KillFeed from '../components/KillFeed.svelte';
  import AmmoBar from '../components/AmmoBar.svelte';
  import { get } from 'svelte/store';
  import { timeRemaining, gameConfig, bleConnected, gunSlotId } from '../stores/game.js';
  import { startGPS, stopGPS, gpsError } from '../stores/map.js';
  import { startSimulator, stopSimulator } from '../lib/simulator.js';
  import { applyGunAssignment } from '../lib/ble.js';
  import { sendPosition } from '../lib/network.js';
  import { GAME_MODES } from '../../../shared/messages.js';

  let showScores = false;

  function formatTime(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  let usingBle = false;

  onMount(() => {
    startGPS((lat, lng) => sendPosition(lat, lng));
    if (get(bleConnected)) {
      usingBle = true;
      applyGunAssignment(get(gunSlotId));
    } else {
      startSimulator();
    }
  });

  onDestroy(() => {
    stopGPS();
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

  <!-- Score overlay -->
  {#if showScores}
    <div class="scores-overlay">
      <ScoreBoard />
    </div>
  {/if}

  <!-- Kill feed (top right) -->
  <div class="killfeed-wrap">
    <KillFeed />
  </div>

  <!-- Bottom HUD -->
  <div class="hud-bottom">
    <AmmoBar />
    {#if $gpsError}
      <div class="gps-error">GPS: {$gpsError}</div>
    {/if}
    {#if usingBle}
      <div class="sim-hint ble-hint">BLE gun active</div>
    {:else}
      <div class="sim-hint"><kbd>T</kbd> fire · <kbd>R</kbd> reload · <kbd>H</kbd> hit</div>
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

  .scores-overlay {
    position: absolute;
    top: 56px;
    left: 12px;
    z-index: 1000;
  }

  .killfeed-wrap {
    position: absolute;
    top: 56px;
    right: 12px;
    z-index: 1000;
    max-width: 220px;
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

  .sim-hint {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
  }
  .ble-hint { color: #00c853; }
  kbd {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 10px;
    font-family: inherit;
  }
</style>
