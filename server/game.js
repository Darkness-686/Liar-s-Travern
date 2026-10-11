const { createDeck, shuffle } = require('./deck');
const Revolver = require('./revolver');
const { RANKS, STARTING_HAND } = require('./config');
const { isTarget } = require('./ai');

class Game {
  constructor(players, hostId) {
    this.players = players;
    this.hostId = hostId;
    this.phase = 'waiting';
    this.deck = [];
    this.table = [];
    this.currentRank = 'Q';
    this.turnIndex = 0;
    this.lastPlay = null;
    this.winner = null;
    this.pendingChallenge = null;
  }

  start(chamberSize) {
    this.deck = shuffle(createDeck());

    for (const p of this.players) {
      p.alive = true;
      p.hand = [];
      p.revolver = new Revolver(chamberSize);
    }

    let dealIndex = 0;
    while (this.deck.length > 0 && dealIndex < this.players.length * STARTING_HAND) {
      const player = this.players[dealIndex % this.players.length];
      player.hand.push(this.deck.pop());
      dealIndex++;
    }

    for (const p of this.players) {
      this.sortHand(p);
    }

    this.currentRank = RANKS[Math.floor(Math.random() * RANKS.length)];
    this.table = [];
    this.lastPlay = null;
    this.winner = null;
    this.pendingChallenge = null;

    const aliveIndices = this.players
      .map((p, i) => (p.alive ? i : -1))
      .filter(i => i >= 0);
    this.turnIndex = aliveIndices.length > 0
      ? aliveIndices[Math.floor(Math.random() * aliveIndices.length)]
      : 0;

    this.phase = 'dealing';
  }

  sortHand(player) {
    const order = { Q: 1, K: 2, A: 3, JOKER: 4 };
    player.hand.sort((a, b) => order[a.rank] - order[b.rank]);
  }

  getCurrentPlayer() {
    return this.players[this.turnIndex];
  }

  nextAliveIndex(fromIndex) {
    const len = this.players.length;
    for (let i = 1; i <= len; i++) {
      const idx = (fromIndex + i) % len;
      if (this.players[idx].alive) return idx;
    }
    return -1;
  }

  nextTurn(attempts = 0) {
    if (attempts >= this.players.length) return;
    let idx = this.nextAliveIndex(this.turnIndex);
    if (idx < 0) return;
    this.turnIndex = idx;

    const p = this.getCurrentPlayer();
    if (p.hand.length === 0 && !this.lastPlay) {
      this.nextTurn(attempts + 1);
    }
  }

  playCards(playerId, cardIds) {
    if (this.phase !== 'playing') return { error: '不在游戏阶段' };
    const player = this.getCurrentPlayer();
    if (player.id !== playerId) return { error: '不是你的回合' };
    if (!this.canPlayCards(player)) {
      return { error: '其他玩家已出完，只能质疑' };
    }
    if (!cardIds || cardIds.length < 1 || cardIds.length > 3) {
      return { error: '每次只能出 1–3 张牌' };
    }

    const cards = [];
    for (const id of cardIds) {
      const card = player.hand.find(c => c.id === id);
      if (!card) return { error: '手牌中没有该牌' };
      cards.push(card);
    }

    for (const c of cards) {
      player.hand = player.hand.filter(x => x.id !== c.id);
    }

    this.table.push({ playerId, cards });
    this.lastPlay = { playerId, cards, count: cards.length };

    this.nextTurn();
    return { success: true };
  }

  pass(playerId) {
    if (this.phase !== 'playing') return { error: '不在游戏阶段' };
    const player = this.getCurrentPlayer();
    if (player.id !== playerId) return { error: '不是你的回合' };
    if (player.hand.length > 0) return { error: '有牌时不能跳过' };
    this.nextTurn();
    return { success: true };
  }

  canPlayCards(player) {
    const others = this.players.filter(p => p.alive && p.id !== player.id);
    if (others.length === 0) return false;
    if (others.every(p => p.hand.length === 0)) return false;
    return true;
  }

  challenge(accuserId) {
    if (this.phase !== 'playing') return { error: '不在游戏阶段' };
    if (!this.lastPlay) return { error: '没有可质疑的牌' };
    const accuser = this.getCurrentPlayer();
    if (accuser.id !== accuserId) return { error: '不是你的回合' };

    const accusedId = this.lastPlay.playerId;
    const accused = this.players.find(p => p.id === accusedId);
    const cards = this.lastPlay.cards;

    const isLiar = !cards.every(c => isTarget(c, this.currentRank));
    const loser = isLiar ? accused : accuser;
    const winner = isLiar ? accuser : accused;

    const shot = this.shoot(loser);

    this.pendingChallenge = { shooter: loser };
    this.phase = 'resolving';

    return {
      success: true,
      accusedId,
      accuserId,
      cards,
      isLiar,
      loserId: loser.id,
      fired: shot.fired,
      eliminated: !loser.alive,
      winnerId: winner.id
    };
  }

  finishChallenge() {
    if (this.phase !== 'resolving' || !this.pendingChallenge) return;
    const shooter = this.pendingChallenge.shooter;
    this.pendingChallenge = null;
    this.endRound(shooter);
  }

  shoot(player) {
    const shot = player.revolver.fire();
    if (shot.fired) {
      player.alive = false;
    }
    return shot;
  }

  endRound(shooter) {
    this.deck = [];
    for (const p of this.players) {
      this.deck.push(...p.hand);
      p.hand = [];
    }
    for (const t of this.table) {
      this.deck.push(...t.cards);
    }
    this.table = [];
    this.lastPlay = null;

    this.deck = shuffle(this.deck);

    let dealIndex = 0;
    const alivePlayers = this.players.filter(p => p.alive);
    while (this.deck.length > 0 && dealIndex < alivePlayers.length * STARTING_HAND) {
      const player = alivePlayers[dealIndex % alivePlayers.length];
      player.hand.push(this.deck.pop());
      dealIndex++;
    }

    for (const p of alivePlayers) {
      this.sortHand(p);
    }

    this.currentRank = RANKS[Math.floor(Math.random() * RANKS.length)];

    const shooterIdx = shooter ? this.players.findIndex(p => p.id === shooter.id) : -1;
    if (shooter && shooter.alive) {
      this.turnIndex = shooterIdx;
    } else if (shooterIdx >= 0) {
      this.turnIndex = this.nextAliveIndex(shooterIdx);
    } else {
      this.turnIndex = this.nextAliveIndex(-1);
    }
    if (this.turnIndex < 0) this.turnIndex = 0;

    this.checkWin();

    if (this.phase !== 'gameover') {
      this.phase = 'dealing';
    }
  }

  checkWin() {
    const alive = this.players.filter(p => p.alive);
    if (alive.length <= 1) {
      this.phase = 'gameover';
      this.winner = alive[0] || null;
    }
  }

  getPublicState() {
    return {
      phase: this.phase,
      currentRank: this.currentRank,
      turnIndex: this.turnIndex,
      turnPlayerId: this.getCurrentPlayer()?.id || null,
      lastPlay: this.lastPlay ? {
        playerId: this.lastPlay.playerId,
        count: this.lastPlay.count
      } : null,
      tableCount: this.table.reduce((sum, t) => sum + t.cards.length, 0),
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        isAI: p.isAI,
        alive: p.alive,
        handCount: p.hand.length,
        revolver: p.revolver.toJSON()
      })),
      winner: this.winner ? { id: this.winner.id, name: this.winner.name } : null
    };
  }

  getStateForPlayer(playerId) {
    const state = this.getPublicState();
    const p = this.players.find(x => x.id === playerId);
    if (p) state.myHand = p.hand;
    return state;
  }
}

module.exports = Game;
