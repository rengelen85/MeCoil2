<script>
import { onMount } from 'svelte';
import { tryAutoReconnectBle } from './lib/ble.js';
import {
  connect,
  manualReconnect,
  sendRegister,
  sendRejoin,
} from './lib/network.js';
import EndScreen from './screens/EndScreen.svelte';
import InGame from './screens/InGame.svelte';
import Lobby from './screens/Lobby.svelte';
import RoomSelect from './screens/RoomSelect.svelte';
import Setup from './screens/Setup.svelte';
import {
  isReconnecting,
  loadSession,
  reconnectFailed,
  screen,
  username,
} from './stores/game.js';

onMount(async () => {
  // Silently reconnect to the last-used gun (no picker, no error on failure).
  tryAutoReconnectBle();

  const { username: savedUsername, playerId: savedPlayerId } = loadSession();
  if (savedUsername) {
    username.set(savedUsername);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const serverUrl = `${proto}://${location.host}/ws`;
    try {
      await connect(serverUrl);
      if (savedPlayerId) {
        sendRejoin(savedPlayerId, savedUsername);
      } else {
        sendRegister(savedUsername);
      }
    } catch (e) {
      console.error('Failed to restore session:', e);
    }
  }
});
</script>

{#if $screen === 'setup'}
  <Setup />
{:else if $screen === 'roomselect'}
  <RoomSelect />
{:else if $screen === 'lobby'}
  <Lobby />
{:else if $screen === 'ingame'}
  <InGame />
{:else if $screen === 'end'}
  <EndScreen />
{/if}

{#if $isReconnecting || $reconnectFailed}
  <div class="reconnect-overlay">
    <div class="reconnect-box">
      {#if $isReconnecting}
        <div class="spinner"></div>
        <p>Reconnecting…</p>
      {:else}
        <p class="reconnect-title">Connection lost</p>
        <p class="reconnect-sub">
          Rejoin to get back in with your stats and power-ups.
        </p>
        <button class="rejoin-btn" on:click={manualReconnect}>
          🔄 Rejoin game
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .reconnect-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }

  .reconnect-box {
    background: #1a1a2e;
    border: 1px solid #444;
    border-radius: 12px;
    padding: 2rem 3rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    color: #fff;
    font-size: 1.1rem;
  }

  .reconnect-box p {
    margin: 0;
  }

  .reconnect-title {
    font-size: 1.3rem;
    font-weight: 700;
  }

  .reconnect-sub {
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.75);
    text-align: center;
    max-width: 22rem;
  }

  .rejoin-btn {
    margin-top: 0.5rem;
    background: #00e5ff;
    color: #00232b;
    border: none;
    border-radius: 8px;
    padding: 0.7rem 1.6rem;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
  }

  .rejoin-btn:hover {
    background: #33ebff;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 4px solid rgba(255, 255, 255, 0.2);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
