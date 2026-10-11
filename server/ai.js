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

// 入门：基本随机策略
function decideEasy(game, player) {
  const lastPlay = game.lastPlay;
  const hand = player.hand;

  if (hand.length === 0) {
    if (!lastPlay) return { action: 'pass' };
    return Math.random() < 0.5 ? { action: 'challenge' } : { action: 'pass' };
  }

  if (mustChallenge(game, player)) {
    return { action: 'challenge' };
  }

  if (lastPlay) {
    let challengeChance = 0.3;
    if (lastPlay.count >= 3) challengeChance -= 0.1;
    if (hand.some(c => isTarget(c, game.currentRank))) challengeChance -= 0.05;
    if (Math.random() < challengeChance) {
      return { action: 'challenge' };
    }
  }

  const maxPlay = Math.min(3, hand.length);
  const count = Math.floor(Math.random() * maxPlay) + 1;
  const rankCards = hand.filter(c => isTarget(c, game.currentRank));
  const chosen = [];

  const truthCount = Math.min(rankCards.length, count);
  if (truthCount > 0 && Math.random() > 0.25) {
    chosen.push(...rankCards.slice(0, truthCount));
  }

  const remaining = hand.filter(c => !chosen.includes(c));
  while (chosen.length < count && remaining.length > 0) {
    const idx = Math.floor(Math.random() * remaining.length);
    chosen.push(remaining.splice(idx, 1)[0]);
  }

  return { action: 'play', cardIds: chosen.map(c => c.id) };
}

// 普通：会看自己的手牌推断上家撒谎概率
function decideNormal(game, player) {
  const lastPlay = game.lastPlay;
  const hand = player.hand;

  if (hand.length === 0) {
    if (!lastPlay) return { action: 'pass' };
    return Math.random() < 0.5 ? { action: 'challenge' } : { action: 'pass' };
  }

  if (mustChallenge(game, player)) {
    return { action: 'challenge' };
  }

  if (lastPlay) {
    const ownTarget = hand.filter(c => isTarget(c, game.currentRank)).length;
    const totalTargets = 8; // 6 张当前点数 + 2 张王
    const expected = (5 * (totalTargets - ownTarget)) / 15;

    let lieProbability = 0.25;
    if (lastPlay.count > expected + 0.5) lieProbability += 0.25;
    if (ownTarget >= 3) lieProbability += 0.2;
    if (lastPlay.count === 3) lieProbability += 0.15;
    if (lastPlay.count === 1) lieProbability -= 0.1;

    if (Math.random() < lieProbability) {
      return { action: 'challenge' };
    }
  }

  const rankCards = hand.filter(c => isTarget(c, game.currentRank));
  const maxPlay = Math.min(3, hand.length);

  if (rankCards.length > 0) {
    // 有真牌尽量出真牌，数量 1~3 张
    const count = Math.min(rankCards.length, Math.floor(Math.random() * maxPlay) + 1);
    const chosen = rankCards.slice(0, count);
    return { action: 'play', cardIds: chosen.map(c => c.id) };
  }

  // 没有真牌就虚张声势，只出 1 张更安全
  const chosen = pickRandomCards(hand, 1);
  return { action: 'play', cardIds: chosen.map(c => c.id) };
}

// 高级：用概率估算，出牌更谨慎
function decideHard(game, player) {
  const lastPlay = game.lastPlay;
  const hand = player.hand;

  if (hand.length === 0) {
    if (!lastPlay) return { action: 'pass' };
    // 没牌时，如果上家出牌数多或自己确定是谎话就质疑
    if (lastPlay.count >= 3) return { action: 'challenge' };
    return Math.random() < 0.45 ? { action: 'challenge' } : { action: 'pass' };
  }

  if (mustChallenge(game, player)) {
    return { action: 'challenge' };
  }

  if (lastPlay) {
    const ownTarget = hand.filter(c => isTarget(c, game.currentRank)).length;
    const remainingTarget = 8 - ownTarget; // 未知牌中剩余的目标牌
    // 上家手牌 5 张，未知牌共 15 张
    const pTruth = probabilityAtLeast(15, remainingTarget, 5, lastPlay.count);

    let threshold = 0.35;
    if (lastPlay.count === 1) threshold = 0.42;
    if (lastPlay.count === 3) threshold = 0.28;
    if (ownTarget >= 4) threshold -= 0.08;

    if (pTruth < threshold) {
      return { action: 'challenge' };
    }
  }

  const rankCards = hand.filter(c => isTarget(c, game.currentRank));

  if (rankCards.length > 0) {
    // 能真话就真话；牌多时空手快就一次多出一些
    const handIsMostlyTarget = rankCards.length >= hand.length * 0.6;
    let count = handIsMostlyTarget ? Math.min(rankCards.length, 3) : Math.min(rankCards.length, 2);
    if (count > 1 && Math.random() < 0.35) count = 1; // 偶尔保守
    const chosen = rankCards.slice(0, count);
    return { action: 'play', cardIds: chosen.map(c => c.id) };
  }

  // 必须撒谎时只出 1 张，降低被质疑代价
  const chosen = pickRandomCards(hand, 1);
  return { action: 'play', cardIds: chosen.map(c => c.id) };
}

function decide(game, player, difficulty = 'normal') {
  switch (difficulty) {
    case 'easy': return decideEasy(game, player);
    case 'hard': return decideHard(game, player);
    case 'normal':
    default: return decideNormal(game, player);
  }
}

module.exports = { decide, isTarget };
