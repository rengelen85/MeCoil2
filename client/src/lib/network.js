import { get } from 'svelte/store';
import { C2S, GAME_STATES, S2C } from '../../../shared/messages.js';
import {
  airstrikeArmed,
  airstrikeReady,
  ammo,
  apacheArmed,
  apacheReady,
  bulletsPerMag,
  countdownAt,
  ctfState,
  dominationState,
  fastReloadActive,
  fastReloadCountdown,
  finalScores,
  gameArea,
  gameConfig,
  gameId,
  gameState,
  gunSlotId,
  hostId,
  hp,
  infectionState,
  isAlive,
  isHost,
  isReconnecting,
  killedBy,
  killFeed,
  lastHitAt,
  lastShotHitAt,
  maxAmmo,
  maxHp,
  myId,
  players,
  radarActive,
  radarCountdown,
  reloadDelaySecs,
  resetGame,
  respawnCountdown,
  roomName,
  rooms,
  roundId,
  saveSession,
  scores,
  screen,
  shieldActive,
  shieldCountdown,
  stealthActive,
  stealthCountdown,
  timeRemaining,
  username,
  winner,
} from '../stores/game.js';
import {
  airstrikes,
  apaches,
  ctfBases,
  ctfFlags,
  domZones,
  firingEnemies,
  graves,
  powerups,
  teammates,
} from '../stores/map.js';
import {
  playAirstrikeWarning,
  playApacheWarning,
  playKilled,
  playRespawn,
} from './audio.js';

let ws = null;
let _serverUrl = null;
let _reconnectAttempts = 0;
let _reconnectTimer = null;
const RECONNECT_MAX_ATTEMPTS = 8;
const RECONNECT_BASE_DELAY_MS = 1_000;

let _getPosition = () => ({ lat: null, lng: null });

export function setPositionGetter(fn) {
  _getPosition = fn;
}

export function connect(serverUrl) {
  _serverUrl = serverUrl;
  return new Promise((resolve, reject) => {
    const newWs = new WebSocket(serverUrl);
    newWs.onopen = () => {
      ws = newWs;
      ws.onclose = () => _handleClose();
      resolve();
    };
    newWs.onerror = () => {};
    newWs.onmessage = (e) => _handle(JSON.parse(e.data));
    // Before onopen fires, a close means the initial connection failed
    newWs.onclose = () => reject(new Error('WebSocket connection failed'));
  });
}

function _handleClose() {
  const s = get(screen);
  if (s === 'ingame' || s === 'lobby' || s === 'roomselect') {
    isReconnecting.set(true);
    _scheduleReconnect();
  } else {
    gameState.set(GAME_STATES.WAITING);
  }
}

function _scheduleReconnect() {
  clearTimeout(_reconnectTimer);
  if (_reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
    isReconnecting.set(false);
    gameState.set(GAME_STATES.WAITING);
    screen.set('setup');
    return;
  }
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** _reconnectAttempts,
    15_000,
  );
  _reconnectAttempts++;
  _reconnectTimer = setTimeout(_doReconnect, delay);
}

function _doReconnect() {
  const newWs = new WebSocket(_serverUrl);
  newWs.onopen = () => {
    ws = newWs;
    ws.onclose = () => _handleClose();
    _reconnectAttempts = 0;
    // Try to restore the previous session; fall back to fresh register
    const pid = get(myId);
    const uname = get(username);
    if (pid && uname) {
      newWs.send(
        JSON.stringify({ type: C2S.REJOIN, playerId: pid, username: uname }),
      );
    } else {
      newWs.send(JSON.stringify({ type: C2S.REGISTER, username: uname }));
    }
  };
  newWs.onerror = () => {};
  newWs.onmessage = (e) => _handle(JSON.parse(e.data));
  newWs.onclose = () => _scheduleReconnect();
}

export function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

export function sendRegister(name) {
  send({ type: C2S.REGISTER, username: name });
}

export function sendRejoin(playerId, name) {
  send({ type: C2S.REJOIN, playerId, username: name });
}

export function sendListRooms() {
  send({ type: C2S.LIST_ROOMS });
}

export function sendCreateRoom(name) {
  send({ type: C2S.CREATE_ROOM, name });
}

export function sendJoinRoom(id) {
  send({ type: C2S.JOIN_ROOM, roomId: id });
}

export function sendReady(ready) {
  send({ type: C2S.READY, ready });
}

export function sendGameConfig(config) {
  send({ type: C2S.GAME_CONFIG, ...config });
}

export function sendStartGame() {
  send({ type: C2S.START_GAME });
}

export function sendSwitchTeam() {
  send({ type: C2S.SWITCH_TEAM });
}

export function sendPosition(lat, lng) {
  send({ type: C2S.POSITION, lat, lng });
}

export function sendFire(mode = null, ammo = 0) {
  const { lat, lng } = _getPosition();
  send({ type: C2S.FIRE, lat, lng, mode, ammo });
}

export function sendHit(shooterWeaponId) {
  send({ type: C2S.HIT, shooterWeaponId });
}

export function sendCollect(powerupId) {
  send({ type: C2S.COLLECT, powerupId });
}

export function sendDeployAirstrike(lat, lng) {
  send({ type: C2S.DEPLOY_AIRSTRIKE, lat, lng });
}

export function sendDeployApache(lat, lng) {
  send({ type: C2S.DEPLOY_APACHE, lat, lng });
}

export function sendSetBase(team, lat, lng) {
  send({ type: C2S.SET_BASE, team, lat, lng });
}

export function sendSetDomZone(zoneId, lat, lng) {
  send({ type: C2S.SET_DOM_ZONE, zoneId, lat, lng });
}

export function sendSetGameArea(area) {
  send({ type: C2S.SET_GAME_AREA, area });
}

export function sendStopGame() {
  send({ type: C2S.STOP_GAME });
}

export function sendLeaveRoom() {
  send({ type: C2S.LEAVE_ROOM });
}

function _handle(msg) {
  switch (msg.type) {
    case S2C.REGISTERED:
      isReconnecting.set(false);
      myId.set(msg.playerId);
      saveSession(get(username), msg.playerId);
      screen.set('roomselect');
      break;

    case S2C.REJOIN_FAILED:
      // Grace period expired — clear stored id and register fresh
      isReconnecting.set(false);
      localStorage.removeItem('mecoil_player_id');
      send({ type: C2S.REGISTER, username: get(username) });
      break;

    case S2C.ROOMS_LIST:
      rooms.set(msg.rooms ?? []);
      break;

    case S2C.JOINED:
      isReconnecting.set(false);
      myId.set(msg.playerId);
      isHost.set(msg.isHost);
      players.set(msg.lobbyState.players);
      gameConfig.set(msg.lobbyState.config);
      gameArea.set(msg.lobbyState.config.gameArea ?? null);
      hostId.set(msg.lobbyState.hostId);
      roomName.set(msg.lobbyState.roomName ?? '');
      if (msg.lobbyState.gameId) gameId.set(msg.lobbyState.gameId);
      if (msg.lobbyState.state) gameState.set(msg.lobbyState.state);
      screen.set('lobby');
      break;

    case S2C.LOBBY_UPDATE:
      players.set(msg.players);
      gameConfig.set(msg.config);
      gameArea.set(msg.config.gameArea ?? null);
      hostId.set(msg.hostId);
      if (msg.gameId) gameId.set(msg.gameId);
      if (msg.state) gameState.set(msg.state);
      break;

    case S2C.COUNTDOWN:
      gameState.set(GAME_STATES.COUNTDOWN);
      countdownAt.set(msg.startsAt);
      break;

    case S2C.GAME_STARTED: {
      const slot = msg.gunAssignments?.[get(myId)] ?? 0;
      gunSlotId.set(slot);
      gameConfig.set({
        mode: msg.mode,
        timeLimit: msg.timeLimit,
        scoreLimit: msg.scoreLimit,
        bulletsPerMag: msg.bulletsPerMag ?? 30,
        hpPerPlayer: msg.hpPerPlayer ?? 100,
        reloadDelaySecs: msg.reloadDelaySecs ?? 3,
        respawnDelaySecs: msg.respawnDelaySecs ?? 10,
      });
      gameArea.set(msg.gameArea ?? null);
      if (msg.roundId) roundId.set(msg.roundId);
      gameState.set(GAME_STATES.PLAYING);
      resetGame();
      // Apply host-tuned health and magazine settings for this round
      const hpMax = msg.hpPerPlayer ?? 100;
      maxHp.set(hpMax);
      hp.set(hpMax);
      isAlive.set(true);
      respawnCountdown.set(null);
      bulletsPerMag.set(msg.bulletsPerMag ?? 30);
      reloadDelaySecs.set(msg.reloadDelaySecs ?? 3);
      maxAmmo.set(msg.bulletsPerMag ?? 30);
      ammo.set(msg.bulletsPerMag ?? 30);
      // Clear stale positions/power-ups from a previous round so the fresh
      // map doesn't briefly render last game's markers.
      teammates.set([]);
      firingEnemies.set([]);
      powerups.set([]);
      airstrikes.set([]);
      apaches.set([]);
      graves.set([]);
      ctfBases.set({ red: null, blue: null });
      ctfFlags.set({ red: null, blue: null });
      domZones.set([]);
      // On a reconnect mid-round the server sends a snapshot of our live state
      // so we restore it instead of starting fresh (preserves health, held
      // airstrikes/apaches and any active buffs).
      if (msg.resume) _applyResumeState(msg.resume);
      screen.set('ingame');
      break;
    }

    case S2C.GAME_STATE:
      if (msg.scores) scores.set(msg.scores);
      if (msg.timeRemaining != null) timeRemaining.set(msg.timeRemaining);
      if (msg.killFeed) killFeed.set(msg.killFeed);
      if (msg.event?.powerupCollected?.playerId === get(myId)) {
        _applyLocalPowerupFeedback(msg.event.powerupCollected);
      }
      if (msg.ctfState) {
        ctfState.set(msg.ctfState);
        ctfBases.set(msg.ctfState.bases ?? { red: null, blue: null });
        ctfFlags.set(msg.ctfState.flags ?? { red: null, blue: null });
      }
      if (msg.infectionState) {
        infectionState.set(msg.infectionState);
      }
      if (msg.dominationState) {
        dominationState.set(msg.dominationState);
        domZones.set(msg.dominationState.zones ?? []);
      }
      break;

    case S2C.POSITIONS:
      teammates.set(msg.teammates ?? []);
      firingEnemies.set(msg.firingEnemies ?? []);
      break;

    case S2C.POWERUPS:
      powerups.set(msg.packages ?? []);
      break;

    case S2C.AIRSTRIKE_INCOMING:
      airstrikes.update((list) => [
        ...list.filter((a) => a.id !== msg.id),
        {
          id: msg.id,
          lat: msg.lat,
          lng: msg.lng,
          radius: msg.radius,
          detonateAt: msg.detonateAt,
        },
      ]);
      playAirstrikeWarning();
      break;

    case S2C.AIRSTRIKE_HIT:
      // Blast resolved — drop the warning marker. Damage arrives via PLAYER_HP/DEAD.
      airstrikes.update((list) => list.filter((a) => a.id !== msg.id));
      break;

    case S2C.APACHE_ACTIVE:
      apaches.update((list) => [
        ...list.filter((a) => a.id !== msg.id),
        {
          id: msg.id,
          lat: msg.lat,
          lng: msg.lng,
          radius: msg.radius,
          endsAt: msg.endsAt,
        },
      ]);
      playApacheWarning();
      break;

    case S2C.APACHE_EXPIRED:
      apaches.update((list) => list.filter((a) => a.id !== msg.id));
      break;

    case S2C.PLAYER_HP:
      if (msg.playerId === get(myId)) {
        if (msg.hp < get(hp)) lastHitAt.set(Date.now());
        hp.set(msg.hp);
        maxHp.set(msg.maxHp);
      }
      if (msg.shooterId === get(myId)) {
        lastShotHitAt.set(Date.now());
      }
      break;

    case S2C.PLAYER_DEAD:
      // Drop/refresh a tombstone at every player's latest death spot (own included).
      if (msg.lat != null && msg.lng != null) {
        graves.update((list) => [
          ...list.filter((g) => g.id !== msg.playerId),
          {
            id: msg.playerId,
            username: msg.username,
            lat: msg.lat,
            lng: msg.lng,
          },
        ]);
      }
      if (msg.playerId === get(myId)) {
        hp.set(0);
        isAlive.set(false);
        killedBy.set(msg.killerName ?? null);
        _stopShieldCountdown();
        playKilled();
        // CTF uses location-based respawn (respawnIn === null); skip countdown
        if (msg.respawnIn != null) {
          _startRespawnCountdown(msg.respawnIn);
        }
      }
      break;

    case S2C.PLAYER_RESPAWN:
      if (msg.playerId === get(myId)) {
        hp.set(msg.hp);
        maxHp.set(msg.maxHp);
        if (msg.ammo != null) ammo.set(msg.ammo);
        isAlive.set(true);
        killedBy.set(null);
        playRespawn();
        _stopRespawnCountdown();
        respawnCountdown.set(null);
        if (msg.shieldMs)
          _startShieldCountdown(Math.round(msg.shieldMs / 1_000));
      }
      break;

    case S2C.GAME_ENDED:
      gameState.set(GAME_STATES.ENDED);
      finalScores.set(msg.finalScores);
      winner.set(msg.winner);
      screen.set('end');
      break;

    case S2C.LEFT_ROOM:
      isHost.set(false);
      players.set([]);
      hostId.set(null);
      roomName.set('');
      gameId.set(null);
      roundId.set(null);
      gameState.set(GAME_STATES.WAITING);
      rooms.set(msg.rooms ?? []);
      resetGame();
      screen.set('roomselect');
      break;
  }
}

// Restore the local player's live state after a mid-round reconnect, overriding
// the fresh-start defaults the GAME_STARTED handler just applied. Buff and
// respawn timers are resumed from the remaining milliseconds the server reports.
function _applyResumeState(r) {
  maxHp.set(r.maxHp);
  hp.set(r.hp);
  isAlive.set(r.isAlive);
  if (r.ammo != null) ammo.set(r.ammo);
  airstrikeReady.set(r.airstrikesAvailable ?? 0);
  apacheReady.set(r.apachesAvailable ?? 0);
  if (r.shieldMs > 0) _startShieldCountdown(Math.round(r.shieldMs / 1_000));
  if (r.stealthMs > 0) _startStealthCountdown(Math.round(r.stealthMs / 1_000));
  if (r.radarMs > 0) _startRadarCountdown(Math.round(r.radarMs / 1_000));
  if (!r.isAlive && r.respawnMs != null) {
    _startRespawnCountdown(Math.round(r.respawnMs / 1_000));
  }
}

function _applyLocalPowerupFeedback({ type }) {
  // Update local store state so UI reflects the effect immediately
  switch (type) {
    case 'fastReload':
      _startFastReloadCountdown(120);
      break;
    case 'healthPack':
      hp.set(get(maxHp));
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
      airstrikeReady.update((n) => n + 1);
      break;
    case 'apacheSupport':
      apacheReady.update((n) => n + 1);
      break;
  }
}

// Local 1-second ticker that drives the shield badge countdown.
let _shieldTimer = null;

function _startShieldCountdown(secs) {
  _stopShieldCountdown();
  shieldActive.set(true);
  shieldCountdown.set(secs);
  _shieldTimer = setInterval(() => {
    shieldCountdown.update((v) => {
      if (v === null) return null;
      const next = v - 1;
      if (next <= 0) {
        _stopShieldCountdown();
        return null;
      }
      return next;
    });
  }, 1_000);
}

function _stopShieldCountdown() {
  if (_shieldTimer) {
    clearInterval(_shieldTimer);
    _shieldTimer = null;
  }
  shieldActive.set(false);
  shieldCountdown.set(null);
}

// Local 1-second ticker that drives the stealth badge countdown.
let _stealthTimer = null;

function _startStealthCountdown(secs) {
  _stopStealthCountdown();
  stealthActive.set(true);
  stealthCountdown.set(secs);
  _stealthTimer = setInterval(() => {
    stealthCountdown.update((v) => {
      if (v === null) return null;
      const next = v - 1;
      if (next <= 0) {
        _stopStealthCountdown();
        return null;
      }
      return next;
    });
  }, 1_000);
}

function _stopStealthCountdown() {
  if (_stealthTimer) {
    clearInterval(_stealthTimer);
    _stealthTimer = null;
  }
  stealthActive.set(false);
  stealthCountdown.set(null);
}

// Local 1-second ticker that drives the fast reload badge countdown.
let _fastReloadTimer = null;

function _startFastReloadCountdown(secs) {
  _stopFastReloadCountdown();
  fastReloadActive.set(true);
  fastReloadCountdown.set(secs);
  _fastReloadTimer = setInterval(() => {
    fastReloadCountdown.update((v) => {
      if (v === null) return null;
      const next = v - 1;
      if (next <= 0) {
        _stopFastReloadCountdown();
        return null;
      }
      return next;
    });
  }, 1_000);
}

function _stopFastReloadCountdown() {
  if (_fastReloadTimer) {
    clearInterval(_fastReloadTimer);
    _fastReloadTimer = null;
  }
  fastReloadActive.set(false);
  fastReloadCountdown.set(null);
}

// Local 1-second ticker that drives the radar badge countdown.
let _radarTimer = null;

function _startRadarCountdown(secs) {
  _stopRadarCountdown();
  radarActive.set(true);
  radarCountdown.set(secs);
  _radarTimer = setInterval(() => {
    radarCountdown.update((v) => {
      if (v === null) return null;
      const next = v - 1;
      if (next <= 0) {
        _stopRadarCountdown();
        return null;
      }
      return next;
    });
  }, 1_000);
}

function _stopRadarCountdown() {
  if (_radarTimer) {
    clearInterval(_radarTimer);
    _radarTimer = null;
  }
  radarActive.set(false);
  radarCountdown.set(null);
}

// Local 1-second ticker that drives the on-screen respawn countdown while dead.
let _respawnTimer = null;

function _startRespawnCountdown(secs) {
  _stopRespawnCountdown();
  respawnCountdown.set(secs);
  _respawnTimer = setInterval(() => {
    respawnCountdown.update((v) => {
      if (v === null) return null;
      const next = v - 1;
      if (next <= 0) {
        _stopRespawnCountdown();
        return 0;
      }
      return next;
    });
  }, 1_000);
}

function _stopRespawnCountdown() {
  if (_respawnTimer) {
    clearInterval(_respawnTimer);
    _respawnTimer = null;
  }
}
