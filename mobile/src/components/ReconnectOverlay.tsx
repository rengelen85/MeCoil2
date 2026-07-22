import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useGameStore } from '../stores/game.js';
import { manualReconnect } from '../lib/network.js';

/**
 * Full-screen overlay shown when the WebSocket connection to the game server
 * drops. While auto-reconnect is retrying it shows a spinner; once auto-reconnect
 * gives up it offers a manual "Rejoin" button. The server holds the player's
 * session (team, health, held power-ups, buffs, stats) for the whole round, so a
 * rejoin restores everything rather than joining as a fresh player.
 *
 * Rendered on the in-game, lobby and room-select screens with pointerEvents
 * "box-none" so it never blocks the UI when idle.
 */
export default function ReconnectOverlay() {
  const isReconnecting = useGameStore(s => s.isReconnecting);
  const reconnectFailed = useGameStore(s => s.reconnectFailed);

  if (!isReconnecting && !reconnectFailed) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.banner}>
        {isReconnecting ? (
          <>
            <ActivityIndicator size="large" color="#00e5ff" />
            <Text style={styles.title}>RECONNECTING…</Text>
            <Text style={styles.sub}>Restoring your game — hang tight.</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>CONNECTION LOST</Text>
            <Text style={styles.sub}>
              Rejoin to get back in with your stats and power-ups.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={manualReconnect}>
              <Text style={styles.btnText}>🔄 REJOIN GAME</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 90,
  },
  banner: {
    backgroundColor: 'rgba(10,20,30,0.96)',
    borderWidth: 2,
    borderColor: '#00e5ff',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 22,
    alignItems: 'center',
    maxWidth: '85%',
  },
  title: {
    color: '#00e5ff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 10,
  },
  sub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
    textAlign: 'center',
  },
  btn: {
    backgroundColor: '#00e5ff',
    borderRadius: 8,
    paddingHorizontal: 26,
    paddingVertical: 11,
  },
  btnText: {
    color: '#00232b',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
