<script>
  import { onMount, onDestroy } from 'svelte';
  import Map from '../components/Map.svelte';
  import ScoreBoard from '../components/ScoreBoard.svelte';
  import KillFeed from '../components/KillFeed.svelte';
  import AmmoBar from '../components/AmmoBar.svelte';
  import { get } from 'svelte/store';
  import { timeRemaining, gameConfig, bleConnected, gunSlotId, myId, hostId } from '../stores/game.js';
  import { startGPS, stopGPS, startHeading, stopHeading, gpsError } from '../stores/map.js';
  import { startSimulator, stopSimulator } from '../lib/simulator.js';
  import { applyGunAssignment, connectBle, isBleAvailable, bleErrorMessage } from '../lib/ble.js';
  import { sendPosition, sendStopGame } from '../lib/network.js';
  import { GAME_MODES } from '../../../shared/messages.js';

  let showScores = false;
  let bleConnecting = false;
  let bleError = '';

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

  onMount(() => {
    startGPS((lat, lng) => sendPosition(lat, lng));
    startHeading();
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
      {#if $myId === $hostId}
        <button class="btn-end-game" on:click={sendStopGame}>End Game</button>
      {/if}
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
      <div class="ble-connect-row">
        <button class="btn-connect-gun" on:click={connectGunMidGame} disabled={bleConnecting}>
          {bleConnecting ? 'Connecting…' : 'Connect gun'}
        </button>
        <span class="sim-hint"><kbd>T</kbd> fire · <kbd>R</kbd> reload · <kbd>H</kbd> hit</span>
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

  .scores-overlay {
    position: absolute;
    top: 56px;
    left: 12px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
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
  kbd {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 10px;
    font-family: inherit;
  }
</style>
