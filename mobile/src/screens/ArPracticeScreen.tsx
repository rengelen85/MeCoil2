/**
 * Single-player AR practice (target practice or zombie survival) — mirrors
 * client/src/screens/ArPractice.svelte. Runs fully on the device: the rear
 * camera is the backdrop, the rotation sensor aims the crosshair, and
 * targets/zombies/scoring come from shared/arGame.js and shared/arZombies.js.
 * Nothing is sent to the server.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Image,
  ImageSourcePropType,
  LayoutChangeEvent,
  Vibration,
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
  AR_DEFAULT_DIFFICULTY,
  AR_DIFFICULTIES,
  AR_MAGAZINE_SIZE,
  AR_ROUND_OPTIONS_SECS,
  AR_ROUND_SECS,
  aimAzimuthDeg,
  arBestKey,
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
import {
  AR_ZOMBIE_DIFFICULTIES,
  createZombieGame,
  fireZombieShot,
  isFrozen,
  tickZombieGame,
  zombieBestKey,
  zombiePosition,
  zombieResults,
} from 'shared/arZombies.js';
import { RootStackParamList } from '../navigation/index.js';
import { useGameStore } from '../stores/game.js';
import {
  applyGunAssignment,
  connectBle,
  GUN_MODES,
  GunMode,
  setGunMode,
  setLocalShotHandler,
} from '../lib/ble.js';
import {
  playKilled,
  playPowerUp,
  playReload,
  playTargetHit,
  playZombieBite,
} from '../lib/audio.js';
import { subscribeArOrientation } from '../lib/arOrientation.js';

type Props = NativeStackScreenProps<RootStackParamList, 'ArPractice'>;
type Phase = 'intro' | 'countdown' | 'playing' | 'results';
type Mode = 'targets' | 'zombies';
type Quat = { x: number; y: number; z: number; w: number };
type Basis = ReturnType<typeof cameraBasis>;
type TargetGame = ReturnType<typeof createArGame>;
type ZombieGame = ReturnType<typeof createZombieGame>;
type Game =
  | { mode: 'targets'; state: TargetGame }
  | { mode: 'zombies'; state: ZombieGame };
type Results =
  | { mode: 'targets'; r: ReturnType<typeof arResults> }
  | { mode: 'zombies'; r: ReturnType<typeof zombieResults> };

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
interface ZombieSprite {
  id: number;
  src: ImageSourcePropType;
  flip: boolean;
  x: number;
  y: number;
  size: number;
  hp: number | null;
  near: boolean;
}
interface PowerUpSprite {
  id: number;
  kind: string;
  emoji: string;
  x: number;
  y: number;
  size: number;
  expiring: boolean;
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
  zombies: ZombieSprite[];
  powerUps: PowerUpSprite[];
  timeLeft: number;
  score: number;
  streak: number;
  wave: number;
  lives: number;
  banner: string;
  frozen: boolean;
  biteFlash: number;
  countdownLeft: number;
}

const BEST_KEY = 'mecoil_ar_best';
const ZOMBIE_BEST_KEY = 'mecoil_ar_zombie_best';
const KIND_COLORS: Record<string, string> = {
  standard: '#ff1744',
  mover: '#ff9100',
  bonus: '#ffd600',
  zombie: '#76ff03',
  near: '#ff1744',
  medkit: '#ff4081',
  bomb: '#ffab40',
  freeze: '#40c4ff',
};
// Painted sprites (scripts/gen-zombies.mjs): two shamble frames per kind. Metro
// needs static require paths, so they are listed out.
const ZOMBIE_FRAMES: Record<string, ImageSourcePropType> = {
  'walker-1': require('../assets/zombies/walker-1.png'),
  'walker-2': require('../assets/zombies/walker-2.png'),
  'runner-1': require('../assets/zombies/runner-1.png'),
  'runner-2': require('../assets/zombies/runner-2.png'),
  'brute-1': require('../assets/zombies/brute-1.png'),
  'brute-2': require('../assets/zombies/brute-2.png'),
};
const ZOMBIE_FRAME_MS = 380;
// The sprite is 2:3 and its figure fills about 90% of the height.
const ZOMBIE_ASPECT = 2 / 3;
const ZOMBIE_HEIGHT_SCALE = 1.1;
const POWERUP_EMOJI: Record<string, string> = { medkit: '❤️', bomb: '💣', freeze: '❄️' };
const BITE_FLASH_MS = 450;
const EMPTY_FRAME: Frame = {
  sprites: [],
  indicators: [],
  popups: [],
  zombies: [],
  powerUps: [],
  timeLeft: 0,
  score: 0,
  streak: 0,
  wave: 0,
  lives: 0,
  banner: '',
  frozen: false,
  biteFlash: 0,
  countdownLeft: AR_COUNTDOWN_SECS,
};

function bestKey(mode: Mode, secs: number, diff: string) {
  return mode === 'zombies'
    ? zombieBestKey(ZOMBIE_BEST_KEY, diff)
    : arBestKey(BEST_KEY, secs, diff);
}

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

// Zombie figure: sprite sized to the body's apparent height, with an HP bar for
// zombies that take more than one hit.
function Zombie({ z, frozen }: { z: ZombieSprite; frozen: boolean }) {
  const height = z.size * ZOMBIE_HEIGHT_SCALE;
  const width = height * ZOMBIE_ASPECT;
  return (
    <View
      pointerEvents="none"
      style={[styles.zombie, { left: z.x - width / 2, top: z.y - height / 2, width, height }]}>
      <View style={[styles.zombieGlow, frozen ? styles.zombieGlowFrozen : z.near && styles.zombieGlowNear]} />
      <Image
        source={z.src}
        resizeMode="contain"
        style={[styles.zombieImage, z.flip && { transform: [{ scaleX: -1 }] }, frozen && styles.zombieFrozen]}
      />
      {z.hp != null && (
        <View style={styles.hp}>
          <View style={[styles.hpFill, { width: `${z.hp * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

function PowerUp({ p }: { p: PowerUpSprite }) {
  const color = KIND_COLORS[p.kind] ?? '#fff';
  // Bob up and down; blink while about to vanish.
  const bob = Math.sin(now() / 160) * 3;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.powerUp,
        {
          left: p.x - p.size / 2,
          top: p.y - p.size / 2 + bob,
          width: p.size,
          height: p.size,
          borderRadius: p.size / 2,
          borderColor: color,
          shadowColor: color,
        },
        p.expiring && Math.floor(now() / 125) % 2 === 1 && styles.targetDim,
      ]}>
      <Text style={{ fontSize: p.size * 0.55 }}>{p.emoji}</Text>
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
  const [connectingGun, setConnectingGun] = useState(false);

  function connectGun() {
    setConnectingGun(true);
    connectBle()
      .catch(e => Alert.alert('BLE Error', e.message))
      .finally(() => setConnectingGun(false));
  }
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
  const roundSecsRef = useRef(AR_ROUND_SECS);
  const [roundSecs, setRoundSecs] = useState(AR_ROUND_SECS);
  const difficultyRef = useRef(AR_DEFAULT_DIFFICULTY);
  const [difficulty, setDifficulty] = useState(AR_DEFAULT_DIFFICULTY);
  const modeRef = useRef<Mode>('targets');
  const [mode, setMode] = useState<Mode>('targets');
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

  // Best scores are kept per mode and difficulty, and per round length for
  // target practice.
  const loadBest = useCallback((m: Mode, secs: number, diff: string) => {
    modeRef.current = m;
    roundSecsRef.current = secs;
    difficultyRef.current = diff;
    setMode(m);
    setRoundSecs(secs);
    setDifficulty(diff);
    AsyncStorage.getItem(bestKey(m, secs, diff)).then(v => {
      if (
        modeRef.current !== m ||
        roundSecsRef.current !== secs ||
        difficultyRef.current !== diff
      ) {
        return;
      }
      bestRef.current = Number(v) || 0;
      setBest(bestRef.current);
    });
  }, []);

  const exit = useCallback(() => {
    const game = useGameStore.getState();
    game.setScreen(game.arReturnScreen);
  }, []);

  const onShot = useCallback((gunMode: GunMode, rounds: number) => {
    const game = gameRef.current;
    if (phaseRef.current !== 'playing' || !game) return;
    const opts = { mode: gunMode, rounds };
    let hit: boolean;
    if (game.mode === 'zombies') {
      const shot = fireZombieShot(game.state, basisRef.current, now(), opts);
      hit = shot.hit;
      if (shot.powerUp) playPowerUp();
      else if (shot.kills.length) playTargetHit();
    } else {
      hit = fireArShot(game.state, basisRef.current, now(), opts).hits.length > 0;
      if (hit) playTargetHit();
    }
    if (hit) {
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
    loadBest('targets', AR_ROUND_SECS, AR_DEFAULT_DIFFICULTY);
    return () => {
      unsubscribe?.();
      setLocalShotHandler(null);
      back.remove();
      if (hitMarkerTimer.current) clearTimeout(hitMarkerTimer.current);
      const game = useGameStore.getState();
      game.setGunSlotId(null);
      game.resetGame();
    };
  }, [onShot, exit, loadBest]);

  const finish = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    const res: Results =
      game.mode === 'zombies'
        ? { mode: 'zombies', r: zombieResults(game.state) }
        : { mode: 'targets', r: arResults(game.state) };
    const score = res.r.score;
    const isNewBest = score > bestRef.current;
    if (isNewBest) {
      bestRef.current = score;
      setBest(score);
      AsyncStorage.setItem(
        bestKey(game.mode, roundSecsRef.current, difficultyRef.current),
        String(score),
      );
    }
    setNewBest(isNewBest);
    setResults(res);
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
          gameRef.current =
            modeRef.current === 'zombies'
              ? {
                  mode: 'zombies',
                  state: createZombieGame({ nowMs: t, difficulty: difficultyRef.current }),
                }
              : {
                  mode: 'targets',
                  state: createArGame({
                    nowMs: t,
                    durationSecs: roundSecsRef.current,
                    difficulty: difficultyRef.current,
                  }),
                };
          setPhaseBoth('playing');
        } else {
          setFrame(f => (f.countdownLeft === left ? f : { ...f, countdownLeft: left }));
        }
        return;
      }
      const current = gameRef.current;
      if (phaseRef.current !== 'playing' || !current) return;

      const { width, height } = sizeRef.current;
      const viewport = { width, height, focalPx: focalLengthPx(width, height) };
      const edge = Math.min(width, height) / 2 - 36;
      // Off-screen marker at the screen edge for a projected point.
      const edgeMarker = (id: number, kind: string, s: { direction: number }): Indicator => ({
        id,
        kind,
        x: width / 2 + Math.cos(s.direction) * edge,
        y: height / 2 - Math.sin(s.direction) * edge,
        deg: (-s.direction * 180) / Math.PI,
      });

      if (current.mode === 'zombies') {
        const zg = current.state;
        const { bites } = tickZombieGame(zg, t, aimAzimuthDeg(basis));
        if (bites) {
          playZombieBite();
          try {
            Vibration.vibrate(200);
          } catch {
            // haptics are optional; never let them take the game down
          }
        }
        if (zg.over) {
          playKilled();
          finish();
          return;
        }
        const indicators: Indicator[] = [];
        const zombies: ZombieSprite[] = [];
        // Draw far zombies first so near ones overlap them.
        for (const z of [...zg.zombies].sort((a, b) => b.distanceM - a.distanceM)) {
          const s = projectPoint(basis, zombiePosition(z), viewport, z.heightM / 2);
          const near = z.distanceM < 4;
          if (s.visible) {
            zombies.push({
              id: z.id,
              // Frozen zombies hold their pose; the rest alternate frames, out of step.
              src: ZOMBIE_FRAMES[`${z.kind}-${isFrozen(zg, t) ? 1 : ((Math.floor(t / ZOMBIE_FRAME_MS) + z.id) % 2) + 1}`],
              flip: z.id % 2 === 1,
              x: s.x,
              y: s.y,
              size: Math.max(16, s.sizePx),
              hp: z.maxHp > 1 ? z.hp / z.maxHp : null,
              near,
            });
          } else {
            indicators.push(edgeMarker(z.id, near ? 'near' : 'zombie', s));
          }
        }
        const powerUps: PowerUpSprite[] = [];
        for (const p of zg.powerUps) {
          const s = projectPoint(basis, targetPosition(p), viewport, p.radiusM);
          if (s.visible) {
            powerUps.push({
              id: p.id,
              kind: p.kind,
              emoji: POWERUP_EMOJI[p.kind],
              x: s.x,
              y: s.y,
              size: Math.max(28, s.sizePx),
              expiring: p.expiresAt - t < 1_500,
            });
          } else {
            indicators.push(edgeMarker(p.id, p.kind, s));
          }
        }
        setFrame({
          ...EMPTY_FRAME,
          zombies,
          powerUps,
          indicators,
          popups: zg.popups
            .map(pp => ({
              id: pp.id,
              text: pp.text,
              age: (t - pp.at) / 900,
              ...projectPoint(basis, targetPosition(pp), viewport),
            }))
            .filter(pp => pp.visible),
          score: zg.score,
          wave: zg.wave,
          lives: zg.lives,
          banner: zg.banner ? zg.banner.text : '',
          frozen: isFrozen(zg, t),
          biteFlash: Math.max(0, 1 - (t - zg.lastBiteAt) / BITE_FLASH_MS),
          countdownLeft: 0,
        });
        return;
      }

      const game = current.state;
      tickArGame(game, t, aimAzimuthDeg(basis));
      if (game.over) {
        finish();
        return;
      }

      const projected = game.targets.map(tg => ({
        id: tg.id,
        kind: tg.kind,
        expiring: tg.expiresAt - t < 1_000,
        ...projectPoint(basis, targetPosition(tg), viewport, tg.radiusM),
      }));
      setFrame({
        ...EMPTY_FRAME,
        sprites: projected
          .filter(s => s.visible)
          .map(s => ({ ...s, size: Math.max(18, s.sizePx) })),
        indicators: projected.filter(s => !s.visible).map(s => edgeMarker(s.id, s.kind, s)),
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
      // Practice starts in semi; applyGunAssignment resets the gun to auto.
      applyGunAssignment(0)
        .then(() => setGunMode('semi'))
        .catch(() => {});
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

      {frame.zombies.map(z => (
        <Zombie key={z.id} z={z} frozen={frame.frozen} />
      ))}

      {frame.powerUps.map(p => (
        <PowerUp key={p.id} p={p} />
      ))}

      {frame.frozen && <View pointerEvents="none" style={styles.freezeTint} />}
      {frame.biteFlash > 0 && (
        <View pointerEvents="none" style={[styles.biteFlash, { opacity: frame.biteFlash }]} />
      )}

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
            ind.kind === 'near' && styles.indicatorNear,
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
            {mode === 'zombies' ? (
              <>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>WAVE</Text>
                  <Text style={styles.statValue}>
                    {phase === 'playing' && frame.wave ? frame.wave : '–'}
                  </Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>LIVES</Text>
                  <Text style={[styles.statValue, styles.statLives]}>
                    {phase === 'playing' ? '❤'.repeat(frame.lives) || '–' : '–'}
                  </Text>
                </View>
              </>
            ) : (
              <>
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
                  <Text style={styles.statValue}>
                    {frame.streak > 1 ? `×${frame.streak}` : '–'}
                  </Text>
                </View>
              </>
            )}
          </View>

          {phase === 'countdown' && (
            <Text pointerEvents="none" style={styles.countdown}>
              {frame.countdownLeft}
            </Text>
          )}
          {!!frame.banner && (
            <Text pointerEvents="none" style={styles.banner}>
              {frame.banner.toUpperCase()}
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
            <Text style={styles.h1}>
              {mode === 'zombies' ? 'AR ZOMBIE SURVIVAL' : 'AR TARGET PRACTICE'}
            </Text>
            <Text style={styles.sub}>SINGLE PLAYER · NO SERVER NEEDED</Text>
            <View style={styles.roundPicker}>
              {(
                [
                  ['targets', '🎯 Targets'],
                  ['zombies', '🧟 Zombies'],
                ] as const
              ).map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.roundOpt, mode === key && styles.roundOptSelected]}
                  onPress={() => loadBest(key, roundSecs, difficulty)}>
                  <Text style={[styles.roundOptText, mode === key && styles.roundOptTextSelected]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {mode === 'zombies' ? (
              <Text style={styles.body}>
                Waves of zombies close in on you from all sides. Shoot them before they get
                close enough to bite. Each bite costs a life. Every wave brings more, faster
                zombies. Pick the difficulty.
              </Text>
            ) : (
              <>
                <Text style={styles.body}>
                  Look around through your camera. Targets appear in the space around you. Put
                  the crosshair on them and pull the trigger. Pick the round length and
                  difficulty.
                </Text>
                <View style={styles.roundPicker}>
                  {AR_ROUND_OPTIONS_SECS.map(secs => (
                    <TouchableOpacity
                      key={secs}
                      style={[styles.roundOpt, roundSecs === secs && styles.roundOptSelected]}
                      onPress={() => loadBest(mode, secs, difficulty)}>
                      <Text
                        style={[
                          styles.roundOptText,
                          roundSecs === secs && styles.roundOptTextSelected,
                        ]}>
                        {secs}s
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            <View style={styles.roundPicker}>
              {Object.entries(mode === 'zombies' ? AR_ZOMBIE_DIFFICULTIES : AR_DIFFICULTIES).map(([key, cfg]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.roundOpt, difficulty === key && styles.roundOptSelected]}
                  onPress={() => loadBest(mode, roundSecs, key)}>
                  <Text
                    style={[styles.roundOptText, difficulty === key && styles.roundOptTextSelected]}>
                    {cfg.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {mode === 'zombies' ? (
              <>
                <View style={styles.legend}>
                  <IconRow icon={ZOMBIE_FRAMES['walker-1']} label="Walker: 100 pts" />
                  <IconRow icon={ZOMBIE_FRAMES['runner-1']} label="Runner: 150 pts, fast (from wave 2)" />
                  <IconRow icon={ZOMBIE_FRAMES['brute-1']} label="Brute: 400 pts, takes 4 hits (from wave 3)" />
                  <IconRow icon="❤️" label="Medkit: +1 life" />
                  <IconRow icon="💣" label="Bomb: wipes out every zombie" />
                  <IconRow icon="❄️" label="Freeze: zombies stop for 5 s" />
                </View>
                <Text style={styles.small}>
                  Shoot a floating power-up to collect it. Headshots do double damage and score
                  +50%. Hits in a row raise your streak bonus (up to double points). Clearing a
                  wave earns a bonus. A charged plasma shot hits every zombie in a wider cone.
                  Reloads are instant.
                </Text>
              </>
            ) : (
              <>
                <View style={styles.legend}>
                  <LegendRow color={KIND_COLORS.standard} label="Target: 100 pts" />
                  <LegendRow color={KIND_COLORS.mover} label="Moving target: 150 pts" />
                  <LegendRow color={KIND_COLORS.bonus} label="Gold target: 300 pts, gone fast" />
                </View>
                <Text style={styles.small}>
                  Hits in a row raise your streak bonus (up to double points). A missed shot or
                  an escaped target resets it. A charged plasma shot hits every target in a wider
                  cone. Reloads are instant.
                </Text>
              </>
            )}
            <Text style={[styles.small, bleConnected && styles.gunOk]}>
              {bleConnected
                ? '● Gun connected'
                : 'No gun connected: use the FIRE and RELOAD buttons.'}
            </Text>
            {!bleConnected && (
              <TouchableOpacity
                style={[styles.btnSecondary, connectingGun && styles.btnDisabled]}
                onPress={connectGun}
                disabled={connectingGun}>
                <Text style={styles.btnSecondaryText}>
                  {connectingGun ? 'Connecting gun…' : '🔫 Connect gun'}
                </Text>
              </TouchableOpacity>
            )}
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
            <Text style={styles.h1}>
              {newBest
                ? 'NEW BEST SCORE!'
                : results.mode === 'zombies'
                  ? 'YOU GOT EATEN!'
                  : "TIME'S UP!"}
            </Text>
            <Text style={styles.bigScore}>{results.r.score}</Text>
            {results.mode === 'zombies' ? (
              <>
                <ResultRow label="Wave reached" value={results.r.wave} />
                <ResultRow label="Zombies killed" value={results.r.kills} />
                <ResultRow label="Headshots" value={results.r.headshots} />
                <ResultRow label="Power-ups" value={results.r.powerUps} />
              </>
            ) : (
              <>
                <ResultRow label="Targets hit" value={results.r.targetsHit} />
                <ResultRow label="Targets missed" value={results.r.targetsMissed} />
              </>
            )}
            <ResultRow label="Accuracy" value={`${results.r.accuracy}%`} />
            <ResultRow label="Best streak" value={results.r.bestStreak} />
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

function IconRow({ icon, label }: { icon: string | ImageSourcePropType; label: string }) {
  return (
    <View style={styles.legendRow}>
      {typeof icon === 'string' ? (
        <Text style={styles.legendIcon}>{icon}</Text>
      ) : (
        <Image source={icon} resizeMode="contain" style={styles.legendImage} />
      )}
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
  zombie: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  zombieImage: { width: '100%', height: '100%' },
  // Near zombies get a red glow behind them, frozen ones a blue one.
  zombieGlow: {
    position: 'absolute',
    left: '5%',
    right: '5%',
    top: '5%',
    bottom: '2%',
    borderRadius: 999,
    backgroundColor: 'rgba(118,255,3,0.10)',
  },
  zombieGlowNear: { backgroundColor: 'rgba(255,23,68,0.28)' },
  zombieGlowFrozen: { backgroundColor: 'rgba(64,196,255,0.30)' },
  zombieFrozen: { opacity: 0.8 },
  hp: {
    position: 'absolute',
    left: '15%',
    right: '15%',
    top: -6,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    overflow: 'hidden',
  },
  hpFill: { height: '100%', backgroundColor: '#ff1744' },
  powerUp: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    elevation: 8,
  },
  freezeTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(64,196,255,0.18)',
    borderWidth: 24,
    borderColor: 'rgba(64,196,255,0.35)',
  },
  biteFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,23,68,0.3)',
    borderWidth: 36,
    borderColor: 'rgba(255,23,68,0.6)',
  },
  banner: {
    position: 'absolute',
    top: '22%',
    left: 16,
    right: 16,
    textAlign: 'center',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#76ff03',
    textShadowColor: '#000',
    textShadowRadius: 12,
  },
  indicatorNear: { fontSize: 34 },
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
  statLives: { color: '#ff1744', fontSize: 18, letterSpacing: 1 },

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
  legendIcon: { width: 18, fontSize: 14, textAlign: 'center' },
  legendImage: { width: 20, height: 30 },
  roundPicker: { flexDirection: 'row', gap: 6 },
  roundOpt: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  roundOptSelected: { backgroundColor: '#00e5ff', borderColor: '#00e5ff' },
  roundOptText: { color: '#f0f0f0', fontWeight: '600', fontSize: 13 },
  roundOptTextSelected: { color: '#000' },
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
