<script>
  import { onMount, onDestroy } from 'svelte';
  import { myPosition, teammates, firingEnemies, powerups, heading } from '../stores/map.js';
  import { sendCollect } from '../lib/network.js';

  let mapEl;
  let map;
  let myMarker;
  let compassNeedle;
  const teamMarkers   = new Map();
  const enemyMarkers  = new Map();
  const powerupMarkers = new Map();

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

  // Reactive: update the heading cone on the player marker and the compass needle
  $: if ($heading !== null) {
    const rot = smoothRotation($heading);

    const cone = myMarker?.getElement()?.querySelector('.heading-cone');
    if (cone) {
      cone.style.transform = `rotate(${rot}deg)`;
      cone.style.transformOrigin = '30px 30px';
    }

    if (compassNeedle) {
      compassNeedle.style.transform = `rotate(${rot}deg)`;
      compassNeedle.style.transformOrigin = '40px 40px';
    }
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
      const emoji = { fullReload: '🔋', shield: '🛡️', stealth: '👻' }[type] ?? '📦';
      return L.divIcon({
        className: '',
        html: `<div class="dot dot-powerup" title="${type}">${emoji}</div>`,
        iconSize: [20, 20], iconAnchor: [10, 10],
      });
    }

    const unsubPos = myPosition.subscribe(pos => {
      if (!pos) return;
      if (!myMarker) {
        myMarker = L.marker([pos.lat, pos.lng], { icon: myIcon }).addTo(map);
        map.setView([pos.lat, pos.lng], 17);
      } else {
        myMarker.setLatLng([pos.lat, pos.lng]);
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

    return () => { unsubPos(); unsubTeam(); unsubEnemies(); unsubPowerups(); };
  });

  onDestroy(() => map?.remove());
</script>

<div class="map-root">
  <div bind:this={mapEl} class="map-container"></div>

  <!-- Compass: only shown when device orientation is available -->
  {#if $heading !== null}
    <div class="compass-wrap">
      <svg viewBox="0 0 80 80" width="72" height="72" aria-label="Compass">
        <!-- Background -->
        <circle cx="40" cy="40" r="37" fill="rgba(13,13,15,0.82)" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>

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

        <!-- Needle — red tip points toward your current heading direction -->
        <g bind:this={compassNeedle} class="compass-needle">
          <polygon points="40,18 37,40 43,40" fill="#ff5252" opacity="0.95"/>
          <polygon points="40,62 37,40 43,40" fill="rgba(255,255,255,0.22)"/>
          <circle cx="40" cy="40" r="4" fill="rgba(13,13,15,0.9)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
        </g>
      </svg>
    </div>
  {/if}
</div>

<style>
  .map-root {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .map-container {
    width: 100%;
    height: 100%;
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

  /* Smooth rotation transitions — applied globally since these elements
     are inside Leaflet's DOM (outside Svelte's scoped styles) */
  :global(.compass-needle) {
    transition: transform 0.25s ease-out;
  }
  :global(.heading-cone) {
    transition: transform 0.2s ease-out;
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
    font-size: 14px;
    line-height: 20px;
    text-align: center;
    cursor: pointer;
    width: 20px; height: 20px;
  }

  @keyframes enemy-pulse {
    from { transform: scale(1); }
    to   { transform: scale(1.4); }
  }
</style>
