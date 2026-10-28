import * as THREE from 'three';

/**
 * 环境：悬浮在星云中的"轨道赌场"平台。
 * 装饰对象都不投射阴影，只有地面接收阴影；update(t, state) 里刷新动画和吊灯计分屏。
 */

const RIM = 0.45; // 地毯外一圈大理石边的宽度
export const LAMP_Y = 6.3;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const glowSprite = (() => {
  const [c, x] = canvas(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return tex(c);
})();
const deco = (o) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } }); return o; };

// ---------- sky ----------
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float v = 0., a = .5; for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.03; a *= .5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = mix(vec3(0.018, 0.010, 0.045), vec3(0.002, 0.002, 0.008), smoothstep(-0.15, 0.8, d.y));
        float bx = (d.y * 0.9 - d.x * 0.4 + 0.15) * 2.6;
        float band = exp(-bx * bx); // 不用 pow(负数, 2.0)：GLSL 里底数为负是未定义行为，有的显卡会得到 NaN
        float n = fbm(d * 2.4 + vec3(0., 0., uTime * 0.004));
        float n2 = fbm(d * 5.0 + vec3(5.2, 1.3, uTime * 0.006));
        vec3 neb = mix(vec3(0.30, 0.04, 0.38), vec3(0.02, 0.20, 0.32), smoothstep(0.3, 0.7, n2));
        col += neb * pow(smoothstep(0.45, 0.9, n), 1.8) * (0.2 + band) * 0.35;
        col += vec3(0.25, 0.12, 0.35) * band * 0.035;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(180, 64, 32), mat);
}

function buildStars() {
  const g = new THREE.Group();
  const palette = [new THREE.Color(0xffffff), new THREE.Color(0xbcd0ff), new THREE.Color(0xffc8f0), new THREE.Color(0xfff0c0)];
  [[2200, 0.9], [300, 2.2]].forEach(([n, size]) => {
    const pos = [], col = [];
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < -0.25) v.y = -v.y;
      v.multiplyScalar(140 + Math.random() * 30);
      pos.push(v.x, v.y, v.z);
      const c = palette[(Math.random() * palette.length) | 0].clone().multiplyScalar(0.5 + Math.random() * 0.8);
      col.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: glowSprite, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true,
    })));
  });
  return g;
}

function buildPlanet() {
  const g = new THREE.Group();
  const [c, x] = canvas(1024, 512);
  const bands = ['#2a1648', '#4a2a78', '#7a3f8f', '#c0688c', '#e8a07a', '#6b3a86', '#3a2060', '#9a5296'];
  for (let y = 0; y < 512; y++) {
    const k = (Math.sin(y * 0.045) + Math.sin(y * 0.13 + 1.7) * 0.5 + 1.5) / 3;
    x.fillStyle = bands[Math.floor(k * bands.length) % bands.length];
    x.fillRect(0, y, 1024, 1);
  }
  for (let i = 0; i < 1400; i++) {
    x.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    x.fillRect(Math.random() * 1024, Math.random() * 512, 40 + Math.random() * 120, 1 + Math.random() * 2);
  }
  const map = tex(c);
  const planet = new THREE.Mesh(new THREE.SphereGeometry(16, 64, 32), new THREE.MeshStandardMaterial({
    map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 1, fog: false,
  }));
  planet.rotation.z = 0.35;
  g.add(planet);

  const [rc, rx] = canvas(512, 512);
  const ringIn = 21, ringOut = 32;
  for (let r = 0; r < 256; r++) {
    const wr = (r / 256) * ringOut;
    if (wr < ringIn) continue;
    const a = (0.25 + 0.35 * Math.abs(Math.sin(wr * 2.1)) + 0.2 * Math.sin(wr * 7.3)) * Math.sin(((wr - ringIn) / (ringOut - ringIn)) * Math.PI);
    rx.strokeStyle = `rgba(240,200,230,${Math.max(0, a)})`;
    rx.beginPath(); rx.arc(256, 256, r, 0, Math.PI * 2); rx.stroke();
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(ringIn, ringOut, 160), new THREE.MeshBasicMaterial({
    map: tex(rc), transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false, opacity: 0.75,
  }));
  ring.rotation.set(Math.PI / 2 - 0.32, 0.18, 0);
  g.add(ring);
  g.position.set(-78, 26, -96);

  const moon = new THREE.Mesh(new THREE.SphereGeometry(3.2, 48, 24), new THREE.MeshStandardMaterial({
    color: 0x9aa4c8, emissive: 0x2a3050, emissiveIntensity: 0.5, roughness: 0.9, fog: false,
  }));
  moon.position.set(70, 34, -110);
  return { planet: g, moon };
}

// ---------- platform ----------
// 抛光深色大理石 + 边缘细金线镶嵌；只有镶嵌线写入自发光贴图
function floorTextures() {
  const S = 2048, C = S / 2, R = C * 0.995;
  const [bc, b] = canvas(S, S);
  const [ec, e] = canvas(S, S);
  b.fillStyle = '#14111d';
  b.fillRect(0, 0, S, S);
  // 大块云状明暗
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 220 + Math.random() * 520;
    const g = b.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, i % 3 ? 'rgba(70,52,110,.07)' : 'rgba(0,0,0,.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = g;
    b.fillRect(0, 0, S, S);
  }
  // 大理石纹理：随机游走的柔和细脉
  const vein = (alpha, width, blur, n) => {
    b.filter = `blur(${blur}px)`;
    for (let i = 0; i < n; i++) {
      let x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI * 2;
      b.strokeStyle = `rgba(${200 + Math.random() * 40},${190 + Math.random() * 30},235,${alpha * (0.4 + Math.random() * 0.6)})`;
      b.lineWidth = width * (0.5 + Math.random());
      b.beginPath();
      b.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        a += (Math.random() - 0.5) * 1.1;
        const len = 80 + Math.random() * 220;
        const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
        b.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, nx, ny);
        x = nx; y = ny;
      }
      b.stroke();
    }
  };
  vein(0.1, 6, 4, 50);
  vein(0.22, 1.6, 0.6, 80);
  b.filter = 'none';
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  // 椭圆边缘的镶嵌线（贴图按 0~1 归一化，会随平台一起被拉成椭圆）
  const ring = (x, r, w, style) => { x.strokeStyle = style; x.lineWidth = w; x.beginPath(); x.arc(C, C, R * r, 0, Math.PI * 2); x.stroke(); };
  ring(b, 0.952, 3, 'rgba(222,184,110,.9)');
  ring(b, 0.982, 5, 'rgba(160,130,255,.9)');
  ring(e, 0.952, 3, 'rgba(255,205,130,.35)');
  ring(e, 0.982, 5, 'rgba(160,130,255,1)');
  return { map: tex(bc), emissiveMap: tex(ec) };
}

// 牌桌下方的椭圆丝绒地毯 + 金色包边
function buildCarpet(a, b) {
  const g = new THREE.Group();
  const W = 2048, H = Math.round((2048 * b) / a);
  const [c, x] = canvas(W, H);
  const bg = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
  bg.addColorStop(0, '#2e1546');
  bg.addColorStop(0.7, '#22103a');
  bg.addColorStop(1, '#170a28');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 90000; i++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.04})`;
    x.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  // 菱格暗纹
  x.save();
  x.translate(W / 2, H / 2);
  x.rotate(Math.PI / 4);
  x.strokeStyle = 'rgba(222,184,110,.06)';
  x.lineWidth = 2;
  const step = 64, span = W * 1.5;
  for (let p = -span; p <= span; p += step) {
    x.beginPath(); x.moveTo(p, -span); x.lineTo(p, span); x.stroke();
    x.beginPath(); x.moveTo(-span, p); x.lineTo(span, p); x.stroke();
  }
  x.fillStyle = 'rgba(222,184,110,.12)';
  for (let px = -span; px <= span; px += step) for (let py = -span; py <= span; py += step) x.fillRect(px - 2, py - 2, 4, 4);
  x.restore();
  // 边框
  const el = (r, w, style) => { x.strokeStyle = style; x.lineWidth = w; x.beginPath(); x.ellipse(W / 2, H / 2, (W / 2) * r, (H / 2) * r, 0, 0, Math.PI * 2); x.stroke(); };
  el(0.955, H * 0.055, '#140820');
  el(0.925, 5, 'rgba(222,184,110,.85)');
  el(0.985, 3, 'rgba(222,184,110,.6)');
  x.fillStyle = 'rgba(222,184,110,.7)';
  for (let k = 0; k < 140; k++) {
    const t = (k / 140) * Math.PI * 2;
    const cx = W / 2 + Math.cos(t) * (W / 2) * 0.955, cy = H / 2 + Math.sin(t) * (H / 2) * 0.955;
    x.save(); x.translate(cx, cy); x.rotate(t);
    x.beginPath(); x.moveTo(-7, 0); x.lineTo(0, -5); x.lineTo(7, 0); x.lineTo(0, 5); x.fill();
    x.restore();
  }
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 160), new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.95 }));
  rug.scale.set(a, b, 1);
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.008;
  rug.receiveShadow = true;
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, a + 0.06, b + 0.06, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, a - 0.01, b - 0.01, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const trimGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 160 });
  trimGeo.rotateX(-Math.PI / 2);
  const trim = new THREE.Mesh(trimGeo, new THREE.MeshStandardMaterial({ color: 0xd8b36a, roughness: 0.25, metalness: 1 }));
  g.add(rug, trim);
  return { group: g, rug };
}

// 座位：悬浮的品牌色大筹码
export function buildSeatChip(color) {
  const hex = '#' + color.toString(16).padStart(6, '0');
  const R = 1.05, T = 0.24;
  const [sc, sx] = canvas(1024, 64);
  sx.fillStyle = hex;
  sx.fillRect(0, 0, 1024, 64);
  sx.fillStyle = '#f4f1ea';
  for (let i = 0; i < 12; i++) sx.fillRect(i * (1024 / 12) + 22, 10, 40, 44);
  sx.fillStyle = 'rgba(0,0,0,.25)';
  sx.fillRect(0, 0, 1024, 6);
  sx.fillRect(0, 58, 1024, 6);
  const [tc, tx] = canvas(512, 512);
  tx.fillStyle = hex;
  tx.fillRect(0, 0, 512, 512);
  tx.translate(256, 256);
  tx.fillStyle = '#f4f1ea';
  for (let i = 0; i < 12; i++) {
    tx.save();
    tx.rotate((i / 12) * Math.PI * 2);
    tx.beginPath();
    tx.roundRect(-18, -252, 36, 50, 6);
    tx.fill();
    tx.restore();
  }
  tx.fillStyle = 'rgba(0,0,0,.18)';
  tx.beginPath(); tx.arc(0, 0, 178, 0, Math.PI * 2); tx.fill();
  tx.strokeStyle = 'rgba(255,255,255,.85)';
  tx.lineWidth = 6;
  tx.beginPath(); tx.arc(0, 0, 182, 0, Math.PI * 2); tx.stroke();
  tx.setLineDash([18, 14]);
  tx.lineWidth = 4;
  tx.beginPath(); tx.arc(0, 0, 160, 0, Math.PI * 2); tx.stroke();
  const side = new THREE.MeshStandardMaterial({ map: tex(sc), roughness: 0.5, envMapIntensity: 0.4, emissive: color, emissiveIntensity: 0 });
  const top = new THREE.MeshStandardMaterial({ map: tex(tc), roughness: 0.55, envMapIntensity: 0.35, emissive: color, emissiveIntensity: 0 });
  const chip = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 72), [side, top, top]);
  chip.position.y = T / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.03, 0.022, 8, 96), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = T / 2;
  ring.userData.noShadow = true;
  // 地面上的品牌色悬浮光晕
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.45, 48), new THREE.MeshBasicMaterial({
    map: glowSprite, color, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  glow.userData.noShadow = true;
  // 行动光柱：从筹码升起、向上渐隐的品牌色光柱，平时透明。
  // pow 的底数必须 clamp 到 [0,1]：法线正对镜头时浮点误差会让 1-|dot| 略小于 0，pow 得到 NaN，
  // 经过辉光后期处理会扩散成一大块黑色方块（行动高亮时偶尔闪黑框的原因）
  const beamH = 4.6;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 1.12, beamH, 48, 1, true),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 1.4) * 0.6 + 0.25; gl_FragColor = vec4(uColor * 1.4, f * pow(clamp(1.0 - vY, 0.0, 1.0), 1.8) * uOpacity); }`,
    }));
  beam.position.y = beamH / 2;
  beam.visible = false;
  beam.userData.noShadow = true;
  return { chip, ring, glow, beam, mats: [side, top], height: T };
}

const HULL_TOP = -1.3;
function ellipseRing(a, b, tube, material) {
  const pts = [];
  for (let i = 0; i < 180; i++) { const t = (i / 180) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * a, 0, Math.sin(t) * b)); }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 360, tube, 8, true), material);
}
const neonMat = (color, k) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k });

// 椭圆底座：顶面是地毯 + 外圈窄大理石边，下面是椭圆倒锥船体
function buildPlatform(A, B) {
  const g = new THREE.Group();
  const { map, emissiveMap } = floorTextures();
  const topMat = new THREE.MeshPhysicalMaterial({
    map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.6,
    roughness: 0.38, metalness: 0.1, clearcoat: 0.25, clearcoatRoughness: 0.35, envMapIntensity: 0.2,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 180), topMat);
  floor.scale.set(A, B, 1);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const side = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.4, 180, 1, true), new THREE.MeshStandardMaterial({ color: 0x14112a, roughness: 0.35, metalness: 0.8 }));
  side.scale.set(A, 1, B);
  side.position.y = -0.2;
  g.add(floor, side);

  const edge = ellipseRing(A, B, 0.035, neonMat(0x8a6bff, 0.9));
  const under = ellipseRing(A + 0.02, B + 0.02, 0.025, neonMat(0xff6bd5, 0.7));
  under.position.y = -0.05 - RIBBON_H - 0.06;
  g.add(edge, under);

  // 平台下方的椭圆倒锥船体，让整座赌场悬浮在太空里
  const hull = new THREE.Mesh(new THREE.ConeGeometry(1, 7, 120, 1, true), new THREE.MeshStandardMaterial({ color: 0x100e20, roughness: 0.4, metalness: 0.85 }));
  hull.scale.set(A, 1, B);
  hull.rotation.x = Math.PI;
  hull.position.y = HULL_TOP - 3.5;
  g.add(hull);
  [1.3, 2.9, 4.6].forEach((d, i) => {
    const k = 1 - d / 7;
    const r = ellipseRing(A * k, B * k, 0.03, neonMat(i === 1 ? 0xff6bd5 : 0x6b8bff, 0.8));
    r.position.y = HULL_TOP - d;
    g.add(r);
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16), new THREE.MeshStandardMaterial({ color: 0xffb0ff, emissive: 0xff7be0, emissiveIntensity: 2.2 }));
  core.position.y = HULL_TOP - 7.1;
  const coreLight = new THREE.PointLight(0xff7be0, 12, 14, 2);
  coreLight.position.y = HULL_TOP - 7.1;
  g.add(core, coreLight);

  return { group: g, floor };
}

// ---------- 底座边缘的 LED 环形计分屏 ----------
const RIBBON_H = 1.2;
function buildRibbon(brands, A, B) {
  const g = new THREE.Group();
  const W = 4096, TH = 256;
  const [c, x] = canvas(W, TH);
  const screen = tex(c);
  screen.wrapS = THREE.RepeatWrapping;
  screen.repeat.x = 2; // 贴图含两份内容，绕平台一圈共 4 份，任何角度都能看到
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, RIBBON_H, 240, 1, true),
    new THREE.MeshBasicMaterial({ map: screen, toneMapped: false, color: new THREE.Color(0.85, 0.85, 0.85) }));
  band.scale.set(A + 0.01, 1, B + 0.01);
  band.position.y = -0.05 - RIBBON_H / 2;
  const rim = ellipseRing(A + 0.01, B + 0.01, 0.04, new THREE.MeshStandardMaterial({ color: 0xd8b36a, roughness: 0.25, metalness: 1 }));
  rim.position.y = -0.05 - RIBBON_H;
  g.add(band, rim);

  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  let key = '';
  function draw(st) {
    const k = JSON.stringify(st ? [st.handId, st.toAct, st.pot, st.players.map((p) => [p.stack + p.bet, p.folded, p.winner])] : 0);
    if (k === key) return;
    key = k;
    x.clearRect(0, 0, W, TH);
    const bg = x.createLinearGradient(0, 0, 0, TH);
    bg.addColorStop(0, '#120e26');
    bg.addColorStop(1, '#07060f');
    x.fillStyle = bg;
    x.fillRect(0, 0, W, TH);
    x.fillStyle = '#d8b36a';
    x.fillRect(0, 6, W, 3);
    x.fillRect(0, TH - 9, W, 3);
    const players = st?.players || brands.map(() => ({ stack: 1000, bet: 0 }));
    const totals = players.map((p) => p.stack + p.bet);
    const max = Math.max(1, ...totals);
    const half = W / 2;
    for (let h = 0; h < 2; h++) {
      const ox = h * half;
      x.textBaseline = 'middle';
      x.textAlign = 'left';
      x.fillStyle = '#f2cf86';
      x.font = '900 56px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
      x.fillText('德扑之王', ox + 48, 92);
      x.fillStyle = '#ff4d6d';
      x.beginPath(); x.arc(ox + 60, 168, 11, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#c9c3e6';
      x.font = '600 36px "Helvetica Neue", Arial, sans-serif';
      x.fillText(`LIVE  #${st?.handId ?? 0}`, ox + 84, 170);
      const cellW = (half - 420) / 6;
      players.forEach((p, i) => {
        const cx = ox + 400 + i * cellW;
        const color = hex(brands[i].color);
        const dim = p.folded ? 0.4 : 1;
        if (st?.toAct === i || p.winner) {
          x.fillStyle = p.winner ? 'rgba(255,200,90,.18)' : 'rgba(140,120,255,.18)';
          x.fillRect(cx + 6, 22, cellW - 12, TH - 44);
        }
        x.globalAlpha = dim;
        x.fillStyle = color;
        x.beginPath(); x.arc(cx + 30, 70, 12, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#e8e6f6';
        x.font = '700 38px "PingFang SC", "Helvetica Neue", sans-serif';
        x.fillText(brands[i].name, cx + 52, 72);
        x.fillStyle = p.winner ? '#ffd36e' : '#ffffff';
        x.font = '800 56px "Helvetica Neue", Arial, sans-serif';
        x.fillText(fmt(totals[i]), cx + 22, 140);
        x.fillStyle = 'rgba(255,255,255,.1)';
        x.fillRect(cx + 22, 186, cellW - 50, 14);
        x.fillStyle = color;
        x.fillRect(cx + 22, 186, (cellW - 50) * (totals[i] / max), 14);
        x.globalAlpha = 1;
      });
    }
    screen.needsUpdate = true;
  }
  draw(null);
  return { group: g, draw, screen };
}

// ---------- floating decor ----------
function buildChipBelt() {
  const g = new THREE.Group();
  const colors = ['#7b3fe4', '#d63a3a', '#1f9d55', '#1d1d22', '#e8b84a'];
  const mats = colors.map((col) => {
    const [sc, sx] = canvas(256, 32);
    sx.fillStyle = col; sx.fillRect(0, 0, 256, 32);
    sx.fillStyle = '#fff';
    for (let i = 0; i < 8; i++) sx.fillRect(i * 32 + 8, 0, 14, 32);
    const [tc, tx] = canvas(128, 128);
    tx.fillStyle = col; tx.fillRect(0, 0, 128, 128);
    tx.strokeStyle = '#fff'; tx.lineWidth = 10; tx.setLineDash([14, 12]);
    tx.beginPath(); tx.arc(64, 64, 54, 0, Math.PI * 2); tx.stroke();
    tx.setLineDash([]); tx.lineWidth = 3;
    tx.beginPath(); tx.arc(64, 64, 34, 0, Math.PI * 2); tx.stroke();
    const side = new THREE.MeshStandardMaterial({ map: tex(sc), roughness: 0.35, metalness: 0.2 });
    const top = new THREE.MeshStandardMaterial({ map: tex(tc), roughness: 0.35, metalness: 0.2 });
    return [side, top, top];
  });
  const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 40);
  const chips = [];
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(geo, mats[i % mats.length]);
    const a = (i / 34) * Math.PI * 2 + Math.random() * 0.1;
    const r = 11.2 + Math.random() * 3;
    m.userData = { a, r, y: 1.5 + Math.random() * 4, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2), phase: Math.random() * 6 };
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.scale.setScalar(0.6 + Math.random() * 0.8);
    g.add(m);
    chips.push(m);
  }
  return { group: g, chips };
}

function buildSuitHolograms() {
  const items = [['♠', '#7fd8ff'], ['♥', '#ff5fa2'], ['♦', '#ffb44a'], ['♣', '#6bffb0']].map(([s, col], i) => {
    const [c, x] = canvas(512, 512);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = '360px "Apple Symbols", "Segoe UI Symbol", sans-serif';
    x.shadowColor = col;
    x.shadowBlur = 40;
    x.lineWidth = 10;
    x.strokeStyle = col;
    x.strokeText(s, 256, 270);
    x.shadowBlur = 0;
    x.fillStyle = col + '22';
    x.fillText(s, 256, 270);
    x.lineWidth = 3;
    x.strokeStyle = '#ffffff';
    x.strokeText(s, 256, 270);
    const mat = new THREE.SpriteMaterial({ map: tex(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    mat.color.setScalar(1.6);
    const sp = new THREE.Sprite(mat);
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    sp.userData = { a, base: 9 + (i % 2) * 2 };
    sp.position.set(Math.cos(a) * 26, sp.userData.base, Math.sin(a) * 26);
    sp.scale.setScalar(7);
    return sp;
  });
  const g = new THREE.Group();
  items.forEach((s) => g.add(s));
  return { group: g, items };
}

function buildDust() {
  const n = 380;
  const pos = new Float32Array(n * 3);
  const seed = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(Math.random()) * 4.2, a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 1.2 + Math.random() * 5;
    pos[i * 3 + 2] = Math.sin(a) * r;
    seed.push(Math.random() * 10);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.06, map: glowSprite, color: 0xffd9a0, transparent: true, opacity: 0.8,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  return { points: pts, seed };
}

export function createEnvironment({ scene, brands, carpet }) {
  scene.background = new THREE.Color(0x05040c);
  scene.fog = new THREE.Fog(0x070514, 45, 130);

  const sky = buildSky();
  const stars = buildStars();
  const { planet, moon } = buildPlanet();
  const A = carpet.a + RIM, B = carpet.b + RIM;
  const platform = buildPlatform(A, B);
  const ribbon = buildRibbon(brands, A, B);
  const belt = buildChipBelt();
  const suits = buildSuitHolograms();
  const dust = buildDust();
  [sky, stars, planet, moon, belt.group, suits.group, dust.points].forEach((o) => scene.add(deco(o)));
  deco(platform.group);
  platform.floor.receiveShadow = true;
  scene.add(platform.group);
  const rug = buildCarpet(carpet.a, carpet.b);
  deco(rug.group);
  rug.rug.receiveShadow = true;
  scene.add(rug.group);
  scene.add(deco(ribbon.group));

  const dustPos = dust.points.geometry.attributes.position;
  return {
    update(t, dt, state) {
      sky.material.uniforms.uTime.value = t;
      stars.rotation.y = t * 0.004;
      planet.rotation.y = t * 0.01;
      ribbon.draw(state);
      ribbon.screen.offset.x = -t * 0.006; // 缓慢滚动
      belt.chips.forEach((c) => {
        const u = c.userData;
        const a = u.a + t * 0.03;
        c.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.6 + u.phase) * 0.4, Math.sin(a) * u.r);
        c.rotation.x += u.spin.x * dt;
        c.rotation.y += u.spin.y * dt;
        c.rotation.z += u.spin.z * dt;
      });
      suits.items.forEach((s, i) => {
        s.position.y = s.userData.base + Math.sin(t * 0.7 + i * 1.6) * 0.6;
        s.material.opacity = 0.75 + Math.sin(t * 2.3 + i) * 0.2;
      });
      for (let i = 0; i < dustPos.count; i++) {
        let y = dustPos.getY(i) + dt * 0.08;
        if (y > 6.2) y = 1.2;
        dustPos.setY(i, y);
        dustPos.setX(i, dustPos.getX(i) + Math.sin(t * 0.5 + dust.seed[i]) * dt * 0.03);
      }
      dustPos.needsUpdate = true;
    },
  };
}
