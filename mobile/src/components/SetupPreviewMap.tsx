import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, {
  Marker,
  Circle,
  Polygon,
  Polyline,
  LatLng,
  PROVIDER_DEFAULT,
} from 'react-native-maps';
import { LatLng as Coord } from '../stores/game.js';

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

function toLatLng(c: Coord): LatLng {
  return { latitude: c.lat, longitude: c.lng };
}

/**
 * Compact, non-interactive map used in the lobby to preview where the host has
 * placed CTF bases, Domination zones or a game-area boundary. Mirrors the web
 * client's Leaflet previews: a cyan "you" dot plus the placed markers/shapes.
 * Purely presentational — the caller owns the GPS watch and passes `me`.
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
  const mapRef = useRef<MapView>(null);

  // Every coordinate the camera should keep in view.
  const coords: LatLng[] = [];
  if (me) coords.push(toLatLng(me));
  for (const m of markers) coords.push({ latitude: m.lat, longitude: m.lng });
  if (polygon) for (const p of polygon) coords.push(toLatLng(p));
  if (polyline) for (const p of polyline) coords.push(toLatLng(p));
  if (circle) {
    // Approximate the circle's bounding box so fitToCoordinates frames it.
    const dLat = circle.radiusM / 111320;
    const dLng =
      circle.radiusM / (111320 * Math.cos((circle.lat * Math.PI) / 180) || 1);
    coords.push({ latitude: circle.lat + dLat, longitude: circle.lng });
    coords.push({ latitude: circle.lat - dLat, longitude: circle.lng });
    coords.push({ latitude: circle.lat, longitude: circle.lng + dLng });
    coords.push({ latitude: circle.lat, longitude: circle.lng - dLng });
  }

  const coordsRef = useRef<LatLng[]>(coords);
  coordsRef.current = coords;

  const fit = useCallback(() => {
    const map = mapRef.current;
    const c = coordsRef.current;
    if (!map || c.length === 0) return;
    if (c.length === 1) {
      map.animateToRegion(
        {
          latitude: c[0].latitude,
          longitude: c[0].longitude,
          latitudeDelta: 0.003,
          longitudeDelta: 0.003,
        },
        250,
      );
    } else {
      map.fitToCoordinates(c, {
        edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
        animated: true,
      });
    }
  }, []);

  // Re-frame whenever the set of points changes (e.g. a base/zone is placed).
  const fitKey = JSON.stringify(coords);
  useEffect(() => {
    fit();
  }, [fitKey, fit]);

  if (coords.length === 0) {
    return (
      <View style={[styles.wrap, styles.placeholder]}>
        <Text style={styles.placeholderText}>Acquiring GPS…</Text>
      </View>
    );
  }

  const initialRegion = {
    latitude: coords[0].latitude,
    longitude: coords[0].longitude,
    latitudeDelta: 0.003,
    longitudeDelta: 0.003,
  };

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        onMapReady={fit}
        showsUserLocation={false}
        showsCompass={false}
        toolbarEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}>
        {me && (
          <Marker coordinate={toLatLng(me)} anchor={{ x: 0.5, y: 0.5 }} title="You">
            <View style={styles.youDot} />
          </Marker>
        )}

        {markers.map(m => (
          <Marker
            key={m.key}
            coordinate={{ latitude: m.lat, longitude: m.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            title={m.label}>
            <View style={[styles.placedDot, { backgroundColor: m.color, borderColor: m.color }]} />
          </Marker>
        ))}

        {circle && (
          <Circle
            center={{ latitude: circle.lat, longitude: circle.lng }}
            radius={circle.radiusM}
            strokeColor={AREA_COLOR}
            strokeWidth={2}
            fillColor="rgba(255,152,0,0.12)"
          />
        )}

        {polygon && polygon.length >= 3 && (
          <Polygon
            coordinates={polygon.map(toLatLng)}
            strokeColor={AREA_COLOR}
            strokeWidth={2}
            fillColor="rgba(255,152,0,0.12)"
          />
        )}

        {polyline && polyline.length >= 2 && (
          <Polyline
            coordinates={polyline.map(toLatLng)}
            strokeColor={polylineColor}
            strokeWidth={2}
          />
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
