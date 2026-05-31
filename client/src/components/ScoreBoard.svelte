<script>
  import { scores, gameConfig, myId } from '../stores/game.js';
  import { GAME_MODES } from '../../../shared/messages.js';

  $: isTDM = $gameConfig.mode === GAME_MODES.TEAM_DEATHMATCH;
</script>

<div class="scoreboard">
  {#if isTDM}
    {#each $scores as team}
      <div class="team-row team-{team.team}">
        <span class="team-label">{team.team.toUpperCase()}</span>
        <span class="team-kills">{team.kills}</span>
        <div class="player-list">
          {#each team.players as p}
            <span class="player" class:is-me={p.id === $myId}>
              {p.username} {p.kills}/{p.deaths}
            </span>
          {/each}
        </div>
      </div>
    {/each}
  {:else}
    {#each $scores as p, i}
      <div class="score-row" class:is-me={p.id === $myId}>
        <span class="rank">#{i + 1}</span>
        <span class="name">{p.username}</span>
        <span class="kd">{p.kills}<span class="sep">/</span>{p.deaths}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .scoreboard {
    background: rgba(0,0,0,0.7);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 8px;
    font-size: 13px;
    min-width: 160px;
  }

  .score-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    color: #ccc;
  }
  .score-row.is-me { color: #fff; font-weight: 700; }
  .rank { color: #666; width: 22px; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kd { color: #aaa; font-variant-numeric: tabular-nums; }
  .sep { color: #555; margin: 0 2px; }

  .team-row { padding: 4px 0; }
  .team-row.team-red .team-label { color: #ff5252; }
  .team-row.team-blue .team-label { color: #448aff; }
  .team-label { font-weight: 700; font-size: 11px; letter-spacing: 1px; }
  .team-kills { float: right; font-weight: 700; font-size: 15px; }
  .player-list { display: flex; flex-direction: column; gap: 2px; margin-top: 3px; }
  .player { font-size: 12px; color: #bbb; }
  .player.is-me { color: #fff; font-weight: 700; }
</style>
