/**
 * Entry point for the on-device game server (runs in nodejs-mobile thread).
 *
 * Starts a plain WebSocket server on port 3000 using the same RoomManager
 * and GameManager as the regular web server. The React Native app connects
 * to ws://localhost:3000 just like any other player would.
 *
 * Communication with React Native via rn-bridge:
 *   Outbound (to RN):  JSON { type: 'started', port, ip }
 *                      JSON { type: 'error', message }
 *   Inbound (from RN): JSON { type: 'stop' }
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// rn-bridge is injected by nodejs-mobile at runtime; require it as CJS
const rn_bridge = require('rn-bridge');

import { WebSocketServer } from 'ws';
import os from 'os';
import { RoomManager } from './RoomManager.js';
import { Player } from './Player.js';
import { C2S } from './shared/messages.js';

const PORT = 3000;

const wss = new WebSocketServer({ port: PORT });
const roomManager = new RoomManager();

wss.on('connection', ws => {
  let player = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!player) {
      if (msg.type !== C2S.REGISTER || !msg.username?.trim()) return;
      player = new Player(ws, msg.username.trim());
      roomManager.register(player);
      return;
    }

    roomManager.handleMessage(player, msg);
  });

  ws.on('close', () => {
    if (player) roomManager.removePlayer(player);
  });
});

wss.on('listening', () => {
  const ip = _getLanIp();
  rn_bridge.channel.send(JSON.stringify({ type: 'started', port: PORT, ip }));
});

wss.on('error', err => {
  rn_bridge.channel.send(JSON.stringify({ type: 'error', message: err.message }));
});

// React Native can ask us to shut down cleanly
rn_bridge.channel.on('message', raw => {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'stop') {
      wss.close();
      process.exit(0);
    }
  } catch { /* ignore */ }
});

function _getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}
