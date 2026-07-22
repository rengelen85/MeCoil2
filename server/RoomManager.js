import { randomUUID } from 'node:crypto';
import { C2S, GAME_STATES, S2C } from '../shared/messages.js';
import { GameManager } from './GameManager.js';

// Grace window during which a dropped player's session (team, health, held
// power-ups, stats) is kept alive for a transparent REJOIN. Comfortably covers the
// client's auto-reconnect retry budget (~75s) so a typical WiFi blip in the lobby
// restores the session instead of falling through to a fresh register. During an
// active round the window is re-armed every tick (see _scheduleRemoval) so the
// slot survives for the whole game and the player can always rejoin.
const RECONNECT_GRACE_MS = 90_000;

let nextRoomId = 1;

export class RoomManager {
  constructor() {
    this._rooms = new Map(); // roomId -> { id, name, manager }
    this._playerRoom = new Map(); // player.id -> roomId
    this._unroomedWs = new Set(); // ws sockets not yet in a room
    this._pendingReconnect = new Map(); // player.id -> { player, roomId, timer }
  }

  // Called when a player first connects and sends REGISTER
  register(player) {
    this._unroomedWs.add(player.ws);
    player.send({ type: S2C.REGISTERED, playerId: player.id });
    this._sendRoomList(player.ws);
  }

  // Route all subsequent messages from the player
  handleMessage(player, msg) {
    const roomId = this._playerRoom.get(player.id);

    // Player is not in a room yet — only room-selection messages are valid
    if (roomId === undefined) {
      switch (msg.type) {
        case C2S.LIST_ROOMS:
          this._sendRoomList(player.ws);
          break;
        case C2S.CREATE_ROOM:
          this._createRoom(msg.name?.trim() || null, player);
          break;
        case C2S.JOIN_ROOM:
          this._joinRoom(msg.roomId, player);
          break;
      }
      return;
    }

    if (msg.type === C2S.LEAVE_ROOM) {
      this._leaveRoom(player, roomId);
      return;
    }

    const room = this._rooms.get(roomId);
    if (room) room.manager.handleMessage(player, msg);
  }

  // Called on WebSocket close — starts a grace period before removing the player.
  // If they reconnect in time and send REJOIN, their session is restored transparently.
  handleDisconnect(player) {
    const roomId = this._playerRoom.get(player.id);
    if (roomId === undefined) {
      // Player was on the room-select screen — no session to preserve
      this._unroomedWs.delete(player.ws);
      this._broadcastRoomList();
      return;
    }

    player.disconnected = true;
    this._scheduleRemoval(player, roomId);

    // Show the disconnected indicator to the other players in the room
    const room = this._rooms.get(roomId);
    if (room) room.manager._broadcastLobby();
    this._broadcastRoomList();
  }

  // Arm (or re-arm) the grace timer that removes a disconnected player. While a
  // round is live we keep re-arming instead of removing, so a dropped player's
  // slot — team, health, held power-ups, buffs and stats — survives for the whole
  // game and they can always REJOIN. Once the round ends (state back to WAITING)
  // the next tick removes them, so the lobby grace stays a bounded RECONNECT_GRACE_MS.
  _scheduleRemoval(player, roomId) {
    const timer = setTimeout(() => {
      const room = this._rooms.get(roomId);
      if (room && room.manager.state === GAME_STATES.PLAYING) {
        this._scheduleRemoval(player, roomId);
        return;
      }
      this._pendingReconnect.delete(player.id);
      this._immediateRemove(player, roomId);
      this._broadcastRoomList();
    }, RECONNECT_GRACE_MS);
    this._pendingReconnect.set(player.id, { player, roomId, timer });
  }

  // Called when a new WebSocket sends C2S.REJOIN.
  // Returns the restored Player on success, or null on failure (sends REJOIN_FAILED).
  rejoin(ws, playerId, username) {
    const pending = this._pendingReconnect.get(playerId);
    if (!pending || pending.player.username !== username) {
      ws.send(JSON.stringify({ type: S2C.REJOIN_FAILED }));
      return null;
    }

    clearTimeout(pending.timer);
    this._pendingReconnect.delete(playerId);

    const { player, roomId } = pending;
    player.ws = ws;
    player.disconnected = false;

    const room = this._rooms.get(roomId);
    if (room) {
      room.manager.onPlayerRejoined(player);
    }
    this._broadcastRoomList();
    return player;
  }

  _immediateRemove(player, roomId) {
    const room = this._rooms.get(roomId);
    if (room) {
      room.manager.removePlayer(player);
      if (room.manager.players.size === 0) {
        room.manager.destroy();
        this._rooms.delete(roomId);
      }
    }
    this._playerRoom.delete(player.id);
  }

  _leaveRoom(player, roomId) {
    // Cancel any pending reconnect grace timer
    const pending = this._pendingReconnect.get(player.id);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingReconnect.delete(player.id);
    }
    this._immediateRemove(player, roomId);
    this._unroomedWs.add(player.ws);
    player.send({ type: S2C.LEFT_ROOM, rooms: this._getPublicList() });
    this._broadcastRoomList();
  }

  _createRoom(name, player) {
    const id = nextRoomId++;
    const roomName = name || `Game ${id}`;
    const manager = new GameManager(roomName, () => this._broadcastRoomList());
    this._rooms.set(id, { id, name: roomName, manager });
    this._unroomedWs.delete(player.ws);
    this._playerRoom.set(player.id, id);
    manager.addPlayer(player);
    this._broadcastRoomList();
  }

  _joinRoom(roomId, player) {
    const room = this._rooms.get(roomId);
    if (!room) {
      player.send({ type: S2C.ERROR, message: 'Room not found.' });
      return;
    }
    this._unroomedWs.delete(player.ws);
    this._playerRoom.set(player.id, roomId);
    room.manager.addPlayer(player);
    this._broadcastRoomList();
  }

  _getPublicList() {
    return [...this._rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      playerCount: r.manager.players.size,
      state: r.manager.state,
    }));
  }

  _sendRoomList(ws) {
    if (ws.readyState === 1) {
      ws.send(
        JSON.stringify({ type: S2C.ROOMS_LIST, rooms: this._getPublicList() }),
      );
    }
  }

  _broadcastRoomList() {
    const msg = JSON.stringify({
      type: S2C.ROOMS_LIST,
      rooms: this._getPublicList(),
    });
    for (const ws of this._unroomedWs) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
}
