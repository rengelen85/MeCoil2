<script>
  import { ammo, maxAmmo, isReloading, shieldActive, stealthActive } from '../stores/game.js';

  $: pct = Math.round(($ammo / $maxAmmo) * 100);
  $: ammoColor = pct > 50 ? '#00e676' : pct > 20 ? '#ffeb3b' : '#ff5252';
</script>

<div class="ammo-bar">
  <div class="label">
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
    <div class="status shield">🛡 SHIELD</div>
  {/if}
  {#if $stealthActive}
    <div class="status stealth">👻 STEALTH</div>
  {/if}
</div>

<style>
  .ammo-bar {
    background: rgba(0,0,0,0.7);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 8px 12px;
    min-width: 140px;
  }

  .label {
    font-size: 18px;
    font-weight: 700;
    color: #fff;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
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
    height: 6px;
    background: rgba(255,255,255,0.1);
    border-radius: 3px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: 3px;
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
</style>
