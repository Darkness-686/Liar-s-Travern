const {
  ROOM_CODE_LENGTH, MAX_PLAYERS, MIN_CHAMBER, MAX_CHAMBER,
  AI_NAMES, AI_DIFFICULTIES, TURN_TIMEOUT_SECONDS, WAITING_DISCONNECT_GRACE_MS
} = require('./config');
const Game = require('./game');
const { decide, createMemory } = require('./ai');
const users = require('./users');

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

function removePlayerFromAllRooms(io, accountName, exceptRoomCode = null) {
  for (const [code, room] of rooms.entries()) {
    if (code === exceptRoomCode) continue;
    const idx = room.players.findIndex(p => p.id === accountName);
    if (idx < 0) continue;

    const player = room.players[idx];
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    if (player.socketId) {
      socketRoomMap.delete(player.socketId);
      const oldSocket = io.sockets.sockets.get(player.socketId);
      if (oldSocket) oldSocket.leave(code);
    }

    room.players.splice(idx, 1);
    if (player.isHost && room.players.length > 0) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }
    if (room.players.length === 0) {
      clearTimers(room);
      rooms.delete(code);
    } else {
      broadcastRoomState(room);
    }
    broadcastLobby(io);
  }
}

function createPlayer({ accountName, socketId, isHost, isAI, name }) {
  return {
    id: accountName,
    accountName,
    socketId,
    name: name || accountName,
    isHost,
    isAI,
    hand: [],
    alive: true,
    revolver: null,
    disconnectedAt: null,
    disconnectTimer: null
  };
}

function createRoom(io, socket, accountName) {
  removePlayerFromAllRooms(io, accountName);

  const code = generateCode();
  const hostId = accountName;
  const player = createPlayer({
    accountName,
    socketId: socket.id,
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
    turnTimer: null,
    io
  };

  rooms.set(code, room);
  socket.join(code);
  socketRoomMap.set(socket.id, { roomCode: code, playerId: player.id });
  broadcastRoomState(room);
  broadcastLobby(io);
  return { code, playerId: player.id };
}

function joinRoom(io, socket, code, accountName) {
  removePlayerFromAllRooms(io, accountName, code.toUpperCase());

  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: '房间不存在' };
  if (room.game) return { error: '游戏已经开始' };
  if (room.players.length >= MAX_PLAYERS) return { error: '房间已满' };
  if (room.players.some(p => p.id === accountName && p.socketId)) {
    return { error: '你已经在该房间中' };
  }

  // If this account is reconnecting to a disconnected seat, reclaim it
  const existing = room.players.find(p => p.id === accountName && !p.socketId);
  if (existing) {
    return reconnect(io, socket, accountName);
  }

  const player = createPlayer({
    accountName,
    socketId: socket.id,
    isHost: false,
    isAI: false
  });

  room.players.push(player);
  socket.join(room.code);
  socketRoomMap.set(socket.id, { roomCode: room.code, playerId: player.id });
  broadcastRoomState(room);
  broadcastLobby(io);
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
  while (room.players.length < MAX_PLAYERS) {
    const aiId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const aiIndex = room.players.filter(p => p.isAI).length % AI_NAMES.length;
    const aiName = AI_NAMES[aiIndex];
    room.players.push(createPlayer({
      accountName: aiId,
      socketId: null,
      isHost: false,
      isAI: true,
      name: aiName
    }));
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
  room.game.aiMemory = createMemory();
  room.gameoverHandled = false;

  animateDealAndResume(room);
  broadcastLobby(io);
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
      alive: p.alive,
      connected: !!p.socketId
    }))
  };
  room.io.to(room.code).emit('room-state', state);
}

function broadcastGameState(room) {
  if (!room.game) return;

  // Emit ranking result before the final game-state so the client can render both together
  if (room.game.phase === 'gameover' && !room.gameoverHandled) {
    handleGameOver(room);
  }

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

function getReputationDelta(rank) {
  switch (rank) {
    case 1: return 10;
    case 2: return 5;
    case 3: return 2;
    case 4: return -3;
    default: return 0;
  }
}

function handleGameOver(room) {
  if (room.gameoverHandled) return;
  room.gameoverHandled = true;

  const ranking = room.game.getRanking();
  const changes = [];
  const humanRanking = [];

  for (const entry of ranking) {
    const player = room.players.find(p => p.id === entry.playerId);
    if (!player || !player.accountName) continue; // AI or disconnected player

    const delta = getReputationDelta(entry.rank);
    changes.push({ name: player.accountName, delta });
    humanRanking.push({
      rank: entry.rank,
      name: player.name,
      accountName: player.accountName,
      reputationChange: delta
    });
  }

  const newReputations = users.applyReputationChanges(changes);

  for (const entry of humanRanking) {
    if (entry.accountName && typeof newReputations[entry.accountName] === 'number') {
      entry.newReputation = newReputations[entry.accountName];
    }
    delete entry.accountName;
  }

  // Broadcast result to all connected human players
  const result = { ranking: humanRanking };
  for (const p of room.players) {
    if (p.socketId) {
      room.io.to(p.socketId).emit('gameover-result', result);
    }
  }
}

function clearAiTimer(room) {
  if (room.aiTimer) {
    clearTimeout(room.aiTimer);
    room.aiTimer = null;
  }
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

function clearTimers(room) {
  clearAiTimer(room);
  clearTurnTimer(room);
}

function animateDealAndResume(room) {
  clearTimers(room);
  if (!room.game) return;
  const aliveIds = room.game.players.filter(p => p.alive).map(p => p.id);
  emitToRoom(room, 'deal-cards', { recipients: aliveIds, count: 5 });
  room.aiTimer = setTimeout(() => {
    if (!room.game) return;
    if (room.game.phase !== 'gameover') {
      room.game.phase = 'playing';
    }
    broadcastGameState(room);
    scheduleTurn(room);
  }, 1300);
}

function scheduleTurn(room) {
  clearTurnTimer(room);
  if (!room.game || room.game.phase !== 'playing') return;
  const current = room.game.getCurrentPlayer();
  if (!current || !current.alive) return;

  if (current.isAI || !current.socketId) {
    scheduleAiTurn(room);
  } else {
    startHumanTurnTimer(room, current.id);
  }
}

function startHumanTurnTimer(room, playerId) {
  clearTurnTimer(room);
  if (!room.game || room.game.phase !== 'playing') return;
  const current = room.game.getCurrentPlayer();
  if (!current || current.id !== playerId || current.isAI || !current.socketId) return;

  const total = TURN_TIMEOUT_SECONDS;
  let remaining = total;

  const tick = () => {
    if (!room.game || room.game.phase !== 'playing') {
      clearTurnTimer(room);
      return;
    }
    const now = room.game.getCurrentPlayer();
    if (!now || now.id !== playerId || now.isAI || !now.socketId) {
      clearTurnTimer(room);
      return;
    }

    room.io.to(now.socketId).emit('turn-tick', { remaining, total });

    if (remaining <= 0) {
      clearTurnTimer(room);
      autoPlayCurrentPlayer(room, playerId);
      return;
    }
    remaining--;
    room.turnTimer = setTimeout(tick, 1000);
  };

  room.turnTimer = setTimeout(tick, 0);
}

function autoPlayCurrentPlayer(room, playerId) {
  if (!room.game || room.game.phase !== 'playing') return;
  const current = room.game.getCurrentPlayer();
  if (!current || current.id !== playerId) return;

  clearAiTimer(room);

  if (room.game.lastPlay && room.game.lastPlay.playerId !== playerId) {
    const result = room.game.challenge(playerId);
    if (result.success) {
      emitToRoom(room, 'challenge-result', result);
      broadcastGameState(room);
      room.aiTimer = setTimeout(() => {
        if (!room.game || room.game.phase !== 'resolving') return;
        room.game.finishChallenge();
        if (room.game.phase === 'gameover') {
          broadcastGameState(room);
          scheduleTurn(room);
        } else {
          animateDealAndResume(room);
        }
      }, 4000);
    }
  } else if (current.hand.length === 0) {
    room.game.pass(playerId);
    broadcastGameState(room);
    scheduleTurn(room);
  } else {
    const card = current.hand[0];
    const res = room.game.playCards(playerId, [card.id]);
    if (res.success) {
      broadcastGameState(room);
      scheduleTurn(room);
    } else if (current.hand.length === 0) {
      room.game.pass(playerId);
      broadcastGameState(room);
      scheduleTurn(room);
    } else {
      // Defensive: should not reach here, but avoid stall
      broadcastGameState(room);
      scheduleTurn(room);
    }
  }
}

function scheduleAiTurn(room) {
  clearAiTimer(room);
  if (!room.game || room.game.phase !== 'playing') return;
  const current = room.game.getCurrentPlayer();
  if (!current || !current.isAI || !current.alive) return;

  const hasAliveHuman = room.game.players.some(p => p.alive && p.socketId);
  const delay = hasAliveHuman ? 3000 + Math.random() * 2000 : 0;

  room.aiTimer = setTimeout(() => {
    if (!room.game || room.game.phase !== 'playing') return;
    const player = room.game.getCurrentPlayer();
    if (!player || !player.isAI) return;

    const action = decide(room.game, player, room.config.aiDifficulty, room.game.aiMemory);
    if (action.action === 'challenge') {
      const result = room.game.challenge(player.id);
      if (result.success) {
        if (room.game.aiMemory) {
          room.game.aiMemory.recordChallengeInitiated(player.id);
          room.game.aiMemory.recordChallengeResult(result.accusedId, result.cards.length, result.isLiar);
        }
        emitToRoom(room, 'challenge-result', result);
        broadcastGameState(room);
        room.aiTimer = setTimeout(() => {
          if (!room.game || room.game.phase !== 'resolving') return;
          room.game.finishChallenge();
          if (room.game.phase === 'gameover') {
            broadcastGameState(room);
            scheduleTurn(room);
          } else {
            animateDealAndResume(room);
          }
        }, 3000);
      }
    } else if (action.action === 'play') {
      const res = room.game.playCards(player.id, action.cardIds);
      if (res.success) {
        if (room.game.aiMemory) {
          room.game.aiMemory.recordPlay(player.id, action.cardIds.length);
        }
        broadcastGameState(room);
        scheduleTurn(room);
      }
    } else {
      room.game.pass(player.id);
      broadcastGameState(room);
      scheduleTurn(room);
    }
  }, delay);
}

function handlePlayCards(io, socket, cardIds) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room || !room.game) return { error: '游戏未开始' };

  clearTimers(room);
  const result = room.game.playCards(info.playerId, cardIds);
  if (result.error) return result;

  if (room.game.aiMemory) {
    room.game.aiMemory.recordPlay(info.playerId, cardIds.length);
  }

  broadcastGameState(room);
  scheduleTurn(room);
  return { success: true };
}

function handleChallenge(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room || !room.game) return { error: '游戏未开始' };

  clearTimers(room);
  const result = room.game.challenge(info.playerId);
  if (result.error) return result;

  if (room.game.aiMemory) {
    room.game.aiMemory.recordChallengeInitiated(info.playerId);
    room.game.aiMemory.recordChallengeResult(result.accusedId, result.cards.length, result.isLiar);
  }

  emitToRoom(room, 'challenge-result', result);
  broadcastGameState(room);

  room.aiTimer = setTimeout(() => {
    if (!room.game || room.game.phase !== 'resolving') return;
    room.game.finishChallenge();
    if (room.game.phase === 'gameover') {
      broadcastGameState(room);
      scheduleTurn(room);
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

  clearTimers(room);
  const result = room.game.pass(info.playerId);
  if (result.error) return result;

  broadcastGameState(room);
  scheduleTurn(room);
  return { success: true };
}

function restartGame(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room) return { error: '房间不存在' };
  if (room.hostId !== info.playerId) return { error: '只有房主可以重新开始' };

  clearTimers(room);
  room.game = null;
  room.players = room.players.filter(p => !p.isAI);
  fillWithAI(room);
  room.game = new Game(room.players, room.hostId);
  room.game.start(room.config.chamberSize);
  room.game.aiMemory = createMemory();
  room.gameoverHandled = false;
  animateDealAndResume(room);
  broadcastLobby(io);
  return { success: true };
}

function disbandRoom(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room) return { error: '房间不存在' };
  if (room.hostId !== info.playerId) return { error: '只有房主可以解散房间' };

  clearTimers(room);
  emitToRoom(room, 'room-disbanded', {});

  for (const p of room.players) {
    if (p.socketId) socketRoomMap.delete(p.socketId);
  }
  rooms.delete(room.code);
  broadcastLobby(io);
  return { success: true };
}

function leaveRoom(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return { error: '不在房间中' };
  const room = rooms.get(info.roomCode);
  if (!room) return { error: '房间不存在' };

  socketRoomMap.delete(socket.id);
  socket.leave(room.code);

  const player = room.players.find(p => p.id === info.playerId);
  if (!player) return { error: '玩家不存在' };

  if (!room.game) {
    room.players = room.players.filter(p => p.id !== player.id);
    if (player.isHost && room.players.length > 0) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }
    if (room.players.length === 0) {
      clearTimers(room);
      rooms.delete(room.code);
    } else {
      broadcastRoomState(room);
    }
  } else {
    player.socketId = null;
    broadcastGameState(room);
    scheduleTurn(room);
  }

  broadcastLobby(io);
  return { success: true };
}

function reconnect(io, socket, accountName) {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.id === accountName && !p.socketId);
    if (!player) continue;

    // Cancel pending disconnect removal
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    player.disconnectedAt = null;

    player.socketId = socket.id;
    socket.join(room.code);
    socketRoomMap.set(socket.id, { roomCode: room.code, playerId: player.id });

    if (room.game) {
      broadcastGameState(room);
      scheduleTurn(room);
    } else {
      broadcastRoomState(room);
    }
    broadcastLobby(io);
    return { success: true, code: room.code, playerId: player.id };
  }
  return { error: '没有可恢复的房间' };
}

function convertToAI(room, player) {
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
  player.disconnectedAt = null;

  const oldId = player.id;
  const aiIndex = room.players.filter(p => p.isAI).length % AI_NAMES.length;
  const aiName = AI_NAMES[aiIndex];
  const aiId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  player.id = aiId;
  player.accountName = null;
  player.name = aiName;
  player.isAI = true;
  player.socketId = null;

  if (room.hostId === oldId) {
    room.hostId = aiId;
  }

  // Update game references if this player was the last to play
  if (room.game && room.game.lastPlay && room.game.lastPlay.playerId === oldId) {
    room.game.lastPlay.playerId = aiId;
  }

  // Update socketRoomMap entries for any still-attached sockets (shouldn't be any)
  for (const [sid, mapped] of socketRoomMap.entries()) {
    if (mapped.roomCode === room.code && mapped.playerId === oldId) {
      socketRoomMap.delete(sid);
    }
  }
}

function handleDisconnect(io, socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  socketRoomMap.delete(socket.id);
  if (!room) return;

  const player = room.players.find(p => p.id === info.playerId);
  if (!player) return;

  // Stale disconnect guard: player may have already reconnected with a new socket
  if (player.socketId !== socket.id) return;

  if (!room.game) {
    player.socketId = null;
    player.disconnectedAt = Date.now();

    player.disconnectTimer = setTimeout(() => {
      if (!rooms.has(room.code)) return;
      room.players = room.players.filter(p => p.id !== player.id);
      if (player.isHost && room.players.length > 0) {
        room.hostId = room.players[0].id;
        room.players[0].isHost = true;
      }
      if (room.players.length === 0) {
        clearTimers(room);
        rooms.delete(room.code);
      } else {
        broadcastRoomState(room);
      }
      broadcastLobby(io);
    }, WAITING_DISCONNECT_GRACE_MS);

    broadcastRoomState(room);
    broadcastLobby(io);
  } else {
    // During a game: host disconnects -> disband room; others -> convert to AI
    if (player.isHost || room.hostId === player.id) {
      clearTimers(room);
      emitToRoom(room, 'room-disbanded', { reason: '房主离线，房间已解散' });
      for (const p of room.players) {
        if (p.socketId) socketRoomMap.delete(p.socketId);
      }
      rooms.delete(room.code);
      broadcastLobby(io);
    } else {
      convertToAI(room, player);
      broadcastGameState(room);
      scheduleTurn(room);
    }
  }
}

function getRoomBySocket(socket) {
  const info = socketRoomMap.get(socket.id);
  if (!info) return null;
  return rooms.get(info.roomCode) || null;
}

function getLobbyRooms() {
  return Array.from(rooms.values()).map(r => ({
    code: r.code,
    hostName: r.players.find(p => p.id === r.hostId)?.name || '',
    playerCount: r.players.filter(p => !p.isAI).length,
    maxPlayers: MAX_PLAYERS,
    status: r.game ? 'playing' : 'waiting'
  }));
}

function broadcastLobby(io) {
  io.emit('lobby-update', { rooms: getLobbyRooms() });
}

module.exports = {
  createRoom,
  joinRoom,
  setConfig,
  setAIDifficulty,
  startGame,
  restartGame,
  disbandRoom,
  leaveRoom,
  handlePlayCards,
  handleChallenge,
  handlePass,
  handleDisconnect,
  reconnect,
  getRoomBySocket,
  getLobbyRooms,
  broadcastRoomState,
  broadcastGameState,
  broadcastLobby
};
