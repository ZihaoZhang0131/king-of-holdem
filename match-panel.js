import { resolveModes } from './game/modes.js';

/**
 * 「对局设置」浮窗：上半部分是比赛控制（观战 / 玩家模式、开始 / 暂停 / 重开 / 速度），常驻可见；
 * 下半部分是五个设置页签 —— 选手（厂商 / 模型）、模型（各厂商 API Key 与健康测试）、赛制、筹码、玩法（鱿鱼游戏 / 大逃杀），
 * 编辑的是一份草稿，点「保存设置」才写回服务端 config.json；API Key 例外：在「模型」页签单独保存，直接写进服务端的 .env，页面只拿得到掩码。
 * 比赛进行中保存的设置不影响当前对局，重开后生效；未开赛时保存立即生效。
 */

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 比较草稿与已保存设置：键排序，并忽略「默认参赛 / 非模拟」这类缺省字段
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${k}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));
const norm = (c) => stable({ ...c, players: c.players.map(({ enabled, mock, ...p }) => ({ ...p, off: enabled === false, mock: !!mock })),
  providers: Object.fromEntries(Object.entries(c.providers || {}).filter(([, v]) => v?.baseURL?.trim())) });
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// 节奏预设：在标准节奏上整体缩放（毫秒）
const PACE_BASE = { deal: 1800, action: 900, street: 700, board: 1300, collect: 700, showdown: 2400, end: 3200 };
const PACES = [['舒缓', 1.4], ['标准', 1], ['紧凑', 0.55]];
const paceOf = (k) => Object.fromEntries(Object.entries(PACE_BASE).map(([n, v]) => [n, Math.round(v * k)]));

const BLIND_PRESETS = {
  标准: [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [500, 1000], [800, 1600], [1000, 2000], [1500, 3000], [2500, 5000]],
  加速: [[10, 20], [20, 40], [40, 80], [75, 150], [150, 300], [300, 600], [600, 1200], [1200, 2400], [2500, 5000], [5000, 10000]],
  深筹: [[5, 10], [10, 20], [15, 30], [20, 40], [25, 50], [30, 60], [40, 80], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [500, 1000], [750, 1500], [1000, 2000], [1500, 3000], [2000, 4000], [3000, 6000]],
};
const STACK_QUICK = [1000, 2000, 5000, 10000];
const EFFORTS = [['', '默认'], ['low', '低'], ['medium', '中'], ['high', '高']];

// 下一级盲注：约 ×1.5，取整到 1 / 1.5 / 2 / 2.5 / 3 / 4 / 5 / 6 / 8 × 10ⁿ
function nextLevel([, bb]) {
  const target = bb * 1.5, p = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((v) => v >= target * 0.97);
  const nbb = Math.max(bb + 1, Math.round(nice));
  return [Math.max(1, Math.round(nbb / 2)), nbb];
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root      浮窗 .win-body
 * @param {HTMLElement} o.summary   标题栏缩小时的一句话
 * @param {HTMLElement} o.mini      标题栏上的迷你开始/暂停按钮
 * @param {Array} o.brands
 * @param {boolean} o.live          是否连着本地对局服务（否则为演示模式，只有控制、模式与 AI 数量）
 * @param {{play:boolean, ais:number}} [o.demoOpts]  演示模式的设置
 * @param {(o:object) => void} [o.onDemoOpts]      演示模式改设置（存进浏览器并刷新页面）
 * @param {() => void} o.onPrimary  开始 / 暂停 / 继续
 * @param {() => void} o.onRestart
 * @param {(v:number) => void} o.onSpeed
 */
export function createMatchPanel({ root, summary, mini, brands, live, demoOpts, onDemoOpts, onPrimary, onRestart, onSpeed }) {
  const HUMAN = brands.findIndex((b) => b.human);
  const AIS = HUMAN; // 座位 0 … HUMAN-1 是 AI
  root.innerHTML = `
    <div class="mp-ctrl">
      <div class="seg wide mp-mode" role="group" aria-label="模式"><button data-mode="watch">◎ 观战</button><button data-mode="play">♛ 玩家模式</button></div>
      <div class="mp-status"><span class="mp-pill" data-s="idle"><i></i><b>未开始</b></span><span class="mp-info"></span></div>
      <button class="mp-primary" data-act="primary"></button>
      <div class="mp-row">
        <button class="mp-restart" data-act="restart" hidden>↻ 重开比赛</button>
        <div class="seg mp-speed" role="group" aria-label="播放速度">
          ${[0.5, 1, 2, 4].map((v) => `<button data-speed="${v}">${v}×</button>`).join('')}
        </div>
      </div>
    </div>
    <nav class="mp-tabs" role="tablist">
      <button data-tab="players" class="on">选手</button><button data-tab="providers">模型</button><button data-tab="rules">赛制</button><button data-tab="chips">筹码</button><button data-tab="modes">玩法</button>
    </nav>
    <div class="mp-scroll"><div class="mp-page"></div></div>
    <footer class="mp-foot"><span class="mp-msg"></span><span class="mp-btns"></span></footer>`;
  const $ = (s) => root.querySelector(s);
  const page = $('.mp-page'), foot = $('.mp-foot'), msgEl = $('.mp-msg'), btns = $('.mp-btns');

  let status = { running: false, paused: false, finished: false, speed: 1, pendingConfig: false };
  let saved = null, draft = null, provs = [], error = '', tab = 'players';
  const models = {};    // 厂商 → { list, loading, error }：模型下拉的候选
  const seatTest = {};  // 座位 → 最近一次「测试模型」结果
  const provBusy = {};  // 厂商 → 正在保存 Key / 测试连接
  const provMsg = {};   // 厂商 → 保存 Key 的提示
  const open = new Set();
  let infoText = '';

  // ---------- 控制 ----------
  function paintControl() {
    const s = status;
    const state = !live ? (s.running ? 'running' : 'paused') : !s.running ? (s.finished ? 'finished' : 'idle') : s.paused ? 'paused' : 'running';
    const label = { idle: '未开始', running: live ? '进行中' : '演示中', paused: '已暂停', finished: '已结束' }[state];
    const primary = !live ? (s.running ? '❚❚  暂停演示' : '▶  继续演示')
      : !s.running ? (s.finished ? '▶  开始新比赛' : '▶  开始比赛') : s.paused ? '▶  继续对局' : '❚❚  暂停对局';
    const pill = $('.mp-pill');
    pill.dataset.s = state;
    pill.querySelector('b').textContent = label;
    const pb = $('.mp-primary');
    pb.textContent = primary;
    pb.classList.toggle('go', state !== 'running');
    $('.mp-restart').hidden = !live || (!s.running && !s.finished);
    root.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s.speed));
    paintMode();
    mini.innerHTML = state === 'running'
      ? '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="3" height="8" rx=".6"/><rect x="6" y="1" width="3" height="8" rx=".6"/></svg>'
      : '<svg viewBox="0 0 10 10"><path d="M2 1.2v7.6a.5.5 0 0 0 .76.43l6.2-3.8a.5.5 0 0 0 0-.86l-6.2-3.8A.5.5 0 0 0 2 1.2z"/></svg>';
    mini.title = primary.replace(/^\S+\s+/, '');
    mini.classList.toggle('go', state !== 'running');
    summary.textContent = [label, infoText.split(' · ')[0]].filter(Boolean).join(' · ');
    paintFoot();
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.mode) setMode(b.dataset.mode);
    else if (b.dataset.act === 'primary') onPrimary();
    else if (b.dataset.act === 'restart') onRestart();
    else if (b.dataset.speed) onSpeed(Number(b.dataset.speed));
    else if (b.dataset.tab) { tab = b.dataset.tab; root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('on', t === b)); paintPage(); }
  });
  mini.addEventListener('click', (e) => { e.stopPropagation(); onPrimary(); });

  // ---------- 模式与 AI 数量 ----------
  // 实时模式改的是草稿（保存后生效，进行中则重开后生效）；演示模式直接生效
  const modeOf = () => (live ? draft?.mode || 'watch' : demoOpts?.play ? 'play' : 'watch');
  function paintMode() {
    root.querySelectorAll('[data-mode]').forEach((b) => { b.classList.toggle('on', b.dataset.mode === modeOf()); b.disabled = live && !draft; });
  }
  function setMode(m) {
    if (!live) { if ((m === 'play') !== !!demoOpts.play) onDemoOpts({ play: m === 'play' }); return; }
    if (!draft || draft.mode === m) return;
    draft.mode = m;
    // 玩家模式至少要 1 位 AI，观战至少 2 位
    if (m === 'watch' && aiCount() < 2) setAiCount(2);
    paintPage();
    paintMode();
  }
  const aiCount = () => draft.players.filter((p) => p.enabled !== false).length;
  function setAiCount(n) { draft.players.forEach((p, i) => { p.enabled = i < n; }); }
  const stepper = (n, lo, hi) => `<span class="stepper"><button data-ais="${n - 1}" ${n <= lo ? 'disabled' : ''}>−</button><b>${n}</b><button data-ais="${n + 1}" ${n >= hi ? 'disabled' : ''}>＋</button></span>`;

  // ---------- 设置草稿 ----------
  const dirty = () => saved && norm(draft) !== norm(saved);
  function get(path) { return path.split('.').reduce((o, k) => o?.[k], draft); }
  function set(path, v) {
    const ks = path.split('.');
    const last = ks.pop();
    const o = ks.reduce((o, k) => (o[k] ??= {}), draft);
    o[last] = v;
  }

  // 补齐缺省字段，避免「没写 = 默认值」被当成未保存的修改
  const normalize = (c) => ({ ...c, modes: resolveModes(c.modes), providers: c.providers || {},
    players: c.players.map((p) => ({ ...p, provider: p.provider || 'custom' })) });
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
  const provOf = (id) => provs.find((p) => p.id === id);

  // ---------- 厂商：API Key、连接测试、模型列表 ----------
  async function saveKey(id, key) {
    provBusy[id] = true; provMsg[id] = ''; paintPage();
    try {
      const r = await post('/api/providers/key', { provider: id, key });
      if (r.ok) { provs = r.providers; delete models[id]; provMsg[id] = key ? 'Key 已保存，立即生效' : 'Key 已清除'; }
      else provMsg[id] = r.error || '保存失败';
    } catch { provMsg[id] = '保存失败：连不上对局服务'; }
    provBusy[id] = false; paintPage();
  }
  async function testProv(id) {
    provBusy[id] = true; paintPage();
    try { const r = await post('/api/providers/test', { provider: id }); if (r.providers) provs = r.providers; } catch { /* 显示旧状态 */ }
    provBusy[id] = false; paintPage();
  }
  async function loadModels(id, refresh = false) {
    if (!provOf(id)?.configured || models[id]?.loading) return;
    models[id] = { ...(models[id] || {}), loading: true }; paintPage();
    try {
      const r = await fetch(`/api/providers/models?provider=${encodeURIComponent(id)}${refresh ? '&refresh=1' : ''}`, { cache: 'no-store' }).then((x) => x.json());
      models[id] = r.ok ? { list: r.models } : { list: [], error: r.error };
    } catch { models[id] = { list: [], error: '连不上对局服务' }; }
    paintPage();
  }
  async function testSeat(i) {
    const p = draft.players[i];
    seatTest[i] = { pending: true }; paintPage();
    try { seatTest[i] = await post('/api/providers/test-model', { provider: p.provider, model: p.model }); }
    catch { seatTest[i] = { ok: false, error: '连不上对局服务' }; }
    paintPage();
  }

  async function loadConfig() {
    try {
      const r = await fetch('/api/config', { cache: 'no-store' }).then((x) => x.json());
      saved = normalize(r.config); draft = clone(saved); provs = r.providers || []; error = '';
    } catch { error = '读取设置失败'; }
    paintPage();
  }

  async function saveConfig(thenRestart = false) {
    error = '';
    paintFoot('saving');
    try {
      const r = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) }).then((x) => x.json());
      if (!r.ok) { error = r.error || '保存失败'; paintFoot(); return; }
      saved = normalize(r.config); draft = clone(saved); provs = r.providers || provs;
      paintPage();
      if (thenRestart) onRestart();
    } catch { error = '保存失败：连不上对局服务'; paintFoot(); }
  }

  function paintFoot(saving) {
    if (!live) { foot.hidden = true; return; }
    foot.hidden = false;
    foot.dataset.k = error ? 'err' : dirty() ? 'dirty' : status.pendingConfig ? 'pending' : 'ok';
    if (saving === 'saving') { msgEl.textContent = '保存中…'; btns.innerHTML = ''; return; }
    if (error) msgEl.textContent = error;
    else if (dirty()) msgEl.textContent = status.running ? '有未保存的修改 · 保存后下一场生效' : '有未保存的修改';
    else if (status.pendingConfig) msgEl.textContent = '新设置将在下一场比赛生效';
    else msgEl.textContent = status.running ? '设置已保存 · 修改将在下一场生效' : '设置已保存';
    btns.innerHTML = dirty()
      ? `<button data-f="revert">撤销</button>${status.running ? '<button data-f="save-restart">保存并重开</button>' : ''}<button data-f="save" class="primary">保存设置</button>`
      : status.pendingConfig && status.running ? '<button data-f="restart" class="primary">立即重开</button>' : '';
  }
  btns.addEventListener('click', (e) => {
    const f = e.target.closest('button')?.dataset.f;
    if (f === 'revert') { draft = clone(saved); error = ''; paintPage(); }
    else if (f === 'save') saveConfig();
    else if (f === 'save-restart') saveConfig(true);
    else if (f === 'restart') onRestart();
  });

  // ---------- 页签内容 ----------
  const sw = (k, on, label = '') => `<label class="sw" title="${esc(label)}"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><i></i></label>`;
  const field = (label, control, hint = '') => `<div class="fd"><div class="fd-l"><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</div><div class="fd-c">${control}</div></div>`;
  const numIn = (k, v, { min, max, step = 1, unit = '', scale = 1 } = {}) =>
    `<span class="num"><input type="number" data-k="${k}" data-scale="${scale}" value="${Math.round((v / scale) * 100) / 100}" min="${min}" max="${max}" step="${step}">${unit ? `<em>${unit}</em>` : ''}</span>`;

  function playersPage() {
    const ready = provs.filter((p) => p.configured);
    const g = ready.length ? `<b class="ok">●</b> 已配置：${ready.map((p) => esc(p.name)).join('、')}`
      : '<b class="warn">●</b> 还没有配置任何厂商的 API Key（「模型」页签），选「大模型」的座位也会由模拟 AI 代打';
    const n = aiCount(), play = draft.mode === 'play';
    const hc = brands[HUMAN] ? hex(brands[HUMAN].color) : '#ffc24a';
    return `
      <p class="mp-note">${g}<br>${play ? `你 + ${n} 位 AI，共 ${n + 1} 人` : `参赛 ${n} / ${AIS} 人`} · AI 选手与 3D 角色一一对应，名字不可改</p>
      ${field('AI 选手数量', stepper(n, play ? 1 : 2, AIS), '按座位顺序启用前几位，也可以在下面逐个开关')}
      ${play ? `
        <div class="seat open me" style="--c:${hc}">
          <div class="seat-head"><span class="dot"></span><b>${esc(draft.human?.name || '你')}</b><span class="seat-sub">真人玩家 · 近侧座位</span></div>
          <div class="seat-body">
            ${field('名字', `<input type="text" maxlength="12" data-k="human.name" value="${esc(draft.human?.name || '你')}" placeholder="你">`)}
            ${field('思考时限', numIn('humanTimeoutMs', draft.humanTimeoutMs || 0, { min: 0, max: 600, unit: '秒', scale: 1000 }), '0 = 不限时；超时自动过牌/弃牌')}
          </div>
        </div>` : ''}
      <div class="mp-bulk"><select data-bulk-prov>${provOptions(draft.players[0]?.provider)}</select><input type="text" placeholder="把所有座位设为该厂商的模型…" data-bulk><button data-bulk-apply>应用</button></div>
      ${provs.map((pv) => `<datalist id="ml-${pv.id}">${[...new Set([...(models[pv.id]?.list || []), ...pv.presets])].map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`).join('')}
      ${draft.players.map((p, i) => {
        const on = p.enabled !== false, mock = !!p.mock;
        const sub = seatSub(p);
        return `
        <div class="seat ${open.has(i) ? 'open' : ''} ${on ? '' : 'off'}" style="--c:${hex(brands[i].color)}">
          <div class="seat-head" data-seat="${i}">
            <span class="dot"></span><b>${esc(p.name)}</b><span class="seat-sub">${esc(sub)}</span>
            ${sw(`players.${i}.enabled`, on, '参赛')}<i class="chev">▾</i>
          </div>
          <div class="seat-body">
            ${field('驱动', `<div class="seg" data-seg="players.${i}.mock"><button data-v="false" class="${mock ? '' : 'on'}">大模型</button><button data-v="true" class="${mock ? 'on' : ''}">模拟 AI</button></div>`)}
            ${field('厂商', `<select data-k="players.${i}.provider" ${mock ? 'disabled' : ''}>${provOptions(p.provider)}</select>`, provOf(p.provider)?.configured ? '' : '<span class="warn-t">这个厂商还没配 API Key，去「模型」页签填写</span>')}
            ${field('模型', `<span class="mdl"><input type="text" list="ml-${p.provider}" data-k="players.${i}.model" value="${esc(p.model)}" placeholder="选择或输入模型名" ${mock ? 'disabled' : ''}>`
              + `<button class="ico" data-models="${p.provider}" title="从厂商接口刷新模型列表" ${mock || !provOf(p.provider)?.configured ? 'disabled' : ''}>${models[p.provider]?.loading ? '…' : '↻'}</button></span>`,
              models[p.provider]?.error ? `<span class="warn-t">模型列表获取失败：${esc(models[p.provider].error)}</span>` : models[p.provider]?.list ? `${models[p.provider].list.length} 个可选，也可以手动输入` : '')}
            <div class="fd"><div class="fd-l"><span>健康测试</span><small>${testText(seatTest[i]) || '发一次极小的请求，会花极少量 token'}</small></div>
              <div class="fd-c"><button data-seat-test="${i}" ${mock || !p.model || !provOf(p.provider)?.configured || seatTest[i]?.pending ? 'disabled' : ''}>${seatTest[i]?.pending ? '测试中…' : '测试模型'}</button></div></div>
            <div class="fd col"><div class="fd-l"><span>打法风格</span><small><span data-count="${i}">${(p.style || '').length}</span>/600 · 追加到系统提示词</small></div>
              <textarea rows="3" maxlength="600" data-k="players.${i}.style" placeholder="例如：激进的松凶型，喜欢 3-bet 施压…">${esc(p.style)}</textarea></div>
          </div>
        </div>`;
      }).join('')}`;
  }

  const provName = (id) => provOf(id)?.name || id;
  const provOptions = (sel) => provs.map((pv) => `<option value="${pv.id}" ${pv.id === sel ? 'selected' : ''}>${esc(pv.name)}${pv.configured ? '' : '（未配置）'}</option>`).join('');
  function seatSub(p) {
    if (p.enabled === false) return '不参赛';
    if (p.mock) return '模拟 AI';
    if (!p.model) return `${provName(p.provider)} · 未填模型 · 模拟 AI`;
    return `${provName(p.provider)} · ${p.model}${provOf(p.provider)?.configured ? '' : ' · 未配置 Key'}`;
  }
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? '刚刚' : s < 3600 ? `${Math.round(s / 60)} 分钟前` : `${Math.round(s / 3600)} 小时前`; };
  const testText = (t) => (!t || t.pending ? '' : t.ok
    ? `<span class="ok-t">✓ 可用 · ${fmt(t.ms)}ms${t.reply ? ` · 回复「${esc(t.reply)}」` : ''}${t.models !== undefined ? ` · ${t.models} 个模型` : ''}${t.at ? ` · ${ago(t.at)}` : ''}</span>`
    : `<span class="warn-t">✗ ${esc(t.error || '失败')}${t.at ? ` · ${ago(t.at)}` : ''}</span>`);

  function providersPage() {
    return `
      <p class="mp-note">API Key 保存在服务端的 <code>.env</code>，页面上只显示掩码，保存后立即生效。Base URL 改动随「保存设置」一起保存。</p>
      ${provs.map((pv) => {
        const busy = provBusy[pv.id], t = pv.test;
        const state = !pv.configured ? 'off' : t && !t.ok ? 'bad' : t?.ok ? 'ok' : 'set';
        return `
        <div class="prov" data-state="${state}">
          <div class="prov-head"><span class="pdot"></span><b>${esc(pv.name)}</b><small>${esc(pv.sub)}</small>
            <span class="prov-st">${pv.configured ? `已配置 <code>${esc(pv.masked)}</code>` : pv.masked ? '缺少 Base URL' : '未配置'}</span></div>
          <div class="prov-key">
            <input type="password" autocomplete="off" spellcheck="false" data-key-in="${pv.id}" placeholder="${pv.masked ? '粘贴新的 Key 以更换' : `粘贴 API Key（${esc(pv.env)}）`}">
            <button class="primary" data-key-save="${pv.id}" ${busy ? 'disabled' : ''}>${pv.masked ? '更换' : '保存'}</button>
            ${pv.masked ? `<button data-key-clear="${pv.id}" ${busy ? 'disabled' : ''}>清除</button>` : ''}
          </div>
          ${provMsg[pv.id] ? `<p class="prov-msg">${esc(provMsg[pv.id])}</p>` : ''}
          ${field('Base URL', `<input type="text" class="url" data-k="providers.${pv.id}.baseURL" value="${esc(draft.providers?.[pv.id]?.baseURL || '')}" placeholder="${esc(pv.kind === 'anthropic' ? '默认（官方接口）' : pv.defaultBaseURL || '必填：OpenAI 兼容接口地址')}">`)}
          <div class="fd"><div class="fd-l"><span>连接测试</span><small>${testText(t) || '拉一次模型列表，验证 Key 与地址（不花 token）'}</small></div>
            <div class="fd-c"><button data-prov-test="${pv.id}" ${!pv.configured || busy ? 'disabled' : ''}>${busy ? '测试中…' : '测试连接'}</button></div></div>
        </div>`;
      }).join('')}`;
  }

  function rulesPage() {
    const d = draft.defaults;
    const pk = PACES.find(([, k]) => JSON.stringify(paceOf(k)) === JSON.stringify(draft.pace))?.[0];
    return `
      <h4>赛程</h4>
      ${field('涨盲间隔', numIn('handsPerLevel', draft.handsPerLevel, { min: 1, max: 200, unit: '手' }), draft.modes.royale.enabled ? '大逃杀开启时由「玩法 › 缩圈间隔」代替' : '每打这么多手，盲注升一级')}
      ${field('手数上限', numIn('maxHands', draft.maxHands, { min: 10, max: 5000, unit: '手' }), '到达后按筹码排定名次')}
      ${field('动画节奏', `<div class="seg" data-pace>${PACES.map(([n]) => `<button data-v="${n}" class="${pk === n ? 'on' : ''}">${n}</button>`).join('')}${pk ? '' : '<button class="on" disabled>自定义</button>'}</div>`, '发牌、亮牌、结算的停顿时长')}
      <h4>模型决策</h4>
      ${field('对局记忆', numIn('recentHands', draft.recentHands, { min: 0, max: 20, unit: '手' }), '每次决策附带最近几手的公开记录')}
      ${field('思考时限', numIn('decisionTimeoutMs', draft.decisionTimeoutMs, { min: 5, max: 300, unit: '秒', scale: 1000 }), '超时由系统代为过牌/弃牌')}
      ${field('温度', `<span class="range"><input type="range" data-k="defaults.temperature" min="0" max="1.5" step="0.05" value="${d.temperature}"><output>${Number(d.temperature).toFixed(2)}</output></span>`, '越高越随机、越有个性')}
      ${field('最大输出', numIn('defaults.maxTokens', d.maxTokens, { min: 100, max: 32000, step: 100, unit: 'tokens' }), '推理模型的思考也计入这里')}
      ${field('推理强度', `<div class="seg" data-seg="defaults.extraBody.reasoning_effort">${EFFORTS.map(([v, n]) => `<button data-v="${v}" class="${(d.extraBody?.reasoning_effort || '') === v ? 'on' : ''}">${n}</button>`).join('')}</div>`, 'reasoning_effort，网关不支持时选「默认」')}
      ${field('JSON 模式', sw('defaults.jsonMode', d.jsonMode), '要求网关只返回 JSON 对象')}`;
  }

  function chipsPage() {
    const bb0 = draft.blinds[0]?.[1] || 1;
    const top = draft.blinds.length * draft.handsPerLevel;
    const preset = Object.entries(BLIND_PRESETS).find(([, v]) => JSON.stringify(v) === JSON.stringify(draft.blinds))?.[0];
    return `
      <h4>起始筹码</h4>
      ${field('每人', numIn('startingStack', draft.startingStack, { min: 100, max: 10000000, step: 100 }), `<span data-depth>= ${fmt(Math.floor(draft.startingStack / bb0))} 个大盲</span>`)}
      <div class="chips-quick">${STACK_QUICK.map((v) => `<button data-stack="${v}" class="${draft.startingStack === v ? 'on' : ''}">${fmt(v)}</button>`).join('')}</div>
      <h4>盲注结构 <small>${draft.blinds.length} 级 · 每 ${draft.handsPerLevel} 手升一级 · 第 ${fmt(top - draft.handsPerLevel + 1)} 手起封顶</small></h4>
      <div class="seg wide" data-preset>${Object.keys(BLIND_PRESETS).map((n) => `<button data-v="${n}" class="${preset === n ? 'on' : ''}">${n}</button>`).join('')}</div>
      <table class="blinds"><thead><tr><th>级别</th><th>小盲</th><th>大盲</th><th></th></tr></thead><tbody>
        ${draft.blinds.map(([sb, bb], k) => `<tr><td>Lv${k + 1}</td>
          <td><input type="number" min="1" data-blind="${k}.0" value="${sb}"></td>
          <td><input type="number" min="1" data-blind="${k}.1" value="${bb}"></td>
          <td><button class="x" data-del="${k}" title="删除这一级" ${draft.blinds.length <= 1 ? 'disabled' : ''}>×</button></td></tr>`).join('')}
      </tbody></table>
      <button class="add-level" data-add>＋ 添加一级</button>`;
  }

  function modesPage() {
    const { squid: q, royale: r } = draft.modes;
    const card = (key, on, icon, title, tagline, rules, fields) => `
      <div class="mode-card ${on ? 'on' : ''}" data-mode="${key}">
        <div class="mode-head"><span class="mode-ico">${icon}</span><div><b>${title}</b><small>${tagline}</small></div>${sw(`modes.${key}.enabled`, on, '开启')}</div>
        <ul class="mode-rules">${rules.map((x) => `<li>${x}</li>`).join('')}</ul>
        <div class="mode-fields">${fields}</div>
      </div>`;
    return `
      <p class="mp-note">两种玩法可以同时开启，规则会写进每个模型的系统提示词，局面信息随每次决策发送。</p>
      ${card('squid', q.enabled, '🦑', '鱿鱼游戏', '人人都得赢一手，最后一个没赢的买单', [
        '每手<b>净赢筹码</b>的玩家得到 1 只鱿鱼，可累积',
        '只剩 2 人没有鱿鱼时，下一只鱿鱼价值 ×2',
        '只剩 1 人没有鱿鱼时：他向其余每人支付「鱿鱼价值 × 对方鱿鱼数」，然后开始新一轮',
        '在局不足 3 人时暂停',
      ], `${field('鱿鱼价值', numIn('modes.squid.unitBB', q.unitBB, { min: 1, max: 20, unit: 'BB' }), '每只鱿鱼值多少个大盲，随盲注上涨')}
         ${field('最后的鱿鱼 ×2', sw('modes.squid.lastDouble', q.lastDouble), '只剩 2 人没有鱿鱼时翻倍')}`)}
      ${card('royale', r.enabled, '🪂', '大逃杀', '毒圈收缩、空投、人头赏金', [
        `毒圈每 ${r.zoneEvery} 手收缩一次，盲注随之升级`,
        '从第 2 阶段起每手每人缴纳<b>毒伤</b>，存进空投箱；缩圈那一手空投箱整箱<b>空投进底池</b>',
        `每人起始筹码的 ${Math.round(r.bountyPct * 100)}% 作为<b>人头赏金</b>；淘汰别人得一半赏金，另一半加到自己人头上`,
        `剩 ${r.finalCircle} 人进入<b>决赛圈</b>，毒伤翻倍`,
      ], `${field('缩圈间隔', numIn('modes.royale.zoneEvery', r.zoneEvery, { min: 2, max: 30, unit: '手' }), '代替普通的涨盲间隔')}
         ${field('毒伤递增', numIn('modes.royale.anteStep', r.anteStep, { min: 0, max: 100, step: 5, unit: '% BB', scale: 0.01 }), '每个阶段每手每人多缴多少大盲，最多 1 BB')}
         ${field('人头赏金', numIn('modes.royale.bountyPct', r.bountyPct, { min: 0, max: 50, step: 5, unit: '%', scale: 0.01 }), `起始筹码中作为赏金的比例（= ${fmt(Math.round(draft.startingStack * r.bountyPct))}）`)}
         ${field('决赛圈', numIn('modes.royale.finalCircle', r.finalCircle, { min: 2, max: 5, unit: '人' }), '剩余人数不超过它时进入决赛圈')}`)}`;
  }

  function paintPage() {
    if (!live) {
      const n = demoOpts.ais;
      page.innerHTML = `<p class="mp-note">当前为本地演示模式（模拟 AI，已开启鱿鱼游戏 + 大逃杀）。${demoOpts.play ? '<br>你坐在近侧的座位上，轮到你时屏幕底部会出现操作栏。' : ''}<br>在项目目录运行 <code>npm start</code> 并打开 <code>localhost:8787</code>，即可选择各座位的模型厂商与模型、填写 API Key 并测试连通，由大模型真实对战。</p>
        ${field('AI 选手数量', stepper(n, demoOpts.play ? 1 : 2, AIS), '改动后页面会刷新、重新开局')}`;
      $('.mp-tabs').hidden = true;
      paintFoot();
      return;
    }
    if (!draft) { page.innerHTML = `<p class="mp-note">${error || '读取设置中…'}</p>`; paintFoot(); return; }
    const y = $('.mp-scroll').scrollTop;
    page.innerHTML = { players: playersPage, providers: providersPage, rules: rulesPage, chips: chipsPage, modes: modesPage }[tab]();
    $('.mp-scroll').scrollTop = y;
    paintFoot();
    paintMode();
  }

  // 输入：直接改草稿，不整页重绘（保持焦点）；结构性变化才重绘
  page.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.k) {
      const k = el.dataset.k;
      if (el.type === 'checkbox') { set(k, el.checked); paintPage(); return; }
      if (el.type === 'number' || el.type === 'range') {
        if (el.value === '') return;
        set(k, Math.round(Number(el.value) * Number(el.dataset.scale || 1) * 100) / 100);
        if (el.type === 'range') el.nextElementSibling.textContent = Number(el.value).toFixed(2);
        if (k === 'startingStack') {
          page.querySelector('[data-depth]').textContent = `= ${fmt(Math.floor(draft.startingStack / (draft.blinds[0]?.[1] || 1)))} 个大盲`;
          page.querySelectorAll('[data-stack]').forEach((b) => b.classList.toggle('on', Number(b.dataset.stack) === draft.startingStack));
        }
      } else {
        set(k, el.value);
        const m = k.match(/^players\.(\d+)\.(style|model)$/);
        if (m?.[2] === 'style') page.querySelector(`[data-count="${m[1]}"]`).textContent = el.value.length;
        if (m?.[2] === 'model') {
          page.querySelector(`[data-seat="${m[1]}"] .seat-sub`).textContent = seatSub(draft.players[m[1]]);
          const tb = page.querySelector(`[data-seat-test="${m[1]}"]`);
          if (tb) tb.disabled = !el.value || !provOf(draft.players[m[1]].provider)?.configured;
        }
        if (k === 'human.name') page.querySelector('.seat.me .seat-head b').textContent = el.value || '你';
      }
    } else if (el.dataset.blind) {
      if (el.value === '') return;
      const [k, j] = el.dataset.blind.split('.').map(Number);
      draft.blinds[k][j] = Math.round(Number(el.value));
    }
    error = '';
    paintFoot();
  });
  page.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k?.endsWith('.provider')) { const i = Number(k.split('.')[1]); delete seatTest[i]; loadModels(draft.players[i].provider); }
    if (e.target.dataset.blind || k === 'handsPerLevel' || k?.startsWith('modes.') || k?.endsWith('.provider')) paintPage();
  });
  // Key 输入框里回车 = 保存
  page.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.keyIn) { e.preventDefault(); const v = e.target.value.trim(); if (v) saveKey(e.target.dataset.keyIn, v); }
  });

  page.addEventListener('click', (e) => {
    const b = e.target.closest('button, .seat-head');
    if (!b || e.target.closest('.sw')) return;
    if (b.dataset.ais) {
      if (!live) return onDemoOpts({ ais: Number(b.dataset.ais) });
      setAiCount(Number(b.dataset.ais));
      paintPage();
      return;
    }
    if (b.classList.contains('seat-head') && !b.dataset.seat) return;
    if (b.dataset.keySave) {
      const v = page.querySelector(`[data-key-in="${b.dataset.keySave}"]`).value.trim();
      if (!v) { provMsg[b.dataset.keySave] = '先粘贴 API Key'; paintPage(); return; }
      return saveKey(b.dataset.keySave, v);
    }
    if (b.dataset.keyClear) { if (confirm(`清除 ${provName(b.dataset.keyClear)} 的 API Key？会从 .env 删除。`)) saveKey(b.dataset.keyClear, null); return; }
    if (b.dataset.provTest) return testProv(b.dataset.provTest);
    if (b.dataset.models) return loadModels(b.dataset.models, true);
    if (b.dataset.seatTest) return testSeat(Number(b.dataset.seatTest));
    const seg = b.parentElement?.dataset;
    if (b.classList.contains('seat-head')) {
      const i = Number(b.dataset.seat);
      open.has(i) ? open.delete(i) : open.add(i);
      b.parentElement.classList.toggle('open', open.has(i));
      if (open.has(i) && !models[draft.players[i].provider]) loadModels(draft.players[i].provider); // 展开时顺带拉模型列表
      return;
    }
    if (seg?.seg) {
      const v = b.dataset.v;
      if (seg.seg.endsWith('.mock')) set(seg.seg, v === 'true');
      else if (seg.seg.endsWith('reasoning_effort')) {
        if (v) set(seg.seg, v); else delete draft.defaults.extraBody?.reasoning_effort;
      }
      paintPage();
    } else if (seg && 'pace' in seg && b.dataset.v) {
      draft.pace = paceOf(PACES.find(([n]) => n === b.dataset.v)[1]);
      paintPage();
    } else if (seg && 'preset' in seg) {
      draft.blinds = clone(BLIND_PRESETS[b.dataset.v]);
      paintPage();
    } else if (b.dataset.stack) {
      draft.startingStack = Number(b.dataset.stack);
      paintPage();
    } else if (b.dataset.del !== undefined) {
      draft.blinds.splice(Number(b.dataset.del), 1);
      paintPage();
    } else if ('add' in b.dataset) {
      draft.blinds.push(nextLevel(draft.blinds[draft.blinds.length - 1] || [5, 10]));
      paintPage();
      const s = $('.mp-scroll'); s.scrollTop = s.scrollHeight;
    } else if ('bulkApply' in b.dataset) {
      const v = page.querySelector('[data-bulk]').value.trim();
      const prov = page.querySelector('[data-bulk-prov]').value;
      if (!v) return;
      draft.players.forEach((p) => { p.provider = prov; p.model = v; p.mock = false; });
      paintPage();
    }
  });

  if (live) loadConfig(); else paintPage();
  paintControl();

  return {
    setStatus(s) { status = { ...status, ...s }; paintControl(); },
    setInfo(text) { infoText = text; $('.mp-info').textContent = text; paintControl(); },
    get dirty() { return !!dirty(); },
  };
}
