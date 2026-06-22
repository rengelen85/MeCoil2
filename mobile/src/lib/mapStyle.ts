import type { StyleSpecification } from '@maplibre/maplibre-react-native';

// Key-free raster basemaps — the same tile sources the web client cycles
// through (client/src/components/Map.svelte). No Google Maps SDK and no API
// key/billing required.
//
// Note: the public OSM/CARTO tile servers are fine for development and light
// use; for a production launch, point `tiles` at your own tile cache or a
// provider that permits app usage (per the OSM/CARTO tile usage policies).

function rasterStyle(tiles: string[], attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles,
        tileSize: 256,
        maxzoom: 19,
        attribution,
      },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  } as unknown as StyleSpecification;
}

// CARTO serves identical tiles from the a–d subdomains; MapLibre rotates
// through the listed URLs the same way Leaflet uses `{s}`.
const carto = (path: string): string[] =>
  ['a', 'b', 'c', 'd'].map(
    s => `https://${s}.basemaps.cartocdn.com/${path}/{z}/{x}/{y}.png`,
  );

const CARTO_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

export type MapStyleId = 'dark' | 'voyager' | 'light' | 'osm';

// Cycle order, icon, and label mirror the web client so the toggle feels the
// same on both platforms.
export const MAP_STYLE_CYCLE: MapStyleId[] = ['dark', 'voyager', 'light', 'osm'];
export const MAP_STYLE_ICON: Record<MapStyleId, string> = {
  dark: '🌑',
  voyager: '🌤️',
  light: '☀️',
  osm: '🗺️',
};
export const MAP_STYLE_LABEL: Record<MapStyleId, string> = {
  dark: 'Dark',
  voyager: 'Voyager',
  light: 'Light',
  osm: 'Standard',
};

export const MAP_STYLES: Record<MapStyleId, StyleSpecification> = {
  dark: rasterStyle(carto('dark_all'), CARTO_ATTRIBUTION),
  voyager: rasterStyle(carto('rastertiles/voyager'), CARTO_ATTRIBUTION),
  light: rasterStyle(carto('light_all'), CARTO_ATTRIBUTION),
  osm: rasterStyle(
    ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    '© OpenStreetMap contributors',
  ),
};

// Standard OSM basemap, kept as a stable default for the lobby preview map.
export const OSM_STYLE = MAP_STYLES.osm;
