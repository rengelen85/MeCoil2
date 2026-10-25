/**
 * Phone orientation for single-player AR target practice — the React Native
 * counterpart of the web client's deviceorientation listener. Backed by the
 * ArOrientation Android module (rotation-vector sensor). On platforms without
 * it, subscribe() returns null and the AR screen falls back to drag-to-aim.
 */

import { NativeEventEmitter, NativeModules } from 'react-native';

export interface ArOrientationSample {
  // Device-to-world rotation quaternion (world: x east, y north, z up).
  x: number;
  y: number;
  z: number;
  w: number;
  // Display rotation in degrees (0/90/180/270), like screen.orientation.angle.
  screenAngle: number;
}

const { ArOrientation } = NativeModules;

export function subscribeArOrientation(
  onSample: (s: ArOrientationSample) => void,
): (() => void) | null {
  if (!ArOrientation) return null;
  const emitter = new NativeEventEmitter(ArOrientation);
  const sub = emitter.addListener('arOrientation', onSample);
  ArOrientation.start();
  return () => {
    sub.remove();
    ArOrientation.stop();
  };
}
