/**
 * On-device game server bridge.
 *
 * The actual server logic runs inside a Node.js thread managed by
 * nodejs-mobile-react-native. This module starts/stops that thread and
 * exposes the local WebSocket URL so the network layer can connect.
 *
 * Architecture:
 *   React Native (this file)  ←─ rn-bridge ─→  Node.js thread (nodejs-assets/)
 *
 * The Node.js thread starts a WebSocket server on SERVER_PORT. The host
 * player's network.ts connects to ws://localhost:SERVER_PORT just like any
 * remote player — no special host path needed.
 */

import nodejs from 'nodejs-mobile-react-native';
import { Platform } from 'react-native';

const SERVER_PORT = 3000;

type ServerStatus =
  | { type: 'started'; port: number }
  | { type: 'error'; message: string };

type StatusListener = (status: ServerStatus) => void;

let _started = false;
const _listeners: StatusListener[] = [];

export function getServerUrl(): string {
  return `ws://localhost:${SERVER_PORT}`;
}

export function onServerStatus(cb: StatusListener) {
  _listeners.push(cb);
  return () => {
    const i = _listeners.indexOf(cb);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

export function startServer(): void {
  if (_started) return;
  _started = true;

  nodejs.start('main.js');

  nodejs.channel.addListener('message', (msg: string) => {
    try {
      const parsed = JSON.parse(msg) as ServerStatus;
      for (const cb of _listeners) cb(parsed);
    } catch {
      // non-JSON bridge messages — ignore
    }
  });
}

export function stopServer(): void {
  if (!_started) return;
  _started = false;
  nodejs.channel.post('message', JSON.stringify({ type: 'stop' }));
}

export function isServerHost(): boolean {
  return _started;
}

/** Returns the LAN IP address other phones can connect to. */
export function getNetworkUrl(): string | null {
  // Android's WiFi hotspot default gateway is always 192.168.43.1.
  // For regular WiFi, the host's IP must be discovered via rn-bridge
  // (see server.ts statusListener for 'started' message with ip field).
  if (Platform.OS === 'android') {
    return `ws://192.168.43.1:${SERVER_PORT}`;
  }
  return null;
}
