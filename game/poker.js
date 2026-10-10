'use strict';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];

const PokerPhase = Object.freeze({
  WAITING:  'WAITING',
  PREFLOP:  'PREFLOP',
  FLOP:     'FLOP',
  TURN:     'TURN',
  RIVER:    'RIVER',
  SHOWDOWN: 'SHOWDOWN',
});

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 5;

function rankMeta(rank) {
  const idx   = rank === 14 ? 1 : rank;
  const label = rank === 14 ? 'A' : rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : String(rank);
  return { idx2: String(idx).padStart(2, '0'), label };
}
function cardCode(c) { const m = rankMeta(c.rank); return `${c.suit}_${m.idx2}_${m.label}`; }
function cardLabel(c) {
  const m = rankMeta(c.rank);
  const sym = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }[c.suit];
  return `${m.label}${sym}`;
}

function makeDeck() {
  const d = [];
  for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) d.push({ suit, rank });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const HAND_NAMES = ['Старшая карта','Пара','Две пары','Сет','Стрит','Флеш','Фулл-хаус','Каре','Стрит-флеш'];

function eval5(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2) straightHigh = 5;
  }

  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, c]) => [c, Number(r)])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const pattern = groups.map(g => g[0]).join('');
  const kickers = groups.map(g => g[1]);

  if (straightHigh && isFlush) return [8, straightHigh];
  if (pattern === '41')        return [7, kickers[0], kickers[1]];
  if (pattern === '32')        return [6, kickers[0], kickers[1]];
  if (isFlush)                 return [5, ...ranks];
  if (straightHigh)            return [4, straightHigh];
  if (pattern === '311')       return [3, kickers[0], kickers[1], kickers[2]];
  if (pattern === '221')       return [2, kickers[0], kickers[1], kickers[2]];
  if (pattern === '2111')      return [1, kickers[0], kickers[1], kickers[2], kickers[3]];
  return [0, ...ranks];
}

function cmpEval(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

const COMBO5_OF_7 = (() => {
  const res = [];
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 7; c++)
    for (let d = c + 1; d < 7; d++) for (let e = d + 1; e < 7; e++) res.push([a, b, c, d, e]);
  return res;
})();

function evalBest(cards) {
  if (cards.length <= 5) { return { ev: eval5(cards), best: cards.slice() }; }
  let bestEv = null, bestCards = null;
  for (const idx of COMBO5_OF_7) {
    if (idx[4] >= cards.length) continue;
    const hand = idx.map(i => cards[i]);
    const ev = eval5(hand);
    if (!bestEv || cmpEval(ev, bestEv) > 0) { bestEv = ev; bestCards = hand; }
  }
  return { ev: bestEv, best: bestCards };
}

function handName(cards) {
  const { ev } = evalBest(cards);
  if (ev[0] === 8 && ev[1] === 14) return 'Роял-флеш';
  return HAND_NAMES[ev[0]];
}

class PokerGame {
  constructor(opts = {}) {
    this.phase      = PokerPhase.WAITING;
    this.players    = new Map();
    this.seatOrder  = [];
    this.maxSeats   = Math.min(MAX_PLAYERS, opts.maxSeats || MAX_PLAYERS);
    this.minPlayers = MIN_PLAYERS;
    this.startChips = opts.startChips || 1000;
    this.smallBlind = opts.smallBlind || 10;
    this.bigBlind   = opts.bigBlind   || 20;

    this.deck       = [];
    this.board      = [];
    this.pot        = 0;
    this.currentBet = 0;
    this.lastRaise  = 0;
    this.dealerSeat = -1;
    this.actingId   = null;
    this.handNo     = 0;
    this.events     = [];
    this.lastResult = null;
  }

  log(text) {
    this.events.push({ t: Date.now(), text });
    if (this.events.length > 60) this.events.shift();
  }

  registerPlayer(id, name, avatarHash = null) {
    id = String(id);
    if (this.players.has(id)) return false;
    if (this.seatOrder.length >= this.maxSeats) return false;
    this.players.set(id, {
      id, name: name || 'Игрок', avatarHash,
      chips: this.startChips, seat: this.seatOrder.length,
      cards: [], inHand: false, folded: false, allIn: false,
      bet: 0, totalBet: 0, hasActed: false, sittingOut: false, lastAction: null,
    });
    this.seatOrder.push(id);
    return true;
  }

  removePlayer(id) {
    id = String(id);
    if (!this.players.has(id)) return false;
    const pl = this.players.get(id);
    if (pl.inHand && !pl.folded && this.phase !== PokerPhase.WAITING) {
      pl.folded = true; pl.lastAction = 'Вышел';
    }
    this.players.delete(id);
    this.seatOrder = this.seatOrder.filter(x => x !== id);
    this.seatOrder.forEach((pid, i) => { this.players.get(pid).seat = i; });
    if (this.phase !== PokerPhase.WAITING && this.actingId === id) this._advanceBetting();
    return true;
  }

  get p() { return [...this.players.values()]; }
  active()  { return this.seatOrder.map(id => this.players.get(id)).filter(p => p && p.inHand && !p.folded); }
  canPlay() { return this.p.filter(p => p.chips > 0 && !p.sittingOut); }

  startHand() {
    const eligible = this.canPlay();
    if (eligible.length < this.minPlayers)
      return { error: `Нужно минимум ${this.minPlayers} игрока с фишками.` };

    this.handNo++;
    this.deck  = makeDeck();
    this.board = [];
    this.pot = 0;
    this.currentBet = 0;
    this.lastRaise = this.bigBlind;
    this.lastResult = null;

    for (const pl of this.p) {
      pl.cards = []; pl.bet = 0; pl.totalBet = 0; pl.folded = false;
      pl.allIn = false; pl.hasActed = false; pl.lastAction = null;
      pl.inHand = pl.chips > 0 && !pl.sittingOut;
    }

    const seats = this.seatOrder.filter(id => this.players.get(id).inHand);
    this.dealerSeat = this._nextOccupiedSeat(this.dealerSeat, seats);

    const sbId = this._idAtRelative(1, seats);
    const bbId = this._idAtRelative(2, seats);
    this._postBlind(sbId, this.smallBlind);
    this._postBlind(bbId, this.bigBlind);
    this.currentBet = this.bigBlind;

    for (let n = 0; n < 2; n++) for (const id of seats) this.players.get(id).cards.push(this.deck.pop());

    this.phase = PokerPhase.PREFLOP;
    this.actingId = this._idAtRelative(3, seats);
    this._skipToActable();

    this.log(`Раздача #${this.handNo}. Блайнды ${this.smallBlind}/${this.bigBlind}.`);
    return { ok: true };
  }

  _postBlind(id, amount) {
    const pl = this.players.get(id);
    if (!pl) return;
    const pay = Math.min(amount, pl.chips);
    pl.chips -= pay; pl.bet = pay; pl.totalBet += pay; this.pot += pay;
    if (pl.chips === 0) pl.allIn = true;
  }

  _idAtRelative(offset, seats) {
    if (!seats.length) return null;
    const dId = this._dealerId(seats);
    const dIdx = Math.max(0, seats.indexOf(dId));
    return seats[(dIdx + offset) % seats.length];
  }
  _dealerId(seats) {
    const id = this.seatOrder[this.dealerSeat];
    return seats.includes(id) ? id : seats[0];
  }
  _nextOccupiedSeat(from, seats) {
    const order = this.seatOrder;
    for (let step = 1; step <= order.length; step++) {
      const idx = (from + step) % order.length;
      if (seats.includes(order[idx])) return idx;
    }
    return order.indexOf(seats[0]);
  }

  _isBetPhase() {
    return [PokerPhase.PREFLOP, PokerPhase.FLOP, PokerPhase.TURN, PokerPhase.RIVER].includes(this.phase);
  }

  legalActions(id) {
    const pl = this.players.get(id);
    if (!pl || this.actingId !== id || !this._isBetPhase() || pl.folded || pl.allIn) return null;
    const toCall = Math.min(this.currentBet - pl.bet, pl.chips);
    const maxTo  = pl.bet + pl.chips;
    const minRaiseTo = Math.min(maxTo, this.currentBet + Math.max(this.lastRaise, this.bigBlind));
    const canRaise = pl.chips > toCall;
    const potAfterCall = this.pot + toCall;
    const halfPotTo = Math.min(maxTo, this.currentBet + Math.max(this.bigBlind, Math.round(potAfterCall * 0.5)));
    const potTo     = Math.min(maxTo, this.currentBet + Math.max(this.bigBlind, potAfterCall));
    return {
      toCall,
      canCheck: toCall === 0,
      canCall:  toCall > 0,
      canRaise,
      minRaiseTo,
      maxRaiseTo: maxTo,
      halfPotTo,
      potTo,
      bigBlind: this.bigBlind,
      pot: this.pot,
      myBet: pl.bet,
      myChips: pl.chips,
    };
  }

  act(id, action) {
    if (this.actingId !== id) return { error: 'Сейчас не твой ход.' };
    const la = this.legalActions(id);
    if (!la) return { error: 'Сейчас нельзя ходить.' };
    const pl = this.players.get(id);

    if (action.type === 'fold') {
      pl.folded = true; pl.lastAction = 'Фолд'; pl.hasActed = true;
      this.log(`${pl.name}: фолд.`);

    } else if (action.type === 'check' && la.canCheck) {
      pl.lastAction = 'Чек'; pl.hasActed = true;
      this.log(`${pl.name}: чек.`);

    } else if (action.type === 'call' && la.canCall) {
      const pay = la.toCall;
      pl.chips -= pay; pl.bet += pay; pl.totalBet += pay; this.pot += pay;
      if (pl.chips === 0) pl.allIn = true;
      pl.lastAction = pl.allIn ? 'Олл-ин' : 'Колл'; pl.hasActed = true;
      this.log(`${pl.name}: колл ${pay}.`);

    } else if (action.type === 'raise' && la.canRaise) {
      let target = Math.round(Number(action.amount) || la.minRaiseTo);
      target = Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, target));
      const pay = target - pl.bet;
      const raiseSize = target - this.currentBet;
      pl.chips -= pay; pl.bet = target; pl.totalBet += pay; this.pot += pay;
      this.lastRaise = Math.max(this.lastRaise, raiseSize);
      this.currentBet = target;
      if (pl.chips === 0) pl.allIn = true;
      for (const o of this.active()) if (o.id !== id && !o.allIn) o.hasActed = false;
      pl.lastAction = pl.allIn ? 'Олл-ин' : 'Рейз'; pl.hasActed = true;
      this.log(`${pl.name}: рейз до ${target}.`);

    } else {
      return { error: 'Недопустимое действие.' };
    }

    this._advanceBetting();
    return { ok: true };
  }

  _advanceBetting() {
    const live = this.active();
    if (live.length === 1) { this._awardUncontested(live[0]); return; }

    const needAction = live.filter(p => !p.allIn && (!p.hasActed || p.bet !== this.currentBet));
    if (needAction.length === 0) { this._endBettingRound(); return; }

    this.actingId = this._nextToAct(this.actingId);
    this._skipToActable();
  }

  _nextToAct(fromId) {
    const seats = this.seatOrder.filter(id => { const p = this.players.get(id); return p && p.inHand && !p.folded; });
    if (!seats.length) return fromId;
    let idx = seats.indexOf(fromId);
    if (idx < 0) idx = 0;
    for (let step = 1; step <= seats.length; step++) {
      const cand = this.players.get(seats[(idx + step) % seats.length]);
      if (cand && !cand.allIn) return cand.id;
    }
    return fromId;
  }
  _skipToActable() {
    const pl = this.players.get(this.actingId);
    if (pl && (pl.folded || pl.allIn)) {
      const nxt = this._nextToAct(this.actingId);
      if (nxt !== this.actingId) this.actingId = nxt;
    }
  }

  _endBettingRound() {
    for (const pl of this.p) { pl.bet = 0; pl.hasActed = false; }
    this.currentBet = 0; this.lastRaise = this.bigBlind;

    const live = this.active();
    const canBet = live.filter(p => !p.allIn);
    const runout = canBet.length <= 1;

    if (this.phase === PokerPhase.PREFLOP)      { this._dealBoard(3); this.phase = PokerPhase.FLOP;  this.log('Флоп.'); }
    else if (this.phase === PokerPhase.FLOP)    { this._dealBoard(1); this.phase = PokerPhase.TURN;  this.log('Тёрн.'); }
    else if (this.phase === PokerPhase.TURN)    { this._dealBoard(1); this.phase = PokerPhase.RIVER; this.log('Ривер.'); }
    else if (this.phase === PokerPhase.RIVER)   { this._showdown(); return; }

    const seats = this.seatOrder.filter(id => { const p = this.players.get(id); return p && p.inHand && !p.folded; });
    this.actingId = this._idAtRelative(1, seats);
    this._skipToActable();

    if (runout) {
      for (const p of this.active()) p.hasActed = true;
      this._advanceBetting();
    }
  }

  _dealBoard(n) {
    if (this.deck.length) this.deck.pop();
    for (let i = 0; i < n; i++) if (this.deck.length) this.board.push(this.deck.pop());
  }

  _awardUncontested(winner) {
    winner.chips += this.pot;
    this.lastResult = { winners: [{ id: winner.id, name: winner.name, amount: this.pot, hand: null, cards: null }], uncontested: true, board: this.board.map(cardCode) };
    this.log(`${winner.name} забирает банк ${this.pot} (все спасовали).`);
    this.pot = 0;
    this.phase = PokerPhase.WAITING;
  }

  _showdown() {
    this.phase = PokerPhase.SHOWDOWN;
    const live = this.active();

    const contributors = this.p.filter(p => p.totalBet > 0);
    const levels = [...new Set(contributors.map(p => p.totalBet))].sort((a, b) => a - b);
    let prev = 0;
    const pots = [];
    for (const lvl of levels) {
      const amount = contributors.reduce((s, p) => s + Math.max(0, Math.min(p.totalBet, lvl) - prev), 0);
      const eligible = live.filter(p => p.totalBet >= lvl).map(p => p.id);
      if (amount > 0 && eligible.length) pots.push({ amount, eligible });
      prev = lvl;
    }

    const evalCache = {}, bestCache = {};
    for (const p of live) { const r = evalBest([...p.cards, ...this.board]); evalCache[p.id] = r.ev; bestCache[p.id] = r.best; }

    const payouts = {};
    for (const pot of pots) {
      let best = null;
      for (const id of pot.eligible) { if (!best || cmpEval(evalCache[id], evalCache[best]) > 0) best = id; }
      const winners = pot.eligible.filter(id => cmpEval(evalCache[id], evalCache[best]) === 0);
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      for (const id of winners) payouts[id] = (payouts[id] || 0) + share + (rem-- > 0 ? 1 : 0);
    }

    const winnerList = [];
    for (const [id, amt] of Object.entries(payouts)) {
      const pl = this.players.get(id);
      pl.chips += amt;
      winnerList.push({ id, name: pl.name, amount: amt, hand: handName([...pl.cards, ...this.board]), cards: pl.cards.map(cardCode) });
    }
    const reveal = live.map(p => ({
      id: p.id, name: p.name, hand: handName([...p.cards, ...this.board]),
      cards: p.cards.map(cardCode), best: (bestCache[p.id] || []).map(cardCode),
    }));
    this.lastResult = { winners: winnerList, reveal, uncontested: false, board: this.board.map(cardCode) };
    for (const w of winnerList) this.log(`${w.name} — ${w.hand}, выигрыш ${w.amount}.`);
    this.pot = 0;
    this.phase = PokerPhase.WAITING;
  }

  publicState() {
    return {
      phase:      this.phase,
      pot:        this.pot,
      currentBet: this.currentBet,
      handNo:     this.handNo,
      board:      this.board.map(cardCode),
      dealerId:   this.seatOrder[this.dealerSeat] ?? null,
      actingId:   this.actingId,
      maxSeats:   this.maxSeats,
      minPlayers: this.minPlayers,
      bigBlind:   this.bigBlind,
      smallBlind: this.smallBlind,
      seats: this.seatOrder.map(id => {
        const p = this.players.get(id);
        return {
          id: p.id, name: p.name, seat: p.seat,
          chips: p.chips, bet: p.bet, folded: p.folded, allIn: p.allIn,
          inHand: p.inHand, sittingOut: p.sittingOut, lastAction: p.lastAction,
          avatarUrl: p.avatarHash ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatarHash}.png?size=128` : null,
          cardCount: p.inHand && !p.folded ? p.cards.length : 0,
        };
      }),
      result: this.lastResult,
      events: this.events.slice(-12),
    };
  }

  playerState(id) {
    const p = this.players.get(id);
    if (!p) return null;
    const la = this.legalActions(id);
    let hand = null, best = [];
    if (p.inHand && !p.folded && p.cards.length) {
      const all = [...p.cards, ...this.board];
      hand = handName(all);
      if (all.length >= 5) best = (evalBest(all).best || []).map(cardCode);
    }
    return {
      id: p.id,
      inHand: p.inHand, folded: p.folded, allIn: p.allIn,
      chips: p.chips,
      cards: p.cards.map(cardCode),
      hand,
      best,
      isActing: this.actingId === id,
      legal: la,
    };
  }
}

module.exports = { PokerGame, PokerPhase, evalBest, handName, cardCode, cardLabel, MIN_PLAYERS, MAX_PLAYERS };
