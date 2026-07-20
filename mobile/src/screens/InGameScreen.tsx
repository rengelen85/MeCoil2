import React, { useEffect, useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/index.js';
import { useGameStore, ScoreEntry } from '../stores/game.js';
import { useMapStore } from '../stores/map.js';
import { sendPosition, sendStopGame, sendDeployAirstrike, sendDeployApache, sendLeaveRoom } from '../lib/network.js';
import { applyGunAssignment, connectBle, reconnectBle, setGunMode, GUN_MODES, GUN_MODE_CYCLE, GunMode } from '../lib/ble.js';
import { isInArea } from '../lib/geo.js';
import { GAME_MODES } from 'shared/messages.js';
import GameMap from '../components/GameMap.js';
import ScoreBoard from '../components/ScoreBoard.js';
import Compass from '../components/Compass.js';

// Short top-bar label per game mode (mirrors the web client).
const MODE_LABELS: Record<string, string> = {
  [GAME_MODES.FFA]: 'FFA',
  [GAME_MODES.TEAM_DEATHMATCH]: 'TDM',
  [GAME_MODES.CAPTURE_THE_FLAG]: 'CTF',
  [GAME_MODES.DOMINATION]: 'DOM',
  [GAME_MODES.INFECTION]: 'INF',
};
const TEAM_MODES: string[] = [
  GAME_MODES.TEAM_DEATHMATCH,
  GAME_MODES.CAPTURE_THE_FLAG,
  GAME_MODES.DOMINATION,
];

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

// Format remaining power-up seconds as M:SS (mirrors the web AmmoBar badge).
function fmtCountdown(secs: number | null): string {
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default function InGameScreen(_props: Props) {
  const {
    ammo, maxAmmo, isReloading, shieldActive, shieldCountdown, stealthActive, stealthCountdown,
    radarActive, radarCountdown, airstrikeReady, airstrikeArmed, airstrikePreview,
    setAirstrikeArmed, setAirstrikePreview, setAirstrikeReady,
    apacheReady, apacheArmed, apachePreview,
    setApacheArmed, setApachePreview, setApacheReady,
    timeRemaining, scores, myId, isHost, bleConnected, bleEverConnected, bleReconnecting, gunSlotId,
    killFeed, hp, maxHp, isAlive, respawnCountdown, killedBy, gameConfig, players,
    activeGunMode, roundId, ctfState, infectionState, dominationState,
    gameArea, lastHitAt, lastShotHitAt, fastReloadActive, fastReloadCountdown,
  } = useGameStore();

  const [showScores, setShowScores] = useState(false);

  const myScore = findMyScore(scores, myId);
  const modeLabel = MODE_LABELS[gameConfig.mode] ?? gameConfig.mode;
  const isTeamMode = TEAM_MODES.includes(gameConfig.mode);
  const myTeam = players.find(p => p.id === myId)?.team ?? null;
  const hpPct = maxHp > 0 ? Math.min(100, Math.round((hp / maxHp) * 100)) : 0;
  const hpColor = hpPct > 50 ? '#00e676' : hpPct > 25 ? '#ffeb3b' : '#ff5252';

  const { startGPS, stopGPS, startHeading, stopHeading, airstrikes, apaches, myPosition } =
    useMapStore();

  // CTF: capture tally for the top bar.
  const ctfCaptures =
    gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG && ctfState ? ctfState.captures : null;

  // Infection: am I infected, and is my immunity currently active?
  const amIInfected =
    gameConfig.mode === GAME_MODES.INFECTION &&
    !!infectionState &&
    infectionState.infectedIds.includes(myId ?? -1);
  const gunLocked =
    gameConfig.mode === GAME_MODES.INFECTION && !!infectionState && !amIInfected;
  const myImmunity = infectionState?.immunePlayers?.[myId ?? -1];
  const immunityActive =
    !!myImmunity?.hasImmunity ||
    (myImmunity?.gracePeriodUntil != null && Date.now() < myImmunity.gracePeriodUntil);

  // Out-of-bounds when a play area is set and my GPS position falls outside it.
  const outOfBounds =
    !!gameArea && !!myPosition && !isInArea(myPosition.lat, myPosition.lng, gameArea);

  // Brief red flash on incoming damage; "HIT" pip when our own shot lands.
  const [hitFlash, setHitFlash] = useState(false);
  useEffect(() => {
    if (!lastHitAt) return;
    setHitFlash(true);
    const t = setTimeout(() => setHitFlash(false), 350);
    return () => clearTimeout(t);
  }, [lastHitAt]);

  const [shotHit, setShotHit] = useState(false);
  useEffect(() => {
    if (!lastShotHitAt) return;
    setShotHit(true);
    const t = setTimeout(() => setShotHit(false), 600);
    return () => clearTimeout(t);
  }, [lastShotHitAt]);

  // 1s ticker so the incoming-airstrike countdown updates live.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const incomingStrike = airstrikes.length
    ? Math.max(0, Math.ceil((Math.min(...airstrikes.map(a => a.detonateAt)) - now) / 1000))
    : null;
  const apacheCountdown = apaches.length
    ? Math.max(0, Math.ceil((Math.max(...apaches.map(a => a.endsAt)) - now) / 1000))
    : null;

  // The centered score-overview bar (CTF captures / Domination zones) sits at the
  // top-centre. When it's present the airstrike/apache warning badges must drop
  // below it instead of overlapping; airstrike and apache then stack under each
  // other. Without a score bar they keep the original (higher) position.
  const hasTopScoreBar =
    !!ctfCaptures || (gameConfig.mode === GAME_MODES.DOMINATION && !!dominationState);
  const warnBaseTop = hasTopScoreBar ? 134 : 92;
  const airstrikeWarnTop = warnBaseTop;
  const apacheWarnTop = incomingStrike !== null ? warnBaseTop + 56 : warnBaseTop;

  function toggleAirstrike() {
    if (airstrikeReady <= 0) return;
    setAirstrikePreview(null);
    setAirstrikeArmed(!airstrikeArmed);
  }

  function confirmAirstrike() {
    if (!airstrikePreview) return;
    sendDeployAirstrike(airstrikePreview.lat, airstrikePreview.lng);
    setAirstrikePreview(null);
    setAirstrikeReady(Math.max(0, airstrikeReady - 1));
  }

  function cancelAirstrike() {
    setAirstrikePreview(null);
  }

  function toggleApache() {
    if (apacheReady <= 0) return;
    setApachePreview(null);
    setApacheArmed(!apacheArmed);
  }

  function confirmApache() {
    if (!apachePreview) return;
    sendDeployApache(apachePreview.lat, apachePreview.lng);
    setApachePreview(null);
    setApacheReady(Math.max(0, apacheReady - 1));
  }

  function cancelApache() {
    setApachePreview(null);
  }

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

  function handleReconnectBle() {
    reconnectBle().catch(e => Alert.alert('Reconnect failed', e.message));
  }

  // The gun dropped after having been connected — distinct from "never paired".
  const gunDisconnected = bleEverConnected && !bleConnected;

  // Fire mode lives in the store so the gun's power button (which cycles modes
  // over BLE) and the on-screen toggle stay in sync. setGunMode updates it.
  const gunMode = activeGunMode as GunMode;

  function cycleGunMode() {
    const i = GUN_MODE_CYCLE.indexOf(gunMode);
    const next = GUN_MODE_CYCLE[(i + 1) % GUN_MODE_CYCLE.length];
    setGunMode(next).catch(e => Alert.alert('BLE Error', e.message));
  }

  const mins = String(Math.floor(timeRemaining / 60)).padStart(2, '0');
  const secs = String(timeRemaining % 60).padStart(2, '0');

  return (
    <View style={styles.container}>
      <GameMap />

      {/* Incoming airstrike warning */}
      {incomingStrike !== null && (
        <View style={[styles.airstrikeWarning, { top: airstrikeWarnTop }]} pointerEvents="none">
          <Text style={styles.airstrikeWarningTitle}>⚠ INCOMING AIRSTRIKE</Text>
          <Text style={styles.airstrikeWarningCount}>
            {incomingStrike}s — CLEAR THE ZONE
          </Text>
        </View>
      )}

      {/* Apache zone active warning */}
      {apacheCountdown !== null && (
        <View
          style={[styles.apacheWarning, { top: apacheWarnTop }]}
          pointerEvents="none">
          <Text style={styles.apacheWarningTitle}>
            🚁 APACHE ZONE{apaches.length > 1 ? ` (${apaches.length})` : ''} ACTIVE
          </Text>
          <Text style={styles.apacheWarningCount}>{apacheCountdown}s remaining</Text>
        </View>
      )}

      {/* Radar active indicator */}
      {radarActive && (
        <View style={styles.radarBadge} pointerEvents="none">
          <Text style={styles.radarBadgeText}>
            📡 RADAR{radarCountdown != null
              ? ` ${Math.floor(radarCountdown / 60)}:${String(radarCountdown % 60).padStart(2, '0')}`
              : ''}
          </Text>
        </View>
      )}

      {/* Out-of-bounds warning */}
      {outOfBounds && (
        <View style={styles.oobWarning} pointerEvents="none">
          <Text style={styles.oobWarningText}>⚠ OUT OF BOUNDS — RETURN TO PLAY AREA</Text>
        </View>
      )}

      {/* CTF: flag capture scores */}
      {ctfCaptures && (
        <View style={styles.ctfBar} pointerEvents="none">
          <Text style={styles.ctfRed}>🚩 RED {ctfCaptures.red ?? 0}</Text>
          <Text style={styles.ctfSep}>—</Text>
          <Text style={styles.ctfBlue}>BLUE {ctfCaptures.blue ?? 0} 🚩</Text>
        </View>
      )}

      {/* Domination: zone status + team point scores */}
      {gameConfig.mode === GAME_MODES.DOMINATION && dominationState && (
        <View style={styles.domBar} pointerEvents="none">
          <Text style={[styles.domTeam, styles.domRed]}>{dominationState.teamPoints?.red ?? 0}</Text>
          <View style={styles.domZones}>
            {dominationState.zones.map(zone => (
              <View
                key={zone.id}
                style={[
                  styles.domZone,
                  zone.owner === 'red' && styles.domZoneRed,
                  zone.owner === 'blue' && styles.domZoneBlue,
                  zone.owner === 'neutral' && styles.domZoneNeutral,
                ]}>
                <Text style={styles.domZoneId}>{zone.id}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.domTeam, styles.domBlue]}>{dominationState.teamPoints?.blue ?? 0}</Text>
        </View>
      )}

      {/* Infection: role indicator + gun-lock notice */}
      {gameConfig.mode === GAME_MODES.INFECTION && infectionState && (
        <>
          <View
            style={[styles.infRole, amIInfected ? styles.infInfected : styles.infSurvivor]}
            pointerEvents="none">
            <Text style={[styles.infRoleText, { color: amIInfected ? '#ff5252' : '#00c853' }]}>
              {amIInfected ? '🧟 INFECTED' : '🧍 SURVIVOR'}
            </Text>
            {immunityActive && <Text style={styles.infImmune}>🛡 IMMUNE</Text>}
          </View>
          {gunLocked && (
            <View style={styles.gunLocked} pointerEvents="none">
              <Text style={styles.gunLockedText}>🔒 GUN LOCKED</Text>
            </View>
          )}
        </>
      )}

      {/* Top HUD: timer centered (mirrors web) */}
      <View style={styles.timerWrap} pointerEvents="none">
        <Text style={styles.timer}>
          {mins}:{secs}
        </Text>
      </View>

      {/* Top HUD row: mode/team badge (left), stop (right, host only) */}
      <View style={styles.topHud} pointerEvents="box-none">
        <View style={styles.topBadges} pointerEvents="none">
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>{modeLabel}</Text>
          </View>
          {isTeamMode && myTeam && myTeam !== 'none' && (
            <View
              style={[
                styles.teamBadge,
                myTeam === 'red' ? styles.teamBadgeRed : styles.teamBadgeBlue,
              ]}>
              <Text
                style={[
                  styles.teamBadgeText,
                  { color: myTeam === 'red' ? '#ff5252' : '#448aff' },
                ]}>
                {myTeam.toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.topRightBtns}>
          {isHost && (
            <TouchableOpacity
              style={styles.stopBtn}
              onPress={sendStopGame}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.stopBtnText}>■ Stop</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.scoresBtn}
            onPress={() => setShowScores(v => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.scoresBtnText}>{showScores ? '✕' : '⊞'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Scoreboard overlay — who's leading */}
      {showScores && (
        <View style={styles.scoresOverlay}>
          <ScoreBoard />
          {roundId ? (
            <Text style={styles.roundId}>Round {roundId.slice(0, 8)}</Text>
          ) : null}
          <TouchableOpacity style={styles.leaveBtn} onPress={sendLeaveRoom}>
            <Text style={styles.leaveBtnText}>Leave</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Personal stats + health (bottom-right, mirrors web) */}
      <View style={styles.bottomRight} pointerEvents="none">
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
        <View style={styles.statsRow}>
          <Text style={styles.stat}>💀 {myScore?.kills ?? 0}</Text>
          <Text style={styles.stat}>🎯 {myScore?.hits ?? 0}</Text>
          <Text style={styles.stat}>🩸 {myScore?.timesHit ?? 0}</Text>
        </View>
      </View>

      {/* Incoming-damage red flash */}
      {hitFlash && <View style={styles.hitFlash} pointerEvents="none" />}

      {/* Outgoing-hit confirmation pip */}
      {shotHit && (
        <View style={styles.shotHitWrap} pointerEvents="none">
          <Text style={styles.shotHit}>HIT</Text>
        </View>
      )}

      {/* Respawn overlay */}
      {!isAlive && (
        <View style={styles.respawnOverlay} pointerEvents="none">
          <Text style={styles.respawnTitle}>YOU ARE DOWN</Text>
          {killedBy ? (
            <Text style={styles.respawnKiller}>
              Killed by <Text style={styles.killerName}>{killedBy}</Text>
            </Text>
          ) : null}
          {gameConfig.mode === GAME_MODES.CAPTURE_THE_FLAG ? (
            <>
              <Text style={styles.respawnCount}>Return to your base to respawn</Text>
              {respawnCountdown != null && (
                <Text style={styles.respawnCtfTimer}>{respawnCountdown}s</Text>
              )}
            </>
          ) : gameConfig.mode === GAME_MODES.DOMINATION ? (
            respawnCountdown != null ? (
              <>
                <Text style={styles.respawnCount}>Respawning in {respawnCountdown}…</Text>
                <Text style={styles.respawnHint}>No friendly zone — you'll spawn anywhere</Text>
              </>
            ) : (
              <Text style={styles.respawnCount}>Head to a friendly zone to respawn</Text>
            )
          ) : (
            <Text style={styles.respawnCount}>Respawning in {respawnCountdown ?? 0}…</Text>
          )}
        </View>
      )}

      {/* Gun disconnected — prominent centered warning + reconnect */}
      {gunDisconnected && (
        <View style={styles.gunDisconnectedOverlay} pointerEvents="box-none">
          <View style={styles.gunDisconnectedBanner}>
            <Text style={styles.gunDisconnectedTitle}>⚠ GUN DISCONNECTED</Text>
            <Text style={styles.gunDisconnectedSub}>
              {bleReconnecting
                ? 'Reconnecting to your gun…'
                : 'Your gun lost its connection'}
            </Text>
            <TouchableOpacity
              style={[
                styles.gunReconnectBtn,
                bleReconnecting && styles.gunReconnectBtnDisabled,
              ]}
              onPress={handleReconnectBle}
              disabled={bleReconnecting}>
              <Text style={styles.gunReconnectBtnText}>
                {bleReconnecting ? 'Reconnecting…' : '🔌 Reconnect'}
              </Text>
            </TouchableOpacity>
          </View>
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

      {/* Heading compass — bottom-right, above the health bar */}
      <View style={styles.compassWrap} pointerEvents="none">
        <Compass />
      </View>

      {/* Bottom HUD */}
      <View style={styles.bottomHud}>
        {/* Airstrike: armed hint or pending-confirm prompt (sits above the gun status) */}
        {airstrikePreview ? (
          <View style={styles.airstrikeConfirmBar}>
            <TouchableOpacity style={styles.btnConfirmStrike} onPress={confirmAirstrike}>
              <Text style={styles.btnConfirmStrikeText}>✓ Confirm Strike</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnCancelStrike} onPress={cancelAirstrike}>
              <Text style={styles.btnCancelStrikeText}>✗ Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : airstrikeArmed ? (
          <View style={styles.airstrikeArmedHint} pointerEvents="none">
            <Text style={styles.airstrikeArmedHintText}>Tap the map to place the strike zone</Text>
          </View>
        ) : null}

        {/* Apache: armed hint or pending-confirm prompt */}
        {apachePreview ? (
          <View style={styles.apacheConfirmBar}>
            <TouchableOpacity style={styles.btnConfirmApache} onPress={confirmApache}>
              <Text style={styles.btnConfirmApacheText}>✓ Deploy Apache</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnCancelStrike} onPress={cancelApache}>
              <Text style={styles.btnCancelStrikeText}>✗ Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : apacheArmed ? (
          <View style={styles.apacheArmedHint} pointerEvents="none">
            <Text style={styles.apacheArmedHintText}>Tap the map to place the Apache zone</Text>
          </View>
        ) : null}

        {/* Active power-up countdowns — badges right above the gun/magazine status (mirrors web AmmoBar) */}
        {(shieldActive || stealthActive || fastReloadActive) && (
          <View style={styles.powerupBadges} pointerEvents="none">
            {shieldActive && (
              <Text style={[styles.powerupBadge, styles.powerupShield]}>
                🛡 SHIELD {fmtCountdown(shieldCountdown)}
              </Text>
            )}
            {stealthActive && (
              <Text style={[styles.powerupBadge, styles.powerupStealth]}>
                👻 STEALTH {fmtCountdown(stealthCountdown)}
              </Text>
            )}
            {fastReloadActive && (
              <Text style={[styles.powerupBadge, styles.powerupFastReload]}>
                🔋 FAST RELOAD {fmtCountdown(fastReloadCountdown)}
              </Text>
            )}
          </View>
        )}

        {/* Ammo */}
        <View style={styles.ammoBlock}>
          <Text style={styles.ammoIcon}>🔫</Text>
          <Text style={styles.ammoCount}>
            {isReloading ? 'RELOADING' : ammo}
          </Text>
          <Text style={styles.ammoMax}>/ {maxAmmo}</Text>
        </View>

        {/* Status indicators */}
        <View style={styles.statusIcons}>
          {airstrikeReady > 0 && (
            <TouchableOpacity onPress={toggleAirstrike}>
              <Text style={[styles.airstrikeBtn, airstrikeArmed && styles.airstrikeBtnArmed]}>
                🚀 {airstrikeReady}
              </Text>
            </TouchableOpacity>
          )}
          {apacheReady > 0 && (
            <TouchableOpacity onPress={toggleApache}>
              <Text style={[styles.apacheBtn, apacheArmed && styles.apacheBtnArmed]}>
                🚁 {apacheReady}
              </Text>
            </TouchableOpacity>
          )}
          {bleConnected ? (
            <TouchableOpacity onPress={cycleGunMode}>
              <Text style={[styles.gunMode, GUN_MODE_STYLES[gunMode]]}>
                {GUN_MODES[gunMode].label}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleConnectBle}>
              <Text style={styles.bleWarning}>⚠ Gun</Text>
            </TouchableOpacity>
          )}
        </View>
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
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeBadge: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modeBadgeText: {
    color: '#00e5ff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
  },
  teamBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  teamBadgeRed: { backgroundColor: 'rgba(255,82,82,0.2)', borderColor: 'rgba(255,82,82,0.7)' },
  teamBadgeBlue: { backgroundColor: 'rgba(68,138,255,0.2)', borderColor: 'rgba(68,138,255,0.7)' },
  teamBadgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  timerWrap: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
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
  bottomRight: {
    position: 'absolute',
    bottom: 40,
    right: 16,
    width: 160,
    alignItems: 'flex-end',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
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
    width: '100%',
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
  respawnKiller: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    marginBottom: 8,
  },
  killerName: {
    color: '#fff',
    fontWeight: '700',
  },
  respawnCtfTimer: {
    color: '#ff5252',
    fontSize: 42,
    fontWeight: '900',
    marginTop: 4,
  },
  respawnHint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginTop: 4,
  },
  hitFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,30,30,0.4)',
    zIndex: 70,
  },
  shotHitWrap: {
    position: 'absolute',
    top: '42%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 65,
  },
  shotHit: {
    color: '#00e676',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 5,
    textShadowColor: 'rgba(0,230,118,0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  oobWarning: {
    position: 'absolute',
    top: 168,
    alignSelf: 'center',
    zIndex: 50,
    backgroundColor: 'rgba(40,25,0,0.9)',
    borderWidth: 1,
    borderColor: '#ff9800',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  oobWarningText: {
    color: '#ff9800',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 1,
  },
  ctfBar: {
    position: 'absolute',
    top: 84,
    alignSelf: 'center',
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  ctfRed: { color: '#ff5252', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  ctfBlue: { color: '#448aff', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  ctfSep: { color: 'rgba(255,255,255,0.3)', fontSize: 13 },
  domBar: {
    position: 'absolute',
    top: 84,
    alignSelf: 'center',
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  domTeam: { fontSize: 16, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  domRed: { color: '#ff5252' },
  domBlue: { color: '#448aff' },
  domZones: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  domZone: {
    minWidth: 28,
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  domZoneRed: { backgroundColor: 'rgba(255,82,82,0.25)', borderColor: 'rgba(255,82,82,0.6)' },
  domZoneBlue: { backgroundColor: 'rgba(68,138,255,0.25)', borderColor: 'rgba(68,138,255,0.6)' },
  domZoneNeutral: { backgroundColor: 'rgba(255,255,255,0.06)' },
  domZoneId: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  infRole: {
    position: 'absolute',
    top: 84,
    left: 16,
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  infInfected: { borderColor: 'rgba(255,82,82,0.6)' },
  infSurvivor: { borderColor: 'rgba(0,200,83,0.6)' },
  infRoleText: { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  infImmune: { color: '#ffd740', fontSize: 11, letterSpacing: 0.5 },
  gunLocked: {
    position: 'absolute',
    top: 118,
    left: 16,
    zIndex: 40,
    backgroundColor: 'rgba(40,0,0,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,82,82,0.5)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  gunLockedText: { color: '#ff5252', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  killFeed: {
    position: 'absolute',
    top: 92,
    right: 16,
    maxWidth: 220,
    alignItems: 'flex-end',
    pointerEvents: 'none',
  },
  killFeedEntry: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginBottom: 2,
    textAlign: 'right',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  compassWrap: {
    position: 'absolute',
    bottom: 120,
    right: 16,
    zIndex: 30,
  },
  bottomHud: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    alignItems: 'flex-start',
    gap: 8,
  },
  ammoBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  ammoIcon: {
    fontSize: 20,
    marginRight: 6,
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
  powerupBadges: {
    alignItems: 'flex-start',
    gap: 4,
  },
  powerupBadge: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  powerupShield: { color: '#82b1ff' },
  powerupStealth: { color: '#e040fb' },
  powerupFastReload: { color: '#69f0ae' },
  airstrikeBtn: {
    color: '#ff5252',
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: 'rgba(255,23,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,23,68,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    overflow: 'hidden',
  },
  airstrikeBtnArmed: {
    color: '#fff',
    backgroundColor: '#ff1744',
  },
  airstrikeWarning: {
    position: 'absolute',
    top: 92,
    alignSelf: 'center',
    zIndex: 50,
    backgroundColor: 'rgba(40,0,0,0.85)',
    borderWidth: 1,
    borderColor: '#ff1744',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
  },
  airstrikeWarningTitle: {
    color: '#ff5252',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
  airstrikeWarningCount: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
    marginTop: 2,
  },
  radarBadge: {
    position: 'absolute',
    top: 130,
    left: 16,
    zIndex: 50,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.5)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  radarBadgeText: {
    color: '#00e5ff',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1,
  },
  airstrikeArmedHint: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  airstrikeArmedHintText: {
    color: '#ff8a80',
    fontSize: 12,
  },
  airstrikeConfirmBar: {
    flexDirection: 'row',
    gap: 8,
  },
  btnConfirmStrike: {
    backgroundColor: '#ff9800',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  btnConfirmStrikeText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  btnCancelStrike: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  btnCancelStrikeText: {
    color: '#aaa',
    fontWeight: '700',
    fontSize: 14,
  },
  gunDisconnectedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 80,
  },
  gunDisconnectedBanner: {
    backgroundColor: 'rgba(40,0,0,0.92)',
    borderWidth: 2,
    borderColor: '#ff1744',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 20,
    alignItems: 'center',
  },
  gunDisconnectedTitle: {
    color: '#ff5252',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
  },
  gunDisconnectedSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
  },
  gunReconnectBtn: {
    backgroundColor: '#ff1744',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  gunReconnectBtnDisabled: {
    backgroundColor: 'rgba(255,23,68,0.4)',
  },
  gunReconnectBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
  },
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
  // AUTO uses the base gunMode (cyan) style.
  gunModeSemi: {
    color: '#ffc107',
    backgroundColor: 'rgba(255,193,7,0.15)',
    borderColor: 'rgba(255,193,7,0.5)',
  },
  gunModeBurst: {
    color: '#ff9800',
    backgroundColor: 'rgba(255,152,0,0.15)',
    borderColor: 'rgba(255,152,0,0.5)',
  },
  gunModePlasma: {
    color: '#e040fb',
    backgroundColor: 'rgba(224,64,251,0.15)',
    borderColor: 'rgba(224,64,251,0.5)',
  },
  topRightBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stopBtn: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stopBtnText: { color: '#e63946', fontWeight: '700' },
  scoresBtn: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  scoresBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  scoresOverlay: {
    position: 'absolute',
    top: 88,
    left: 16,
    zIndex: 60,
    gap: 8,
    alignItems: 'flex-start',
  },
  roundId: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
  },
  leaveBtn: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  leaveBtnText: { color: '#ccc', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  apacheWarning: {
    position: 'absolute',
    top: 92,
    alignSelf: 'center',
    zIndex: 50,
    backgroundColor: 'rgba(0,30,0,0.85)',
    borderWidth: 1,
    borderColor: '#00c853',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
  },
  apacheWarningTitle: {
    color: '#00e676',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
  apacheWarningCount: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
    marginTop: 2,
  },
  apacheArmedHint: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  apacheArmedHintText: {
    color: '#69f0ae',
    fontSize: 12,
  },
  apacheConfirmBar: {
    flexDirection: 'row',
    gap: 8,
  },
  btnConfirmApache: {
    backgroundColor: '#00c853',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  btnConfirmApacheText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  apacheBtn: {
    color: '#00e676',
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: 'rgba(0,200,83,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0,200,83,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    overflow: 'hidden',
  },
  apacheBtnArmed: {
    color: '#000',
    backgroundColor: '#00c853',
  },
});

// Per-mode accent applied on top of styles.gunMode. AUTO keeps the base style.
const GUN_MODE_STYLES: Record<GunMode, object | undefined> = {
  semi:   styles.gunModeSemi,
  burst:  styles.gunModeBurst,
  auto:   undefined,
  plasma: styles.gunModePlasma,
};
