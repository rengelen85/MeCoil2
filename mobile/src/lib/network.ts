import { S2C, C2S, GAME_STATES } from 'shared/messages.js';
import { useGameStore, saveSession } from '../stores/game.js';
import { useMapStore } from '../stores/map.js';
import { playKilled, playRespawn } from './audio.js';

let ws: WebSocket | null = null;
let _getPosition: () => { lat: number | null; lng: number | null } = () => ({
  lat: null,
  lng: null,
});

export function setPositionGetter(fn: () => { lat: number | null; lng: number | null }) {
  _getPosition = fn;
}

export function connect(serverUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(serverUrl);
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
    ws.onmessage = e => _handle(JSON.parse(e.data));
    ws.onclose = () => {
      useGameStore.getState().setGameState(GAME_STATES.WAITING);
    };
  });
}

export function disconnect() {
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
export const sendStopGame = () => send({ type: C2S.STOP_GAME });
export const sendPosition = (lat: number, lng: number) =>
  send({ type: C2S.POSITION, lat, lng });

export function sendFire() {
  const { lat, lng } = _getPosition();
  send({ type: C2S.FIRE, lat, lng });
}

export const sendHit = (shooterWeaponId: number) =>
  send({ type: C2S.HIT, shooterWeaponId });
export const sendCollect = (powerupId: number) =>
  send({ type: C2S.COLLECT, powerupId });

function _handle(msg: { type: string; [key: string]: unknown }) {
  const game = useGameStore.getState();
  const map = useMapStore.getState();

  switch (msg.type) {
    case S2C.REGISTERED:
      game.setMyId(msg.playerId as number);
      saveSession(game.username);
      game.setScreen('roomselect');
      break;

    case S2C.ROOMS_LIST:
      game.setRooms((msg.rooms as []) ?? []);
      break;

    case S2C.JOINED: {
      const ls = msg.lobbyState as Record<string, unknown>;
      game.setMyId(msg.playerId as number);
      game.setIsHost(msg.isHost as boolean);
      game.setPlayers((ls.players as []) ?? []);
      game.setGameConfig(ls.config as object);
      game.setHostId(ls.hostId as number);
      game.setRoomName((ls.roomName as string) ?? '');
      if (ls.gameId) game.setGameId(ls.gameId as string);
      if (ls.state) game.setGameState(ls.state as string);
      game.setScreen('lobby');
      break;
    }

    case S2C.LOBBY_UPDATE: {
      game.setPlayers((msg.players as []) ?? []);
      game.setGameConfig(msg.config as object);
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
      const slot = assignments[myId!] ?? 0;
      const hpMax = (msg.hpPerPlayer as number) ?? 100;
      const mag = (msg.bulletsPerMag as number) ?? 30;
      game.setGunSlotId(slot);
      game.setGameConfig({
        mode: msg.mode as string,
        timeLimit: msg.timeLimit as number,
        scoreLimit: msg.scoreLimit as number,
        bulletsPerMag: mag,
        hpPerPlayer: hpMax,
        hpCostPerHit: (msg.hpCostPerHit as number) ?? 25,
        reloadDelaySecs: (msg.reloadDelaySecs as number) ?? 3,
        respawnDelaySecs: (msg.respawnDelaySecs as number) ?? 10,
      });
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
      map.setTeammates([]);
      map.setFiringEnemies([]);
      map.setPowerups([]);
      game.setScreen('ingame');
      break;
    }

    case S2C.GAME_STATE:
      if (msg.scores) game.setScores(msg.scores as []);
      if (msg.timeRemaining != null) game.setTimeRemaining(msg.timeRemaining as number);
      if (msg.killFeed) game.setKillFeed(msg.killFeed as []);
      if ((msg.event as Record<string, unknown>)?.powerupCollected) {
        _applyLocalPowerupFeedback(
          (msg.event as Record<string, unknown>).powerupCollected as { type: string },
        );
      }
      break;

    case S2C.POSITIONS:
      map.setTeammates((msg.teammates as []) ?? []);
      map.setFiringEnemies((msg.firingEnemies as []) ?? []);
      break;

    case S2C.POWERUPS:
      map.setPowerups((msg.packages as []) ?? []);
      break;

    case S2C.PLAYER_HP:
      if (msg.playerId === game.myId) {
        game.setHp(msg.hp as number);
        game.setMaxHp(msg.maxHp as number);
      }
      break;

    case S2C.PLAYER_DEAD:
      if (msg.playerId === game.myId) {
        game.setHp(0);
        game.setIsAlive(false);
        playKilled();
        _startRespawnCountdown((msg.respawnIn as number) ?? 10);
      }
      break;

    case S2C.PLAYER_RESPAWN:
      if (msg.playerId === game.myId) {
        game.setHp(msg.hp as number);
        game.setMaxHp(msg.maxHp as number);
        game.setIsAlive(true);
        playRespawn();
        _stopRespawnCountdown();
        game.setRespawnCountdown(null);
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

function _applyLocalPowerupFeedback({ type }: { type: string }) {
  const game = useGameStore.getState();
  switch (type) {
    case 'fullReload':
      game.setAmmo(game.maxAmmo);
      break;
    case 'healthPack':
      game.setHp(game.maxHp);
      break;
    case 'shield':
      game.setShieldActive(true);
      break;
    case 'stealth':
      game.setStealthActive(true);
      break;
  }
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
