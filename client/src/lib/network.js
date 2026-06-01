import { get } from 'svelte/store';
import { S2C, C2S, GAME_STATES } from '../../../shared/messages.js';
import {
  myId, isHost, players, gameConfig, hostId,
  gameState, scores, timeRemaining, killFeed,
  countdownAt, screen, finalScores, winner, resetGame,
  ammo, shieldActive, stealthActive, gunSlotId,
  rooms, roomName, username, saveSession,
  gameId, roundId,
} from '../stores/game.js';
import { teammates, firingEnemies, powerups } from '../stores/map.js';

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

export function sendFire() {
  const { lat, lng } = _getPosition();
  send({ type: C2S.FIRE, lat, lng });
}

export function sendHit(shooterWeaponId) {
  send({ type: C2S.HIT, shooterWeaponId });
}

export function sendCollect(powerupId) {
  send({ type: C2S.COLLECT, powerupId });
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
      gameConfig.set({ mode: msg.mode, timeLimit: msg.timeLimit, scoreLimit: msg.scoreLimit });
      if (msg.roundId) roundId.set(msg.roundId);
      gameState.set(GAME_STATES.PLAYING);
      resetGame();
      // Clear stale positions/power-ups from a previous round so the fresh
      // map doesn't briefly render last game's markers.
      teammates.set([]);
      firingEnemies.set([]);
      powerups.set([]);
      screen.set('ingame');
      break;
    }

    case S2C.GAME_STATE:
      if (msg.scores) scores.set(msg.scores);
      if (msg.timeRemaining != null) timeRemaining.set(msg.timeRemaining);
      if (msg.killFeed) killFeed.set(msg.killFeed);
      if (msg.event?.powerupCollected) {
        _applyLocalPowerupFeedback(msg.event.powerupCollected);
      }
      break;

    case S2C.POSITIONS:
      teammates.set(msg.teammates ?? []);
      firingEnemies.set(msg.firingEnemies ?? []);
      break;

    case S2C.POWERUPS:
      powerups.set(msg.packages ?? []);
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
    case 'fullReload': ammo.set(30); break;
    case 'shield': shieldActive.set(true); break;
    case 'stealth': stealthActive.set(true); break;
  }
}
