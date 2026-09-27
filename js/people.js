// 人物造型（較寫實版）：唐代文人（軟腳幞頭、交領右衽廣袖袍）、僕役（頭巾、短褐、行縢、草鞋）、船家（斗笠、蓑衣）
// 以參數曲面「雕塑」出頭臉、軀幹、衣褶與手指；頂點顏色模擬衣褶陰影、唇色、面頰血色。
// 正面朝 +z。會眨眼；輪到自己說話時嘴巴會動、頭會輕輕點動。
// 對外介面（userData 內的 head / face / armL / armR / upper / body / setPose / update …）與舊版相同。
import { THREE, E } from './engine.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) ** 2) / (2 * sx * sx) + ((y - cy) ** 2) / (2 * sy * sy)));
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise1 = (x, seed = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); const a = hash(i + seed * 57.31), b = hash(i + 1 + seed * 57.31); return a + (b - a) * u; };
function rand(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const shade = (hex, l) => '#' + new THREE.Color(hex).offsetHSL(0, 0, l).getHexString();

// ---------------- 材質 ----------------
const ROUGH = { cloth: 0.95, skin: 0.62, hair: 0.6, silk: 0.55, eye: 0.18, straw: 0.95, shoe: 0.7, dark: 1 };
const mats = new Map();
function M(color, kind = 'cloth', opts) {
  const key = color + kind + (opts ? JSON.stringify(opts) : '');
  if (!mats.has(key)) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: ROUGH[kind] ?? 0.9, metalness: 0, vertexColors: true }, opts || {}));
    mats.set(key, m);
  }
  return mats.get(key);
}
const DS = { side: THREE.DoubleSide };
const PO = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };

// ---------------- 幾何工具 ----------------
const geoCache = new Map();
function G(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

// 為沒有頂點顏色的幾何體補上白色（材質統一使用 vertexColors）
function withColor(geo, fn) {
  if (geo.attributes.color && !fn) return geo;
  const p = geo.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let t = typeof fn === 'function' ? fn(p.getX(i), p.getY(i), p.getZ(i)) : (fn ?? 1);
    if (typeof t === 'number') t = [t, t, t];
    c[i * 3] = t[0]; c[i * 3 + 1] = t[1]; c[i * 3 + 2] = t[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
// 合併多個幾何體（position / normal / color）
function merge(list) {
  let nv = 0, ni = 0;
  const gs = list.map(g => { g = g.index ? g : g.toNonIndexed(); if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); } withColor(g); if (!g.attributes.normal) g.computeVertexNormals(); nv += g.attributes.position.count; ni += g.index.count; return g; });
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), I = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of gs) {
    P.set(g.attributes.position.array, vo * 3); N.set(g.attributes.normal.array, vo * 3); C.set(g.attributes.color.array, vo * 3);
    const idx = g.index.array; for (let i = 0; i < idx.length; i++) I[io + i] = idx[i] + vo;
    vo += g.attributes.position.count; io += idx.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  return out;
}
function xform(geo, { pos, rot, scale, quat } = {}) {
  if (scale) geo.scale(...scale);
  if (rot) { const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)); geo.applyMatrix4(m); }
  if (quat) geo.applyQuaternion(quat);
  if (pos) geo.translate(...pos);
  return geo;
}
function ellipsoid(r, sx, sy, sz, pos, seg = 16, tone) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.75 | 0));
  g.scale(sx, sy, sz); if (pos) g.translate(...pos);
  return withColor(g, tone);
}
// 由 a 到 b 的圓柱／膠囊
function segment(a, b, r0, r1, seg = 10, caps = true) {
  const va = new V3(...a), vb = new V3(...b), len = va.distanceTo(vb);
  const parts = [new THREE.CylinderGeometry(r1, r0, len, seg, 1, true)];
  if (caps) { const hs = Math.max(4, seg >> 1); parts.push(new THREE.SphereGeometry(r1, seg, hs).translate(0, len / 2, 0)); parts.push(new THREE.SphereGeometry(r0, seg, hs).translate(0, -len / 2, 0)); }
  const g = merge(parts);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return g;
}

// ---- 以「沿 y 軸的一串橢圓截面」定義的曲面（軀幹、衣裙、袖、褲） ----
function spline(keys, idx) {
  const n = keys.length, ys = keys.map(k => k[0]), vs = keys.map(k => k[idx] ?? 0);
  const m = vs.map((v, i) => i === 0 ? (vs[1] - vs[0]) / (ys[1] - ys[0]) : i === n - 1 ? (vs[n - 1] - vs[n - 2]) / (ys[n - 1] - ys[n - 2]) : (vs[i + 1] - vs[i - 1]) / (ys[i + 1] - ys[i - 1]));
  return (y) => {
    if (y <= ys[0]) return vs[0];
    if (y >= ys[n - 1]) return vs[n - 1];
    let i = 0; while (y > ys[i + 1]) i++;
    const h = ys[i + 1] - ys[i], t = (y - ys[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * vs[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * vs[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
// keys: [y, 半寬 rx, 半深 rz, 中心 z, 中心 x]
function makeShape(keys, disp, tone) {
  const rx = spline(keys, 1), rz = spline(keys, 2), cz = spline(keys, 3), cx = spline(keys, 4);
  const s = { rx, rz, cz, cx, disp: disp || (() => 0), tone };
  s.point = (a, y, off = 0, out = new V3()) => {
    const d = s.disp(a, y) + off;
    return out.set(cx(y) + (rx(y) + d) * Math.sin(a), y, cz(y) + (rz(y) + d) * Math.cos(a));
  };
  s.normal = (a, y, out = new V3()) => {
    const e = 0.002, p1 = s.point(a + e, y), p0 = s.point(a - e, y), q1 = s.point(a, y + e), q0 = s.point(a, y - e);
    out.crossVectors(q1.sub(q0), p1.sub(p0)).normalize();
    const c = s.point(a, y); c.x -= cx(y); c.z -= cz(y); c.y = 0;
    if (out.dot(c) < 0) out.negate();
    return out;
  };
  return s;
}
function toneRGB(t) { return typeof t === 'number' ? [t, t, t] : t; }
function shapeGeo(s, { y0, y1, ny = 24, na = 48, a0 = -Math.PI, a1 = Math.PI, off = 0, tone, jag } = {}) {
  const pos = [], col = [], idx = [], p = new V3();
  const full = Math.abs(a1 - a0 - TAU) < 1e-6;
  const tf = tone || s.tone;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= na; i++) {
      const a = a0 + (a1 - a0) * i / na;
      let y = y0 + (y1 - y0) * j / ny;
      if (jag && j === 0) y += jag(a);
      s.point(a, y, off, p);
      pos.push(p.x, p.y, p.z);
      col.push(...toneRGB(tf ? tf(a, y, s.disp(a, y)) : 1));
    }
  }
  const W = na + 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < na; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 法線朝外
  const n = geo.attributes.normal, P = geo.attributes.position;
  const k = (ny >> 1) * W + (na >> 1), yk = P.getY(k);
  const rad = new V3(P.getX(k) - s.cx(yk), 0, P.getZ(k) - s.cz(yk));
  if (rad.dot(new V3(n.getX(k), n.getY(k), n.getZ(k))) < 0) {
    const I = geo.index.array; for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
    geo.computeVertexNormals();
  }
  if (full) {
    for (let j = 0; j <= ny; j++) {
      const a = j * W, b = j * W + na;
      const nx = n.getX(a) + n.getX(b), nyy = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b), l = Math.hypot(nx, nyy, nz) || 1;
      n.setXYZ(a, nx / l, nyy / l, nz / l); n.setXYZ(b, nx / l, nyy / l, nz / l);
    }
  }
  return geo;
}
// 沿曲面上一條路徑 [(a, y)…] 的布帶（衣領、衣緣、腰帶垂帶）
function stripGeo(s, path, { w0 = -0.015, w1 = 0.015, off = 0.004, n = 40, tone, taper } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * (path.length - 1), k = Math.min(path.length - 2, Math.floor(t)), f = t - k;
    // 路徑用 Catmull-Rom 平滑
    const P = (m) => path[clamp(m, 0, path.length - 1)];
    const cr = (d) => { const p0 = P(k - 1)[d], p1 = P(k)[d], p2 = P(k + 1)[d], p3 = P(k + 2)[d]; return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f); };
    pts.push([cr(0), cr(1)]);
  }
  const pos = [], col = [], idx = [];
  const P3 = pts.map(([a, y]) => s.point(a, y, off));
  for (let i = 0; i < n; i++) {
    const [a, y] = pts[i];
    const N = s.normal(a, y);
    const T = P3[Math.min(n - 1, i + 1)].clone().sub(P3[Math.max(0, i - 1)]).normalize();
    const B = new V3().crossVectors(N, T).normalize();
    const tp = taper ? taper(i / (n - 1)) : 1;
    for (const w of [w0 * tp, w1 * tp]) {
      const q = P3[i].clone().addScaledVector(B, w);
      pos.push(q.x, q.y, q.z);
      col.push(...toneRGB(tone ? tone(i / (n - 1), w === w0 * tp ? 0 : 1) : 1));
    }
  }
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}
// 飄帶（幞頭軟腳、頭巾尾、垂帶）：沿一條三維曲線的扁帶
function ribbonGeo(points, w0, w1, up = new V3(0, 0, 1), n = 16, tone) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new V3(...p)));
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPoint(t), T = curve.getTangent(t);
    const B = new V3().crossVectors(T, up).normalize();
    const w = (w0 + (w1 - w0) * t) / 2;
    for (const s of [-1, 1]) { const q = p.clone().addScaledVector(B, w * s); pos.push(q.x, q.y, q.z); col.push(...toneRGB(tone ? tone(t) : 1)); }
  }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}

// 衣褶：沿角度的起伏，隨高度加深；回傳 [位移, 陰影]
function folds(seed, count, twist = 0) {
  const ph = [hash(seed) * TAU, hash(seed + 1) * TAU, hash(seed + 2) * TAU];
  return (a, y) => Math.sin(count * a + ph[0] + twist * y + 1.3 * Math.sin(3 * a + ph[1])) * 0.6 + Math.sin(Math.round(count * 0.55) * a + ph[2] - twist * 0.6 * y) * 0.4;
}
const clothTone = (f, k = 0.3, micro = 0.04) => (a, y, d) => {
  const v = f(a, y);
  return 1 - k * Math.max(0, -v) + k * 0.25 * Math.max(0, v) + (noise1(a * 30 + y * 7) - 0.5) * micro;
};

// ---------------- 預設造型 ----------------
const PRESETS = {
  // 柳宗元：淡青灰交領長袍、黑幞頭、三綹長鬚
  liu: { outfit: 'robe', robe: '#b7c3bd', inner: '#efe8d6', trim: '#5f7069', belt: '#3a3029', cap: 'futou', beard: 'long', hair: '#15130f', skin: '#dcb596', height: 1.02, face: 'scholar', age: 0.25 },
  friend1: { outfit: 'robe', robe: '#9a8466', inner: '#ece3cf', trim: '#5e4b36', belt: '#3a3029', cap: 'futou', beard: 'short', hair: '#15130f', skin: '#d8a985', height: 0.98, face: 'broad' },
  friend2: { outfit: 'robe', robe: '#6f8190', inner: '#e8e3d6', trim: '#3f4d58', belt: '#2d2a26', cap: 'kerchief', capColor: '#2c3a3a', beard: 'mustache', hair: '#1b1917', skin: '#d4a47f', height: 0.99, face: 'round' },
  // 老僕：灰髮、短鬚、短褐、微駝
  oldServant: { outfit: 'tunic', clasp: true, robe: '#7d6a52', inner: '#d9cfbb', trim: '#4f4232', belt: '#3b2f24', pants: '#5b5043', wrap: '#c9bd9c', cap: 'kerchief', capColor: '#4a524e', beard: 'short', hair: '#9a958c', skin: '#cf9f7a', height: 0.95, stoop: 0.12, age: 1, face: 'thin' },
  // 年輕僕人
  servant: { outfit: 'tunic', clasp: true, robe: '#8c7250', inner: '#ddd3bd', trim: '#5a4630', belt: '#3b2f24', pants: '#5f5242', wrap: '#cfc2a0', cap: 'kerchief', capColor: '#51605d', beard: null, hair: '#1b1916', skin: '#d6a17c', height: 0.95, face: 'round' },
  // 船家：斗笠、蓑衣
  boatman: { outfit: 'tunic', clasp: true, robe: '#5e5a4e', inner: '#cdc4ae', trim: '#3d3a32', belt: '#2d2a24', pants: '#4b473d', wrap: '#bfb393', cap: 'hat', cape: true, beard: 'stubble', hair: '#1b1916', skin: '#bf8d66', height: 0.97, age: 0.5, face: 'broad' },
  // 玩家（終章鏡頭拉遠時出現）
  student: { outfit: 'tunic', robe: '#3f6159', inner: '#e3dccb', trim: '#27403a', belt: '#2d2a24', pants: '#3a4440', wrap: '#d3c9ae', cap: 'kerchief', capColor: '#23302d', beard: null, hair: '#171513', skin: '#dfb08e', height: 0.93, face: 'round' },
};

// ---------------- 頭部 ----------------
const HC = new V3(0, 0.108, 0.004);      // 顱中心（face 座標）
// 臉型參數：w 臉寬、jaw 下頷收窄、chin 下巴長、nh 鼻樑高、nw 鼻寬、nTop 鼻樑起點、lip 唇厚、cb 顴骨、cf 面頰豐滿、
// br 眉弓、ch 下巴突出、eyeTilt 眼角上揚、eyeOpen 眼睜開程度、bTilt 眉尾上揚、bw 眉粗、worry 眉心皺紋
const FACE_BASE = { hollow: 0, w: 1, jaw: 1, chin: 1, nh: 1, nw: 1, nTop: -0.004, lip: 1, cb: 1, cf: 1, br: 1, ch: 1, eyeTilt: 0.03, eyeOpen: 1, bTilt: 0, bw: 1, worry: 0 };
const FACES = {
  // 柳宗元：清瘦長臉、高而直的鼻樑、顴骨明顯兩頰微陷、薄唇、尖下巴、眼角微揚（丹鳳眼）、劍眉、眉心有愁紋
  scholar: { w: 0.9, jaw: 1.4, chin: 1.18, hollow: 1, nh: 1.35, nw: 0.8, nTop: 0.012, lip: 0.7, cb: 1.5, cf: -0.5, br: 1.35, ch: 1.25, eyeTilt: 0.16, eyeOpen: 0.8, bTilt: 1, bw: 1.15, worry: 1 },
  long: { w: 0.98, jaw: 1.05, chin: 1.06, nh: 1.05, nw: 0.95 },
  round: { w: 1.05, jaw: 0.75, chin: 0.94, nh: 0.75, nw: 1.25, lip: 1.2, cb: 0.8, cf: 1.6, br: 0.8, ch: 0.8, eyeOpen: 1.05, bTilt: -0.3, bw: 1.1 },
  thin: { w: 0.97, jaw: 1.15, chin: 1.03, nh: 1, nw: 1.05, lip: 0.85, cb: 1.2, br: 1.1, eyeOpen: 0.85, bTilt: -0.5, bw: 0.9 },
  broad: { w: 1.08, jaw: 0.6, chin: 0.98, nh: 0.85, nw: 1.35, lip: 1.25, cb: 1.3, cf: 0.8, br: 1.3, ch: 1.1, eyeOpen: 0.9, bw: 1.3 },
};
const faceOf = (o) => Object.assign({}, FACE_BASE, FACES[o.face] || FACES.long);
// 頭部參數曲面：headPoint(θ, φ) 為雕塑後的頭形；回傳 { geo, sample, shell }
function headModel(o) {
  const key = `head|${o.face}|${o.age || 0}|${o.beard}`;
  return G(key, () => {
    const F = faceOf(o);
    const age = o.age || 0;
    const RU = 0.1, RD = 0.116 * F.chin;
    const headPoint = (th, ph) => {
      const dx = Math.sin(th) * Math.sin(ph), dy = Math.cos(th), dz = Math.sin(th) * Math.cos(ph);
      let X = dx * 0.075 * F.w, Y = dy * (dy > 0 ? RU : RD), Z = dz * (dz > 0 ? 0.09 : 0.1);
      // 下頷收窄、下巴略收
      const low = sstep(0.0, -0.11, Y);
      X *= 1 - low * (0.13 * F.jaw + 0.13 * Math.max(0, dz));
      // 後腦下方收進接頸；顱頂略向後
      if (Z < 0) Z *= 1 - 0.42 * sstep(-0.01, -0.1, Y);
      Z -= 0.012 * sstep(0.0, 0.1, Y) * (1 - Math.max(0, dz) * 0.5);
      // 面部較平
      const front = sstep(0.15, 0.8, dz);
      Z -= front * 0.015 * (X / 0.075) ** 2;
      Z += front * 0.011 * sstep(-0.01, -0.08, Y) * (1 - (X / 0.07) ** 2);
      // 五官
      const ax = Math.abs(X);
      let f = 0;
      f += 0.005 * F.br * gauss(ax, Y, 0.03, 0.018, 0.022, 0.007);         // 眉弓
      f += 0.0025 * gauss(X, Y, 0, 0.012, 0.01, 0.01);                     // 眉心
      f -= 0.009 * (0.7 + 0.3 * F.br) * gauss(ax, Y, 0.031, -0.001, 0.0135, 0.009);             // 眼窩
      const noseW = (0.0062 + 0.0085 * sstep(-0.015, -0.05, Y)) * F.nw;
      f += 0.0155 * F.nh * sstep(F.nTop, -0.047, Y) * sstep(-0.064, -0.05, Y) * Math.exp(-(X * X) / (2 * noseW * noseW)); // 鼻樑至鼻尖
      f += 0.0075 * gauss(ax, Y, 0.0125 * F.nw, -0.05, 0.007 * F.nw, 0.006);             // 鼻翼
      f -= 0.0025 * gauss(ax, Y, 0.022, -0.051, 0.004, 0.006);             // 鼻翼溝
      f += 0.0055 * F.lip * gauss(X, Y, 0, -0.065, 0.018, 0.0055 * (0.6 + 0.4 * F.lip));                 // 上唇
      f += 0.006 * F.lip * gauss(X, Y, 0, -0.078, 0.015, 0.005 * (0.6 + 0.4 * F.lip));                   // 下唇
      f -= 0.003 * gauss(X, Y, 0, -0.0712, 0.021, 0.0016);                 // 口縫
      f -= 0.0022 * gauss(X, Y, 0, -0.088, 0.018, 0.004);                  // 頦唇溝
      f += 0.007 * F.ch * gauss(X, Y, 0, -0.103, 0.022 / Math.sqrt(F.ch), 0.012);                   // 下巴
      f += (0.005 * F.cb - age * 0.002) * gauss(ax, Y, 0.047, -0.02, 0.018, 0.013); // 顴骨
      f += (0.004 * F.cf - age * 0.008) * gauss(ax, Y, 0.045, -0.052, 0.02, 0.018); // 兩頰（老人凹陷）
      f -= (0.0012 + age * 0.002) * gauss(ax - 0.023 - (Y + 0.05) * -0.25, Y, 0, -0.06, 0.0032, 0.014); // 法令紋
      Z += front * f;
      return [X, Y, Z, front, dz];
    };
    const nT = 64, nP = 88, W = nP + 1;
    const pos = new Float32Array((nT + 1) * W * 3), col = new Float32Array((nT + 1) * W * 3), meta = [];
    for (let i = 0; i <= nT; i++) {
      const th = Math.PI * i / nT;
      for (let j = 0; j <= nP; j++) {
        const ph = -Math.PI + TAU * j / nP;
        const [X, Y, Z, front, dz] = headPoint(th, ph);
        const ax = Math.abs(X);
        const k = (i * W + j) * 3;
        pos[k] = X + HC.x; pos[k + 1] = Y + HC.y; pos[k + 2] = Z + HC.z;
        // 皮膚色調（乘上 skin 顏色）
        let r = 1, g = 1, b = 1;
        const lip = front * Math.max(gauss(X, Y, 0, -0.066, 0.0135, 0.004 * (0.6 + 0.4 * F.lip)), gauss(X, Y, 0, -0.077, 0.0115, 0.0042 * (0.6 + 0.4 * F.lip)));
        r *= 1 - lip * 0.06; g *= 1 - lip * 0.32; b *= 1 - lip * 0.3;
        const cheek = front * gauss(ax, Y, 0.046, -0.035, 0.018, 0.016) * (1 - age * 0.5);
        g *= 1 - cheek * 0.07; b *= 1 - cheek * 0.08;
        const sock = front * gauss(ax, Y, 0.031, 0.006, 0.013, 0.007);
        r *= 1 - sock * 0.1; g *= 1 - sock * 0.12; b *= 1 - sock * 0.08;
        const nostril = front * gauss(ax, Y, 0.009, -0.0535, 0.003, 0.0018);
        r *= 1 - nostril * 0.7; g *= 1 - nostril * 0.7; b *= 1 - nostril * 0.7;
        // 鬍渣／鬚根
        const beardZone = front * sstep(-0.06, -0.078, Y) * (1 - sstep(0.045, 0.07, ax)) * (1 - lip * 1.5) + front * gauss(X, Y, 0, -0.059, 0.02, 0.004) * 0.8;
        const st = o.beard === 'stubble' ? 0.32 : o.beard ? 0.16 : 0.04;
        const bz = clamp(beardZone, 0, 1) * st; r *= 1 - bz; g *= 1 - bz; b *= 1 - bz * 0.85;
        // 皺紋
        if (age > 0) {
          const fore = front * sstep(0.028, 0.04, Y) * sstep(0.075, 0.055, Y) * (1 - sstep(0.03, 0.05, ax));
          const wr = fore * Math.max(0, Math.sin(Y * 700)) ** 6 * 0.2 * age;
          const crow = front * gauss(ax, Y, 0.058, -0.002, 0.006, 0.01) * Math.max(0, Math.sin(Y * 900 + ax * 300)) ** 4 * 0.2 * age;
          r *= 1 - wr - crow; g *= 1 - wr - crow; b *= 1 - wr - crow;
        }
        {
          const hol = front * (F.hollow + age * 0.6) * gauss(ax, Y, 0.047, -0.052, 0.015, 0.016) * 0.13;
          const hi = front * F.hollow * gauss(ax, Y, 0.05, -0.018, 0.012, 0.009) * 0.05;
          r *= 1 - hol + hi; g *= 1 - hol * 1.05 + hi; b *= 1 - hol * 0.95 + hi;
        }
        if (F.worry) {
          const fr = front * F.worry * (gauss(ax, Y, 0.0045, 0.02, 0.0012, 0.007) * 0.16 + sstep(0.035, 0.045, Y) * sstep(0.07, 0.06, Y) * (1 - sstep(0.02, 0.04, ax)) * Math.max(0, Math.sin(Y * 520)) ** 8 * 0.1);
          r *= 1 - fr; g *= 1 - fr; b *= 1 - fr;
        }
        const mic = (hash(i * 131 + j * 17) - 0.5) * 0.012;
        col[k] = r + mic; col[k + 1] = g + mic; col[k + 2] = b + mic;
        meta.push({ th, ph, dz, X, Y, Z });
      }
    }
    const idx = [];
    for (let i = 0; i < nT; i++) for (let j = 0; j < nP; j++) { const a = i * W + j, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, d, a, d, b); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const N = geo.attributes.normal;
    for (let i = 0; i <= nT; i++) { const a = i * W, b = a + nP; const nx = N.getX(a) + N.getX(b), ny = N.getY(a) + N.getY(b), nz = N.getZ(a) + N.getZ(b), l = Math.hypot(nx, ny, nz) || 1; N.setXYZ(a, nx / l, ny / l, nz / l); N.setXYZ(b, nx / l, ny / l, nz / l); }
    // 找臉前某 (X, Y) 的表面點
    const sample = (x, y) => {
      let best = 0, bd = 1e9;
      for (let v = 0; v < meta.length; v++) { const m = meta[v]; if (m.dz < 0.3) continue; const d = (m.X - x) ** 2 + (m.Y + HC.y - y) ** 2; if (d < bd) { bd = d; best = v; } }
      return new V3(pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]);
    };
    // 貼頭殼：由頭頂一直覆蓋到 edgeY(φ度數)（相對顱中心的高度），厚度 off
    const thetaAtY = (y) => Math.acos(clamp(y >= 0 ? y / RU : y / RD, -1, 1));
    const shell = (edgeY, off, tone, nt = 26, np = 96) => {
      const P = [], C = [], I = [], w = np + 1, e = 1e-3;
      const pt = (th, ph) => { const q = headPoint(th, ph); return new V3(q[0], q[1], q[2]); };
      for (let i = 0; i <= nt; i++) for (let j = 0; j <= np; j++) {
        const ph = -Math.PI + TAU * j / np, the = thetaAtY(edgeY(Math.abs(ph) * 180 / Math.PI, ph));
        const th = Math.max(0.02, the * i / nt);
        const p = pt(th, ph);
        const n = new V3().crossVectors(pt(th + e, ph).sub(pt(th - e, ph)), pt(th, ph + e).sub(pt(th, ph - e))).normalize();
        if (n.dot(p) < 0) n.negate();
        const edgeT = i === nt ? 0.55 : 1;
        P.push(p.x + n.x * off * edgeT + HC.x, p.y + n.y * off * edgeT + HC.y, p.z + n.z * off * edgeT + HC.z);
        C.push(...toneRGB(tone ? tone({ th, ph, X: p.x, Y: p.y, Z: p.z, u: i / nt }) : 1));
      }
      for (let i = 0; i < nt; i++) for (let j = 0; j < np; j++) { const a = i * w + j, b = a + 1, c = a + w, d = c + 1; I.push(a, c, d, a, d, b); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      g.setIndex(I); g.computeVertexNormals();
      const Nn = g.attributes.normal;
      for (let i = 0; i <= nt; i++) { const a = i * w, b = a + np; const nx = Nn.getX(a) + Nn.getX(b), ny = Nn.getY(a) + Nn.getY(b), nz = Nn.getZ(a) + Nn.getZ(b), l = Math.hypot(nx, ny, nz) || 1; Nn.setXYZ(a, nx / l, ny / l, nz / l); Nn.setXYZ(b, nx / l, ny / l, nz / l); }
      return g;
    };
    return { geo, sample, shell };
  });
}
// 髮際線（face 座標 Y，相對顱中心）
function hairline(d) {
  if (d < 42) return 0.056 - (d / 42) ** 2 * 0.006;
  if (d < 72) return 0.05 - (d - 42) / 30 * 0.035;      // 鬢角
  if (d < 84) return 0.015;
  if (d < 118) return 0.016;                             // 耳上
  if (d < 140) return 0.018 - (d - 118) / 22 * 0.09;
  return -0.072;                                         // 後頸
}

// 鬚：一束束扁平髮絲
function beardGeo(hm, type, seed = 7) {
  const R = rand(seed), strands = [];
  const add = (x, y, dir, len, w, n = 6, grav = 1) => {
    const root = hm.sample(x, y + HC.y); root.z -= 0.001;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([root.x + dir[0] * len * t, root.y + dir[1] * len * t - grav * len * 0.55 * t * t, root.z + dir[2] * len * t * (1 - 0.35 * t)]);
    }
    strands.push(ribbonGeo(pts, w, w * 0.12, new V3(0, 0, 1), 8, t => 0.85 + 0.25 * t + (R() - 0.5) * 0.15));
  };
  if (type === 'long' || type === 'short' || type === 'mustache') {
    const L = type === 'long' ? 1 : 0.45;
    // 下巴一綹
    if (type !== 'mustache') for (let k = 0; k < 96; k++) {
      const x = (R() - 0.5) * 0.042, y = -0.094 - R() * 0.014;
      add(x, y, [x * 1.2, -0.55 - R() * 0.2, 0.55], (0.11 + R() * 0.07) * L, 0.007, 7, 0.9);
    }
    // 兩頰兩綹（長鬚才有）
    if (type === 'long') for (const s of [1, -1]) for (let k = 0; k < 16; k++) {
      const x = s * (0.034 + R() * 0.012), y = -0.072 - R() * 0.018;
      add(x, y, [s * 0.1, -0.7, 0.35], 0.07 + R() * 0.05, 0.004, 6, 0.9);
    }
    // 八字鬍
    for (const s of [1, -1]) for (let k = 0; k < 26; k++) {
      const u = R(), x = s * (0.003 + u * 0.016), y = -0.0585 - R() * 0.0025;
      add(x, y, [s * (0.3 + u * 0.4), -0.6, 0.18], (type === 'long' ? 0.028 : 0.018) + u * 0.014, 0.006, 5, 1.6);
    }
  }
  return strands.length ? merge(strands) : null;
}

// ---------------- 手 ----------------
// 手掌向身體內側（-x·side），拇指向前（+z）。curl 0..1
function handGeo(side, curl = 0.35, scale = 1) {
  return G(`hand|${side}|${curl}|${scale}`, () => {
    const parts = [];
    const pal = makeShape([[-0.086, 0.011, 0.029], [-0.07, 0.0145, 0.037], [-0.03, 0.0145, 0.036], [0, 0.0135, 0.027], [0.03, 0.016, 0.022]]);
    parts.push(shapeGeo(pal, { y0: -0.086, y1: 0.03, ny: 10, na: 16 }));
    const fz = [0.026, 0.0088, -0.0085, -0.0255], fl = [0.066, 0.073, 0.069, 0.055], fr = [0.0082, 0.0086, 0.0082, 0.0072];
    const inw = -side; // 手心方向
    for (let k = 0; k < 4; k++) {
      const c = curl * (0.8 + k * 0.12);
      let p = [inw * 0.002, -0.082, fz[k] * 0.97], ang = 0.1 * c;
      const segs = [0.45, 0.32, 0.23];
      for (let s = 0; s < 3; s++) {
        ang += c * (0.45 + s * 0.2);
        const L = fl[k] * segs[s];
        const q = [p[0] + inw * Math.sin(ang) * L, p[1] - Math.cos(ang) * L, p[2] - (fz[k] * 0.05) * s];
        parts.push(segment(p, q, fr[k] * (1 - s * 0.1), fr[k] * (1 - (s + 1) * 0.1), 6));
        p = q;
      }
    }
    // 拇指
    let p = [inw * 0.004, -0.018, 0.028], ang = 0.25;
    for (let s = 0; s < 2; s++) {
      const L = s ? 0.028 : 0.034;
      const q = [p[0] + inw * (0.004 + curl * 0.01), p[1] - Math.cos(ang) * L, p[2] + Math.sin(ang) * L * 0.8];
      parts.push(segment(p, q, 0.0105 - s * 0.001, 0.0095 - s * 0.001, 7));
      p = q; ang += 0.3 + curl * 0.3;
    }
    const g = merge(parts);
    g.scale(scale, scale, scale);
    return g;
  });
}

// ---------------- 建立人物 ----------------
/**
 * 建立人物。opts.preset 可為 liu / friend1 / friend2 / oldServant / servant / boatman / student，
 * 其餘欄位覆寫預設。opts.name 為對話中的名字，用來同步說話時的嘴型。
 */
export function makePerson(opts = {}) {
  const o = Object.assign({}, PRESETS[opts.preset || 'liu'], opts);
  const robeOutfit = o.outfit === 'robe';
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const standLower = new THREE.Group(); body.add(standLower);
  const sitLower = new THREE.Group(); sitLower.visible = false; body.add(sitLower);
  const upper = new THREE.Group(); body.add(upper);
  const legs = [];
  const add = (parent, geo, color, kind, opts2) => { const m = new THREE.Mesh(geo, M(color, kind, opts2)); parent.add(m); return m; };
  const seed = (o.preset || 'x').length * 13 + (o.robe || '').charCodeAt(2);

  // ================= 下身（站） =================
  if (robeOutfit) {
    const f = folds(seed, 13, 9);
    const skirt = makeShape([[0.05, 0.305, 0.25, 0.025], [0.2, 0.29, 0.235, 0.018], [0.5, 0.255, 0.2, 0.01], [0.8, 0.226, 0.168, 0.004], [1.0, 0.207, 0.15, 0]],
      (a, y) => f(a, y) * (0.003 + 0.017 * sstep(0.95, 0.1, y)) * (1 - 0.4 * Math.max(0, Math.cos(a))),
      (a, y, d) => clothTone(f, 0.32)(a, y, d) * (1 - 0.12 * sstep(0.9, 1.0, y)));
    add(standLower, G(`skirt|${seed}`, () => shapeGeo(skirt, { y0: 0.05, y1: 1.0, ny: 40, na: 72 })), o.robe, 'cloth', DS);
    add(standLower, G(`hem|${seed}`, () => shapeGeo(skirt, { y0: 0.05, y1: 0.095, ny: 3, na: 72, off: 0.003 })), o.trim, 'cloth', DS);
    // 外襟前緣（右衽：由右腋下直落衣襬）
    add(standLower, G(`edge|${seed}`, () => stripGeo(skirt, [[-1.22, 1.0], [-1.25, 0.6], [-1.3, 0.2], [-1.32, 0.05]], { w0: -0.016, w1: 0.016, off: 0.006 })), o.trim, 'cloth', DS);
    // 腰帶垂下的兩條帶子
    for (const [a1, len] of [[-0.14, 0.4], [-0.02, 0.33]]) {
      add(standLower, G(`tie|${seed}|${a1}`, () => stripGeo(skirt, [[a1, 0.99], [a1 - 0.03, 0.85], [a1 - 0.05, 1 - len]], { w0: -0.017, w1: 0.017, off: 0.009, tone: (t) => 1 - t * 0.1 })), o.belt, 'cloth', DS);
    }
    // 雲頭履：藏在衣襬下，行走時前後擺動
    for (const sd of [1, -1]) {
      const leg = new THREE.Group(); leg.position.set(0.085 * sd, 0.62, 0);
      add(leg, G('shoe', () => merge([
        ellipsoid(0.05, 0.95, 0.62, 2.4, [0, -0.595, 0.055]),
        ellipsoid(0.03, 1.1, 0.9, 1.1, [0, -0.568, 0.155]),
        segment([0, -0.585, 0.16], [0, -0.545, 0.185], 0.014, 0.012, 8),
      ])), '#1c1a18', 'shoe');
      standLower.add(leg); legs.push(leg);
    }
  } else {
    const f = folds(seed, 11, 6);
    const skirt = makeShape([[0.47, 0.265, 0.215, 0.012], [0.62, 0.245, 0.19, 0.008], [0.8, 0.222, 0.165, 0.004], [1.0, 0.195, 0.14, 0]],
      (a, y) => f(a, y) * (0.003 + 0.01 * sstep(0.95, 0.5, y)),
      clothTone(f, 0.3));
    add(standLower, G(`tskirt|${seed}`, () => shapeGeo(skirt, { y0: 0.47, y1: 1.0, ny: 22, na: 64 })), o.robe, 'cloth', DS);
    add(standLower, G(`them|${seed}`, () => shapeGeo(skirt, { y0: 0.47, y1: 0.505, ny: 2, na: 64, off: 0.003 })), o.trim, 'cloth', DS);
    add(standLower, G(`tedge|${seed}`, () => stripGeo(skirt, [[-1.18, 1.0], [-1.22, 0.75], [-1.26, 0.47]], { w0: -0.013, w1: 0.013, off: 0.006 })), o.trim, 'cloth', DS);
    for (const sd of [1, -1]) {
      const leg = new THREE.Group(); leg.position.set(0.092 * sd, 0.62, 0);
      buildLeg(leg, sd, false);
      standLower.add(leg); legs.push(leg);
    }
  }

  // 一條腿：褲 + 行縢（綁腿）+ 草鞋（僕役）或 長袍下的褲 + 履（坐姿用）
  function buildLeg(leg, sd, robeLeg) {
    const fp = folds(seed + sd, 7, 20);
    const pants = makeShape([[-0.34, 0.058, 0.062, 0.006], [-0.2, 0.074, 0.077, 0.004], [0, 0.086, 0.088, 0], [0.1, 0.09, 0.09, 0]],
      (a, y) => fp(a, y) * 0.006, clothTone(fp, 0.25));
    add(leg, G(`pants|${seed}|${sd}`, () => shapeGeo(pants, { y0: -0.34, y1: 0.1, ny: 12, na: 24 })), o.pants, 'cloth');
    const wrap = makeShape([[-0.565, 0.036, 0.04, 0.006], [-0.5, 0.044, 0.05, 0.01], [-0.41, 0.054, 0.06, 0.012], [-0.31, 0.058, 0.062, 0.006]],
      (a, y) => 0.0015 * Math.sin((y * 40 + a / TAU * 1) * TAU),
      (a, y) => { const v = ((y * 40 + a / TAU) % 1 + 1) % 1; return 0.8 + 0.2 * sstep(0.0, 0.25, v) * sstep(1.0, 0.75, v); });
    add(leg, G(`wrap|${sd}`, () => shapeGeo(wrap, { y0: -0.565, y1: -0.31, ny: 24, na: 20 })), o.wrap, 'cloth');
    // 腳與草鞋
    add(leg, G(`foot|${sd}`, () => merge([
      ellipsoid(0.042, 0.95, 0.62, 2.3, [0, -0.585, 0.05]),
      ...[0, 1, 2, 3, 4].map(k => ellipsoid(0.009 - k * 0.0006, 1, 0.8, 1.2, [sd * (0.022 - k * 0.011) * -1, -0.598, 0.138 - k * 0.006 - (k === 0 ? 0 : 0.004)])),
    ])), o.skin, 'skin');
    add(leg, G(`sandal|${sd}`, () => withColor(new THREE.CylinderGeometry(0.052, 0.052, 0.014, 20).scale(1, 1, 2.35).translate(0, -0.612, 0.052),
      (x, y, z) => 0.85 + 0.15 * Math.sin(z * 300) * Math.sin(x * 200))), '#b3955a', 'straw');
    for (const [z, r] of [[0.1, 0.034], [0.03, 0.036]]) {
      add(leg, G(`strap|${z}`, () => withColor(new THREE.TorusGeometry(r, 0.0045, 5, 18, Math.PI).scale(1.25, 0.75, 1).translate(0, -0.607, z))), '#8d7447', 'straw');
    }
  }

  // ================= 下身（坐：箕踞，兩腿伸直岔開） =================
  {
    const low = robeOutfit ? o.robe : o.pants;
    const f = folds(seed + 5, 10, 4);
    const pool = makeShape([[0.0, 0.43, 0.38, 0.03], [0.06, 0.39, 0.34, 0.03], [0.17, 0.29, 0.24, 0.02], [0.31, 0.21, 0.152, 0]],
      (a, y) => f(a, y) * 0.016 * sstep(0.3, 0.02, y), clothTone(f, 0.3));
    add(sitLower, G(`pool|${seed}`, () => shapeGeo(pool, { y0: 0.01, y1: 0.31, ny: 12, na: 64 })), o.robe, 'cloth', DS);
    for (const sd of [1, -1]) {
      const a = 0.32 * sd, dirx = Math.sin(a), dirz = Math.cos(a), hx = 0.11 * sd;
      const kx = hx + dirx * 0.42, kz = 0.05 + dirz * 0.42, fx = hx + dirx * 0.78, fz = 0.05 + dirz * 0.78;
      add(sitLower, G(`sthigh|${sd}|${robeOutfit}`, () => segment([hx, 0.15, 0.05], [kx, 0.13, kz], robeOutfit ? 0.105 : 0.088, robeOutfit ? 0.088 : 0.07, 16)), low, 'cloth');
      add(sitLower, G(`sshin|${sd}|${robeOutfit}`, () => segment([kx, 0.13, kz], [fx, 0.085, fz], robeOutfit ? 0.082 : 0.058, robeOutfit ? 0.07 : 0.042, 16)), robeOutfit ? o.robe : o.wrap, 'cloth');
      // 腳（腳尖朝上）
      const foot = new THREE.Group(); foot.position.set(fx + dirx * 0.035, 0.1, fz + dirz * 0.035); foot.rotation.set(-Math.PI / 2 + 0.25, a, 0, 'YXZ');
      if (robeOutfit) add(foot, G('sshoe', () => merge([ellipsoid(0.05, 0.95, 0.62, 2.4, [0, 0, 0.05]), ellipsoid(0.03, 1.1, 0.9, 1.1, [0, 0.03, 0.15])])), '#1c1a18', 'shoe');
      else {
        add(foot, G('sfoot', () => ellipsoid(0.042, 0.95, 0.62, 2.3, [0, 0, 0.05])), o.skin, 'skin');
        add(foot, G('ssandal', () => withColor(new THREE.CylinderGeometry(0.052, 0.052, 0.014, 20).scale(1, 1, 2.35).translate(0, -0.025, 0.052))), '#b3955a', 'straw');
      }
      sitLower.add(foot);
    }
    // 衣襬垂在兩腿之間
    add(sitLower, G(`drape|${seed}`, () => {
      const nu = 14, nv = 12, P = [], C = [], I = [];
      for (let v = 0; v <= nv; v++) for (let u = 0; u <= nu; u++) {
        const U = u / nu, Vv = v / nv, reach = robeOutfit ? 0.62 : 0.35;
        const aL = 0.32, ang = -aL + 2 * aL * U;
        const r = 0.12 + reach * Vv;
        const x = Math.sin(ang) * r + (U - 0.5) * 0.22, z = 0.06 + Math.cos(ang) * r;
        const y = Math.max(0.018, 0.29 - Vv * 0.26 - Math.sin(Math.PI * U) * Vv * 0.08) + (U < 0.08 || U > 0.92 ? 0.03 : 0);
        P.push(x, y + Math.sin(U * 18 + Vv * 3) * 0.006 * Vv, z);
        C.push(...toneRGB(0.95 - Math.sin(Math.PI * U) * Vv * 0.15 + Math.sin(U * 18) * 0.04));
      }
      for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) { const a = v * (nu + 1) + u, b = a + 1, c = a + nu + 1, d = c + 1; I.push(a, c, d, a, d, b); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
    }), o.robe, 'cloth', DS);
  }

  // ================= 上身 =================
  const slim = robeOutfit ? 0 : 0.018;
  const ft = folds(seed + 9, 9, 14);
  const torsoShape = makeShape([
    [0.96, 0.207 - slim, 0.15 - slim * 0.6, 0], [1.06, 0.2 - slim, 0.145 - slim * 0.6, 0], [1.2, 0.205 - slim, 0.146 - slim * 0.6, 0.006],
    [1.32, 0.212 - slim, 0.14 - slim * 0.5, 0.008], [1.42, 0.214 - slim * 0.8, 0.124 - slim * 0.4, 0], [1.475, 0.17 - slim * 0.6, 0.104, -0.005],
    [1.51, 0.104, 0.086, -0.008], [1.545, 0.07, 0.07, -0.01]],
    (a, y) => ft(a, y) * 0.004 * sstep(1.42, 1.1, y) + 0.004 * Math.max(0, Math.cos(a)) * gauss(0, y, 0, 1.27, 1, 0.07),
    (a, y, d) => clothTone(ft, 0.22)(a, y, d) * (1 - 0.18 * gauss(0, y, 0, 1.06, 1, 0.04)) * (1 - 0.1 * sstep(1.45, 1.54, y)));
  const torso = add(upper, G(`torso|${seed}|${slim}`, () => shapeGeo(torsoShape, { y0: 0.96, y1: 1.545, ny: 34, na: 64 })), o.robe, 'cloth');
  // 交領右衽：外襟由左頸斜落右腋；內襟由右頸落到胸前
  const outer = [[Math.PI, 1.528], [2.3, 1.524], [1.3, 1.518], [0.55, 1.5], [0.18, 1.452], [-0.2, 1.37], [-0.55, 1.27], [-0.9, 1.18], [-1.22, 1.08], [-1.24, 1.0]];
  const inner = [[-Math.PI, 1.528], [-2.3, 1.524], [-1.3, 1.518], [-0.55, 1.5], [-0.22, 1.466], [0.02, 1.41]];
  add(upper, G(`collarIn|${slim}`, () => stripGeo(torsoShape, inner, { w0: -0.028, w1: 0.012, off: 0.006, n: 30 })), o.inner, 'cloth', DS);
  add(upper, G(`collarIn2|${slim}`, () => stripGeo(torsoShape, inner, { w0: -0.012, w1: 0.012, off: 0.008, n: 30 })), o.trim, 'cloth', DS);
  add(upper, G(`collarOutW|${slim}`, () => stripGeo(torsoShape, outer, { w0: -0.032, w1: -0.01, off: 0.009, n: 60 })), o.inner, 'cloth', DS);
  add(upper, G(`collarOut|${slim}`, () => stripGeo(torsoShape, outer, { w0: -0.016, w1: 0.019, off: 0.011, n: 60, tone: (t, s) => 1 - s * 0.08 })), o.trim, 'cloth', DS);
  // 腰帶：束在腰間，前面打結
  const beltShape = makeShape([[0.985, 0.216 - slim, 0.158 - slim * 0.6, 0.001], [1.07, 0.212 - slim, 0.155 - slim * 0.6, 0.001]], (a, y) => 0.002 * Math.sin(a * 10 + y * 90));
  add(upper, G(`belt|${slim}`, () => shapeGeo(beltShape, { y0: 0.99, y1: 1.062, ny: 4, na: 56, tone: (a, y) => 0.9 + 0.1 * Math.sin(y * 260) })), o.belt, 'cloth');
  add(upper, G(`knot|${slim}`, () => merge([ellipsoid(0.028, 1.2, 0.9, 0.7, [-0.03, 1.025, 0.163 - slim * 0.6]), ellipsoid(0.02, 1.1, 0.8, 0.7, [-0.058, 1.03, 0.155 - slim * 0.6], 10, 0.85)])), o.belt, 'cloth');
  if (!robeOutfit) {
    for (const [dx, len] of [[-0.03, 0.2], [-0.05, 0.15]]) add(upper, G(`ttie|${dx}`, () => ribbonGeo([[dx, 1.02, 0.17], [dx - 0.005, 0.95, 0.19], [dx - 0.012, 1.02 - len, 0.2]], 0.022, 0.018)), o.belt, 'cloth', DS);
  }
  // 蓑衣
  if (o.cape) {
    const fc = (a, y) => 0.004 * Math.sin(a * 70) + 0.003 * Math.sin(a * 23 + y * 40);
    const straw = (a, y) => { const n = noise1(a * 45, 3); return [0.78 + 0.3 * n, 0.74 + 0.28 * n, 0.66 + 0.22 * n]; };
    const cape1 = makeShape([[1.08, 0.36, 0.31, 0.01], [1.25, 0.31, 0.25, 0.005], [1.42, 0.27, 0.19, 0], [1.5, 0.18, 0.13, -0.004], [1.545, 0.085, 0.08, -0.008]], fc, straw);
    add(upper, G('cape1', () => shapeGeo(cape1, { y0: 1.08, y1: 1.545, ny: 16, na: 96, off: 0.01, jag: (a) => -0.05 * noise1(a * 18, 1) - 0.02 * hash(Math.round(a * 30)) })), '#a88d57', 'straw', DS);
    const cape2 = makeShape([[1.3, 0.28, 0.22, 0.004], [1.45, 0.2, 0.15, 0], [1.53, 0.11, 0.1, -0.006], [1.56, 0.08, 0.078, -0.01]], fc, straw);
    add(upper, G('cape2', () => shapeGeo(cape2, { y0: 1.3, y1: 1.56, ny: 10, na: 96, off: 0.03, jag: (a) => -0.035 * noise1(a * 22, 2) })), '#9a7f4b', 'straw', DS);
  }

  // ================= 手臂（肩為支點；廣袖或窄袖） =================
  // 手臂分上臂（肩為支點）與前臂（肘為支點），前臂內有手與握杯點
  const ELBOW = -0.29;
  function arm(side) {
    const g = new THREE.Group(); g.position.set(0.215 * side, 1.44, 0);
    const fs = folds(seed + side * 3, 7, 12);
    const fore = new THREE.Group(); g.add(fore);
    const sleeveLow = new THREE.Group(); fore.add(sleeveLow);   // 舉手時廣袖會滑向手肘
    let sleeve, handPos, relaxed, gripG;
    if (robeOutfit) {
      sleeve = makeShape([[-0.64, 0.112, 0.178, 0.025, 0.028 * side], [-0.5, 0.104, 0.152, 0.014, 0.022 * side], [-0.33, 0.09, 0.11, 0.005, 0.012 * side], [-0.15, 0.078, 0.086, 0, 0.004 * side], [-0.03, 0.074, 0.078, 0, 0], [0.0, 0.064, 0.068, 0, -0.008 * side], [0.022, 0.03, 0.034, 0, -0.018 * side], [0.03, 0.01, 0.01, 0, -0.022 * side]],
        (a, y) => fs(a, y) * (0.002 + 0.01 * sstep(-0.1, -0.62, y)), clothTone(fs, 0.3));
      handPos = [0.024 * side, -0.598, 0.018]; relaxed = 0.35;
    } else {
      sleeve = makeShape([[-0.585, 0.038, 0.042, 0.012, 0.024 * side], [-0.52, 0.043, 0.047, 0.01, 0.022 * side], [-0.3, 0.05, 0.053, 0.004, 0.014 * side], [-0.03, 0.058, 0.06, 0, 0], [0.0, 0.052, 0.055, 0, -0.008 * side], [0.022, 0.026, 0.028, 0, -0.018 * side], [0.03, 0.01, 0.01, 0, -0.022 * side]],
        (a, y) => fs(a, y) * 0.004, clothTone(fs, 0.25));
      handPos = [0.024 * side, -0.56, 0.012]; relaxed = 0.4;
    }
    const ex = sleeve.cx(ELBOW), ez = sleeve.cz(ELBOW);
    fore.position.set(ex, ELBOW, ez);
    const toFore = (geo) => geo.clone().translate(-ex, -ELBOW, -ez);
    const y0 = robeOutfit ? -0.64 : -0.585, kind = robeOutfit ? 'sleeve' : 'tsleeve';
    // 上臂袖
    add(g, G(`${kind}U|${seed}|${side}`, () => shapeGeo(sleeve, { y0: ELBOW - 0.035, y1: 0.03, ny: 16, na: robeOutfit ? 40 : 28 })), o.robe, 'cloth', DS);
    // 肘部（彎曲時補上縫隙）
    add(fore, G(`elbow|${kind}|${seed}|${side}`, () => ellipsoid(1, sleeve.rx(ELBOW) * 0.97, sleeve.rx(ELBOW) * 0.9, sleeve.rz(ELBOW) * 0.97, null, 20)), o.robe, 'cloth');
    // 前臂袖、袖口
    const low = G(`${kind}L|${seed}|${side}`, () => toFore(shapeGeo(sleeve, { y0, y1: ELBOW + 0.01, ny: 18, na: robeOutfit ? 40 : 28 })));
    add(sleeveLow, low, o.robe, 'cloth', robeOutfit ? undefined : DS);
    if (robeOutfit) add(sleeveLow, low, shade(o.robe, -0.22), 'cloth', { side: THREE.BackSide });
    add(sleeveLow, G(`${kind}C|${seed}|${side}`, () => toFore(shapeGeo(sleeve, { y0, y1: y0 + (robeOutfit ? 0.04 : 0.03), ny: 3, na: robeOutfit ? 40 : 28, off: 0.0025 }))), o.trim, 'cloth', DS);
    // 廣袖內的中單窄袖（舉手、袖子滑落時可見）
    if (robeOutfit) {
      const inner = makeShape([[-0.6, 0.036, 0.04, 0.018, 0.024 * side], [-0.45, 0.042, 0.046, 0.012, 0.018 * side], [-0.3, 0.05, 0.052, 0.005, 0.012 * side]]);
      add(fore, G(`innerSl|${side}`, () => toFore(shapeGeo(inner, { y0: -0.6, y1: -0.3, ny: 6, na: 20 }))), o.inner, 'cloth');
    }
    const hand = add(fore, handGeo(side, relaxed, robeOutfit ? 1 : 0.97), o.skin, 'skin');
    hand.position.set(handPos[0] - ex, handPos[1] - ELBOW, handPos[2] - ez);
    // 握杯點：在彎曲的手指之間，杯口朝拇指方向（手的 +z）
    gripG = new THREE.Group(); gripG.position.set(hand.position.x - side * 0.036, hand.position.y - 0.106, hand.position.z + 0.004); gripG.rotation.x = Math.PI / 2; fore.add(gripG);
    g.rotation.z = 0.1 * side;
    upper.add(g);
    g.userData = { fore, sleeveLow, hand, grip: gripG, side, relaxedGeo: hand.geometry, gripGeo: handGeo(side, 0.95, robeOutfit ? 1 : 0.97) };
    return g;
  }
  const armL = arm(1), armR = arm(-1);

  // ================= 頭 =================
  const head = new THREE.Group(); head.position.y = 1.555; upper.add(head);
  const face = new THREE.Group(); head.add(face); // 說話時點頭用
  const hm = headModel(o);
  // 頸
  const neck = makeShape([[-0.08, 0.056, 0.058, -0.012], [0.0, 0.052, 0.055, -0.01], [0.06, 0.049, 0.053, -0.012], [0.09, 0.044, 0.048, -0.015]], null,
    (a, y) => 1 - 0.12 * sstep(0.02, -0.05, y) * Math.max(0, Math.cos(a)));
  add(face, G('neck', () => shapeGeo(neck, { y0: -0.08, y1: 0.09, ny: 8, na: 24 })), o.skin, 'skin');
  add(face, hm.geo, o.skin, 'skin');
  // 耳
  for (const s of [1, -1]) {
    add(face, G(`ear|${s}|${o.face}`, () => {
      const F = faceOf(o);
      const cx = s * 0.071 * F.w, cy = HC.y - 0.012, cz = -0.012;
      const outerE = ellipsoid(0.03, 0.34, 1, 0.66, null, 14, (x, y, z) => 1 - 0.12 * Math.max(0, x * s) / 0.01);
      outerE.rotateY(-s * 0.35); outerE.translate(cx, cy, cz);
      const rim = withColor(new THREE.TorusGeometry(0.019, 0.0045, 6, 16, Math.PI * 1.3).rotateZ(-Math.PI * 0.15).scale(1, 1.35, 1).rotateY(Math.PI / 2 - s * 0.35 + (s < 0 ? Math.PI : 0)).translate(cx + s * 0.004, cy + 0.003, cz - 0.002));
      const lobe = ellipsoid(0.008, 0.7, 1.1, 0.9, [cx + s * 0.002, cy - 0.026, cz + 0.004], 8);
      return merge([outerE, rim, lobe]);
    }), o.skin, 'skin');
  }
  // 眼睛（可眨）
  const eyes = [], lids = [];
  const FF = faceOf(o), lidOpen = -0.12 + (1 - FF.eyeOpen) * 0.55;
  const ER = 0.0118;
  for (const s of [1, -1]) {
    const surf = hm.sample(0.031 * s, HC.y - 0.003);
    const eg = new THREE.Group(); eg.position.set(0.0305 * s, HC.y - 0.003, surf.z - 0.0062); eg.rotation.z = s * FF.eyeTilt; face.add(eg);
    add(eg, G('eyeball', () => ellipsoid(ER, 1, 1, 1, null, 18)), '#e3d9cb', 'eye');
    const iris = add(eg, G('iris', () => withColor(new THREE.SphereGeometry(ER * 1.012, 20, 8, 0, TAU, 0, 0.68).rotateX(Math.PI / 2),
      (x, y, z) => { const r = Math.hypot(x, y) / ER; return r < 0.24 ? 0.1 : r > 0.56 ? 0.55 : 1; })), '#3a2517', 'eye');
    iris.rotation.y = -s * 0.06;
    const lid = new THREE.Group(); eg.add(lid);
    add(lid, G('lidU', () => withColor(new THREE.SphereGeometry(ER * 1.1, 20, 10, 0, TAU, 0, Math.PI * 0.44), (x, y, z) => y < ER * 0.35 && z > 0 ? 0.45 : 0.93)), o.skin, 'skin');
    lid.rotation.x = lidOpen;
    add(eg, G('lidL', () => withColor(new THREE.SphereGeometry(ER * 1.07, 20, 8, 0, TAU, Math.PI * 0.64, Math.PI * 0.36), (x, y, z) => y > -ER * 0.55 && z > 0 ? 0.8 : 0.97)), o.skin, 'skin');
    eyes.push(eg); lids.push(lid);
  }
  // 眉：一根根斜向外的短毛
  add(face, G(`brows|${o.face}`, () => {
    const R = rand(3), parts = [];
    for (const sd of [1, -1]) for (let k = 0; k < 44; k++) {
      const u = k / 43, ax = 0.012 + u * 0.042;
      const yc = HC.y + 0.0185 + 0.0045 * Math.sin(u * Math.PI * 0.9) - u * 0.004 + FF.bTilt * u * 0.007 + (R() - 0.5) * 0.003 * (1 - u * 0.5);
      const root = hm.sample(sd * ax, yc); root.z += 0.0012;
      const len = 0.011 + (1 - u) * 0.005, ang = 1.05 + u * 0.45 + (R() - 0.5) * 0.2;
      parts.push(ribbonGeo([[root.x, root.y, root.z], [root.x + sd * Math.sin(ang) * len * 0.6, root.y + Math.cos(ang) * len * 0.5, root.z + 0.0012], [root.x + sd * Math.sin(ang) * len, root.y + Math.cos(ang) * len * 0.6 - len * 0.15, root.z + 0.0012]], 0.0032 * FF.bw * (1 - u * 0.4), 0.0008, new V3(0, 0, 1), 3));
    }
    return merge(parts);
  }), o.hair, 'hair', DS);
  // 口（說話時張合）
  const mouthPos = hm.sample(0, HC.y - 0.0705);
  const mouthG = new THREE.Group(); mouthG.position.set(0, mouthPos.y, mouthPos.z - 0.002); face.add(mouthG);
  const mouth = add(mouthG, G('mouth', () => ellipsoid(0.019, 1, 0.13, 0.35, null, 14)), '#3b1a15', 'dark');
  // 頭髮（鬢角、後頸）
  add(face, G(`hair|${o.face}`, () => hm.shell((d) => hairline(d), 0.0045, (m) => 0.8 + 0.35 * noise1(m.ph * 60 + m.th * 4, 5), 24)), o.hair, 'hair', PO);
  // 鬚
  const bg = G(`beard|${o.beard}|${o.face}`, () => beardGeo(hm, o.beard, 11));
  if (bg) add(face, bg, o.hair, 'hair', DS);
  // 頭飾
  const ribbons = [];
  const topY = HC.y;
  if (o.cap === 'futou') {
    // 幞頭：黑紗裹頭，頂上巾子微分兩瓣，腦後打結垂下兩條軟腳
    add(face, G(`futou|${o.face}`, () => hm.shell((d) => d < 60 ? 0.044 : d < 110 ? 0.044 - (d - 60) / 50 * 0.034 : 0.01 - (d - 110) / 70 * 0.045,
      0.011, (m) => 0.86 + 0.18 * Math.max(0, Math.sin(m.ph * 9 + m.th * 5)) - 0.12 * sstep(0.8, 1, m.u))), '#1a1918', 'silk');
    add(face, G('jinzi', () => merge([
      ellipsoid(0.043, 0.9, 1.1, 1.2, [0.017, topY + 0.098, -0.02], 16, (x, y, z) => 0.85 + 0.25 * sstep(topY + 0.08, topY + 0.15, y)),
      ellipsoid(0.043, 0.9, 1.1, 1.2, [-0.017, topY + 0.098, -0.02], 16, (x, y, z) => 0.85 + 0.25 * sstep(topY + 0.08, topY + 0.15, y)),
      withColor(new THREE.TorusGeometry(0.055, 0.009, 6, 20, Math.PI).rotateY(Math.PI / 2).scale(1, 0.5, 1.2).translate(0, topY + 0.058, -0.03)),
      ellipsoid(0.02, 1.4, 0.8, 0.8, [0, topY + 0.04, -0.1], 10),
    ])), '#1a1918', 'silk');
    for (const s of [1, -1]) {
      const rb = new THREE.Group(); rb.position.set(0.022 * s, topY + 0.035, -0.1); face.add(rb);
      add(rb, G(`futouTail|${s}`, () => ribbonGeo([[0, 0, 0], [0.01 * s, -0.06, -0.04], [0.016 * s, -0.16, -0.055], [0.02 * s, -0.27, -0.05], [0.022 * s, -0.33, -0.042]], 0.03, 0.036, new V3(0, 0, 1), 18, (t) => 0.9 + 0.1 * Math.sin(t * 12))), '#1d1c1b', 'silk', DS);
      rb.rotation.x = 0.35; rb.rotation.z = 0.05 * s;
      ribbons.push(rb);
    }
  } else if (o.cap === 'kerchief') {
    // 頭巾：包住頭頂，頂上髮髻，腦後打結
    const fk = folds(seed + 21, 14, 30);
    add(face, G(`kerchief|${o.face}`, () => hm.shell((d) => d < 70 ? 0.048 : d < 120 ? 0.048 - (d - 70) / 50 * 0.024 : 0.024 - (d - 120) / 60 * 0.06,
      0.01, (m) => 0.9 + 0.14 * fk(m.ph, m.th * 3) - 0.1 * sstep(0.85, 1, m.u))), o.capColor, 'cloth');
    add(face, G('bun', () => merge([ellipsoid(0.043, 1, 0.95, 1, [0, topY + 0.1, -0.03], 16, (x, y, z) => 0.88 + 0.12 * Math.sin(Math.atan2(x, z) * 7 + y * 80)), ellipsoid(0.02, 1.4, 0.6, 1.4, [0, topY + 0.075, -0.03], 10, 0.8)])), o.capColor, 'cloth');
    add(face, G('kknot', () => ellipsoid(0.017, 1.4, 1, 0.8, [0, topY + 0.02, -0.103], 10, 0.85)), o.capColor, 'cloth');
    for (const s of [1, -1]) {
      const rb = new THREE.Group(); rb.position.set(0.012 * s, topY + 0.02, -0.105); face.add(rb);
      add(rb, G(`ktail|${s}`, () => ribbonGeo([[0, 0, 0], [0.008 * s, -0.035, -0.022], [0.012 * s, -0.075, -0.028], [0.014 * s, -0.095, -0.024]], 0.024, 0.02, new V3(0, 0, 1), 10)), o.capColor, 'cloth', DS);
      rb.rotation.x = 0.3; rb.rotation.z = 0.08 * s; ribbons.push(rb);
    }
  } else if (o.cap === 'hat') {
    // 斗笠：竹篾編織的尖頂圓笠，下有頭箍與繫帶
    add(face, G('hatbun', () => ellipsoid(0.04, 1, 0.9, 1, [0, topY + 0.09, -0.03], 12)), o.hair, 'hair');
    const hs = makeShape([[0.2, 0.4, 0.4, 0], [0.215, 0.375, 0.375, 0], [0.29, 0.19, 0.19, 0], [0.345, 0.055, 0.055, 0], [0.36, 0.012, 0.012, 0]],
      (a, y) => 0.002 * Math.sin(a * 64),
      (a, y) => { const w = Math.sin(a * 64) * Math.sin(y * 420); return [0.86 + 0.14 * w, 0.84 + 0.13 * w, 0.8 + 0.1 * w]; });
    add(face, G('hat', () => shapeGeo(hs, { y0: 0.2, y1: 0.36, ny: 16, na: 96, tone: undefined })), '#c7a66a', 'straw', DS);
    add(face, G('hatrim', () => withColor(new THREE.TorusGeometry(0.4, 0.008, 5, 64).rotateX(Math.PI / 2).translate(0, 0.2, 0))), '#9d7f45', 'straw');
    add(face, G('hattop', () => ellipsoid(0.022, 1, 0.8, 1, [0, 0.36, 0], 8)), '#8f733f', 'straw');
    add(face, G('hatband', () => withColor(new THREE.TorusGeometry(0.083, 0.006, 5, 24).rotateX(Math.PI / 2 + 0.12).translate(0, topY + 0.07, -0.01))), '#6d5a36', 'straw');
    for (const s of [1, -1]) add(face, G(`hstrap|${s}`, () => segment([0.07 * s, topY + 0.06, 0.0], [0.045 * s, HC.y - 0.1, 0.035], 0.0025, 0.0025, 4, false)), '#6d5a36', 'straw');
  }

  // ---------- 整體比例 ----------
  root.scale.setScalar((o.height || 1) * (o.scale || 1));
  if (o.stoop) upper.rotation.x = o.stoop;

  // ---------- 狀態與動畫 ----------
  const ud = root.userData;
  Object.assign(ud, { head, face, armL, armR, upper, body, pose: 'stand', walkT: 0, walking: false, name: o.name || '' });
  const baseStoop = o.stoop || 0;
  let t = Math.random() * 10, blinkIn = 1 + Math.random() * 3, blinkT = 0, glance = 0, glanceIn = 2 + Math.random() * 3;
  const legAmp = robeOutfit ? 0.3 : 0.45;

  // ---------- 握杯與飲酒（兩節手臂的反向運動學） ----------
  const _v = new V3(), _w = new V3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const DOWN = new V3(0, -1, 0);
  // 讓手臂 g 的握杯點到達 target（upper 座標），杯口朝 openDir；pole 決定手肘方向
  function solveArm(g, target, openDir, pole, outA, outF) {
    const { fore, grip } = g.userData;
    const S = g.position, e = fore.position, L1 = e.length();
    const gl = grip.position, L2 = gl.length();
    const d = clamp(_v.copy(target).sub(S).length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    const u = _v.copy(target).sub(S).normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pv = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    const elbowDir = u.clone().multiplyScalar(a).addScaledVector(pv, h).normalize();
    outA.setFromUnitVectors(e.clone().normalize(), elbowDir);
    // 前臂：先指向目標，再繞前臂軸扭轉，使杯口朝向 openDir
    const inv = outA.clone().invert();
    const tLocal = target.clone().sub(S).applyQuaternion(inv).sub(e);
    const dir = tLocal.clone().normalize();
    outF.setFromUnitVectors(gl.clone().normalize(), dir);
    const cur = new V3(0, 0, 1).applyQuaternion(outF);            // 握杯點 +y 等於前臂 +z
    const want = openDir.clone().applyQuaternion(inv);
    cur.addScaledVector(dir, -cur.dot(dir)).normalize(); want.addScaledVector(dir, -want.dot(dir)).normalize();
    let ang = Math.acos(clamp(cur.dot(want), -1, 1));
    if (new V3().crossVectors(cur, want).dot(dir) < 0) ang = -ang;
    outF.premultiply(_q2.setFromAxisAngle(dir, ang));
  }
  const held = { obj: null, rim: 0.04 };
  const restA = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.1));
  const qA0 = new THREE.Quaternion(), qF0 = new THREE.Quaternion(), qA1 = new THREE.Quaternion(), qF1 = new THREE.Quaternion();
  const mouthUpper = () => new V3(0, head.position.y + mouthG.position.y, mouthG.position.z + 0.012);
  /** 右手拿起物件（酒杯、酒壺）。lift：物件原點相對握點的高度；rim：杯口離握點的距離 */
  ud.holdCup = (obj, { lift = -0.02, rim = 0.04 } = {}) => {
    const { grip, hand, gripGeo } = armR.userData;
    grip.add(obj); obj.position.set(0, lift, 0); obj.rotation.set(0, 0, 0);
    held.obj = obj; held.rim = rim; hand.geometry = gripGeo;
    ud.customArms = true;
  };
  ud.releaseCup = () => {
    const { grip, hand, relaxedGeo, fore } = armR.userData;
    if (held.obj) grip.remove(held.obj);
    held.obj = null; hand.geometry = relaxedGeo; fore.quaternion.identity();
    ud.drinkK = 0; ud.customArms = false;
  };
  /** 雙手握住一根竿（撐船的竹篙）。pR、pL：左右手握點；axis：竿的方向（皆為 upper 座標） */
  ud.holdPole = (pR, pL, axis) => {
    for (const [g, p, pole] of [[armR, pR, new V3(-1, -0.4, -0.4)], [armL, pL, new V3(1, -0.4, -0.4)]]) {
      solveArm(g, p, axis, pole, qA0, qF0);
      g.quaternion.copy(qA0); g.userData.fore.quaternion.copy(qF0);
      g.userData.hand.geometry = g.userData.gripGeo;
    }
    ud.customArms = true;
  };
  /** 飲酒動作 k：0 手自然下垂 → 1 杯在胸前 → 2 舉杯就口（頭微仰） */
  ud.drinkPose = (k) => {
    k = clamp(k, 0, 2); ud.drinkK = k; ud.customArms = true;
    const { fore } = armR.userData;
    const chest = new V3(-0.09, 1.2, 0.27), up = new V3(0, 1, 0.15).normalize();
    solveArm(armR, chest, up, new V3(-0.6, -1, -0.4), qA0, qF0);
    if (k <= 1) {
      armR.quaternion.slerpQuaternions(restA, qA0, k);
      fore.quaternion.slerpQuaternions(_q.identity(), qF0, k);
      return;
    }
    const t = k - 1, tilt = new V3(0, 0.3, -0.95).normalize();
    const open = up.clone().lerp(tilt, t).normalize();
    const rimAt = mouthUpper().add(new V3(0, -0.012, 0.03));
    const target = chest.clone().lerp(rimAt.addScaledVector(open, -held.rim), sstep(0, 1, t));
    solveArm(armR, target, open, new V3(-1, -0.7, -0.1), qA1, qF1);
    armR.quaternion.copy(qA1); fore.quaternion.copy(qF1);
  };

  ud.setPose = (pose) => {
    ud.pose = pose; ud.twist = 0;
    body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
    standLower.visible = pose !== 'sit'; sitLower.visible = pose === 'sit';
    upper.position.set(0, 0, 0); upper.rotation.set(baseStoop, 0, 0);
    armL.rotation.set(0, 0, 0.1); armR.rotation.set(0, 0, -0.1);
    armL.userData.fore.quaternion.identity(); if (!held.obj) armR.userData.fore.quaternion.identity();
    if (pose === 'sit') {
      upper.position.y = -0.7;
      upper.rotation.x = 0.05;
      armL.rotation.set(-0.75, 0, 0.15); armR.rotation.set(-0.75, 0, -0.15);
    } else if (pose === 'lie') {
      body.rotation.x = -Math.PI / 2; body.position.set(0, 0.28, 0.85);
      armL.rotation.set(0, 0, 0.3); armR.rotation.set(0, 0, -0.3);
    }
  };

  ud.update = (dt) => {
    t += dt;
    // 眨眼（上眼瞼落下）
    blinkIn -= dt;
    if (blinkIn <= 0) { blinkT = 0.15; blinkIn = 2.5 + Math.random() * 3.5; }
    if (blinkT > 0) blinkT -= dt;
    const closed = ud.pose === 'lie' && ud.eyesClosed ? 1 : blinkT > 0 ? Math.sin((blinkT / 0.15) * Math.PI) : 0;
    lids[0].rotation.x = lids[1].rotation.x = lidOpen + closed * (1.05 - (lidOpen + 0.12));
    // 說話：嘴巴開合、輕輕點頭、偶爾抬手比劃
    const talking = ud.name && E.speaker === ud.name;
    if (talking) {
      mouth.scale.y = 1 + Math.abs(Math.sin(t * 16)) * 3.2 + Math.abs(Math.sin(t * 7)) * 1.4;
      face.rotation.x = Math.sin(t * 5) * 0.035;
      face.rotation.z = Math.sin(t * 1.7) * 0.03;
    } else {
      mouth.scale.y += (1 - mouth.scale.y) * Math.min(1, dt * 10);
      face.rotation.x *= 1 - Math.min(1, dt * 5);
      face.rotation.z *= 1 - Math.min(1, dt * 5);
    }
    // 舉杯時頭微仰
    if (ud.drinkK > 1) face.rotation.x = -0.28 * sstep(1.3, 2, ud.drinkK);
    // 舉起前臂時，廣袖滑向手肘
    for (const A of [armL, armR]) {
      const { fore, sleeveLow } = A.userData;
      fore.getWorldQuaternion(_q); _w.copy(DOWN).applyQuaternion(_q);
      const w = robeOutfit ? sstep(-0.3, 0.8, _w.y) : 0;
      sleeveLow.position.y = w * 0.08; sleeveLow.scale.y = 1 - w * 0.35;
      // 袖袋受重力下垂：把袖子的「下方」部分轉向地面
      if (w > 0) {
        _v.set(0, -1, 0).applyQuaternion(_q.invert());          // 世界向下在前臂座標中的方向
        _q2.setFromUnitVectors(DOWN, _v);
        sleeveLow.quaternion.identity().slerp(_q2, 0.45 * w);
      } else sleeveLow.quaternion.identity();
    }
    // 軟腳、頭巾隨風
    ribbons.forEach((rb, i) => { rb.rotation.x = (o.cap === 'futou' ? 0.35 : 0.3) + Math.sin(t * 1.7 + i) * 0.08 + Math.sin(t * 3.1) * 0.03; });
    // 呼吸
    torso.scale.x = torso.scale.z = 1 + Math.sin(t * 1.6) * 0.008;
    const ease = (cur, want, sp = 4) => cur + (want - cur) * Math.min(1, dt * sp);
    if (ud.walking) {
      ud.walkT += dt * 7;
      const sw = Math.sin(ud.walkT);
      armL.rotation.x = sw * 0.4; armR.rotation.x = -sw * 0.4;
      armL.rotation.z = ease(armL.rotation.z, 0.1); armR.rotation.z = ease(armR.rotation.z, -0.1);
      legs.forEach((lg, i) => { lg.rotation.x = (i ? -sw : sw) * legAmp; });
      body.position.y = Math.abs(sw) * 0.03;
      standLower.rotation.z = sw * 0.02;
    } else {
      legs.forEach(lg => { lg.rotation.x *= 0.85; });
      // 站着時重心左右輕移，不會像木頭一樣
      standLower.rotation.z = Math.sin(t * 0.45) * 0.012;
      if (ud.pose === 'stand') {
        body.rotation.z = Math.sin(t * 0.45) * 0.012;
        upper.rotation.z = -Math.sin(t * 0.45) * 0.01;
      }
      if (ud.pose === 'stand' && !ud.customArms) {
        // 僕役雙手交握於身前；說話時右手比劃
        let lx = -0.06, lz = 0.1, rx = -0.06, rz = -0.1;
        if (o.clasp) { lx = -0.55; lz = -0.3; rx = -0.55; rz = 0.3; }
        if (talking) { rx = -0.75 + Math.sin(t * 2.3) * 0.25; rz = o.clasp ? 0.1 : -0.15; }
        armL.rotation.x = ease(armL.rotation.x, lx); armL.rotation.z = ease(armL.rotation.z, lz);
        armR.rotation.x = ease(armR.rotation.x, rx); armR.rotation.z = ease(armR.rotation.z, rz);
        body.position.y = Math.sin(t * 1.6) * 0.003;
      }
    }
    // 沒有注視目標時，偶爾轉頭看看四周
    if (!ud.watchCamera && !ud.lookTarget) {
      glanceIn -= dt;
      if (glanceIn <= 0) { glance = (Math.random() - 0.5) * 1.0; glanceIn = 3 + Math.random() * 4; }
      face.rotation.y = ease(face.rotation.y, glance, 1.5);
    } else face.rotation.y = ease(face.rotation.y, 0, 3);
    if (ud.extraUpdate) ud.extraUpdate(dt);
  };
  return root;
}
