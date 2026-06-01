import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/index.js';
import { useGameStore, PlayerInfo } from '../stores/game.js';
import {
  sendReady,
  sendGameConfig,
  sendStartGame,
  sendLeaveRoom,
} from '../lib/network.js';
import { GAME_MODES } from 'shared/messages.js';

type Props = NativeStackScreenProps<RootStackParamList, 'Lobby'>;

export default function LobbyScreen(_props: Props) {
  const {
    players, myId, isHost, hostId, roomName, gameConfig,
  } = useGameStore();

  const me = players.find(p => p.id === myId);
  const allReady = players.length > 0 && players.every(p => p.ready);

  function handleReadyToggle() {
    sendReady(!me?.ready);
  }

  function handleModeChange(mode: string) {
    sendGameConfig({ mode });
  }

  function handleStartGame() {
    if (!allReady) {
      Alert.alert('Not everyone is ready');
      return;
    }
    sendStartGame();
  }

  function renderPlayer({ item }: { item: PlayerInfo }) {
    const isMe = item.id === myId;
    const isRoomHost = item.id === hostId;
    return (
      <View style={[styles.playerRow, isMe && styles.playerRowMe]}>
        <View style={styles.playerInfo}>
          <Text style={styles.playerName}>
            {item.username}
            {isRoomHost ? ' ★' : ''}
            {isMe ? ' (you)' : ''}
          </Text>
          {gameConfig.mode !== GAME_MODES.FFA && (
            <Text
              style={[
                styles.playerTeam,
                item.team === 'red' ? styles.teamRed : styles.teamBlue,
              ]}>
              {item.team}
            </Text>
          )}
        </View>
        <Text style={[styles.readyBadge, item.ready && styles.readyBadgeOn]}>
          {item.ready ? 'READY' : 'WAITING'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.leaveBtn} onPress={sendLeaveRoom}>
        <Text style={styles.leaveBtnText}>‹ Leave</Text>
      </TouchableOpacity>

      <Text style={styles.roomName}>{roomName}</Text>

      <FlatList
        data={players}
        keyExtractor={p => String(p.id)}
        renderItem={renderPlayer}
        style={styles.playerList}
      />

      {isHost && (
        <View style={styles.configSection}>
          <Text style={styles.sectionTitle}>Game Mode</Text>
          <View style={styles.modeRow}>
            {Object.values(GAME_MODES).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.modePill,
                  gameConfig.mode === mode && styles.modePillActive,
                ]}
                onPress={() => handleModeChange(mode)}>
                <Text
                  style={[
                    styles.modePillText,
                    gameConfig.mode === mode && styles.modePillTextActive,
                  ]}>
                  {mode.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {gameConfig.mode === GAME_MODES.TEAM_DEATHMATCH && (
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Friendly Fire</Text>
              <Switch
                value={gameConfig.friendlyFire ?? false}
                onValueChange={v => sendGameConfig({ friendlyFire: v })}
                trackColor={{ true: '#e63946' }}
              />
            </View>
          )}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, me?.ready ? styles.btnUnready : styles.btnReady]}
          onPress={handleReadyToggle}>
          <Text style={styles.btnText}>
            {me?.ready ? 'Not Ready' : 'Ready'}
          </Text>
        </TouchableOpacity>

        {isHost && (
          <TouchableOpacity
            style={[styles.btn, styles.btnStart, !allReady && styles.btnDisabled]}
            onPress={handleStartGame}>
            <Text style={styles.btnText}>Start Game</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    padding: 20,
  },
  leaveBtn: {
    marginTop: 48,
    marginBottom: 8,
  },
  leaveBtnText: {
    color: '#888',
    fontSize: 16,
  },
  roomName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  playerList: {
    flex: 1,
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  playerRowMe: {
    borderColor: '#555',
  },
  playerInfo: { gap: 2 },
  playerName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  playerTeam: { fontSize: 12, textTransform: 'uppercase', fontWeight: '600' },
  teamRed: { color: '#e63946' },
  teamBlue: { color: '#457b9d' },
  readyBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#555',
    letterSpacing: 1,
  },
  readyBadgeOn: { color: '#5cb85c' },
  configSection: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  sectionTitle: {
    color: '#aaa',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  modePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#444',
  },
  modePillActive: {
    backgroundColor: '#e63946',
    borderColor: '#e63946',
  },
  modePillText: { color: '#888', fontSize: 12, fontWeight: '600' },
  modePillTextActive: { color: '#fff' },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  toggleLabel: { color: '#ccc', fontSize: 14 },
  actions: {
    gap: 10,
    marginTop: 8,
  },
  btn: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  btnReady: { backgroundColor: '#5cb85c' },
  btnUnready: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#444' },
  btnStart: { backgroundColor: '#e63946' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
