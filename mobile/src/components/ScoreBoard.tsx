/**
 * In-game scoreboard overlay. Mirrors client/src/components/ScoreBoard.svelte:
 * one layout per game mode (Domination / CTF / Infection / TDM / FFA) showing
 * who's leading. Driven by the `scores` array the server pushes in GAME_STATE.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GAME_MODES } from 'shared/messages.js';
import { useGameStore } from '../stores/game.js';

// Score entries carry mode-specific fields the base ScoreEntry type doesn't
// enumerate (points/captures/count/hasFlag); read them loosely.
type AnyScore = Record<string, any>;

export default function ScoreBoard() {
  const { scores, myId, gameConfig } = useGameStore();
  const mode = gameConfig.mode;
  const list = scores as AnyScore[];

  const renderPlayer = (p: AnyScore, extra?: string) => (
    <Text
      key={p.id}
      style={[
        styles.player,
        p.id === myId && styles.playerMe,
        p.isAlive === false && styles.dead,
      ]}>
      {p.username}
      {extra ?? ''} {p.kills}/{p.deaths}
      {p.hp != null ? (p.isAlive === false ? ' ☠' : ` ♥${p.hp}`) : ''}
    </Text>
  );

  let body: React.ReactNode;

  if (mode === GAME_MODES.DOMINATION) {
    body = list.map(team => (
      <View key={team.team} style={styles.teamRow}>
        <View style={styles.teamHeader}>
          <Text style={[styles.teamLabel, teamColor(team.team)]}>
            {String(team.team).toUpperCase()}
          </Text>
          <Text style={styles.teamScore}>🏆 {team.points ?? 0}</Text>
        </View>
        <View style={styles.playerList}>
          {(team.players ?? []).map((p: AnyScore) => renderPlayer(p))}
        </View>
      </View>
    ));
  } else if (mode === GAME_MODES.CAPTURE_THE_FLAG) {
    body = list.map(team => (
      <View key={team.team} style={styles.teamRow}>
        <View style={styles.teamHeader}>
          <Text style={[styles.teamLabel, teamColor(team.team)]}>
            {String(team.team).toUpperCase()}
          </Text>
          <Text style={styles.teamScore}>🚩 {team.captures ?? 0}</Text>
        </View>
        <View style={styles.playerList}>
          {(team.players ?? []).map((p: AnyScore) =>
            renderPlayer(p, p.hasFlag ? ' 🚩' : ''),
          )}
        </View>
      </View>
    ));
  } else if (mode === GAME_MODES.INFECTION) {
    body = list.map(group => (
      <View key={group.team} style={styles.teamRow}>
        <View style={styles.teamHeader}>
          <Text
            style={[
              styles.teamLabel,
              { color: group.team === 'infected' ? '#ff5252' : '#00c853' },
            ]}>
            {group.team === 'infected' ? '🧟 INFECTED' : '🧍 SURVIVORS'}
          </Text>
          <Text style={styles.teamScore}>{group.count ?? 0}</Text>
        </View>
        <View style={styles.playerList}>
          {(group.players ?? []).map((p: AnyScore) => (
            <Text
              key={p.id}
              style={[styles.player, p.id === myId && styles.playerMe]}>
              {p.username}
              {group.team === 'infected' ? ` (${p.kills})` : ''}
            </Text>
          ))}
        </View>
      </View>
    ));
  } else if (mode === GAME_MODES.TEAM_DEATHMATCH) {
    body = list.map(team => (
      <View key={team.team} style={styles.teamRow}>
        <View style={styles.teamHeader}>
          <Text style={[styles.teamLabel, teamColor(team.team)]}>
            {String(team.team).toUpperCase()}
          </Text>
          <Text style={styles.teamScore}>{team.kills ?? 0}</Text>
        </View>
        <View style={styles.playerList}>
          {(team.players ?? []).map((p: AnyScore) => renderPlayer(p))}
        </View>
      </View>
    ));
  } else {
    // FFA: flat, ranked list.
    body = list.map((p, i) => (
      <View
        key={p.id}
        style={[styles.scoreRow, p.isAlive === false && styles.dead]}>
        <Text style={styles.rank}>#{i + 1}</Text>
        <Text
          style={[styles.name, p.id === myId && styles.nameMe]}
          numberOfLines={1}>
          {p.username}
        </Text>
        {p.hp != null && (
          <Text style={styles.hp}>{p.isAlive === false ? '☠' : `♥${p.hp}`}</Text>
        )}
        <Text style={styles.kd}>
          {p.kills}/{p.deaths}
        </Text>
      </View>
    ));
  }

  return <View style={styles.scoreboard}>{body}</View>;
}

function teamColor(team: string) {
  if (team === 'red') return { color: '#ff5252' };
  if (team === 'blue') return { color: '#448aff' };
  return { color: '#bbb' };
}

const styles = StyleSheet.create({
  scoreboard: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 8,
    minWidth: 180,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  rank: { color: '#666', width: 26, fontSize: 13 },
  name: { flex: 1, color: '#ccc', fontSize: 13 },
  nameMe: { color: '#fff', fontWeight: '700' },
  kd: { color: '#aaa', fontSize: 13, fontVariant: ['tabular-nums'] },
  hp: { color: '#ff7a7a', fontSize: 11, marginHorizontal: 6 },
  dead: { opacity: 0.5 },
  teamRow: { paddingVertical: 4 },
  teamHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  teamLabel: { fontWeight: '700', fontSize: 11, letterSpacing: 1 },
  teamScore: { fontWeight: '700', fontSize: 15, color: '#fff' },
  playerList: { marginTop: 3, gap: 2 },
  player: { fontSize: 12, color: '#bbb' },
  playerMe: { color: '#fff', fontWeight: '700' },
});
