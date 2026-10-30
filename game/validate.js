/**
 * 行动校验：把模型输出（或玩家在操作栏里的选择）映射成合法决策。
 * 服务端 agent.js、/api/act 和浏览器里的本地演示共用（server/ 目录不对浏览器开放，所以放在 game/）。
 */

const ACTION_ALIAS = { allin: 'all_in', all_in: 'all_in', 'all-in': 'all_in', shove: 'all_in', jam: 'all_in', bet: 'raise', raise: 'raise', fold: 'fold', check: 'check', call: 'call' };

/** 把模型输出映射成合法决策；能无害修正的直接修正，修正不了的返回错误让模型重试 */
export function validate(out, legal) {
  if (!out || typeof out !== 'object') return { error: '没有找到 JSON 对象' };
  const find = (t) => legal.find((x) => x.type === t);
  const R = find('raise') || find('bet');
  const call = find('call');
  const a = ACTION_ALIAS[String(out.action || '').toLowerCase().trim().replace(/\s+/g, '_')];
  const ok = (decision) => ({ decision });
  switch (a) {
    case 'fold':
      return find('fold') ? ok({ type: 'fold' }) : ok({ type: 'check' }); // 能免费过牌时弃牌没有意义
    case 'check':
      if (find('check')) return ok({ type: 'check' });
      return { error: `当前需要跟注 ${call.amount}，不能过牌；可选 ${legal.map((x) => x.type).join('/')}` };
    case 'call':
      return call ? ok({ type: 'call' }) : ok({ type: 'check' });
    case 'raise': {
      if (!R) return { error: `当前不允许下注/加注；可选 ${legal.map((x) => x.type).join('/')}` };
      const amt = Math.round(Number(out.amount));
      if (!Number.isFinite(amt)) return { error: `${R.type} 需要整数 amount（本街下注总额，范围 ${R.min_to}~${R.max_to}）` };
      if (amt < R.min_to) return { error: `amount=${amt} 小于最小值 ${R.min_to}（amount 是本街下注总额 raise-to，不是增量）` };
      return ok({ type: R.type, amount: Math.min(amt, R.max_to) });
    }
    case 'all_in':
      if (R) return ok({ type: R.type, amount: R.max_to });
      if (call) return ok({ type: 'call' });
      return ok({ type: 'check' });
    default:
      return { error: `未知的 action "${out.action}"；只能是 ${legal.map((x) => x.type).join('/')}` };
  }
}
