/**
 * 本地演示：直接用静态服务器打开页面时使用。
 * 跑的是和对局服务完全相同的规则引擎（game/engine.js），决策由模拟 AI 给出，不调用任何模型。
 * 演示默认同时开启鱿鱼游戏和大逃杀，方便直接看到这两种玩法；一场结束后稍等片刻自动开下一场。
 */

import { createTournament } from './game/engine.js';
import { mockDecide } from './game/mockbot.js';

const DEMO_CONFIG = {
  startingStack: 1000,
  handsPerLevel: 8,
  blinds: [[5, 10], [10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300], [250, 500], [400, 800]],
  maxHands: 300,
  recentHands: 0,
  pace: { deal: 1500, action: 1100, street: 600, board: 1100, collect: 700, showdown: 2200, end: 3000 },
  modes: { squid: { enabled: true }, royale: { enabled: true } },
};

export function createDemo({ names, render, speed = () => 1 }) {
  let running = false, looping = false, wake = null;

  async function wait(ms) {
    await new Promise((r) => setTimeout(r, ms / speed()));
    while (!running) await new Promise((r) => { wake = r; });
  }

  async function loop() {
    looping = true;
    for (;;) {
      const t = createTournament({
        seats: names.map((name) => ({ name })),
        config: DEMO_CONFIG,
        wait,
        emit: (st) => render({ ...st, mode: 'demo' }),
        // 模拟 AI 秒出决策；稍微停一下，让"思考中"能被看见
        decide: async (seat, req) => {
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
    get running() { return running; },
  };
}
