function isTarget(card, rank) {
  return card.rank === rank || card.rank === 'JOKER';
}

function mustChallenge(game, player) {
  if (!game.lastPlay) return false;
  const others = game.players.filter(p => p.alive && p.id !== player.id);
  if (others.length === 0) return false;
  return others.every(p => p.hand.length === 0);
}

// 组合数 C(n,k)
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let res = 1;
  for (let i = 1; i <= k; i++) {
    res = res * (n - k + i) / i;
  }
  return res;
}

// 超几何分布：从 N 张里抽 n 张，成功牌 K 张，至少抽到 atLeast 张成功的概率
function probabilityAtLeast(remainingUnknown, unknownSuccess, handSize, atLeast) {
  const total = comb(remainingUnknown, handSize);
  if (total === 0) return 0;
  let good = 0;
  for (let k = atLeast; k <= handSize; k++) {
    good += comb(unknownSuccess, k) * comb(remainingUnknown - unknownSuccess, handSize - k);
  }
  return good / total;
}

function pickRandomCards(hand, count) {
  const copy = hand.slice();
  const chosen = [];
  for (let i = 0; i < count && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    chosen.push(copy.splice(idx, 1)[0]);
  }
  return chosen;
}

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ======================= 习惯学习（每场游戏隔离） =======================

function createMemory() {
  return {
    players: {},
    ensure(playerId) {
      if (!this.players[playerId]) {
        this.players[playerId] = {
          plays: 0,
          challenged: 0,
          liesCaught: 0,
          truthsVerified: 0,
          challengesMade: 0
        };
      }
      return this.players[playerId];
    },
    recordPlay(playerId, count) {
      this.ensure(playerId).plays++;
    },
    recordChallengeInitiated(accuserId) {
      this.ensure(accuserId).challengesMade++;
    },
    recordChallengeResult(accusedId, count, wasLie) {
      const s = this.ensure(accusedId);
      s.challenged++;
      if (wasLie) s.liesCaught++;
      else s.truthsVerified++;
    }
  };
}

function getStats(memory, playerId) {
  if (!memory) return null;
  return memory.ensure(playerId);
}

// 0-1，越高代表该玩家越爱撒谎
function getLieTendency(memory, playerId) {
  const s = getStats(memory, playerId);
  if (!s || (s.liesCaught + s.truthsVerified === 0)) return 0.5;
  let score = 0.5;
  score += s.liesCaught * 0.15;
  score -= s.truthsVerified * 0.10;
  return Math.max(0.2, Math.min(0.95, score));
}

// 0-1，越高代表 AI 自己近期形象越诚实，可以适当撒谎
function getOwnHonestImage(memory, playerId) {
  const s = getStats(memory, playerId);
  if (!s || (s.liesCaught + s.truthsVerified === 0)) return 0.5;
  let score = 0.5;
  score += s.truthsVerified * 0.10;
  score -= s.liesCaught * 0.20;
  return Math.max(0.1, Math.min(0.95, score));
}

// 0-1，越高代表该玩家越爱主动质疑别人
function getOpponentAggression(memory, playerId) {
  const s = getStats(memory, playerId);
  if (!s) return 0;
  return Math.min(0.5, s.challengesMade * 0.10);
}

// ======================= 共享决策工具 =======================

function getNextPlayer(game, player) {
  const idx = game.players.findIndex(p => p.id === player.id);
  if (idx < 0) return null;
  const nextIdx = game.nextAliveIndex(idx);
  return nextIdx >= 0 ? game.players[nextIdx] : null;
}

function countTargetCards(hand, rank) {
  return hand.filter(c => isTarget(c, rank)).length;
}

function countOwnPlayedTargets(game, player, rank) {
  return game.table
    .filter(t => t.playerId === player.id)
    .flatMap(t => t.cards)
    .filter(c => isTarget(c, rank)).length;
}

// 上家出牌为真话的概率
function lastPlayTruthProbability(game, player) {
  const lastPlay = game.lastPlay;
  if (!lastPlay) return 1;

  const accused = game.players.find(p => p.id === lastPlay.playerId);
  if (!accused || !accused.alive) return 1;

  const ownTarget = countTargetCards(player.hand, game.currentRank);
  const ownPlayedTargets = countOwnPlayedTargets(game, player, game.currentRank);
  const unknownTargets = Math.max(0, 8 - ownTarget - ownPlayedTargets);

  const otherHandsTotal = game.players
    .filter(p => p.alive && p.id !== player.id)
    .reduce((sum, p) => sum + p.hand.length, 0);

  return probabilityAtLeast(otherHandsTotal, unknownTargets, accused.hand.length, lastPlay.count);
}

// 质疑分数，越高越应该质疑
function challengeScore(game, player, memory) {
  const lastPlay = game.lastPlay;
  if (!lastPlay) return -Infinity;

  const accused = game.players.find(p => p.id === lastPlay.playerId);
  if (!accused || !accused.alive) return -Infinity;

  const pTruth = lastPlayTruthProbability(game, player);
  const ownTarget = countTargetCards(player.hand, game.currentRank);

  let score = (1 - pTruth);

  // 出牌数量信号
  if (lastPlay.count >= 3) score += 0.32;
  else if (lastPlay.count === 2) score += 0.08;

  // 自己目标牌多，上家更可能在撒谎
  if (ownTarget >= 4) score += 0.20;
  else if (ownTarget >= 3) score += 0.08;

  // 对手撒谎习惯
  const tendency = getLieTendency(memory, lastPlay.playerId);
  score += (tendency - 0.5) * 0.42;

  // 对手快没牌时更可疑
  if (accused.hand.length <= 1) score += 0.10;

  // 自身左轮风险：越接近实弹越保守一点
  const revolver = player.revolver;
  if (revolver && revolver.chamberSize > revolver.currentPos) {
    const firingRisk = 1 / (revolver.chamberSize - revolver.currentPos);
    score -= firingRisk * 0.12;
  }

  return score;
}

function shouldChallenge(game, player, memory, baseThreshold, noiseRange) {
  if (!game.lastPlay) return false;
  if (mustChallenge(game, player)) return true;

  const score = challengeScore(game, player, memory);
  const noise = (Math.random() * 2 - 1) * noiseRange;
  return score > baseThreshold + noise;
}

// 返回 0-1 的撒谎概率
function computeBluffProbability(game, player, memory) {
  const hand = player.hand;
  if (hand.length === 0) return 0;

  const targetCards = hand.filter(c => isTarget(c, game.currentRank));
  const targetRatio = targetCards.length / hand.length;

  // 真牌少则更倾向于撒谎
  let bluffProb = 0.65 - targetRatio * 0.65;

  // 自己诚实形象好时可以适度多撒谎
  const image = getOwnHonestImage(memory, player.id);
  bluffProb += (image - 0.5) * 0.30;

  // 下家如果很爱质疑，就少撒谎
  const nextPlayer = getNextPlayer(game, player);
  if (nextPlayer) {
    const agg = getOpponentAggression(memory, nextPlayer.id);
    bluffProb -= agg * 0.30;
  }

  // 手牌很少时更保守
  if (hand.length <= 2) bluffProb -= 0.15;

  return Math.max(0.05, Math.min(0.90, bluffProb));
}

function pickPlayCards(hand, rank, isBluff, count) {
  if (isBluff) {
    const nonTargets = shuffleArray(hand.filter(c => !isTarget(c, rank)));
    return nonTargets.slice(0, Math.min(count, nonTargets.length));
  }
  const targets = shuffleArray(hand.filter(c => isTarget(c, rank)));
  return targets.slice(0, Math.min(count, targets.length));
}

function choosePlayCount(hand, rank, isBluff, nextPlayerAggression) {
  const max = Math.min(3, hand.length);
  if (max <= 1) return max;

  if (isBluff) {
    // 多数情况下只出 1 张假牌，偶尔施压
    if (max >= 3 && nextPlayerAggression < 0.15 && Math.random() < 0.22) return 3;
    if (max >= 2 && nextPlayerAggression < 0.25 && Math.random() < 0.34) return 2;
    return 1;
  }

  // 说真话时更敢多出
  const targetCount = hand.filter(c => isTarget(c, rank)).length;
  if (targetCount >= 3 && Math.random() < 0.52) return Math.min(targetCount, 3, max);
  if (targetCount >= 2 && Math.random() < 0.78) return Math.min(targetCount, 2, max);
  return 1;
}

// ======================= 难度策略 =======================

// 入门：基本随机，偶尔犯蠢，让真人觉得有机可乘
function decideEasy(game, player, memory) {
  const lastPlay = game.lastPlay;
  const hand = player.hand;

  if (hand.length === 0) {
    if (!lastPlay) return { action: 'pass' };
    return Math.random() < 0.45 ? { action: 'challenge' } : { action: 'pass' };
  }

  if (mustChallenge(game, player)) {
    return { action: 'challenge' };
  }

  if (lastPlay && shouldChallenge(game, player, memory, 0.78, 0.26)) {
    return { action: 'challenge' };
  }

  const maxPlay = Math.min(3, hand.length);
  const count = Math.floor(Math.random() * maxPlay) + 1;
  const rankCards = hand.filter(c => isTarget(c, game.currentRank));

  // 低难度偶尔真假混出（很弱的行为）
  const chosen = [];
  const truthCount = Math.min(rankCards.length, count);
  if (truthCount > 0 && Math.random() < 0.55) {
    chosen.push(...shuffleArray(rankCards).slice(0, truthCount));
  }

  const remaining = shuffleArray(hand.filter(c => !chosen.includes(c)));
  while (chosen.length < count && remaining.length > 0) {
    chosen.push(remaining.pop());
  }

  return { action: 'play', cardIds: chosen.map(c => c.id) };
}

// 普通：会看概率，有较大随机性，偶尔跟着感觉走
function decideNormal(game, player, memory) {
  const lastPlay = game.lastPlay;
  const hand = player.hand;

  if (hand.length === 0) {
    if (!lastPlay) return { action: 'pass' };
    return Math.random() < 0.55 ? { action: 'challenge' } : { action: 'pass' };
  }

  if (mustChallenge(game, player)) {
    return { action: 'challenge' };
  }

  if (lastPlay && shouldChallenge(game, player, memory, 0.62, 0.18)) {
    return { action: 'challenge' };
  }

  const rankCards = hand.filter(c => isTarget(c, game.currentRank));
  const bluffProb = computeBluffProbability(game, player, memory);
  const isBluff = rankCards.length === 0 || Math.random() < bluffProb;

  const nextPlayer = getNextPlayer(game, player);
  const nextAgg = nextPlayer ? getOpponentAggression(memory, nextPlayer.id) : 0;
  const count = choosePlayCount(hand, game.currentRank, isBluff, nextAgg);
  const chosen = pickPlayCards(hand, game.currentRank, isBluff, count);

  if (chosen.length === 0) {
    // 兜底：随机选 1 张
    const fallback = pickRandomCards(hand, 1);
    return { action: 'play', cardIds: fallback.map(c => c.id) };
  }

  return { action: 'play', cardIds: chosen.map(c => c.id) };
}

// 高级：概率 + 习惯 + 情境，低噪声保持随机性但更有压迫感
function decideHard(game, player, memory) {
  const lastPlay = game.lastPlay;
  const hand = player.hand;

  if (hand.length === 0) {
    if (!lastPlay) return { action: 'pass' };
    // 没牌时只质疑明显可疑的
    if (lastPlay.count >= 3) return { action: 'challenge' };
    return shouldChallenge(game, player, memory, 0.72, 0.14)
      ? { action: 'challenge' }
      : { action: 'pass' };
  }

  if (mustChallenge(game, player)) {
    return { action: 'challenge' };
  }

  if (lastPlay && shouldChallenge(game, player, memory, 0.48, 0.12)) {
    return { action: 'challenge' };
  }

  const rankCards = hand.filter(c => isTarget(c, game.currentRank));
  const bluffProb = computeBluffProbability(game, player, memory);
  const isBluff = rankCards.length === 0 || Math.random() < bluffProb;

  const nextPlayer = getNextPlayer(game, player);
  const nextAgg = nextPlayer ? getOpponentAggression(memory, nextPlayer.id) : 0;
  const count = choosePlayCount(hand, game.currentRank, isBluff, nextAgg);
  const chosen = pickPlayCards(hand, game.currentRank, isBluff, count);

  if (chosen.length === 0) {
    const fallback = pickRandomCards(hand, 1);
    return { action: 'play', cardIds: fallback.map(c => c.id) };
  }

  return { action: 'play', cardIds: chosen.map(c => c.id) };
}

function decide(game, player, difficulty = 'normal', memory = null) {
  switch (difficulty) {
    case 'easy': return decideEasy(game, player, memory);
    case 'hard': return decideHard(game, player, memory);
    case 'normal':
    default: return decideNormal(game, player, memory);
  }
}

module.exports = { decide, isTarget, createMemory };
