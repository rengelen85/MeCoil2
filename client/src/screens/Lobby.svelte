<script>
  import { players, gameConfig, myId, isHost, hostId, gameState, countdownAt, roomName } from '../stores/game.js';
  import { sendReady, sendGameConfig, sendStartGame } from '../lib/network.js';
  import { GAME_MODES, GAME_STATES } from '../../../shared/messages.js';

  let ready = false;

  $: countdown = $gameState === GAME_STATES.COUNTDOWN ? Math.max(0, Math.ceil(($countdownAt - Date.now()) / 1000)) : null;
  $: iAmHost = $myId === $hostId;
  $: me = $players.find(p => p.id === $myId);

  function toggleReady() {
    ready = !ready;
    sendReady(ready);
  }

  function updateConfig(field, value) {
    const parsed = field === 'mode' ? value : Number(value);
    sendGameConfig({ ...$gameConfig, [field]: parsed });
  }

  // Countdown ticker
  let tick;
  $: if ($gameState === GAME_STATES.COUNTDOWN) {
    tick = setInterval(() => { countdown = Math.max(0, Math.ceil(($countdownAt - Date.now()) / 1000)); }, 200);
  } else {
    clearInterval(tick);
  }
</script>

<div class="lobby-screen">
  <header>
    <div class="logo-small">◎ {$roomName || 'MeCoil'}</div>
    {#if $gameState === GAME_STATES.COUNTDOWN}
      <div class="countdown-banner">Game starts in {countdown}…</div>
    {/if}
  </header>

  <div class="content">
    <!-- Player list -->
    <section class="card">
      <h2>Players <span class="count">{$players.length}</span></h2>
      <ul class="player-list">
        {#each $players as p}
          <li class="player-row" class:is-me={p.id === $myId}>
            <span class="dot" class:ready={p.ready}></span>
            <span class="name">{p.username}</span>
            {#if p.id === $hostId}<span class="tag">HOST</span>{/if}
            {#if p.team && p.team !== 'none'}<span class="team-badge team-{p.team}">{p.team}</span>{/if}
            <span class="ready-label">{p.ready ? 'Ready' : 'Not ready'}</span>
          </li>
        {/each}
      </ul>
    </section>

    <!-- Game config (host only) -->
    {#if iAmHost}
      <section class="card config-card">
        <h2>Game Settings</h2>

        <label>Mode
          <select on:change={e => updateConfig('mode', e.target.value)} value={$gameConfig.mode}>
            <option value={GAME_MODES.FFA}>Free for All</option>
            <option value={GAME_MODES.TEAM_DEATHMATCH}>Team Deathmatch</option>
          </select>
        </label>

        <label>Time limit (minutes)
          <input type="number" min="1" max="60" value={$gameConfig.timeLimit}
            on:change={e => updateConfig('timeLimit', e.target.value)} />
        </label>

        <label>Score limit (kills)
          <input type="number" min="1" max="200" value={$gameConfig.scoreLimit}
            on:change={e => updateConfig('scoreLimit', e.target.value)} />
        </label>

        <button class="btn-secondary" on:click={sendStartGame}>Force Start</button>
      </section>
    {:else}
      <section class="card config-card config-readonly">
        <h2>Game Settings</h2>
        <div class="config-row"><span>Mode</span><span>{$gameConfig.mode === GAME_MODES.FFA ? 'Free for All' : 'Team Deathmatch'}</span></div>
        <div class="config-row"><span>Time</span><span>{$gameConfig.timeLimit} min</span></div>
        <div class="config-row"><span>Score limit</span><span>{$gameConfig.scoreLimit} kills</span></div>
      </section>
    {/if}
  </div>

  <footer>
    <button
      class="btn-ready"
      class:ready
      on:click={toggleReady}
      disabled={$gameState === GAME_STATES.COUNTDOWN}
    >
      {ready ? '✓ Ready' : 'Ready Up'}
    </button>
    <p class="sim-hint">Simulator: <kbd>T</kbd> fire · <kbd>R</kbd> reload · <kbd>H</kbd> hit</p>
  </footer>
</div>

<style>
  .lobby-screen {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    padding: 0 16px 24px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 20px;
  }
  .logo-small { font-size: 18px; font-weight: 900; letter-spacing: 2px; color: var(--accent); }

  .countdown-banner {
    background: var(--accent);
    color: #000;
    font-weight: 700;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 14px;
    letter-spacing: 1px;
  }

  .content { display: flex; flex-direction: column; gap: 16px; flex: 1; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
  }
  h2 { font-size: 13px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); margin: 0 0 12px; }
  .count { color: var(--accent); margin-left: 4px; }

  .player-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .player-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
  }
  .player-row.is-me { font-weight: 700; }
  .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #555;
    flex-shrink: 0;
    transition: background 0.3s;
  }
  .dot.ready { background: #00c853; box-shadow: 0 0 6px #00c853; }
  .name { flex: 1; }
  .tag {
    font-size: 10px; letter-spacing: 1px; color: var(--accent);
    border: 1px solid var(--accent); border-radius: 3px; padding: 1px 5px;
  }
  .team-badge {
    font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
  }
  .team-badge.team-red { background: rgba(255,82,82,0.2); color: #ff5252; }
  .team-badge.team-blue { background: rgba(68,138,255,0.2); color: #448aff; }
  .ready-label { font-size: 12px; color: var(--text-muted); }

  .config-card { display: flex; flex-direction: column; gap: 12px; }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  select, input[type="number"] {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 15px;
    padding: 10px 12px;
    font-family: inherit;
    outline: none;
  }
  select:focus, input:focus { border-color: var(--accent); }

  .config-readonly .config-row {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }
  .config-row span:last-child { color: #fff; font-weight: 600; }

  footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 20px;
  }

  .btn-ready {
    width: 100%;
    max-width: 360px;
    padding: 16px;
    border-radius: 12px;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    background: var(--surface);
    border: 2px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-ready.ready {
    background: #00c853;
    border-color: #00c853;
    color: #000;
    box-shadow: 0 0 20px rgba(0,200,83,0.4);
  }
  .btn-ready:disabled { opacity: 0.5; pointer-events: none; }

  .sim-hint { font-size: 12px; color: var(--text-muted); }
  kbd {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: inherit;
    font-size: 11px;
  }
</style>
