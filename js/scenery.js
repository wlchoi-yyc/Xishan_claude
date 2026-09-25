// 山水點景：雲、霧、草地、石峰、斷崖台地
import { THREE } from './engine.js';
import { rng, noise2, mergeColored, mat, vcMat, smoothstep } from './world.js';

// ---------------- 貼圖 ----------------
let _cloudTex = null, _mistTex = null;
function cloudTexture() {
  if (_cloudTex) return _cloudTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const r = rng(5);
  // 多個柔和圓團疊成一朵雲，底部較平
  for (let i = 0; i < 26; i++) {
    const x = 40 + r() * 176, y = 58 + (r() - 0.6) * 40 * Math.sin((x - 40) / 176 * Math.PI), rad = 18 + r() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  const fade = g.createLinearGradient(0, 70, 0, 128);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = fade; g.fillRect(0, 70, 256, 58);
  _cloudTex = new THREE.CanvasTexture(c); _cloudTex.colorSpace = THREE.SRGBColorSpace;
  return _cloudTex;
}
function mistTexture() {
  if (_mistTex) return _mistTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.8)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  _mistTex = new THREE.CanvasTexture(c); _mistTex.colorSpace = THREE.SRGBColorSpace;
  return _mistTex;
}

// ---------------- 雲 ----------------
/** 柔和的雲（Sprite）。回傳 group；group.userData.material 可改色；會慢慢飄動 */
export function makeClouds({ count = 30, rMin = 800, rMax = 2400, yMin = 250, yMax = 500, size = [260, 520], seed = 1, color = '#ffffff', opacity = 0.9, center = [0, 0] } = {}) {
  const r = rng(seed);
  const group = new THREE.Group();
  const material = new THREE.SpriteMaterial({ map: cloudTexture(), color, transparent: true, opacity, depthWrite: false, fog: false });
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = rMin + r() * (rMax - rMin);
    const s = size[0] + r() * (size[1] - size[0]);
    const sp = new THREE.Sprite(material);
    sp.position.set(center[0] + Math.cos(a) * d, yMin + r() * (yMax - yMin), center[1] + Math.sin(a) * d);
    sp.scale.set(s, s * (0.4 + r() * 0.15), 1);
    group.add(sp);
  }
  group.userData.material = material;
  group.userData.animate = (t) => { group.rotation.y = t * 0.0015; };
  return group;
}

// ---------------- 霧 ----------------
/** 貼地的水平霧片：從高處望下去像雲海，從低處看則是山谷裏的輕霧 */
export function makeMist({ count = 20, center = [0, 0], rMin = 0, rMax = 300, y = 0, yJitter = 0, size = [80, 160], seed = 2, color = '#ffffff', opacity = 0.35, heightAt = null, lift = 0 } = {}) {
  const r = rng(seed);
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ map: mistTexture(), color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const items = [];
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = rMin + Math.sqrt(r()) * (rMax - rMin);
    const x = center[0] + Math.cos(a) * d, z = center[1] + Math.sin(a) * d;
    const m = new THREE.Mesh(geo, material);
    const s = size[0] + r() * (size[1] - size[0]);
    m.scale.set(s, 1, s * (0.5 + r() * 0.5));
    m.rotation.y = r() * Math.PI;
    m.position.set(x, (heightAt ? heightAt(x, z) + lift : y) + (r() - 0.5) * yJitter, z);
    m.renderOrder = 2;
    group.add(m); items.push({ m, x, z, ph: r() * 6 });
  }
  group.userData.material = material;
  group.userData.animate = (t) => { for (const it of items) { it.m.position.x = it.x + Math.sin(t * 0.05 + it.ph) * 6; it.m.position.z = it.z + Math.cos(t * 0.04 + it.ph) * 4; } };
  return group;
}

// ---------------- 草地 ----------------
let _grassGeo = null;
function grassGeo() {
  if (_grassGeo) return _grassGeo;
  const r = rng(3), parts = [];
  for (let i = 0; i < 7; i++) {
    const a = r() * 6.28, d = r() * 0.18, h = 0.35 + r() * 0.35;
    parts.push({ geo: new THREE.ConeGeometry(0.035, h, 3), color: i % 3 ? '#7f914b' : '#95a257', matrix: mat(Math.cos(a) * d, h / 2, Math.sin(a) * d, (r() - .5) * 0.6, r() * 3, (r() - .5) * 0.6) });
  }
  _grassGeo = mergeColored(parts);
  return _grassGeo;
}
/** 大片草叢（InstancedMesh）。accept(x,z) 回傳 false 則跳過 */
export function makeGrassField({ count = 1500, area, heightAt, accept = () => true, seed = 9, palette = ['#ffffff', '#e8e2b0', '#cfd8a8', '#f0d7a0'], scale = [0.45, 0.95] }) {
  const r = rng(seed);
  const pts = [];
  let tries = 0;
  while (pts.length < count && tries < count * 8) {
    tries++;
    const x = area.x0 + r() * (area.x1 - area.x0), z = area.z0 + r() * (area.z1 - area.z0);
    // 聚成一叢叢
    if (noise2(x * 0.08, z * 0.08, 71) < -0.15) continue;
    if (!accept(x, z)) continue;
    pts.push([x, z]);
  }
  const mesh = new THREE.InstancedMesh(grassGeo(), vcMat(), pts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  pts.forEach(([x, z], i) => {
    const k = scale[0] + r() * (scale[1] - scale[0]);
    q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0)); s.set(k, k * (0.8 + r() * 0.5), k); p.set(x, heightAt(x, z) - 0.02, z);
    m4.compose(p, q, s); mesh.setMatrixAt(i, m4);
    c.set(palette[Math.floor(r() * palette.length)]); mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// ---------------- 石峰 ----------------
/** 喀斯特石峰：瘦長、有稜角、頂上長着一點綠 */
export function makePinnacle(height = 40, seed = 1, { width = 0.28, rock = '#a79d88', moss = '#56703f' } = {}) {
  const r = rng(seed);
  const rad = height * width;
  const geo = new THREE.CylinderGeometry(rad * 0.25, rad, height, 8, 10);
  const pos = geo.attributes.position;
  const lean = (r() - 0.5) * 0.25, lean2 = (r() - 0.5) * 0.25;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = (y / height) + 0.5;
    const n = 0.75 + 0.5 * (noise2(x * 0.6 + seed, y * 0.35, seed) * 0.5 + 0.5);
    // 腰部收窄，頂部略膨大，像石筍
    const waist = 1 - Math.sin(k * Math.PI) * 0.18 + (k > 0.8 ? (k - 0.8) * 0.8 : 0);
    pos.setXYZ(i, x * n * waist + lean * k * height, y, z * n * waist + lean2 * k * height);
  }
  let g = geo.toNonIndexed(); g.computeVertexNormals();
  const p = g.attributes.position, nrm = g.attributes.normal;
  const cols = new Float32Array(p.count * 3), c = new THREE.Color(), cr = new THREE.Color(rock), cm = new THREE.Color(moss), dark = new THREE.Color(rock).multiplyScalar(0.72);
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 / height + 0.5;
    const up = nrm.getY(i);
    c.copy(cr).lerp(dark, 0.35 * (1 - y) + (noise2(i * 0.37, y * 7, seed) * 0.5 + 0.5) * 0.3);
    if (up > 0.45 || y > 0.9) c.lerp(cm, 0.8);
    for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = c.r; cols[(i + k) * 3 + 1] = c.g; cols[(i + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(g, vcMat());
  m.geometry.translate(0, height / 2, 0);
  return m;
}

// ---------------- 斷崖台地 ----------------
/** 把高度變成一級級台地，出現陡直的岩壁（西山的「怪特」） */
export function terrace(h, step = 20, amount = 0.6) {
  const t = h / step, f = Math.floor(t), fr = t - f;
  const stepped = (f + smoothstep(0.3, 0.7, fr)) * step;
  return h + (stepped - h) * amount;
}
