<script>
  import { hp, maxHp, shieldActive } from '../stores/game.js';

  $: pct = $maxHp > 0 ? Math.min(100, Math.round(($hp / $maxHp) * 100)) : 0;
  $: hpColor = pct > 50 ? '#00e676' : pct > 25 ? '#ffeb3b' : '#ff5252';
</script>

<div class="health-bar">
  <div class="label">
    <span class="heart">♥</span>
    <span class="count">{$hp}</span>
    <span class="sep">/</span>
    <span class="max">{$maxHp}</span>
    {#if $shieldActive}<span class="shield-tag">🛡</span>{/if}
  </div>
  <div class="bar-track">
    <div class="bar-fill" class:shielded={$shieldActive} style="width:{pct}%; background:{hpColor}"></div>
  </div>
</div>

<style>
  .health-bar {
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
  .heart { color: #ff5252; font-size: 14px; }
  .sep { color: #555; }
  .max { font-size: 12px; color: #888; }
  .shield-tag { margin-left: auto; font-size: 13px; }

  .bar-track {
    height: 8px;
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.25s ease, background 0.3s;
  }
  .bar-fill.shielded {
    box-shadow: 0 0 8px 1px rgba(130, 177, 255, 0.8);
  }
</style>
