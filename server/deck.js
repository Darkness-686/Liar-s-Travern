const { RANKS } = require('./config');

function createDeck() {
  const deck = [];
  let id = 0;

  for (const rank of RANKS) {
    for (let i = 0; i < 6; i++) {
      deck.push({ id: String(id++), rank });
    }
  }

  for (let i = 0; i < 2; i++) {
    deck.push({ id: String(id++), rank: 'JOKER' });
  }

  return deck;
}

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { createDeck, shuffle };
