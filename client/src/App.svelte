<script>
  import { screen } from './stores/game.js';
  import Setup from './screens/Setup.svelte';
  import RoomSelect from './screens/RoomSelect.svelte';
  import Lobby from './screens/Lobby.svelte';
  import InGame from './screens/InGame.svelte';
  import EndScreen from './screens/EndScreen.svelte';
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
