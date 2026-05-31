import { S2C, C2S } from '../shared/messages.js';
import { GameManager } from './GameManager.js';

let nextRoomId = 1;

export class RoomManager {
  constructor() {
    this._rooms = new Map();       // roomId -> { id, name, manager }
    this._playerRoom = new Map();  // player.id -> roomId
    this._unroomedWs = new Set();  // ws sockets not yet in a room
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

    const room = this._rooms.get(roomId);
    if (room) room.manager.handleMessage(player, msg);
  }

  // Called on WebSocket close
  removePlayer(player) {
    const roomId = this._playerRoom.get(player.id);
    if (roomId !== undefined) {
      const room = this._rooms.get(roomId);
      if (room) {
        room.manager.removePlayer(player);
        if (room.manager.players.size === 0) {
          room.manager.destroy();
          this._rooms.delete(roomId);
        }
      }
      this._playerRoom.delete(player.id);
    } else {
      this._unroomedWs.delete(player.ws);
    }
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
    return [...this._rooms.values()].map(r => ({
      id: r.id,
      name: r.name,
      playerCount: r.manager.players.size,
      state: r.manager.state,
    }));
  }

  _sendRoomList(ws) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: S2C.ROOMS_LIST, rooms: this._getPublicList() }));
    }
  }

  _broadcastRoomList() {
    const msg = JSON.stringify({ type: S2C.ROOMS_LIST, rooms: this._getPublicList() });
    for (const ws of this._unroomedWs) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
}
