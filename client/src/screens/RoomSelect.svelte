<script>
  import { rooms, username, clearSession } from '../stores/game.js';
  import { sendCreateRoom, sendJoinRoom } from '../lib/network.js';
  import { GAME_STATES } from '../../../shared/messages.js';

  let newRoomName = '';

  function create() {
    sendCreateRoom(newRoomName.trim() || null);
    newRoomName = '';
  }

  function onKey(e) {
    if (e.key === 'Enter') create();
  }

  function stateLabel(state) {
    if (state === GAME_STATES.PLAYING) return 'In Game';
    if (state === GAME_STATES.COUNTDOWN) return 'Starting';
    return 'Waiting';
  }
</script>

<div class="room-screen">
  <header>
    <div class="logo-small">◎ MeCoil</div>
    <div class="header-right">
      <div class="player-tag">{$username}</div>
      <button class="btn-logout" on:click={clearSession}>Log off</button>
    </div>
  </header>

  <div class="content">
    <section class="card">
      <h2>New Game</h2>
      <input
        type="text"
        bind:value={newRoomName}
        on:keydown={onKey}
        placeholder="Room name (optional)"
        maxlength="32"
        autocomplete="off"
        spellcheck="false"
      />
      <button class="btn-primary" on:click={create}>Create Game</button>
    </section>

    <section class="card">
      <h2>Join Game {#if $rooms.length > 0}<span class="count">{$rooms.length}</span>{/if}</h2>

      {#if $rooms.length === 0}
        <p class="empty">No games yet. Create one above!</p>
      {:else}
        <ul class="room-list">
          {#each $rooms as room (room.id)}
            <li class="room-row">
              <div class="room-info">
                <span class="room-name">{room.name}</span>
                <span class="room-meta">
                  {room.playerCount} player{room.playerCount !== 1 ? 's' : ''}
                </span>
              </div>
              <span class="state-badge state-{room.state}">{stateLabel(room.state)}</span>
              <button class="btn-join" on:click={() => sendJoinRoom(room.id)}>Join</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div>

<style>
  .room-screen {
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
  .header-right { display: flex; align-items: center; gap: 12px; }
  .player-tag { font-size: 13px; color: var(--text-muted); letter-spacing: 1px; }
  .btn-logout { background: transparent; border: 1px solid var(--border); color: var(--text-muted); border-radius: 6px; font-size: 12px; font-weight: 600; padding: 6px 12px; cursor: pointer; font-family: inherit; transition: border-color 0.2s, color 0.2s; }
  .btn-logout:hover { border-color: var(--text-muted); color: var(--text); }

  .content { display: flex; flex-direction: column; gap: 16px; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    font-size: 13px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .count { color: var(--accent); margin-left: 4px; }

  input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 15px;
    padding: 11px 14px;
    outline: none;
    transition: border-color 0.2s;
    font-family: inherit;
  }
  input:focus { border-color: var(--accent); }

  .btn-primary {
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 700;
    padding: 13px;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 1px;
    transition: opacity 0.2s;
  }
  .btn-primary:hover { opacity: 0.88; }

  .empty { color: var(--text-muted); font-size: 14px; margin: 4px 0; }

  .room-list { list-style: none; display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; }

  .room-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .room-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .room-name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .room-meta { font-size: 12px; color: var(--text-muted); }

  .state-badge {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: 3px 8px;
    border-radius: 20px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .state-badge.state-waiting {
    background: rgba(255,255,255,0.08);
    color: var(--text-muted);
  }
  .state-badge.state-countdown {
    background: rgba(255,193,7,0.15);
    color: #ffc107;
  }
  .state-badge.state-playing {
    background: rgba(0,200,83,0.15);
    color: #00c853;
  }

  .btn-join {
    background: transparent;
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 14px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .btn-join:hover {
    background: var(--accent);
    color: #000;
  }
</style>
