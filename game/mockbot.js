import { parse, bestHand } from '../poker.js';

/**
 * 模拟 AI：未配置模型的座位、或 MOCK=1 时使用。
 * 输入输出与真实模型完全相同（ai-holdem/1 请求 → 决策 JSON），方便离线联调。
 */

const LINES = {
  fold: ['这把不值得，先撤', '赔率不够，放了', '牌太弱，等下一手'],
  check: ['先看看再说', '控一下底池', '不急，过'],
  call: ['跟一下，看看你有什么', '赔率合适，跟', '还不想放弃'],
  raise: ['加点压力', '这手我很有信心', '轮到我来主导了', '诈唬也是艺术'],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function mockDecide(req) {
  const legal = req.legal_actions;
  const hole = req.you.hole_cards;
  const board = req.hand.board;
  let s;
  if (!board.length) {
    const [a, b] = hole.map(parse);
    const hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
    s = ((hi + lo) / 24) * 0.55 + (a.r === b.r ? 0.3 + (hi / 12) * 0.2 : 0) + (a.s === b.s ? 0.06 : 0) + (hi - lo <= 1 ? 0.04 : 0);
  } else {
    s = [0.2, 0.45, 0.65, 0.75, 0.82, 0.86, 0.93, 0.97, 0.99][bestHand([...hole, ...board])[0]];
  }
  s = Math.min(1, Math.max(0, s + (Math.random() - 0.5) * 0.3));
  const r = Math.random();
  const R = legal.find((x) => x.type === 'raise' || x.type === 'bet');
  const call = legal.find((x) => x.type === 'call');
  const sizeTo = () => {
    const target = req.hand.current_bet + req.hand.pot_total * (0.5 + Math.random() * 0.5);
    return Math.min(R.max_to, Math.max(R.min_to, Math.round(target / 5) * 5));
  };
  if (!call) {
    if (R && ((s > 0.6 && r < 0.6) || r < 0.05)) return { action: R.type, amount: sizeTo(), thought: pick(LINES.raise) };
    return { action: 'check', thought: pick(LINES.check) };
  }
  if (s < req.hand.pot_odds * 0.6 + 0.12 && r < 0.9) return { action: 'fold', thought: pick(LINES.fold) };
  if (R && s > 0.72 && r < 0.5) return { action: 'raise', amount: sizeTo(), thought: pick(LINES.raise) };
  return { action: 'call', thought: pick(LINES.call) };
}
