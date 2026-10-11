const socket = io();

// DOM refs
const screens = {
  lobby: document.getElementById('lobby-screen'),
  room: document.getElementById('room-screen'),
  game: document.getElementById('game-screen')
};

const els = {
  playerName: document.getElementById('player-name'),
  roomCode: document.getElementById('room-code'),
  btnCreate: document.getElementById('btn-create'),
  btnJoin: document.getElementById('btn-join'),
  lobbyError: document.getElementById('lobby-error'),

  displayRoomCode: document.getElementById('display-room-code'),
  btnCopyCode: document.getElementById('btn-copy-code'),
  playerList: document.getElementById('player-list'),
  hostConfig: document.getElementById('host-config'),
  chamberSize: document.getElementById('chamber-size'),
  chamberValue: document.getElementById('chamber-value'),
  roomTip: document.getElementById('room-tip'),
  btnStart: document.getElementById('btn-start'),
  btnLeave: document.getElementById('btn-leave'),
  roomError: document.getElementById('room-error'),

  currentRank: document.getElementById('current-rank'),
  pileCount: document.getElementById('pile-count'),
  pile: document.getElementById('pile'),
  myHand: document.getElementById('my-hand'),
  btnPlay: document.getElementById('btn-play'),
  btnChallenge: document.getElementById('btn-challenge'),
  btnPass: document.getElementById('btn-pass'),
  turnHint: document.getElementById('turn-hint'),

  challengeOverlay: document.getElementById('challenge-overlay'),
  challengeTitle: document.getElementById('challenge-title'),
  revealedCards: document.getElementById('revealed-cards'),
  challengeDesc: document.getElementById('challenge-desc'),
  shotResult: document.getElementById('shot-result'),

  gameoverOverlay: document.getElementById('gameover-overlay'),
  winnerText: document.getElementById('winner-text'),

  hostDecisionOverlay: document.getElementById('host-decision-overlay'),
  hostWinnerSummary: document.getElementById('host-winner-summary'),
  btnRestart: document.getElementById('btn-restart'),
  btnDisband: document.getElementById('btn-disband'),

  waitingHostOverlay: document.getElementById('waiting-host-overlay'),

  aiDifficulty: document.getElementById('ai-difficulty'),
  aiDisplay: document.getElementById('ai-display'),
  aiDisplayValue: document.getElementById('ai-display-value'),

  btnRules: document.getElementById('btn-rules'),
  rulesOverlay: document.getElementById('rules-overlay'),
  btnCloseRules: document.getElementById('btn-close-rules')
};

const sounds = {
  victory: document.getElementById('victory-sound'),
  empty: document.getElementById('empty-sound'),
  shot: document.getElementById('shot-sound'),
  cards: document.getElementById('cards-sound'),
  distribution: document.getElementById('distribution-sound')
};

function playSound(name) {
  const audio = sounds[name];
  if (!audio) return;
  try {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch (e) {}
}

let myPlayerId = null;
let roomCode = null;
let isHost = false;
let roomState = null;
let gameState = null;
let selectedCardIds = new Set();
let gameoverTimer = null;
let gameoverHandled = false;
let prevGameState = null;

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function setError(el, msg) {
  el.textContent = msg || '';
  if (msg) setTimeout(() => { el.textContent = ''; }, 3000);
}

function getAvatar(name) {
  return (name || '?').charAt(0).toUpperCase();
}

// Lobby events
els.btnCreate.addEventListener('click', () => {
  const name = els.playerName.value.trim();
  if (!name) return setError(els.lobbyError, '请输入昵称');
  socket.emit('create-room', { playerName: name }, (res) => {
    if (res.error) return setError(els.lobbyError, res.error);
    myPlayerId = res.playerId;
    roomCode = res.code;
    isHost = true;
    showScreen('room');
    if (roomState) renderRoom(roomState);
  });
});

els.btnJoin.addEventListener('click', () => {
  const name = els.playerName.value.trim();
  if (!name) return setError(els.lobbyError, '请输入昵称');
  const code = els.roomCode.value.trim().toUpperCase();
  if (!code) return setError(els.lobbyError, '请输入房间码');
  socket.emit('join-room', { roomCode: code, playerName: name }, (res) => {
    if (res.error) return setError(els.lobbyError, res.error);
    myPlayerId = res.playerId;
    roomCode = res.code;
    isHost = false;
    showScreen('room');
    if (roomState) renderRoom(roomState);
  });
});

els.btnCopyCode.addEventListener('click', () => {
  if (roomCode) navigator.clipboard.writeText(roomCode).catch(() => {});
});

els.chamberSize.addEventListener('input', () => {
  els.chamberValue.textContent = els.chamberSize.value;
});

els.chamberSize.addEventListener('change', () => {
  socket.emit('set-config', { chamberSize: parseInt(els.chamberSize.value, 10) }, (res) => {
    if (res.error) setError(els.roomError, res.error);
  });
});

els.aiDifficulty.addEventListener('change', () => {
  socket.emit('set-ai-difficulty', { difficulty: els.aiDifficulty.value }, (res) => {
    if (res.error) setError(els.roomError, res.error);
  });
});

els.btnStart.addEventListener('click', () => {
  socket.emit('start-game', {}, (res) => {
    if (res.error) setError(els.roomError, res.error);
  });
});

els.btnLeave.addEventListener('click', () => {
  location.reload();
});

els.btnRestart.addEventListener('click', () => {
  socket.emit('restart-game', {}, (res) => {
    if (res.error) setError(els.roomError, res.error);
  });
  hideDecisionOverlays();
});

els.btnDisband.addEventListener('click', () => {
  socket.emit('disband-room', {}, (res) => {
    if (res.error) setError(els.roomError, res.error);
  });
});

els.btnRules.addEventListener('click', () => {
  els.rulesOverlay.classList.remove('hidden');
});

els.btnCloseRules.addEventListener('click', () => {
  els.rulesOverlay.classList.add('hidden');
});

els.rulesOverlay.addEventListener('click', (e) => {
  if (e.target === els.rulesOverlay) {
    els.rulesOverlay.classList.add('hidden');
  }
});

function hideDecisionOverlays() {
  resetGameoverState();
}

function resetToLobby() {
  hideDecisionOverlays();
  myPlayerId = null;
  roomCode = null;
  isHost = false;
  roomState = null;
  gameState = null;
  selectedCardIds.clear();
  els.playerName.value = '';
  els.roomCode.value = '';
  showScreen('lobby');
}

// Game actions
els.btnPlay.addEventListener('click', () => {
  if (selectedCardIds.size === 0) return;
  const ids = Array.from(selectedCardIds);
  socket.emit('play-cards', { cardIds: ids }, (res) => {
    if (res.success) selectedCardIds.clear();
    else console.error(res.error);
  });
});

els.btnChallenge.addEventListener('click', () => {
  socket.emit('challenge', {}, (res) => {
    if (res.error) console.log(res.error);
  });
});

els.btnPass.addEventListener('click', () => {
  socket.emit('pass', {}, (res) => {
    if (res.error) console.log(res.error);
  });
});

socket.on('room-state', (state) => {
  renderRoom(state);
});

socket.on('game-state', (state) => {
  const prev = gameState;
  prevGameState = prev;
  gameState = state;
  showScreen('game');
  if (state.phase !== 'gameover') {
    hideDecisionOverlays();
  }
  renderGame();

  // 检测是否有新出牌，播放音效和飞牌动画
  const prevLast = prev?.lastPlay;
  const curLast = state.lastPlay;
  if (curLast && (!prevLast || prevLast.playerId !== curLast.playerId || prevLast.count !== curLast.count)) {
    playSound('cards');
    animatePlayFromSeat(curLast.playerId, curLast.count);
  }
});

socket.on('challenge-result', (result) => {
  showChallengeOverlay(result);
});

socket.on('deal-cards', (data) => {
  // 进入游戏界面并清掉上一局的弹窗
  showScreen('game');
  selectedCardIds.clear();
  resetGameoverState();
  els.challengeOverlay.classList.add('hidden');
  // 发牌动画期间冻结界面，防止误操作
  if (gameState) {
    gameState.phase = 'dealing';
    renderGame();
  }
  animateDealToSeats(data.recipients, data.count);
});

socket.on('room-disbanded', () => {
  resetToLobby();
});

function renderRoom(state) {
  roomState = state;
  roomCode = state.code;
  isHost = state.hostId === myPlayerId;
  els.displayRoomCode.textContent = state.code;

  els.playerList.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    li.className = p.isAI ? 'ai' : '';
    li.innerHTML = `
      <div class="avatar">${getAvatar(p.name)}</div>
      <div>
        <div>${p.name} ${p.id === myPlayerId ? '(你)' : ''}</div>
        ${p.isHost ? '<span class="tag">房主</span>' : ''}
        ${p.isAI ? '<span class="tag">AI</span>' : ''}
      </div>
    `;
    els.playerList.appendChild(li);
  });

  els.hostConfig.style.display = isHost ? 'block' : 'none';
  els.aiDisplay.style.display = isHost ? 'none' : 'block';
  els.chamberSize.value = state.config.chamberSize;
  els.chamberValue.textContent = state.config.chamberSize;

  const diffLabel = { easy: '入门', normal: '普通', hard: '高级' };
  const diff = state.config.aiDifficulty || 'normal';
  els.aiDifficulty.value = diff;
  els.aiDisplayValue.textContent = diffLabel[diff] || diff;

  els.btnStart.disabled = !isHost;
  if (isHost) {
    els.roomTip.innerHTML = '✋ <strong>你是房主</strong>，点击下方“开始游戏”即可开局（不足 4 人会自动补 AI）';
  } else {
    els.roomTip.textContent = '等待房主开始游戏…';
  }
}

const seatNames = ['bottom', 'right', 'top', 'left'];

function renderGame() {
  if (!gameState) return;
  const state = gameState;
  const players = state.players;
  const myIndex = players.findIndex(p => p.id === myPlayerId);

  els.currentRank.textContent = state.currentRank;
  els.pileCount.textContent = state.tableCount;

  // seats
  for (let i = 0; i < 4; i++) {
    const seatIdx = (myIndex + i) % 4;
    const p = players[seatIdx];
    const seatEl = document.getElementById(`seat-${seatNames[i]}`);
    seatEl.className = `seat ${seatNames[i]}`;
    if (state.turnPlayerId === p.id && p.alive && state.phase === 'playing') seatEl.classList.add('active');
    if (!p.alive) seatEl.classList.add('dead');

    const isMe = i === 0;
    const handHtml = isMe ? '' : renderOppHand(p.handCount);

    seatEl.innerHTML = `
      <div class="seat-info">
        <div class="seat-avatar">${getAvatar(p.name)}</div>
        <div class="seat-name">${p.name}</div>
        <div class="seat-meta">${p.handCount}</div>
        <div class="revolver-dots">${renderRevolver(p.revolver, p.alive)}</div>
      </div>
      ${handHtml}
    `;
  }

  // my hand
  renderHand();

  // actions
  const me = players.find(p => p.id === myPlayerId);
  const myTurn = state.turnPlayerId === myPlayerId && me && me.alive;
  const canAct = myTurn && state.phase === 'playing';
  const resolving = state.phase === 'resolving' || state.phase === 'dealing';
  const canChallenge = canAct && state.lastPlay && state.lastPlay.playerId !== myPlayerId;
  const canPass = canAct && me.handCount === 0;
  const othersEmpty = players.filter(p => p.alive && p.id !== myPlayerId).every(p => p.handCount === 0);
  const mustChallenge = canAct && state.lastPlay && me.handCount > 0 && othersEmpty;

  if (mustChallenge || resolving) selectedCardIds.clear();

  els.btnPlay.disabled = resolving || mustChallenge || !(canAct && selectedCardIds.size >= 1 && selectedCardIds.size <= 3);
  els.btnChallenge.disabled = resolving || !canChallenge;
  els.btnPass.disabled = resolving || !canPass;

  if (state.phase === 'gameover') {
    els.turnHint.textContent = '游戏结束';
    showGameover(state.winner);
  } else if (state.phase === 'dealing') {
    els.turnHint.textContent = '发牌中…';
  } else if (resolving) {
    els.turnHint.textContent = '结算中…';
  } else if (mustChallenge) {
    els.turnHint.textContent = '其他玩家已出完，只能质疑';
  } else if (myTurn) {
    els.turnHint.textContent = '你的回合';
  } else {
    const tp = players.find(p => p.id === state.turnPlayerId);
    els.turnHint.textContent = tp ? `等待 ${tp.name}…` : '';
  }
}

function renderRevolver(revolver, alive) {
  if (!revolver || !alive) return '';
  let dots = '';
  for (let i = 0; i < revolver.chamberSize; i++) {
    dots += `<div class="dot ${i === revolver.currentPos ? 'current' : ''}"></div>`;
  }
  return dots;
}

function renderOppHand(count) {
  let html = '<div class="opp-hand">';
  for (let i = 0; i < count; i++) {
    html += '<div class="opp-card"></div>';
  }
  html += '</div>';
  return html;
}

function renderHand() {
  els.myHand.innerHTML = '';
  const hand = gameState.myHand || [];
  hand.forEach(card => {
    const div = document.createElement('div');
    div.className = `card-item rank-${card.rank} ${selectedCardIds.has(card.id) ? 'selected' : ''}`;
    div.innerHTML = `
      <div class="card-rank">${cardRankText(card.rank)}</div>
      <div class="card-suit">${cardSuitText(card.rank)}</div>
    `;
    div.addEventListener('click', () => toggleCard(card.id));
    els.myHand.appendChild(div);
  });
}

function cardRankText(rank) {
  if (rank === 'JOKER') return '🃏';
  return rank;
}

function cardSuitText(rank) {
  if (rank === 'Q') return '皇后';
  if (rank === 'K') return '国王';
  if (rank === 'A') return 'Ace';
  return '王牌';
}

function toggleCard(id) {
  const me = gameState.players.find(p => p.id === myPlayerId);
  if (!me || !me.alive || gameState.turnPlayerId !== myPlayerId || gameState.phase !== 'playing') return;

  // 如果其他人都出完了，不能选牌
  const othersEmpty = gameState.players.filter(p => p.alive && p.id !== myPlayerId).every(p => p.handCount === 0);
  if (gameState.lastPlay && me.handCount > 0 && othersEmpty) return;

  if (selectedCardIds.has(id)) {
    selectedCardIds.delete(id);
  } else {
    if (selectedCardIds.size >= 3) return;
    selectedCardIds.add(id);
  }
  renderGame();
}

function showChallengeOverlay(result) {
  const state = gameState;
  const accused = state.players.find(p => p.id === result.accusedId);
  const loser = state.players.find(p => p.id === result.loserId);

  els.challengeTitle.textContent = result.isLiar ? '撒谎！' : '真话！';
  els.revealedCards.innerHTML = '';
  (result.cards || []).forEach(card => {
    const div = document.createElement('div');
    div.className = `card-item rank-${card.rank}`;
    div.innerHTML = `
      <div class="card-rank">${cardRankText(card.rank)}</div>
      <div class="card-suit">${cardSuitText(card.rank)}</div>
    `;
    els.revealedCards.appendChild(div);
  });

  const accusedName = `<strong>${accused?.name || ''}</strong>`;
  const loserName = `<strong>${loser?.name || ''}</strong>`;
  els.challengeDesc.innerHTML = result.isLiar
    ? `${accusedName} 撒谎，${loserName} 受罚。`
    : `${accusedName} 说真话，${loserName} 受罚。`;

  els.shotResult.className = 'shot-result ' + (result.fired ? 'fired' : 'safe');
  els.shotResult.textContent = result.fired ? '💥 中枪出局！' : '🔇 空枪存活';

  playSound(result.fired ? 'shot' : 'empty');

  els.challengeOverlay.classList.remove('hidden');
  setTimeout(() => {
    els.challengeOverlay.classList.add('hidden');
  }, 4000);
}

function showGameover(winner) {
  if (gameoverHandled) return;
  gameoverHandled = true;

  const winnerText = winner ? `胜利者：${winner.name}` : '所有人都出局了';
  els.winnerText.textContent = winnerText;
  els.hostWinnerSummary.textContent = winnerText;
  els.gameoverOverlay.classList.remove('hidden');

  playSound('victory');

  gameoverTimer = setTimeout(() => {
    els.gameoverOverlay.classList.add('hidden');
    if (isHost) {
      els.hostDecisionOverlay.classList.remove('hidden');
    } else {
      els.waitingHostOverlay.classList.remove('hidden');
    }
  }, 5000);
}

function resetGameoverState() {
  clearTimeout(gameoverTimer);
  gameoverTimer = null;
  gameoverHandled = false;
  els.gameoverOverlay.classList.add('hidden');
  els.hostDecisionOverlay.classList.add('hidden');
  els.waitingHostOverlay.classList.add('hidden');
}

function animateDealToSeats(recipients, count) {
  const state = gameState || roomState;
  if (!state || !myPlayerId) return;
  const myIndex = state.players.findIndex(p => p.id === myPlayerId);
  const pileRect = els.pile.getBoundingClientRect();
  const startX = pileRect.left + pileRect.width / 2 - 20;
  const startY = pileRect.top + pileRect.height / 2 - 28;

  const roundDelay = 180;
  const cardDelay = 60;

  for (let i = 0; i < count; i++) {
    recipients.forEach((playerId, rIdx) => {
      const playerIdx = state.players.findIndex(p => p.id === playerId);
      const rel = (playerIdx - myIndex + 4) % 4;
      const seatName = seatNames[rel];
      const targetEl = seatName === 'bottom' ? els.myHand : document.getElementById(`seat-${seatName}`);
      if (!targetEl) return;
      const targetRect = targetEl.getBoundingClientRect();
      const endX = targetRect.left + targetRect.width / 2 - 20;
      const endY = targetRect.top + targetRect.height / 2 - 28;

      const delay = i * roundDelay + rIdx * cardDelay;
      setTimeout(() => {
        const card = document.createElement('div');
        card.className = 'deal-card';
        card.style.left = `${startX}px`;
        card.style.top = `${startY}px`;
        document.body.appendChild(card);
        card.animate([
          { transform: 'translate(0, 0) scale(0.6)', opacity: 0.8 },
          { transform: `translate(${endX - startX}px, ${endY - startY}px) scale(1)`, opacity: 1 }
        ], { duration: 380, easing: 'ease-out', fill: 'forwards' });
        setTimeout(() => card.remove(), 400);
      }, delay);
    });
  }

  playSound('distribution');
}

function animatePlayFromSeat(playerId, count) {
  if (!gameState) return;
  const state = gameState;
  const myIndex = state.players.findIndex(p => p.id === myPlayerId);
  const playerIdx = state.players.findIndex(p => p.id === playerId);
  const rel = (playerIdx - myIndex + 4) % 4;
  const seatName = seatNames[rel];

  let sourceEl;
  if (seatName === 'bottom') {
    sourceEl = els.myHand;
  } else {
    sourceEl = document.getElementById(`seat-${seatName}`);
  }
  if (!sourceEl) return;

  const sourceRect = sourceEl.getBoundingClientRect();
  const targetRect = els.pile.getBoundingClientRect();

  const startX = sourceRect.left + sourceRect.width / 2 - 20;
  const startY = sourceRect.top + sourceRect.height / 2 - 28;
  const endX = targetRect.left + targetRect.width / 2 - 20;
  const endY = targetRect.top + targetRect.height / 2 - 28;

  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'fly-card';
    card.style.left = `${startX}px`;
    card.style.top = `${startY}px`;
    const offsetX = (i - count / 2) * 6;
    const offsetY = (i - count / 2) * 4;
    card.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    document.body.appendChild(card);

    const dx = endX - startX + (i - count / 2) * 10;
    const dy = endY - startY + (i - count / 2) * 6;
    card.animate([
      { transform: `translate(${offsetX}px, ${offsetY}px)` },
      { transform: `translate(${dx}px, ${dy}px)` }
    ], { duration: 500, easing: 'ease-in-out', fill: 'forwards' });

    setTimeout(() => card.remove(), 520);
  }
}
