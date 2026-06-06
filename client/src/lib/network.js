import { get } from 'svelte/store';
import { S2C, C2S, GAME_STATES } from '../../../shared/messages.js';
import {
  myId, isHost, players, gameConfig, hostId,
  gameState, scores, timeRemaining, killFeed,
  countdownAt, screen, finalScores, winner, resetGame,
  ammo, maxAmmo, shieldActive, stealthActive, radarActive, airstrikeReady, airstrikeArmed, gunSlotId,
  hp, maxHp, isAlive, respawnCountdown, killedBy, lastHitAt, bulletsPerMag, reloadDelaySecs,
  rooms, roomName, username, saveSession,
  gameId, roundId,
  ctfState, infectionState,
} from '../stores/game.js';
import { teammates, firingEnemies, powerups, airstrikes, graves, ctfBases, ctfFlags } from '../stores/map.js';
import { playKilled, playRespawn, playAirstrikeWarning } from './audio.js';

let ws = null;
let _getPosition = () => ({ lat: null, lng: null });

export function setPositionGetter(fn) {
  _getPosition = fn;
}

export function connect(serverUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(serverUrl);
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
    ws.onmessage = e => _handle(JSON.parse(e.data));
    ws.onclose = () => {
      gameState.set(GAME_STATES.WAITING);
    };
  });
}

export function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

export function sendRegister(name) {
  send({ type: C2S.REGISTER, username: name });
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

export function sendSetBase(team, lat, lng) {
  send({ type: C2S.SET_BASE, team, lat, lng });
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
      myId.set(msg.playerId);
      saveSession(get(username));
      screen.set('roomselect');
      break;

    case S2C.ROOMS_LIST:
      rooms.set(msg.rooms ?? []);
      break;

    case S2C.JOINED:
      myId.set(msg.playerId);
      isHost.set(msg.isHost);
      players.set(msg.lobbyState.players);
      gameConfig.set(msg.lobbyState.config);
      hostId.set(msg.lobbyState.hostId);
      roomName.set(msg.lobbyState.roomName ?? '');
      if (msg.lobbyState.gameId) gameId.set(msg.lobbyState.gameId);
      if (msg.lobbyState.state) gameState.set(msg.lobbyState.state);
      screen.set('lobby');
      break;

    case S2C.LOBBY_UPDATE:
      players.set(msg.players);
      gameConfig.set(msg.config);
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
      graves.set([]);
      ctfBases.set({ red: null, blue: null });
      ctfFlags.set({ red: null, blue: null });
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
      break;

    case S2C.POSITIONS:
      teammates.set(msg.teammates ?? []);
      firingEnemies.set(msg.firingEnemies ?? []);
      break;

    case S2C.POWERUPS:
      powerups.set(msg.packages ?? []);
      break;

    case S2C.AIRSTRIKE_INCOMING:
      airstrikes.update(list => [
        ...list.filter(a => a.id !== msg.id),
        { id: msg.id, lat: msg.lat, lng: msg.lng, radius: msg.radius, detonateAt: msg.detonateAt },
      ]);
      playAirstrikeWarning();
      break;

    case S2C.AIRSTRIKE_HIT:
      // Blast resolved — drop the warning marker. Damage arrives via PLAYER_HP/DEAD.
      airstrikes.update(list => list.filter(a => a.id !== msg.id));
      break;

    case S2C.PLAYER_HP:
      if (msg.playerId === get(myId)) {
        if (msg.hp < get(hp)) lastHitAt.set(Date.now());
        hp.set(msg.hp);
        maxHp.set(msg.maxHp);
      }
      break;

    case S2C.PLAYER_DEAD:
      // Drop/refresh a tombstone at every player's latest death spot (own included).
      if (msg.lat != null && msg.lng != null) {
        graves.update(list => [
          ...list.filter(g => g.id !== msg.playerId),
          { id: msg.playerId, username: msg.username, lat: msg.lat, lng: msg.lng },
        ]);
      }
      if (msg.playerId === get(myId)) {
        hp.set(0);
        isAlive.set(false);
        killedBy.set(msg.killerName ?? null);
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
        isAlive.set(true);
        killedBy.set(null);
        playRespawn();
        _stopRespawnCountdown();
        respawnCountdown.set(null);
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

function _applyLocalPowerupFeedback({ type }) {
  // Update local store state so UI reflects the effect immediately
  switch (type) {
    case 'fullReload': ammo.set(get(maxAmmo)); break;
    case 'healthPack': hp.set(get(maxHp)); break;
    case 'shield': shieldActive.set(true); break;
    case 'stealth': stealthActive.set(true); break;
    case 'radar':
      radarActive.set(true);
      // Radar lasts one minute server-side; clear the indicator to match.
      setTimeout(() => radarActive.set(false), 60_000);
      break;
    case 'airstrike': airstrikeReady.update(n => n + 1); break;
  }
}

// Local 1-second ticker that drives the on-screen respawn countdown while dead.
let _respawnTimer = null;

function _startRespawnCountdown(secs) {
  _stopRespawnCountdown();
  respawnCountdown.set(secs);
  _respawnTimer = setInterval(() => {
    respawnCountdown.update(v => {
      if (v === null) return null;
      const next = v - 1;
      if (next <= 0) { _stopRespawnCountdown(); return 0; }
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
