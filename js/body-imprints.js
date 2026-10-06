// 草地上兩個人形壓痕，頭挨着頭（「醉則更相枕以臥」）。
// 由三部分組成，合共只有三次繪製：
//   1. 貼地的壓痕圖：人形範圍內是被壓平、顏色較淡的草，邊緣有一圈陰影；
//   2. 人形內被壓倒的草葉：順着身體方向（由頭向腳）平躺在地上；
//   3. 人形四周仍然直立的草：邊緣最密、向外漸疏，令壓下去的人形凹痕看得出來。
import * as THREE from '../lib/three.module.js';

function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// 身體各部分（身體座標：s 由頭頂沿身體向腳，t 為左右；單位：米）
const PARTS = [
  // [s0, t0, s1, t1, r0, r1]
  [0.13, 0, 0.14, 0, 0.12, 0.12],              // 頭
  [0.24, 0, 0.33, 0, 0.055, 0.06],             // 頸
  [0.40, 0, 0.88, 0, 0.2, 0.155],              // 軀幹（肩寬、腰窄）
  [0.42, 0.22, 0.95, 0.33, 0.06, 0.048],       // 手臂：由肩膀斜斜垂下，與身體之間漸漸留出一道縫
  [0.42, -0.22, 0.95, -0.33, 0.06, 0.048],
  [0.90, 0.085, 1.70, 0.15, 0.085, 0.058],     // 腿（兩腿之間留縫）
  [0.90, -0.085, 1.70, -0.15, 0.085, 0.058],
];
function capsule(s, t, [s0, t0, s1, t1, r0, r1]) {
  const ds = s1 - s0, dt = t1 - t0, L = ds * ds + dt * dt;
  const k = L ? Math.max(0, Math.min(1, ((s - s0) * ds + (t - t0) * dt) / L)) : 0;
  return Math.hypot(s - (s0 + k * ds), t - (t0 + k * dt)) - (r0 + k * (r1 - r0));
}
const bodyDist = (s, t) => Math.min(...PARTS.map(p => capsule(s, t, p)));
const smooth = (a, b, v) => { const x = Math.max(0, Math.min(1, (v - a) / (b - a))); return x * x * (3 - 2 * x); };

/**
 * @param heightAt (x, z) → 地面高度（世界座標）
 * @param cx, cz 兩個頭相接之處
 * @param yaw 整組壓痕的方向
 */
export function makeBodyImprints(heightAt, cx, cz, { yaw = 0.4, seed = 5 } = {}) {
  const r = rng(seed);
  // 兩個人頭挨着頭，身體向兩邊伸出，略成淺 V 字；頭部稍為錯開，像互相枕着
  const bodies = [
    { ang: yaw + 0.5, off: [0.03, 0.1] },
    { ang: yaw + Math.PI - 0.5, off: [-0.03, 0.1] },
  ].map(b => ({ ...b, ux: Math.cos(b.ang), uz: Math.sin(b.ang) }));
  // 組合座標 (x, z) → 身體座標 (s, t)
  const toBody = (b, x, z) => {
    const px = x - b.off[0], pz = z - b.off[1];
    return [px * b.ux + pz * b.uz, -px * b.uz + pz * b.ux];
  };
  const dist = (x, z) => {
    let best = Infinity, which = 0;
    bodies.forEach((b, i) => { const [s, t] = toBody(b, x, z); const d = bodyDist(s, t); if (d < best) { best = d; which = i; } });
    return [best, which];
  };
  const h0 = heightAt(cx, cz);
  const groundY = (x, z) => heightAt(cx + x, cz + z) - h0;
  const group = new THREE.Group();
  group.position.set(cx, h0, cz);

  // ---------- 1. 貼地的壓痕圖 ----------
  const W = 4.4, D = 4.4, PX = 512;        // 範圍 4.4 × 4.4 米，每像素約 8.6 毫米
  const cv = document.createElement('canvas'); cv.width = cv.height = PX;
  const g = cv.getContext('2d'); const img = g.createImageData(PX, PX);
  const flat = [186, 186, 116], flat2 = [160, 168, 96], shade = [82, 100, 46];
  for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
    const x = (i + 0.5) / PX * W - W / 2, z = (j + 0.5) / PX * D - D / 2;
    const [d, w] = dist(x, z);
    const o = (j * PX + i) * 4;
    if (d > 0.07) { img.data[o + 3] = 0; continue; }
    // 被壓平的草：沿身體方向的細紋（左右方向變化快、前後方向變化慢）
    const b = bodies[w]; const [s, t] = toBody(b, x, z);
    const streak = 0.5 + 0.5 * Math.sin(t * 160 + Math.sin(s * 9 + t * 40) * 2.2) * Math.sin(t * 67 + 1.3);
    const c = flat.map((v, k) => v + (flat2[k] - v) * streak);
    // 邊緣：壓痕內側近邊處較暗（四周直立的草投下陰影），外側一圈被踩亂的深色草
    const edge = smooth(-0.06, 0.0, d);
    const m = d < 0 ? edge * 0.6 : 1;
    for (let k = 0; k < 3; k++) img.data[o + k] = c[k] + (shade[k] - c[k]) * m;
    img.data[o + 3] = 255 * (d < 0 ? 1 : 0.7 * (1 - smooth(0.0, 0.07, d)));
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const geo = new THREE.PlaneGeometry(W, D, 44, 44); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundY(pos.getX(i), pos.getZ(i)) + 0.025);
  geo.computeVertexNormals();
  const decal = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  decal.renderOrder = 1;
  group.add(decal);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();

  // ---------- 2. 人形內被壓倒的草葉 ----------
  // 葉片沿 +Z 伸出、平放在地上，順着身體方向由頭向腳倒下
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([0.012, 0, 0, -0.012, 0, 0, 0, 0.004, 1], 3));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const flatPts = [];
  for (let tries = 0; flatPts.length < 520 && tries < 20000; tries++) {
    const x = (r() - 0.5) * W, z = (r() - 0.5) * D;
    const [d, w] = dist(x, z);
    if (d < -0.025) flatPts.push([x, z, w]);
  }
  const flatMesh = new THREE.InstancedMesh(blade, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), flatPts.length);
  flatPts.forEach(([x, z, w], i) => {
    const b = bodies[w];
    const jit = (r() - 0.5) * 0.5, yawB = Math.atan2(b.ux, b.uz) + jit;     // 葉尖指向腳的方向
    e.set(-0.06 - r() * 0.08, yawB, 0, 'YXZ'); q.setFromEuler(e);
    // 葉片整條都要在人形之內，不伸出邊界
    let len = 0.14 + r() * 0.2;
    const dx = Math.sin(yawB), dz = Math.cos(yawB);
    while (len > 0.06 && (dist(x + dx * len * 0.6, z + dz * len * 0.6)[0] > -0.01 || dist(x - dx * len * 0.4, z - dz * len * 0.4)[0] > -0.01)) len *= 0.8;
    sc.set(1, 1, len); p.set(x - dx * len * 0.4, groundY(x, z) + 0.03, z - dz * len * 0.4);
    m4.compose(p, q, sc); flatMesh.setMatrixAt(i, m4);
    flatMesh.setColorAt(i, col.set(['#d2c98a', '#c2bf7c', '#dcd296', '#b8b974'][Math.floor(r() * 4)]));
  });
  group.add(flatMesh);

  // ---------- 3. 人形四周仍然直立的草 ----------
  const tuft = new THREE.ConeGeometry(0.028, 1, 3); tuft.translate(0, 0.5, 0);
  const upPts = [];
  for (let tries = 0; upPts.length < 360 && tries < 40000; tries++) {
    const x = (r() - 0.5) * W, z = (r() - 0.5) * D;
    const [d] = dist(x, z);
    if (d < 0.015 || d > 0.6) continue;
    if (r() > 1.1 - smooth(0.015, 0.45, d) * 0.95) continue;   // 緊貼人形邊緣最密，向外漸疏
    upPts.push([x, z, d]);
  }
  const upMesh = new THREE.InstancedMesh(tuft, new THREE.MeshLambertMaterial({ flatShading: true }), upPts.length);
  const gx = new THREE.Vector3(), tilt = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), spin = new THREE.Quaternion();
  upPts.forEach(([x, z, d], i) => {
    // 向外（離開人形）微微傾側，像被身體擠開
    const ex = 0.01, gxv = dist(x + ex, z)[0] - dist(x - ex, z)[0], gzv = dist(x, z + ex)[0] - dist(x, z - ex)[0];
    gx.set(gxv, 0, gzv).normalize();
    const lean = (1 - smooth(0.02, 0.3, d)) * 0.35 + r() * 0.12;
    // 先繞直軸隨意轉，再向外傾側（傾側方向不受自轉影響）
    q.setFromAxisAngle(tilt.set(gx.z, 0, -gx.x).normalize(), lean).multiply(spin.setFromAxisAngle(Y, r() * 6.28));
    const h = 0.07 + r() * 0.12 + smooth(0.05, 0.5, d) * 0.12;   // 矮草：站着望過去仍看得見凹下的人形
    sc.set(1, h, 1); p.set(x, groundY(x, z) - 0.01, z);
    m4.compose(p, q, sc); upMesh.setMatrixAt(i, m4);
    upMesh.setColorAt(i, col.set(['#7d9446', '#8a9c4f', '#728a40', '#94a35a'][Math.floor(r() * 4)]));
  });
  group.add(upMesh);
  return group;
}
