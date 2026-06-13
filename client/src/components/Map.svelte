<script>
import { onDestroy, onMount } from 'svelte';
import { get } from 'svelte/store';
import { AIRSTRIKE_RADIUS_M } from '../../../shared/messages.js';
import { sendCollect } from '../lib/network.js';
import { airstrikeArmed, airstrikePreview, gameArea } from '../stores/game.js';
import {
  airstrikes,
  ctfBases,
  ctfFlags,
  domZones,
  firingEnemies,
  graves,
  heading,
  myPosition,
  powerups,
  teammates,
} from '../stores/map.js';

let mapEl;
let map;
let myMarker;
let compassRose;
let unsubscribers = [];
const teamMarkers = new Map();
const enemyMarkers = new Map();
const powerupMarkers = new Map();
const airstrikeMarkers = new Map(); // id -> { circle, marker }
const graveMarkers = new Map(); // playerId -> tombstone marker
let previewCircle = null; // pending-confirmation airstrike preview
let previewMarker = null;
const ctfBaseCircles = new Map(); // team -> { circle }
const ctfFlagMarkers = new Map(); // team -> marker
const domZoneCircles = new Map(); // zoneId -> { circle, label }
let gameAreaLayer = null; // L.circle or L.polygon for the play boundary

// Accumulated rotation avoids the wrap-around jump when heading crosses 0°/360°
let _prevHeading = null;
let _accRotation = 0;

function smoothRotation(h) {
  if (_prevHeading === null) {
    _accRotation = h;
  } else {
    let delta = h - _prevHeading;
    if (delta > 180) delta -= 360;
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
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);

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
    iconSize: [60, 60],
    iconAnchor: [30, 30],
  });

  const teamIcon = L.divIcon({
    className: '',
    html: '<div class="dot dot-team"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  const enemyIcon = L.divIcon({
    className: '',
    html: '<div class="dot dot-enemy"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  function powerupIcon(type) {
    const emoji =
      {
        fastReload: '🔋',
        healthPack: '🩹',
        shield: '🛡️',
        stealth: '👻',
        radar: '📡',
        airstrike: '🚀',
        immunity: '💉',
      }[type] ?? '📦';
    return L.divIcon({
      className: '',
      html: `<div class="dot dot-powerup" title="${type}">${emoji}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  function airstrikeIcon() {
    return L.divIcon({
      className: '',
      html: '<div class="airstrike-target">💥</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  function flagIcon(team, state) {
    const color = team === 'red' ? '#ff5252' : '#448aff';
    let content;
    if (state === 'carried') {
      content = `<span style="font-size:20px">🏃</span>`;
    } else if (state === 'dropped') {
      // Team-colored flag lying on the ground — X mark signals "not at base"
      content = `<svg viewBox="0 0 24 28" width="24" height="28">
          <line x1="4" y1="3" x2="4" y2="25" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <polygon points="4,3 19,9 4,15" fill="${color}" opacity="0.6"/>
          <line x1="1" y1="23" x2="9" y2="23" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="16" y1="19" x2="22" y2="25" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <line x1="22" y1="19" x2="16" y2="25" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
    } else {
      // SVG flag so the color is actually applied (🚩 emoji ignores CSS color)
      content = `<svg viewBox="0 0 20 26" width="20" height="26">
          <line x1="4" y1="2" x2="4" y2="24" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <polygon points="4,2 19,9 4,16" fill="${color}"/>
        </svg>`;
    }
    return L.divIcon({
      className: '',
      html: `<div class="ctf-flag" style="color:${color}">${content}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  // Tombstone at a player's last death spot, with their name beside it.
  function graveIcon(username) {
    const safe = String(username ?? '').replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
    return L.divIcon({
      className: '',
      html: `<div class="grave"><span class="grave-icon">🪦</span><span class="grave-name">${safe}</span></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    });
  }

  // The map container is CSS-rotated for heading-up mode but Leaflet doesn't
  // know about that rotation. When rotated, getBoundingClientRect() returns the
  // bounding box of the rotated element, so Leaflet's e.latlng is wrong. We
  // correct by un-rotating the screen offset around the visual map centre.
  function correctedLatLng(e) {
    if (_accRotation === 0) return { lat: e.latlng.lat, lng: e.latlng.lng };
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dx = e.originalEvent.clientX - cx;
    const dy = e.originalEvent.clientY - cy;
    const rad = (_accRotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const ux = dx * cos - dy * sin;
    const uy = dx * sin + dy * cos;
    const half = mapEl.offsetWidth / 2;
    const pt = map.containerPointToLatLng(L.point(half + ux, half + uy));
    return { lat: pt.lat, lng: pt.lng };
  }

  function previewIcon() {
    return L.divIcon({
      className: '',
      html: '<div class="airstrike-preview-target">🎯</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  // Clicking while armed (or while a preview is already placed) sets / moves
  // the preview circle. The actual strike is only called in on Confirm.
  map.on('click', (e) => {
    if (!get(airstrikeArmed) && !get(airstrikePreview)) return;
    const latlng = correctedLatLng(e);
    airstrikePreview.set(latlng);
    if (get(airstrikeArmed)) airstrikeArmed.set(false);
  });

  // Keep the map cursor in sync with the armed / preview state.
  const unsubCursor = airstrikeArmed.subscribe((armed) => {
    if (map) map.getContainer().style.cursor = armed ? 'crosshair' : '';
  });

  const unsubPos = myPosition.subscribe((pos) => {
    if (!pos) return;
    if (!myMarker) {
      myMarker = L.marker([pos.lat, pos.lng], {
        icon: myIcon,
        interactive: false,
      }).addTo(map);
      map.setView([pos.lat, pos.lng], 19);
    } else {
      myMarker.setLatLng([pos.lat, pos.lng]);
      map.panTo([pos.lat, pos.lng], { animate: false });
    }
  });

  const unsubTeam = teammates.subscribe((list) => {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      if (!teamMarkers.has(p.id)) {
        teamMarkers.set(
          p.id,
          L.marker([p.lat, p.lng], { icon: teamIcon })
            .bindTooltip(p.username)
            .addTo(map),
        );
      } else {
        teamMarkers.get(p.id).setLatLng([p.lat, p.lng]);
      }
    }
    for (const [id, m] of teamMarkers) {
      if (!seen.has(id)) {
        m.remove();
        teamMarkers.delete(id);
      }
    }
  });

  const unsubEnemies = firingEnemies.subscribe((list) => {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      if (!enemyMarkers.has(e.id)) {
        enemyMarkers.set(
          e.id,
          L.marker([e.lat, e.lng], { icon: enemyIcon }).addTo(map),
        );
      } else {
        enemyMarkers.get(e.id).setLatLng([e.lat, e.lng]);
      }
    }
    for (const [id, m] of enemyMarkers) {
      if (!seen.has(id)) {
        m.remove();
        enemyMarkers.delete(id);
      }
    }
  });

  const unsubPowerups = powerups.subscribe((list) => {
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
      if (!seen.has(id)) {
        m.remove();
        powerupMarkers.delete(id);
      }
    }
  });

  const unsubAirstrikes = airstrikes.subscribe((list) => {
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
        const marker = L.marker([a.lat, a.lng], {
          icon: airstrikeIcon(),
        }).addTo(map);
        airstrikeMarkers.set(a.id, { circle, marker });
      }
    }
    for (const [id, m] of airstrikeMarkers) {
      if (!seen.has(id)) {
        m.circle.remove();
        m.marker.remove();
        airstrikeMarkers.delete(id);
      }
    }
  });

  const unsubPreview = airstrikePreview.subscribe((pos) => {
    if (previewCircle) {
      previewCircle.remove();
      previewCircle = null;
    }
    if (previewMarker) {
      previewMarker.remove();
      previewMarker = null;
    }
    if (pos) {
      previewCircle = L.circle([pos.lat, pos.lng], {
        radius: AIRSTRIKE_RADIUS_M,
        color: '#ff9800',
        weight: 2,
        dashArray: '8 5',
        fillColor: '#ff9800',
        fillOpacity: 0.15,
        interactive: false,
        className: 'airstrike-preview-zone',
      }).addTo(map);
      previewMarker = L.marker([pos.lat, pos.lng], {
        icon: previewIcon(),
        interactive: false,
      }).addTo(map);
    }
  });

  const unsubGraves = graves.subscribe((list) => {
    const seen = new Set();
    for (const g of list) {
      seen.add(g.id);
      if (!graveMarkers.has(g.id)) {
        graveMarkers.set(
          g.id,
          L.marker([g.lat, g.lng], { icon: graveIcon(g.username) }).addTo(map),
        );
      } else {
        // A repeat death moves the existing tombstone to the new spot.
        const m = graveMarkers.get(g.id);
        m.setLatLng([g.lat, g.lng]);
        m.setIcon(graveIcon(g.username));
      }
    }
    for (const [id, m] of graveMarkers) {
      if (!seen.has(id)) {
        m.remove();
        graveMarkers.delete(id);
      }
    }
  });

  const CTF_BASE_COLORS = { red: '#ff5252', blue: '#448aff' };
  const CTF_BASE_RADIUS_M = 7.5;

  const unsubCtfBases = ctfBases.subscribe((bases) => {
    for (const team of ['red', 'blue']) {
      const base = bases[team];
      if (base && !ctfBaseCircles.has(team)) {
        const circle = L.circle([base.lat, base.lng], {
          radius: CTF_BASE_RADIUS_M,
          color: CTF_BASE_COLORS[team],
          weight: 2,
          fillColor: CTF_BASE_COLORS[team],
          fillOpacity: 0.15,
        }).addTo(map);
        ctfBaseCircles.set(team, circle);
      } else if (base && ctfBaseCircles.has(team)) {
        ctfBaseCircles.get(team).setLatLng([base.lat, base.lng]);
      } else if (!base && ctfBaseCircles.has(team)) {
        ctfBaseCircles.get(team).remove();
        ctfBaseCircles.delete(team);
      }
    }
  });

  const unsubCtfFlags = ctfFlags.subscribe((flags) => {
    for (const team of ['red', 'blue']) {
      const flag = flags[team];
      if (flag && flag.lat !== null) {
        const label = `${team === 'red' ? 'Red' : 'Blue'} flag${flag.state === 'dropped' ? ' — DROPPED!' : ''}`;
        const tooltipOpts = {
          direction: 'top',
          permanent: flag.state === 'dropped',
        };
        if (!ctfFlagMarkers.has(team)) {
          const m = L.marker([flag.lat, flag.lng], {
            icon: flagIcon(team, flag.state),
          })
            .bindTooltip(label, tooltipOpts)
            .addTo(map);
          ctfFlagMarkers.set(team, m);
        } else {
          const m = ctfFlagMarkers.get(team);
          m.setLatLng([flag.lat, flag.lng]);
          m.setIcon(flagIcon(team, flag.state));
          m.unbindTooltip();
          m.bindTooltip(label, tooltipOpts);
        }
      } else if (ctfFlagMarkers.has(team)) {
        ctfFlagMarkers.get(team).remove();
        ctfFlagMarkers.delete(team);
      }
    }
  });

  const GAME_AREA_STYLE = {
    color: '#ff9800',
    weight: 2.5,
    dashArray: '8 6',
    fillColor: '#ff9800',
    fillOpacity: 0.06,
    className: 'game-area-boundary',
  };

  const unsubGameArea = gameArea.subscribe((area) => {
    if (gameAreaLayer) {
      gameAreaLayer.remove();
      gameAreaLayer = null;
    }
    if (!area) return;
    if (area.type === 'circle') {
      gameAreaLayer = L.circle([area.lat, area.lng], {
        radius: area.radiusM,
        ...GAME_AREA_STYLE,
      }).addTo(map);
    } else if (area.type === 'polygon' && area.points.length >= 3) {
      gameAreaLayer = L.polygon(
        area.points.map((p) => [p.lat, p.lng]),
        GAME_AREA_STYLE,
      ).addTo(map);
    }
  });

  const DOM_ZONE_RADIUS_M = 7.5;
  const DOM_ZONE_COLORS = {
    red: '#ff5252',
    blue: '#448aff',
    neutral: '#9e9e9e',
  };

  function domZoneIcon(zone) {
    const color = DOM_ZONE_COLORS[zone.owner] ?? DOM_ZONE_COLORS.neutral;
    const contested = zone.contested;
    const progress = Math.round(Math.abs(zone.controlValue ?? 0) * 100);
    const capColor = zone.capturingTeam
      ? DOM_ZONE_COLORS[zone.capturingTeam]
      : color;
    return L.divIcon({
      className: '',
      html: `<div class="dom-zone-marker" style="border-color:${color};background:rgba(${color === '#ff5252' ? '255,82,82' : color === '#448aff' ? '68,138,255' : '158,158,158'},0.18)">
        <span class="dom-zone-letter" style="color:${color}">${zone.id}</span>
        ${progress > 0 && progress < 100 ? `<div class="dom-zone-prog-bar"><div class="dom-zone-prog-fill" style="width:${progress}%;background:${capColor}"></div></div>` : ''}
        ${contested ? '<span class="dom-zone-contested-icon">⚡</span>' : ''}
      </div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
  }

  const unsubDomZones = domZones.subscribe((zones) => {
    const seen = new Set();
    for (const zone of zones) {
      if (zone.lat === null || zone.lng === null) continue;
      seen.add(zone.id);
      const color = DOM_ZONE_COLORS[zone.owner] ?? DOM_ZONE_COLORS.neutral;
      if (!domZoneCircles.has(zone.id)) {
        const circle = L.circle([zone.lat, zone.lng], {
          radius: DOM_ZONE_RADIUS_M,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.12,
          className: 'dom-zone-circle',
        }).addTo(map);
        const label = L.marker([zone.lat, zone.lng], {
          icon: domZoneIcon(zone),
          interactive: false,
        }).addTo(map);
        domZoneCircles.set(zone.id, { circle, label });
      } else {
        const { circle, label } = domZoneCircles.get(zone.id);
        circle.setStyle({ color, fillColor: color });
        label.setIcon(domZoneIcon(zone));
      }
    }
    for (const [id, { circle, label }] of domZoneCircles) {
      if (!seen.has(id)) {
        circle.remove();
        label.remove();
        domZoneCircles.delete(id);
      }
    }
  });

  // NOTE: this onMount callback is async, so a returned cleanup function
  // would be silently ignored by Svelte. Register teardown via onDestroy
  // instead, otherwise these subscriptions leak across games and fire on a
  // removed Leaflet map (throwing and freezing the whole UI on round 2+).
  unsubscribers = [
    unsubPos,
    unsubTeam,
    unsubEnemies,
    unsubPowerups,
    unsubAirstrikes,
    unsubPreview,
    unsubGraves,
    unsubCtfBases,
    unsubCtfFlags,
    unsubGameArea,
    unsubDomZones,
    unsubCursor,
  ];
});

onDestroy(() => {
  for (const unsub of unsubscribers) unsub();
  unsubscribers = [];
  for (const c of ctfBaseCircles.values()) c.remove();
  ctfBaseCircles.clear();
  for (const m of ctfFlagMarkers.values()) m.remove();
  ctfFlagMarkers.clear();
  for (const { circle, label } of domZoneCircles.values()) {
    circle.remove();
    label.remove();
  }
  domZoneCircles.clear();
  if (previewCircle) {
    previewCircle.remove();
    previewCircle = null;
  }
  if (previewMarker) {
    previewMarker.remove();
    previewMarker = null;
  }
  if (gameAreaLayer) {
    gameAreaLayer.remove();
    gameAreaLayer = null;
  }
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

  /* Pending-confirmation airstrike preview (orange, dashed) */
  :global(.airstrike-preview-zone) {
    animation: preview-pulse 1.2s ease-in-out infinite alternate;
  }
  @keyframes preview-pulse {
    from { stroke-opacity: 0.9; fill-opacity: 0.10; }
    to   { stroke-opacity: 0.5; fill-opacity: 0.25; }
  }
  :global(.airstrike-preview-target) {
    font-size: 22px;
    line-height: 1;
    text-align: center;
    filter: drop-shadow(0 0 6px rgba(255,152,0,0.9));
    animation: enemy-pulse 0.7s ease-in-out infinite alternate;
  }

  /* CTF flag marker */
  :global(.ctf-flag) {
    font-size: 20px;
    line-height: 1;
    text-align: center;
    filter: drop-shadow(0 1px 3px rgba(0,0,0,0.8));
    animation: enemy-pulse 1s ease-in-out infinite alternate;
  }

  /* Domination control zone circles */
  :global(.dom-zone-circle) {
    animation: area-pulse 2s ease-in-out infinite alternate;
  }
  :global(.dom-zone-marker) {
    width: 44px; height: 44px;
    border-radius: 50%;
    border: 2px solid;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    position: relative;
  }
  :global(.dom-zone-letter) {
    font-size: 15px;
    font-weight: 900;
    line-height: 1;
    text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  }
  :global(.dom-zone-prog-bar) {
    width: 26px; height: 3px;
    background: rgba(255,255,255,0.15);
    border-radius: 2px;
    overflow: hidden;
  }
  :global(.dom-zone-prog-fill) {
    height: 100%;
    border-radius: 2px;
  }
  :global(.dom-zone-contested-icon) {
    position: absolute;
    top: -4px; right: -4px;
    font-size: 12px;
    filter: drop-shadow(0 0 3px rgba(255,200,0,0.9));
    animation: enemy-pulse 0.4s ease-in-out infinite alternate;
  }

  /* Play area boundary — dashed orange outline */
  :global(.game-area-boundary) {
    animation: area-pulse 3s ease-in-out infinite alternate;
  }
  @keyframes area-pulse {
    from { stroke-opacity: 0.9; }
    to   { stroke-opacity: 0.4; }
  }

  /* Tombstone marker at a player's last death spot */
  :global(.grave) {
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }
  :global(.grave-icon) {
    font-size: 20px;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
  }
  :global(.grave-name) {
    font-size: 11px;
    font-weight: 700;
    color: #e0e0e0;
    background: rgba(0,0,0,0.65);
    border-radius: 4px;
    padding: 1px 5px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.9);
  }
</style>
