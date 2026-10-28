/**
 * 德州扑克通用工具：牌面编码、7 张牌估值、最佳 5 张、胜率（蒙特卡洛 / 穷举）。
 * 牌面编码 = 点数(23456789TJQKA) + 花色(s h d c)，如 'As'、'Td'。
 * 引擎（demo.js / 之后的真实对局）和视图（table.js）共用这一份。
 */

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

export const parse = (code) => ({ r: RANKS.indexOf(code[0]), s: code[1] });
export const cmp = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? -1) !== (b[i] ?? -1)) return (a[i] ?? -1) - (b[i] ?? -1);
  return 0;
};

const straightHigh = (m) => {
  for (let h = 12; h >= 4; h--) { const need = 0b11111 << (h - 4); if ((m & need) === need) return h; }
  return (m & 0b1000000001111) === 0b1000000001111 ? 3 : -1; // A-2-3-4-5
};

/** 5~7 张已解析的牌 → 可比较的分数数组 [牌型, ...关键点数] */
function evalParsed(cards) {
  const cnt = new Array(13).fill(0);
  const suitCnt = { s: 0, h: 0, d: 0, c: 0 }, suitMask = { s: 0, h: 0, d: 0, c: 0 };
  let mask = 0;
  for (const c of cards) { cnt[c.r]++; suitCnt[c.s]++; suitMask[c.s] |= 1 << c.r; mask |= 1 << c.r; }
  let flush = null;
  for (const s in suitCnt) if (suitCnt[s] >= 5) flush = s;
  if (flush) { const sh = straightHigh(suitMask[flush]); if (sh >= 0) return [8, sh]; }
  const quads = [], trips = [], pairs = [], singles = [];
  for (let r = 12; r >= 0; r--) {
    const n = cnt[r];
    if (n === 4) quads.push(r); else if (n === 3) trips.push(r); else if (n === 2) pairs.push(r); else if (n === 1) singles.push(r);
  }
  if (quads.length) {
    let kick = -1;
    for (let r = 12; r >= 0; r--) if (r !== quads[0] && cnt[r]) { kick = r; break; }
    return [7, quads[0], kick];
  }
  if (trips.length && (trips.length > 1 || pairs.length)) return [6, trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1)];
  if (flush) {
    const rs = [];
    for (let r = 12; r >= 0 && rs.length < 5; r--) if ((suitMask[flush] >> r) & 1) rs.push(r);
    return [5, ...rs];
  }
  const sh = straightHigh(mask);
  if (sh >= 0) return [4, sh];
  if (trips.length) return [3, trips[0], ...singles.slice(0, 2)];
  if (pairs.length >= 2) return [2, pairs[0], pairs[1], Math.max(pairs[2] ?? -1, singles[0] ?? -1)];
  if (pairs.length === 1) return [1, pairs[0], ...singles.slice(0, 3)];
  return [0, ...singles.slice(0, 5)];
}

/** 从 5~7 张牌中算出最佳牌力分数 */
export const bestHand = (codes) => evalParsed(codes.map(parse));

/** 最佳牌力 + 组成它的 5 张牌（用于摊牌时高亮） */
export function bestCombo(codes) {
  const score = bestHand(codes);
  const n = codes.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const five = codes.filter((_, i) => i !== a && i !== b).slice(0, 5);
    if (n === 7 && cmp(bestHand(five), score) === 0) return { score, cards: five };
  }
  return { score, cards: codes.slice(0, 5) };
}

export const handName = (score) => (score[0] === 8 && score[1] === 12 ? '皇家同花顺' : HAND_NAMES[score[0]]);

export function newDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/**
 * 胜率：hands[i] 为两张底牌或 null（弃牌/未知），返回每个座位的胜率 0~1（平分计入份额）。
 * 剩 0~1 张公共牌时穷举，否则蒙特卡洛抽样。
 */
export function equity(hands, board, iters = 2000) {
  const live = hands.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
  const share = hands.map(() => 0);
  if (live.length === 1) { share[live[0]] = 1; return share; }
  if (!live.length) return share;
  const used = new Set([...board, ...live.flatMap((i) => hands[i])]);
  const rest = [];
  for (const r of RANKS) for (const s of SUITS) if (!used.has(r + s)) rest.push(parse(r + s));
  const need = 5 - board.length;
  const boardP = board.map(parse);
  const holesP = live.map((i) => hands[i].map(parse));
  const run = (extra) => {
    const full = boardP.concat(extra);
    let best = null, winners = [];
    holesP.forEach((h, k) => {
      const s = evalParsed(h.concat(full));
      const c = best ? cmp(s, best) : 1;
      if (c > 0) { best = s; winners = [k]; } else if (c === 0) winners.push(k);
    });
    winners.forEach((k) => { share[live[k]] += 1 / winners.length; });
  };
  let total = 0;
  if (need === 0) { run([]); total = 1; }
  else if (need === 1) { rest.forEach((c) => run([c])); total = rest.length; }
  else {
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(Math.random() * (rest.length - k));
        [rest[k], rest[j]] = [rest[j], rest[k]];
      }
      run(rest.slice(0, need));
    }
    total = iters;
  }
  return share.map((v) => v / total);
}
