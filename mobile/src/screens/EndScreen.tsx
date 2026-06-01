import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/index.js';
import { useGameStore, ScoreEntry } from '../stores/game.js';
import { sendLeaveRoom } from '../lib/network.js';

type Props = NativeStackScreenProps<RootStackParamList, 'End'>;

export default function EndScreen(_props: Props) {
  const { finalScores, winner, myId } = useGameStore();

  const sorted = [...(finalScores ?? [])].sort((a, b) => b.kills - a.kills);

  function renderRow({ item, index }: { item: ScoreEntry; index: number }) {
    const isMe = item.id === myId;
    return (
      <View style={[styles.row, isMe && styles.rowMe]}>
        <Text style={styles.rank}>#{index + 1}</Text>
        <View style={styles.playerInfo}>
          <Text style={styles.playerName}>
            {item.username}{isMe ? ' (you)' : ''}
          </Text>
          {item.team && item.team !== 'none' && (
            <Text
              style={[
                styles.teamBadge,
                item.team === 'red' ? styles.teamRed : styles.teamBlue,
              ]}>
              {item.team}
            </Text>
          )}
        </View>
        <View style={styles.stats}>
          <Text style={styles.kills}>{item.kills}K</Text>
          <Text style={styles.deaths}>{item.deaths}D</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.gameOver}>GAME OVER</Text>

      {winner && (
        <View style={styles.winnerBlock}>
          <Text style={styles.winnerLabel}>Winner</Text>
          <Text style={styles.winnerName}>{winner}</Text>
        </View>
      )}

      <FlatList
        data={sorted}
        keyExtractor={s => String(s.id)}
        renderItem={renderRow}
        style={styles.list}
      />

      <TouchableOpacity style={styles.lobbyBtn} onPress={sendLeaveRoom}>
        <Text style={styles.lobbyBtnText}>Back to Rooms</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    padding: 20,
    paddingTop: 60,
  },
  gameOver: {
    color: '#e63946',
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: 24,
  },
  winnerBlock: {
    alignItems: 'center',
    marginBottom: 24,
  },
  winnerLabel: {
    color: '#888',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  winnerName: {
    color: '#ffd700',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 4,
  },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
    gap: 12,
  },
  rowMe: { borderColor: '#ffd700' },
  rank: {
    color: '#666',
    fontSize: 14,
    fontWeight: '700',
    width: 32,
  },
  playerInfo: { flex: 1, gap: 2 },
  playerName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  teamBadge: { fontSize: 11, textTransform: 'uppercase', fontWeight: '700' },
  teamRed: { color: '#e63946' },
  teamBlue: { color: '#457b9d' },
  stats: { flexDirection: 'row', gap: 12 },
  kills: { color: '#5cb85c', fontWeight: '700', fontSize: 15 },
  deaths: { color: '#e63946', fontWeight: '700', fontSize: 15 },
  lobbyBtn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#444',
  },
  lobbyBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
