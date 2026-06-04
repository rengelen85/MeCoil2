import React, { useEffect, useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/index.js';
import { useGameStore, ScoreEntry } from '../stores/game.js';
import { useMapStore } from '../stores/map.js';
import { sendPosition, sendStopGame } from '../lib/network.js';
import { applyGunAssignment, connectBle, setGunMode } from '../lib/ble.js';
import GameMap from '../components/GameMap.js';

type Props = NativeStackScreenProps<RootStackParamList, 'InGame'>;

// Resolve the local player's score entry across FFA (flat) and TDM (nested) shapes.
function findMyScore(scores: ScoreEntry[], myId: number | null): ScoreEntry | null {
  for (const entry of scores) {
    if (entry.players) {
      const found = entry.players.find(p => p.id === myId);
      if (found) return found;
    } else if (entry.id === myId) {
      return entry;
    }
  }
  return null;
}

export default function InGameScreen(_props: Props) {
  const {
    ammo, maxAmmo, isReloading, shieldActive, stealthActive,
    timeRemaining, scores, myId, isHost, bleConnected, gunSlotId,
    killFeed, hp, maxHp, isAlive, respawnCountdown,
  } = useGameStore();

  const myScore = findMyScore(scores, myId);
  const hpPct = maxHp > 0 ? Math.min(100, Math.round((hp / maxHp) * 100)) : 0;
  const hpColor = hpPct > 50 ? '#00e676' : hpPct > 25 ? '#ffeb3b' : '#ff5252';

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

  const [gunMode, setGunModeState] = useState<'auto' | 'semi'>('auto');

  function toggleGunMode() {
    const next = gunMode === 'auto' ? 'semi' : 'auto';
    setGunModeState(next);
    setGunMode(next).catch(e => Alert.alert('BLE Error', e.message));
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

      {/* Personal stats + health (always visible) */}
      <View style={styles.statsBar}>
        <View style={styles.statsRow}>
          <Text style={styles.stat}>💀 {myScore?.kills ?? 0}</Text>
          <Text style={styles.stat}>🎯 {myScore?.hits ?? 0}</Text>
          <Text style={styles.stat}>🩸 {myScore?.timesHit ?? 0}</Text>
        </View>
        <View style={styles.healthLabelRow}>
          <Text style={styles.healthLabel}>
            ♥ {hp}
            <Text style={styles.healthMax}> / {maxHp}</Text>
          </Text>
          {hp > maxHp && <Text style={styles.healthShield}>🛡</Text>}
        </View>
        <View style={styles.healthTrack}>
          <View
            style={[styles.healthFill, { width: `${hpPct}%`, backgroundColor: hpColor }]}
          />
        </View>
      </View>

      {/* Respawn overlay */}
      {!isAlive && (
        <View style={styles.respawnOverlay} pointerEvents="none">
          <Text style={styles.respawnTitle}>YOU ARE DOWN</Text>
          <Text style={styles.respawnCount}>
            Respawning in {respawnCountdown ?? 0}…
          </Text>
        </View>
      )}

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
          {bleConnected ? (
            <TouchableOpacity onPress={toggleGunMode}>
              <Text style={[styles.gunMode, gunMode === 'semi' && styles.gunModeSemi]}>
                {gunMode === 'auto' ? 'AUTO' : 'SEMI'}
              </Text>
            </TouchableOpacity>
          ) : (
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
  statsBar: {
    position: 'absolute',
    top: 88,
    left: 16,
    width: 180,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  stat: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
  },
  healthLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  healthLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  healthMax: { color: '#aaa', fontSize: 12, fontWeight: '400' },
  healthShield: { fontSize: 14, marginLeft: 6 },
  healthTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  healthFill: {
    height: '100%',
    borderRadius: 4,
  },
  respawnOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  respawnTitle: {
    color: '#ff5252',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 3,
    marginBottom: 10,
  },
  respawnCount: {
    color: '#fff',
    fontSize: 18,
  },
  killFeed: {
    position: 'absolute',
    top: 170,
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
  gunMode: {
    color: '#00e5ff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    backgroundColor: 'rgba(0,229,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    overflow: 'hidden',
  },
  gunModeSemi: {
    color: '#ffc107',
    backgroundColor: 'rgba(255,193,7,0.15)',
    borderColor: 'rgba(255,193,7,0.5)',
  },
  stopBtn: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stopBtnText: { color: '#e63946', fontWeight: '700' },
});
