<script>
  import { username } from '../stores/game.js';
  import { connect, sendJoin } from '../lib/network.js';

  let nameInput = '';
  let status = '';
  let connecting = false;
  let error = '';

  // In Phase 1 the server URL is inferred from the current host.
  // In dev the Vite proxy forwards /ws to the Node server.
  function serverUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  async function join() {
    const name = nameInput.trim();
    if (!name) { error = 'Please enter a username.'; return; }
    error = '';
    connecting = true;
    status = 'Connecting…';
    try {
      await connect(serverUrl());
      username.set(name);
      sendJoin(name);
    } catch (e) {
      error = 'Could not connect to the game server. Make sure you are on the same WiFi.';
      status = '';
      connecting = false;
    }
  }

  function onKey(e) {
    if (e.key === 'Enter') join();
  }
</script>

<div class="setup-screen">
  <div class="logo">
    <div class="logo-icon">◎</div>
    <h1>MeCoil</h1>
    <p class="tagline">Laser Tag — Reloaded</p>
  </div>

  <div class="card">
    <label for="username-input">Your callsign</label>
    <input
      id="username-input"
      type="text"
      bind:value={nameInput}
      on:keydown={onKey}
      placeholder="Enter username"
      maxlength="20"
      disabled={connecting}
      autocomplete="off"
      spellcheck="false"
    />

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <button class="btn-primary" on:click={join} disabled={connecting}>
      {connecting ? status : 'Join Game'}
    </button>
  </div>

  <p class="hint">
    Runs in Chrome / Chromium browsers.<br/>
    iOS is not supported due to Web Bluetooth restrictions.
  </p>
</div>

<style>
  .setup-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    padding: 24px;
    gap: 32px;
  }

  .logo { text-align: center; }
  .logo-icon {
    font-size: 64px;
    color: var(--accent);
    line-height: 1;
    filter: drop-shadow(0 0 16px var(--accent));
  }
  h1 {
    font-size: 36px;
    font-weight: 900;
    letter-spacing: 4px;
    margin: 8px 0 4px;
    text-transform: uppercase;
  }
  .tagline { color: var(--text-muted); font-size: 13px; letter-spacing: 2px; text-transform: uppercase; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  label { font-size: 12px; color: var(--text-muted); letter-spacing: 1px; text-transform: uppercase; }

  input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 16px;
    padding: 12px 14px;
    outline: none;
    transition: border-color 0.2s;
    font-family: inherit;
  }
  input:focus { border-color: var(--accent); }

  .error { color: #ff5252; font-size: 13px; }

  .hint {
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
    line-height: 1.6;
  }
</style>
