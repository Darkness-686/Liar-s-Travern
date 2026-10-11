const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config');
const room = require('./room');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/sound', express.static(path.join(__dirname, '..', 'sound')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

io.on('connection', (socket) => {
  console.log('connect', socket.id);

  socket.on('create-room', (data, callback) => {
    const result = room.createRoom(io, socket, data?.playerName);
    safeCallback(callback, result);
  });

  socket.on('join-room', (data, callback) => {
    const result = room.joinRoom(io, socket, data?.roomCode, data?.playerName);
    safeCallback(callback, result);
  });

  socket.on('set-config', (data, callback) => {
    const result = room.setConfig(io, socket, data?.chamberSize);
    safeCallback(callback, result);
  });

  socket.on('set-ai-difficulty', (data, callback) => {
    const result = room.setAIDifficulty(io, socket, data?.difficulty);
    safeCallback(callback, result);
  });

  socket.on('start-game', (data, callback) => {
    const result = room.startGame(io, socket);
    safeCallback(callback, result);
  });

  socket.on('play-cards', (data, callback) => {
    const result = room.handlePlayCards(io, socket, data?.cardIds);
    safeCallback(callback, result);
  });

  socket.on('challenge', (data, callback) => {
    const result = room.handleChallenge(io, socket);
    safeCallback(callback, result);
  });

  socket.on('pass', (data, callback) => {
    const result = room.handlePass(io, socket);
    safeCallback(callback, result);
  });

  socket.on('restart-game', (data, callback) => {
    const result = room.restartGame(io, socket);
    safeCallback(callback, result);
  });

  socket.on('disband-room', (data, callback) => {
    const result = room.disbandRoom(io, socket);
    safeCallback(callback, result);
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    room.handleDisconnect(io, socket);
  });
});

function safeCallback(callback, payload) {
  if (typeof callback === 'function') {
    callback(payload);
  }
}

server.listen(config.PORT, () => {
  console.log(`Cheat Bar server running on port ${config.PORT}`);
});
