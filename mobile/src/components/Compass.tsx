import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useMapStore } from '../stores/map.js';

// A small heading-up compass, mirroring the web client (Map.svelte): a fixed
// cyan "forward" pointer at the top and a rotating rose whose N/E/S/W labels
// track their true screen bearing. Built from plain Views/Text (no SVG) and
// driven by a native-driver Animated.Value, so the rose spins on the UI thread
// without re-rendering — the same cheap approach as the map rotation.
const SIZE = 72;
const C = SIZE / 2; // centre

export default function Compass() {
  const rotation = useRef(new Animated.Value(0)).current;
  // Accumulated rotation takes the shortest path across the 0°/360° wrap, just
  // like the map rotor in GameMap, so the two stay visually in sync.
  const accRotationRef = useRef(0);
  const prevHeadingRef = useRef<number | null>(null);
  // Only re-render when heading availability flips (not on every reading).
  const [hasHeading, setHasHeading] = useState(
    () => useMapStore.getState().heading !== null,
  );

  // Rose rotates by -heading (same sign as the map) so the cardinal labels
  // point where north/east/south/west actually are relative to "forward".
  const roseRotate = rotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['360deg', '-360deg'],
    extrapolate: 'extend',
  });

  useEffect(() => {
    const apply = (h: number | null) => {
      const present = h !== null;
      setHasHeading(prev => (prev === present ? prev : present));
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
      Animated.timing(rotation, {
        toValue: accRotationRef.current,
        duration: 120,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    };

    apply(useMapStore.getState().heading);
    const unsub = useMapStore.subscribe((state, prev) => {
      if (state.heading !== prev.heading) apply(state.heading);
    });
    return unsub;
  }, [rotation]);

  if (!hasHeading) return null;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.bg} />

      {/* Rotating rose: cardinal ticks + labels */}
      <Animated.View
        style={[styles.rose, { transform: [{ rotate: roseRotate }] }]}>
        <View style={[styles.tick, styles.tickN]} />
        <View style={[styles.tick, styles.tickE]} />
        <View style={[styles.tick, styles.tickS]} />
        <View style={[styles.tick, styles.tickW]} />
        <Text style={[styles.label, styles.labelN]}>N</Text>
        <Text style={[styles.label, styles.labelE]}>E</Text>
        <Text style={[styles.label, styles.labelS]}>S</Text>
        <Text style={[styles.label, styles.labelW]}>W</Text>
      </Animated.View>

      {/* Fixed forward indicator (cyan triangle at top = player's heading) */}
      <View style={styles.forward} />
      {/* Centre dot */}
      <View style={styles.centerDot} />
    </View>
  );
}

const FAINT = 'rgba(255,255,255,0.5)';
const TICK_FAINT = 'rgba(255,255,255,0.3)';

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
  },
  bg: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: C,
    backgroundColor: 'rgba(13,13,15,0.82)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  rose: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
  },
  tick: {
    position: 'absolute',
  },
  tickN: { top: 4, left: C - 1.25, width: 2.5, height: 9, backgroundColor: '#ff5252' },
  tickS: { bottom: 4, left: C - 0.75, width: 1.5, height: 9, backgroundColor: TICK_FAINT },
  tickE: { right: 4, top: C - 0.75, width: 9, height: 1.5, backgroundColor: TICK_FAINT },
  tickW: { left: 4, top: C - 0.75, width: 9, height: 1.5, backgroundColor: TICK_FAINT },
  label: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '700',
  },
  // N/S span the full width and centre horizontally; E/W span the full height
  // and centre vertically (textAlignVertical is Android, which is our target).
  labelN: { top: 13, left: 0, right: 0, textAlign: 'center', color: '#ff5252' },
  labelS: { bottom: 12, left: 0, right: 0, textAlign: 'center', color: FAINT, fontSize: 10, fontWeight: '400' },
  labelE: { right: 11, top: 0, bottom: 0, width: 14, textAlign: 'center', textAlignVertical: 'center', color: FAINT, fontSize: 10, fontWeight: '400' },
  labelW: { left: 11, top: 0, bottom: 0, width: 14, textAlign: 'center', textAlignVertical: 'center', color: FAINT, fontSize: 10, fontWeight: '400' },
  forward: {
    position: 'absolute',
    top: 3,
    left: C - 5,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#00e5ff',
    opacity: 0.9,
  },
  centerDot: {
    position: 'absolute',
    top: C - 3,
    left: C - 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
});
