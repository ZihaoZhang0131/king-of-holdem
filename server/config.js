/**
 * 对局设置的校验与落盘格式。浏览器「对局设置」浮窗提交的配置先经过这里：
 * 数值夹到合理范围，盲注结构必须递增，至少两位选手参赛（玩家模式下真人也算一位）；AI 选手名与座位固定（对应 3D 角色），不接受修改。
 * mode：watch 观战（6 个 AI 互打）/ play 玩家模式（真人坐第 7 座，和 AI 对战）
 */

import { sanitizeModes } from '../game/modes.js';

const int = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const num = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const str = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

export const REASONING_EFFORTS = ['low', 'medium', 'high'];
export const MODES = ['watch', 'play'];

/** @returns {{config?: object, error?: string}} */
export function sanitizeConfig(input, current) {
  if (!input || typeof input !== 'object') return { error: '配置格式不正确' };
  const c = current;

  const blinds = Array.isArray(input.blinds) ? input.blinds : c.blinds;
  if (!blinds.length || blinds.length > 40) return { error: '盲注结构需要 1–40 个级别' };
  const levels = [];
  for (const [k, lv] of blinds.entries()) {
    const sb = Math.round(Number(lv?.[0])), bb = Math.round(Number(lv?.[1]));
    if (!(sb >= 1 && bb >= sb && bb <= 1e7)) return { error: `第 ${k + 1} 级盲注无效：小盲 ≥ 1 且大盲 ≥ 小盲` };
    if (levels.length && bb < levels[levels.length - 1][1]) return { error: `第 ${k + 1} 级大盲不能小于上一级` };
    levels.push([sb, bb]);
  }

  const startingStack = int(input.startingStack, 100, 1e7, c.startingStack);
  if (startingStack < levels[0][1] * 2) return { error: `起始筹码至少要有 2 个大盲（${levels[0][1] * 2}）` };

  const pace = Object.fromEntries(Object.keys(c.pace).map((k) => [k, int(input.pace?.[k], 0, 10000, c.pace[k])]));

  const d = input.defaults || {};
  const extraBody = { ...(c.defaults.extraBody || {}) };
  const effort = d.extraBody?.reasoning_effort;
  if (REASONING_EFFORTS.includes(effort)) extraBody.reasoning_effort = effort;
  else if (effort !== undefined) delete extraBody.reasoning_effort;
  const defaults = {
    ...c.defaults,
    temperature: Math.round(num(d.temperature, 0, 2, c.defaults.temperature) * 100) / 100,
    maxTokens: int(d.maxTokens, 100, 32000, c.defaults.maxTokens),
    jsonMode: bool(d.jsonMode, c.defaults.jsonMode),
    extraBody,
  };

  const inPlayers = Array.isArray(input.players) ? input.players : [];
  const players = c.players.map((p, i) => {
    const q = inPlayers[i] || {};
    const out = { ...p, model: str(q.model, 120, p.model), style: str(q.style, 600, p.style || '') };
    out.enabled = bool(q.enabled, p.enabled !== false);
    out.mock = bool(q.mock, !!p.mock);
    if (out.enabled) delete out.enabled; // 默认参赛，不写进文件
    if (!out.mock) delete out.mock;
    return out;
  });
  const mode = MODES.includes(input.mode) ? input.mode : c.mode || 'watch';
  const ais = players.filter((p) => p.enabled !== false).length;
  if (mode === 'play' && ais < 1) return { error: '玩家模式至少需要 1 位 AI 对手' };
  if (mode === 'watch' && ais < 2) return { error: '观战模式至少需要 2 位选手参赛' };
  const hn = str(input.human?.name, 12, c.human?.name || '你');
  const human = { name: hn && !players.some((p) => p.name === hn) ? hn : '你' };
  // 0 = 不限时；限时的话至少 5 秒
  let humanTimeoutMs = int(input.humanTimeoutMs, 0, 600000, c.humanTimeoutMs || 0);
  if (humanTimeoutMs > 0) humanTimeoutMs = Math.max(5000, humanTimeoutMs);

  return {
    config: {
      ...c,
      startingStack,
      handsPerLevel: int(input.handsPerLevel, 1, 200, c.handsPerLevel),
      blinds: levels,
      maxHands: int(input.maxHands, 10, 5000, c.maxHands),
      recentHands: int(input.recentHands, 0, 20, c.recentHands),
      decisionTimeoutMs: int(input.decisionTimeoutMs, 5000, 300000, c.decisionTimeoutMs),
      mode,
      human,
      humanTimeoutMs,
      pace,
      defaults,
      modes: sanitizeModes(input.modes, c.modes),
      players,
    },
  };
}

/** 两空格缩进，盲注等数字对保持一行，方便手改 */
export const formatConfig = (cfg) => JSON.stringify(cfg, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]') + '\n';
