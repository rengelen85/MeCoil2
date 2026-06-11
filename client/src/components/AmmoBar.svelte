<script>
import {
  ammo,
  fastReloadActive,
  fastReloadCountdown,
  isReloading,
  maxAmmo,
  shieldActive,
  shieldCountdown,
  stealthActive,
  stealthCountdown,
} from '../stores/game.js';

$: pct = Math.round(($ammo / $maxAmmo) * 100);
$: ammoColor = pct > 50 ? '#00e676' : pct > 20 ? '#ffeb3b' : '#ff5252';

function fmtCountdown(secs) {
  if (secs === null) return '';
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}
</script>

<div class="ammo-bar">
  <div class="label">
    <span class="ammo-icon">🔫</span>
    {#if $isReloading}
      <span class="reloading">RELOADING…</span>
    {:else}
      <span class="count">{$ammo}</span>
      <span class="sep">/</span>
      <span class="max">{$maxAmmo}</span>
    {/if}
  </div>

  <div class="bar-track">
    <div class="bar-fill" style="width:{pct}%; background:{ammoColor}"></div>
  </div>

  {#if $shieldActive}
    <div class="status shield">🛡 SHIELD {fmtCountdown($shieldCountdown)}</div>
  {/if}
  {#if $stealthActive}
    <div class="status stealth">👻 STEALTH {fmtCountdown($stealthCountdown)}</div>
  {/if}
  {#if $fastReloadActive}
    <div class="status fast-reload">🔋 FAST RELOAD {fmtCountdown($fastReloadCountdown)}</div>
  {/if}
</div>

<style>
  .ammo-bar {
    background: rgba(0,0,0,0.7);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 8px 12px;
    min-width: 160px;
  }

  .label {
    font-size: 16px;
    font-weight: 700;
    color: #fff;
    letter-spacing: 1px;
    margin-bottom: 6px;
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .ammo-icon { font-size: 14px; }
  .sep { color: #555; margin: 0 3px; }
  .max { font-size: 13px; color: #888; }
  .reloading {
    font-size: 12px;
    color: #ffeb3b;
    letter-spacing: 1px;
    animation: blink 0.8s step-end infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }

  .bar-track {
    height: 8px;
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.2s ease, background 0.3s;
  }

  .status {
    margin-top: 5px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    color: #fff;
  }
  .shield { color: #82b1ff; }
  .stealth { color: #e040fb; }
  .fast-reload { color: #69f0ae; }
</style>
