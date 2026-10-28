import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, createReadStream, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTournament, Aborted, initialPlayers, modesView } from '../game/engine.js';
import { modeRules, modeTitle, resolveModes } from '../game/modes.js';
import { createAgent } from './agent.js';
import { chatComplete } from './llm.js';
import { sanitizeConfig, formatConfig } from './config.js';

/**
 * 本地对局服务：
 *   GET  /              静态页面（3D 牌桌）
 *   GET  /events        SSE：event "state"（观众视角状态）、"status"（运行状态）
 *   GET  /api/status    运行状态与各座位模型
 *   POST /api/control   {cmd: start | pause | resume | restart | speed, value?}
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
let config, seats;
function loadConfig() {
  config = readConfig();
  seats = config.players.map((p) => {
    const opts = { ...config.defaults, ...p };
    const mock = FORCE_MOCK || !!p.mock || !p.model || !BASE_URL || !API_KEY;
    return { ...opts, enabled: p.enabled !== false, mock };
  });
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
  const CN = ['零', '一', '两', '三', '四', '五', '六'];
  const { royale } = resolveModes(config.modes);
  const per = royale.enabled ? royale.zoneEvery : config.handsPerLevel;
  return {
    mode: 'live', handId: 0, stage: '', board: [], pot: 0, dealer: 0, toAct: -1, blinds: config.blinds[0],
    message: [mocks ? `${mocks} 个座位未配置模型，将由模拟 AI 代打` : `${CN[n] || n}位选手已就位`, modeTitle(config.modes), '点击「开始比赛」'].filter(Boolean).join(' · '),
    tournament: { level: 1, handsPerLevel: per, handsToNextLevel: per, playersLeft: n, startingStack: config.startingStack, finished: false },
    modes: modesView(config, { alive: n }),
    events: [],
    players: initialPlayers(seats, config).map((p) => ({ name: p.name, stack: p.stack, bet: 0, cards: null, folded: false, allIn: false, revealed: false, winner: false, handName: '', lastAction: null, thought: '', eliminated: p.eliminated, sittingOut: p.sittingOut, place: null, squids: 0, bounty: p.bounty, kills: 0 })),
  };
}

const status = () => ({
  mode: 'live', running, paused, finished, speed, pendingConfig,
  players: seats.map((s) => ({ name: s.name, model: s.mock ? null : s.model, mock: s.mock, enabled: s.enabled, style: s.style || '' })),
});
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startMatch() {
  loadConfig();
  const myGen = ++gen;
  running = true; paused = false; finished = false; pendingConfig = false;
  mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const logFile = path.join(ROOT, 'logs', `match-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const log = (rec) => appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...rec }) + '\n');
  log({ type: 'start', seats: seats.map((s) => ({ name: s.name, enabled: s.enabled, model: s.mock ? 'mock' : s.model, style: s.style })), config: { ...config, players: undefined } });

  const rules = modeRules(config.modes);
  const agents = seats.map((s) => createAgent({
    name: s.name,
    style: s.style,
    rules,
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
    emit: (st) => { if (gen !== myGen) return; lastState = st; broadcast('state', st); },
    decide: async (seat, req) => {
      const d = await agents[seat].decide(req);
      if (gen !== myGen) throw new Aborted();
      log({ type: 'decision', hand: req.tournament.hand_no, street: req.hand.street, seat, name: seats[seat].name, model: seats[seat].mock ? 'mock' : seats[seat].model,
        request: req, decision: { type: d.type, amount: d.amount, thought: d.thought }, fallback: !!d.fallback, attempts: d.attempts, notes: agents[seat].notes });
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
  else if (cmd === 'restart') { gen++; running = false; loadConfig(); lastState = lobbyState(); broadcast('state', lastState); startMatch(); }
  else if (cmd === 'pause' && running) paused = true;
  else if (cmd === 'resume') paused = false;
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
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(status()));
    return;
  }
  if (url.pathname === '/api/control' && req.method === 'POST') return readBody(req, (cmd) => json(res, control(cmd.cmd, cmd.value)));
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
  seats.forEach((s) => console.log(`  ${s.name.padEnd(9)} ${!s.enabled ? '不参赛' : s.mock ? '模拟 AI' : s.model}`));
});
