import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Marker, Circle, LatLng, PROVIDER_DEFAULT, MapPressEvent } from 'react-native-maps';
import { useMapStore } from '../stores/map.js';
import { useGameStore } from '../stores/game.js';
import { AIRSTRIKE_RADIUS_M } from 'shared/messages.js';

const POWERUP_EMOJI: Record<string, string> = {
  fullReload: '🔋',
  healthPack: '🩹',
  shield: '🛡️',
  stealth: '👻',
  radar: '📡',
  airstrike: '🚀',
};

export default function GameMap() {
  const { myPosition, teammates, firingEnemies, powerups, airstrikes, graves, heading } = useMapStore();
  const { airstrikeArmed, airstrikePreview, setAirstrikeArmed, setAirstrikePreview } = useGameStore();

  // Tapping while armed (or while a preview is already placed) positions / moves
  // the pending preview circle. The actual strike deploys only on Confirm.
  function onMapPress(e: MapPressEvent) {
    if (!airstrikeArmed && !airstrikePreview) return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setAirstrikePreview({ lat: latitude, lng: longitude });
    if (airstrikeArmed) setAirstrikeArmed(false);
  }

  if (!myPosition) {
    return (
      <View style={styles.noGps}>
        <Text style={styles.noGpsText}>Acquiring GPS…</Text>
      </View>
    );
  }

  const center: LatLng = { latitude: myPosition.lat, longitude: myPosition.lng };

  return (
    <MapView
      style={styles.map}
      provider={PROVIDER_DEFAULT}
      initialRegion={{
        ...center,
        latitudeDelta: 0.002,
        longitudeDelta: 0.002,
      }}
      region={{
        ...center,
        latitudeDelta: 0.002,
        longitudeDelta: 0.002,
      }}
      // Rotate map to heading-up orientation (north always toward top of screen
      // would be 0; heading-up means bearing = heading degrees)
      camera={{ center, heading: heading ?? 0, pitch: 0, zoom: 18 }}
      onPress={onMapPress}
      showsUserLocation={false}
      showsCompass={false}
      showsScale={false}
      rotateEnabled={false}
      scrollEnabled={false}
      zoomEnabled={false}>

      {/* My position */}
      <Marker coordinate={center} anchor={{ x: 0.5, y: 0.5 }}>
        <View style={styles.myDot} />
      </Marker>

      {/* Teammates (green) */}
      {teammates.map(t => (
        <Marker
          key={`tm-${t.id}`}
          coordinate={{ latitude: t.lat, longitude: t.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          title={t.username}>
          <View style={styles.teammateDot} />
        </Marker>
      ))}

      {/* Firing enemies (red, only briefly visible after they fire) */}
      {firingEnemies.map(e => (
        <Marker
          key={`fe-${e.id}`}
          coordinate={{ latitude: e.lat, longitude: e.lng }}
          anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.enemyDot} />
        </Marker>
      ))}

      {/* Power-ups */}
      {powerups.map(p => (
        <Marker
          key={`pu-${p.id}`}
          coordinate={{ latitude: p.lat, longitude: p.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          title={p.type}>
          <View style={styles.powerupDot}>
            <Text style={styles.powerupEmoji}>{POWERUP_EMOJI[p.type] ?? '📦'}</Text>
          </View>
        </Marker>
      ))}

      {/* Tombstones at each player's last death spot, name beside the marker */}
      {graves.map(g => (
        <Marker
          key={`gr-${g.id}`}
          coordinate={{ latitude: g.lat, longitude: g.lng }}
          anchor={{ x: 0.5, y: 1 }}>
          <View style={styles.grave}>
            <Text style={styles.graveIcon}>🪦</Text>
            <Text style={styles.graveName}>{g.username}</Text>
          </View>
        </Marker>
      ))}

      {/* Pending-confirmation airstrike preview (orange, before Confirm is pressed) */}
      {airstrikePreview && (
        <React.Fragment>
          <Circle
            center={{ latitude: airstrikePreview.lat, longitude: airstrikePreview.lng }}
            radius={AIRSTRIKE_RADIUS_M}
            strokeColor="#ff9800"
            strokeWidth={2}
            lineDashPattern={[8, 5]}
            fillColor="rgba(255,152,0,0.18)"
          />
          <Marker
            coordinate={{ latitude: airstrikePreview.lat, longitude: airstrikePreview.lng }}
            anchor={{ x: 0.5, y: 0.5 }}>
            <Text style={styles.airstrikePreviewTarget}>🎯</Text>
          </Marker>
        </React.Fragment>
      )}

      {/* Inbound airstrikes: blast zone + target marker */}
      {airstrikes.map(a => (
        <React.Fragment key={`as-${a.id}`}>
          <Circle
            center={{ latitude: a.lat, longitude: a.lng }}
            radius={a.radius}
            strokeColor="#ff1744"
            strokeWidth={2}
            fillColor="rgba(255,23,68,0.2)"
          />
          <Marker
            coordinate={{ latitude: a.lat, longitude: a.lng }}
            anchor={{ x: 0.5, y: 0.5 }}>
            <Text style={styles.airstrikeTarget}>💥</Text>
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
  airstrikePreviewTarget: {
    fontSize: 24,
  },
  airstrikeTarget: {
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
});
