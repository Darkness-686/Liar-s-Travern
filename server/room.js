const { ROOM_CODE_LENGTH, MAX_PLAYERS, MIN_CHAMBER, MAX_CHAMBER, AI_NAMES, AI_DIFFICULTIES } = require('./config');
const Game = require('./game');
const { decide } = require('./ai');

const rooms = new Map();
const socketRoomMap = new Map(); // socketId -> { roomCode, playerId }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateCode() : code;
}

function createPlayer({ id, socketId, name, isHost, isAI }) {
  return {
    id,
    socketId,
    name,
    isHost,
    isAI,
    hand: [],
    alive: true,
    revolver: null
  };
}

function createRoom(io, socket, playerName) {
  const code = generateCode();
  const hostId = socket.id;
  const player = createPlayer({
    id: hostId,
    socketId: socket.id,
    name: playerName || '房主',
    isHost: true,
    isAI: false
  });

  const room = {
    code,
    players: [player],
    hostId,
    config: { chamberSize: 6, aiDifficulty: 'normal' },
    game: null,
    aiTimer: null,
    io
  };

  rooms.set(code, room);
  socket.join(code);
  socketRoomMap.set(socket.id, { roomCode: code, playerId: player.id });
  broadcastRoomState(room);
  return { code, playerId: player.id };
}

function joinRoom(io, socket, code, playerName) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: '房间不存在' };
  if (room.game) return { error: '游戏已经开始' };
  if (room.players.length >= MAX_PLAYERS) return { error: '房间已满' };

  const player = createPlayer({
    id: socket.id,
    socketId: socket.id,
    name: playerName || '玩家',
    isHost: false,
    isAI: false
  });

  room.players.push(player);
  socket.join(room.code);
  socketRoomMap.set(socket.id, { roomCode: room.code, playerId: player.id });
  broadcastRoomState(room);
  return { code: room.code, playerId: player.id };
}

function setConfig(io, socket, chamberSize) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room) return { error: '房间不存在' };
  if (room.hostId !== info.playerId) return { error: '只有房主可以设置' };

  const size = parseInt(chamberSize, 10);
  if (size < MIN_CHAMBER || size > MAX_CHAMBER) {
    return { error: `弹膛数必须在 ${MIN_CHAMBER}–${MAX_CHAMBER} 之间` };
  }
  room.config.chamberSize = size;
  broadcastRoomState(room);
  return { success: true };
}

function setAIDifficulty(io, socket, difficulty) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room) return { error: '房间不存在' };
  if (room.hostId !== info.playerId) return { error: '只有房主可以设置' };
  if (!AI_DIFFICULTIES.includes(difficulty)) {
    return { error: 'AI 强度只能是 easy / normal / hard' };
  }
  room.config.aiDifficulty = difficulty;
  broadcastRoomState(room);
  return { success: true };
}

function fillWithAI(room) {
  let aiIndex = 0;
  while (room.players.length < MAX_PLAYERS) {
    const aiId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    room.players.push(createPlayer({
      id: aiId,
      socketId: null,
      name: AI_NAMES[aiIndex % AI_NAMES.length],
      isHost: false,
      isAI: true
    }));
    aiIndex++;
  }
}

function startGame(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room) return { error: '房间不存在' };
  if (room.hostId !== info.playerId) return { error: '只有房主可以开始' };
  if (room.game) return { error: '游戏已经开始' };

  fillWithAI(room);
  room.game = new Game(room.players, room.hostId);
  room.game.start(room.config.chamberSize);

  animateDealAndResume(room);
  return { success: true };
}

function broadcastRoomState(room) {
  const state = {
    code: room.code,
    hostId: room.hostId,
    config: room.config,
    aiDifficulty: room.config.aiDifficulty,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      isAI: p.isAI,
      connected: !!p.socketId
    }))
  };
  room.io.to(room.code).emit('room-state', state);
}

function broadcastGameState(room) {
  if (!room.game) return;
  for (const p of room.players) {
    if (!p.socketId) continue;
    const state = room.game.getStateForPlayer(p.id);
    state.code = room.code;
    room.io.to(p.socketId).emit('game-state', state);
  }
}

function emitToRoom(room, event, payload) {
  room.io.to(room.code).emit(event, payload);
}

function clearAiTimer(room) {
  if (room.aiTimer) {
    clearTimeout(room.aiTimer);
    room.aiTimer = null;
  }
}

function animateDealAndResume(room) {
  clearAiTimer(room);
  if (!room.game) return;
  const aliveIds = room.game.players.filter(p => p.alive).map(p => p.id);
  emitToRoom(room, 'deal-cards', { recipients: aliveIds, count: 5 });
  room.aiTimer = setTimeout(() => {
    if (!room.game) return;
    if (room.game.phase !== 'gameover') {
      room.game.phase = 'playing';
    }
    broadcastGameState(room);
    scheduleAiTurn(room);
  }, 1300);
}

function scheduleAiTurn(room) {
  clearAiTimer(room);
  if (!room.game || room.game.phase !== 'playing') return;
  const current = room.game.getCurrentPlayer();
  if (!current || !current.isAI || !current.alive) return;

  // 3~5 秒随机思考；若所有真人玩家都已淘汰，AI 不再停顿
  const hasAliveHuman = room.game.players.some(p => p.alive && p.socketId);
  const delay = hasAliveHuman ? 3000 + Math.random() * 2000 : 0;

  room.aiTimer = setTimeout(() => {
    if (!room.game || room.game.phase !== 'playing') return;
    const player = room.game.getCurrentPlayer();
    if (!player || !player.isAI) return;

    const action = decide(room.game, player, room.config.aiDifficulty);
    if (action.action === 'challenge') {
      const result = room.game.challenge(player.id);
      if (result.success) {
        emitToRoom(room, 'challenge-result', result);
        broadcastGameState(room);
        // 3 秒后完成结算
        room.aiTimer = setTimeout(() => {
          if (!room.game || room.game.phase !== 'resolving') return;
          room.game.finishChallenge();
          if (room.game.phase === 'gameover') {
            broadcastGameState(room);
            scheduleAiTurn(room);
          } else {
            animateDealAndResume(room);
          }
        }, 3000);
      }
    } else if (action.action === 'play') {
      const res = room.game.playCards(player.id, action.cardIds);
      if (res.success) {
        broadcastGameState(room);
        scheduleAiTurn(room);
      }
    } else {
      room.game.pass(player.id);
      broadcastGameState(room);
      scheduleAiTurn(room);
    }
  }, delay);
}

function handlePlayCards(io, socket, cardIds) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room || !room.game) return { error: '游戏未开始' };

  clearAiTimer(room);
  const result = room.game.playCards(info.playerId, cardIds);
  if (result.error) return result;

  broadcastGameState(room);
  scheduleAiTurn(room);
  return { success: true };
}

function handleChallenge(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room || !room.game) return { error: '游戏未开始' };

  clearAiTimer(room);
  const result = room.game.challenge(info.playerId);
  if (result.error) return result;

  emitToRoom(room, 'challenge-result', result);
  broadcastGameState(room);

  // 4 秒后完成结算（所有人看开枪 UI 期间不能操作）
  room.aiTimer = setTimeout(() => {
    if (!room.game || room.game.phase !== 'resolving') return;
    room.game.finishChallenge();
    if (room.game.phase === 'gameover') {
      broadcastGameState(room);
      scheduleAiTurn(room);
    } else {
      animateDealAndResume(room);
    }
  }, 4000);

  return { success: true };
}

function handlePass(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room || !room.game) return { error: '游戏未开始' };

  clearAiTimer(room);
  const result = room.game.pass(info.playerId);
  if (result.error) return result;

  broadcastGameState(room);
  scheduleAiTurn(room);
  return { success: true };
}

function restartGame(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room) return { error: '房间不存在' };
  if (room.hostId !== info.playerId) return { error: '只有房主可以重新开始' };

  clearAiTimer(room);
  room.game = null;
  // 保留真人玩家，移除上一局的 AI
  room.players = room.players.filter(p => !p.isAI);
  // 重新补齐 AI 并立即开局
  fillWithAI(room);
  room.game = new Game(room.players, room.hostId);
  room.game.start(room.config.chamberSize);
  animateDealAndResume(room);
  return { success: true };
}

function disbandRoom(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room) return { error: '房间不存在' };
  if (room.hostId !== info.playerId) return { error: '只有房主可以解散房间' };

  clearAiTimer(room);
  emitToRoom(room, 'room-disbanded', {});

  for (const p of room.players) {
    if (p.socketId) socketRoomMap.delete(p.socketId);
  }
  rooms.delete(room.code);
  return { success: true };
}

function handleDisconnect(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  socketRoomMap.delete(socket.id);
  if (!room) return;

  const player = room.players.find(p => p.id === info.playerId);
  if (!player) return;

  if (!room.game) {
    // 等待阶段直接移除
    room.players = room.players.filter(p => p.id !== player.id);
    if (player.isHost && room.players.length > 0) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }
    if (room.players.length === 0) {
      clearAiTimer(room);
      rooms.delete(room.code);
      return;
    }
    broadcastRoomState(room);
  } else {
    // 游戏中转成 AI 托管
    player.socketId = null;
    broadcastGameState(room);
  }
}

function getRoomBySocket(socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return null;
  return rooms.get(info.roomCode) || null;
}

module.exports = {
  createRoom,
  joinRoom,
  setConfig,
  setAIDifficulty,
  startGame,
  restartGame,
  disbandRoom,
  handlePlayCards,
  handleChallenge,
  handlePass,
  handleDisconnect,
  getRoomBySocket,
  broadcastRoomState,
  broadcastGameState
};
