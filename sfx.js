/**
 * 音效：全部用 Web Audio 实时合成，不需要任何音频文件。
 *
 * 设计原则
 * - 以真实牌桌的物理声音为主：发牌的"嗖—啪"、敲桌过牌、陶瓷筹码的清脆碰撞、弃牌滑过台呢。
 *   这些声音短、轻、贴近画面里的动画时机（筹码飞行 0.42 秒后落地才响）。
 * - 乐音只留给少数关键时刻：全下的低频张力、摊牌赢下底池的铃声、出局、涨盲、冠军。
 *   全部取自 E 大调五声音阶（E F# G# B C#），任意叠在一起都和谐，不会互相打架。
 * - 声音按座位左右声像摆放：左边的选手在左声道，右边的在右声道。
 * - 总线：各声音 → 音量 → 轻度压缩 → 输出；另有一路很短的房间混响，让所有声音像在同一个房间里。
 * - 浏览器要求用户先和页面交互才能出声：第一次点击/按键时自动启用。
 */

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
// E 大调五声音阶里用到的音
const N = { E3: 52, B3: 59, E4: 64, Gs4: 68, B4: 71, Cs5: 73, E5: 76, Fs5: 78, Gs5: 80, B5: 83, E6: 88, Gs6: 92 };
const rand = (a, b) => a + Math.random() * (b - a);

/** @param {{ context?: BaseAudioContext }} [opts] 传入 OfflineAudioContext 可离线渲染，用于测响度 */
export function createSfx({ context } = {}) {
  const st = { on: true, volume: 0.6, ambient: false };
  let ctx = null, out = null, dry = null, wet = null, noiseBuf = null, amb = null;
  const gates = {};

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!context && !AC) return;
    ctx = context || new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    out = ctx.createGain();
    out.gain.value = level();
    out.connect(comp).connect(ctx.destination);
    dry = ctx.createGain();
    dry.connect(out);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(1.3, 3.5);
    wet = ctx.createGain();
    wet.gain.value = 0.22;
    wet.connect(verb).connect(out);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  // 房间混响的脉冲响应：指数衰减的立体声噪声
  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  // 音量滑块按平方映射，更接近听感
  const level = () => (st.on ? 0.9 * st.volume ** 2 : 0);
  function unlock() {
    init();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume().then(() => { if (st.ambient && st.on) ambientOn(); });
  }
  if (context) init();
  else for (const e of ['pointerdown', 'keydown']) addEventListener(e, unlock, { capture: true, passive: true });

  const ready = () => ctx && (context || ctx.state === 'running') && st.on && st.volume > 0;
  // 高倍速时同类声音扎堆：同一类在 ms 毫秒内只响一次
  function gate(key, ms) {
    const now = performance.now();
    if (now - (gates[key] || 0) < ms) return false;
    gates[key] = now;
    return true;
  }

  // ---------- 发声原件 ----------
  function route(node, pan, send) {
    let n = node;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      n.connect(p);
      n = p;
    }
    n.connect(dry);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      n.connect(s).connect(wet);
    }
  }
  function env(g, t, peak, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  // 滤波噪声：纸牌摩擦、筹码碰撞的"质感"部分
  function noise(t, { type = 'bandpass', f = 1000, f2, q = 1, gain = 0.2, a = 0.002, d = 0.05, pan = 0, send = 0 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    const g = ctx.createGain();
    env(g, t, gain, a, d);
    src.connect(fl).connect(g);
    route(g, pan, send);
    src.start(t, Math.random() * 1.6);
    src.stop(t + a + d + 0.05);
  }
  // 正弦/三角波：敲桌的低频、铃声的音高部分
  function tone(t, { f, f2, type = 'sine', gain = 0.1, a = 0.004, d = 0.3, pan = 0, send = 0, lp }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    const g = ctx.createGain();
    env(g, t, gain, a, d);
    let n = o;
    if (lp) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = lp;
      n = n.connect(fl);
    }
    n.connect(g);
    route(g, pan, send);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }
  // 铃：基音 + 两个非整数倍泛音，尾音长、音量小
  function bell(t, midi, { gain = 0.06, d = 1.3, pan = 0, send = 0.4 } = {}) {
    const f = mtof(midi);
    tone(t, { f, gain, a: 0.004, d, pan, send });
    tone(t, { f: f * 2.0, gain: gain * 0.28, a: 0.003, d: d * 0.55, pan, send });
    tone(t, { f: f * 3.01, gain: gain * 0.1, a: 0.002, d: d * 0.3, pan, send });
  }

  // ---------- 牌桌上的物理声音 ----------
  // 一枚陶瓷筹码碰撞：带通噪声的"咔" + 两个很短的高频共振
  function chip(t, pan, g = 1) {
    const r = rand(0.86, 1.14);
    noise(t, { f: 4300 * r, q: 2.6, gain: 0.32 * g, a: 0.001, d: 0.03, pan, send: 0.12 });
    tone(t, { f: 2700 * r, gain: 0.07 * g, a: 0.001, d: 0.045, pan });
    tone(t, { f: 4150 * r, gain: 0.04 * g, a: 0.001, d: 0.03, pan });
  }
  // 一摞筹码落在台呢上：一串间隔不等的碰撞，最后一声闷响
  function chips(t, n, pan, { g = 1, gap = [0.018, 0.05] } = {}) {
    let x = t;
    for (let k = 0; k < n; k++) {
      chip(x, pan + rand(-0.04, 0.04), g * (k === 0 ? 1 : rand(0.55, 0.9)));
      x += rand(gap[0], gap[1]);
    }
    noise(t, { type: 'lowpass', f: 380, q: 0.7, gain: 0.2 * g, a: 0.002, d: 0.07, pan });
  }
  // 筹码被推出去时的一点空气声
  function whoosh(t, pan, { f = 700, f2 = 1900, gain = 0.05, d = 0.28 } = {}) {
    noise(t, { f, f2, q: 0.8, gain, a: 0.1, d, pan });
  }
  // 发一张牌：出手的"嗖" + 落桌的轻拍（落桌时间对齐 0.42 秒的飞行动画）
  function dealCard(t, pan, land = 0.38) {
    noise(t, { f: 2600, f2: 5200, q: 0.7, gain: 0.1, a: 0.012, d: 0.09, pan });
    noise(t + land, { type: 'lowpass', f: 1300, q: 0.6, gain: 0.16, a: 0.002, d: 0.04, pan });
  }
  // 翻牌的"啪"
  function snap(t, pan, g = 1) {
    noise(t, { type: 'highpass', f: 2800, gain: 0.035 * g, a: 0.002, d: 0.022, pan, send: 0.1 });
    noise(t, { f: 1100, q: 1.2, gain: 0.2 * g, a: 0.001, d: 0.035, pan });
  }
  // 指节敲桌
  function knock(t, pan) {
    noise(t, { type: 'lowpass', f: 280, q: 1.1, gain: 0.26, a: 0.002, d: 0.07, pan });
    tone(t, { f: 150, f2: 72, gain: 0.2, a: 0.002, d: 0.09, pan });
    noise(t, { f: 950, q: 2, gain: 0.04, a: 0.001, d: 0.018, pan });
  }

  // 下注额 → 筹码碰撞声的数量（按大盲的倍数取对数，几十倍大盲也不会响成一片）
  const count = (bbs, base, max) => Math.max(base, Math.min(max, Math.round(base + Math.log2(Math.max(1, bbs)) * 1.4)));

  const api = {
    get state() { return { ...st }; },
    set({ on, volume, ambient } = {}) {
      if (on !== undefined) st.on = !!on;
      if (volume !== undefined) st.volume = Math.max(0, Math.min(1, Number(volume)));
      if (ambient !== undefined) st.ambient = !!ambient;
      if (out) out.gain.setTargetAtTime(level(), ctx.currentTime, 0.05);
      if (ctx?.state === 'running') (st.ambient && st.on ? ambientOn() : ambientOff());
    },

    /** 新一手：上一手的牌扫回牌堆 */
    sweep() {
      if (!ready() || !gate('sweep', 300)) return;
      const t = ctx.currentTime;
      noise(t, { f: 1500, f2: 3200, q: 0.6, gain: 0.08, a: 0.08, d: 0.35, send: 0.1 });
    },
    /** 发底牌，delay 与发牌动画一致 */
    deal(delay, pan) {
      if (!ready()) return;
      dealCard(ctx.currentTime + delay, pan);
    },
    /** 公共牌：飞到牌位并翻开 */
    board(delay) {
      if (!ready()) return;
      const t = ctx.currentTime + delay;
      dealCard(t, 0, 0.4);
      snap(t + 0.52, rand(-0.08, 0.08));
    },
    /** 摊牌亮底牌 */
    reveal(pan) {
      if (!ready() || !gate('reveal' + pan, 80)) return;
      const t = ctx.currentTime;
      snap(t, pan, 0.9);
      snap(t + 0.07, pan, 0.7);
    },
    /** 盲注入池 */
    post(pan, delay = 0.3) {
      if (!ready()) return;
      chips(ctx.currentTime + delay, 2, pan, { g: 0.7 });
    },
    /**
     * 选手行动。bbs = 本次下注是大盲的多少倍
     * 过牌：敲桌两下；跟注：筹码落桌；下注/加注：推筹码 + 更多筹码；全下：整摞推出 + 低频张力；弃牌：牌滑过台呢
     */
    action(type, { pan = 0, bbs = 1 } = {}) {
      if (!ready() || !gate('act' + type, 60)) return;
      const t = ctx.currentTime;
      const land = t + 0.38; // 筹码飞行动画 0.42 秒
      if (type === 'check') {
        knock(t + 0.02, pan);
        knock(t + 0.24, pan);
      } else if (type === 'fold') {
        noise(t, { f: 2400, f2: 650, q: 1.1, gain: 0.32, a: 0.025, d: 0.32, pan });
        noise(t + 0.3, { type: 'lowpass', f: 900, gain: 0.1, a: 0.002, d: 0.045, pan });
      } else if (type === 'call') {
        chip(t + 0.02, pan, 0.4);
        chips(land, count(bbs, 3, 7), pan, { g: 0.85 });
      } else if (type === 'bet' || type === 'raise') {
        const raise = type === 'raise';
        whoosh(t, pan, { gain: raise ? 0.06 : 0.045 });
        chips(land, count(bbs, raise ? 5 : 4, raise ? 11 : 9), pan);
        tone(land, { f: raise ? 95 : 110, f2: 55, gain: raise ? 0.16 : 0.1, a: 0.003, d: 0.14, pan }); // 筹码砸在台呢上的分量
      } else if (type === 'allin') {
        whoosh(t, pan, { f: 420, f2: 2600, gain: 0.09, d: 0.42 });
        chips(land, 16, pan, { gap: [0.014, 0.04] });
        // 低频冲击 + 一个很轻的五度和声垫，给"全下"一点张力，但不喧宾夺主
        tone(land, { f: 72, f2: 40, gain: 0.2, a: 0.008, d: 0.9, pan: pan * 0.5 });
        noise(land, { type: 'lowpass', f: 160, gain: 0.12, a: 0.005, d: 0.4 });
        tone(t + 0.05, { f: mtof(N.E3), type: 'triangle', gain: 0.045, a: 0.25, d: 1.1, lp: 900, send: 0.4 });
        tone(t + 0.05, { f: mtof(N.B3), type: 'triangle', gain: 0.035, a: 0.3, d: 1.0, lp: 900, send: 0.4 });
      }
    },
    /** 一条街结束，各家下注收进底池 */
    collect(stacks) {
      if (!ready() || !gate('collect', 200)) return;
      chips(ctx.currentTime + 0.42, Math.min(12, 3 + stacks * 2), 0, { g: 0.75, gap: [0.02, 0.045] });
    },
    /**
     * 底池推给赢家。无人跟到摊牌只有筹码声；摊牌赢下有一串铃声，大底池多一个高音
     */
    payout({ pan = 0, showdown = false, big = false } = {}) {
      if (!ready() || !gate('payout', 400)) return;
      const t = ctx.currentTime;
      chips(t + 0.62, big ? 14 : 9, pan, { g: 0.75, gap: [0.018, 0.04] });
      if (!showdown) return;
      const notes = big ? [N.E5, N.Gs5, N.B5, N.E6] : [N.E5, N.Gs5, N.B5];
      notes.forEach((m, k) => bell(t + 0.12 + k * 0.09, m, { gain: big ? 0.06 : 0.05, pan: pan * 0.4 }));
    },
    /** 选手出局：三个下行的柔和音 */
    bust(pan) {
      if (!ready() || !gate('bust', 300)) return;
      const t = ctx.currentTime + 0.2;
      [N.B4, N.Gs4, N.E4].forEach((m, k) => tone(t + k * 0.17, { f: mtof(m), type: 'triangle', gain: 0.07, a: 0.01, d: 0.55, lp: 1600, pan: pan * 0.5, send: 0.35 }));
      tone(t, { f: 110, f2: 60, gain: 0.07, a: 0.005, d: 0.3 });
    },
    /** 涨盲：叮—咚 */
    blindsUp() {
      if (!ready() || !gate('blinds', 1000)) return;
      const t = ctx.currentTime + 0.15;
      bell(t, N.B5, { gain: 0.05, d: 1.1 });
      bell(t + 0.3, N.E5, { gain: 0.05, d: 1.4 });
    },
    /** 冠军诞生：上行琶音 + 温暖的和弦铺底 + 一阵筹码雨 */
    champion() {
      if (!ready() || !gate('champ', 3000)) return;
      const t = ctx.currentTime + 0.5;
      [N.E4, N.Gs4, N.B4, N.E5, N.Gs5, N.B5, N.E6].forEach((m, k) => bell(t + k * 0.085, m, { gain: 0.055, d: 1.6, pan: (k - 3) * 0.12 }));
      [N.E3, N.B3, N.Gs4].forEach((m) => tone(t + 0.4, { f: mtof(m), type: 'triangle', gain: 0.04, a: 0.6, d: 2.6, lp: 1400, send: 0.5 }));
      for (let k = 0; k < 3; k++) chips(t + 0.7 + k * 0.35, 8, rand(-0.5, 0.5), { g: 0.5 });
    },

    // ---------- 特殊玩法 ----------
    /** 拿到鱿鱼：两声俏皮的"啵"，最后的鱿鱼（×2）多一声铃 */
    squid(pan = 0, value = 1) {
      if (!ready() || !gate('squid' + pan, 120)) return;
      const t = ctx.currentTime;
      tone(t, { f: 880, f2: 420, gain: 0.09, a: 0.004, d: 0.12, pan, send: 0.2 });
      tone(t + 0.09, { f: 1240, f2: 620, gain: 0.07, a: 0.004, d: 0.11, pan, send: 0.2 });
      noise(t, { f: 1800, q: 4, gain: 0.03, a: 0.002, d: 0.05, pan });
      if (value > 1) bell(t + 0.2, N.E6, { gain: 0.05, d: 1, pan: pan * 0.5 });
    },
    /** 鱿鱼结算：一个下行的"游戏结束"小动机，然后筹码一摞摞飞向收款人 */
    squidSettle(pan = 0, n = 1) {
      if (!ready() || !gate('squidSettle', 1500)) return;
      const t = ctx.currentTime;
      [N.Gs5, N.E5, N.B4].forEach((m, k) => tone(t + k * 0.16, { f: mtof(m), type: 'square', gain: 0.03, a: 0.006, d: 0.22, lp: 2200, pan: pan * 0.5, send: 0.3 }));
      tone(t + 0.48, { f: mtof(N.E4), type: 'triangle', gain: 0.06, a: 0.01, d: 0.6, lp: 1600, send: 0.3 });
      for (let k = 0; k < n; k++) chips(t + 1.05 + k * 0.18, 5, pan + (k - n / 2) * 0.15, { g: 0.7 });
    },
    /** 毒圈收缩：低沉的警报扫频 + 向内收拢的风声 */
    zone() {
      if (!ready() || !gate('zone', 2000)) return;
      const t = ctx.currentTime;
      for (let k = 0; k < 2; k++) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(mtof(N.E3), t + k * 0.7);
        o.frequency.linearRampToValueAtTime(mtof(N.B3), t + k * 0.7 + 0.35);
        o.frequency.linearRampToValueAtTime(mtof(N.E3), t + k * 0.7 + 0.7);
        const fl = ctx.createBiquadFilter();
        fl.type = 'lowpass';
        fl.frequency.value = 900;
        const g = ctx.createGain();
        env(g, t + k * 0.7, 0.05, 0.12, 0.55);
        o.connect(fl).connect(g);
        route(g, 0, 0.3);
        o.start(t + k * 0.7);
        o.stop(t + k * 0.7 + 0.8);
      }
      noise(t + 0.1, { f: 3000, f2: 400, q: 0.7, gain: 0.07, a: 0.4, d: 1.1, send: 0.3 });
    },
    /** 决赛圈：两组心跳般的低鼓 + 渐强的低音和声 */
    finalCircle() {
      if (!ready() || !gate('final', 3000)) return;
      const t = ctx.currentTime;
      [0, 0.24, 0.9, 1.14].forEach((x, k) => {
        tone(t + x, { f: 70, f2: 42, gain: k % 2 ? 0.16 : 0.24, a: 0.004, d: 0.22 });
        noise(t + x, { type: 'lowpass', f: 200, gain: 0.08, a: 0.003, d: 0.1 });
      });
      [N.E3, N.B3].forEach((m) => tone(t + 0.2, { f: mtof(m), type: 'triangle', gain: 0.04, a: 0.9, d: 1.4, lp: 800, send: 0.4 }));
    },
    /** 空投：远处飞机掠过（左→右）、降落伞的布料声、落地闷响，再散开成筹码 */
    airdrop(land = 1.6) {
      if (!ready() || !gate('airdrop', 2000)) return;
      const t = ctx.currentTime;
      const g = ctx.createGain();
      env(g, t, 0.06, 0.7, 1.3);
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = 420;
      const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      for (const f of [78, 79.6, 156.5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 1.04, t);
        o.frequency.linearRampToValueAtTime(f * 0.97, t + 2); // 多普勒：掠过时音高略降
        o.connect(fl);
        o.start(t);
        o.stop(t + 2.1);
      }
      fl.connect(g);
      if (pn) { pn.pan.setValueAtTime(-0.7, t); pn.pan.linearRampToValueAtTime(0.7, t + 2); g.connect(pn).connect(dry); } else g.connect(dry);
      noise(t + 0.3, { f: 700, q: 0.6, gain: 0.03, a: 0.5, d: land - 0.6 });
      const hit = t + land;
      tone(hit, { f: 95, f2: 45, gain: 0.22, a: 0.003, d: 0.25 });
      noise(hit, { type: 'lowpass', f: 500, gain: 0.16, a: 0.002, d: 0.12, send: 0.2 });
      chips(hit + 0.5, 12, 0, { g: 0.7, gap: [0.016, 0.04] });
      bell(hit + 0.1, N.B5, { gain: 0.035, d: 0.9 });
    },
    /** 淘汰拿赏金：金属质感的"叮"+ 一声刷，紧接着筹码入账 */
    kill(pan = 0) {
      if (!ready() || !gate('kill', 600)) return;
      const t = ctx.currentTime;
      noise(t, { type: 'highpass', f: 2500, f2: 9000, gain: 0.05, a: 0.03, d: 0.12, pan });
      bell(t + 0.06, N.B5, { gain: 0.05, d: 0.7, pan });
      bell(t + 0.12, N.E6, { gain: 0.04, d: 0.9, pan });
      chips(t + 0.75, 7, pan, { g: 0.8 });
    },

    // ---------- 界面 ----------
    ui(kind) {
      if (!ready() || !gate('ui', 40)) return;
      const t = ctx.currentTime;
      if (kind === 'tick') {
        tone(t, { f: 2300, gain: 0.04, a: 0.001, d: 0.03 });
        noise(t, { type: 'highpass', f: 5000, gain: 0.015, a: 0.001, d: 0.012 });
      } else if (kind === 'on' || kind === 'off') {
        const [a, b] = kind === 'on' ? [N.B5, N.E6] : [N.E6, N.B5];
        tone(t, { f: mtof(a), gain: 0.035, a: 0.002, d: 0.05 });
        tone(t + 0.05, { f: mtof(b), gain: 0.035, a: 0.002, d: 0.07 });
      } else if (kind === 'start') {
        [N.E5, N.Gs5, N.B5].forEach((m, k) => bell(t + k * 0.07, m, { gain: 0.04, d: 0.6, send: 0.25 }));
      } else if (kind === 'pause') {
        [N.B5, N.E5].forEach((m, k) => bell(t + k * 0.09, m, { gain: 0.035, d: 0.5, send: 0.25 }));
      }
    },
  };

  // ---------- 环境氛围（默认关闭） ----------
  // 很轻的房间底噪 + 缓慢呼吸的 E 大调和声垫 + 偶尔一声遥远的星光铃
  function ambientOn() {
    if (amb || !ctx) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 3);
    g.connect(out);
    const nodes = [];
    const room = ctx.createBufferSource();
    room.buffer = noiseBuf;
    room.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 340;
    const rg = ctx.createGain();
    rg.gain.value = 0.03;
    room.connect(rf).connect(rg).connect(g);
    room.start();
    nodes.push(room);
    const pf = ctx.createBiquadFilter();
    pf.type = 'lowpass';
    pf.frequency.value = 700;
    pf.Q.value = 0.5;
    const pg = ctx.createGain();
    pg.gain.value = 0.016;
    pf.connect(pg).connect(g);
    for (const [m, det] of [[N.E3, -4], [N.E3, 5], [N.B3, -3], [N.Gs4, 4]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(m);
      o.detune.value = det;
      o.connect(pf);
      o.start();
      nodes.push(o);
    }
    // 滤波器与音量缓慢起伏
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lg = ctx.createGain();
    lg.gain.value = 260;
    lfo.connect(lg).connect(pf.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.07;
    const lg2 = ctx.createGain();
    lg2.gain.value = 0.006;
    lfo2.connect(lg2).connect(pg.gain);
    lfo.start(); lfo2.start();
    nodes.push(lfo, lfo2);
    const twinkle = () => {
      if (!amb) return;
      if (ready()) bell(ctx.currentTime, [N.B5, N.E6, N.Gs6, N.Cs5, N.Fs5][Math.floor(Math.random() * 5)], { gain: 0.012, d: 2.2, pan: rand(-0.8, 0.8), send: 0.8 });
      amb.timer = setTimeout(twinkle, rand(7000, 16000));
    };
    amb = { g, nodes, timer: setTimeout(twinkle, 5000) };
  }
  function ambientOff() {
    if (!amb) return;
    const { g, nodes, timer } = amb;
    amb = null;
    clearTimeout(timer);
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    setTimeout(() => { nodes.forEach((n) => n.stop()); g.disconnect(); }, 2000);
  }

  return api;
}
