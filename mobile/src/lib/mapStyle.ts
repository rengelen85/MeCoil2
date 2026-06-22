import type { StyleSpecification } from '@maplibre/maplibre-react-native';

// Key-free OpenStreetMap raster basemap — the same tile source the web client
// uses via Leaflet. No Google Maps SDK and no API key/billing required.
//
// Note: the public OSM tile servers are fine for development and light use; for
// a production launch, point `tiles` at your own tile cache or a provider that
// permits app usage (per the OSM tile usage policy).
export const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
} as unknown as StyleSpecification;
