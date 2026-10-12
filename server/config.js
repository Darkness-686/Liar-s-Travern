const path = require('path');
require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  USERS_FILE_PATH: process.env.USERS_FILE_PATH || path.join(__dirname, '..', 'data', 'users.json'),
  TURN_TIMEOUT_SECONDS: 20,
  WAITING_DISCONNECT_GRACE_MS: 2 * 60 * 1000,
  MAX_PLAYERS: 4,
  STARTING_HAND: 5,
  MIN_CHAMBER: 5,
  MAX_CHAMBER: 8,
  ROOM_CODE_LENGTH: 4,
  AI_NAMES: ['AI-白子', 'AI-星野', 'AI-爱丽丝', 'AI-未花'],
  AI_DIFFICULTIES: ['easy', 'normal', 'hard'],
  RANKS: ['Q', 'K', 'A'],
  RANK_NAMES: { Q: '皇后', K: '国王', A: 'Ace' },
  REPUTATION_RESET_HOUR: 0
};
