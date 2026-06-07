// Copied from shared/messages.js — keep in sync with the root shared/ file.

export const C2S = {
  REGISTER: 'register',
  REJOIN: 'rejoin',       // { playerId, username } — resume session after WiFi drop
  LIST_ROOMS: 'listRooms',
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  LEAVE_ROOM: 'leaveRoom',
  READY: 'ready',
  GAME_CONFIG: 'gameConfig',
  START_GAME: 'startGame',
  STOP_GAME: 'stopGame',
  POSITION: 'position',
  FIRE: 'fire',
  HIT: 'hit',
  COLLECT: 'collect',
  DEPLOY_AIRSTRIKE: 'deployAirstrike', // player calls in a held airstrike at a chosen point
  SET_BASE: 'setBase',                 // CTF: host sets a team's base location
  SET_GAME_AREA: 'setGameArea',        // host sets optional play area boundary (circle or polygon)
  SWITCH_TEAM: 'switchTeam',           // player requests to move to the other team
};

export const S2C = {
  REGISTERED: 'registered',
  REJOIN_FAILED: 'rejoinFailed', // session not found or expired — client should re-register
  ROOMS_LIST: 'roomsList',
  JOINED: 'joined',
  LOBBY_UPDATE: 'lobbyUpdate',
  COUNTDOWN: 'countdown',
  GAME_STARTED: 'gameStarted',
  GAME_STATE: 'gameState',
  POSITIONS: 'positions',
  POWERUPS: 'powerups',
  PLAYER_HP: 'playerHp',           // a player's health changed (after a hit or heal)
  PLAYER_DEAD: 'playerDead',       // a player's HP hit zero; carries respawnIn (secs)
  PLAYER_RESPAWN: 'playerRespawn', // a dead player is alive again with full HP
  AIRSTRIKE_INCOMING: 'airstrikeIncoming', // an airstrike is inbound; carries detonateAt so everyone can evacuate
  AIRSTRIKE_HIT: 'airstrikeHit',           // an airstrike detonated; carries blast center/radius for the FX
  GAME_ENDED: 'gameEnded',
  LEFT_ROOM: 'leftRoom',
  ERROR: 'error',
};

export const GAME_MODES = {
  FFA: 'ffa',
  TEAM_DEATHMATCH: 'tdm',
  CAPTURE_THE_FLAG: 'ctf',
  INFECTION: 'infection',
};

export const GAME_STATES = {
  WAITING: 'waiting',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  ENDED: 'ended',
};

export const TEAMS = {
  NONE: 'none',
  RED: 'red',
  BLUE: 'blue',
};

// Per-mode weapon damage (HP removed per landed hit). PLASMA is dynamic — see
// PLASMA_DAMAGE_PER_AMMO — and scales with the rounds loaded when the shot was
// fired. Keys match the GUN_MODES keys in client/src/lib/ble.js.
export const GUN_MODE_DAMAGE = {
  semi: 20,
  auto: 5,
  burst: 10,
};
export const PLASMA_DAMAGE_PER_AMMO = 3; // plasma damage = loaded ammo * this

// Lethal blast radius for an airstrike (metres). Shared so the client can
// render an accurate preview circle before the server confirms deployment.
export const AIRSTRIKE_RADIUS_M = 30;

export const POWERUP_TYPES = {
  FULL_RELOAD: 'fullReload',
  HEALTH_PACK: 'healthPack', // restores the collector to full HP
  SHIELD: 'shield',          // grants bonus HP on top of max
  STEALTH: 'stealth',
  RADAR: 'radar',            // reveals every living enemy on the collector's map for a while
  AIRSTRIKE: 'airstrike',    // a held strike the collector can later place on the map
  IMMUNITY: 'immunity',      // Infection only: absorbs one shot; if hit while active, grants 20s grace window
};
