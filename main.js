import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BRANDS } from './mascots.js';
import { createTable, FELT } from './table.js';
import { createDemo } from './demo.js';
import { createEnvironment, buildSeatChip, LAMP_Y } from './env.js';
import { createLeaderboard } from './leaderboard.js';
import { createWindow, resetWindows } from './windows.js';
import { createMatchPanel } from './match-panel.js';
import { createSfx } from './sfx.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 300);
const VIEWS = {
  // 荷官视角：站在发牌位（靠镜头一侧的长边中央）看向扇形排开的六位选手
  dealer: { pos: new THREE.Vector3(0, 15, 14), target: new THREE.Vector3(0, 1.4, -2) },
  home: { pos: new THREE.Vector3(0, 8.0, 11.8), target: new THREE.Vector3(0, 1.1, 0) },
  top: { pos: new THREE.Vector3(0, 13.2, 0.5), target: new THREE.Vector3(0, 1, 0) },
};
function layoutCamera() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
layoutCamera();
// 窄屏时把镜头拉远，保证整张桌子在画面里
const fitPos = (v) => v.pos.clone().multiplyScalar(Math.max(1, 1.45 / (innerWidth / innerHeight)));
camera.position.copy(fitPos(VIEWS.dealer));
scene.add(camera);
const fill = new THREE.DirectionalLight(0xfff4ea, 0.6);
fill.position.set(2, 3, 1);
fill.target.position.set(0, 0, -10);
camera.add(fill, fill.target);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(VIEWS.dealer.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 45;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 0.6;

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0xb8a8ff, 0x1a1030, 0.4));
const sun = new THREE.DirectionalLight(0xdcd8ff, 1.0);
sun.position.set(6, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 45 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const lamp = new THREE.SpotLight(0xffe2b8, 60, 20, 0.8, 0.55, 2);
lamp.position.set(0, LAMP_Y, 0);
lamp.target.position.set(0, 0, 0);
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
lamp.shadow.bias = -0.0003;
scene.add(lamp, lamp.target);
// 跟随当前行动座位的聚光灯
const seatLight = new THREE.SpotLight(0xfff0dc, 0, 16, 0.34, 0.6, 2);
seatLight.position.set(0, 7, 0);
scene.add(seatLight, seatLight.target);
const rim = new THREE.DirectionalLight(0xa070ff, 1.4);
rim.position.set(-9, 6, -10);
scene.add(rim);

// ---------- seats ----------
const SEAT = { a: FELT.a + 1.6, b: FELT.b + 1.6, hover: 0.4 };
// 六个座位以荷官（镜头一侧长边外）为圆心扇形排开：从荷官看过去等角间隔，落在座位椭圆上，
// 这样荷官视角里六个人左右均匀分布、名牌互不遮挡。0 号位在最左，顺时针递增
const FAN = { z: 3.5, spread: (76 / 180) * Math.PI };
const fanAngle = (i) => {
  const phi = -FAN.spread + (2 * FAN.spread * i) / 5;
  const dx = Math.sin(phi), dz = -Math.cos(phi);
  // 射线 (dx·t, FAN.z + dz·t) 与座位椭圆的交点
  const A = SEAT.a ** 2, B = SEAT.b ** 2;
  const qa = dx * dx / A + dz * dz / B, qb = (2 * FAN.z * dz) / B, qc = FAN.z ** 2 / B - 1;
  const t = (-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
  return Math.atan2((FAN.z + dz * t) / SEAT.b, (dx * t) / SEAT.a);
};
const seats = BRANDS.map((b, i) => {
  const angle = fanAngle(i);
  const slot = new THREE.Group();
  slot.position.set(SEAT.a * Math.cos(angle), 0, SEAT.b * Math.sin(angle));
  scene.add(slot);

  // 悬浮的品牌色筹码当座位，角色站在筹码上
  const { chip, ring, glow, beam, mats, height } = buildSeatChip(b.color);
  const float = new THREE.Group();
  float.position.y = SEAT.hover;
  float.add(chip, ring);
  beam.position.y += SEAT.hover;
  slot.add(float, glow, beam);

  const pivot = new THREE.Group();
  pivot.position.y = height;
  pivot.rotation.y = Math.atan2(-slot.position.x, -slot.position.z);
  pivot.userData.idx = i;
  float.add(pivot);
  const mascot = b.build();
  pivot.add(mascot.group);
  return { angle, slot, ring, pivot, mascot, float, chip, glow, beam, mats, top: height, yaw: pivot.rotation.y, baseY: height, hl: 0, gold: 0, react: null };
});

// 行动时角色的小动作：过牌点两下、跟注点一下、下注/加注跳起、全下跳起转一圈、弃牌摇头
const sfx = createSfx();
const table = createTable({ scene, seats, brands: BRANDS, sfx, onSeatClick: (i) => focusOn(i), onAction: (i, type) => { seats[i].react = { type, t0: t }; } });
const REACT = {
  check: (u) => ({ dur: 0.5, jump: Math.abs(Math.sin((u / 0.5) * Math.PI * 2)) * 0.12 }),
  call: (u) => ({ dur: 0.4, jump: Math.sin((u / 0.4) * Math.PI) * 0.16 }),
  bet: (u) => ({ dur: 0.55, jump: Math.sin((u / 0.55) * Math.PI) * 0.38, scale: 1 + Math.sin((u / 0.55) * Math.PI) * 0.08 }),
  raise: (u) => ({ dur: 0.6, jump: Math.sin((u / 0.6) * Math.PI) * 0.5, scale: 1 + Math.sin((u / 0.6) * Math.PI) * 0.12 }),
  allin: (u) => ({ dur: 0.9, jump: Math.sin((u / 0.9) * Math.PI) * 0.8, spin: easeInOut(u / 0.9) * Math.PI * 2, scale: 1 + Math.sin((u / 0.9) * Math.PI) * 0.15 }),
  fold: (u) => ({ dur: 0.7, spin: Math.sin(u * 28) * 0.3 * (1 - u / 0.7), jump: -Math.sin((u / 0.7) * Math.PI) * 0.06 }),
};
function easeInOut(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }

scene.traverse((o) => {
  if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; }
});
const env = createEnvironment({ scene, brands: BRANDS, carpet: { a: SEAT.a + 1.25, b: SEAT.b + 1.25 } });

// ---------- 大逃杀：毒圈 ----------
// 一圈发光的能量墙围着牌桌：每次缩圈向内收拢，快缩圈时闪烁预警，决赛圈变红并贴到地毯边缘
const zone = (() => {
  const A = SEAT.a + 1.25, B = SEAT.b + 1.25;
  const color = new THREE.Color(0x3fa9ff);
  const BLUE = new THREE.Color(0x3fa9ff), RED = new THREE.Color(0xff4060);
  const wallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uTime: { value: 0 }, uOpacity: { value: 0 }, uPulse: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uTime, uOpacity, uPulse; varying vec2 vUv;
      void main() {
        float fade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.8); // 底数为负会得到 NaN，经辉光放大成黑块
        float scan = 0.55 + 0.45 * sin(vUv.y * 36.0 - uTime * 2.6);
        float grid = 0.75 + 0.25 * step(0.92, fract(vUv.x * 120.0));
        gl_FragColor = vec4(uColor * (1.1 + uPulse), uOpacity * fade * scan * grid * (1.0 + uPulse));
      }`,
  });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2.6, 180, 1, true), wallMat);
  wall.position.y = 1.3;
  const lineMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const line = new THREE.Mesh(new THREE.RingGeometry(0.992, 1, 180), lineMat);
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.04;
  for (const m of [wall, line]) { m.userData.noShadow = true; m.renderOrder = 5; scene.add(m); }
  let k = 2.4, op = 0;
  return {
    update(dt, time, br) {
      const want = !br ? 2.4 : br.finalCircle ? 1 : Math.max(1.12, 2.3 - (br.phase - 1) * 0.24);
      k += (want - k) * Math.min(1, dt * 0.9);
      op += ((br ? 0.85 : 0) - op) * Math.min(1, dt * 2);
      color.lerp(br?.finalCircle ? RED : BLUE, Math.min(1, dt * 2));
      // 下一手就要缩圈：闪烁预警
      const warn = br && !br.finalCircle && br.handsToShrink === 1 ? 0.5 + 0.5 * Math.sin(time * 6) : 0;
      wallMat.uniforms.uTime.value = time;
      wallMat.uniforms.uOpacity.value = op * 0.55;
      wallMat.uniforms.uPulse.value = warn * 0.8;
      lineMat.opacity = op * (0.7 + warn * 0.3);
      wall.scale.set(A * k, 1, B * k);
      line.scale.set(A * k, B * k, 1);
      wall.visible = line.visible = op > 0.01;
    },
  };
})();

// ---------- post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.38, 0.4, 0.96);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- match source ----------
// 由本地 Node 对局服务驱动（真实模型）；直接用静态服务器打开时退回本地演示
let speed = 1;
let live = null;
try {
  const r = await fetch('/api/status', { cache: 'no-store' });
  if (r.ok) live = await r.json();
} catch { /* 静态服务器：没有 API */ }
const isLive = !!live;
const $ = (id) => document.getElementById(id);

// ---------- floating windows ----------
// 默认布局：左上排行、左下视角、右上对局；窄屏或矮屏时视角/对局先缩小
const compact = innerWidth < 1100 || innerHeight < 760;
createWindow($('win-lb'), { side: 'l', x: 16, y: 16, min: innerWidth < 640 });
createWindow($('win-view'), { side: 'l', x: 16, y: innerWidth < 640 ? 64 : 414, min: compact });
createWindow($('win-match'), { side: 'r', x: 16, y: 16, min: compact && isLive && live.running });
$('btn-reset-layout').addEventListener('click', resetWindows);

const leaderboard = createLeaderboard({ root: $('lb-rows'), handEl: $('lb-hand'), brands: BRANDS, onSelect: (i) => focusOn(i) });
const STAGE_CN = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' };
const renderTable = table.render;
table.render = (st) => {
  renderTable(st);
  leaderboard.update(st);
  $('lb-sum').textContent = leaderboard.leader(st);
  const tn = st.tournament;
  matchPanel.setInfo(st.handId ? [`第 ${st.handId} 手`, tn ? `Lv${tn.level} ${st.blinds.join('/')}` : `盲注 ${st.blinds.join('/')}`, tn ? `剩 ${tn.playersLeft} 人` : STAGE_CN[st.stage]].filter(Boolean).join(' · ') : '');
  director(st);
};

// ---------- match control ----------
// 实时模式：控制都转成发给服务端的命令；演示模式：直接控制本地 demo
const api = (cmd, value) => fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd, value }) })
  .then((r) => r.json()).then(applyStatus);
function applyStatus(s) {
  live = s;
  speed = s.speed;
  matchPanel.setStatus(s);
}
function setDemo(v) {
  v ? demo.start() : demo.stop();
  matchPanel.setStatus({ running: v, speed });
}
function toggleMatch() {
  const starting = isLive ? !live.running || live.paused : !demo.running;
  sfx.ui(starting ? 'start' : 'pause');
  if (!isLive) return setDemo(!demo.running);
  if (!live.running) return api(live.finished ? 'restart' : 'start');
  return api(live.paused ? 'resume' : 'pause');
}
function restartMatch() {
  if (!isLive) return;
  if (live.running && !confirm('重开一场新比赛？当前比赛会作废。')) return;
  api('restart');
}
function setSpeed(v) {
  if (isLive) return api('speed', v);
  speed = v;
  matchPanel.setStatus({ speed });
}
const matchPanel = createMatchPanel({
  root: $('match-body'), summary: $('match-sum'), mini: $('match-mini'), brands: BRANDS, live: isLive,
  onPrimary: toggleMatch, onRestart: restartMatch, onSpeed: setSpeed,
});
const demo = isLive ? null : createDemo({ names: BRANDS.map((b) => b.name), render: table.render, speed: () => speed });
// 对外暴露，便于调试
window.pokerTable = table;
window.pokerDemo = demo;
window.pokerScene = scene;
window.pokerSfx = sfx;
window.pokerRenderer = renderer;
window.pokerComposer = composer;

if (isLive) {
  document.querySelector('.live').lastChild.textContent = 'LIVE';
  applyStatus(live);
  const es = new EventSource('/events');
  es.addEventListener('state', (e) => table.render(JSON.parse(e.data)));
  es.addEventListener('status', (e) => applyStatus(JSON.parse(e.data)));
} else {
  document.querySelector('.live').lastChild.textContent = 'DEMO';
}

// ---------- view settings ----------
// 镜头模式：dealer（荷官，默认）/ home / top / orbit / focus（聚焦某座位）/ free（用户自己拖过）
const PREF_KEY = 'dpzw:view';
const prefs = { follow: false, reveal: true, eq: true, thought: true, board: true, bloom: true, orbit: 0.6, sound: true, volume: 0.6, ambient: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY)) || {}); } catch { /* 无存储 */ }
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* 无存储 */ } };

let fly = null, camMode = 'dealer', focused = -1;
const focusBtns = BRANDS.map((b, i) => {
  const btn = document.createElement('button');
  btn.style.setProperty('--c', '#' + b.color.toString(16).padStart(6, '0'));
  btn.innerHTML = `<span class="dot"></span>${b.name}`;
  btn.title = `快捷键 ${i + 1}`;
  btn.addEventListener('click', () => focusOn(i));
  $('focus-grid').appendChild(btn);
  return btn;
});
function paintView() {
  document.querySelectorAll('#cam-seg [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === camMode));
  focusBtns.forEach((b, i) => b.classList.toggle('on', camMode === 'focus' && focused === i));
  leaderboard.setFocused(camMode === 'focus' ? focused : -1);
  const name = { dealer: '荷官', home: '总览', top: '俯视', orbit: '环绕', free: '自由视角', focus: `聚焦 ${BRANDS[focused]?.name}` }[camMode];
  $('view-sum').textContent = prefs.follow ? `${name} · 跟随` : name;
}
function setAuto(v) { controls.autoRotate = v; }
function focusOn(i) {
  const s = seats[i];
  const p = s.pivot.getWorldPosition(new THREE.Vector3());
  const inward = p.clone().setY(0).normalize().negate();
  fly = { target: p.clone().add(new THREE.Vector3(0, 1.4, 0)), pos: p.clone().addScaledVector(inward, 3.9).add(new THREE.Vector3(0, 2.0, 0)) };
  setAuto(false);
  camMode = 'focus'; focused = i;
  paintView();
}
function goView(name) {
  if (name === 'dealer') {
    // 荷官视角由 dealerFrame() 每帧取景，不走 fly
    fly = null;
    setAuto(false);
    dealerFit.next = 0;
  } else if (name === 'orbit') {
    // 再点一次「环绕」停下
    if (camMode === 'orbit') { setAuto(false); camMode = 'free'; return paintView(); }
    fly = { pos: fitPos(VIEWS.home), target: VIEWS.home.target.clone() };
    setAuto(true);
  } else {
    fly = { pos: fitPos(VIEWS[name]), target: VIEWS[name].target.clone() };
    setAuto(false);
  }
  camMode = name; focused = -1;
  paintView();
}
// 导播跟随：轮到谁就切到谁；一手结束（有赢家）时回到荷官视角
let lastActor = -1;
function director(st) {
  if (!prefs.follow) return;
  const actor = st.toAct ?? -1;
  if (actor === lastActor) return;
  lastActor = actor;
  if (actor >= 0) focusOn(actor);
  else if (st.players.some((p) => p.winner) && camMode === 'focus') goView('dealer');
}
document.querySelectorAll('#cam-seg [data-view]').forEach((b) => b.addEventListener('click', () => goView(b.dataset.view)));

function applyPrefs() {
  table.setRevealAll(prefs.reveal);
  document.body.classList.toggle('no-eq', !prefs.eq);
  document.body.classList.toggle('no-thought', !prefs.thought);
  document.body.classList.toggle('no-board', !prefs.board);
  bloom.enabled = prefs.bloom;
  controls.autoRotateSpeed = prefs.orbit;
  for (const k of ['follow', 'reveal', 'eq', 'thought', 'board', 'bloom']) $(`opt-${k}`).checked = prefs[k];
  $('opt-orbit').value = prefs.orbit;
  $('opt-orbit').nextElementSibling.textContent = `${Number(prefs.orbit).toFixed(1)}×`;
  sfx.set({ on: prefs.sound, volume: prefs.volume, ambient: prefs.ambient });
  $('opt-sound').checked = prefs.sound;
  $('opt-ambient').checked = prefs.ambient;
  $('opt-volume').value = prefs.volume;
  $('opt-volume').nextElementSibling.textContent = `${Math.round(prefs.volume * 100)}`;
  $('opt-volume').disabled = $('opt-ambient').disabled = !prefs.sound;
  paintView();
}
for (const k of ['follow', 'reveal', 'eq', 'thought', 'board', 'bloom']) {
  $(`opt-${k}`).addEventListener('change', (e) => {
    prefs[k] = e.target.checked;
    if (k === 'follow') { lastActor = -1; if (prefs.follow && table.state) director(table.state); }
    savePrefs();
    applyPrefs();
  });
}
$('opt-orbit').addEventListener('input', (e) => { prefs.orbit = Number(e.target.value); savePrefs(); applyPrefs(); });
for (const k of ['sound', 'ambient']) $(`opt-${k}`).addEventListener('change', (e) => { prefs[k] = e.target.checked; savePrefs(); applyPrefs(); });
$('opt-volume').addEventListener('input', (e) => { prefs.volume = Number(e.target.value); savePrefs(); applyPrefs(); });
// 调完音量松手时响一声，让人听到当前音量
$('opt-volume').addEventListener('change', () => sfx.action('call', { bbs: 2 }));
// 浮窗里的按钮与开关：很轻的点击声
document.addEventListener('click', (e) => {
  if (e.target.closest('.mp-primary, #match-mini')) return; // 开始/暂停有自己的声音
  if (e.target.closest('.win button, .hud')) sfx.ui('tick');
});
document.addEventListener('change', (e) => {
  if (e.target.matches('.win input[type=checkbox]') && e.target.id !== 'opt-sound') sfx.ui(e.target.checked ? 'on' : 'off');
});
// 用户自己拖动镜头：结束自动飞行；开着跟随时先关掉，避免和手动操作抢镜头
controls.addEventListener('start', () => {
  fly = null;
  if (camMode !== 'orbit') camMode = 'free';
  if (prefs.follow) { prefs.follow = false; savePrefs(); applyPrefs(); }
  paintView();
});
applyPrefs();

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return; // 在设置里打字时不触发快捷键
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= '1' && e.key <= '6') focusOn(+e.key - 1);
  else if (e.key === '0') goView('dealer');
  else if (e.key === 'h' || e.key === 'H') goView('home');
  else if (e.key === 't' || e.key === 'T') goView('top');
  else if (e.key === 'm' || e.key === 'M') { prefs.sound = !prefs.sound; savePrefs(); applyPrefs(); }
  else if (e.key === ' ') { e.preventDefault(); toggleMatch(); }
});

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pickables = seats.map((s) => s.pivot);
function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  let o = raycaster.intersectObjects(pickables, true)[0]?.object;
  while (o && o.userData.idx === undefined) o = o.parent;
  return o ? o.userData.idx : -1;
}
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) {
    const i = pick(e);
    if (i >= 0) focusOn(i);
  }
  down = null;
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  renderer.domElement.style.cursor = pick(e) >= 0 ? 'pointer' : 'grab';
});

addEventListener('resize', () => {
  layoutCamera();
  dealerFit.next = 0;
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- 荷官视角自动取景 ----------
// 把六块名牌（按带独白时的最大尺寸预留）、每个角色的脚下和桌子前沿一起框进画面的空白区：
// 避开顶部标题条、底部公共牌条和两侧展开的浮窗；名牌之间互不重叠。
// 取景只随窗口尺寸、浮窗位置变化（每 0.4 秒检查一次），不会随名牌内容抖动。
const HUD_Y = 3.5;
// 名牌的预留尺寸，与 index.html 里不同屏宽下的名牌样式对应
const hudBox = () => (innerWidth <= 640 ? { w: 112, h: 84 } : innerWidth <= 1100 ? { w: 148, h: 168 } : { w: 204, h: 152 });
// 候选机位：从平视到俯视。优先用低机位；空间不够时抬高机位，让前后排名牌上下错开
const DEALER_POSES = [
  { pos: new THREE.Vector3(0, 11, 16), target: new THREE.Vector3(0, 1.4, -1.5) },
  { pos: new THREE.Vector3(0, 15, 14), target: new THREE.Vector3(0, 1.4, -2) },
  { pos: new THREE.Vector3(0, 19, 10), target: new THREE.Vector3(0, 1.2, -1.5) },
];
const dealerFit = { pose: DEALER_POSES[1], k: 1, ox: 0, oy: 0, next: 0, snap: true };
const view = { ox: 0, oy: 0 };
const _fitCam = new THREE.PerspectiveCamera();
const _p = new THREE.Vector3();
const fitPoints = [
  ...seats.map((s) => ({ pos: s.slot.position.clone().setY(HUD_Y), hud: true })),
  ...seats.map((s) => ({ pos: s.slot.position.clone().setY(0.2) })),
  { pos: new THREE.Vector3(0, FELT.y, FELT.b + 0.5) },
];
function freeRect(withWins) {
  const W = innerWidth, H = innerHeight, M = 12;
  let top = M, bottom = H - M, l = M, r = W - M;
  for (const el of [$('banner'), $('board-strip')]) {
    const b = el.getBoundingClientRect();
    if (!b.height) continue;
    if (b.top + b.height / 2 < H / 2) top = Math.max(top, b.bottom + M);
    else bottom = Math.min(bottom, b.top - M);
  }
  if (withWins) for (const w of document.querySelectorAll('.win')) {
    const b = w.getBoundingClientRect();
    if (b.bottom < top || b.top > bottom) continue;
    if (b.left + b.width / 2 < W / 2) l = Math.max(l, b.right + M);
    else r = Math.min(r, b.left - M);
  }
  return { l, r, top, bottom };
}
// 镜头离目标的距离乘 k 时，各元素在屏幕上的矩形
function fitBoxes(v, k) {
  _fitCam.copy(camera);
  _fitCam.clearViewOffset();
  _fitCam.position.copy(v.target).addScaledVector(_p.copy(v.pos).sub(v.target), k);
  _fitCam.lookAt(v.target);
  _fitCam.updateMatrixWorld();
  const box = hudBox();
  return fitPoints.map(({ pos, hud }) => {
    _p.copy(pos).project(_fitCam);
    const x = (_p.x + 1) / 2 * innerWidth, y = (1 - _p.y) / 2 * innerHeight;
    return hud ? [x - box.w / 2, y - box.h, x + box.w / 2, y] : [x, y, x, y];
  });
}
const union = (bs) => bs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
const huddle = (bs) => bs.slice(0, 5).some((a, i) => { const b = bs[i + 1]; return Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]); });
function solveFit(pose, withWins) {
  const f = freeRect(withWins);
  const fits = (k) => { const u = union(fitBoxes(pose, k)); return u[2] - u[0] <= f.r - f.l && u[3] - u[1] <= f.bottom - f.top; };
  let lo = 0.4, hi = 3;
  for (let n = 0; n < 18; n++) { const m = (lo + hi) / 2; fits(m) ? (hi = m) : (lo = m); }
  const bs = fitBoxes(pose, hi), u = union(bs);
  return { pose, k: hi, ox: (f.l + f.r) / 2 - (u[0] + u[2]) / 2, oy: (f.top + f.bottom) / 2 - (u[1] + u[3]) / 2, clash: huddle(bs) };
}
function computeDealerFit() {
  // 先在避开浮窗的空白区里找名牌不重叠的机位；放不下时宁可让浮窗盖住一角（浮窗可拖走/缩小），也不让名牌互相叠住
  for (const withWins of [true, false]) {
    for (const pose of DEALER_POSES) {
      const fit = solveFit(pose, withWins);
      if (!fit.clash) return Object.assign(dealerFit, fit);
    }
  }
  Object.assign(dealerFit, solveFit(DEALER_POSES[2], false));
}
function dealerFrame(dt) {
  if (t >= dealerFit.next) { computeDealerFit(); dealerFit.next = t + 0.4; }
  const v = dealerFit.pose;
  const want = _p.copy(v.target).addScaledVector(_v.copy(v.pos).sub(v.target), dealerFit.k);
  const k = dealerFit.snap ? 1 : 1 - Math.pow(0.004, dt);
  dealerFit.snap = false;
  camera.position.lerp(want, k);
  controls.target.lerp(v.target, k);
  view.ox += (dealerFit.ox - view.ox) * k;
  view.oy += (dealerFit.oy - view.oy) * k;
}
function applyViewOffset() {
  if (Math.abs(view.ox) < 0.5 && Math.abs(view.oy) < 0.5) { if (camera.view?.enabled) camera.clearViewOffset(); return; }
  camera.setViewOffset(innerWidth, innerHeight, -view.ox, -view.oy, innerWidth, innerHeight);
}

// ---------- loop ----------
const clock = new THREE.Clock();
const GOLD = new THREE.Color(0xffc85a);
const _v = new THREE.Vector3();
let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  table.update(dt, t, camera, camMode !== 'dealer');
  env.update(t, dt, table.state);
  zone.update(dt, t, table.state?.modes?.royale);
  let litSeat = -1;
  seats.forEach((s, i) => {
    s.mascot.update(t);
    const st = table.status(i);
    if (st.active || st.winner) litSeat = i;
    // 高亮：行动中 / 赢家 → 筹码升起发光、光柱、地面光晕放大；赢家光柱为金色
    const k = Math.min(1, dt * 5);
    s.hl += ((st.active || st.winner ? 1 : 0) - s.hl) * k;
    s.gold += ((st.winner ? 1 : 0) - s.gold) * k;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    // 赢家蹦跳，弃牌的稍微缩一下
    const hop = st.winner ? Math.abs(Math.sin(t * 7)) * 0.35 : 0;
    s.baseY += (s.top + hop - s.baseY) * Math.min(1, dt * 12);
    let r = { jump: 0, spin: 0, scale: 1 };
    if (s.react) {
      const u = t - s.react.t0;
      const R = REACT[s.react.type]?.(u);
      if (!R || u >= R.dur) s.react = null;
      else r = { ...r, ...R };
    }
    s.pivot.position.y = s.baseY + r.jump;
    s.pivot.rotation.y = s.yaw + r.spin;
    const bob = Math.sin(t * 1.4 + i * 1.1);
    s.float.position.y = SEAT.hover + bob * 0.07 + s.hl * 0.28;
    s.chip.rotation.y = t * (0.25 + s.hl * 0.9) + i;
    s.mats.forEach((m) => { m.emissiveIntensity = s.hl * (0.3 + pulse * 0.25); });
    s.glow.material.opacity = 0.38 - bob * 0.08 + s.hl * (0.35 + pulse * 0.15);
    s.glow.scale.setScalar(1 + s.hl * 0.3);
    s.beam.visible = s.hl > 0.01;
    s.beam.material.uniforms.uOpacity.value = s.hl * (0.55 + pulse * 0.2);
    s.beam.material.uniforms.uColor.value.set(BRANDS[i].color).lerp(GOLD, s.gold);
    s.beam.position.y = SEAT.hover + s.hl * 0.28 + 2.3;
    const sc = (st.folded || st.out ? 0.88 : 1) + s.hl * 0.06;
    s.baseScale = (s.baseScale ?? 1) + (sc - (s.baseScale ?? 1)) * Math.min(1, dt * 6);
    s.pivot.scale.setScalar(s.baseScale * r.scale);
  });
  if (litSeat >= 0) {
    const p = seats[litSeat].slot.position;
    seatLight.position.lerp(_v.set(p.x * 0.75, 7, p.z * 0.75), Math.min(1, dt * 6));
    seatLight.target.position.lerp(_v.set(p.x, 1.2, p.z), Math.min(1, dt * 6));
  }
  seatLight.intensity += ((litSeat >= 0 ? 110 : 0) - seatLight.intensity) * Math.min(1, dt * 4);

  if (camMode === 'dealer') dealerFrame(dt);
  else {
    const k = 1 - Math.pow(0.004, dt);
    view.ox -= view.ox * k;
    view.oy -= view.oy * k;
  }
  applyViewOffset();
  if (fly) {
    const k = 1 - Math.pow(0.004, dt);
    camera.position.lerp(fly.pos, k);
    controls.target.lerp(fly.target, k);
    if (camera.position.distanceTo(fly.pos) < 0.01 && controls.target.distanceTo(fly.target) < 0.01) fly = null;
  }
  controls.update();
  composer.render();
  labelRenderer.render(scene, camera);
});

if (!isLive) setDemo(true);
