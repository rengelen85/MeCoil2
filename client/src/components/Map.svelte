<script>
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { myPosition, teammates, firingEnemies, powerups, airstrikes, heading } from '../stores/map.js';
  import { airstrikeArmed, airstrikeReady } from '../stores/game.js';
  import { sendCollect, sendDeployAirstrike } from '../lib/network.js';

  let mapEl;
  let map;
  let myMarker;
  let compassRose;
  let unsubscribers = [];
  const teamMarkers   = new Map();
  const enemyMarkers  = new Map();
  const powerupMarkers = new Map();
  const airstrikeMarkers = new Map(); // id -> { circle, marker }

  // Accumulated rotation avoids the wrap-around jump when heading crosses 0°/360°
  let _prevHeading = null;
  let _accRotation = 0;

  function smoothRotation(h) {
    if (_prevHeading === null) { _accRotation = h; }
    else {
      let delta = h - _prevHeading;
      if (delta >  180) delta -= 360;
      if (delta < -180) delta += 360;
      _accRotation += delta;
    }
    _prevHeading = h;
    return _accRotation;
  }

  // Reactive: rotate map so player's heading is always at screen top (heading-up mode)
  $: if ($heading !== null) {
    const rot = smoothRotation($heading);

    // Rotate the map container so forward direction = screen top
    if (mapEl) {
      mapEl.style.transform = `translate(-50%, -50%) rotate(${-rot}deg)`;
    }

    // Cone rotates by +rot to cancel out the container's -rot, keeping it pointing
    // forward (screen up) rather than drifting to point at north
    const cone = myMarker?.getElement()?.querySelector('.heading-cone');
    if (cone) {
      cone.style.transform = `rotate(${rot}deg)`;
      cone.style.transformOrigin = '30px 30px';
    }

    // Compass rose counter-rotates so cardinal labels show their true screen position
    if (compassRose) {
      compassRose.style.transform = `rotate(${-rot}deg)`;
      compassRose.style.transformOrigin = '40px 40px';
    }
  } else if (mapEl) {
    mapEl.style.transform = 'translate(-50%, -50%)';
  }

  onMount(async () => {
    const L = (await import('leaflet')).default;
    await import('leaflet/dist/leaflet.css');

    map = L.map(mapEl, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    // Player's own marker: circle + direction cone
    const myIcon = L.divIcon({
      className: '',
      html: `
        <svg class="marker-me-svg" viewBox="0 0 60 60" width="60" height="60">
          <g class="heading-cone">
            <path d="M30,30 L22,6 L38,6 Z"
              fill="rgba(0,229,255,0.35)"
              stroke="rgba(0,229,255,0.85)"
              stroke-width="1.5"
              stroke-linejoin="round"/>
          </g>
          <circle cx="30" cy="30" r="7" fill="white" stroke="#00e5ff" stroke-width="2.5"/>
          <circle cx="30" cy="30" r="12" fill="none" stroke="rgba(0,229,255,0.2)" stroke-width="4"/>
        </svg>`,
      iconSize:   [60, 60],
      iconAnchor: [30, 30],
    });

    const teamIcon = L.divIcon({
      className: '',
      html: '<div class="dot dot-team"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });

    const enemyIcon = L.divIcon({
      className: '',
      html: '<div class="dot dot-enemy"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });

    function powerupIcon(type) {
      const emoji = { fullReload: '🔋', healthPack: '🩹', shield: '🛡️', stealth: '👻', radar: '📡', airstrike: '🚀' }[type] ?? '📦';
      return L.divIcon({
        className: '',
        html: `<div class="dot dot-powerup" title="${type}">${emoji}</div>`,
        iconSize: [24, 24], iconAnchor: [12, 12],
      });
    }

    function airstrikeIcon() {
      return L.divIcon({
        className: '',
        html: '<div class="airstrike-target">💥</div>',
        iconSize: [30, 30], iconAnchor: [15, 15],
      });
    }

    // Arming an airstrike turns the next map tap into a strike call.
    map.on('click', e => {
      if (!get(airstrikeArmed)) return;
      sendDeployAirstrike(e.latlng.lat, e.latlng.lng);
      airstrikeArmed.set(false);
      airstrikeReady.update(n => Math.max(0, n - 1));
    });

    const unsubPos = myPosition.subscribe(pos => {
      if (!pos) return;
      if (!myMarker) {
        myMarker = L.marker([pos.lat, pos.lng], { icon: myIcon }).addTo(map);
        map.setView([pos.lat, pos.lng], 19);
      } else {
        myMarker.setLatLng([pos.lat, pos.lng]);
        map.panTo([pos.lat, pos.lng], { animate: false });
      }
    });

    const unsubTeam = teammates.subscribe(list => {
      const seen = new Set();
      for (const p of list) {
        seen.add(p.id);
        if (!teamMarkers.has(p.id)) {
          teamMarkers.set(p.id, L.marker([p.lat, p.lng], { icon: teamIcon }).bindTooltip(p.username).addTo(map));
        } else {
          teamMarkers.get(p.id).setLatLng([p.lat, p.lng]);
        }
      }
      for (const [id, m] of teamMarkers) {
        if (!seen.has(id)) { m.remove(); teamMarkers.delete(id); }
      }
    });

    const unsubEnemies = firingEnemies.subscribe(list => {
      const seen = new Set();
      for (const e of list) {
        seen.add(e.id);
        if (!enemyMarkers.has(e.id)) {
          enemyMarkers.set(e.id, L.marker([e.lat, e.lng], { icon: enemyIcon }).addTo(map));
        } else {
          enemyMarkers.get(e.id).setLatLng([e.lat, e.lng]);
        }
      }
      for (const [id, m] of enemyMarkers) {
        if (!seen.has(id)) { m.remove(); enemyMarkers.delete(id); }
      }
    });

    const unsubPowerups = powerups.subscribe(list => {
      const seen = new Set();
      for (const pkg of list) {
        seen.add(pkg.id);
        if (!powerupMarkers.has(pkg.id)) {
          const m = L.marker([pkg.lat, pkg.lng], { icon: powerupIcon(pkg.type) })
            .addTo(map)
            .on('click', () => sendCollect(pkg.id));
          powerupMarkers.set(pkg.id, m);
        }
      }
      for (const [id, m] of powerupMarkers) {
        if (!seen.has(id)) { m.remove(); powerupMarkers.delete(id); }
      }
    });

    const unsubAirstrikes = airstrikes.subscribe(list => {
      const seen = new Set();
      for (const a of list) {
        seen.add(a.id);
        if (!airstrikeMarkers.has(a.id)) {
          const circle = L.circle([a.lat, a.lng], {
            radius: a.radius,
            color: '#ff1744',
            weight: 2,
            fillColor: '#ff1744',
            fillOpacity: 0.18,
            className: 'airstrike-zone',
          }).addTo(map);
          const marker = L.marker([a.lat, a.lng], { icon: airstrikeIcon() }).addTo(map);
          airstrikeMarkers.set(a.id, { circle, marker });
        }
      }
      for (const [id, m] of airstrikeMarkers) {
        if (!seen.has(id)) { m.circle.remove(); m.marker.remove(); airstrikeMarkers.delete(id); }
      }
    });

    // NOTE: this onMount callback is async, so a returned cleanup function
    // would be silently ignored by Svelte. Register teardown via onDestroy
    // instead, otherwise these subscriptions leak across games and fire on a
    // removed Leaflet map (throwing and freezing the whole UI on round 2+).
    unsubscribers = [unsubPos, unsubTeam, unsubEnemies, unsubPowerups, unsubAirstrikes];
  });

  onDestroy(() => {
    for (const unsub of unsubscribers) unsub();
    unsubscribers = [];
    map?.remove();
  });
</script>

<div class="map-root">
  <div bind:this={mapEl} class="map-container"></div>

  <!-- Compass: only shown when device orientation is available -->
  {#if $heading !== null}
    <div class="compass-wrap">
      <svg viewBox="0 0 80 80" width="72" height="72" aria-label="Compass">
        <!-- Background -->
        <circle cx="40" cy="40" r="37" fill="rgba(13,13,15,0.82)" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>

        <!-- Rotating compass rose: cardinal labels track their true screen position -->
        <g bind:this={compassRose} class="compass-rose">
          <!-- Cardinal tick marks -->
          <line x1="40" y1="5"  x2="40" y2="14" stroke="#ff5252" stroke-width="2.5"/>
          <line x1="75" y1="40" x2="66" y2="40" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
          <line x1="40" y1="75" x2="40" y2="66" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
          <line x1="5"  y1="40" x2="14" y2="40" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>

          <!-- Intercardinal tick marks -->
          <line x1="67" y1="13" x2="61" y2="19" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
          <line x1="67" y1="67" x2="61" y2="61" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
          <line x1="13" y1="67" x2="19" y2="61" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
          <line x1="13" y1="13" x2="19" y2="19" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>

          <!-- Cardinal labels -->
          <text x="40" y="26" text-anchor="middle" dominant-baseline="middle"
                fill="#ff5252" font-size="11" font-weight="700" font-family="sans-serif">N</text>
          <text x="59" y="40" text-anchor="middle" dominant-baseline="middle"
                fill="rgba(255,255,255,0.5)" font-size="9" font-family="sans-serif">E</text>
          <text x="40" y="56" text-anchor="middle" dominant-baseline="middle"
                fill="rgba(255,255,255,0.5)" font-size="9" font-family="sans-serif">S</text>
          <text x="21" y="40" text-anchor="middle" dominant-baseline="middle"
                fill="rgba(255,255,255,0.5)" font-size="9" font-family="sans-serif">W</text>
        </g>

        <!-- Fixed forward indicator: cyan triangle at top = player's forward direction -->
        <polygon points="40,4 36,13 44,13" fill="#00e5ff" opacity="0.9"/>

        <!-- Center dot -->
        <circle cx="40" cy="40" r="3" fill="rgba(255,255,255,0.5)"/>
      </svg>
    </div>
  {/if}
</div>

<style>
  .map-root {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /*
   * Must be larger than the screen diagonal so that rotating 360° never
   * exposes blank corners. calc(100vw + 100vh) always exceeds the diagonal
   * regardless of orientation or aspect ratio.
   */
  .map-container {
    position: absolute;
    width: calc(100vw + 100vh);
    height: calc(100vw + 100vh);
    top: 50%;
    left: 50%;
    transform-origin: center;
    transform: translate(-50%, -50%);
  }

  /* Compass widget */
  .compass-wrap {
    position: absolute;
    bottom: 110px;
    right: 12px;
    z-index: 500;
    pointer-events: none;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.6));
  }

  /* Smooth rotation for the compass rose (inside SVG, outside Svelte scope) */
  :global(.compass-rose) {
    transition: transform 0.25s ease-out;
  }

  /* Player marker */
  :global(.marker-me-svg) {
    overflow: visible;
  }

  /* Team / enemy / powerup dot markers */
  :global(.dot) {
    border-radius: 50%;
    border: 2px solid rgba(0,0,0,0.4);
  }
  :global(.dot-team) {
    width: 14px; height: 14px;
    background: #00c853;
    box-shadow: 0 0 8px #00c853;
  }
  :global(.dot-enemy) {
    width: 14px; height: 14px;
    background: #ff1744;
    box-shadow: 0 0 10px #ff1744;
    animation: enemy-pulse 0.6s ease-in-out infinite alternate;
  }
  :global(.dot-powerup) {
    background: rgba(0,0,0,0.7);
    border-radius: 50%;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    width: 24px; height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @keyframes enemy-pulse {
    from { transform: scale(1); }
    to   { transform: scale(1.4); }
  }

  /* Inbound airstrike blast zone + target marker */
  :global(.airstrike-zone) {
    animation: airstrike-pulse 0.8s ease-in-out infinite alternate;
  }
  @keyframes airstrike-pulse {
    from { stroke-opacity: 0.9; fill-opacity: 0.12; }
    to   { stroke-opacity: 0.4; fill-opacity: 0.30; }
  }
  :global(.airstrike-target) {
    font-size: 22px;
    line-height: 1;
    text-align: center;
    filter: drop-shadow(0 0 6px rgba(255,23,68,0.9));
    animation: enemy-pulse 0.5s ease-in-out infinite alternate;
  }
</style>
