import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { equity, bestHand, bestCombo, handName } from './poker.js';

/**
 * 德州扑克桌视图层 —— 只负责"画"，不含任何规则逻辑。
 * 游戏引擎（demo.js，或之后接入真实模型的对局服务）每一步调用 table.render(state)，
 * 视图自己对比前后两次 state，播放发牌、下注、收池、派彩等动画。
 *
 * state = {
 *   handId:  number,                  // 变化即视为新一手：清桌并重新发底牌
 *   stage:   'preflop' | 'flop' | 'turn' | 'river' | 'showdown',
 *   board:   ['Ah', 'Kd', '7c'],       // 公共牌；编码 = 点数(23456789TJQKA) + 花色(s h d c)
 *   pot:     number,                   // 已收进底池的筹码（不含本轮各家面前的下注）
 *   dealer:  number,                   // 庄位座位号 0-5
 *   toAct:   number,                   // 正在思考的座位号，-1 表示无人
 *   blinds:  [sb, bb],
 *   message: string,                   // 顶部横幅文字，可为空
 *   players: [{                        // 长度 6，按座位顺序（顺时针 = 行动顺序）
 *     stack, bet,                      // 剩余筹码 / 本轮面前已下注
 *     cards: ['As', 'Kd'] | ['?', '?'] | null,   // '?' = 未知只显示牌背；null = 本手不在局
 *     folded, allIn, revealed,         // revealed: 亮牌
 *     winner, handName,                // 摊牌结果，如 '葫芦'
 *     lastAction: { type: 'fold'|'check'|'call'|'bet'|'raise'|'allin'|'sb'|'bb', amount? } | null,
 *     thought: string                  // 可选：模型的一句话"内心独白"，显示在名牌下方
 *   }]
 * }
 */

export const FELT = { a: 4.4, b: 2.7, y: 1.0 };
const CARD = { w: 0.58, h: 0.81, t: 0.012 };
const CHIP = { r: 0.11, h: 0.032 };
const POT_POS = new THREE.Vector3(0, FELT.y, 1.35); // 选手在远端扇形排开，底池放在荷官面前，和公共牌留出间距
const DECK_POS = new THREE.Vector3(-1.15, FELT.y, 1.55); // 荷官正前方、底池左侧：远离所有选手的底牌，不会挡住两端座位
const BOARD_Z = 0.05;
const boardPos = (k) => new THREE.Vector3((k - 2) * 0.68, FELT.y + CARD.t / 2 + 0.002, BOARD_Z);

const STAGE_NAME = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' };
const ACTION_NAME = { fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注', allin: '全下', sb: '小盲', bb: '大盲' };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
// 行动特效：颜色（3D 光环与浮层共用）、图标与动词
const ACTION_FX = {
  fold: { color: 0x9aa0b4, icon: '✕', verb: '弃牌' },
  check: { color: 0x4fe39a, icon: '✓', verb: '过牌' },
  call: { color: 0x4fb3ff, icon: '＝', verb: '跟注' },
  bet: { color: 0xffa040, icon: '↑', verb: '下注' },
  raise: { color: 0xff7a3c, icon: '⇈', verb: '加注到' },
  allin: { color: 0xff3b5c, icon: '⚡', verb: '全下' },
  // 特殊玩法的桌面浮层
  squid: { color: 0xff3d8b, icon: '🦑', verb: '鱿鱼' },
  pay: { color: 0xff3d8b, icon: '🦑', verb: '买单' },
  gain: { color: 0xff7ab0, icon: '＋', verb: '鱿鱼钱' },
  kill: { color: 0xffb02e, icon: '⚔', verb: '淘汰' },
  airdrop: { color: 0xffc04a, icon: '🪂', verb: '空投' },
};
// 不在本手：已淘汰，或开赛后没有底牌（大厅阶段大家都没有牌，不算出局）
const isOut = (st, p) => !!p.eliminated || (!p.cards && st.handId > 0);
const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
const known = (c) => c && c !== '?';
function cardHTML(code, cls = '') {
  if (!known(code)) return `<span class="pc back ${cls}"></span>`;
  return `<span class="pc s-${code[1]} ${cls}"><b>${code[0] === 'T' ? '10' : code[0]}</b><i>${SUIT_SYM[code[1]]}\uFE0E</i></span>`;
}

// ---------- textures ----------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function toTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function roundRect(x, X, Y, W, H, r) {
  x.beginPath();
  x.roundRect(X, Y, W, H, r);
}

function feltTexture() {
  const { a, b } = FELT;
  const W = 2048, H = Math.round(2048 * b / a);
  const [c, x] = canvas(W, H);
  const g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
  g.addColorStop(0, '#1f7d55');
  g.addColorStop(0.65, '#14603f');
  g.addColorStop(1, '#0a3a25');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 26000; i++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`;
    x.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  const px = (wx, wz) => [(wx / a + 1) / 2 * W, (wz / b + 1) / 2 * H];
  const sx = W / (2 * a);
  x.strokeStyle = 'rgba(255,226,150,.35)';
  x.lineWidth = 5;
  x.beginPath();
  x.ellipse(W / 2, H / 2, W / 2 * 0.66, H / 2 * 0.6, 0, 0, Math.PI * 2);
  x.stroke();
  x.strokeStyle = 'rgba(255,255,255,.18)';
  x.lineWidth = 4;
  for (let k = 0; k < 5; k++) {
    const p = boardPos(k);
    const [cx, cy] = px(p.x, p.z);
    roundRect(x, cx - CARD.w / 2 * sx - 6, cy - CARD.h / 2 * sx - 6, CARD.w * sx + 12, CARD.h * sx + 12, 14);
    x.stroke();
  }
  const [pcx, pcy] = px(POT_POS.x, POT_POS.z);
  x.beginPath();
  x.arc(pcx, pcy, 0.42 * sx, 0, Math.PI * 2);
  x.stroke();
  x.textAlign = 'center';
  x.fillStyle = 'rgba(255,240,200,.16)';
  x.font = '900 96px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  x.fillText('德扑之王', W / 2, H * 0.93);
  x.font = '600 32px "Helvetica Neue", Arial, sans-serif';
  x.fillText("KING OF HOLD'EM  ·  NO LIMIT  ·  6-MAX", W / 2, H * 0.965);
  return toTexture(c);
}

// 四色牌：转播常用，观众一眼分清花色
const SUITS = { s: ['♠', '#1b1c24'], h: ['♥', '#d0263a'], d: ['♦', '#1f6fd6'], c: ['♣', '#178a4a'] };
const faceCache = new Map();
// 大号点数 + 大号花色：远距离 / 俯视时也能一眼认出
function cardFaceMaterial(code) {
  if (faceCache.has(code)) return faceCache.get(code);
  const [c, x] = canvas(256, 358);
  x.fillStyle = '#efeadd';
  roundRect(x, 0, 0, 256, 358, 22);
  x.fill();
  x.strokeStyle = 'rgba(0,0,0,.18)';
  x.lineWidth = 4;
  roundRect(x, 2, 2, 252, 354, 20);
  x.stroke();
  const [sym, color] = SUITS[code[1]];
  const rank = code[0] === 'T' ? '10' : code[0];
  x.fillStyle = color;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `900 ${rank.length > 1 ? 136 : 160}px "Helvetica Neue", Arial, sans-serif`;
  x.fillText(rank, 128, 112);
  x.font = '170px "Apple Symbols", "Segoe UI Symbol", sans-serif';
  x.fillText(sym, 128, 262);
  const m = new THREE.MeshStandardMaterial({ map: toTexture(c), color: 0xc8c4ba, roughness: 0.85 });
  faceCache.set(code, m);
  return m;
}
const backMaterial = (() => {
  const [c, x] = canvas(256, 358);
  x.fillStyle = '#fbfaf5';
  roundRect(x, 0, 0, 256, 358, 22);
  x.fill();
  const g = x.createLinearGradient(0, 0, 256, 358);
  g.addColorStop(0, '#25307a');
  g.addColorStop(1, '#141a45');
  x.fillStyle = g;
  roundRect(x, 14, 14, 228, 330, 14);
  x.fill();
  x.strokeStyle = 'rgba(255,255,255,.12)';
  x.lineWidth = 2;
  for (let i = -360; i < 360; i += 22) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 358, 358); x.stroke();
    x.beginPath(); x.moveTo(i + 358, 0); x.lineTo(i, 358); x.stroke();
  }
  x.fillStyle = 'rgba(255,220,150,.9)';
  x.font = '800 64px "Helvetica Neue", Arial, sans-serif';
  x.textAlign = 'center';
  x.fillText('AI', 128, 200);
  return new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.4 });
})();
const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.8 });
const cardGeometry = new THREE.BoxGeometry(CARD.w, CARD.t, CARD.h);

const DENOMS = [
  { v: 500, c: '#7b3fe4', s: '#ffffff' },
  { v: 100, c: '#1d1d22', s: '#e8e8e8' },
  { v: 25, c: '#1f9d55', s: '#ffffff' },
  { v: 5, c: '#d63a3a', s: '#ffffff' },
  { v: 1, c: '#f0f0f0', s: '#2f6bff' },
];
const chipGeometry = new THREE.CylinderGeometry(CHIP.r, CHIP.r, CHIP.h, 32);
DENOMS.forEach((d) => {
  const [sc, sx] = canvas(256, 32);
  sx.fillStyle = d.c;
  sx.fillRect(0, 0, 256, 32);
  sx.fillStyle = d.s;
  for (let i = 0; i < 8; i++) sx.fillRect(i * 32 + 8, 0, 14, 32);
  const [tc, tx] = canvas(128, 128);
  tx.fillStyle = d.c;
  tx.fillRect(0, 0, 128, 128);
  tx.strokeStyle = d.s;
  tx.lineWidth = 10;
  tx.setLineDash([14, 12]);
  tx.beginPath(); tx.arc(64, 64, 54, 0, Math.PI * 2); tx.stroke();
  tx.setLineDash([]);
  tx.lineWidth = 3;
  tx.beginPath(); tx.arc(64, 64, 36, 0, Math.PI * 2); tx.stroke();
  tx.fillStyle = d.s;
  tx.font = '800 30px Arial';
  tx.textAlign = 'center';
  tx.textBaseline = 'middle';
  tx.fillText(String(d.v), 64, 66);
  const side = new THREE.MeshStandardMaterial({ map: toTexture(sc), roughness: 0.35 });
  const top = new THREE.MeshStandardMaterial({ map: toTexture(tc), roughness: 0.35 });
  d.materials = [side, top, top];
});

function chipBreakdown(amount) {
  const counts = DENOMS.map(() => 0);
  let rest = Math.max(0, Math.round(amount));
  DENOMS.forEach((d, i) => { counts[i] = Math.floor(rest / d.v); rest -= counts[i] * d.v; });
  const total = () => counts.reduce((s, n) => s + n, 0);
  // 把大面额拆成小面额，让筹码堆看起来更丰富
  for (let guard = 0; guard < 60 && total() < 18; guard++) {
    const i = counts.findIndex((n, k) => n > 0 && k < DENOMS.length - 1);
    if (i < 0) break;
    const ratio = DENOMS[i].v / DENOMS[i + 1].v;
    if (total() - 1 + ratio > 40) break;
    counts[i]--;
    counts[i + 1] += ratio;
  }
  return counts;
}
const COLUMN_OFFSETS = [[0, 0], [0.235, 0], [-0.235, 0], [0.118, 0.205], [-0.118, 0.205], [0.118, -0.205], [-0.118, -0.205], [0.47, 0], [-0.47, 0], [0.353, 0.205], [-0.353, -0.205], [0.353, -0.205]];
function buildChips(amount) {
  const g = new THREE.Group();
  const cols = [];
  chipBreakdown(amount).forEach((n, di) => { for (let k = 0; k < n; k += 10) cols.push([di, Math.min(10, n - k)]); });
  cols.slice(0, COLUMN_OFFSETS.length).forEach(([di, n], ci) => {
    const [ox, oz] = COLUMN_OFFSETS[ci];
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(chipGeometry, DENOMS[di].materials);
      m.position.set(ox + (Math.random() - 0.5) * 0.012, CHIP.h * (j + 0.5), oz + (Math.random() - 0.5) * 0.012);
      m.rotation.y = Math.random() * Math.PI;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
  });
  return g;
}

// ---------- tweens ----------
const easeOut = (u) => 1 - Math.pow(1 - u, 3);
const tweens = [];
function tween(target, to, dur, { delay = 0, ease = easeOut, arc = 0, onDone } = {}) {
  for (let k = tweens.length - 1; k >= 0; k--) if (tweens[k].target === target) tweens.splice(k, 1);
  tweens.push({ target, to, dur, delay, ease, arc, onDone, from: null, t: 0 });
}
const after = (sec, fn) => tweens.push({ target: {}, to: {}, dur: sec, delay: 0, ease: easeOut, arc: 0, onDone: fn, from: null, t: 0 });
function stepTweens(dt) {
  for (let k = tweens.length - 1; k >= 0; k--) {
    const tw = tweens[k];
    if (!tw) continue;
    if (tw.delay > 0) { tw.delay -= dt; continue; }
    if (!tw.from) { tw.from = {}; for (const key in tw.to) tw.from[key] = tw.target[key]; }
    tw.t += dt;
    const u = Math.min(1, tw.t / tw.dur), e = tw.ease(u);
    for (const key in tw.to) tw.target[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * e;
    if (tw.arc) tw.target.y += Math.sin(Math.PI * u) * tw.arc;
    if (u >= 1) {
      const i = tweens.indexOf(tw);
      if (i >= 0) tweens.splice(i, 1);
      tw.onDone?.();
    }
  }
}

// ---------- table ----------
function buildTableMesh() {
  const { a, b, y } = FELT;
  const g = new THREE.Group();
  const felt = new THREE.Mesh(new THREE.CircleGeometry(1, 160), new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }));
  felt.scale.set(a, b, 1);
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = y;
  felt.receiveShadow = true;
  g.add(felt);

  const ring = (ra, rb, ia, ib, opts) => {
    const s = new THREE.Shape();
    s.absellipse(0, 0, ra, rb, 0, Math.PI * 2, false);
    const h = new THREE.Path();
    h.absellipse(0, 0, ia, ib, 0, Math.PI * 2, true);
    s.holes.push(h);
    const geo = new THREE.ExtrudeGeometry(s, { curveSegments: 160, ...opts });
    geo.rotateX(-Math.PI / 2);
    return geo;
  };
  const rail = new THREE.Mesh(
    ring(a + 0.45, b + 0.45, a + 0.06, b + 0.06, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 8 }),
    new THREE.MeshPhysicalMaterial({ color: 0x2a1810, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.35 }));
  rail.position.y = y - 0.02;
  const wood = new THREE.Mesh(
    ring(a + 0.62, b + 0.62, a + 0.2, b + 0.2, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }),
    new THREE.MeshStandardMaterial({ color: 0x7a4422, roughness: 0.35, metalness: 0.1 }));
  wood.position.y = y - 0.16;
  const bodyShape = new THREE.Shape();
  bodyShape.absellipse(0, 0, a + 0.3, b + 0.3, 0, Math.PI * 2, false);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 0.3, bevelEnabled: false, curveSegments: 120 });
  bodyGeo.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x17131c, roughness: 0.6 }));
  body.position.y = y - 0.36;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, y - 0.36, 40), new THREE.MeshStandardMaterial({ color: 0x17131c, roughness: 0.5, metalness: 0.3 }));
  column.position.y = (y - 0.36) / 2;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.1, 64), column.material);
  foot.scale.x = 1.5;
  foot.position.y = 0.05;
  g.add(rail, wood, body, column, foot);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function createTable({ scene, seats, brands, onSeatClick, onAction, sfx }) {
  const root = new THREE.Group();
  scene.add(root);
  root.add(buildTableMesh());

  const deck = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(cardGeometry, [edgeMaterial, edgeMaterial, edgeMaterial, backMaterial, edgeMaterial, edgeMaterial]);
    m.rotation.z = Math.PI;
    m.position.set((Math.random() - 0.5) * 0.01, CARD.t * (i + 0.5), (Math.random() - 0.5) * 0.01);
    m.castShadow = true;
    deck.add(m);
  }
  deck.position.copy(DECK_POS);
  deck.rotation.y = -0.15;
  root.add(deck);
  const deckTop = DECK_POS.clone().setY(FELT.y + 14 * CARD.t + 0.01);

  const button = new THREE.Group();
  {
    const [c, x] = canvas(128, 128);
    x.fillStyle = '#f7f5ee'; x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#1b1c24'; x.font = '900 72px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('D', 64, 68);
    const side = new THREE.MeshStandardMaterial({ color: 0xf7f5ee, roughness: 0.3 });
    const top = new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.3 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 40), [side, top, side]);
    m.position.y = 0.025;
    m.castShadow = true;
    button.add(m);
  }
  button.position.copy(DECK_POS);
  root.add(button);

  // per-seat geometry on the felt
  const geo = seats.map((s) => {
    const th = s.angle;
    const P = (f) => new THREE.Vector3(f * FELT.a * Math.cos(th), FELT.y, f * FELT.b * Math.sin(th));
    const hole = P(0.74);
    const yaw = Math.atan2(hole.x, hole.z);
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const inward = hole.clone().setY(0).normalize().negate();
    return {
      yaw, hole, side,
      bet: P(0.5),
      stack: hole.clone().addScaledVector(side, 0.86),
      button: hole.clone().addScaledVector(side, -0.84).addScaledVector(inward, 0.12),
    };
  });
  const holeSlot = (i, k) => {
    const s = geo[i];
    const p = s.hole.clone().addScaledVector(s.side, k ? 0.2 : -0.2);
    p.y = FELT.y + CARD.t / 2 + 0.002 + k * 0.003;
    return { p, yaw: s.yaw + (k ? -0.08 : 0.08) };
  };

  // HUD labels
  const huds = seats.map((s, i) => {
    const b = brands[i];
    const hex = '#' + b.color.toString(16).padStart(6, '0');
    const el = document.createElement('div');
    el.className = 'hud';
    el.style.setProperty('--c', hex);
    el.innerHTML = `
      <div class="hud-top"><span class="dot"></span><b>${b.name}</b><span class="hud-d">D</span></div>
      <div class="hud-tags"></div>
      <div class="hud-mid"><div class="hud-cards"></div><div class="hud-eq"><b></b><small></small></div></div>
      <div class="hud-bar"><i></i></div>
      <div class="hud-row"><span class="hud-stack"></span><span class="hud-act"></span></div>
      <div class="hud-thought"></div>`;
    el.addEventListener('click', () => onSeatClick?.(i));
    const obj = new CSS2DObject(el);
    obj.position.y = 3.5;
    obj.center.set(0.5, 1);
    s.slot.add(obj);
    const q = (sel) => el.querySelector(sel);
    return { obj, el, tags: q('.hud-tags'), tagKey: '', stack: q('.hud-stack'), act: q('.hud-act'), thought: q('.hud-thought'), cards: q('.hud-cards'), eq: q('.hud-eq b'), made: q('.hud-eq small'), bar: q('.hud-bar i') };
  });

  // 底池数 = 已收进底池 + 本轮各家面前的下注；每次有人下注就跳一下并滚动到新数值
  // 外层交给 CSS2DRenderer 定位（它会写 transform），内层做"跳一下"的缩放动画；
  // 两者放在同一个元素上时，动画的 transform 会覆盖定位，标签会闪到屏幕左上角
  const potWrap = document.createElement('div');
  const potEl = document.createElement('div');
  potEl.className = 'pot-label';
  potEl.innerHTML = '<span></span><small></small>';
  potWrap.appendChild(potEl);
  const potNum = potEl.firstChild, potSub = potEl.lastChild;
  const potCount = { shown: 0, target: 0 };
  const potLabel = new CSS2DObject(potWrap);
  // 标签贴在筹码堆右侧、贴近桌面，不会悬到公共牌上方
  potLabel.position.copy(POT_POS).add(new THREE.Vector3(0.5, 0.12, 0));
  potLabel.center.set(0, 0.5);
  root.add(potLabel);
  const infoEl = document.getElementById('table-info');
  const modesEl = document.getElementById('table-modes');
  const msgEl = document.getElementById('table-msg');
  const strip = document.getElementById('board-strip');
  const flashEl = document.getElementById('fx-flash');
  const brandHex = brands.map((b) => '#' + b.color.toString(16).padStart(6, '0'));
  // 音效：没有传入时全部静默；每个座位按左右位置给一个声像
  const S = sfx || new Proxy({}, { get: () => () => {} });
  const panOf = seats.map((s) => Math.max(-0.7, Math.min(0.7, s.slot.position.x / 7)));

  // ---------- 行动特效 ----------
  // 桌面光环：从某点向外扩散并淡出的环（加法混合，配合辉光）
  const fxList = [];
  const ringGeo = new THREE.RingGeometry(0.82, 1, 72);
  function ripple(pos, color, { size = 1, dur = 0.8, delay = 0 } = {}) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, FELT.y + 0.012, pos.z);
    m.scale.setScalar(0.001);
    m.userData.noShadow = true;
    root.add(m);
    fxList.push({ m, t: -delay, dur, size });
  }
  function stepFx(dt) {
    for (let k = fxList.length - 1; k >= 0; k--) {
      const f = fxList[k];
      f.t += dt;
      if (f.t < 0) continue;
      const u = Math.min(1, f.t / f.dur);
      f.m.scale.setScalar(0.05 + f.size * easeOut(u));
      f.m.material.opacity = 0.9 * Math.pow(1 - u, 1.6);
      if (u >= 1) { root.remove(f.m); f.m.material.dispose(); fxList.splice(k, 1); }
    }
  }

  // 桌面上的行动浮层：出现在该选手的下注位上方，约 2 秒后淡出
  const callouts = seats.map(() => null);
  function callout(ev) {
    const fx = ACTION_FX[ev.type];
    const key = ev.key ?? ev.seat;
    if (callouts[key]) { root.remove(callouts[key].obj); clearTimeout(callouts[key].timer); }
    // 外层交给 CSS2DRenderer 定位（它会写 transform），内层再做弹出动画，避免互相覆盖
    const el = document.createElement('div');
    const card = document.createElement('div');
    el.appendChild(card);
    card.className = 'act-fx';
    card.dataset.type = ev.type;
    card.style.setProperty('--c', ev.seat >= 0 ? brandHex[ev.seat] : '#ffc04a');
    card.innerHTML = `<i>${fx.icon}</i><b>${ev.verb ?? (ev.type === 'allin' ? 'ALL IN' : fx.verb)}</b>${ev.amount && ev.type !== 'fold' && ev.type !== 'check' ? `<span>${ev.sign ?? ''}${fmt(ev.amount)}</span>` : ''}${ev.sub ? `<small>${ev.sub}</small>` : ''}`;
    const obj = new CSS2DObject(el);
    obj.position.copy(ev.pos ?? geo[ev.seat].bet).setY(FELT.y + (ev.lift ?? 0.5));
    obj.center.set(0.5, 1);
    root.add(obj);
    const timer = setTimeout(() => { root.remove(obj); if (callouts[key]?.obj === obj) callouts[key] = null; }, ev.ms ?? (ev.type === 'allin' ? 3200 : 2400));
    callouts[key] = { obj, timer };
  }

  // 弃牌：两张牌背面朝上滑向桌心并旋转缩小消失（区别于收牌回牌堆）
  function muck(cards, i) {
    const to = geo[i].hole.clone().lerp(POT_POS, 0.45);
    cards.forEach((c, k) => {
      setFace(c, false);
      tween(c.position, { x: to.x + (k - 0.5) * 0.12, y: FELT.y + 0.02, z: to.z }, 0.45, { delay: k * 0.05, arc: 0.25 });
      tween(c.rotation, { y: c.rotation.y + Math.PI * (k ? 1.2 : -1.2) }, 0.5, { delay: k * 0.05 });
      tween(c.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.3, { delay: 0.55 + k * 0.05, onDone: () => root.remove(c) });
    });
  }

  // 全屏大字：全下、鱿鱼结算、缩圈、空投、决赛圈，各有配色（见 index.html 的 #fx-flash[data-kind]）
  function bigFlash({ kind, color, title, big, amount }) {
    if (!flashEl) return;
    flashEl.dataset.kind = kind;
    flashEl.style.setProperty('--c', color);
    flashEl.innerHTML = `<div>${title ? `<b>${title}</b>` : ''}<span>${big}</span>${amount ? `<em>${amount}</em>` : ''}</div>`;
    flashEl.classList.remove('on');
    void flashEl.offsetWidth; // 重新触发 CSS 动画
    flashEl.classList.add('on');
  }
  const flash = (ev) => bigFlash({ kind: 'allin', color: brandHex[ev.seat], title: brands[ev.seat].name, big: 'ALL IN', amount: fmt(ev.amount) });

  // 一摞筹码从 a 飞到 b（鱿鱼结算、人头赏金）
  function chipFlight(amount, from, to, delay = 0) {
    const g = buildChips(amount);
    g.position.copy(from);
    g.visible = false;
    root.add(g);
    after(delay, () => { g.visible = true; });
    tween(g.position, { x: to.x, y: to.y, z: to.z }, 0.6, { delay, arc: 0.7, onDone: () => root.remove(g) });
  }

  // ---------- 特殊玩法事件 ----------
  // 空投箱：带降落伞从天而降落在底池位置，落地后化成底池里的筹码
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b4a1f, roughness: 0.6, emissive: 0xffa640, emissiveIntensity: 0.25 });
  const crateEdge = new THREE.LineBasicMaterial({ color: 0xffd36e });
  const chuteMat = new THREE.MeshStandardMaterial({ color: 0xff6a3d, roughness: 0.8, side: THREE.DoubleSide, transparent: true });
  function airdrop(amount, land) {
    const g = new THREE.Group();
    const boxGeo = new THREE.BoxGeometry(0.62, 0.46, 0.62);
    const box = new THREE.Mesh(boxGeo, crateMat);
    box.add(new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), crateEdge));
    box.position.y = 0.23;
    const chute = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), chuteMat);
    chute.position.y = 1.75;
    chute.scale.y = 0.6;
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
      [-0.3, 0.46, -0.3], [-0.6, 1.6, -0.6], [0.3, 0.46, -0.3], [0.6, 1.6, -0.6], [-0.3, 0.46, 0.3], [-0.6, 1.6, 0.6], [0.3, 0.46, 0.3], [0.6, 1.6, 0.6],
    ].map((v) => new THREE.Vector3(...v))), new THREE.LineBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.7 }));
    g.add(box, chute, lines);
    g.position.set(POT_POS.x, FELT.y + 9, POT_POS.z);
    g.rotation.y = 0.5;
    root.add(g);
    tween(g.position, { y: FELT.y + 0.01 }, land, { ease: (u) => 1 - Math.pow(1 - u, 2) });
    tween(g.rotation, { y: -0.2, z: 0 }, land);
    after(land, () => {
      ripple(POT_POS, 0xffc04a, { size: 1.6, dur: 0.9 });
      ripple(POT_POS, 0xffe2a0, { size: 0.9, dur: 0.7, delay: 0.12 });
      tween(chute.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.35);
      lines.visible = false;
      callout({ type: 'airdrop', key: 'pot', seat: -1, pos: POT_POS, lift: 0.9, verb: '空投', amount, sign: '+', sub: '已落入底池', ms: 2600 });
      tween(box.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.4, { delay: 0.45, onDone: () => root.remove(g) });
      after(0.5, rebuildPot);
    });
  }

  function playModeEvents(list, st) {
    let d = 0.85; // 结算类事件排在底池推给赢家（0.7 秒）之后，依次出现
    const zone = list.find((e) => e.type === 'zone');
    for (const e of list) {
      const pan = panOf[e.seat] ?? 0;
      if (e.type === 'zone') {
        after(0.15, () => { bigFlash({ kind: 'zone', color: '#3fa9ff', title: '毒圈收缩', big: `第 ${e.phase} 阶段`, amount: `盲注 ${st.blinds.join('/')}` }); S.zone(); });
      } else if (e.type === 'final') {
        after(zone ? 2.2 : 0.15, () => { bigFlash({ kind: 'final', color: '#ff4060', title: `剩余 ${e.players} 人`, big: '决赛圈', amount: '毒伤翻倍' }); S.finalCircle(); });
      } else if (e.type === 'airdrop') {
        const land = 1.6;
        const at = zone ? 1.2 : 0.2;
        after(at, () => { airdrop(e.amount, land); S.airdrop(land); });
      } else if (e.type === 'squid') {
        after(d, () => {
          callout({ type: 'squid', key: 'm' + e.seat, seat: e.seat, pos: geo[e.seat].stack, lift: 0.8, verb: e.value === 2 ? '最后的鱿鱼 ×2' : '+1 鱿鱼', sub: `共 ${e.total} 只`, ms: 2600 });
          ripple(geo[e.seat].stack, 0xff3d8b, { size: 0.9, dur: 0.8 });
          S.squid(pan, e.value);
        });
        d += 0.5;
      } else if (e.type === 'squidSettle') {
        const at = d + 0.3;
        after(at, () => {
          const L = e.loser;
          bigFlash({ kind: 'squid', color: '#ff3d8b', title: `🦑 鱿鱼游戏 · 第 ${e.round} 轮`, big: `${brands[L].name} 买单`, amount: `−${fmt(e.total)}` });
          callout({ type: 'pay', key: 'm' + L, seat: L, pos: geo[L].stack, lift: 0.8, verb: '买单', amount: e.total, sign: '−', ms: 3200 });
          e.pays.forEach((p, k) => {
            if (!p.amount) return;
            chipFlight(p.amount, geo[L].stack, geo[p.seat].stack, 0.5 + k * 0.18);
            after(1.1 + k * 0.18, () => callout({ type: 'gain', key: 'm' + p.seat, seat: p.seat, pos: geo[p.seat].stack, lift: 0.8, verb: '收鱿鱼钱', amount: p.amount, sign: '+', ms: 2400 }));
          });
          S.squidSettle(panOf[L], e.pays.length);
        });
        d = at + 1.8;
      } else if (e.type === 'kill') {
        after(d, () => {
          bigFlash({ kind: 'kill', color: brandHex[e.seat], title: `${brands[e.seat].name} 淘汰 ${brands[e.victim].name}`, big: '舔包', amount: `+${fmt(e.loot)}` });
          chipFlight(e.loot, geo[e.victim].stack, geo[e.seat].stack, 0.2);
          callout({ type: 'kill', key: 'm' + e.seat, seat: e.seat, pos: geo[e.seat].stack, lift: 0.8, verb: `淘汰 ${brands[e.victim].name}`, amount: e.loot, sign: '+', sub: e.bountyUp ? `人头 +${fmt(e.bountyUp)}` : '', ms: 2800 });
          S.kill(pan);
        });
        d += 2;
      }
    }
  }

  function playAction(ev) {
    const g = geo[ev.seat];
    const color = ACTION_FX[ev.type].color;
    callout(ev);
    if (ev.type === 'check') {
      ripple(g.bet, color, { size: 0.55, dur: 0.6 });
      ripple(g.bet, color, { size: 0.55, dur: 0.6, delay: 0.22 });
    } else if (ev.type === 'fold') {
      ripple(g.hole, color, { size: 0.5, dur: 0.7 });
    } else if (ev.type === 'call') {
      ripple(g.bet, color, { size: 0.7, dur: 0.7, delay: 0.4 });
    } else if (ev.type === 'bet' || ev.type === 'raise') {
      ripple(g.bet, color, { size: ev.type === 'raise' ? 1.5 : 1.1, dur: 0.9, delay: 0.4 });
      if (ev.type === 'raise') ripple(g.bet, 0xffd36e, { size: 0.9, dur: 0.7, delay: 0.55 });
    } else if (ev.type === 'allin') {
      ripple(g.bet, color, { size: 2.6, dur: 1.2, delay: 0.4 });
      ripple(g.bet, 0xffd36e, { size: 1.6, dur: 1.0, delay: 0.6 });
      ripple(g.bet, color, { size: 3.6, dur: 1.5, delay: 0.8 });
      flash(ev);
    }
    S.action(ev.type, { pan: panOf[ev.seat], bbs: ev.amount / ev.bb });
    onAction?.(ev.seat, ev.type);
  }

  let lastSeq = 0; // 已播放过的特殊玩法事件序号

  // 本手行动记录，画在底部公共牌条上方的「行动时间线」
  let actionLog = [];
  let logShown = 0;

  // dynamic objects
  let holeCards = seats.map(() => []);
  let boardCards = [];
  const betG = seats.map(() => null);
  const stackG = seats.map(() => null);
  let potG = null;
  const want = { stacks: seats.map(() => 0), bets: seats.map(() => 0), pot: 0 };
  let revealAll = true;
  let prev = null;
  let cur = null;
  const winAmount = seats.map(() => 0);

  function makeCard(code) {
    const known = code && code !== '?';
    const mesh = new THREE.Mesh(cardGeometry, [edgeMaterial, edgeMaterial, known ? cardFaceMaterial(code) : backMaterial, backMaterial, edgeMaterial, edgeMaterial]);
    mesh.rotation.z = Math.PI;
    mesh.castShadow = mesh.receiveShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.copy(deckTop);
    g.rotation.y = deck.rotation.y;
    g.userData = { code, mesh, faceUp: false };
    root.add(g);
    return g;
  }
  function setFace(card, up, delay = 0) {
    const known = card.userData.code && card.userData.code !== '?';
    up = up && known;
    if (card.userData.faceUp === up) return;
    card.userData.faceUp = up;
    tween(card.userData.mesh.rotation, { z: up ? 0 : Math.PI }, 0.35, { delay });
  }
  function discard(cards, delay = 0) {
    cards.forEach((c, k) => {
      setFace(c, false, delay);
      tween(c.position, { x: deckTop.x, y: deckTop.y + 0.02, z: deckTop.z }, 0.45, { delay: delay + k * 0.04, arc: 0.4, onDone: () => root.remove(c) });
    });
  }
  function replaceGroup(old, amount, pos, drop) {
    if (old) root.remove(old);
    if (!amount) return null;
    const g = buildChips(amount);
    g.position.copy(pos);
    if (drop) { g.position.y += 0.35; tween(g.position, { y: pos.y }, 0.3); }
    root.add(g);
    return g;
  }
  const rebuildStack = (i) => { stackG[i] = replaceGroup(stackG[i], want.stacks[i], geo[i].stack, false); };
  const rebuildPot = () => { potG = replaceGroup(potG, want.pot, POT_POS, false); };
  const faceUpFor = (p) => !p.folded && (revealAll || p.revealed);

  function render(st) {
    const p0 = prev;
    const newHand = !p0 || p0.handId !== st.handId;
    cur = st;
    // 新开一场（演示自动重开、服务端重开）时事件序号从头计
    if (!p0 || st.handId < p0.handId || (newHand && st.handId <= 1)) lastSeq = 0;
    const fresh = p0 ? (st.events || []).filter((e) => e.seq > lastSeq) : [];
    (st.events || []).forEach((e) => { lastSeq = Math.max(lastSeq, e.seq); });
    const dropping = fresh.some((e) => e.type === 'airdrop');

    // 行动事件：某位选手的 lastAction 变了（盲注与换街时的状态重置除外）
    const events = [];
    if (newHand) { actionLog = []; logShown = 0; }
    else {
      const prevMax = Math.max(0, ...p0.players.map((q) => q.bet || 0));
      const prevPot = p0.pot + p0.players.reduce((sum, q) => sum + (q.bet || 0), 0);
      st.players.forEach((p, i) => {
        const a = p.lastAction, b = p0.players[i].lastAction;
        if (!a || !ACTION_FX[a.type] || (a.type === 'allin' && a.amount === undefined)) return;
        if (b && a.type === b.type && a.amount === b.amount) return;
        const ev = { seat: i, type: a.type, amount: a.amount || 0, street: p0.stage, bb: st.blinds?.[1] || 1 };
        if (a.type === 'raise' && prevMax > 0) ev.sub = `${(a.amount / prevMax).toFixed(1)} 倍`;
        else if (a.type === 'bet' && prevPot > 0) ev.sub = `${Math.round((a.amount / prevPot) * 100)}% 底池`;
        else if (a.type === 'call' && a.amount > (p0.players[i].bet || 0) && p0.players[i].bet) ev.sub = `补 ${fmt(a.amount - p0.players[i].bet)}`;
        events.push(ev);
      });
    }

    if (newHand) {
      if (holeCards.flat().length + boardCards.length) S.sweep();
      discard([...holeCards.flat(), ...boardCards]);
      holeCards = seats.map(() => []);
      boardCards = [];
      betG.forEach((g, i) => { if (g) root.remove(g); betG[i] = null; });
      if (potG) { root.remove(potG); potG = null; }
      winAmount.fill(0);
    }

    // dealer button
    if (!p0 || p0.dealer !== st.dealer) {
      const bp = geo[st.dealer].button;
      tween(button.position, { x: bp.x, y: bp.y, z: bp.z }, 0.7, { arc: 0.5 });
    }

    // hole cards
    if (newHand) {
      let d = 0.35;
      for (let k = 0; k < 2; k++) {
        for (let n = 1; n <= 6; n++) {
          const i = (st.dealer + n) % 6;
          const p = st.players[i];
          if (!p.cards) continue;
          const c = makeCard(p.cards[k]);
          const { p: pos, yaw } = holeSlot(i, k);
          tween(c.position, { x: pos.x, y: pos.y, z: pos.z }, 0.42, { delay: d, arc: 0.5 });
          tween(c.rotation, { y: yaw }, 0.42, { delay: d });
          if (faceUpFor(p)) setFace(c, true, d + 0.5);
          S.deal(d, panOf[i]);
          holeCards[i].push(c);
          d += 0.07;
        }
      }
    } else {
      st.players.forEach((p, i) => {
        const was = p0.players[i];
        holeCards[i].forEach((c, k) => {
          const code = p.cards?.[k];
          if (code && code !== c.userData.code) {
            c.userData.code = code;
            c.userData.mesh.material[2] = code === '?' ? backMaterial : cardFaceMaterial(code);
          }
        });
        if (p.folded && !was.folded) {
          muck(holeCards[i], i);
          holeCards[i] = [];
        } else {
          if (holeCards[i].length && faceUpFor(p) && !faceUpFor(was)) S.reveal(panOf[i]); // 摊牌亮牌
          holeCards[i].forEach((c) => setFace(c, faceUpFor(p)));
        }
      });
    }

    // board
    const from = newHand ? 0 : Math.min(p0.board.length, st.board.length);
    for (let k = from; k < st.board.length; k++) {
      const c = makeCard(st.board[k]);
      const pos = boardPos(k);
      const delay = (k - from) * 0.18 + (newHand ? 0.6 : 0);
      tween(c.position, { x: pos.x, y: pos.y, z: pos.z }, 0.45, { delay, arc: 0.6 });
      tween(c.rotation, { y: 0 }, 0.45, { delay });
      setFace(c, true, delay + 0.4);
      S.board(delay);
      boardCards.push(c);
    }

    // bets, pot, stacks
    const prevPot = newHand ? 0 : p0.pot;
    const collecting = st.pot > prevPot;
    const payout = !newHand && st.pot === 0 && prevPot > 0;
    let collected = 0;
    st.players.forEach((p, i) => {
      const prevBet = newHand ? 0 : p0.players[i].bet;
      want.bets[i] = p.bet;
      if (p.bet !== prevBet) {
        if (p.bet === 0 && betG[i] && collecting) {
          const g = betG[i];
          betG[i] = null;
          collected++;
          tween(g.position, { x: POT_POS.x, y: POT_POS.y, z: POT_POS.z }, 0.5, { delay: 0.05 * i, onDone: () => root.remove(g) });
        } else if (!newHand && p.bet > prevBet) {
          // 主动下注：这次加进去的筹码从选手的筹码堆飞到下注位，落地后与原有下注合并
          const flying = buildChips(p.bet - prevBet);
          flying.position.copy(geo[i].stack);
          root.add(flying);
          const to = geo[i].bet;
          tween(flying.position, { x: to.x, y: to.y, z: to.z }, 0.42, { arc: 0.45, onDone: () => {
            root.remove(flying);
            betG[i] = replaceGroup(betG[i], want.bets[i], geo[i].bet, false);
          } });
        } else {
          betG[i] = replaceGroup(betG[i], p.bet, geo[i].bet, p.bet > prevBet);
          if (newHand && p.bet > 0) S.post(panOf[i]); // 盲注
        }
      }
    });
    if (collected) S.collect(collected);
    want.pot = st.pot;
    if (payout && potG) {
      const winners = st.players.map((p, i) => (p.winner ? i : -1)).filter((i) => i >= 0);
      const target = geo[winners[0] ?? 0].stack;
      S.payout({
        pan: winners.length === 1 ? panOf[winners[0]] : 0,
        showdown: st.players.some((p) => p.winner && p.handName),
        big: prevPot >= 40 * (st.blinds?.[1] || Infinity),
      });
      const g = potG;
      potG = null;
      tween(g.position, { x: target.x, y: target.y, z: target.z }, 0.7, { arc: 0.4, onDone: () => root.remove(g) });
    } else if (st.pot !== prevPot && !dropping) { // 空投的底池等箱子落地后再出现
      collecting ? after(0.55, rebuildPot) : rebuildPot();
    }
    st.players.forEach((p, i) => {
      const prevStack = p0 ? p0.players[i].stack : -1;
      want.stacks[i] = p.stack;
      if (p.stack === prevStack) return;
      if (payout && p.winner) {
        winAmount[i] = p.stack - prevStack;
        after(0.7, () => rebuildStack(i));
      } else rebuildStack(i);
    });

    // HUD
    st.players.forEach((p, i) => {
      const h = huds[i];
      const active = st.toAct === i;
      h.el.classList.toggle('active', active);
      h.el.classList.toggle('folded', !!p.folded);
      h.el.classList.toggle('winner', !!p.winner);
      h.el.classList.toggle('out', isOut(st, p));
      h.el.classList.toggle('dealer', st.dealer === i);
      // 特殊玩法徽章：鱿鱼、人头赏金、击杀数
      const sq = st.modes?.squid, br = st.modes?.royale;
      const inGame = !p.eliminated && !p.sittingOut;
      const tags = [
        sq && inGame && p.squids ? `<span class="tg sq">🦑${p.squids > 1 ? ' ×' + p.squids : ''}</span>` : '',
        br && inGame && p.bounty ? `<span class="tg bt" title="人头赏金">🎯 ${fmt(p.bounty)}</span>` : '',
        p.kills ? `<span class="tg kl" title="击杀">⚔ ${p.kills}</span>` : '',
      ].join('');
      if (tags !== h.tagKey) { h.tagKey = tags; h.tags.innerHTML = tags; }
      const hunting = !!sq?.active && inGame && !p.squids && st.handId > 0;
      const last = hunting && st.players.filter((q) => !q.eliminated && !q.sittingOut && !q.squids).length === 1;
      h.el.classList.toggle('squid-hunt', hunting && !last);
      h.el.classList.toggle('squid-last', last);
      h.stack.textContent = p.allIn && p.stack === 0 ? '全下' : fmt(p.stack);
      let act = '';
      if (st.tournament?.finished && p.place === 1) act = '冠军';
      else if (p.sittingOut) act = '未参赛';
      else if (p.eliminated) act = p.place ? `第 ${p.place} 名 · 出局` : '出局';
      else if (p.winner) act = (p.handName ? p.handName + ' · ' : '') + (winAmount[i] ? `赢 +${fmt(winAmount[i])}` : '获胜');
      else if (active) act = '思考中';
      else if (p.folded) act = '弃牌';
      else if (st.stage === 'showdown' && p.handName) act = p.handName;
      else if (p.lastAction) act = ACTION_NAME[p.lastAction.type] + (p.lastAction.amount ? ' ' + fmt(p.lastAction.amount) : '');
      h.act.textContent = act;
      h.act.dataset.type = active ? 'thinking' : p.winner ? 'winner' : (p.folded ? 'fold' : p.lastAction?.type || '');
      h.thought.textContent = p.thought || '';
    });
    const street = st.players.reduce((sum, p) => sum + (p.bet || 0), 0);
    const total = st.pot + street;
    if (total > potCount.target && potCount.target > 0) {
      potEl.classList.remove('bump');
      void potEl.offsetWidth; // 重新触发动画
      potEl.classList.add('bump');
    }
    if (total === 0 || newHand) potCount.shown = total;
    potCount.target = total;
    potSub.textContent = street && st.pot ? `本轮 +${fmt(street)}` : '';
    potLabel.visible = total > 0; // CSS2DRenderer 每帧按 visible 写 display，直接改 style 会被覆盖
    if (infoEl) {
      const tn = st.tournament;
      const br = st.modes?.royale, sq = st.modes?.squid;
      infoEl.textContent = st.handId === 0 ? `等待开赛 · 盲注 ${st.blinds.join('/')}`
        : [`第 ${st.handId} 手`, STAGE_NAME[st.stage], tn ? `Lv${tn.level} 盲注 ${st.blinds.join('/')}` : `盲注 ${st.blinds?.join('/') ?? ''}`,
          tn && !tn.finished ? `剩 ${tn.playersLeft} 人 · ${tn.handsToNextLevel} 手后${br ? '缩圈' : '涨盲'}` : ''].filter(Boolean).join(' · ');
      // 特殊玩法状态：标题条下方的小标签
      const chips = [];
      if (sq) {
        const live = st.players.filter((p) => !p.eliminated && !p.sittingOut);
        const without = live.filter((p) => !p.squids).length;
        chips.push(`<span class="mchip sq ${sq.double ? 'hot' : ''}">${!sq.active && st.handId ? '🦑 鱿鱼游戏暂停（不足 3 人）'
          : `🦑 第 ${sq.round} 轮 · ${live.length - without}/${live.length} 有鱿鱼 · 每只 ${fmt(sq.unit)}${sq.double ? ' · 下一只 ×2' : ''}`}</span>`);
      }
      if (br) {
        chips.push(`<span class="mchip br ${br.finalCircle ? 'final' : ''} ${!br.finalCircle && br.handsToShrink === 1 && st.handId ? 'warn' : ''}">${br.finalCircle ? '☢ 决赛圈' : `☢ 毒圈 第 ${br.phase} 阶段`}${br.ante ? ` · 毒伤 ${fmt(br.ante)}` : ''} · 🪂 空投箱 ${fmt(br.crate)}</span>`);
      }
      const html = chips.join('');
      if (modesEl && modesEl.innerHTML !== html) modesEl.innerHTML = html;
    }
    if (st.toAct !== thinking.seat) Object.assign(thinking, { seat: st.toAct, since: performance.now(), shown: 0 });
    if (msgEl) { msgEl.textContent = st.message || ''; msgEl.style.display = st.message ? '' : 'none'; }

    events.forEach((ev) => { actionLog.push(ev); playAction(ev); });
    if (fresh.length) playModeEvents(fresh, st);
    paintBroadcast(st, newHand ? 0 : p0.board.length);
    // 赛事节点：出局、涨盲、冠军
    if (p0) {
      st.players.forEach((p, i) => { if (p.eliminated && !p.sittingOut && !p0.players[i].eliminated) S.bust(panOf[i]); });
      if (st.tournament?.finished && !p0.tournament?.finished) S.champion();
      else if (st.blinds?.[1] > (p0.blinds?.[1] ?? Infinity) && !st.modes?.royale) S.blindsUp(); // 大逃杀里涨盲由缩圈音效代替
    }
    prev = JSON.parse(JSON.stringify(st));
  }

  // ---------- 转播层：名牌里的底牌 / 胜率 / 当前牌型 + 底部公共牌条 ----------
  let eqKey = '', eqCache = null;
  function paintBroadcast(st, prevBoardLen = st.board.length) {
    const visible = (p) => revealAll || p.revealed;
    // 胜率要求所有在局玩家的底牌都已知
    const liveHands = st.players.map((p) => (!p.folded && p.cards ? p.cards : null));
    const allKnown = liveHands.every((h) => !h || h.every(known));
    const key = st.handId + '|' + st.board.join() + '|' + liveHands.map((h) => (h ? h.join() : '-')).join();
    if (key !== eqKey) { eqKey = key; eqCache = allKnown ? equity(liveHands, st.board, 2000) : null; }
    const lead = eqCache ? eqCache.indexOf(Math.max(...eqCache)) : -1;

    // 摊牌时高亮赢家组成最佳牌型的 5 张
    const hl = new Set();
    if (st.stage === 'showdown' && st.board.length === 5) {
      st.players.forEach((p) => { if (p.winner && p.cards?.every(known)) bestCombo([...p.cards, ...st.board]).cards.forEach((c) => hl.add(c)); });
    }

    st.players.forEach((p, i) => {
      const h = huds[i];
      const show = visible(p);
      h.cards.innerHTML = p.cards ? p.cards.map((c) => cardHTML(show ? c : '?', hl.has(c) && show ? 'hl' : '')).join('') : '';
      const eqOn = show && eqCache && !p.folded && p.cards;
      const v = eqOn ? eqCache[i] : 0;
      h.eq.textContent = eqOn ? `${Math.round(v * 100)}%` : '';
      let made = '';
      if (show && p.cards?.every(known) && !p.folded) {
        if (st.board.length >= 3) made = handName(bestHand([...p.cards, ...st.board]));
        else if (p.cards[0][0] === p.cards[1][0]) made = '口袋对';
        else if (p.cards[0][1] === p.cards[1][1]) made = '同花底牌';
      }
      h.made.textContent = made;
      h.bar.style.width = `${(v * 100).toFixed(1)}%`;
      h.el.classList.toggle('lead', eqOn && i === lead && st.stage !== 'showdown' && !st.players.some((q) => q.winner));
      h.el.classList.toggle('has-eq', !!eqOn);
    });

    if (strip) {
      const total = st.pot + st.players.reduce((sum, p) => sum + (p.bet || 0), 0);
      const slots = [0, 1, 2, 3, 4].map((k) => {
        const c = st.board[k];
        if (!c) return '<span class="pc empty"></span>';
        return cardHTML(c, [k >= prevBoardLen ? 'deal' : '', hl.has(c) ? 'hl' : ''].join(' '));
      });
      // 行动时间线：本手按顺序的行动，最新的在最右；正在思考的选手排在末尾
      let street = '';
      const tokens = actionLog.map((ev, k) => {
        const fx = ACTION_FX[ev.type];
        const sep = ev.street !== street ? `<span class="tl-street">${STAGE_NAME[ev.street] || ''}</span>` : '';
        street = ev.street;
        const amt = ev.amount && ev.type !== 'fold' && ev.type !== 'check' ? ` ${fmt(ev.amount)}` : '';
        return `${sep}<span class="tk ${k >= logShown ? 'new' : ''} ${k === actionLog.length - 1 ? 'last' : ''}" data-type="${ev.type}" style="--c:${brandHex[ev.seat]}"><i></i>${brands[ev.seat].name}<b>${ev.type === 'allin' ? '全下' : fx.verb}${amt}</b></span>`;
      });
      logShown = actionLog.length;
      if (st.toAct >= 0) tokens.push(`<span class="tk think" style="--c:${brandHex[st.toAct]}"><i></i>${brands[st.toAct].name}<b>思考中</b></span>`);
      strip.innerHTML = `
        <div class="bs-rail">${tokens.join('')}</div>
        <div class="bs-main">
          <div class="bs-stage"><small>第 ${st.handId} 手</small><b>${STAGE_NAME[st.stage] || ''}</b></div>
          <div class="bs-cards">${slots.join('')}</div>
          <div class="bs-pot"><small>总底池</small><b>${fmt(total)}</b></div>
        </div>`;
    }
  }

  function setRevealAll(v) {
    revealAll = v;
    if (cur) {
      cur.players.forEach((p, i) => holeCards[i].forEach((c) => setFace(c, faceUpFor(p))));
      paintBroadcast(cur);
    }
  }

  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const thinking = { seat: -1, since: 0, shown: 0 };
  function update(dt, t, camera, autoHud = true) {
    stepTweens(dt);
    stepFx(dt);
    if (potCount.shown !== potCount.target) {
      const d = potCount.target - potCount.shown;
      potCount.shown = Math.abs(d) < 1 ? potCount.target : potCount.shown + d * Math.min(1, dt * 9);
    }
    const potText = `底池 ${fmt(Math.round(potCount.shown))}`;
    if (potNum.textContent !== potText) potNum.textContent = potText;
    // 真实模型思考可能要好几秒：在名牌上显示已用时
    if (thinking.seat >= 0) {
      const sec = Math.floor((performance.now() - thinking.since) / 1000);
      if (sec >= 2 && sec !== thinking.shown) { thinking.shown = sec; huds[thinking.seat].act.textContent = `思考中 ${sec}s`; }
    }
    // 名牌放在角色头顶；自由/环绕等镜头下，靠近镜头一侧的座位改放到脚下，避免挡住桌面。
    // 荷官视角里所有选手都在桌子对面，名牌固定在头顶
    if (camera) {
      const cy = _a.set(0, FELT.y, 0).project(camera).y;
      seats.forEach((s, i) => {
        const below = autoHud && s.slot.getWorldPosition(_b).project(camera).y < cy - 0.12;
        huds[i].obj.position.y = below ? -0.05 : 3.5;
        huds[i].obj.center.set(0.5, below ? 0 : 1);
      });
    }
    seats.forEach((s, i) => {
      const p = cur?.players[i];
      const active = cur?.toAct === i;
      const k = active ? 3 + Math.sin(t * 6) * 1.5 : p?.winner ? 4 + Math.sin(t * 10) : p?.folded || (p && isOut(cur, p)) ? 0.2 : 0.8;
      s.ring.material.emissiveIntensity += (k - s.ring.material.emissiveIntensity) * Math.min(1, dt * 8);
    });
  }

  const status = (i) => {
    const p = cur?.players[i];
    return { active: cur?.toAct === i, folded: !!p?.folded, winner: !!p?.winner, out: !!p && isOut(cur, p) };
  };

  return { render, update, setRevealAll, status, get state() { return cur; } };
}
