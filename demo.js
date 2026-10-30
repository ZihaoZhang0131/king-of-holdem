/**
 * 本地演示：直接用静态服务器打开页面时使用。
 * 跑的是和对局服务完全相同的规则引擎（game/engine.js），决策由模拟 AI 给出，不调用任何模型。
 * 演示默认同时开启鱿鱼游戏和大逃杀，方便直接看到这两种玩法；一场结束后稍等片刻自动开下一场。
 * 玩家模式：human 座位的决策交给页面上的操作栏（onTurn 推送可选行动，act() 提交），渲染的是该座位能看到的信息。
 */

import { createTournament, viewFor } from './game/engine.js';
import { mockDecide } from './game/mockbot.js';
import { validate } from './game/validate.js';

const DEMO_CONFIG = {
  startingStack: 1000,
  handsPerLevel: 8,
  blinds: [[5, 10], [10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300], [250, 500], [400, 800]],
  maxHands: 300,
  recentHands: 0,
  pace: { deal: 1500, action: 1100, street: 600, board: 1100, collect: 700, showdown: 2200, end: 3000 },
  modes: { squid: { enabled: true }, royale: { enabled: true } },
};

export function createDemo({ names, render, speed = () => 1, seats = names.map(() => true), human = -1, onTurn }) {
  let running = false, looping = false, wake = null;
  let turn = null; // 等待玩家行动：{ req, resolve }

  async function wait(ms) {
    await new Promise((r) => setTimeout(r, ms / speed()));
    while (!running) await new Promise((r) => { wake = r; });
  }

  async function loop() {
    looping = true;
    for (;;) {
      const t = createTournament({
        seats: names.map((name, i) => ({ name, enabled: seats[i] })),
        config: DEMO_CONFIG,
        wait,
        emit: (st) => render({ ...(human >= 0 ? viewFor(st, human) : st), mode: 'demo' }),
        // 模拟 AI 秒出决策；稍微停一下，让"思考中"能被看见
        decide: async (seat, req) => {
          if (seat === human) {
            const d = await new Promise((resolve) => {
              turn = { req, resolve };
              const h = req.hand;
              onTurn?.({ seat, legal: req.legal_actions, toCall: h.to_call, pot: h.pot_total, currentBet: h.current_bet,
                stack: req.you.stack, bet: req.you.bet_this_street, bb: req.tournament.blinds.bb, deadline: 0, left: 0, limit: 0 });
            });
            await wait(0);
            return d;
          }
          await wait(500 + Math.random() * 700);
          const d = mockDecide(req);
          // all_in → 加注到上限（引擎会夹到 max_to）
          return d.action === 'all_in' ? { type: 'raise', amount: 1e12, thought: d.thought } : { type: d.action, amount: d.amount, thought: d.thought };
        },
      });
      await t.run();
      await wait(6000);
    }
  }

  return {
    start() {
      running = true;
      if (!looping) loop();
      wake?.();
      wake = null;
    },
    stop() { running = false; },
    /** 玩家的行动：{type, amount?}，校验规则与服务端 /api/act 相同 */
    act(a) {
      if (!turn) return { ok: false, error: '现在不是你的回合' };
      const v = validate({ action: a?.type, amount: a?.amount }, turn.req.legal_actions);
      if (v.error) return { ok: false, error: v.error };
      const t = turn;
      turn = null;
      onTurn?.(null);
      t.resolve({ ...v.decision, thought: '' });
      return { ok: true };
    },
    get running() { return running; },
  };
}
