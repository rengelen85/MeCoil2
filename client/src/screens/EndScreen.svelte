<script>
import { GAME_MODES, GAME_STATES } from '../../../shared/messages.js';
import { sendLeaveRoom } from '../lib/network.js';
import {
  finalScores,
  gameConfig,
  gameState,
  myId,
  screen,
  winner,
} from '../stores/game.js';

$: isTDM = $gameConfig.mode === GAME_MODES.TEAM_DEATHMATCH;
$: isCTF = $gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG;
$: isTeamMode = isTDM || isCTF;
$: winnerLabel = isTeamMode
  ? $winner === 'draw'
    ? 'Draw!'
    : $winner
      ? `${$winner.toUpperCase()} Team Wins!`
      : 'Game Over'
  : $finalScores?.[0]?.username
    ? `${$finalScores[0].username} Wins!`
    : 'Game Over';

function playAgain() {
  gameState.set(GAME_STATES.WAITING);
  screen.set('lobby');
}
</script>

<div class="end-screen">
  <div class="banner">
    <div class="icon">🏆</div>
    <h1>{winnerLabel}</h1>
  </div>

  <div class="card scores-card">
    <h2>Final Scores</h2>
    {#if isTeamMode && $finalScores}
      {#each $finalScores as team}
        <div class="team-section team-{team.team}">
          <div class="team-header">
            <span>{team.team.toUpperCase()}</span>
            <span>{isCTF ? `${team.captures} captures` : `${team.kills} kills`}</span>
          </div>
          {#each team.players as p}
            <div class="score-row" class:is-me={p.id === $myId}>
              <span class="name">{p.username}</span>
              <span class="kd">{p.kills} / {p.deaths}</span>
            </div>
          {/each}
        </div>
      {/each}
    {:else if $finalScores}
      {#each $finalScores as p, i}
        <div class="score-row" class:is-me={p.id === $myId}>
          <span class="rank">#{i + 1}</span>
          <span class="name">{p.username}</span>
          <span class="kd">{p.kills} / {p.deaths}</span>
        </div>
      {/each}
    {/if}
  </div>

  <div class="end-actions">
    <button class="btn-primary" on:click={playAgain}>Back to Lobby</button>
    <button class="btn-leave" on:click={sendLeaveRoom}>Leave Room</button>
  </div>
</div>

<style>
  .end-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100dvh;
    padding: 32px 20px;
    gap: 24px;
  }

  .banner { text-align: center; }
  .icon { font-size: 56px; }
  h1 { font-size: 28px; font-weight: 900; letter-spacing: 2px; color: var(--accent); margin: 8px 0 0; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    width: 100%;
    max-width: 420px;
  }
  h2 { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); margin: 0 0 14px; }

  .score-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 15px;
    color: #ccc;
  }
  .score-row:last-child { border-bottom: none; }
  .score-row.is-me { color: #fff; font-weight: 700; }
  .rank { width: 24px; color: #666; }
  .name { flex: 1; }
  .kd { font-variant-numeric: tabular-nums; color: #888; }

  .team-section { margin-bottom: 14px; }
  .team-header {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 4px 0 8px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 6px;
  }
  .team-section.team-red .team-header { color: #ff5252; }
  .team-section.team-blue .team-header { color: #448aff; }

  .scores-card { max-width: 420px; }

  .end-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
    max-width: 420px;
  }

  .btn-leave {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
    text-decoration: underline;
    padding: 4px 8px;
    font-family: inherit;
  }
  .btn-leave:hover { color: #ff5252; }
</style>
