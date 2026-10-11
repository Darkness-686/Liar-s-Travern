require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  MAX_PLAYERS: 4,
  STARTING_HAND: 5,
  MIN_CHAMBER: 5,
  MAX_CHAMBER: 8,
  ROOM_CODE_LENGTH: 4,
  AI_NAMES: ['AI-小白', 'AI-阿花', 'AI-老K', 'AI-小丑'],
  AI_DIFFICULTIES: ['easy', 'normal', 'hard'],
  RANKS: ['Q', 'K', 'A'],
  RANK_NAMES: { Q: '皇后', K: '国王', A: 'Ace' }
};
