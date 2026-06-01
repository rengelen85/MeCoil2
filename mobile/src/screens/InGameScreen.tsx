import React, { useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/index.js';
import { useGameStore } from '../stores/game.js';
import { useMapStore } from '../stores/map.js';
import { sendPosition, sendStopGame } from '../lib/network.js';
import { applyGunAssignment, connectBle } from '../lib/ble.js';
import GameMap from '../components/GameMap.js';

type Props = NativeStackScreenProps<RootStackParamList, 'InGame'>;

export default function InGameScreen(_props: Props) {
  const {
    ammo, maxAmmo, isReloading, shieldActive, stealthActive,
    timeRemaining, scores, myId, isHost, bleConnected, gunSlotId,
    killFeed,
  } = useGameStore();

  const { myPosition, startGPS, stopGPS, startHeading, stopHeading } =
    useMapStore();

  const onPosition = useCallback(
    (lat: number, lng: number) => sendPosition(lat, lng),
    [],
  );

  useEffect(() => {
    startGPS(onPosition);
    startHeading();
    return () => {
      stopGPS();
      stopHeading();
    };
  }, []);

  useEffect(() => {
    // Apply gun assignment once BLE is connected and slot is known
    if (bleConnected) {
      applyGunAssignment(gunSlotId).catch(console.error);
    }
  }, [bleConnected, gunSlotId]);

  function handleConnectBle() {
    connectBle().catch(e => Alert.alert('BLE Error', e.message));
  }

  const mins = String(Math.floor(timeRemaining / 60)).padStart(2, '0');
  const secs = String(timeRemaining % 60).padStart(2, '0');
  const topScore = scores[0];

  return (
    <View style={styles.container}>
      <GameMap />

      {/* Top HUD */}
      <View style={styles.topHud}>
        <Text style={styles.timer}>
          {mins}:{secs}
        </Text>
        {topScore && (
          <Text style={styles.topScore}>
            {topScore.username} {topScore.kills}
          </Text>
        )}
      </View>

      {/* Kill feed */}
      <View style={styles.killFeed}>
        {killFeed
          .slice(-3)
          .reverse()
          .map((entry, i) => (
            <Text key={i} style={styles.killFeedEntry}>
              {entry.shooterName} › {entry.victimName}
            </Text>
          ))}
      </View>

      {/* Bottom HUD */}
      <View style={styles.bottomHud}>
        {/* Ammo */}
        <View style={styles.ammoBlock}>
          <Text style={styles.ammoCount}>
            {isReloading ? 'RELOADING' : ammo}
          </Text>
          <Text style={styles.ammoMax}>/ {maxAmmo}</Text>
        </View>

        {/* Status indicators */}
        <View style={styles.statusIcons}>
          {shieldActive && <Text style={styles.statusIcon}>🛡</Text>}
          {stealthActive && <Text style={styles.statusIcon}>👻</Text>}
          {!bleConnected && (
            <TouchableOpacity onPress={handleConnectBle}>
              <Text style={styles.bleWarning}>⚠ Gun</Text>
            </TouchableOpacity>
          )}
        </View>

        {isHost && (
          <TouchableOpacity
            style={styles.stopBtn}
            onPress={sendStopGame}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.stopBtnText}>■ Stop</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topHud: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    pointerEvents: 'none',
  },
  timer: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  topScore: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  killFeed: {
    position: 'absolute',
    top: 100,
    left: 16,
    pointerEvents: 'none',
  },
  killFeedEntry: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  bottomHud: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  ammoBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  ammoCount: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  ammoMax: {
    color: '#aaa',
    fontSize: 18,
    marginLeft: 4,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  statusIcons: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  statusIcon: { fontSize: 24 },
  bleWarning: {
    color: '#f4c430',
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 6,
    borderRadius: 6,
  },
  stopBtn: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stopBtnText: { color: '#e63946', fontWeight: '700' },
});
