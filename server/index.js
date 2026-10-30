import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, createReadStream, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTournament, Aborted, initialPlayers, modesView, viewFor } from '../game/engine.js';
import { modeRules, modeTitle, resolveModes } from '../game/modes.js';
import { createAgent, validate, safeFallback } from './agent.js';
import { chatComplete } from './llm.js';
import { sanitizeConfig, formatConfig } from './config.js';

/**
 * 本地对局服务：
 *   GET  /              静态页面（3D 牌桌）
 *   GET  /events        SSE：event "state"（观众视角状态）、"status"（运行状态）
 *   GET  /api/status    运行状态与各座位模型
 *   POST /api/control   {cmd: start | pause | resume | restart | speed, value?}
 *   POST /api/act       玩家模式：真人玩家的行动 {type: fold | check | call | bet | raise | all_in, amount?}
 *   SSE  event "turn"   轮到真人玩家时的可选行动（不轮到时为 null）
 *   GET  /api/config    对局设置（不含 API Key）；POST 同路径校验后写回 config.json
 * API Key 只在服务端读取（.env），永远不会发给浏览器。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(path.join(ROOT, '.env'));

const BASE_URL = process.env.LLM_BASE_URL || '';
const API_KEY = process.env.LLM_API_KEY || '';
const PORT = Number(process.env.PORT || 8787);
const FORCE_MOCK = process.env.MOCK === '1';
// 每场新比赛开始前重读 config.json：改模型、风格、赛制后点「重开比赛」即可生效
const CONFIG_FILE = path.join(ROOT, 'server', 'config.json');
const readConfig = () => JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
// 座位 0–5 是 AI，最后一个（6 号）是真人玩家：观战模式下不参赛，玩家模式下由浏览器操作
let config, seats, HUMAN, playing;
function loadConfig() {
  config = readConfig();
  playing = config.mode === 'play';
  HUMAN = config.players.length;
  seats = config.players.map((p) => {
    const opts = { ...config.defaults, ...p };
    const mock = FORCE_MOCK || !!p.mock || !p.model || !BASE_URL || !API_KEY;
    return { ...opts, enabled: p.enabled !== false, mock };
  });
  seats.push({ name: config.human?.name || '你', human: true, enabled: playing, mock: false });
}
loadConfig();

// ---------- match control ----------
const clients = new Set();
let gen = 0, running = false, paused = false, finished = false, speed = 1;
let pendingConfig = false; // 比赛进行中保存的设置，重开后生效
let lastState = lobbyState();

function lobbyState() {
  const mocks = seats.filter((s) => s.enabled && s.mock).length;
  const n = seats.filter((s) => s.enabled).length;
  const CN = ['零', '一', '两', '三', '四', '五', '六', '七'];
  const ready = playing ? `你和${CN[n - 1] || n - 1}位 AI 已就位` : `${CN[n] || n}位选手已就位`;
  const { royale } = resolveModes(config.modes);
  const per = royale.enabled ? royale.zoneEvery : config.handsPerLevel;
  return {
    mode: 'live', handId: 0, stage: '', board: [], pot: 0, dealer: 0, toAct: -1, blinds: config.blinds[0],
    message: [mocks ? `${mocks} 个座位未配置模型，将由模拟 AI 代打` : ready, modeTitle(config.modes), '点击「开始比赛」'].filter(Boolean).join(' · '),
    tournament: { level: 1, handsPerLevel: per, handsToNextLevel: per, playersLeft: n, startingStack: config.startingStack, finished: false },
    modes: modesView(config, { alive: n }),
    events: [],
    players: initialPlayers(seats, config).map((p) => ({ name: p.name, stack: p.stack, bet: 0, cards: null, folded: false, allIn: false, revealed: false, winner: false, handName: '', lastAction: null, thought: '', eliminated: p.eliminated, sittingOut: p.sittingOut, place: null, squids: 0, bounty: p.bounty, kills: 0 })),
  };
}

const status = () => ({
  mode: 'live', play: playing, humanSeat: HUMAN, running, paused, finished, speed, pendingConfig,
  players: seats.map((s) => ({ name: s.name, model: s.mock || s.human ? null : s.model, mock: s.mock, human: !!s.human, enabled: s.enabled, style: s.style || '' })),
});
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 玩家模式：等待真人行动 ----------
// 引擎照常调用 decide()，轮到玩家座位时挂起，直到浏览器 POST /api/act；重开时以 Aborted 结束
let turn = null; // { gen, req, resolve, reject, timer, deadline, left }
const turnView = () => {
  if (!turn) return null;
  const r = turn.req;
  return {
    seat: r.you.seat, handId: r.tournament.hand_no, street: r.hand.street, legal: r.legal_actions,
    toCall: r.hand.to_call, pot: r.hand.pot_total, currentBet: r.hand.current_bet,
    stack: r.you.stack, bet: r.you.bet_this_street, bb: r.tournament.blinds.bb,
    deadline: turn.deadline, left: turn.left ?? 0, limit: config.humanTimeoutMs || 0,
  };
};
function endTurn(result) {
  if (!turn) return;
  const t = turn;
  turn = null;
  clearTimeout(t.timer);
  broadcast('turn', null);
  result instanceof Error ? t.reject(result) : t.resolve(result);
}
// 限时：暂停时停表，继续后接着倒计时
function armTurn(ms) {
  clearTimeout(turn.timer);
  turn.deadline = Date.now() + ms;
  turn.left = 0;
  turn.timer = setTimeout(() => endTurn({ ...safeFallback(turn.req.legal_actions), thought: '', timeout: true }), ms);
}
function holdTurn(hold) {
  if (!turn || !config.humanTimeoutMs) return;
  if (hold && turn.deadline) { turn.left = Math.max(1000, turn.deadline - Date.now()); turn.deadline = 0; clearTimeout(turn.timer); }
  else if (!hold && turn.left) armTurn(turn.left);
  broadcast('turn', turnView());
}
function waitHuman(req, myGen) {
  return new Promise((resolve, reject) => {
    turn = { gen: myGen, req, resolve, reject, deadline: 0 };
    if (config.humanTimeoutMs) {
      if (paused) turn.left = config.humanTimeoutMs;
      else armTurn(config.humanTimeoutMs);
    }
    broadcast('turn', turnView());
  });
}
function act(input) {
  if (!turn) return { ok: false, error: '现在不是你的回合' };
  const v = validate({ action: input?.type, amount: input?.amount }, turn.req.legal_actions);
  if (v.error) return { ok: false, error: v.error };
  endTurn({ ...v.decision, thought: '' });
  return { ok: true };
}

function startMatch() {
  loadConfig();
  const myGen = ++gen;
  running = true; paused = false; finished = false; pendingConfig = false;
  mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const logFile = path.join(ROOT, 'logs', `match-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const log = (rec) => appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...rec }) + '\n');
  const who = (s) => (s.human ? 'human' : s.mock ? 'mock' : s.model);
  log({ type: 'start', seats: seats.map((s) => ({ name: s.name, enabled: s.enabled, model: who(s), style: s.style })), config: { ...config, players: undefined } });

  const rules = modeRules(config.modes);
  const table = { players: seats.filter((s) => s.enabled).length, human: playing ? seats[HUMAN].name : '' };
  const agents = seats.map((s) => s.human ? null : createAgent({
    name: s.name,
    style: s.style,
    rules,
    table,
    complete: s.mock ? null : (messages) => chatComplete({
      baseURL: BASE_URL, apiKey: API_KEY, model: s.model, messages,
      temperature: s.temperature, maxTokens: s.maxTokens, jsonMode: s.jsonMode, extraBody: s.extraBody,
      timeoutMs: config.decisionTimeoutMs,
    }),
  }));
  const wait = async (ms) => {
    await sleep(ms / speed);
    while (paused && gen === myGen) await sleep(150);
    if (gen !== myGen) throw new Aborted();
  };
  const t = createTournament({
    seats, config, wait,
    // 玩家模式：只广播玩家自己能看到的信息（别人的底牌、AI 独白在服务端就藏好）
    emit: (st) => { if (gen !== myGen) return; lastState = playing ? viewFor(st, HUMAN) : st; broadcast('state', lastState); },
    decide: async (seat, req) => {
      const d = seats[seat].human ? await waitHuman(req, myGen) : await agents[seat].decide(req);
      if (gen !== myGen) throw new Aborted();
      log({ type: 'decision', hand: req.tournament.hand_no, street: req.hand.street, seat, name: seats[seat].name, model: who(seats[seat]),
        request: req, decision: { type: d.type, amount: d.amount, thought: d.thought }, fallback: !!d.fallback, timeout: !!d.timeout, attempts: d.attempts, notes: agents[seat]?.notes });
      if (d.fallback) console.warn(`[${seats[seat].name}] 决策失败，已代为操作：`, d.attempts.map((a) => a.error || a.invalid).join(' | '));
      return d;
    },
  });
  broadcast('status', status());
  t.run()
    .then((result) => { if (gen === myGen) { log({ type: 'end', result }); finished = true; } })
    .catch((e) => { if (!(e instanceof Aborted)) { console.error(e); log({ type: 'error', message: e.message }); } })
    .finally(() => { if (gen === myGen) { running = false; broadcast('status', status()); } });
}

function control(cmd, value) {
  if (cmd === 'start' && !running) startMatch();
  else if (cmd === 'restart') { gen++; running = false; endTurn(new Aborted()); loadConfig(); lastState = lobbyState(); broadcast('state', lastState); startMatch(); }
  else if (cmd === 'pause' && running) { paused = true; holdTurn(true); }
  else if (cmd === 'resume') { paused = false; holdTurn(false); }
  else if (cmd === 'speed' && [0.5, 1, 2, 4].includes(Number(value))) speed = Number(value);
  broadcast('status', status());
  return status();
}

function saveConfig(input) {
  const { config: next, error } = sanitizeConfig(input, readConfig());
  if (error) return { ok: false, error };
  writeFileSync(CONFIG_FILE, formatConfig(next));
  // 比赛进行中不动当前对局，重开后生效；未开赛则立刻刷新大厅
  if (running) pendingConfig = true;
  else { loadConfig(); lastState = lobbyState(); broadcast('state', lastState); }
  broadcast('status', status());
  return { ok: true, ...configView() };
}
const configView = () => {
  let host = '';
  try { host = new URL(BASE_URL).host; } catch { /* 未配置 */ }
  return { config: readConfig(), gateway: { configured: !!(BASE_URL && API_KEY), host }, forceMock: FORCE_MOCK };
};

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => {
    let data = {};
    try { data = JSON.parse(body || '{}'); } catch { /* ignore */ }
    cb(data);
  });
}
const json = (res, data) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  const rel = path.normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^[/\\]+/, '');
  const file = path.join(ROOT, rel);
  const blocked = !file.startsWith(ROOT + path.sep) || rel.split(path.sep).some((seg) => seg.startsWith('.'))
    || /^(server|logs|node_modules)([/\\]|$)/.test(rel) || !MIME[path.extname(file)];
  if (blocked || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)], 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify(lastState)}\n\n`);
    res.write(`event: turn\ndata: ${JSON.stringify(turnView())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(status()));
    return;
  }
  if (url.pathname === '/api/control' && req.method === 'POST') return readBody(req, (cmd) => json(res, control(cmd.cmd, cmd.value)));
  if (url.pathname === '/api/act' && req.method === 'POST') return readBody(req, (a) => json(res, act(a)));
  if (url.pathname === '/api/config') {
    if (req.method === 'POST') return readBody(req, (cfg) => json(res, saveConfig(cfg)));
    return json(res, configView());
  }
  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  res.writeHead(405).end();
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`《德扑之王》对局服务已启动：http://localhost:${PORT}`);
  console.log(`网关：${BASE_URL || '（未配置）'}`);
  console.log(`模式：${playing ? '玩家模式' : '观战'}`);
  seats.forEach((s) => console.log(`  ${s.name.padEnd(9)} ${!s.enabled ? '不参赛' : s.human ? '真人玩家' : s.mock ? '模拟 AI' : s.model}`));
});
