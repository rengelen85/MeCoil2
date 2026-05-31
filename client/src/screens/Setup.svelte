<script>
  import { username, bleConnected } from '../stores/game.js';
  import { connect, sendRegister } from '../lib/network.js';
  import { connectBle, isBleAvailable, bleErrorMessage } from '../lib/ble.js';

  let nameInput = '';
  let status = '';
  let connecting = false;
  let error = '';
  let bleConnecting = false;
  let bleError = '';

  async function connectGun() {
    if (!isBleAvailable()) {
      bleError = 'Bluetooth is not available. Use Chrome or Edge on Android over HTTPS. iOS is not supported.';
      return;
    }
    bleConnecting = true;
    bleError = '';
    try {
      await connectBle();
    } catch (e) {
      bleError = bleErrorMessage(e);
    } finally {
      bleConnecting = false;
    }
  }

  function serverUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  async function join() {
    const name = nameInput.trim();
    if (!name) { error = 'Please enter a callsign.'; return; }
    error = '';
    connecting = true;
    status = 'Connecting…';
    try {
      await connect(serverUrl());
      username.set(name);
      sendRegister(name);
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

    <!-- BLE gun connection -->
    <div class="ble-section" class:ble-ok={$bleConnected}>
      {#if $bleConnected}
        <div class="ble-connected-row">
          <span class="ble-dot"></span>
          <span class="ble-connected-label">Gun connected</span>
        </div>
      {:else}
        <div class="ble-instructions">
          <span class="ble-step">1.</span> Power on your Goliath Recoil gun
          <br/>
          <span class="ble-step">2.</span> Tap <strong>Connect gun</strong> and select <em>SRG-…</em> from the list
        </div>
        <button
          class="btn-ble"
          on:click={connectGun}
          disabled={bleConnecting}
        >
          {bleConnecting ? 'Opening Bluetooth picker…' : 'Connect gun'}
        </button>
        {#if bleError}
          <p class="ble-error">{bleError}</p>
        {/if}
        <p class="ble-skip">No gun? You can still play using the keyboard simulator.</p>
      {/if}
    </div>

    <button class="btn-primary" on:click={join} disabled={connecting}>
      {connecting ? status : 'Continue'}
    </button>
  </div>

  <p class="hint">
    Bluetooth requires Chrome or Edge on Android over HTTPS.<br/>
    iOS is not supported due to browser restrictions.
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

  .error { color: #ff5252; font-size: 13px; margin: 0; }

  /* BLE section */
  .ble-section {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: rgba(255,255,255,0.02);
  }
  .ble-section.ble-ok {
    border-color: #00c853;
    background: rgba(0, 200, 83, 0.06);
  }

  .ble-instructions {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.7;
  }
  .ble-step {
    color: var(--accent);
    font-weight: 700;
  }

  .btn-ble {
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    padding: 11px 14px;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.2s;
    letter-spacing: 0.5px;
  }
  .btn-ble:disabled { opacity: 0.5; cursor: default; }

  .ble-error {
    color: #ff5252;
    font-size: 12px;
    line-height: 1.5;
    margin: 0;
  }

  .ble-skip {
    color: var(--text-muted);
    font-size: 11px;
    margin: 0;
    opacity: 0.7;
  }

  .ble-connected-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ble-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #00c853;
    box-shadow: 0 0 8px #00c853;
    flex-shrink: 0;
  }
  .ble-connected-label {
    color: #00c853;
    font-weight: 600;
    font-size: 14px;
  }

  .hint {
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
    line-height: 1.6;
  }
</style>
