<script>
  import { killFeed } from '../stores/game.js';
</script>

<div class="killfeed">
  {#each [...$killFeed].reverse().slice(0, 6) as entry (entry.at)}
    <div class="entry" key={entry.at}>
      <span class="shooter">{entry.shooterName}</span>
      <span class="icon">☠</span>
      <span class="victim">{entry.victimName}</span>
    </div>
  {/each}
</div>

<style>
  .killfeed {
    display: flex;
    flex-direction: column;
    gap: 4px;
    pointer-events: none;
  }
  .entry {
    background: rgba(0,0,0,0.65);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
    display: flex;
    gap: 6px;
    align-items: center;
    animation: fadein 0.2s ease;
  }
  @keyframes fadein {
    from { opacity: 0; transform: translateX(12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  .shooter { color: #fff; font-weight: 600; }
  .icon { color: #ff5252; font-size: 11px; }
  .victim { color: #aaa; }
</style>
