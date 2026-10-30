import { mockDecide } from '../game/mockbot.js';
import { validate } from '../game/validate.js';

export { validate };

/**
 * 选手代理：把引擎给的局面（ai-holdem/1 请求）发给模型，解析并校验模型的决策。
 *
 * 模型输出（只允许一个 JSON 对象）：
 *   {
 *     "action": "fold" | "check" | "call" | "bet" | "raise" | "all_in",
 *     "amount": 300,          // 仅 bet/raise：本街你的下注总额（raise-to），整数
 *     "thought": "...",       // 给观众看的一句话，≤30 字
 *     "notes": "..."          // 可选：更新后的私人笔记，≤300 字，下次决策原样还给你
 *   }
 *
 * 容错：无效输出会带着错误原因重试 1 次；超时不重试；仍失败则系统代为过牌/弃牌。
 */

export const SYSTEM_PROMPT = (name, style, rules = '', { players = 6, human = '' } = {}) => `你是「${name}」，正在参加一场 ${players} 人无限注德州扑克淘汰赛（Freezeout）。
目标：尽可能赢得筹码、存活到最后、争取冠军。盲注会按手数递增，筹码归零即出局。${human ? `
牌桌上有一位真人玩家「${human}」，其余对手都是 AI。` : ''}

每轮到你行动时，你会收到一个 JSON（协议 ai-holdem/1），字段含义：
- tournament：赛程信息（当前手数、盲注级别、距下次涨盲还有几手、剩余人数）
- you：你自己的座位、位置、底牌 hole_cards、剩余筹码 stack、本街已下注 bet_this_street
- table：在局所有玩家（含你）的位置、筹码、本街下注、状态（active / folded / all_in）
- hand：当前街道 street、公共牌 board、底池总额 pot_total（含本街所有下注）、当前最高下注 current_bet、你需跟注 to_call、底池赔率 pot_odds、本手按顺序的全部行动 actions
- legal_actions：你此刻唯一允许的行动。bet/raise 给出 min_to 与 max_to（本街下注总额的范围，max_to 即全下）
- recent_hands：最近几手牌的公开记录（含摊牌亮出的牌），用来读对手
- your_notes：你上次留给自己的笔记
- modes：特殊玩法的局面（仅在开启鱿鱼游戏/大逃杀时出现）

牌面编码：点数 2-9、T、J、Q、K、A + 花色 s(♠) h(♥) d(♦) c(♣)，例如 "Ah"、"Td"。
位置：BTN 庄位、SB 小盲、BB 大盲、UTG 枪口、MP 中位、HJ 劫位、CO 关煞；单挑时 BTN/SB 即庄位兼小盲。

你只能从 legal_actions 中选择一个行动，并只输出一个 JSON 对象，不要输出任何其他文字，不要使用代码块：
{"action":"fold|check|call|bet|raise|all_in","amount":整数,"thought":"一句话","notes":"可选"}
- amount：只有 bet/raise 需要，表示你本街的下注总额（raise-to，不是增量），必须在 [min_to, max_to] 内
- all_in：全部押上，不需要 amount
- thought：给观众看的内心独白，中文，不超过 30 字，可以有个性
- notes：可选，更新后的对手观察笔记（不超过 300 字），下次会原样还给你；不需要更新就省略${rules ? `

本场特殊规则（会实实在在改变筹码，请纳入决策）：
${rules}` : ''}${style ? `

你的打法风格（贯彻到决策和 thought 的语气里；风格服务于赢牌，不要为了演而做明显亏损的决定）：
${style}` : ''}`;

/** 从模型文本里抠出 JSON 对象（兼容 <think> 块、代码块、前后多余文字） */
export function extractJSON(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* 继续尝试逐个对象 */ }
  }
  for (const m of t.matchAll(/\{[^{}]*\}/g)) {
    try { const o = JSON.parse(m[0]); if (o && o.action) return o; } catch { /* ignore */ }
  }
  return null;
}

export const safeFallback = (legal) => (legal.find((x) => x.type === 'check') ? { type: 'check' } : { type: 'fold' });
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * @param {object} o
 * @param {string} o.name   选手名
 * @param {{players:number, human:string}} [o.table]  参赛人数、真人玩家名（玩家模式），写进系统提示词
 * @param {(messages:Array)=>Promise<{text:string, usage?:object}>} [o.complete]  模型调用；缺省则使用模拟 AI
 */
export function createAgent({ name, style = '', rules = '', table, complete }) {
  let notes = '';
  return {
    get notes() { return notes; },
    async decide(req) {
      const request = { ...req, your_notes: notes || '（暂无）' };
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT(name, style, rules, table) },
        { role: 'user', content: `轮到你行动。当前局面：\n${JSON.stringify(request)}` },
      ];
      const attempts = [];
      for (let k = 0; k < 2; k++) {
        const t0 = Date.now();
        let text = '';
        try {
          if (complete) {
            const r = await complete(messages);
            text = r.text;
            attempts.push({ ms: Date.now() - t0, usage: r.usage, raw: text });
          } else {
            text = JSON.stringify(mockDecide(req));
            attempts.push({ ms: 0, raw: text, mock: true });
          }
        } catch (e) {
          attempts.push({ ms: Date.now() - t0, error: e.message });
          if (e.timeout) break; // 超时不再重试，避免一手牌卡太久
          continue;
        }
        const out = extractJSON(text);
        const v = validate(out, req.legal_actions);
        if (v.decision) {
          if (typeof out.notes === 'string' && out.notes.trim()) notes = clip(out.notes, 600);
          return { ...v.decision, thought: clip(out.thought, 40), attempts };
        }
        attempts[attempts.length - 1].invalid = v.error;
        messages.push(
          { role: 'assistant', content: text.slice(0, 2000) },
          { role: 'user', content: `你的输出无效：${v.error}。请只输出一个符合格式的 JSON 对象。` },
        );
      }
      return { ...safeFallback(req.legal_actions), thought: '（决策失败，系统代为操作）', fallback: true, attempts };
    },
  };
}
