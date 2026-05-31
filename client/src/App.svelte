<script>
  import { onMount } from 'svelte';
  import { screen, username, loadSession } from './stores/game.js';
  import { connect, sendRegister } from './lib/network.js';
  import Setup from './screens/Setup.svelte';
  import RoomSelect from './screens/RoomSelect.svelte';
  import Lobby from './screens/Lobby.svelte';
  import InGame from './screens/InGame.svelte';
  import EndScreen from './screens/EndScreen.svelte';

  onMount(async () => {
    const savedUsername = loadSession();
    if (savedUsername) {
      username.set(savedUsername);
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const serverUrl = `${proto}://${location.host}/ws`;
      try {
        await connect(serverUrl);
        sendRegister(savedUsername);
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
