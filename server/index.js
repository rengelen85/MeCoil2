import https from 'https';
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { RoomManager } from './RoomManager.js';
import { Player } from './Player.js';
import { C2S } from '../shared/messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
const CERT_PATH = path.join(ROOT, 'certs', 'cert.pem');
const KEY_PATH  = path.join(ROOT, 'certs', 'key.pem');

const PORT = process.env.PORT || 3000;

// Auto-detect HTTPS: use it when certs exist, unless NO_HTTPS=1 forces plain HTTP.
const hasCerts  = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
const USE_HTTPS = hasCerts && process.env.NO_HTTPS !== '1';

const app = express();

// Serve the built client. In Vite dev mode (separate port) this path won't
// exist yet, but that's fine — the static middleware just serves nothing.
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

const server = USE_HTTPS
  ? https.createServer({ cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) }, app)
  : http.createServer(app);

const wss = new WebSocketServer({ server });
const roomManager = new RoomManager();

wss.on('connection', ws => {
  let player = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!player) {
      if (msg.type === C2S.REJOIN) {
        const rejoined = roomManager.rejoin(ws, msg.playerId, msg.username);
        if (rejoined) player = rejoined;
        // On failure, rejoin() already sent REJOIN_FAILED — client will re-register
        return;
      }
      if (msg.type !== C2S.REGISTER || !msg.username?.trim()) return;
      player = new Player(ws, msg.username.trim());
      roomManager.register(player);
      return;
    }

    roomManager.handleMessage(player, msg);
  });

  ws.on('close', () => {
    // Only handle disconnect if this ws is the player's active connection.
    // After a reconnect, the old ws's close handler will fire but we should ignore it.
    if (player && player.ws === ws) {
      roomManager.handleDisconnect(player);
    }
  });
});

function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

server.listen(PORT, () => {
  const proto = USE_HTTPS ? 'https' : 'http';
  const lan   = getLanIp();

  console.log('');
  console.log('  MeCoil game server');
  console.log(`  Local:   ${proto}://localhost:${PORT}`);
  if (lan) console.log(`  Network: ${proto}://${lan}:${PORT}`);

  if (!USE_HTTPS) {
    if (hasCerts) {
      console.log('  (HTTPS disabled via NO_HTTPS=1)');
    } else {
      console.log('  HTTP only — BLE & Geolocation require HTTPS.');
      console.log('  Run `make gen-certs` then restart for HTTPS support.');
    }
  } else {
    console.log('  HTTPS active — phones can connect to the Network address above.');
  }
  console.log('');
});
