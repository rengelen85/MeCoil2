/**
 * Single-player AR target practice — mirrors client/src/screens/ArPractice.svelte.
 * Runs fully on the device: the rear camera is the backdrop, the rotation
 * sensor aims the crosshair, and targets/scoring come from shared/arGame.js.
 * Nothing is sent to the server.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  LayoutChangeEvent,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, useCameraPermission } from 'react-native-vision-camera';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AR_COUNTDOWN_SECS,
  AR_MAGAZINE_SIZE,
  aimAzimuthDeg,
  arResults,
  arSecondsLeft,
  cameraBasis,
  createArGame,
  fireArShot,
  focalLengthPx,
  projectPoint,
  quatFromDeviceOrientation,
  targetPosition,
  tickArGame,
} from 'shared/arGame.js';
import { RootStackParamList } from '../navigation/index.js';
import { useGameStore } from '../stores/game.js';
import { applyGunAssignment, GUN_MODES, GunMode, setLocalShotHandler } from '../lib/ble.js';
import { playReload, playTargetHit } from '../lib/audio.js';
import { subscribeArOrientation } from '../lib/arOrientation.js';

type Props = NativeStackScreenProps<RootStackParamList, 'ArPractice'>;
type Phase = 'intro' | 'countdown' | 'playing' | 'results';
type Quat = { x: number; y: number; z: number; w: number };
type Basis = ReturnType<typeof cameraBasis>;
type Game = ReturnType<typeof createArGame>;
type Results = ReturnType<typeof arResults>;

interface Sprite {
  id: number;
  kind: string;
  x: number;
  y: number;
  size: number;
  expiring: boolean;
}
interface Indicator {
  id: number;
  kind: string;
  x: number;
  y: number;
  deg: number;
}
interface Popup {
  id: number;
  text: string;
  x: number;
  y: number;
  age: number;
}
interface Frame {
  sprites: Sprite[];
  indicators: Indicator[];
  popups: Popup[];
  timeLeft: number;
  score: number;
  streak: number;
  countdownLeft: number;
}

const BEST_KEY = 'mecoil_ar_best';
const KIND_COLORS: Record<string, string> = {
  standard: '#ff1744',
  mover: '#ff9100',
  bonus: '#ffd600',
};
const EMPTY_FRAME: Frame = {
  sprites: [],
  indicators: [],
  popups: [],
  timeLeft: 0,
  score: 0,
  streak: 0,
  countdownLeft: AR_COUNTDOWN_SECS,
};

const now = () => Date.now();

function Target({ s }: { s: Sprite }) {
  const color = KIND_COLORS[s.kind] ?? KIND_COLORS.standard;
  const ring = (frac: number, bg: string) => ({
    position: 'absolute' as const,
    width: s.size * frac,
    height: s.size * frac,
    borderRadius: (s.size * frac) / 2,
    backgroundColor: bg,
  });
  return (
    <View
      pointerEvents="none"
      style={[
        styles.target,
        {
          left: s.x - s.size / 2,
          top: s.y - s.size / 2,
          width: s.size,
          height: s.size,
          shadowColor: color,
        },
        s.expiring && Math.floor(now() / 125) % 2 === 1 && styles.targetDim,
      ]}>
      <View style={ring(1, color)} />
      <View style={ring(0.68, '#fff')} />
      <View style={ring(0.48, color)} />
      <View style={ring(0.28, '#fff')} />
      <View style={ring(0.12, color)} />
    </View>
  );
}

export default function ArPracticeScreen(_props: Props) {
  const ammo = useGameStore(s => s.ammo);
  const maxAmmo = useGameStore(s => s.maxAmmo);
  const isReloading = useGameStore(s => s.isReloading);
  const fastReloadActive = useGameStore(s => s.fastReloadActive);
  const bleConnected = useGameStore(s => s.bleConnected);
  const activeGunMode = useGameStore(s => s.activeGunMode);
  const { hasPermission, requestPermission } = useCameraPermission();

  const [phase, setPhase] = useState<Phase>('intro');
  const [frame, setFrame] = useState<Frame>(EMPTY_FRAME);
  const [results, setResults] = useState<Results | null>(null);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [starting, setStarting] = useState(false);
  const [hitMarker, setHitMarker] = useState(false);

  const phaseRef = useRef<Phase>('intro');
  const gameRef = useRef<Game | null>(null);
  const basisRef = useRef<Basis>(cameraBasis(quatFromDeviceOrientation(0, 90, 0)));
  const sensorRef = useRef<{ q: Quat; screenAngle: number } | null>(null);
  const dragRef = useRef({ yaw: 0, pitch: 0, fromYaw: 0, fromPitch: 0 });
  const sizeRef = useRef({ width: 0, height: 0 });
  const countdownEndsAtRef = useRef(0);
  const bestRef = useRef(0);
  const hitMarkerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // Until the first sensor sample arrives (or on devices without one), the
  // view is aimed by dragging.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !sensorRef.current,
      onPanResponderGrant: () => {
        const d = dragRef.current;
        d.fromYaw = d.yaw;
        d.fromPitch = d.pitch;
      },
      onPanResponderMove: (_e, g) => {
        const d = dragRef.current;
        const degPerPx = 60 / Math.max(sizeRef.current.width, 1);
        d.yaw = d.fromYaw - g.dx * degPerPx;
        d.pitch = Math.max(-60, Math.min(60, d.fromPitch + g.dy * degPerPx));
      },
    }),
  ).current;

  const exit = useCallback(() => {
    const game = useGameStore.getState();
    game.setScreen(game.arReturnScreen);
  }, []);

  const onShot = useCallback((mode: GunMode, rounds: number) => {
    const game = gameRef.current;
    if (phaseRef.current !== 'playing' || !game) return;
    const { hits } = fireArShot(game, basisRef.current, now(), { mode, rounds });
    if (hits.length) {
      playTargetHit();
      setHitMarker(true);
      if (hitMarkerTimer.current) clearTimeout(hitMarkerTimer.current);
      hitMarkerTimer.current = setTimeout(() => setHitMarker(false), 180);
    }
  }, []);

  // Mount: orientation sensor, gun routing, hardware back, best score.
  useEffect(() => {
    const unsubscribe = subscribeArOrientation(s => {
      sensorRef.current = { q: { x: s.x, y: s.y, z: s.z, w: s.w }, screenAngle: s.screenAngle };
    });
    setLocalShotHandler(onShot);
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      exit();
      return true;
    });
    AsyncStorage.getItem(BEST_KEY).then(v => {
      bestRef.current = Number(v) || 0;
      setBest(bestRef.current);
    });
    return () => {
      unsubscribe?.();
      setLocalShotHandler(null);
      back.remove();
      if (hitMarkerTimer.current) clearTimeout(hitMarkerTimer.current);
      const game = useGameStore.getState();
      game.setGunSlotId(null);
      game.resetGame();
    };
  }, [onShot, exit]);

  const finish = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    const r = arResults(game);
    const isNewBest = r.score > bestRef.current;
    if (isNewBest) {
      bestRef.current = r.score;
      setBest(r.score);
      AsyncStorage.setItem(BEST_KEY, String(r.score));
    }
    setNewBest(isNewBest);
    setResults(r);
    setFrame(EMPTY_FRAME);
    setPhaseBoth('results');
  }, []);

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = now();
      const sensor = sensorRef.current;
      const d = dragRef.current;
      const q = sensor?.q ?? quatFromDeviceOrientation(-d.yaw, 90 + d.pitch, 0);
      const basis = cameraBasis(q, sensor?.screenAngle ?? 0);
      basisRef.current = basis;

      if (phaseRef.current === 'countdown') {
        const left = Math.ceil((countdownEndsAtRef.current - t) / 1_000);
        if (left <= 0) {
          gameRef.current = createArGame({ nowMs: t });
          setPhaseBoth('playing');
        } else {
          setFrame(f => (f.countdownLeft === left ? f : { ...f, countdownLeft: left }));
        }
        return;
      }
      const game = gameRef.current;
      if (phaseRef.current !== 'playing' || !game) return;

      tickArGame(game, t, aimAzimuthDeg(basis));
      if (game.over) {
        finish();
        return;
      }

      const { width, height } = sizeRef.current;
      const viewport = { width, height, focalPx: focalLengthPx(width, height) };
      const edge = Math.min(width, height) / 2 - 36;
      const projected = game.targets.map(tg => ({
        id: tg.id,
        kind: tg.kind,
        expiring: tg.expiresAt - t < 1_000,
        ...projectPoint(basis, targetPosition(tg), viewport, tg.radiusM),
      }));
      setFrame({
        sprites: projected
          .filter(s => s.visible)
          .map(s => ({ ...s, size: Math.max(18, s.sizePx) })),
        indicators: projected
          .filter(s => !s.visible)
          .map(s => ({
            id: s.id,
            kind: s.kind,
            x: width / 2 + Math.cos(s.direction) * edge,
            y: height / 2 - Math.sin(s.direction) * edge,
            deg: (-s.direction * 180) / Math.PI,
          })),
        popups: game.popups
          .map(pp => ({
            id: pp.id,
            text: pp.text,
            age: (t - pp.at) / 900,
            ...projectPoint(basis, targetPosition(pp), viewport),
          }))
          .filter(pp => pp.visible),
        timeLeft: arSecondsLeft(game, t),
        score: game.score,
        streak: game.streak,
        countdownLeft: 0,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [finish]);

  // Fill the magazine and, with a gun connected, program it for practice. The
  // gun keeps its own ammo count; shots reach onShot via ble.ts. Practice always
  // has fast reload: ble.ts then refills the clip without the reload delay.
  function prepareGun() {
    const game = useGameStore.getState();
    game.setBulletsPerMag(AR_MAGAZINE_SIZE);
    game.setFastReloadActive(true);
    game.setMaxAmmo(AR_MAGAZINE_SIZE);
    game.setAmmo(AR_MAGAZINE_SIZE);
    game.setIsReloading(false);
    if (game.bleConnected) {
      game.setGunSlotId(0);
      applyGunAssignment(0).catch(() => {});
    }
  }

  async function start() {
    if (starting) return;
    setStarting(true);
    setCameraError('');
    if (!hasPermission && !(await requestPermission())) {
      setCameraError(
        'Could not open the camera. Targets will appear on a dark background instead.',
      );
    }
    prepareGun();
    countdownEndsAtRef.current = now() + AR_COUNTDOWN_SECS * 1_000;
    setFrame({ ...EMPTY_FRAME, countdownLeft: AR_COUNTDOWN_SECS });
    setResults(null);
    setPhaseBoth('countdown');
    setStarting(false);
  }

  // On-screen trigger, used when no gun is connected.
  function fireLocal() {
    const game = useGameStore.getState();
    if (game.bleConnected || game.isReloading || game.ammo <= 0) return;
    game.setAmmo(game.ammo - 1);
    onShot('semi', 1);
  }

  // Instant, like the gun's reload with fast reload always on.
  function reloadLocal() {
    const game = useGameStore.getState();
    if (game.bleConnected) return;
    playReload();
    game.setAmmo(AR_MAGAZINE_SIZE);
  }

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    sizeRef.current = { width, height };
  }

  const inRound = phase === 'countdown' || phase === 'playing';

  return (
    <View style={styles.container} onLayout={onLayout} {...panResponder.panHandlers}>
      {hasPermission && phase !== 'intro' && (
        <Camera style={StyleSheet.absoluteFill} device="back" isActive={phase !== 'results'} />
      )}

      {frame.sprites.map(s => (
        <Target key={s.id} s={s} />
      ))}

      {frame.indicators.map(ind => (
        <Text
          key={ind.id}
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              left: ind.x - 15,
              top: ind.y - 15,
              color: KIND_COLORS[ind.kind] ?? KIND_COLORS.standard,
              transform: [{ rotate: `${ind.deg}deg` }],
            },
          ]}>
          ➤
        </Text>
      ))}

      {frame.popups.map(pp => (
        <Text
          key={pp.id}
          pointerEvents="none"
          style={[styles.popup, { left: pp.x - 40, top: pp.y - 14 - pp.age * 40, opacity: 1 - pp.age }]}>
          {pp.text}
        </Text>
      ))}

      {inRound && (
        <>
          <View
            pointerEvents="none"
            style={[styles.crosshair, hitMarker && styles.crosshairHit]}>
            <View style={[styles.chH, hitMarker && styles.chHit]} />
            <View style={[styles.chV, hitMarker && styles.chHit]} />
            <View style={[styles.chDot, hitMarker && styles.chHit]} />
          </View>

          <View style={styles.hudTop}>
            <TouchableOpacity style={styles.btnExit} onPress={exit} accessibilityLabel="Exit">
              <Text style={styles.btnExitText}>✕</Text>
            </TouchableOpacity>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>SCORE</Text>
              <Text style={styles.statValue}>{frame.score}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>TIME</Text>
              <Text
                style={[
                  styles.statValue,
                  phase === 'playing' && frame.timeLeft <= 10 && styles.statLow,
                ]}>
                {phase === 'playing' ? frame.timeLeft : '–'}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>STREAK</Text>
              <Text style={styles.statValue}>{frame.streak > 1 ? `×${frame.streak}` : '–'}</Text>
            </View>
          </View>

          {phase === 'countdown' && (
            <Text pointerEvents="none" style={styles.countdown}>
              {frame.countdownLeft}
            </Text>
          )}

          <View style={styles.hudBottom}>
            <View style={styles.ammoCol}>
              <View style={styles.ammoBlock}>
                <Text style={styles.ammoIcon}>🔫</Text>
                <Text style={styles.ammoCount}>{isReloading ? 'RELOADING' : ammo}</Text>
                <Text style={styles.ammoMax}>/ {maxAmmo}</Text>
              </View>
              {fastReloadActive && <Text style={styles.fastReload}>🔋 FAST RELOAD</Text>}
              {bleConnected && (
                <Text style={styles.modeBadge}>{GUN_MODES[activeGunMode]?.label ?? ''}</Text>
              )}
            </View>
            {!bleConnected && (
              <View style={styles.controls}>
                <TouchableOpacity
                  style={[styles.btnReload, isReloading && styles.btnDisabled]}
                  onPress={reloadLocal}
                  disabled={isReloading}>
                  <Text style={styles.btnReloadText}>RELOAD</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnFire, (isReloading || ammo <= 0) && styles.btnDisabled]}
                  onPressIn={fireLocal}
                  disabled={isReloading || ammo <= 0}>
                  <Text style={styles.btnFireText}>FIRE</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </>
      )}

      {phase === 'intro' && (
        <ScrollView style={styles.panelWrap} contentContainerStyle={styles.panelWrapContent}>
          <View style={styles.panel}>
            <Text style={styles.h1}>AR TARGET PRACTICE</Text>
            <Text style={styles.sub}>SINGLE PLAYER · NO SERVER NEEDED</Text>
            <Text style={styles.body}>
              Look around through your camera. Targets appear in the space around you. Put
              the crosshair on them and pull the trigger. You have 60 seconds.
            </Text>
            <View style={styles.legend}>
              <LegendRow color={KIND_COLORS.standard} label="Target: 100 pts" />
              <LegendRow color={KIND_COLORS.mover} label="Moving target: 150 pts" />
              <LegendRow color={KIND_COLORS.bonus} label="Gold target: 300 pts, gone fast" />
            </View>
            <Text style={styles.small}>
              Hits in a row raise your streak bonus (up to double points). A missed shot or an
              escaped target resets it. A charged plasma shot hits every target in a wider cone.
              Reloads are instant.
            </Text>
            <Text style={[styles.small, bleConnected && styles.gunOk]}>
              {bleConnected
                ? '● Gun connected'
                : 'No gun connected: use the FIRE and RELOAD buttons.'}
            </Text>
            {best > 0 && <Text style={styles.best}>Best score: {best}</Text>}
            <TouchableOpacity
              style={[styles.btnPrimary, starting && styles.btnDisabled]}
              onPress={start}
              disabled={starting}>
              <Text style={styles.btnPrimaryText}>{starting ? 'Starting…' : 'Start'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSecondary} onPress={exit}>
              <Text style={styles.btnSecondaryText}>Back</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {phase === 'results' && results && (
        <ScrollView style={styles.panelWrap} contentContainerStyle={styles.panelWrapContent}>
          <View style={styles.panel}>
            <Text style={styles.h1}>{newBest ? 'NEW BEST SCORE!' : "TIME'S UP!"}</Text>
            <Text style={styles.bigScore}>{results.score}</Text>
            <ResultRow label="Targets hit" value={results.targetsHit} />
            <ResultRow label="Targets missed" value={results.targetsMissed} />
            <ResultRow label="Accuracy" value={`${results.accuracy}%`} />
            <ResultRow label="Best streak" value={results.bestStreak} />
            <ResultRow label="Best score" value={best} />
            <TouchableOpacity
              style={[styles.btnPrimary, starting && styles.btnDisabled]}
              onPress={start}
              disabled={starting}>
              <Text style={styles.btnPrimaryText}>Play again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSecondary} onPress={exit}>
              <Text style={styles.btnSecondaryText}>Exit</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {!!cameraError && phase !== 'results' && (
        <Text pointerEvents="none" style={styles.cameraError}>
          {cameraError}
        </Text>
      )}
    </View>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.body}>{label}</Text>
    </View>
  );
}

function ResultRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={styles.resultValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05060a', overflow: 'hidden' },

  target: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 6,
  },
  targetDim: { opacity: 0.35 },
  indicator: {
    position: 'absolute',
    width: 30,
    height: 30,
    fontSize: 26,
    lineHeight: 30,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 8,
  },
  popup: {
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    color: '#00e676',
    fontWeight: '900',
    fontSize: 22,
    textShadowColor: '#000',
    textShadowRadius: 6,
  },

  crosshair: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairHit: { transform: [{ scale: 1.25 }] },
  chH: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  chV: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  chDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.9)' },
  chHit: { backgroundColor: '#00e676' },

  hudTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  btnExit: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  btnExitText: { color: '#fff', fontSize: 16 },
  stat: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.7)' },
  statValue: { fontSize: 22, fontWeight: '900', color: '#fff', textShadowColor: '#000', textShadowRadius: 4 },
  statLow: { color: '#ff5252' },

  countdown: {
    position: 'absolute',
    top: '24%',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 96,
    fontWeight: '900',
    color: '#00e5ff',
    textShadowColor: 'rgba(0,229,255,0.6)',
    textShadowRadius: 24,
  },

  hudBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  ammoCol: { flex: 1 },
  ammoBlock: { flexDirection: 'row', alignItems: 'baseline' },
  ammoIcon: { fontSize: 18, marginRight: 6 },
  ammoCount: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  ammoMax: { color: '#888', fontSize: 14, marginLeft: 4 },
  fastReload: { color: '#69f0ae', fontSize: 11, fontWeight: '700', marginTop: 6 },
  modeBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#00e5ff',
    borderWidth: 1,
    borderColor: '#00e5ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  controls: { flexDirection: 'row', alignItems: 'flex-end' },
  btnFire: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#ff1744',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  btnFireText: { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
  btnReload: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnReloadText: { color: '#fff', fontWeight: '900', fontSize: 10, letterSpacing: 1 },
  btnDisabled: { opacity: 0.4 },

  panelWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  panelWrapContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#141418',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 24,
    gap: 12,
  },
  h1: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  sub: { color: '#00e5ff', fontSize: 12, letterSpacing: 1, marginTop: -8 },
  body: { color: '#f0f0f0', fontSize: 14, lineHeight: 21 },
  small: { color: '#888', fontSize: 12, lineHeight: 18 },
  gunOk: { color: '#00c853', fontWeight: '600' },
  legend: { gap: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  best: { color: '#ffd600', fontSize: 13, fontWeight: '700' },
  bigScore: { color: '#00e5ff', fontSize: 56, fontWeight: '900', textAlign: 'center' },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between' },
  resultLabel: { color: '#888', fontSize: 14 },
  resultValue: { color: '#fff', fontSize: 14, fontWeight: '700' },
  btnPrimary: { backgroundColor: '#00e5ff', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnPrimaryText: { color: '#000', fontWeight: '700', fontSize: 15, letterSpacing: 1 },
  btnSecondary: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#f0f0f0', fontWeight: '600', fontSize: 14 },

  cameraError: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 120,
    textAlign: 'center',
    fontSize: 12,
    color: '#ffcc80',
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
});
