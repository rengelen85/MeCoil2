<script>
  import { onMount, onDestroy } from 'svelte';
  import { myPosition, teammates, firingEnemies, powerups } from '../stores/map.js';
  import { sendCollect } from '../lib/network.js';

  let mapEl;
  let map;
  let myMarker;
  const teamMarkers = new Map();
  const enemyMarkers = new Map();
  const powerupMarkers = new Map();

  onMount(async () => {
    const L = (await import('leaflet')).default;
    await import('leaflet/dist/leaflet.css');

    map = L.map(mapEl, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    const myIcon = L.divIcon({ className: '', html: '<div class="dot dot-me"></div>', iconSize: [16, 16] });
    const teamIcon = L.divIcon({ className: '', html: '<div class="dot dot-team"></div>', iconSize: [14, 14] });
    const enemyIcon = L.divIcon({ className: '', html: '<div class="dot dot-enemy"></div>', iconSize: [14, 14] });

    function powerupIcon(type) {
      const emoji = { fullReload: '🔋', shield: '🛡️', stealth: '👻' }[type] ?? '📦';
      return L.divIcon({ className: '', html: `<div class="dot dot-powerup" title="${type}">${emoji}</div>`, iconSize: [20, 20] });
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

    return () => {
      unsubPos(); unsubTeam(); unsubEnemies(); unsubPowerups();
    };
  });

  onDestroy(() => map?.remove());
</script>

<div bind:this={mapEl} class="map-container"></div>

<style>
  .map-container {
    width: 100%;
    height: 100%;
  }

  :global(.dot) {
    border-radius: 50%;
    border: 2px solid rgba(0,0,0,0.5);
    box-shadow: 0 0 6px rgba(0,0,0,0.6);
  }
  :global(.dot-me) {
    width: 16px; height: 16px;
    background: #fff;
    border: 2px solid #00e5ff;
    box-shadow: 0 0 8px #00e5ff;
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
    animation: pulse 0.6s ease-in-out infinite alternate;
  }
  :global(.dot-powerup) {
    background: rgba(0,0,0,0.7);
    border-radius: 50%;
    font-size: 14px;
    line-height: 20px;
    text-align: center;
    cursor: pointer;
  }
  @keyframes pulse {
    from { transform: scale(1); }
    to { transform: scale(1.4); }
  }
</style>
