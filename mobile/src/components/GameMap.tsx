import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import {
  Map as MapView,
  Camera,
  Marker,
  type PressEvent,
} from '@maplibre/maplibre-react-native';
import { NativeSyntheticEvent } from 'react-native';
import { useMapStore } from '../stores/map.js';
import { useGameStore } from '../stores/game.js';
import { AIRSTRIKE_RADIUS_M, APACHE_RADIUS_M } from 'shared/messages.js';
import { sendCollect } from '../lib/network.js';
import {
  MAP_STYLES,
  MAP_STYLE_CYCLE,
  MAP_STYLE_ICON,
  type MapStyleId,
} from '../lib/mapStyle.js';
import { loadMapStyle, saveMapStyle } from '../stores/game.js';
import { MeterCircle, ShapePolygon } from './MapShapes.js';
import { haversineMeters } from '../lib/geo.js';

// Tap tolerance for collecting a power-up. MapLibre's Marker (MarkerView) does
// not forward touch events to its children on Android, so taps are hit-tested
// against power-up positions via the MapView's own onPress instead.
const POWERUP_TAP_RADIUS_M = 25;

const POWERUP_EMOJI: Record<string, string> = {
  fastReload: '🔋',
  healthPack: '🩹',
  shield: '🛡️',
  stealth: '👻',
  radar: '📡',
  airstrike: '🚀',
  apacheSupport: '🚁',
  immunity: '💉',
};

// CTF/Domination overlay tuning — mirrors the web client (Map.svelte).
const TEAM_COLORS: Record<string, string> = { red: '#ff5252', blue: '#448aff' };
const DOM_ZONE_COLORS: Record<string, string> = {
  red: '#ff5252',
  blue: '#448aff',
  neutral: '#9e9e9e',
};
const CTF_BASE_RADIUS_M = 7.5;
const DOM_ZONE_RADIUS_M = 7.5;
const GAME_AREA_COLOR = '#ff9800';

// Heading cone on the player marker — a wide "field-of-view" wedge that always
// points screen-forward (web parity, but wider with a fade-out). RN core has no
// gradient primitive, so the fade is faked by stacking translucent triangles
// that all share the apex at the player: many overlap near the apex (opaque),
// fewer toward the tip (transparent). All sizes are in px.
const CONE_LEN = 36;
const CONE_HALF_ANGLE = (34 * Math.PI) / 180; // half the cone's spread
const CONE_TAN = Math.tan(CONE_HALF_ANGLE);
const CONE_WIDTH = 2 * CONE_LEN * CONE_TAN; // base width at the far edge
const CONE_LAYERS_N = 10; // more layers = smoother fade
const CONE_LAYER_ALPHA = 0.07; // per-layer opacity; ~0.5 where all 10 overlap
const CONE_COLOR = '0,229,255'; // cyan, matches the web client
// Pre-compute each nested triangle (apex pinned at the cone container's
// bottom-centre, growing taller/wider toward the base).
const CONE_LAYERS = Array.from({ length: CONE_LAYERS_N }, (_, idx) => {
  const h = (CONE_LEN * (idx + 1)) / CONE_LAYERS_N;
  const halfBase = h * CONE_TAN;
  return {
    key: idx,
    halfBase,
    h,
    left: CONE_WIDTH / 2 - halfBase,
    top: CONE_LEN - h,
  };
});

export default function GameMap() {
  // Heading-up rotation mirrors the web client (Map.svelte) exactly: the
  // MapLibre camera stays north-up and we spin the ENTIRE map view with a
  // GPU-composited transform. Rotating the native camera bearing instead
  // forces MapLibre to re-render every tile/label/marker each frame AND
  // restarts a fresh animation on every compass tick — that is what made the
  // old implementation lag and stutter. A view transform is essentially free.
  //
  // `heading` is intentionally NOT read into render (it fires many times a
  // second). We drive an Animated.Value imperatively from a store
  // subscription, with useNativeDriver so the rotation never touches the JS
  // thread — the RN equivalent of the web's cheap CSS `transform: rotate()`.
  const {
    myPosition, teammates, firingEnemies, powerups, airstrikes, apaches, graves,
    ctfBases, ctfFlags, domZones,
  } = useMapStore();
  const {
    airstrikeArmed, airstrikePreview, setAirstrikeArmed, setAirstrikePreview,
    apacheArmed, apachePreview, setApacheArmed, setApachePreview,
    gameArea,
  } = useGameStore();

  // The map view is rotated by -heading so the player's forward direction is
  // always at screen top. accRotation is in degrees; the interpolation flips
  // the sign and extends past ±360 to absorb the accumulated value.
  const rotation = useRef(new Animated.Value(0)).current;
  const rotateDeg = rotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['360deg', '-360deg'],
    extrapolate: 'extend',
  });
  // The heading cone counter-rotates (+heading) to cancel the rotor's -heading,
  // so it always points to screen-top regardless of which way the player faces.
  const coneRotateDeg = rotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg'],
    extrapolate: 'extend',
  });
  // Accumulated rotation avoids the wrap-around jump when heading crosses
  // 0°/360°, so the view always takes the shortest path (same as web).
  const accRotationRef = useRef(0);
  const prevHeadingRef = useRef<number | null>(null);

  // Square big enough that rotating it 360° around screen centre never exposes
  // a blank corner. The minimum is the screen diagonal (matches the intent of
  // the web client's oversized calc(100vw + 100vh) .map-container).
  const { width: winW, height: winH } = useWindowDimensions();
  const mapSide = Math.ceil(Math.hypot(winW, winH));

  // Map tile style — cycles dark → voyager → light → standard, mirroring the
  // web client's toggle. The choice persists across games via AsyncStorage.
  const [mapStyleId, setMapStyleId] = useState<MapStyleId>('dark');
  useEffect(() => {
    loadMapStyle().then(saved => {
      if (saved && (MAP_STYLE_CYCLE as string[]).includes(saved)) {
        setMapStyleId(saved as MapStyleId);
      }
    });
  }, []);

  function cycleMapStyle() {
    setMapStyleId(prev => {
      const next =
        MAP_STYLE_CYCLE[
          (MAP_STYLE_CYCLE.indexOf(prev) + 1) % MAP_STYLE_CYCLE.length
        ];
      saveMapStyle(next);
      return next;
    });
  }

  useEffect(() => {
    const applyHeading = (h: number | null) => {
      if (h === null) {
        prevHeadingRef.current = null;
        return;
      }
      if (prevHeadingRef.current === null) {
        accRotationRef.current = h;
      } else {
        let delta = h - prevHeadingRef.current;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        accRotationRef.current += delta;
      }
      prevHeadingRef.current = h;
      // A short linear ease (native-driven) blends successive sensor readings
      // without the lag of a long animation. Restarting it each tick is cheap
      // because it only retargets a view transform — no GL re-render.
      Animated.timing(rotation, {
        toValue: accRotationRef.current,
        duration: 120,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    };

    applyHeading(useMapStore.getState().heading);
    const unsub = useMapStore.subscribe((state, prev) => {
      if (state.heading !== prev.heading) applyHeading(state.heading);
    });
    return unsub;
  }, [rotation]);

  function onMapPress(e: NativeSyntheticEvent<PressEvent>) {
    const [longitude, latitude] = e.nativeEvent.lngLat;
    if (apacheArmed || apachePreview) {
      setApachePreview({ lat: latitude, lng: longitude });
      if (apacheArmed) setApacheArmed(false);
    } else if (airstrikeArmed || airstrikePreview) {
      setAirstrikePreview({ lat: latitude, lng: longitude });
      if (airstrikeArmed) setAirstrikeArmed(false);
    } else {
      // Collect the nearest power-up within tap tolerance (MarkerView children
      // don't receive touches on Android, so we hit-test the map tap itself).
      let nearest: { id: number; dist: number } | null = null;
      for (const p of powerups) {
        const dist = haversineMeters(latitude, longitude, p.lat, p.lng);
        if (dist <= POWERUP_TAP_RADIUS_M && (!nearest || dist < nearest.dist)) {
          nearest = { id: p.id, dist };
        }
      }
      if (nearest) sendCollect(nearest.id);
    }
  }

  if (!myPosition) {
    return (
      <View style={styles.noGps}>
        <Text style={styles.noGpsText}>Acquiring GPS…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
    {/* Clipping frame fills the screen; the oversized rotor is centred inside
        it and spun by -heading. overflow:hidden hides the rotated corners. */}
    <View style={styles.clip}>
    <Animated.View
      style={[
        styles.rotor,
        {
          width: mapSide,
          height: mapSide,
          marginLeft: -mapSide / 2,
          marginTop: -mapSide / 2,
          transform: [{ rotate: rotateDeg }],
        },
      ]}>
    <MapView
      style={styles.map}
      mapStyle={MAP_STYLES[mapStyleId]}
      onPress={onMapPress}
      // Render into a TextureView (not the default GLSurfaceView) so the parent
      // rotor's rotation transform actually rotates the rendered map — a
      // SurfaceView is composited in its own layer and ignores view transforms.
      androidView="texture"
      // Heading-up, fixed-zoom tactical view: the player drives the camera via
      // GPS + compass, not gestures.
      dragPan={false}
      touchZoom={false}
      doubleTapZoom={false}
      doubleTapHoldZoom={false}
      touchRotate={false}
      touchPitch={false}
      attribution={false}
      logo={false}
      compass={false}
      scaleBar={false}>
      {/* Camera stays north-up (no bearing) — heading-up is achieved by
          rotating the view above, not the GL camera. */}
      <Camera
        center={[myPosition.lng, myPosition.lat]}
        zoom={19}
        pitch={0}
        duration={250}
      />

      {/* Play-area boundary (circle or polygon) — dashed orange outline */}
      {gameArea?.type === 'circle' && (
        <MeterCircle
          id="game-area"
          lat={gameArea.lat}
          lng={gameArea.lng}
          radiusM={gameArea.radiusM}
          color={GAME_AREA_COLOR}
          fillOpacity={0.06}
          dashed
        />
      )}
      {gameArea?.type === 'polygon' && gameArea.points.length >= 3 && (
        <ShapePolygon id="game-area" points={gameArea.points} color={GAME_AREA_COLOR} fillOpacity={0.06} />
      )}

      {/* CTF: team base circles */}
      {(['red', 'blue'] as const).map(team => {
        const base = ctfBases[team];
        if (!base) return null;
        return (
          <MeterCircle
            key={`ctf-base-${team}`}
            id={`ctf-base-${team}`}
            lat={base.lat}
            lng={base.lng}
            radiusM={CTF_BASE_RADIUS_M}
            color={TEAM_COLORS[team]}
            fillOpacity={0.15}
          />
        );
      })}

      {/* CTF: flag markers (at base, carried, or dropped) */}
      {(['red', 'blue'] as const).map(team => {
        const flag = ctfFlags[team];
        if (!flag || flag.lat == null || flag.lng == null) return null;
        const icon = flag.state === 'carried' ? '🏃' : '🚩';
        return (
          <Marker key={`ctf-flag-${team}`} id={`ctf-flag-${team}`} lngLat={[flag.lng, flag.lat]} anchor="center">
            <Text style={[styles.flagIcon, { color: TEAM_COLORS[team] }, flag.state === 'dropped' && styles.flagDropped]}>
              {icon}
            </Text>
          </Marker>
        );
      })}

      {/* Domination: control-zone circles + labels (letter, capture %, contested) */}
      {domZones.map(zone => {
        if (zone.lat == null || zone.lng == null) return null;
        const color = DOM_ZONE_COLORS[zone.owner] ?? DOM_ZONE_COLORS.neutral;
        const progress = Math.round(Math.abs(zone.controlValue ?? 0) * 100);
        const capColor = zone.capturingTeam ? DOM_ZONE_COLORS[zone.capturingTeam] : color;
        return (
          <React.Fragment key={`dom-${zone.id}`}>
            <MeterCircle
              id={`dom-${zone.id}`}
              lat={zone.lat}
              lng={zone.lng}
              radiusM={DOM_ZONE_RADIUS_M}
              color={color}
              fillOpacity={0.12}
            />
            <Marker id={`dom-${zone.id}-label`} lngLat={[zone.lng, zone.lat]} anchor="center">
              <View style={[styles.domZone, { borderColor: color }]}>
                <Text style={[styles.domZoneLetter, { color }]}>{zone.id}</Text>
                {progress > 0 && progress < 100 && (
                  <View style={styles.domZoneBar}>
                    <View style={[styles.domZoneFill, { width: `${progress}%`, backgroundColor: capColor }]} />
                  </View>
                )}
                {zone.contested && <Text style={styles.domZoneContested}>⚡</Text>}
              </View>
            </Marker>
          </React.Fragment>
        );
      })}

      {/* My position — dot + a wide heading cone that always points forward.
          pointerEvents none so the oversized cone never eats map taps. */}
      <Marker id="me" lngLat={[myPosition.lng, myPosition.lat]} anchor="center">
        <Animated.View
          pointerEvents="none"
          style={[styles.meWrap, { transform: [{ rotate: coneRotateDeg }] }]}>
          <View style={styles.cone}>
            {CONE_LAYERS.map(l => (
              <View
                key={l.key}
                style={{
                  position: 'absolute',
                  left: l.left,
                  top: l.top,
                  width: 0,
                  height: 0,
                  borderLeftWidth: l.halfBase,
                  borderRightWidth: l.halfBase,
                  borderTopWidth: l.h,
                  borderLeftColor: 'transparent',
                  borderRightColor: 'transparent',
                  borderTopColor: `rgba(${CONE_COLOR},${CONE_LAYER_ALPHA})`,
                }}
              />
            ))}
          </View>
          <View style={styles.myDot} />
        </Animated.View>
      </Marker>

      {/* Teammates (green) */}
      {teammates.map(t => (
        <Marker key={`tm-${t.id}`} id={`tm-${t.id}`} lngLat={[t.lng, t.lat]} anchor="center">
          <View style={styles.teammateDot} />
        </Marker>
      ))}

      {/* Firing enemies (red, only briefly visible after they fire) */}
      {firingEnemies.map(e => (
        <Marker key={`fe-${e.id}`} id={`fe-${e.id}`} lngLat={[e.lng, e.lat]} anchor="center">
          <View style={styles.enemyDot} />
        </Marker>
      ))}

      {/* Power-ups — tap the map near one to collect it (see onMapPress; the
          marker is display-only because MarkerView children don't get touches). */}
      {powerups.map(p => (
        <Marker key={`pu-${p.id}`} id={`pu-${p.id}`} lngLat={[p.lng, p.lat]} anchor="center">
          <View style={styles.powerupDot} pointerEvents="none">
            <Text style={styles.powerupEmoji}>{POWERUP_EMOJI[p.type] ?? '📦'}</Text>
          </View>
        </Marker>
      ))}

      {/* Tombstones at each player's last death spot, name beside the marker */}
      {graves.map(g => (
        <Marker key={`gr-${g.id}`} id={`gr-${g.id}`} lngLat={[g.lng, g.lat]} anchor="bottom">
          <View style={styles.grave}>
            <Text style={styles.graveIcon}>🪦</Text>
            <Text style={styles.graveName}>{g.username}</Text>
          </View>
        </Marker>
      ))}

      {/* Pending-confirmation airstrike preview (orange, before Confirm is pressed) */}
      {airstrikePreview && (
        <React.Fragment>
          <MeterCircle
            id="airstrike-preview"
            lat={airstrikePreview.lat}
            lng={airstrikePreview.lng}
            radiusM={AIRSTRIKE_RADIUS_M}
            color="#ff9800"
            fillOpacity={0.18}
            dashed
          />
          <Marker id="airstrike-preview-target" lngLat={[airstrikePreview.lng, airstrikePreview.lat]} anchor="center">
            <Text style={styles.bigEmoji}>🎯</Text>
          </Marker>
        </React.Fragment>
      )}

      {/* Inbound airstrikes: blast zone + target marker */}
      {airstrikes.map(a => (
        <React.Fragment key={`as-${a.id}`}>
          <MeterCircle id={`as-${a.id}`} lat={a.lat} lng={a.lng} radiusM={a.radius} color="#ff1744" fillOpacity={0.2} />
          <Marker id={`as-${a.id}-t`} lngLat={[a.lng, a.lat]} anchor="center">
            <Text style={styles.bigEmoji}>💥</Text>
          </Marker>
        </React.Fragment>
      ))}

      {/* Pending-confirmation apache preview (dashed green, before Confirm is pressed) */}
      {apachePreview && (
        <React.Fragment>
          <MeterCircle
            id="apache-preview"
            lat={apachePreview.lat}
            lng={apachePreview.lng}
            radiusM={APACHE_RADIUS_M}
            color="#69f0ae"
            fillOpacity={0.12}
            dashed
          />
          <Marker id="apache-preview-marker" lngLat={[apachePreview.lng, apachePreview.lat]} anchor="center">
            <Text style={styles.apachePreviewMarker}>🚁</Text>
          </Marker>
        </React.Fragment>
      )}

      {/* Active apache support zones (solid green) */}
      {apaches.map(a => (
        <React.Fragment key={`ap-${a.id}`}>
          <MeterCircle id={`ap-${a.id}`} lat={a.lat} lng={a.lng} radiusM={a.radius} color="#00c853" fillOpacity={0.18} />
          <Marker id={`ap-${a.id}-m`} lngLat={[a.lng, a.lat]} anchor="center">
            <Text style={styles.bigEmoji}>🚁</Text>
          </Marker>
        </React.Fragment>
      ))}
    </MapView>
    </Animated.View>
    </View>

      {/* Map tile style toggle — tap to cycle through basemaps (web parity) */}
      <TouchableOpacity
        style={styles.styleToggle}
        onPress={cycleMapStyle}
        activeOpacity={0.7}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.styleToggleIcon}>{MAP_STYLE_ICON[mapStyleId]}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // Fills the screen and clips the rotated rotor's overhanging corners.
  clip: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  // Oversized square centred on the screen; rotated by -heading. Its width/
  // height/margins are set inline from the measured screen diagonal.
  rotor: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  styleToggle: {
    position: 'absolute',
    // Bottom-centre — sits in the empty gap between the ammo block (bottom-left)
    // and the health/stats panel (bottom-right), clear of the status bar and the
    // Stop/Scores buttons up top. marginLeft offsets half the width to centre it.
    bottom: 36,
    left: '50%',
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(13,13,15,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleToggleIcon: {
    fontSize: 20,
    lineHeight: 24,
  },
  noGps: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noGpsText: {
    color: '#666',
    fontSize: 16,
  },
  // Square wrapper centred on the player so anchor="center" keeps the dot on
  // the exact GPS point; the cone fills the top half, apex at the centre.
  meWrap: {
    width: CONE_WIDTH,
    height: 2 * CONE_LEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cone: {
    position: 'absolute',
    top: 0,
    width: CONE_WIDTH,
    height: CONE_LEN,
  },
  myDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#00e5ff',
  },
  teammateDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#5cb85c',
    borderWidth: 2,
    borderColor: '#000',
  },
  enemyDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#e63946',
    borderWidth: 2,
    borderColor: '#000',
  },
  powerupDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 2,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerupEmoji: {
    fontSize: 14,
  },
  bigEmoji: {
    fontSize: 24,
  },
  grave: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  graveIcon: {
    fontSize: 20,
  },
  graveName: {
    marginLeft: 3,
    fontSize: 11,
    fontWeight: '700',
    color: '#e0e0e0',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  apachePreviewMarker: {
    fontSize: 22,
    opacity: 0.7,
  },
  flagIcon: {
    fontSize: 22,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  flagDropped: {
    opacity: 0.85,
  },
  domZone: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  domZoneLetter: {
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 16,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  domZoneBar: {
    width: 26,
    height: 3,
    marginTop: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  domZoneFill: {
    height: '100%',
    borderRadius: 2,
  },
  domZoneContested: {
    position: 'absolute',
    top: -6,
    right: -6,
    fontSize: 12,
  },
});
