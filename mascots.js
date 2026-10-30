import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- helpers ----------
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, ...o });
const glow = (color, k = 1.5) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.3 });
const blink = (t, o = 0) => ((t + o) % 3.7) < 0.13 ? 0.12 : 1;
const noShadow = (m) => { m.userData.noShadow = true; return m; };

function cartoonEye(r = 0.08) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), M(0x111318, { roughness: 0.15 })));
  const hi = new THREE.Mesh(new THREE.SphereGeometry(r * 0.32, 12, 8), glow(0xffffff, 1));
  hi.position.set(r * 0.35, r * 0.38, r * 0.78);
  g.add(hi);
  return g;
}
function smile(r, tube, color) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 24, Math.PI), M(color, { roughness: 0.3 }));
  m.rotation.z = Math.PI;
  return m;
}
function cheek(r = 0.07) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8), M(0xff8fa3, { roughness: 0.9, transparent: true, opacity: 0.75 }));
  m.scale.z = 0.3;
  return noShadow(m);
}

// ---------- 1. Claude · Clawd ----------
function buildClaude() {
  const g = new THREE.Group();
  const orange = M(0xd97757, { roughness: 0.65 });
  const torso = new THREE.Group();
  g.add(torso);
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.7, 1.05, 1.0, 4, 0.06), orange);
  body.position.y = 0.98;
  torso.add(body);
  const arms = [-1, 1].map((s) => {
    const a = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.32, 0.55, 3, 0.04), orange);
    a.position.set(s * 0.99, 1.02, 0);
    torso.add(a);
    return a;
  });
  const eyes = [-0.34, 0.34].map((x) => {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.06), M(0x1a1a1a, { roughness: 0.3 }));
    e.position.set(x, 1.12, 0.5);
    torso.add(e);
    return e;
  });
  const legs = [-0.66, -0.3, 0.3, 0.66].map((x) => {
    const l = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.5, 0.24, 2, 0.03), orange);
    l.position.set(x, 0.25, 0);
    g.add(l);
    return l;
  });
  g.scale.setScalar(1.15);
  return {
    group: g,
    update(t) {
      const step = t * 5;
      legs.forEach((l, i) => { l.position.y = 0.25 + Math.max(0, Math.sin(step + (i % 2) * Math.PI)) * 0.09; });
      torso.position.y = Math.abs(Math.sin(step)) * 0.04;
      torso.rotation.z = Math.sin(step) * 0.025;
      arms.forEach((a, i) => { a.rotation.x = Math.sin(step + i * Math.PI) * 0.35; });
      eyes.forEach((e) => { e.scale.y = blink(t, 0.3); });
    },
  };
}

// ---------- 2. OpenAI · 花结机器人 ----------
function buildOpenAI() {
  const g = new THREE.Group();
  const white = M(0xf3f3f1, { roughness: 0.22, metalness: 0.05 });
  const black = M(0x0a0a0c, { roughness: 0.08, metalness: 0.4 });
  const green = M(0x10a37f, { roughness: 0.25, metalness: 0.5, emissive: 0x10a37f, emissiveIntensity: 0.35 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.32, 8, 24), white);
  body.position.y = 0.72;
  g.add(body);
  [-0.2, 0.2].forEach((x) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), black);
    f.scale.set(1, 0.55, 1.3);
    f.position.set(x, 0.08, 0.05);
    g.add(f);
  });
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.46, 0.98, 0);
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 6, 12), white);
    a.position.y = -0.22;
    pivot.add(a);
    g.add(pivot);
    return pivot;
  });

  const head = new THREE.Group();
  head.position.y = 1.72;
  g.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 48, 32), white));
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.565, 48, 24, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.45, 0.85), black);
  head.add(visor);
  const eyes = [-0.15, 0.15].map((x) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), glow(0xe8fff6, 2.2));
    e.scale.set(0.9, 1.5, 0.4);
    e.position.set(x, 0.04, 0.55);
    head.add(noShadow(e));
    return e;
  });

  // floating blossom emblem: six interlocking rings
  const blossom = new THREE.Group();
  blossom.position.y = 2.62;
  const ringGeo = new THREE.TorusGeometry(0.2, 0.045, 14, 40);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const r = new THREE.Mesh(ringGeo, green);
    r.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, Math.sin(a * 3) * 0.02);
    r.rotation.set(Math.sin(a) * 0.35, Math.cos(a) * 0.35, a);
    blossom.add(r);
  }
  g.add(blossom);
  g.scale.setScalar(0.95);
  return {
    group: g,
    update(t) {
      head.rotation.z = Math.sin(t * 1.3) * 0.08;
      head.rotation.y = Math.sin(t * 0.7) * 0.25;
      arms[1].rotation.z = 2.3 + Math.sin(t * 6) * 0.35;
      arms[0].rotation.z = -0.15 - Math.sin(t * 2) * 0.05;
      eyes.forEach((e) => { e.scale.y = 1.5 * blink(t, 1.1); });
      blossom.rotation.z = t * 0.6;
      blossom.rotation.y = Math.sin(t) * 0.4;
      blossom.position.y = 2.62 + Math.sin(t * 2) * 0.06;
    },
  };
}

// ---------- 3. Gemini · 双子星 ----------
function sparkleGeometry(size, depth) {
  const s = new THREE.Shape();
  const k = 0.08 * size;
  s.moveTo(0, size);
  s.quadraticCurveTo(k, k, size, 0);
  s.quadraticCurveTo(k, -k, 0, -size);
  s.quadraticCurveTo(-k, -k, -size, 0);
  s.quadraticCurveTo(-k, k, 0, size);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth, curveSegments: 32, bevelEnabled: true,
    bevelThickness: depth * 0.6, bevelSize: size * 0.04, bevelSegments: 6,
  });
  geo.center();
  const pos = geo.attributes.position;
  const c1 = new THREE.Color(0x3b82f6), c2 = new THREE.Color(0x9b72cb), c3 = new THREE.Color(0xe06b8a), c = new THREE.Color();
  const cols = [];
  for (let i = 0; i < pos.count; i++) {
    const u = THREE.MathUtils.clamp((pos.getX(i) + pos.getY(i)) / (2 * size) * 0.5 + 0.5, 0, 1);
    u < 0.55 ? c.lerpColors(c1, c2, u / 0.55) : c.lerpColors(c2, c3, (u - 0.55) / 0.45);
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeBoundingBox();
  return geo;
}
function buildGemini() {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15 });
  const star = new THREE.Group();
  g.add(star);
  const geo = sparkleGeometry(0.85, 0.16);
  star.add(new THREE.Mesh(geo, mat));
  const fz = geo.boundingBox.max.z;
  const eyes = [-0.14, 0.14].map((x) => {
    const e = cartoonEye(0.065);
    e.position.set(x, 0.07, fz - 0.02);
    star.add(e);
    return e;
  });
  const m = smile(0.06, 0.014, 0x111318);
  m.position.set(0, -0.06, fz);
  star.add(m);
  [-0.26, 0.26].forEach((x) => { const ch = cheek(0.05); ch.position.set(x, -0.04, fz); star.add(ch); });

  const twin = new THREE.Mesh(sparkleGeometry(0.32, 0.08), mat);
  g.add(twin);
  const tiny = new THREE.Mesh(sparkleGeometry(0.14, 0.05), mat);
  g.add(tiny);
  const light = new THREE.PointLight(0x9b72cb, 6, 4, 2);
  light.position.y = 1.4;
  g.add(light);
  return {
    group: g,
    update(t) {
      star.position.y = 1.45 + Math.sin(t * 1.6) * 0.12;
      star.rotation.y = Math.sin(t * 0.8) * 0.45;
      star.rotation.z = Math.sin(t * 1.1) * 0.06;
      eyes.forEach((e) => { e.scale.y = blink(t, 2.2); });
      const a = t * 1.2;
      twin.position.set(Math.cos(a) * 1.35, 1.95 + Math.sin(a * 2) * 0.2, Math.sin(a) * 1.35);
      twin.rotation.set(0, Math.sin(t) * 0.6, t * 1.5);
      const b = -t * 1.8 + 2;
      tiny.position.set(Math.cos(b) * 0.9, 2.45 + Math.sin(b) * 0.15, Math.sin(b) * 0.9);
      tiny.rotation.set(t, t * 3, 0);
    },
  };
}

// ---------- 4. 智谱 · 小智机器人 ----------
function zShapeGeometry() {
  const s = new THREE.Shape();
  [[-0.5, 0.5], [0.5, 0.5], [0.5, 0.3], [-0.18, -0.3], [0.5, -0.3], [0.5, -0.5], [-0.5, -0.5], [-0.5, -0.3], [0.18, 0.3], [-0.5, 0.3]]
    .forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3 });
  geo.center();
  return geo;
}
function buildZhipu() {
  const g = new THREE.Group();
  const blue = M(0x3a5cff, { roughness: 0.3, metalness: 0.25 });
  const white = M(0xf2f4fb, { roughness: 0.3 });
  const screen = M(0x070b24, { roughness: 0.05, metalness: 0.5 });
  const cyan = glow(0x5ff5ff, 2.2);

  const legs = [-0.2, 0.2].map((x) => {
    const leg = new THREE.Group();
    leg.position.set(x, 0.62, 0);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.45, 20), white);
    shin.position.y = -0.27;
    const foot = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.13, 0.38, 3, 0.05), blue);
    foot.position.set(0, -0.55, 0.05);
    leg.add(shin, foot);
    g.add(leg);
    return leg;
  });
  const upper = new THREE.Group();
  g.add(upper);
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.85, 0.72, 0.6, 4, 0.16), white);
  body.position.y = 0.98;
  upper.add(body);
  const z = new THREE.Mesh(zShapeGeometry(), M(0x3a5cff, { emissive: 0x3a5cff, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.25 }));
  z.scale.setScalar(0.32);
  z.position.set(0, 0.98, 0.31);
  upper.add(z);
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.5, 1.22, 0);
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.32, 6, 14), blue);
    a.position.y = -0.24;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), white);
    hand.position.y = -0.48;
    pivot.add(a, hand);
    upper.add(pivot);
    return pivot;
  });

  const head = new THREE.Group();
  head.position.y = 1.78;
  upper.add(head);
  head.add(new THREE.Mesh(new RoundedBoxGeometry(1.05, 0.82, 0.82, 5, 0.2), blue));
  const face = new THREE.Mesh(new RoundedBoxGeometry(0.82, 0.56, 0.06, 4, 0.05), screen);
  face.position.z = 0.4;
  head.add(face);
  const eyes = [-0.19, 0.19].map((x) => {
    const e = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.19, 0.03, 2, 0.04), cyan);
    e.position.set(x, 0.05, 0.445);
    head.add(noShadow(e));
    return e;
  });
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 20, Math.PI), cyan);
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, -0.1, 0.445);
  head.add(noShadow(mouth));
  [-1, 1].forEach((s) => {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 24), white);
    ear.rotation.z = Math.PI / 2;
    ear.position.x = s * 0.55;
    head.add(ear);
  });
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), white);
  stick.position.y = 0.55;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), cyan);
  bulb.position.y = 0.73;
  head.add(stick, bulb);
  return {
    group: g,
    update(t) {
      arms[1].rotation.z = 2.45 + Math.sin(t * 7) * 0.4;
      arms[0].rotation.z = -0.12;
      head.rotation.z = Math.sin(t * 1.5) * 0.07;
      upper.position.y = Math.sin(t * 3) * 0.02;
      legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 3 + i * Math.PI) * 0.06; });
      eyes.forEach((e) => { e.scale.y = blink(t, 0.7); });
      bulb.material.emissiveIntensity = 1.5 + Math.sin(t * 4) * 1;
    },
  };
}

// ---------- 5. Kimi · 半月 ----------
function buildKimi() {
  const g = new THREE.Group();
  const R = 0.78;
  const moon = new THREE.Group();
  g.add(moon);
  const ball = new THREE.Group();
  ball.rotation.y = -1.0;
  moon.add(ball);
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40, 0, Math.PI), M(0xf4efd9, { roughness: 0.85 })));
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40, Math.PI, Math.PI), M(0x1d2033, { roughness: 0.7, metalness: 0.2 })));

  const crater = M(0xd8cfb2, { roughness: 1 });
  const z0 = new THREE.Vector3(0, 0, 1);
  [[-0.55, 0.38, 0.12], [-0.6, -0.28, 0.09], [-0.18, -0.55, 0.1], [0.12, 0.6, 0.07], [-0.32, 0.62, 0.06], [0.3, -0.5, 0.06]]
    .forEach(([x, y, r]) => {
      const zz = Math.sqrt(Math.max(R * R - x * x - y * y, 0));
      const dir = new THREE.Vector3(x, y, zz).normalize();
      const c = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), crater);
      c.scale.z = 0.25;
      c.position.copy(dir).multiplyScalar(R - 0.005);
      c.quaternion.setFromUnitVectors(z0, dir);
      moon.add(c);
    });

  const onSurface = (x, y, obj, lift = 0) => {
    const dir = new THREE.Vector3(x, y, Math.sqrt(R * R - x * x - y * y)).normalize();
    obj.position.copy(dir).multiplyScalar(R + lift);
    obj.quaternion.setFromUnitVectors(z0, dir);
    moon.add(obj);
    return obj;
  };
  const eyes = [-0.3, 0.06].map((x) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), M(0x161826, { roughness: 0.2 }));
    e.scale.set(0.8, 1.25, 0.5);
    return onSurface(x, 0.1, e);
  });
  const mouth = new THREE.Group();
  mouth.add(smile(0.06, 0.014, 0x161826));
  onSurface(-0.12, -0.08, mouth);
  [-0.45, 0.2].forEach((x) => onSurface(x, -0.06, cheek(0.06)));

  // Kimi blue dot orbiting
  const orbit = new THREE.Group();
  orbit.rotation.set(1.2, 0, 0.35);
  moon.add(orbit);
  orbit.add(noShadow(new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.008, 6, 120), new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.5 }))));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), glow(0x1783ff, 1.6));
  orbit.add(dot);
  const dotLight = new THREE.PointLight(0x1783ff, 3, 3, 2);
  dot.add(dotLight);
  return {
    group: g,
    update(t) {
      moon.position.y = 1.5 + Math.sin(t * 1.3 + 1) * 0.1;
      moon.rotation.z = Math.sin(t * 0.9) * 0.08;
      moon.rotation.y = Math.sin(t * 0.6) * 0.2;
      eyes.forEach((e) => { e.scale.y = 1.25 * blink(t, 1.7); });
      const a = t * 1.4;
      dot.position.set(Math.cos(a) * 1.12, Math.sin(a) * 1.12, 0);
    },
  };
}

// ---------- 6. DeepSeek · 小鲸鱼 ----------
function buildDeepSeek() {
  const g = new THREE.Group();
  const blue = M(0x4d6bfe, { roughness: 0.3, metalness: 0.1 });
  const belly = M(0xe4eaff, { roughness: 0.5 });
  const whale = new THREE.Group();
  g.add(whale);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 48, 32), blue);
  body.scale.set(1.35, 0.95, 0.95);
  whale.add(body);
  const bel = new THREE.Mesh(new THREE.SphereGeometry(0.7, 48, 32), belly);
  bel.scale.set(1.28, 0.78, 0.86);
  bel.position.set(0.05, -0.17, 0);
  whale.add(bel);

  const eyes = [1, -1].map((s) => {
    const e = cartoonEye(0.085);
    e.position.set(0.58, 0.15, s * 0.54);
    if (s < 0) e.rotation.y = Math.PI;
    whale.add(e);
    return e;
  });
  [1, -1].forEach((s) => {
    const m = smile(0.1, 0.016, 0x1a2257);
    m.position.set(0.86, -0.1, s * 0.36);
    m.rotation.y = s * 0.9;
    whale.add(m);
    const ch = cheek(0.07);
    ch.position.set(0.72, -0.02, s * 0.5);
    ch.rotation.y = s * 0.6;
    whale.add(ch);
  });
  const fins = [1, -1].map((s) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 12), blue);
    f.scale.set(1, 0.25, 0.55);
    f.position.set(0.1, -0.35, s * 0.62);
    f.rotation.x = s * 0.5;
    whale.add(f);
    return f;
  });

  // 尾巴：从身体内部长出的渐细弯曲尾柄 + 末端两片尾鳍（都挂在同一个枢轴上，摆动时根部始终藏在身体里）
  const tail = new THREE.Group();
  tail.position.set(-0.6, 0.05, 0);
  whale.add(tail);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.4, 0.02, 0),
    new THREE.Vector3(-0.72, 0.16, 0),
    new THREE.Vector3(-0.86, 0.4, 0),
  ]);
  const TS = 40, RS = 18;
  const stalkGeo = new THREE.TubeGeometry(curve, TS, 1, RS, false);
  const pos = stalkGeo.attributes.position, P = new THREE.Vector3(), V = new THREE.Vector3();
  for (let i = 0; i <= TS; i++) {
    const u = i / TS;
    curve.getPointAt(u, P);
    const r = THREE.MathUtils.lerp(0.36, 0.08, Math.pow(u, 0.8));
    for (let j = 0; j <= RS; j++) {
      const k = i * (RS + 1) + j;
      V.fromBufferAttribute(pos, k).sub(P).multiplyScalar(r).add(P);
      pos.setXYZ(k, V.x, V.y, V.z);
    }
  }
  stalkGeo.computeVertexNormals();
  tail.add(new THREE.Mesh(stalkGeo, blue));
  const tip = curve.getPointAt(1);
  const tipDir = curve.getTangentAt(1);
  const tipAng = Math.atan2(tipDir.y, tipDir.x);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), blue);
  knob.position.copy(tip);
  tail.add(knob);
  [0.8, -0.8].forEach((off) => {
    const a = tipAng + off;
    const fl = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), blue);
    fl.scale.set(0.3, 0.11, 0.12);
    fl.position.set(tip.x + Math.cos(a) * 0.24, tip.y + Math.sin(a) * 0.24, 0);
    fl.rotation.z = a;
    tail.add(fl);
  });

  const dropMat = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, emissive: 0x5aa8ff, emissiveIntensity: 0.4, transparent: true, opacity: 0.8, roughness: 0.1 });
  const drops = Array.from({ length: 14 }, (_, i) => {
    const d = noShadow(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), dropMat));
    d.userData = { ...d.userData, phase: i / 14, ang: (i * 2.39) % (Math.PI * 2) };
    whale.add(d);
    return d;
  });
  return {
    group: g,
    update(t) {
      whale.position.y = 1.25 + Math.sin(t * 1.4) * 0.12;
      whale.rotation.z = Math.sin(t * 1.4 - 0.6) * 0.08;
      tail.rotation.z = Math.sin(t * 3) * 0.16;
      tail.rotation.y = Math.sin(t * 1.5) * 0.12;
      fins.forEach((f, i) => { f.rotation.y = Math.sin(t * 3 + i) * 0.3; });
      eyes.forEach((e) => { e.scale.y = blink(t, 2.9); });
      drops.forEach((d) => {
        const p = (t * 0.7 + d.userData.phase) % 1;
        const spread = Math.sin(p * Math.PI) * 0.35 * p;
        d.position.set(0.3 + Math.cos(d.userData.ang) * spread, 0.68 + p * 0.95 - p * p * 0.35, Math.sin(d.userData.ang) * spread);
        d.scale.setScalar(1 - p * 0.7);
      });
    },
  };
}

// ---------- 7. 你 · 小国王（玩家模式的真人座位）----------
function buildPlayer() {
  const g = new THREE.Group();
  const gold = M(0xffc24a, { roughness: 0.25, metalness: 0.6 });
  const cream = M(0xfff1d6, { roughness: 0.5 });
  const red = M(0xd8344f, { roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.3, 8, 24), red);
  body.position.y = 0.66;
  g.add(body);
  // 胸前一枚金色筹码
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 32), gold);
  badge.rotation.x = Math.PI / 2;
  badge.position.set(0, 0.74, 0.42);
  g.add(badge);
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.44, 0.9, 0);
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.28, 6, 12), red);
    a.position.y = -0.2;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), cream);
    hand.position.y = -0.42;
    pivot.add(a, hand);
    g.add(pivot);
    return pivot;
  });

  const head = new THREE.Group();
  head.position.y = 1.55;
  g.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 28), cream));
  const eyes = [-0.17, 0.17].map((x) => {
    const e = cartoonEye(0.07);
    e.position.set(x, 0.06, 0.45);
    head.add(e);
    return e;
  });
  const m = smile(0.1, 0.02, 0x8a3b2a);
  m.position.set(0, -0.12, 0.47);
  head.add(m);
  [-0.3, 0.3].forEach((x) => { const ch = cheek(0.07); ch.position.set(x, -0.08, 0.4); head.add(ch); });

  // 王冠：一圈金边 + 五个尖角，尖上镶红宝石
  const crown = new THREE.Group();
  crown.position.y = 0.42;
  crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.14, 32, 1, true), gold));
  const gem = glow(0xff4060, 1.2);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 12), gold);
    spike.position.set(Math.sin(a) * 0.3, 0.17, Math.cos(a) * 0.3);
    const jewel = noShadow(new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), gem));
    jewel.position.set(Math.sin(a) * 0.3, 0.3, Math.cos(a) * 0.3);
    crown.add(spike, jewel);
  }
  crown.rotation.z = -0.12;
  head.add(crown);
  g.scale.setScalar(1.05);
  return {
    group: g,
    update(t) {
      head.rotation.y = Math.sin(t * 0.8) * 0.2;
      head.rotation.z = Math.sin(t * 1.2) * 0.05;
      crown.position.y = 0.42 + Math.abs(Math.sin(t * 2.4)) * 0.03;
      arms[0].rotation.z = -0.2 - Math.sin(t * 1.8) * 0.08;
      arms[1].rotation.z = 0.2 + Math.sin(t * 1.8) * 0.08;
      eyes.forEach((e) => { e.scale.y = blink(t, 0.7); });
    },
  };
}

export { glow as glowMaterial, noShadow };

// 座位顺序 = 顺时针 = 行动顺序
export const BRANDS = [
  { id: 'claude', name: 'Claude', sub: 'Anthropic', color: 0xd97757, build: buildClaude },
  { id: 'openai', name: 'OpenAI', sub: 'ChatGPT', color: 0x10a37f, build: buildOpenAI },
  { id: 'gemini', name: 'Gemini', sub: 'Google', color: 0x9b72cb, build: buildGemini },
  { id: 'zhipu', name: '智谱', sub: 'GLM', color: 0x3a5cff, build: buildZhipu },
  { id: 'kimi', name: 'Kimi', sub: '月之暗面', color: 0x1783ff, build: buildKimi },
  { id: 'deepseek', name: 'DeepSeek', sub: '深度求索', color: 0x4d6bfe, build: buildDeepSeek },
  // 玩家座位：近侧长边中央，只在玩家模式下参赛
  { id: 'you', name: '你', sub: '玩家', color: 0xffc24a, build: buildPlayer, human: true },
];
