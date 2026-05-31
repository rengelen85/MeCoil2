// WebSocket message types shared between server and client

export const C2S = {
  JOIN: 'join',
  READY: 'ready',
  GAME_CONFIG: 'gameConfig',
  START_GAME: 'startGame',
  STOP_GAME: 'stopGame',
  POSITION: 'position',
  FIRE: 'fire',
  HIT: 'hit',
  COLLECT: 'collect',
};

export const S2C = {
  JOINED: 'joined',
  LOBBY_UPDATE: 'lobbyUpdate',
  COUNTDOWN: 'countdown',
  GAME_STARTED: 'gameStarted',
  GAME_STATE: 'gameState',
  POSITIONS: 'positions',
  POWERUPS: 'powerups',
  GAME_ENDED: 'gameEnded',
  ERROR: 'error',
};

export const GAME_MODES = {
  FFA: 'ffa',
  TEAM_DEATHMATCH: 'tdm',
  CAPTURE_THE_FLAG: 'ctf',
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

export const POWERUP_TYPES = {
  FULL_RELOAD: 'fullReload',
  SHIELD: 'shield',
  STEALTH: 'stealth',
};
