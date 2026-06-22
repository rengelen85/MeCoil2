import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/index.js';
import {
  useGameStore,
  PlayerInfo,
  GameConfig,
  LatLng,
} from '../stores/game.js';
import {
  sendReady,
  sendGameConfig,
  sendStartGame,
  sendLeaveRoom,
  sendSwitchTeam,
  sendSetBase,
  sendSetDomZone,
  sendSetGameArea,
} from '../lib/network.js';
import { GAME_MODES, GAME_STATES, TEAMS } from 'shared/messages.js';

type Props = NativeStackScreenProps<RootStackParamList, 'Lobby'>;

// Host-tunable numeric settings (keys must match GameConfig fields).
const COMBAT_SETTINGS: { key: keyof GameConfig; label: string; fallback: number }[] = [
  { key: 'bulletsPerMag', label: 'Bullets / magazine', fallback: 30 },
  { key: 'hpPerPlayer', label: 'HP per player', fallback: 100 },
  { key: 'reloadDelaySecs', label: 'Reload delay (s)', fallback: 3 },
  { key: 'respawnDelaySecs', label: 'Respawn delay (s)', fallback: 10 },
];

const MODE_LABELS: Record<string, string> = {
  [GAME_MODES.FFA]: 'Free for All',
  [GAME_MODES.TEAM_DEATHMATCH]: 'Team Deathmatch',
  [GAME_MODES.CAPTURE_THE_FLAG]: 'Capture the Flag',
  [GAME_MODES.DOMINATION]: 'Domination',
  [GAME_MODES.INFECTION]: 'Infection',
};

// ── Location helpers ──────────────────────────────────────────────────────────
// The host places CTF bases, Domination zones and game-area corners by walking
// to a spot and reading the device's current GPS position (mirrors the web app).

async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true;
}

function getCurrentPositionOnce(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

// Reusable labelled numeric input row.
function NumberRow({
  label,
  value,
  fallback,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  fallback: number;
  onCommit: (n: number) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <TextInput
        style={styles.settingInput}
        keyboardType="numeric"
        defaultValue={String(value ?? fallback)}
        onEndEditing={e => {
          const n = Number(e.nativeEvent.text);
          if (!Number.isNaN(n)) onCommit(n);
        }}
      />
    </View>
  );
}

export default function LobbyScreen(_props: Props) {
  const {
    players, myId, isHost, hostId, roomName, gameConfig, gameState,
  } = useGameStore();

  const me = players.find(p => p.id === myId);
  const allReady = players.length > 0 && players.every(p => p.ready);

  const [busy, setBusy] = useState(false);

  // Game-area editing state (host only). `areaType` drives which editor shows;
  // it is the local source of truth, seeded once from the server config.
  const [areaType, setAreaType] = useState<'none' | 'circle' | 'polygon'>('none');
  const [areaRadius, setAreaRadius] = useState(60);
  const [areaCorners, setAreaCorners] = useState<LatLng[]>([]);
  const areaInited = useRef(false);

  useEffect(() => {
    if (areaInited.current) return;
    const a = gameConfig.gameArea;
    if (a?.type === 'circle') {
      setAreaType('circle');
      setAreaRadius(a.radiusM);
      areaInited.current = true;
    } else if (a?.type === 'polygon') {
      setAreaType('polygon');
      setAreaCorners(a.points);
      areaInited.current = true;
    }
  }, [gameConfig.gameArea]);

  function handleReadyToggle() {
    sendReady(!me?.ready);
  }

  function handleModeChange(mode: string) {
    // Match the web client: reset the score target to a sensible per-mode default.
    const scoreLimit = mode === GAME_MODES.DOMINATION ? 1000 : 5;
    sendGameConfig({ mode, scoreLimit });
  }

  function handleStartGame() {
    // Host force-start — the server also auto-starts once everyone is ready.
    sendStartGame();
  }

  // Run a GPS-dependent placement action with permission + busy handling.
  async function withGps(fn: (pos: LatLng) => void) {
    const ok = await ensureLocationPermission();
    if (!ok) {
      Alert.alert('Location needed', 'Grant location permission to set positions from GPS.');
      return;
    }
    setBusy(true);
    try {
      fn(await getCurrentPositionOnce());
    } catch (e: any) {
      Alert.alert('GPS error', e?.message ?? 'Could not get current position');
    } finally {
      setBusy(false);
    }
  }

  function setBase(team: string) {
    withGps(pos => sendSetBase(team, pos.lat, pos.lng));
  }

  function setDomZone(zoneId: string) {
    withGps(pos => sendSetDomZone(zoneId, pos.lat, pos.lng));
  }

  function applyAreaType(t: 'none' | 'circle' | 'polygon') {
    setAreaType(t);
    if (t === 'none') {
      setAreaCorners([]);
      sendSetGameArea(null);
    }
    // circle / polygon are sent once the host sets a center / enough corners.
  }

  function setCircleCenter() {
    withGps(pos =>
      sendSetGameArea({ type: 'circle', lat: pos.lat, lng: pos.lng, radiusM: areaRadius }),
    );
  }

  function updateCircleRadius(n: number) {
    setAreaRadius(n);
    const a = gameConfig.gameArea;
    if (a?.type === 'circle') {
      sendSetGameArea({ type: 'circle', lat: a.lat, lng: a.lng, radiusM: n });
    }
  }

  function addCorner() {
    withGps(pos => {
      const next = [...areaCorners, pos];
      setAreaCorners(next);
      if (next.length >= 3) sendSetGameArea({ type: 'polygon', points: next });
    });
  }

  function removeCorner(i: number) {
    const next = areaCorners.filter((_, idx) => idx !== i);
    setAreaCorners(next);
    sendSetGameArea(next.length >= 3 ? { type: 'polygon', points: next } : null);
  }

  function clearArea() {
    setAreaCorners([]);
    sendSetGameArea(null);
  }

  function renderPlayer(item: PlayerInfo) {
    const isMe = item.id === myId;
    const isRoomHost = item.id === hostId;
    const isTeamMode = gameConfig.mode !== GAME_MODES.FFA && gameConfig.mode !== GAME_MODES.INFECTION;
    const canSwitch = isMe && isTeamMode && item.team && item.team !== 'none' && gameState === GAME_STATES.WAITING;
    return (
      <View key={String(item.id)} style={[styles.playerRow, isMe && styles.playerRowMe]}>
        <View style={styles.playerInfo}>
          <Text style={styles.playerName}>
            {item.username}
            {isRoomHost ? ' ★' : ''}
            {isMe ? ' (you)' : ''}
          </Text>
          {isTeamMode && (
            <View style={styles.teamRow}>
              <Text
                style={[
                  styles.playerTeam,
                  item.team === 'red' ? styles.teamRed : styles.teamBlue,
                ]}>
                {item.team}
              </Text>
              {canSwitch && (
                <TouchableOpacity style={styles.switchTeamBtn} onPress={sendSwitchTeam}>
                  <Text style={styles.switchTeamText}>⇄ switch</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        <Text style={[styles.readyBadge, item.ready && styles.readyBadgeOn]}>
          {item.ready ? 'READY' : 'WAITING'}
        </Text>
      </View>
    );
  }

  const mode = gameConfig.mode;
  const domZones = gameConfig.domZones ?? [];

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.leaveBtn} onPress={sendLeaveRoom}>
        <Text style={styles.leaveBtnText}>‹ Leave</Text>
      </TouchableOpacity>

      <Text style={styles.roomName}>{roomName}</Text>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.configSection}>
          <Text style={styles.sectionTitle}>Players ({players.length})</Text>
          {players.map(renderPlayer)}
        </View>

        {isHost && (
          <View style={styles.configSection}>
            <Text style={styles.sectionTitle}>Game Mode</Text>
            <View style={styles.modeRow}>
              {(Object.values(GAME_MODES) as string[]).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modePill, mode === m && styles.modePillActive]}
                  onPress={() => handleModeChange(m)}>
                  <Text
                    style={[
                      styles.modePillText,
                      mode === m && styles.modePillTextActive,
                    ]}>
                    {m.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.spacer} />
            <NumberRow
              label="Time limit (min)"
              value={gameConfig.timeLimit}
              fallback={15}
              onCommit={n => sendGameConfig({ timeLimit: n })}
            />

            {mode !== GAME_MODES.INFECTION && mode !== GAME_MODES.DOMINATION && (
              <NumberRow
                label={mode === GAME_MODES.CAPTURE_THE_FLAG ? 'Flag captures to win' : 'Score limit (kills)'}
                value={gameConfig.scoreLimit}
                fallback={5}
                onCommit={n => sendGameConfig({ scoreLimit: n })}
              />
            )}

            {mode === GAME_MODES.TEAM_DEATHMATCH && (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Friendly Fire</Text>
                <Switch
                  value={gameConfig.friendlyFire ?? false}
                  onValueChange={v => sendGameConfig({ friendlyFire: v })}
                  trackColor={{ true: '#e63946' }}
                />
              </View>
            )}

            {mode === GAME_MODES.CAPTURE_THE_FLAG && (
              <View>
                <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Base Setup</Text>
                <Text style={styles.hint}>
                  Walk to each team's base and tap to set it from your GPS position.
                </Text>
                <View style={styles.placeRow}>
                  <TouchableOpacity
                    style={[styles.placeBtn, styles.placeBtnRed]}
                    disabled={busy}
                    onPress={() => setBase(TEAMS.RED)}>
                    <Text style={styles.placeBtnText}>
                      {gameConfig.redBase ? '✓ Red base set' : 'Set Red Base'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.placeBtn, styles.placeBtnBlue]}
                    disabled={busy}
                    onPress={() => setBase(TEAMS.BLUE)}>
                    <Text style={styles.placeBtnText}>
                      {gameConfig.blueBase ? '✓ Blue base set' : 'Set Blue Base'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {mode === GAME_MODES.DOMINATION && (
              <View>
                <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Zone Setup</Text>
                <Text style={styles.hint}>
                  Walk to each capture zone and tap to place it. A and C are team
                  sides; B is the center.
                </Text>
                <View style={styles.placeRow}>
                  {['A', 'B', 'C'].map(zoneId => {
                    const placed = domZones.some(z => z.id === zoneId);
                    return (
                      <TouchableOpacity
                        key={zoneId}
                        style={[styles.placeBtn, styles.placeBtnDom]}
                        disabled={busy}
                        onPress={() => setDomZone(zoneId)}>
                        <Text style={styles.placeBtnText}>
                          {placed ? `✓ Zone ${zoneId}` : `Set ${zoneId}`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
                  Domination Settings
                </Text>
                <NumberRow
                  label="Points to win"
                  value={gameConfig.scoreLimit}
                  fallback={1000}
                  onCommit={n => sendGameConfig({ scoreLimit: n })}
                />
                <NumberRow
                  label="Scoring tick (s)"
                  value={gameConfig.dominationTickSecs}
                  fallback={2}
                  onCommit={n => sendGameConfig({ dominationTickSecs: n })}
                />
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Deathstreak power-ups</Text>
                  <Switch
                    value={gameConfig.deathstreakEnabled ?? false}
                    onValueChange={v => sendGameConfig({ deathstreakEnabled: v })}
                    trackColor={{ true: '#e63946' }}
                  />
                </View>
                {gameConfig.deathstreakEnabled && (
                  <NumberRow
                    label="Deaths per reward"
                    value={gameConfig.deathstreakCount}
                    fallback={3}
                    onCommit={n => sendGameConfig({ deathstreakCount: n })}
                  />
                )}
              </View>
            )}

            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
              Combat Settings
            </Text>
            {COMBAT_SETTINGS.map(s => (
              <NumberRow
                key={s.key}
                label={s.label}
                value={gameConfig[s.key] as number | undefined}
                fallback={s.fallback}
                onCommit={n => sendGameConfig({ [s.key]: n })}
              />
            ))}

            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Game Area</Text>
            <Text style={styles.hint}>
              Optionally restrict play to a defined area. Players outside are
              warned; power-ups only spawn inside.
            </Text>
            <View style={styles.areaTypeRow}>
              {(['none', 'circle', 'polygon'] as const).map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.areaTypeBtn, areaType === t && styles.areaTypeBtnActive]}
                  onPress={() => applyAreaType(t)}>
                  <Text
                    style={[
                      styles.areaTypeText,
                      areaType === t && styles.areaTypeTextActive,
                    ]}>
                    {t === 'none' ? 'No limit' : t === 'circle' ? 'Circle' : 'Polygon'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {areaType === 'circle' && (
              <View>
                <NumberRow
                  label="Radius (m)"
                  value={areaRadius}
                  fallback={60}
                  onCommit={updateCircleRadius}
                />
                <TouchableOpacity
                  style={[styles.placeBtn, styles.placeBtnArea]}
                  disabled={busy}
                  onPress={setCircleCenter}>
                  <Text style={styles.placeBtnText}>
                    {gameConfig.gameArea?.type === 'circle'
                      ? '✓ Center set — tap to move'
                      : 'Set center here (GPS)'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {areaType === 'polygon' && (
              <View>
                <Text style={styles.hint}>
                  Walk to each corner and tap "Add corner". Need at least 3 corners.
                </Text>
                {areaCorners.map((c, i) => (
                  <View key={i} style={styles.cornerRow}>
                    <Text style={styles.cornerLabel}>
                      #{i + 1}  {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                    </Text>
                    <TouchableOpacity onPress={() => removeCorner(i)}>
                      <Text style={styles.cornerRemove}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.placeRow}>
                  <TouchableOpacity
                    style={[styles.placeBtn, styles.placeBtnArea]}
                    disabled={busy}
                    onPress={addCorner}>
                    <Text style={styles.placeBtnText}>
                      {busy ? 'Getting GPS…' : 'Add corner here'}
                    </Text>
                  </TouchableOpacity>
                  {areaCorners.length > 0 && (
                    <TouchableOpacity
                      style={[styles.placeBtn, styles.placeBtnClear]}
                      onPress={clearArea}>
                      <Text style={styles.placeBtnText}>Clear all</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {areaCorners.length > 0 && areaCorners.length < 3 && (
                  <Text style={[styles.hint, styles.hintWarn]}>
                    Add {3 - areaCorners.length} more corner
                    {3 - areaCorners.length > 1 ? 's' : ''} to activate
                  </Text>
                )}
                {areaCorners.length >= 3 && (
                  <Text style={[styles.hint, styles.hintOk]}>
                    ✓ Polygon active ({areaCorners.length} corners)
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {!isHost && (
          <View style={styles.configSection}>
            <Text style={styles.sectionTitle}>Game Settings</Text>
            <View style={styles.infoRow}>
              <Text style={styles.settingLabel}>Mode</Text>
              <Text style={styles.settingValue}>{MODE_LABELS[mode] ?? mode}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.settingLabel}>Time limit</Text>
              <Text style={styles.settingValue}>{gameConfig.timeLimit} min</Text>
            </View>
            {mode !== GAME_MODES.INFECTION && (
              <View style={styles.infoRow}>
                <Text style={styles.settingLabel}>
                  {mode === GAME_MODES.CAPTURE_THE_FLAG ? 'Captures to win' : 'Score limit'}
                </Text>
                <Text style={styles.settingValue}>{gameConfig.scoreLimit}</Text>
              </View>
            )}
            {mode === GAME_MODES.TEAM_DEATHMATCH && (
              <View style={styles.infoRow}>
                <Text style={styles.settingLabel}>Friendly fire</Text>
                <Text style={styles.settingValue}>{gameConfig.friendlyFire ? 'On' : 'Off'}</Text>
              </View>
            )}
            {mode === GAME_MODES.CAPTURE_THE_FLAG && (
              <>
                <View style={styles.infoRow}>
                  <Text style={styles.settingLabel}>Red base</Text>
                  <Text style={styles.settingValue}>{gameConfig.redBase ? 'Set' : 'Not set'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.settingLabel}>Blue base</Text>
                  <Text style={styles.settingValue}>{gameConfig.blueBase ? 'Set' : 'Not set'}</Text>
                </View>
              </>
            )}
            {mode === GAME_MODES.DOMINATION && (
              <View style={styles.infoRow}>
                <Text style={styles.settingLabel}>Zones placed</Text>
                <Text style={styles.settingValue}>{domZones.length} / 3</Text>
              </View>
            )}

            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Combat Settings</Text>
            {COMBAT_SETTINGS.map(s => (
              <View key={s.key} style={styles.infoRow}>
                <Text style={styles.settingLabel}>{s.label}</Text>
                <Text style={styles.settingValue}>
                  {(gameConfig[s.key] as number | undefined) ?? s.fallback}
                </Text>
              </View>
            ))}

            <View style={styles.infoRow}>
              <Text style={styles.settingLabel}>Game area</Text>
              <Text style={styles.settingValue}>
                {!gameConfig.gameArea
                  ? 'No limit'
                  : gameConfig.gameArea.type === 'circle'
                  ? `Circle ${gameConfig.gameArea.radiusM}m`
                  : `Polygon (${gameConfig.gameArea.points.length} pts)`}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, me?.ready ? styles.btnUnready : styles.btnReady]}
          onPress={handleReadyToggle}>
          <Text style={styles.btnText}>{me?.ready ? 'Not Ready' : 'Ready'}</Text>
        </TouchableOpacity>

        {isHost && (
          <TouchableOpacity
            style={[styles.btn, styles.btnStart]}
            onPress={handleStartGame}>
            <Text style={styles.btnText}>{allReady ? 'Start Game' : 'Force Start'}</Text>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#141414',
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
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playerTeam: { fontSize: 12, textTransform: 'uppercase', fontWeight: '600' },
  teamRed: { color: '#e63946' },
  teamBlue: { color: '#457b9d' },
  switchTeamBtn: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  switchTeamText: { color: '#888', fontSize: 11 },
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
    marginBottom: 12,
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
  sectionTitleSpaced: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
    color: '#e63946',
  },
  spacer: { height: 4 },
  hint: {
    color: '#888',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  hintWarn: { color: '#ff9800', marginTop: 6 },
  hintOk: { color: '#00c853', marginTop: 6 },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
  },
  settingLabel: { color: '#ccc', fontSize: 14, flex: 1 },
  settingInput: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 70,
    textAlign: 'right',
  },
  settingValue: { color: '#fff', fontSize: 15, fontWeight: '600' },
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
    marginTop: 4,
    marginBottom: 8,
  },
  toggleLabel: { color: '#ccc', fontSize: 14 },
  placeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  placeBtn: {
    flex: 1,
    minWidth: 90,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  placeBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  placeBtnRed: { backgroundColor: 'rgba(230,57,70,0.18)', borderColor: 'rgba(230,57,70,0.6)' },
  placeBtnBlue: { backgroundColor: 'rgba(69,123,157,0.22)', borderColor: 'rgba(69,123,157,0.7)' },
  placeBtnDom: { backgroundColor: 'rgba(255,152,0,0.15)', borderColor: 'rgba(255,152,0,0.55)' },
  placeBtnArea: { backgroundColor: 'rgba(255,152,0,0.13)', borderColor: 'rgba(255,152,0,0.5)' },
  placeBtnClear: { backgroundColor: 'rgba(230,57,70,0.12)', borderColor: 'rgba(230,57,70,0.45)' },
  areaTypeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  areaTypeBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#333',
  },
  areaTypeBtnActive: {
    backgroundColor: 'rgba(255,152,0,0.15)',
    borderColor: 'rgba(255,152,0,0.6)',
  },
  areaTypeText: { color: '#888', fontSize: 12, fontWeight: '700' },
  areaTypeTextActive: { color: '#ff9800' },
  cornerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
  },
  cornerLabel: { color: '#aaa', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  cornerRemove: { color: '#e63946', fontSize: 14, paddingHorizontal: 6 },
  actions: {
    gap: 10,
    marginTop: 10,
  },
  btn: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  btnReady: { backgroundColor: '#5cb85c' },
  btnUnready: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#444' },
  btnStart: { backgroundColor: '#e63946' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
