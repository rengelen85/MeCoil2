<script>
import { onMount } from 'svelte';
import { connect, sendRegister, sendRejoin } from './lib/network.js';
import EndScreen from './screens/EndScreen.svelte';
import InGame from './screens/InGame.svelte';
import Lobby from './screens/Lobby.svelte';
import RoomSelect from './screens/RoomSelect.svelte';
import Setup from './screens/Setup.svelte';
import {
  isReconnecting,
  loadSession,
  screen,
  username,
} from './stores/game.js';

onMount(async () => {
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

{#if $isReconnecting}
  <div class="reconnect-overlay">
    <div class="reconnect-box">
      <div class="spinner"></div>
      <p>Reconnecting…</p>
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
