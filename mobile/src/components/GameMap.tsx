import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Marker, LatLng, PROVIDER_DEFAULT } from 'react-native-maps';
import { useMapStore } from '../stores/map.js';
import { useGameStore } from '../stores/game.js';

export default function GameMap() {
  const { myPosition, teammates, firingEnemies, powerups, heading } = useMapStore();
  const { gameConfig } = useGameStore();

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

      {/* Power-ups (blue) */}
      {powerups.map(p => (
        <Marker
          key={`pu-${p.id}`}
          coordinate={{ latitude: p.lat, longitude: p.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          title={p.type}>
          <View style={styles.powerupDot} />
        </Marker>
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
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#457b9d',
    borderWidth: 2,
    borderColor: '#000',
  },
});
