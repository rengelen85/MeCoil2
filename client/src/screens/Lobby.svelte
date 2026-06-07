<script>
  import { onDestroy, tick } from 'svelte';
  import { players, gameConfig, myId, isHost, hostId, gameState, countdownAt, roomName, gameId, gameArea, bleConnected } from '../stores/game.js';
  import { sendReady, sendGameConfig, sendStartGame, sendLeaveRoom, sendSetBase, sendSetGameArea } from '../lib/network.js';
  import { connectBle, isBleAvailable, bleErrorMessage } from '../lib/ble.js';
  import { GAME_MODES, GAME_STATES, TEAMS } from '../../../shared/messages.js';

  const bleAvailable = isBleAvailable();
  let bleConnecting = false;
  let bleError = '';

  async function connectGun() {
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

  let ready = false;
  let settingBase = false;
  let baseSetError = '';

  // Game area editing state (host only)
  let areaType = 'none';         // 'none' | 'circle' | 'polygon'
  let areaRadius = 200;          // metres for circle
  let areaCorners = [];          // [{lat, lng}] for polygon
  let settingAreaCenter = false;
  let addingCorner = false;
  let areaError = '';

  // Sync local UI state when gameArea changes from server
  $: {
    const a = $gameArea;
    if (!a) {
      areaType = 'none';
    } else if (a.type === 'circle') {
      areaType = 'circle';
      areaRadius = a.radiusM;
    } else if (a.type === 'polygon') {
      areaType = 'polygon';
      areaCorners = [...a.points];
    }
  }

  function applyAreaType(type) {
    areaType = type;
    areaError = '';
    if (type === 'none') {
      sendSetGameArea(null);
    }
    // circle and polygon are sent when the host confirms (center/corners are set)
  }

  async function setCircleCenter() {
    if (!navigator.geolocation) { areaError = 'Geolocation not supported'; return; }
    settingAreaCenter = true;
    areaError = '';
    navigator.geolocation.getCurrentPosition(
      pos => {
        sendSetGameArea({ type: 'circle', lat: pos.coords.latitude, lng: pos.coords.longitude, radiusM: areaRadius });
        settingAreaCenter = false;
      },
      err => { areaError = err.message; settingAreaCenter = false; },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function updateCircleRadius(value) {
    areaRadius = Number(value);
    // Only re-send if a center is already set
    if ($gameArea?.type === 'circle') {
      sendSetGameArea({ type: 'circle', lat: $gameArea.lat, lng: $gameArea.lng, radiusM: areaRadius });
    }
  }

  async function addCorner() {
    if (!navigator.geolocation) { areaError = 'Geolocation not supported'; return; }
    addingCorner = true;
    areaError = '';
    navigator.geolocation.getCurrentPosition(
      pos => {
        areaCorners = [...areaCorners, { lat: pos.coords.latitude, lng: pos.coords.longitude }];
        addingCorner = false;
        if (areaCorners.length >= 3) {
          sendSetGameArea({ type: 'polygon', points: areaCorners });
        }
      },
      err => { areaError = err.message; addingCorner = false; },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function removeCorner(i) {
    areaCorners = areaCorners.filter((_, idx) => idx !== i);
    if (areaCorners.length >= 3) {
      sendSetGameArea({ type: 'polygon', points: areaCorners });
    } else {
      sendSetGameArea(null);
    }
  }

  function clearArea() {
    areaCorners = [];
    sendSetGameArea(null);
  }

  // --- Host GPS preview map ---
  let previewMapEl;
  let _previewL = null;
  let _previewMap = null;
  let _previewInitializing = false;
  let _previewMyMarker = null;
  let _previewAreaLayer = null;
  let _previewCornerMarkers = [];
  let _previewGpsWatcher = null;

  // --- CTF base preview map ---
  let ctfPreviewMapEl;
  let _ctfL = null;
  let _ctfMap = null;
  let _ctfInitializing = false;
  let _ctfMyMarker = null;
  let _ctfRedMarker = null;
  let _ctfBlueMarker = null;
  let _ctfGpsWatcher = null;

  async function _initCtfPreviewMap() {
    if (_ctfMap || _ctfInitializing || !ctfPreviewMapEl) return;
    _ctfInitializing = true;
    _ctfL = (await import('leaflet')).default;
    await import('leaflet/dist/leaflet.css');
    _ctfMap = _ctfL.map(ctfPreviewMapEl, { zoomControl: false, attributionControl: false });
    _ctfL.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(_ctfMap);
    if (navigator.geolocation) {
      _ctfGpsWatcher = navigator.geolocation.watchPosition(
        pos => {
          const { latitude: lat, longitude: lng } = pos.coords;
          if (!_ctfMyMarker) {
            _ctfMyMarker = _ctfL.circleMarker([lat, lng], {
              radius: 8, color: '#00e5ff', fillColor: '#00e5ff', fillOpacity: 0.9, weight: 2,
            }).bindTooltip('You', { permanent: true, direction: 'top', offset: [0, -10] }).addTo(_ctfMap);
            _ctfMap.setView([lat, lng], 17);
          } else {
            _ctfMyMarker.setLatLng([lat, lng]);
          }
        },
        null,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
      );
    }
    _ctfInitializing = false;
    _renderCtfBases();
  }

  function _renderCtfBases() {
    if (!_ctfMap || !_ctfL) return;
    if (_ctfRedMarker) { _ctfRedMarker.remove(); _ctfRedMarker = null; }
    if (_ctfBlueMarker) { _ctfBlueMarker.remove(); _ctfBlueMarker = null; }
    const red = $gameConfig.redBase;
    const blue = $gameConfig.blueBase;
    if (red) {
      _ctfRedMarker = _ctfL.circleMarker([red.lat, red.lng], {
        radius: 10, color: '#ff5252', fillColor: '#ff5252', fillOpacity: 0.8, weight: 2,
      }).bindTooltip('Red', { permanent: true, direction: 'top', offset: [0, -12] }).addTo(_ctfMap);
    }
    if (blue) {
      _ctfBlueMarker = _ctfL.circleMarker([blue.lat, blue.lng], {
        radius: 10, color: '#448aff', fillColor: '#448aff', fillOpacity: 0.8, weight: 2,
      }).bindTooltip('Blue', { permanent: true, direction: 'top', offset: [0, -12] }).addTo(_ctfMap);
    }
    if (red && blue) {
      try {
        const group = _ctfL.featureGroup([_ctfRedMarker, _ctfBlueMarker]);
        _ctfMap.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 18 });
      } catch {}
    } else if (red) {
      _ctfMap.setView([red.lat, red.lng], 17);
    } else if (blue) {
      _ctfMap.setView([blue.lat, blue.lng], 17);
    }
  }

  $: if ($gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG && iAmHost) tick().then(_initCtfPreviewMap);
  $: if ($gameConfig.mode !== GAME_MODES.CAPTURE_THE_FLAG) {
    if (_ctfGpsWatcher != null) { navigator.geolocation?.clearWatch(_ctfGpsWatcher); _ctfGpsWatcher = null; }
    _ctfMap?.remove(); _ctfMap = null;
    _ctfMyMarker = null; _ctfRedMarker = null; _ctfBlueMarker = null; _ctfInitializing = false;
  }
  $: { $gameConfig; _renderCtfBases(); }

  onDestroy(() => {
    if (_previewGpsWatcher != null) {
      navigator.geolocation?.clearWatch(_previewGpsWatcher);
      _previewGpsWatcher = null;
    }
    _previewMap?.remove();
    _previewMap = null;
    if (_ctfGpsWatcher != null) {
      navigator.geolocation?.clearWatch(_ctfGpsWatcher);
      _ctfGpsWatcher = null;
    }
    _ctfMap?.remove();
    _ctfMap = null;
  });

  async function _initPreviewMap() {
    if (_previewMap || _previewInitializing || !previewMapEl) return;
    _previewInitializing = true;
    _previewL = (await import('leaflet')).default;
    await import('leaflet/dist/leaflet.css');
    _previewMap = _previewL.map(previewMapEl, { zoomControl: false, attributionControl: false });
    _previewL.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(_previewMap);
    if (navigator.geolocation) {
      _previewGpsWatcher = navigator.geolocation.watchPosition(
        pos => {
          const { latitude: lat, longitude: lng } = pos.coords;
          if (!_previewMyMarker) {
            _previewMyMarker = _previewL.circleMarker([lat, lng], {
              radius: 8, color: '#00e5ff', fillColor: '#00e5ff', fillOpacity: 0.9, weight: 2,
            }).bindTooltip('You', { permanent: true, direction: 'top', offset: [0, -10] }).addTo(_previewMap);
            _previewMap.setView([lat, lng], 17);
          } else {
            _previewMyMarker.setLatLng([lat, lng]);
          }
        },
        null,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
      );
    }
    _previewInitializing = false;
    _renderPreviewArea();
  }

  function _renderPreviewArea() {
    if (!_previewMap || !_previewL) return;
    _previewAreaLayer?.remove();
    _previewAreaLayer = null;
    for (const m of _previewCornerMarkers) m.remove();
    _previewCornerMarkers = [];

    const area = $gameArea;
    const STYLE = { color: '#ff9800', weight: 2.5, dashArray: '8 6', fillColor: '#ff9800', fillOpacity: 0.1 };

    if (area?.type === 'circle') {
      _previewAreaLayer = _previewL.circle([area.lat, area.lng], { radius: area.radiusM, ...STYLE }).addTo(_previewMap);
      try { _previewMap.fitBounds(_previewAreaLayer.getBounds(), { padding: [20, 20], maxZoom: 18 }); } catch {}
    } else if (area?.type === 'polygon' && area.points.length >= 3) {
      _previewAreaLayer = _previewL.polygon(area.points.map(p => [p.lat, p.lng]), STYLE).addTo(_previewMap);
      try { _previewMap.fitBounds(_previewAreaLayer.getBounds(), { padding: [20, 20], maxZoom: 18 }); } catch {}
    } else if (areaCorners.length > 0) {
      for (let i = 0; i < areaCorners.length; i++) {
        const c = areaCorners[i];
        _previewCornerMarkers.push(
          _previewL.circleMarker([c.lat, c.lng], {
            radius: 6, color: '#ff9800', fillColor: '#ff9800', fillOpacity: 0.9, weight: 2,
          }).bindTooltip(`#${i + 1}`, { permanent: true, direction: 'top', offset: [0, -8] }).addTo(_previewMap)
        );
      }
      if (areaCorners.length >= 2) {
        _previewAreaLayer = _previewL.polyline(
          areaCorners.map(c => [c.lat, c.lng]),
          { color: '#ff9800', weight: 2, dashArray: '8 6' }
        ).addTo(_previewMap);
      }
      const group = _previewL.featureGroup(_previewCornerMarkers);
      try { _previewMap.fitBounds(group.getBounds(), { padding: [30, 30], maxZoom: 18 }); } catch {}
    }
  }

  // Tear down the preview map when host switches back to 'no limit'
  $: if (areaType === 'none') {
    if (_previewGpsWatcher != null) { navigator.geolocation?.clearWatch(_previewGpsWatcher); _previewGpsWatcher = null; }
    _previewMap?.remove(); _previewMap = null;
    _previewMyMarker = null; _previewAreaLayer = null; _previewCornerMarkers = []; _previewInitializing = false;
  }

  // Init the preview map after the {#if} block renders the container
  $: if ((areaType === 'circle' || areaType === 'polygon') && iAmHost) tick().then(_initPreviewMap);

  // Keep the preview in sync with area data
  $: { $gameArea; areaCorners; _renderPreviewArea(); }

  $: countdown = $gameState === GAME_STATES.COUNTDOWN ? Math.max(0, Math.ceil(($countdownAt - Date.now()) / 1000)) : null;
  $: iAmHost = $myId === $hostId;
  $: me = $players.find(p => p.id === $myId);

  function toggleReady() {
    ready = !ready;
    sendReady(ready);
  }

  function updateConfig(field, value) {
    let parsed;
    if (field === 'mode') parsed = value;
    else if (field === 'friendlyFire') parsed = value;
    else parsed = Number(value);
    sendGameConfig({ ...$gameConfig, [field]: parsed });
  }

  // Countdown ticker
  let tickInterval;
  $: if ($gameState === GAME_STATES.COUNTDOWN) {
    tickInterval = setInterval(() => { countdown = Math.max(0, Math.ceil(($countdownAt - Date.now()) / 1000)); }, 200);
  } else {
    clearInterval(tickInterval);
  }

  async function setBase(team) {
    if (!navigator.geolocation) { baseSetError = 'Geolocation not supported'; return; }
    settingBase = true;
    baseSetError = '';
    navigator.geolocation.getCurrentPosition(
      pos => {
        sendSetBase(team, pos.coords.latitude, pos.coords.longitude);
        settingBase = false;
      },
      err => {
        baseSetError = err.message;
        settingBase = false;
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  function modeName(mode) {
    return mode === GAME_MODES.FFA ? 'Free for All'
         : mode === GAME_MODES.TEAM_DEATHMATCH ? 'Team Deathmatch'
         : mode === GAME_MODES.CAPTURE_THE_FLAG ? 'Capture the Flag'
         : 'Infection';
  }
</script>

<div class="lobby-screen">
  <header>
    <div class="header-left">
      <div class="logo-small">◎ {$roomName || 'MeCoil'}</div>
      {#if $gameId}
        <div class="game-id" title={$gameId}>ID {$gameId.slice(0, 8)}</div>
      {/if}
    </div>
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

    <!-- BLE gun connection -->
    {#if bleAvailable}
      <section class="card ble-card" class:ble-ok={$bleConnected}>
        {#if $bleConnected}
          <div class="ble-row">
            <span class="ble-dot"></span>
            <span class="ble-label">Gun connected</span>
          </div>
        {:else}
          <div class="ble-row">
            <span class="ble-dot ble-dot-off"></span>
            <span class="ble-label ble-label-off">No gun connected</span>
            <button class="btn-ble" on:click={connectGun} disabled={bleConnecting}>
              {bleConnecting ? 'Opening Bluetooth…' : 'Connect gun'}
            </button>
          </div>
          {#if bleError}
            <p class="ble-error">{bleError}</p>
          {/if}
        {/if}
      </section>
    {/if}

    <!-- Game config (host only) -->
    {#if iAmHost}
      <section class="card config-card">
        <h2>Game Settings</h2>

        <label>Mode
          <select on:change={e => updateConfig('mode', e.target.value)} value={$gameConfig.mode}>
            <option value={GAME_MODES.FFA}>Free for All</option>
            <option value={GAME_MODES.TEAM_DEATHMATCH}>Team Deathmatch</option>
            <option value={GAME_MODES.CAPTURE_THE_FLAG}>Capture the Flag</option>
            <option value={GAME_MODES.INFECTION}>Infection</option>
          </select>
        </label>

        <label>Time limit (minutes)
          <input type="number" min="1" max="60" value={$gameConfig.timeLimit}
            on:change={e => updateConfig('timeLimit', e.target.value)} />
        </label>

        {#if $gameConfig.mode !== GAME_MODES.INFECTION}
          <label>{$gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG ? 'Flag captures to win' : 'Score limit (kills)'}
            <input type="number" min="1" max="200" value={$gameConfig.scoreLimit}
              on:change={e => updateConfig('scoreLimit', e.target.value)} />
          </label>
        {/if}

        {#if $gameConfig.mode === GAME_MODES.TEAM_DEATHMATCH}
          <label class="label-checkbox">
            <input type="checkbox" checked={$gameConfig.friendlyFire}
              on:change={e => updateConfig('friendlyFire', e.target.checked)} />
            Friendly fire
          </label>
        {/if}

        {#if $gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG}
          <h2 class="subhead">Base Setup</h2>
          <p class="base-hint">Walk to each team's base location and tap the button to set it from your GPS position.</p>
          <div class="area-preview-map" bind:this={ctfPreviewMapEl}></div>
          <p class="preview-hint">Cyan dot = your GPS position · red/blue = bases</p>
          <div class="base-btns">
            <button class="btn-base btn-base-red" on:click={() => setBase(TEAMS.RED)} disabled={settingBase}>
              {$gameConfig.redBase ? '✓ Red base set' : 'Set Red Base'}
            </button>
            <button class="btn-base btn-base-blue" on:click={() => setBase(TEAMS.BLUE)} disabled={settingBase}>
              {$gameConfig.blueBase ? '✓ Blue base set' : 'Set Blue Base'}
            </button>
          </div>
          {#if baseSetError}
            <p class="base-error">{baseSetError}</p>
          {/if}
        {/if}

        <h2 class="subhead">Combat Settings</h2>

        <label>Bullets per magazine
          <input type="number" min="1" max="200" value={$gameConfig.bulletsPerMag}
            on:change={e => updateConfig('bulletsPerMag', e.target.value)} />
        </label>

        <label>HP per player
          <input type="number" min="1" max="1000" value={$gameConfig.hpPerPlayer}
            on:change={e => updateConfig('hpPerPlayer', e.target.value)} />
        </label>

        <label>Reload delay (seconds)
          <input type="number" min="0" max="30" step="0.5" value={$gameConfig.reloadDelaySecs}
            on:change={e => updateConfig('reloadDelaySecs', e.target.value)} />
        </label>

        <label>Respawn delay (seconds)
          <input type="number" min="0" max="60" value={$gameConfig.respawnDelaySecs}
            on:change={e => updateConfig('respawnDelaySecs', e.target.value)} />
        </label>

        <h2 class="subhead">Game Area</h2>
        <p class="base-hint">Optionally restrict play to a defined area. Players outside will be warned; power-ups only spawn inside.</p>

        <div class="area-type-row">
          {#each ['none', 'circle', 'polygon'] as t}
            <button
              class="btn-area-type"
              class:active={areaType === t}
              on:click={() => applyAreaType(t)}
            >{t === 'none' ? 'No limit' : t === 'circle' ? 'Circle' : 'Polygon'}</button>
          {/each}
        </div>

        {#if areaType !== 'none'}
          <div class="area-preview-map" bind:this={previewMapEl}></div>
          <p class="preview-hint">Cyan dot = your GPS position · orange = game area</p>
        {/if}

        {#if areaType === 'circle'}
          <label>Radius (metres)
            <input type="number" min="10" max="10000" value={areaRadius}
              on:change={e => updateCircleRadius(e.target.value)} />
          </label>
          <button class="btn-base btn-base-area" on:click={setCircleCenter} disabled={settingAreaCenter}>
            {$gameArea?.type === 'circle' ? '✓ Center set — tap to move' : 'Set center here (GPS)'}
          </button>
        {/if}

        {#if areaType === 'polygon'}
          <p class="base-hint">Walk to each corner and tap "Add corner here". Need at least 3 corners.</p>
          {#if areaCorners.length > 0}
            <ul class="corner-list">
              {#each areaCorners as corner, i}
                <li class="corner-row">
                  <span class="corner-label">#{i + 1} {corner.lat.toFixed(5)}, {corner.lng.toFixed(5)}</span>
                  <button class="btn-remove-corner" on:click={() => removeCorner(i)}>✕</button>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="base-btns">
            <button class="btn-base btn-base-area" on:click={addCorner} disabled={addingCorner}>
              {addingCorner ? 'Getting GPS…' : 'Add corner here'}
            </button>
            {#if areaCorners.length > 0}
              <button class="btn-base btn-base-clear" on:click={clearArea}>Clear all</button>
            {/if}
          </div>
          {#if areaCorners.length > 0 && areaCorners.length < 3}
            <p class="base-hint" style="color:#ff9800">Add {3 - areaCorners.length} more corner{3 - areaCorners.length > 1 ? 's' : ''} to activate</p>
          {:else if areaCorners.length >= 3}
            <p class="base-hint" style="color:#00c853">✓ Polygon active ({areaCorners.length} corners)</p>
          {/if}
        {/if}

        {#if areaError}
          <p class="base-error">{areaError}</p>
        {/if}

        <button class="btn-secondary" on:click={sendStartGame}>Force Start</button>
      </section>
    {:else}
      <section class="card config-card config-readonly">
        <h2>Game Settings</h2>
        <div class="config-row"><span>Mode</span><span>{modeName($gameConfig.mode)}</span></div>
        <div class="config-row"><span>Time</span><span>{$gameConfig.timeLimit} min</span></div>
        {#if $gameConfig.mode !== GAME_MODES.INFECTION}
          <div class="config-row">
            <span>{$gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG ? 'Captures to win' : 'Score limit'}</span>
            <span>{$gameConfig.scoreLimit}</span>
          </div>
        {/if}
        {#if $gameConfig.mode === GAME_MODES.TEAM_DEATHMATCH}
          <div class="config-row"><span>Friendly fire</span><span>{$gameConfig.friendlyFire ? 'On' : 'Off'}</span></div>
        {/if}
        {#if $gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG}
          <div class="config-row"><span>Red base</span><span>{$gameConfig.redBase ? 'Set' : 'Not set'}</span></div>
          <div class="config-row"><span>Blue base</span><span>{$gameConfig.blueBase ? 'Set' : 'Not set'}</span></div>
        {/if}
        {#if $gameConfig.mode === GAME_MODES.INFECTION}
          <div class="config-row"><span>Power-ups</span><span>Immunity only</span></div>
        {/if}
        <div class="config-row"><span>Magazine</span><span>{$gameConfig.bulletsPerMag} rounds</span></div>
        <div class="config-row"><span>HP / player</span><span>{$gameConfig.hpPerPlayer}</span></div>
        <div class="config-row"><span>Reload</span><span>{$gameConfig.reloadDelaySecs}s</span></div>
        {#if $gameConfig.mode !== GAME_MODES.CAPTURE_THE_FLAG}
          <div class="config-row"><span>Respawn</span><span>{$gameConfig.respawnDelaySecs}s</span></div>
        {/if}
        <div class="config-row">
          <span>Game area</span>
          <span>
            {#if !$gameArea}No limit
            {:else if $gameArea.type === 'circle'}Circle {$gameArea.radiusM}m
            {:else if $gameArea.type === 'polygon'}Polygon ({$gameArea.points.length} pts)
            {:else}Set{/if}
          </span>
        </div>
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
    <button class="btn-leave" on:click={sendLeaveRoom}>Leave Room</button>
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
  .header-left { display: flex; flex-direction: column; gap: 2px; }
  .logo-small { font-size: 18px; font-weight: 900; letter-spacing: 2px; color: var(--accent); }
  .game-id {
    font-size: 10px;
    font-family: monospace;
    color: var(--text-muted);
    letter-spacing: 1px;
    cursor: default;
  }

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
  .subhead { margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--accent); }
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
  .label-checkbox {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  .label-checkbox input[type="checkbox"] {
    width: 18px; height: 18px;
    accent-color: var(--accent);
    cursor: pointer;
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

  .btn-leave {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    padding: 4px 8px;
    font-family: inherit;
  }
  .btn-leave:hover { color: #ff5252; }

  .base-hint {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.5;
  }
  .base-btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .btn-base {
    flex: 1;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    font-family: inherit;
    text-transform: uppercase;
  }
  .btn-base:disabled { opacity: 0.5; cursor: default; }
  .btn-base-red {
    background: rgba(255,82,82,0.15);
    border: 1px solid rgba(255,82,82,0.5);
    color: #ff5252;
  }
  .btn-base-blue {
    background: rgba(68,138,255,0.15);
    border: 1px solid rgba(68,138,255,0.5);
    color: #448aff;
  }
  .base-error {
    font-size: 12px;
    color: #ff5252;
    margin: 0;
  }

  .area-type-row {
    display: flex;
    gap: 6px;
  }
  .btn-area-type {
    flex: 1;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    font-family: inherit;
    text-transform: uppercase;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-muted);
    transition: all 0.15s;
  }
  .btn-area-type.active {
    background: rgba(255, 152, 0, 0.15);
    border-color: rgba(255, 152, 0, 0.6);
    color: #ff9800;
  }
  .btn-base-area {
    background: rgba(255, 152, 0, 0.12);
    border: 1px solid rgba(255, 152, 0, 0.5);
    color: #ff9800;
    flex: 1;
  }
  .btn-base-clear {
    background: rgba(255, 82, 82, 0.1);
    border: 1px solid rgba(255, 82, 82, 0.4);
    color: #ff5252;
    flex: 1;
  }

  .corner-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 120px;
    overflow-y: auto;
    padding: 4px 0;
  }
  .corner-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    font-family: monospace;
    color: var(--text-muted);
    padding: 2px 4px;
    border-bottom: 1px solid var(--border);
  }
  .corner-label { flex: 1; }
  .btn-remove-corner {
    background: none;
    border: none;
    color: #ff5252;
    cursor: pointer;
    font-size: 12px;
    padding: 0 4px;
    font-family: inherit;
  }

  .area-preview-map {
    height: 200px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(255, 152, 0, 0.35);
  }

  .preview-hint {
    font-size: 10px;
    color: var(--text-muted);
    text-align: center;
    margin: 2px 0 0;
  }

  .ble-card { padding: 12px 16px; }
  .ble-card.ble-ok { border-color: #00c853; background: rgba(0,200,83,0.06); }
  .ble-row { display: flex; align-items: center; gap: 10px; }
  .ble-dot {
    width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    background: #00c853; box-shadow: 0 0 8px #00c853;
  }
  .ble-dot.ble-dot-off { background: #555; box-shadow: none; }
  .ble-label { font-size: 14px; font-weight: 600; color: #00c853; flex: 1; }
  .ble-label.ble-label-off { color: var(--text-muted); font-weight: 400; }
  .btn-ble {
    background: var(--accent); color: #000; border: none; border-radius: 8px;
    font-size: 13px; font-weight: 700; padding: 8px 14px; cursor: pointer;
    font-family: inherit; letter-spacing: 0.5px;
  }
  .btn-ble:disabled { opacity: 0.5; cursor: default; }
  .ble-error { font-size: 12px; color: #ff5252; margin: 6px 0 0; line-height: 1.5; }

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
