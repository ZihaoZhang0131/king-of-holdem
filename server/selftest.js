import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTournament } from '../game/engine.js';
import { createAgent, extractJSON, validate } from './agent.js';
import { chatComplete } from './llm.js';
import { sanitizeConfig, formatConfig } from './config.js';

/**
 * 自检（无需 API Key）：node server/selftest.js
 * 1. 引擎：大量模拟锦标赛，校验筹码守恒、行动合法、名次完整
 * 2. 协议：模型输出的解析与校验
 * 3. 网关：用本地假 OpenAI 兼容服务测试重试、超时与兜底
 */

const base = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const config = { ...base, pace: Object.fromEntries(Object.keys(base.pace).map((k) => [k, 0])) };
const allSeats = base.players.map((p) => ({ name: p.name }));

// ---------- 1. engine ----------
// mask：每个座位是否参赛（不参赛的座位开局即出局、没有名次）
async function engineTest(runs, mask = allSeats.map(() => true), modes = {}) {
  const seats = allSeats.map((s, i) => ({ ...s, enabled: mask[i] }));
  const cfg = { ...config, modes };
  const seen = new Set();
  const entrants = mask.filter(Boolean).length;
  const TOTAL = config.startingStack * entrants;
  let hands = 0, decisions = 0, allins = 0;
  for (let r = 0; r < runs; r++) {
    const agents = seats.map((s) => createAgent({ name: s.name }));
    let latest = null;
    const t = createTournament({
      seats, config: cfg, wait: async () => {},
      emit: (st) => {
        // 筹码守恒：筹码 + 下注 + 底池（含空投死钱）+ 空投箱 + 人头赏金
        const sum = st.players.reduce((s, p) => s + p.stack + p.bet + (p.bounty || 0), 0) + st.pot + (st.modes?.royale?.crate || 0);
        assert.equal(sum, TOTAL, `筹码不守恒：hand ${st.handId} 合计 ${sum}`);
        st.players.forEach((p) => assert.ok(p.stack >= 0 && p.bet >= 0));
        (st.events || []).forEach((e) => seen.add(e.type));
        if (st.modes?.squid?.active) st.players.forEach((p, i) => assert.ok(mask[i] || !p.squids));
        hands = Math.max(hands, st.handId);
        latest = st;
      },
      decide: async (seat, req) => {
        decisions++;
        assert.equal(req.you.seat, seat);
        assert.ok(mask[seat], '不参赛的座位被要求行动');
        assert.ok(req.table.every((p) => mask[p.seat]), 'table 里出现了不参赛的座位');
        assert.ok(req.eliminated.every((e) => !e.place || e.place > 1), 'eliminated 名次异常');
        assert.ok(req.you.hole_cards.length === 2);
        // 别人本手的底牌绝不能出现在请求里（recent_hands 是往手的公开摊牌，排除在外）
        const text = JSON.stringify({ ...req, recent_hands: null });
        latest.players.forEach((p, j) => {
          if (j !== seat && p.cards) p.cards.forEach((c) => assert.ok(!text.includes(`"${c}"`), `请求泄露了 ${p.name} 的底牌`));
        });
        if (modes.squid?.enabled) assert.ok(req.modes?.squid_game, '鱿鱼游戏信息没有发给模型');
        if (modes.royale?.enabled) assert.ok(req.modes?.battle_royale, '大逃杀信息没有发给模型');
        const d = await agents[seat].decide(req);
        const legal = req.legal_actions.find((a) => a.type === d.type);
        assert.ok(legal, `非法行动 ${d.type}`);
        if (d.type === 'bet' || d.type === 'raise') assert.ok(d.amount >= legal.min_to && d.amount <= legal.max_to);
        if (d.amount === req.you.stack + req.you.bet_this_street) allins++;
        return d;
      },
    });
    const result = await t.run();
    const places = result.filter((p, i) => mask[i]).map((p) => p.place).sort();
    assert.deepEqual(places, Array.from({ length: entrants }, (_, k) => k + 1), `名次异常 ${places}`);
    assert.ok(result.every((p, i) => mask[i] || (p.place === null && p.stack === 0)), '不参赛座位不应有名次/筹码');
    assert.equal(result.find((p) => p.place === 1).stack, TOTAL);
  }
  const tag = [modes.squid?.enabled && '鱿鱼游戏', modes.royale?.enabled && '大逃杀'].filter(Boolean).join('+');
  console.log(`✓ 引擎（${entrants} 人参赛${tag ? ' · ' + tag : ''}）：${runs} 场锦标赛、${decisions} 次决策、${allins} 次全下，筹码守恒/行动合法/名次完整${seen.size ? ' · 事件 ' + [...seen].join('/') : ''}`);
  return seen;
}

// ---------- 1b. settings ----------
function configTest() {
  const ok = (input) => { const r = sanitizeConfig(input, base); assert.ok(r.config, r.error); return r.config; };
  const same = ok(JSON.parse(JSON.stringify(base)));
  assert.deepEqual(JSON.parse(formatConfig(same)), same);
  assert.match(formatConfig(same), /\[10, 20\]/);
  const c = ok({ ...base, startingStack: '5000', handsPerLevel: 999, decisionTimeoutMs: 1,
    defaults: { temperature: 9, maxTokens: 50, jsonMode: false, extraBody: { reasoning_effort: '' } },
    players: base.players.map((p, i) => ({ ...p, name: 'hacker', model: ` m${i} `, enabled: i < 3, mock: i === 0 })) });
  assert.equal(c.startingStack, 5000);
  assert.equal(c.handsPerLevel, 200);
  assert.equal(c.decisionTimeoutMs, 5000);
  assert.deepEqual([c.defaults.temperature, c.defaults.maxTokens, c.defaults.jsonMode], [2, 100, false]);
  assert.ok(!('reasoning_effort' in c.defaults.extraBody));
  assert.deepEqual(c.players.map((p) => p.name), base.players.map((p) => p.name), '选手名不可改');
  assert.deepEqual(c.players.map((p) => p.enabled), [undefined, undefined, undefined, false, false, false]);
  assert.equal(c.players[0].mock, true);
  assert.equal(c.players[1].model, 'm1');
  const m = ok({ ...base, modes: { squid: { enabled: true, unitBB: 99 }, royale: { enabled: 'yes', zoneEvery: 3.4, anteStep: 0.33, bountyPct: -1 } } }).modes;
  assert.deepEqual(m.squid, { enabled: true, unitBB: 20, lastDouble: true });
  assert.deepEqual(m.royale, { enabled: false, zoneEvery: 3, anteStep: 0.35, bountyPct: 0, finalCircle: 3 });
  const bad = (input, word) => assert.ok(sanitizeConfig({ ...base, ...input }, base).error?.includes(word), word);
  bad({ blinds: [[10, 20], [5, 10]] }, '不能小于');
  bad({ blinds: [[30, 20]] }, '大盲');
  bad({ blinds: [] }, '级别');
  bad({ startingStack: 150, blinds: [[50, 100]] }, '2 个大盲');
  bad({ players: base.players.map((p, i) => ({ ...p, enabled: i === 0 })) }, '至少需要 2 位');
  console.log('✓ 设置：范围夹取、盲注递增、参赛人数、选手名锁定、玩法参数、落盘格式');
}

// ---------- 2. protocol ----------
function protocolTest() {
  const legal = [{ type: 'fold' }, { type: 'call', amount: 100 }, { type: 'raise', min_to: 300, max_to: 1800 }];
  const freeLegal = [{ type: 'check' }, { type: 'bet', min_to: 50, max_to: 900 }];
  assert.deepEqual(extractJSON('<think>hmm</think>```json\n{"action":"call","thought":"跟"}\n```'), { action: 'call', thought: '跟' });
  assert.deepEqual(extractJSON('我决定：{"action":"fold"} 就这样'), { action: 'fold' });
  assert.equal(extractJSON('raise!'), null);
  assert.deepEqual(validate({ action: 'raise', amount: 500 }, legal).decision, { type: 'raise', amount: 500 });
  assert.deepEqual(validate({ action: 'raise', amount: 9999 }, legal).decision, { type: 'raise', amount: 1800 });
  assert.ok(validate({ action: 'raise', amount: 200 }, legal).error.includes('300'));
  assert.ok(validate({ action: 'check' }, legal).error);
  assert.deepEqual(validate({ action: 'ALL-IN' }, legal).decision, { type: 'raise', amount: 1800 });
  assert.deepEqual(validate({ action: 'raise', amount: '120' }, freeLegal).decision, { type: 'bet', amount: 120 });
  assert.deepEqual(validate({ action: 'fold' }, freeLegal).decision, { type: 'check' });
  assert.deepEqual(validate({ action: 'call' }, freeLegal).decision, { type: 'check' });
  assert.ok(validate({ action: 'dance' }, legal).error);
  console.log('✓ 协议：JSON 抽取与行动校验');
}

// ---------- 3. gateway ----------
async function gatewayTest() {
  const script = [];
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      seen.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      const step = script.shift();
      if (step.delay) await new Promise((r) => setTimeout(r, step.delay));
      if (step.status) { res.writeHead(step.status).end('upstream error'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: step.text } }], usage: { total_tokens: 42 } }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const baseURL = `http://127.0.0.1:${srv.address().port}/v1`;
  const mk = (timeoutMs = 2000) => createAgent({ name: 'Claude', style: '风格标记XYZ', complete: (messages) => chatComplete({ baseURL, apiKey: 'test-key', model: 'm1', messages, timeoutMs }) });
  const req = {
    you: { seat: 0, hole_cards: ['As', 'Kd'], stack: 1900, bet_this_street: 0 },
    hand: { board: [], current_bet: 100, pot_total: 150, to_call: 100, pot_odds: 0.4 },
    legal_actions: [{ type: 'fold' }, { type: 'call', amount: 100 }, { type: 'raise', min_to: 200, max_to: 1900 }],
  };

  // 无效输出 → 带错误原因重试 → 成功，并记住 notes
  script.push({ text: '我要加注到 150！' }, { text: '```json\n{"action":"raise","amount":450,"thought":"AK 必须打","notes":"智谱很紧"}\n```' });
  let agent = mk();
  let d = await agent.decide(req);
  assert.deepEqual([d.type, d.amount, d.thought], ['raise', 450, 'AK 必须打']);
  assert.equal(d.attempts.length, 2);
  assert.equal(seen[0].auth, 'Bearer test-key');
  assert.equal(seen[0].body.model, 'm1');
  assert.ok(seen[0].body.messages[0].content.includes('打法风格') && seen[0].body.messages[0].content.includes('风格标记XYZ'), '风格没有写进系统提示词');
  assert.ok(seen[1].body.messages.at(-1).content.includes('无效'));
  assert.equal(agent.notes, '智谱很紧');
  script.push({ text: '{"action":"check"}' }, { text: '{"action":"call","thought":"跟"}' });
  d = await agent.decide(req);
  assert.equal(d.type, 'call');
  assert.ok(seen.at(-1).body.messages[1].content.includes('智谱很紧'), 'notes 没有回传给模型');

  // HTTP 500 → 重试成功
  script.push({ status: 500 }, { text: '{"action":"fold","thought":"撤"}' });
  d = await mk().decide(req);
  assert.equal(d.type, 'fold');

  // 超时 → 不重试，直接兜底（需跟注时弃牌）
  script.push({ delay: 400, text: '{"action":"call"}' });
  d = await mk(150).decide(req);
  assert.equal(d.fallback, true);
  assert.equal(d.type, 'fold');
  assert.equal(d.attempts.length, 1);

  srv.close();
  console.log('✓ 网关：鉴权/模型名/风格透传、无效输出重试、5xx 重试、超时兜底、笔记回传');
}

await engineTest(Number(process.argv[2] || 30));
await engineTest(10, [true, false, true, true, false, true]);
await engineTest(10, [false, false, false, true, true, false]);
{
  const sq = await engineTest(20, undefined, { squid: { enabled: true } });
  assert.ok(sq.has('squid') && sq.has('squidSettle'), '鱿鱼游戏没有发生结算');
  const br = await engineTest(20, undefined, { royale: { enabled: true } });
  for (const e of ['zone', 'airdrop', 'kill', 'final']) assert.ok(br.has(e), `大逃杀缺少事件 ${e}`);
  await engineTest(20, undefined, { squid: { enabled: true }, royale: { enabled: true } });
  await engineTest(10, [true, false, true, true, false, true], { squid: { enabled: true, unitBB: 20 }, royale: { enabled: true, zoneEvery: 2, anteStep: 1, bountyPct: 0.5 } });
}
configTest();
protocolTest();
await gatewayTest();
console.log('全部通过');
