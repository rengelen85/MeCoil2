import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import {
  Map as MapView,
  Camera,
  Marker,
  type PressEvent,
} from '@maplibre/maplibre-react-native';
import { NativeSyntheticEvent } from 'react-native';
import { useMapStore } from '../stores/map.js';
import { useGameStore } from '../stores/game.js';
import { AIRSTRIKE_RADIUS_M, APACHE_RADIUS_M } from 'shared/messages.js';
import { OSM_STYLE } from '../lib/mapStyle.js';
import { MeterCircle } from './MapShapes.js';

const POWERUP_EMOJI: Record<string, string> = {
  fullReload: '🔋',
  healthPack: '🩹',
  shield: '🛡️',
  stealth: '👻',
  radar: '📡',
  airstrike: '🚀',
  apacheSupport: '🚁',
};

export default function GameMap() {
  const { myPosition, teammates, firingEnemies, powerups, airstrikes, apaches, graves, heading } = useMapStore();
  const {
    airstrikeArmed, airstrikePreview, setAirstrikeArmed, setAirstrikePreview,
    apacheArmed, apachePreview, setApacheArmed, setApachePreview,
  } = useGameStore();

  function onMapPress(e: NativeSyntheticEvent<PressEvent>) {
    const [longitude, latitude] = e.nativeEvent.lngLat;
    if (apacheArmed || apachePreview) {
      setApachePreview({ lat: latitude, lng: longitude });
      if (apacheArmed) setApacheArmed(false);
    } else if (airstrikeArmed || airstrikePreview) {
      setAirstrikePreview({ lat: latitude, lng: longitude });
      if (airstrikeArmed) setAirstrikeArmed(false);
    }
  }

  if (!myPosition) {
    return (
      <View style={styles.noGps}>
        <Text style={styles.noGpsText}>Acquiring GPS…</Text>
      </View>
    );
  }

  return (
    <MapView
      style={styles.map}
      mapStyle={OSM_STYLE}
      onPress={onMapPress}
      // Heading-up, fixed-zoom tactical view: the player drives the camera via
      // GPS + compass, not gestures.
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
      <Camera
        center={[myPosition.lng, myPosition.lat]}
        zoom={17}
        bearing={heading ?? 0}
        pitch={0}
        duration={250}
      />

      {/* My position */}
      <Marker id="me" lngLat={[myPosition.lng, myPosition.lat]} anchor="center">
        <View style={styles.myDot} />
      </Marker>

      {/* Teammates (green) */}
      {teammates.map(t => (
        <Marker key={`tm-${t.id}`} id={`tm-${t.id}`} lngLat={[t.lng, t.lat]} anchor="center">
          <View style={styles.teammateDot} />
        </Marker>
      ))}

      {/* Firing enemies (red, only briefly visible after they fire) */}
      {firingEnemies.map(e => (
        <Marker key={`fe-${e.id}`} id={`fe-${e.id}`} lngLat={[e.lng, e.lat]} anchor="center">
          <View style={styles.enemyDot} />
        </Marker>
      ))}

      {/* Power-ups */}
      {powerups.map(p => (
        <Marker key={`pu-${p.id}`} id={`pu-${p.id}`} lngLat={[p.lng, p.lat]} anchor="center">
          <View style={styles.powerupDot}>
            <Text style={styles.powerupEmoji}>{POWERUP_EMOJI[p.type] ?? '📦'}</Text>
          </View>
        </Marker>
      ))}

      {/* Tombstones at each player's last death spot, name beside the marker */}
      {graves.map(g => (
        <Marker key={`gr-${g.id}`} id={`gr-${g.id}`} lngLat={[g.lng, g.lat]} anchor="bottom">
          <View style={styles.grave}>
            <Text style={styles.graveIcon}>🪦</Text>
            <Text style={styles.graveName}>{g.username}</Text>
          </View>
        </Marker>
      ))}

      {/* Pending-confirmation airstrike preview (orange, before Confirm is pressed) */}
      {airstrikePreview && (
        <React.Fragment>
          <MeterCircle
            id="airstrike-preview"
            lat={airstrikePreview.lat}
            lng={airstrikePreview.lng}
            radiusM={AIRSTRIKE_RADIUS_M}
            color="#ff9800"
            fillOpacity={0.18}
            dashed
          />
          <Marker id="airstrike-preview-target" lngLat={[airstrikePreview.lng, airstrikePreview.lat]} anchor="center">
            <Text style={styles.bigEmoji}>🎯</Text>
          </Marker>
        </React.Fragment>
      )}

      {/* Inbound airstrikes: blast zone + target marker */}
      {airstrikes.map(a => (
        <React.Fragment key={`as-${a.id}`}>
          <MeterCircle id={`as-${a.id}`} lat={a.lat} lng={a.lng} radiusM={a.radius} color="#ff1744" fillOpacity={0.2} />
          <Marker id={`as-${a.id}-t`} lngLat={[a.lng, a.lat]} anchor="center">
            <Text style={styles.bigEmoji}>💥</Text>
          </Marker>
        </React.Fragment>
      ))}

      {/* Pending-confirmation apache preview (dashed green, before Confirm is pressed) */}
      {apachePreview && (
        <React.Fragment>
          <MeterCircle
            id="apache-preview"
            lat={apachePreview.lat}
            lng={apachePreview.lng}
            radiusM={APACHE_RADIUS_M}
            color="#69f0ae"
            fillOpacity={0.12}
            dashed
          />
          <Marker id="apache-preview-marker" lngLat={[apachePreview.lng, apachePreview.lat]} anchor="center">
            <Text style={styles.apachePreviewMarker}>🚁</Text>
          </Marker>
        </React.Fragment>
      )}

      {/* Active apache support zones (solid green) */}
      {apaches.map(a => (
        <React.Fragment key={`ap-${a.id}`}>
          <MeterCircle id={`ap-${a.id}`} lat={a.lat} lng={a.lng} radiusM={a.radius} color="#00c853" fillOpacity={0.18} />
          <Marker id={`ap-${a.id}-m`} lngLat={[a.lng, a.lat]} anchor="center">
            <Text style={styles.bigEmoji}>🚁</Text>
          </Marker>
        </React.Fragment>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    ...StyleSheet.absoluteFill,
  },
  noGps: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noGpsText: {
    color: '#666',
    fontSize: 16,
  },
  myDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#000',
  },
  teammateDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#5cb85c',
    borderWidth: 2,
    borderColor: '#000',
  },
  enemyDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#e63946',
    borderWidth: 2,
    borderColor: '#000',
  },
  powerupDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 2,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerupEmoji: {
    fontSize: 14,
  },
  bigEmoji: {
    fontSize: 24,
  },
  grave: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  graveIcon: {
    fontSize: 20,
  },
  graveName: {
    marginLeft: 3,
    fontSize: 11,
    fontWeight: '700',
    color: '#e0e0e0',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  apachePreviewMarker: {
    fontSize: 22,
    opacity: 0.7,
  },
});
