import { S2C, C2S, GAME_STATES } from 'shared/messages.js';
import {
  useGameStore,
  saveSession,
  clearStoredPlayerId,
  CtfState,
  InfectionState,
  DominationState,
} from '../stores/game.js';
import { useMapStore } from '../stores/map.js';
import { playKilled, playRespawn, playAirstrikeWarning, playApacheWarning } from './audio.js';

let ws: WebSocket | null = null;
let _serverUrl: string | null = null;
let _reconnectAttempts = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_MAX_ATTEMPTS = 8;
const RECONNECT_BASE_DELAY_MS = 1_000;

// ── Heartbeat / dead-socket watchdog ──────────────────────────────────────────
// React Native's WebSocket often does NOT fire onclose when the network interface
// changes (e.g. the phone hops WiFi access points) — the socket lingers OPEN for
// minutes. So we can't rely on onclose alone to notice a drop. Instead we send a
// PING every few seconds and treat the socket as dead if no traffic (PONG, or any
// game broadcast) arrives within STALE_TIMEOUT_MS, then force-close it to kick off
// the normal reconnect path.
const HEARTBEAT_INTERVAL_MS = 5_000;
const WATCHDOG_INTERVAL_MS = 3_000;
const STALE_TIMEOUT_MS = 12_000;
let _lastMessageAt = 0;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _watchdogTimer: ReturnType<typeof setInterval> | null = null;

// Attach the message handler used by every socket we open: stamp the arrival time
// (so the watchdog can tell a live socket from a dead one) then dispatch.
function _attachMessageHandler(sock: WebSocket) {
  sock.onmessage = e => {
    _lastMessageAt = Date.now();
    _handle(JSON.parse(e.data));
  };
}

function _startHeartbeat() {
  _stopHeartbeat();
  _lastMessageAt = Date.now();
  _heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: C2S.PING }));
    }
  }, HEARTBEAT_INTERVAL_MS);
  _watchdogTimer = setInterval(() => {
    if (ws && Date.now() - _lastMessageAt > STALE_TIMEOUT_MS) {
      // No traffic for too long — the socket is dead even if RN still calls it
      // OPEN. Close it so onclose → _handleClose → reconnect fires promptly.
      _stopHeartbeat();
      ws.close();
    }
  }, WATCHDOG_INTERVAL_MS);
}

function _stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
  if (_watchdogTimer) {
    clearInterval(_watchdogTimer);
    _watchdogTimer = null;
  }
}

let _getPosition: () => { lat: number | null; lng: number | null } = () => ({
  lat: null,
  lng: null,
});

export function setPositionGetter(fn: () => { lat: number | null; lng: number | null }) {
  _getPosition = fn;
}

/**
 * Turn whatever the user typed into a usable WebSocket URL.
 *
 * Mirrors the web client: the server speaks WebSocket on the `/ws` path and
 * runs over TLS, so a bare host/IP becomes `wss://<host>/ws`. A user who needs
 * a plain connection or a custom path can type the full URL themselves.
 */
export function normalizeServerUrl(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!/^wss?:\/\//i.test(s)) {
    s = `wss://${s}`;
  }
  const m = s.match(/^(wss?:\/\/[^/]+)(\/.*)?$/i);
  if (m && !m[2]) {
    s = `${m[1]}/ws`;
  }
  return s;
}

export function connect(serverUrl: string): Promise<void> {
  _serverUrl = serverUrl;
  return new Promise((resolve, reject) => {
    let settled = false;
    const newWs = new WebSocket(serverUrl);
    newWs.onopen = () => {
      settled = true;
      ws = newWs;
      // Once open, a close is a mid-session drop — route it through the
      // auto-reconnect handler instead of the connect-failure path below.
      ws.onclose = () => _handleClose();
      _startHeartbeat();
      resolve();
    };
    newWs.onerror = (e: { message?: string } = {}) => {
      if (settled) return;
      settled = true;
      reject(new Error(e.message || `Could not reach ${serverUrl}`));
    };
    _attachMessageHandler(newWs);
    newWs.onclose = (e: { code?: number; reason?: string } = {}) => {
      // A close before the socket ever opened means the connect failed; surface
      // the close code (e.g. 1006 = abnormal, often TLS/handshake/network).
      if (!settled) {
        settled = true;
        reject(
          new Error(
            `Connection closed before opening (code ${e.code ?? '?'}${
              e.reason ? `: ${e.reason}` : ''
            })`,
          ),
        );
      }
    };
  });
}

// A socket drop while we're past the setup screen kicks off backoff reconnect;
// otherwise (e.g. on the setup screen) we just fall back to WAITING.
function _handleClose() {
  _stopHeartbeat();
  const screen = useGameStore.getState().screen;
  if (screen === 'ingame' || screen === 'lobby' || screen === 'roomselect') {
    useGameStore.getState().setIsReconnecting(true);
    _scheduleReconnect();
  } else {
    useGameStore.getState().setGameState(GAME_STATES.WAITING);
  }
}

function _scheduleReconnect() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  if (_reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
    // Auto-reconnect gave up. Keep the player's identity and current screen so
    // they can rejoin themselves — the server holds their session for the whole
    // round — and surface a "Rejoin" button via reconnectFailed.
    useGameStore.getState().setIsReconnecting(false);
    useGameStore.getState().setReconnectFailed(true);
    return;
  }
  const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** _reconnectAttempts, 15_000);
  _reconnectAttempts++;
  _reconnectTimer = setTimeout(_doReconnect, delay);
}

function _doReconnect() {
  if (!_serverUrl) return;
  const newWs = new WebSocket(_serverUrl);
  newWs.onopen = () => {
    ws = newWs;
    ws.onclose = () => _handleClose();
    _reconnectAttempts = 0;
    _startHeartbeat();
    // Try to restore the previous session; fall back to a fresh register.
    const g = useGameStore.getState();
    if (g.myId && g.username) {
      newWs.send(JSON.stringify({ type: C2S.REJOIN, playerId: g.myId, username: g.username }));
    } else {
      newWs.send(JSON.stringify({ type: C2S.REGISTER, username: g.username }));
    }
  };
  newWs.onerror = () => {};
  _attachMessageHandler(newWs);
  newWs.onclose = () => _scheduleReconnect();
}

// Triggered by the "Rejoin" button once auto-reconnect has given up.
export function manualReconnect() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectAttempts = 0;
  const g = useGameStore.getState();
  g.setReconnectFailed(false);
  g.setIsReconnecting(true);
  _doReconnect();
}

export function disconnect() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _stopHeartbeat();
  _reconnectAttempts = 0;
  // Drop the close handler so an intentional disconnect doesn't trigger
  // reconnect backoff.
  if (ws) ws.onclose = null;
  ws?.close();
  ws = null;
}

export function send(obj: object) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

export const sendRegister = (name: string) =>
  send({ type: C2S.REGISTER, username: name });
export const sendRejoin = (playerId: number, name: string) =>
  send({ type: C2S.REJOIN, playerId, username: name });
export const sendListRooms = () => send({ type: C2S.LIST_ROOMS });
export const sendCreateRoom = (name: string) =>
  send({ type: C2S.CREATE_ROOM, name });
export const sendJoinRoom = (id: number) =>
  send({ type: C2S.JOIN_ROOM, roomId: id });
export const sendLeaveRoom = () => send({ type: C2S.LEAVE_ROOM });
export const sendReady = (ready: boolean) => send({ type: C2S.READY, ready });
export const sendGameConfig = (config: object) =>
  send({ type: C2S.GAME_CONFIG, ...config });
export const sendStartGame = () => send({ type: C2S.START_GAME });
export const sendSwitchTeam = () => send({ type: C2S.SWITCH_TEAM });
export const sendStopGame = () => send({ type: C2S.STOP_GAME });
export const sendPosition = (lat: number, lng: number) =>
  send({ type: C2S.POSITION, lat, lng });

export function sendFire(mode: string | null = null, ammo = 0) {
  const { lat, lng } = _getPosition();
  send({ type: C2S.FIRE, lat, lng, mode, ammo });
}

export const sendHit = (shooterWeaponId: number) =>
  send({ type: C2S.HIT, shooterWeaponId });
export const sendCollect = (powerupId: number) =>
  send({ type: C2S.COLLECT, powerupId });
export const sendDeployAirstrike = (lat: number, lng: number) =>
  send({ type: C2S.DEPLOY_AIRSTRIKE, lat, lng });
export const sendDeployApache = (lat: number, lng: number) =>
  send({ type: C2S.DEPLOY_APACHE, lat, lng });
export const sendSetBase = (team: string, lat: number, lng: number) =>
  send({ type: C2S.SET_BASE, team, lat, lng });
export const sendSetDomZone = (zoneId: string, lat: number, lng: number) =>
  send({ type: C2S.SET_DOM_ZONE, zoneId, lat, lng });
export const sendSetGameArea = (area: object | null) =>
  send({ type: C2S.SET_GAME_AREA, area });

function _handle(msg: { type: string; [key: string]: unknown }) {
  const game = useGameStore.getState();
  const map = useMapStore.getState();

  switch (msg.type) {
    case S2C.REGISTERED:
      game.setIsReconnecting(false);
      game.setReconnectFailed(false);
      game.setMyId(msg.playerId as number);
      saveSession(game.username, msg.playerId as number);
      game.setScreen('roomselect');
      break;

    case S2C.REJOIN_FAILED:
      // Grace period expired — clear the stored id and register fresh.
      game.setIsReconnecting(false);
      clearStoredPlayerId();
      send({ type: C2S.REGISTER, username: game.username });
      break;

    case S2C.ROOMS_LIST:
      game.setRooms((msg.rooms as []) ?? []);
      break;

    case S2C.JOINED: {
      const ls = msg.lobbyState as Record<string, unknown>;
      const config = ls.config as Record<string, unknown>;
      game.setIsReconnecting(false);
      game.setReconnectFailed(false);
      game.setMyId(msg.playerId as number);
      game.setIsHost(msg.isHost as boolean);
      game.setPlayers((ls.players as []) ?? []);
      game.setGameConfig(config as object);
      game.setGameArea((config?.gameArea as never) ?? null);
      game.setHostId(ls.hostId as number);
      game.setRoomName((ls.roomName as string) ?? '');
      if (ls.gameId) game.setGameId(ls.gameId as string);
      if (ls.state) game.setGameState(ls.state as string);
      game.setScreen('lobby');
      break;
    }

    case S2C.LOBBY_UPDATE: {
      const config = msg.config as Record<string, unknown>;
      game.setPlayers((msg.players as []) ?? []);
      game.setGameConfig(config as object);
      game.setGameArea((config?.gameArea as never) ?? null);
      game.setHostId(msg.hostId as number);
      if (msg.gameId) game.setGameId(msg.gameId as string);
      if (msg.state) game.setGameState(msg.state as string);
      break;
    }

    case S2C.COUNTDOWN:
      game.setGameState(GAME_STATES.COUNTDOWN);
      game.setCountdownAt(msg.startsAt as number);
      break;

    case S2C.GAME_STARTED: {
      const myId = game.myId;
      const assignments = (msg.gunAssignments as Record<number, number>) ?? {};
      // Use the server's assignment for this player; null (not a fabricated 0)
      // if absent, so a missing assignment never masquerades as the host's slot.
      const slot = assignments[myId!] ?? null;
      const hpMax = (msg.hpPerPlayer as number) ?? 100;
      const mag = (msg.bulletsPerMag as number) ?? 30;
      game.setGunSlotId(slot);
      game.setGameConfig({
        mode: msg.mode as string,
        timeLimit: msg.timeLimit as number,
        scoreLimit: msg.scoreLimit as number,
        bulletsPerMag: mag,
        hpPerPlayer: hpMax,
        reloadDelaySecs: (msg.reloadDelaySecs as number) ?? 3,
        respawnDelaySecs: (msg.respawnDelaySecs as number) ?? 10,
      });
      game.setGameArea((msg.gameArea as never) ?? null);
      if (msg.roundId) game.setRoundId(msg.roundId as string);
      game.setGameState(GAME_STATES.PLAYING);
      game.resetGame();
      // Apply host-tuned health and magazine settings for this round
      game.setMaxHp(hpMax);
      game.setHp(hpMax);
      game.setIsAlive(true);
      game.setRespawnCountdown(null);
      game.setBulletsPerMag(mag);
      game.setReloadDelaySecs((msg.reloadDelaySecs as number) ?? 3);
      game.setMaxAmmo(mag);
      game.setAmmo(mag);
      // Clear stale positions/power-ups/overlays from a previous round so the
      // fresh map doesn't briefly render last game's markers.
      map.setTeammates([]);
      map.setFiringEnemies([]);
      map.setPowerups([]);
      map.setAirstrikes([]);
      map.setApaches([]);
      map.setGraves([]);
      map.setCtfBases({ red: null, blue: null });
      map.setCtfFlags({ red: null, blue: null });
      map.setDomZones([]);
      // On a reconnect mid-round the server sends a snapshot of our live state
      // so we restore it instead of starting fresh (preserves health, held
      // airstrikes/apaches and any active buffs).
      if (msg.resume) _applyResumeState(msg.resume as Record<string, number>);
      game.setScreen('ingame');
      break;
    }

    case S2C.GAME_STATE:
      if (msg.scores) game.setScores(msg.scores as []);
      if (msg.timeRemaining != null) game.setTimeRemaining(msg.timeRemaining as number);
      if (msg.killFeed) game.setKillFeed(msg.killFeed as []);
      {
        const collected = (msg.event as Record<string, unknown>)?.powerupCollected as
          | { type: string; playerId: number }
          | undefined;
        if (collected && collected.playerId === game.myId) {
          _applyLocalPowerupFeedback(collected);
        }
      }
      if (msg.ctfState) {
        const ctf = msg.ctfState as CtfState;
        game.setCtfState(ctf);
        map.setCtfBases(ctf.bases ?? { red: null, blue: null });
        map.setCtfFlags(ctf.flags ?? { red: null, blue: null });
      }
      if (msg.infectionState) {
        game.setInfectionState(msg.infectionState as InfectionState);
      }
      if (msg.dominationState) {
        const dom = msg.dominationState as DominationState;
        game.setDominationState(dom);
        map.setDomZones(dom.zones ?? []);
      }
      break;

    case S2C.POSITIONS:
      map.setTeammates((msg.teammates as []) ?? []);
      map.setFiringEnemies((msg.firingEnemies as []) ?? []);
      break;

    case S2C.POWERUPS:
      map.setPowerups((msg.packages as []) ?? []);
      break;

    case S2C.AIRSTRIKE_INCOMING:
      map.setAirstrikes([
        ...map.airstrikes.filter(a => a.id !== msg.id),
        {
          id: msg.id as number,
          lat: msg.lat as number,
          lng: msg.lng as number,
          radius: msg.radius as number,
          detonateAt: msg.detonateAt as number,
        },
      ]);
      playAirstrikeWarning();
      break;

    case S2C.AIRSTRIKE_HIT:
      // Blast resolved — drop the warning marker. Damage arrives via PLAYER_HP/DEAD.
      map.setAirstrikes(map.airstrikes.filter(a => a.id !== msg.id));
      break;

    case S2C.APACHE_ACTIVE:
      map.setApaches([
        ...map.apaches.filter(a => a.id !== msg.id),
        {
          id: msg.id as number,
          lat: msg.lat as number,
          lng: msg.lng as number,
          radius: msg.radius as number,
          endsAt: msg.endsAt as number,
        },
      ]);
      playApacheWarning();
      break;

    case S2C.APACHE_EXPIRED:
      map.setApaches(map.apaches.filter(a => a.id !== msg.id));
      break;

    case S2C.PLAYER_HP:
      if (msg.playerId === game.myId) {
        // A drop in HP is incoming damage — trigger the red hit flash.
        if ((msg.hp as number) < game.hp) game.setLastHitAt(Date.now());
        game.setHp(msg.hp as number);
        game.setMaxHp(msg.maxHp as number);
      }
      // Our shot landed on someone — show the "HIT" confirmation indicator.
      if (msg.shooterId === game.myId) {
        game.setLastShotHitAt(Date.now());
      }
      break;

    case S2C.PLAYER_DEAD:
      // Drop/refresh a tombstone at every player's latest death spot (own included).
      if (msg.lat != null && msg.lng != null) {
        map.setGraves([
          ...map.graves.filter(g => g.id !== msg.playerId),
          {
            id: msg.playerId as number,
            username: msg.username as string,
            lat: msg.lat as number,
            lng: msg.lng as number,
          },
        ]);
      }
      if (msg.playerId === game.myId) {
        game.setHp(0);
        game.setIsAlive(false);
        game.setKilledBy((msg.killerName as string) ?? null);
        _stopShieldCountdown();
        playKilled();
        // CTF uses location-based respawn (respawnIn === null); skip countdown.
        if (msg.respawnIn != null) {
          _startRespawnCountdown(msg.respawnIn as number);
        }
      }
      break;

    case S2C.PLAYER_RESPAWN:
      if (msg.playerId === game.myId) {
        game.setHp(msg.hp as number);
        game.setMaxHp(msg.maxHp as number);
        if (msg.ammo != null) game.setAmmo(msg.ammo as number);
        game.setIsAlive(true);
        game.setKilledBy(null);
        playRespawn();
        _stopRespawnCountdown();
        game.setRespawnCountdown(null);
        if (msg.shieldMs) _startShieldCountdown(Math.round((msg.shieldMs as number) / 1_000));
      }
      break;

    case S2C.GAME_ENDED:
      game.setGameState(GAME_STATES.ENDED);
      game.setFinalScores(msg.finalScores as []);
      game.setWinner(msg.winner as string | null);
      game.setScreen('end');
      break;

    case S2C.LEFT_ROOM:
      game.setIsHost(false);
      game.setPlayers([]);
      game.setHostId(null);
      game.setRoomName('');
      game.setGameId(null);
      game.setRoundId(null);
      game.setGameState(GAME_STATES.WAITING);
      game.setRooms((msg.rooms as []) ?? []);
      game.resetGame();
      game.setScreen('roomselect');
      break;
  }
}

// Restore the local player's live state after a mid-round reconnect, overriding
// the fresh-start defaults the GAME_STARTED handler just applied. Buff and
// respawn timers are resumed from the remaining milliseconds the server reports.
function _applyResumeState(r: Record<string, number>) {
  const game = useGameStore.getState();
  game.setMaxHp(r.maxHp);
  game.setHp(r.hp);
  game.setIsAlive(Boolean(r.isAlive));
  if (r.ammo != null) game.setAmmo(r.ammo);
  game.setAirstrikeReady(r.airstrikesAvailable ?? 0);
  game.setApacheReady(r.apachesAvailable ?? 0);
  if (r.shieldMs > 0) _startShieldCountdown(Math.round(r.shieldMs / 1_000));
  if (r.stealthMs > 0) _startStealthCountdown(Math.round(r.stealthMs / 1_000));
  if (r.radarMs > 0) _startRadarCountdown(Math.round(r.radarMs / 1_000));
  if (!r.isAlive && r.respawnMs != null) {
    _startRespawnCountdown(Math.round(r.respawnMs / 1_000));
  }
}

function _applyLocalPowerupFeedback({ type }: { type: string }) {
  const game = useGameStore.getState();
  switch (type) {
    case 'fastReload':
      _startFastReloadCountdown(120);
      break;
    case 'healthPack':
      game.setHp(game.maxHp);
      break;
    case 'shield':
      _startShieldCountdown(120);
      break;
    case 'stealth':
      _startStealthCountdown(120);
      break;
    case 'radar':
      _startRadarCountdown(60);
      break;
    case 'airstrike':
      game.setAirstrikeReady(game.airstrikeReady + 1);
      break;
    case 'apacheSupport':
      game.setApacheReady(game.apacheReady + 1);
      break;
  }
}

// ── Local 1-second tickers that drive the buff-badge countdowns ───────────────
// Each mirrors the web client (network.js): set active + remaining seconds, then
// decrement once per second and clear when it reaches zero.

let _shieldTimer: ReturnType<typeof setInterval> | null = null;

function _startShieldCountdown(secs: number) {
  _stopShieldCountdown();
  const game = useGameStore.getState();
  game.setShieldActive(true);
  game.setShieldCountdown(secs);
  _shieldTimer = setInterval(() => {
    const current = useGameStore.getState().shieldCountdown;
    if (current === null) { _stopShieldCountdown(); return; }
    const next = current - 1;
    if (next <= 0) {
      _stopShieldCountdown();
    } else {
      useGameStore.getState().setShieldCountdown(next);
    }
  }, 1_000);
}

function _stopShieldCountdown() {
  if (_shieldTimer) {
    clearInterval(_shieldTimer);
    _shieldTimer = null;
  }
  useGameStore.getState().setShieldActive(false);
  useGameStore.getState().setShieldCountdown(null);
}

let _stealthTimer: ReturnType<typeof setInterval> | null = null;

function _startStealthCountdown(secs: number) {
  _stopStealthCountdown();
  const game = useGameStore.getState();
  game.setStealthActive(true);
  game.setStealthCountdown(secs);
  _stealthTimer = setInterval(() => {
    const current = useGameStore.getState().stealthCountdown;
    if (current === null) { _stopStealthCountdown(); return; }
    const next = current - 1;
    if (next <= 0) {
      _stopStealthCountdown();
    } else {
      useGameStore.getState().setStealthCountdown(next);
    }
  }, 1_000);
}

function _stopStealthCountdown() {
  if (_stealthTimer) {
    clearInterval(_stealthTimer);
    _stealthTimer = null;
  }
  useGameStore.getState().setStealthActive(false);
  useGameStore.getState().setStealthCountdown(null);
}

let _fastReloadTimer: ReturnType<typeof setInterval> | null = null;

function _startFastReloadCountdown(secs: number) {
  _stopFastReloadCountdown();
  const game = useGameStore.getState();
  game.setFastReloadActive(true);
  game.setFastReloadCountdown(secs);
  _fastReloadTimer = setInterval(() => {
    const current = useGameStore.getState().fastReloadCountdown;
    if (current === null) { _stopFastReloadCountdown(); return; }
    const next = current - 1;
    if (next <= 0) {
      _stopFastReloadCountdown();
    } else {
      useGameStore.getState().setFastReloadCountdown(next);
    }
  }, 1_000);
}

function _stopFastReloadCountdown() {
  if (_fastReloadTimer) {
    clearInterval(_fastReloadTimer);
    _fastReloadTimer = null;
  }
  useGameStore.getState().setFastReloadActive(false);
  useGameStore.getState().setFastReloadCountdown(null);
}

let _radarTimer: ReturnType<typeof setInterval> | null = null;

function _startRadarCountdown(secs: number) {
  _stopRadarCountdown();
  const game = useGameStore.getState();
  game.setRadarActive(true);
  game.setRadarCountdown(secs);
  _radarTimer = setInterval(() => {
    const current = useGameStore.getState().radarCountdown;
    if (current === null) { _stopRadarCountdown(); return; }
    const next = current - 1;
    if (next <= 0) {
      _stopRadarCountdown();
    } else {
      useGameStore.getState().setRadarCountdown(next);
    }
  }, 1_000);
}

function _stopRadarCountdown() {
  if (_radarTimer) {
    clearInterval(_radarTimer);
    _radarTimer = null;
  }
  useGameStore.getState().setRadarActive(false);
  useGameStore.getState().setRadarCountdown(null);
}

// Local 1-second ticker that drives the on-screen respawn countdown while dead.
let _respawnTimer: ReturnType<typeof setInterval> | null = null;

function _startRespawnCountdown(secs: number) {
  _stopRespawnCountdown();
  const game = useGameStore.getState();
  game.setRespawnCountdown(secs);
  _respawnTimer = setInterval(() => {
    const current = useGameStore.getState().respawnCountdown;
    if (current === null) {
      _stopRespawnCountdown();
      return;
    }
    const next = current - 1;
    if (next <= 0) {
      useGameStore.getState().setRespawnCountdown(0);
      _stopRespawnCountdown();
    } else {
      useGameStore.getState().setRespawnCountdown(next);
    }
  }, 1_000);
}

function _stopRespawnCountdown() {
  if (_respawnTimer) {
    clearInterval(_respawnTimer);
    _respawnTimer = null;
  }
}
