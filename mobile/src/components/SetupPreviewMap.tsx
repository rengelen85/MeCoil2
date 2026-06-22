import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Map as MapView, Camera, Marker } from '@maplibre/maplibre-react-native';
import { LatLng as Coord } from '../stores/game.js';
import { OSM_STYLE } from '../lib/mapStyle.js';
import { MeterCircle, ShapePolygon, ShapeLine } from './MapShapes.js';
import { boundsOf } from '../lib/geo.js';

export interface PreviewMarker {
  key: string;
  lat: number;
  lng: number;
  color: string;
  label?: string;
}

export interface PreviewCircle {
  lat: number;
  lng: number;
  radiusM: number;
}

const AREA_COLOR = '#ff9800';

/**
 * Compact, non-interactive map used in the lobby to preview where the host has
 * placed CTF bases, Domination zones or a game-area boundary. Mirrors the web
 * client's Leaflet previews: a cyan "you" dot plus the placed markers/shapes.
 * Key-free — renders OpenStreetMap raster tiles via MapLibre.
 */
export default function SetupPreviewMap({
  me,
  markers = [],
  circle = null,
  polygon = null,
  polyline = null,
  polylineColor = AREA_COLOR,
}: {
  me: Coord | null;
  markers?: PreviewMarker[];
  circle?: PreviewCircle | null;
  polygon?: Coord[] | null;
  polyline?: Coord[] | null;
  polylineColor?: string;
}) {
  // Every point the camera should keep in view.
  const pts: Coord[] = [];
  if (me) pts.push(me);
  for (const m of markers) pts.push({ lat: m.lat, lng: m.lng });
  if (polygon) pts.push(...polygon);
  if (polyline) pts.push(...polyline);
  if (circle) {
    const dLat = (circle.radiusM / 6378137) * (180 / Math.PI);
    const dLng = dLat / Math.cos((circle.lat * Math.PI) / 180);
    pts.push({ lat: circle.lat + dLat, lng: circle.lng });
    pts.push({ lat: circle.lat - dLat, lng: circle.lng });
    pts.push({ lat: circle.lat, lng: circle.lng + dLng });
    pts.push({ lat: circle.lat, lng: circle.lng - dLng });
  }

  if (pts.length === 0) {
    return (
      <View style={[styles.wrap, styles.placeholder]}>
        <Text style={styles.placeholderText}>Acquiring GPS…</Text>
      </View>
    );
  }

  const bounds = boundsOf(pts)!;
  const spanLng = bounds[2] - bounds[0];
  const spanLat = bounds[3] - bounds[1];
  // A single point (or a near-degenerate box) can't be framed by bounds without
  // zooming to the max; fall back to a centred view instead.
  const useCenter = pts.length === 1 || (spanLng < 1e-4 && spanLat < 1e-4);
  const center: [number, number] = [
    (bounds[0] + bounds[2]) / 2,
    (bounds[1] + bounds[3]) / 2,
  ];

  return (
    <View style={styles.wrap}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={OSM_STYLE}
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        doubleTapHoldZoom={false}
        touchRotate={false}
        touchPitch={false}
        attribution={false}
        logo={false}
        compass={false}
        scaleBar={false}>
        {useCenter ? (
          <Camera center={center} zoom={16} duration={300} />
        ) : (
          <Camera
            bounds={bounds}
            padding={{ top: 40, bottom: 40, left: 40, right: 40 }}
            duration={300}
          />
        )}

        {me && (
          <Marker id="preview-me" lngLat={[me.lng, me.lat]} anchor="center">
            <View style={styles.youDot} />
          </Marker>
        )}

        {markers.map(m => (
          <Marker key={m.key} id={`preview-${m.key}`} lngLat={[m.lng, m.lat]} anchor="center">
            <View style={[styles.placedDot, { backgroundColor: m.color, borderColor: m.color }]} />
          </Marker>
        ))}

        {circle && (
          <MeterCircle
            id="preview-circle"
            lat={circle.lat}
            lng={circle.lng}
            radiusM={circle.radiusM}
            color={AREA_COLOR}
            fillOpacity={0.12}
          />
        )}

        {polygon && polygon.length >= 3 && (
          <ShapePolygon id="preview-polygon" points={polygon} color={AREA_COLOR} fillOpacity={0.12} />
        )}

        {polyline && polyline.length >= 2 && (
          <ShapeLine id="preview-polyline" points={polyline} color={polylineColor} />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 180,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,152,0,0.35)',
    marginBottom: 8,
  },
  placeholder: {
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { color: '#666', fontSize: 13 },
  youDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#00e5ff',
    borderWidth: 2,
    borderColor: '#003c44',
  },
  placedDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
});
