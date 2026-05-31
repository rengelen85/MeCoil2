import https from 'https';
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { GameManager } from './GameManager.js';
import { Player } from './Player.js';
import { C2S } from '../shared/messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');

const PORT = process.env.PORT || 3000;
const USE_HTTPS = process.env.NO_HTTPS !== '1';

const app = express();

if (USE_HTTPS) {
  // Serve built client in production; in dev, Vite serves the client on its own port
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

let server;
if (USE_HTTPS) {
  const certPath = path.join(ROOT, 'certs', 'cert.pem');
  const keyPath = path.join(ROOT, 'certs', 'key.pem');
  if (!fs.existsSync(certPath)) {
    console.error('No certs found. Run: npm run gen-certs');
    console.error('Or start with NO_HTTPS=1 node server/index.js for HTTP (dev only).');
    process.exit(1);
  }
  server = https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app);
} else {
  server = http.createServer(app);
}

const wss = new WebSocketServer({ server });
const game = new GameManager();

wss.on('connection', ws => {
  let player = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!player) {
      if (msg.type !== C2S.JOIN || !msg.username?.trim()) return;
      player = new Player(ws, msg.username.trim());
      if (msg.team) player.team = msg.team;
      game.addPlayer(player);
      return;
    }

    game.handleMessage(player, msg);
  });

  ws.on('close', () => {
    if (player) game.removePlayer(player);
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
  const lan = getLanIp();
  console.log(`  Local:   ${proto}://localhost:${PORT}`);
  if (lan) console.log(`  Network: ${proto}://${lan}:${PORT}`);
});
