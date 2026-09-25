// 世界建構工具：地形、樹木、石頭、水、天空、人物、器物
import { THREE, E } from './engine.js';

// ---------------- 亂數與雜訊 ----------------
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed + 7, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(x, y, oct = 4, seed = 0) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += amp * noise2(x * f, y * f, seed + i * 13); n += amp; amp *= 0.5; f *= 2.03; }
  return s / n;
}
export function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
export const col = (hex) => new THREE.Color(hex);

// ---------------- 幾何合併 ----------------
export function mergeColored(parts) {
  // parts: [{geo, color, matrix?}] -> 單一 BufferGeometry（含頂點顏色）
  let total = 0;
  const prepared = parts.map(p => {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    g.computeVertexNormals();
    total += g.attributes.position.count;
    return { g, color: new THREE.Color(p.color) };
  });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), colr = new Float32Array(total * 3);
  let o = 0;
  for (const { g, color } of prepared) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < n; i++) { colr[(o + i) * 3] = color.r; colr[(o + i) * 3 + 1] = color.g; colr[(o + i) * 3 + 2] = color.b; }
    o += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  return geo;
}
const M = () => new THREE.Matrix4();
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const m = M();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
}
export const vcMat = (opts = {}) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true, flatShading: true }, opts));
export const lam = (color, opts = {}) => new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, opts));

// ---------------- 天空 ----------------
export function makeSky(scene, { top = '#6f9fc8', horizon = '#dfe6e3', bottom, sunDir = [0.3, 0.4, -1], sunColor = '#fff2d0', sunSize = 0.03, radius = 4000 } = {}) {
  const uniforms = {
    top: { value: col(top) }, horizon: { value: col(horizon) }, bottom: { value: col(bottom || horizon) },
    sunDir: { value: new THREE.Vector3(...sunDir).normalize() }, sunColor: { value: col(sunColor) },
    sunSize: { value: sunSize }, sunStrength: { value: 1 }, dark: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize; uniform float sunStrength; uniform float dark;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.8)) : mix(horizon, bottom, smoothstep(0.0, -0.2, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * (pow(s, 12.0) * 0.35 + pow(s, 200.0) * 0.6) * sunStrength;
        c += sunColor * smoothstep(1.0 - sunSize * 0.05, 1.0 - sunSize * 0.04, s) * sunStrength;
        c = mix(c, vec3(0.015, 0.02, 0.04), dark);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  scene.add(mesh);
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); };
  return { mesh, uniforms };
}

// ---------------- 地形 ----------------
export function makeTerrain({ size = 200, seg = 100, sizeZ, segZ, cx = 0, cz = 0, heightAt, colorAt }) {
  let geo = new THREE.PlaneGeometry(size, sizeZ ?? size, seg, segZ ?? seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
    pos.setXYZ(i, x, heightAt(x, z), z);
  }
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const slope = 1 - n.getY(i);
    c.set(colorAt(y, slope, x, z));
    for (let k = 0; k < 3; k++) { colors[(i + k) * 3] = c.r; colors[(i + k) * 3 + 1] = c.g; colors[(i + k) * 3 + 2] = c.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, vcMat());
  return mesh;
}
// 用於地形上色的混合
export function mixHex(a, b, k) { return new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, k))); }

// ---------------- 水 ----------------
export function makeWater(w, h, { color = '#6f9fb0', opacity = 0.85, y = 0 } = {}) {
  const geo = new THREE.PlaneGeometry(w, h, Math.max(1, Math.round(w / 6)), Math.max(1, Math.round(h / 6)));
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.MeshPhongMaterial({ color, transparent: opacity < 1, opacity, shininess: 80, specular: 0x99aabb, flatShading: true });
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.y = y;
  const base = geo.attributes.position.array.slice();
  mesh.userData.animate = (t) => {
    const a = geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) a[i + 1] = base[i + 1] + Math.sin(base[i] * 0.3 + t * 1.3) * 0.05 + Math.cos(base[i + 2] * 0.25 + t) * 0.05;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return mesh;
}
// 沿路徑的溪流帶
export function makeRibbon(points, width, heightFn, { color = '#8fb8c4', opacity = 0.9, lift = 0.05, seg = 1 } = {}) {
  const verts = [], idx = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(points.length - 1, i + 1)], r = points[Math.max(0, i - 1)];
    let dx = q.x - r.x, dz = q.z - r.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx;
    const w = typeof width === 'function' ? width(i / (points.length - 1)) : width;
    for (let s = 0; s <= seg; s++) {
      const k = s / seg - 0.5;
      const x = p.x + nx * w * k, z = p.z + nz * w * k;
      verts.push(x, (p.y ?? heightFn(x, z)) + lift, z);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < points.length - 1; i++) for (let s = 0; s < seg; s++) {
    const a = i * row + s, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.MeshPhongMaterial({ color, transparent: opacity < 1, opacity, shininess: 90, specular: 0xaabbcc, side: THREE.DoubleSide, flatShading: true });
  return new THREE.Mesh(geo, m);
}

// ---------------- 樹 ----------------
const treeGeoCache = {};
function treeGeometry(type) {
  if (treeGeoCache[type]) return treeGeoCache[type];
  let g;
  if (type === 'pine') {
    g = mergeColored([
      { geo: new THREE.CylinderGeometry(0.12, 0.2, 2.2, 5), color: '#5a4332', matrix: mat(0, 1.1, 0) },
      { geo: new THREE.ConeGeometry(1.5, 2.6, 7), color: '#2f5a3e', matrix: mat(0, 2.6, 0) },
      { geo: new THREE.ConeGeometry(1.15, 2.2, 7), color: '#356546', matrix: mat(0, 3.7, 0) },
      { geo: new THREE.ConeGeometry(0.75, 1.8, 7), color: '#3b6f4c', matrix: mat(0, 4.7, 0) },
    ]);
  } else if (type === 'broad') {
    g = mergeColored([
      { geo: new THREE.CylinderGeometry(0.14, 0.24, 2.4, 5), color: '#5e4636', matrix: mat(0, 1.2, 0) },
      { geo: new THREE.IcosahedronGeometry(1.6, 0), color: '#4f7a45', matrix: mat(0, 3.2, 0, 0, 0, 0, 1, 0.85, 1) },
      { geo: new THREE.IcosahedronGeometry(1.1, 0), color: '#5d8a4f', matrix: mat(0.7, 3.8, 0.3) },
      { geo: new THREE.IcosahedronGeometry(1.0, 0), color: '#476f3e', matrix: mat(-0.6, 3.6, -0.4) },
    ]);
  } else if (type === 'bamboo') {
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2, r = 0.35;
      parts.push({ geo: new THREE.CylinderGeometry(0.05, 0.06, 5, 5), color: '#7b9a52', matrix: mat(Math.cos(a) * r, 2.5, Math.sin(a) * r, Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08) });
    }
    parts.push({ geo: new THREE.IcosahedronGeometry(1.2, 0), color: '#6d9147', matrix: mat(0, 4.8, 0, 0, 0, 0, 1, 1.4, 1) });
    g = mergeColored(parts);
  } else if (type === 'maple') {
    g = mergeColored([
      { geo: new THREE.CylinderGeometry(0.12, 0.22, 2.2, 5), color: '#5a3f30', matrix: mat(0, 1.1, 0) },
      { geo: new THREE.IcosahedronGeometry(1.5, 0), color: '#b8633a', matrix: mat(0, 3.0, 0, 0, 0, 0, 1, 0.8, 1) },
      { geo: new THREE.IcosahedronGeometry(1.0, 0), color: '#c9803f', matrix: mat(0.6, 3.6, 0.2) },
    ]);
  } else if (type === 'bush') {
    g = mergeColored([
      { geo: new THREE.IcosahedronGeometry(0.9, 0), color: '#4c6e3c', matrix: mat(0, 0.5, 0, 0, 0, 0, 1.2, 0.8, 1) },
      { geo: new THREE.IcosahedronGeometry(0.7, 0), color: '#5b7e43', matrix: mat(0.6, 0.6, 0.2) },
    ]);
  }
  treeGeoCache[type] = g;
  return g;
}
/** 散佈樹木：items [{x,z,s,rot,type}] */
export function makeTrees(items, heightAt, { tint = true } = {}) {
  const group = new THREE.Group();
  const byType = {};
  for (const it of items) (byType[it.type] = byType[it.type] || []).push(it);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const c = new THREE.Color();
  for (const type in byType) {
    const list = byType[type];
    const mesh = new THREE.InstancedMesh(treeGeometry(type), vcMat(), list.length);
    list.forEach((it, i) => {
      q.setFromEuler(new THREE.Euler(0, it.rot ?? 0, 0));
      s.set(it.s, it.s * (it.sy ?? 1), it.s);
      p.set(it.x, heightAt(it.x, it.z) - 0.1, it.z);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
      if (tint) { const v = 0.85 + ((i * 9301 + 49297) % 233280) / 233280 * 0.3; c.setRGB(v, v, v); mesh.setColorAt(i, c); }
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}
export function scatter(count, seed, accept, area) {
  const r = rng(seed);
  const out = [];
  let tries = 0;
  while (out.length < count && tries < count * 30) {
    tries++;
    const x = area.x0 + r() * (area.x1 - area.x0), z = area.z0 + r() * (area.z1 - area.z0);
    const res = accept(x, z, r);
    if (res) out.push(Object.assign({ x, z, s: 0.8 + r() * 0.6, rot: r() * 6.28 }, res === true ? {} : res));
  }
  return out;
}

// ---------------- 石頭 ----------------
export function makeRock(size = 1, color = '#8a867b', seed = 1, detail = 0) {
  const g = new THREE.DodecahedronGeometry(size, detail);
  const r = rng(seed);
  const pos = g.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, 0.75 + r() * 0.5);
    const k = map.get(key);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, lam(color));
}

// ---------------- 草 ----------------
export function makeGrassPatch(n = 12, radius = 0.8, { color = '#8c9a55', height = 0.7, seed = 3, pressed = false } = {}) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
    const h = height * (0.6 + r() * 0.6);
    const tilt = pressed ? 1.35 + r() * 0.2 : (r() - .5) * 0.5;
    const ry = pressed ? 0.5 : r() * 6;
    parts.push({ geo: new THREE.ConeGeometry(0.06, h, 3), color: new THREE.Color(color).offsetHSL((r() - .5) * 0.04, 0, (r() - .5) * 0.1), matrix: mat(Math.cos(a) * d, pressed ? 0.05 : h / 2, Math.sin(a) * d, tilt, ry, (r() - .5) * 0.3) });
  }
  return new THREE.Mesh(mergeColored(parts), vcMat());
}

// ---------------- 文字貼圖 ----------------
export function textCanvas(lines, { w = 512, h = 512, bg = '#efe3c8', color = '#2a2018', font = '"LXGW WenKai TC","Noto Serif TC",serif', size = 40, vertical = false, lineGap = 1.6, draw } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  // 紙張紋理
  if (bg) {
    const r = rng(9);
    g.globalAlpha = 0.06;
    for (let i = 0; i < 400; i++) { g.fillStyle = r() > .5 ? '#000' : '#fff'; g.fillRect(r() * w, r() * h, 2, 2); }
    g.globalAlpha = 1;
  }
  if (draw) draw(g, w, h);
  g.fillStyle = color; g.font = `${size}px ${font}`; g.textBaseline = 'top';
  if (vertical) {
    let x = w - size * 1.4;
    for (const line of lines) {
      let y = size * 0.8;
      for (const ch of line) { g.fillText(ch, x, y); y += size * 1.1; }
      x -= size * lineGap;
    }
  } else {
    let y = size * 0.8;
    for (const line of lines) { g.fillText(line, size * 0.7, y); y += size * lineGap; }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------- 人物 ----------------
export { makePerson } from './people.js';

// ---------------- 器物 ----------------
export function makeWinePot(color = '#6f7f6a') {
  const pts = [];
  const prof = [[0, 0], [0.07, 0.0], [0.1, 0.04], [0.11, 0.1], [0.08, 0.17], [0.05, 0.2], [0.075, 0.26], [0.07, 0.31], [0.03, 0.35], [0.028, 0.4], [0.035, 0.42]];
  for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 10);
  const m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color, shininess: 60, flatShading: true }));
  const grp = new THREE.Group(); grp.add(m);
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 4, 10), lam('#8b3a2a')); cord.rotation.x = Math.PI / 2; cord.position.y = 0.2; grp.add(cord);
  return grp;
}
export function makeCup() {
  const pts = [[0, 0], [0.025, 0], [0.03, 0.01], [0.045, 0.045], [0.04, 0.05]].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 10), new THREE.MeshPhongMaterial({ color: '#d9d2c0', shininess: 40, side: THREE.DoubleSide }));
}
export function makeStrawHat() {
  const g = new THREE.Group();
  const h = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.16, 14, 1, true), new THREE.MeshLambertMaterial({ color: '#c9a765', side: THREE.DoubleSide, flatShading: true }));
  h.position.y = 0.08; g.add(h);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.01, 4, 20), lam('#9f8045')); ring.rotation.x = Math.PI / 2; g.add(ring);
  return g;
}
export function makeMat(color = '#c2a468') {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 1.6), lam(color));
  base.position.y = 0.015; g.add(base);
  for (let i = -3; i <= 3; i++) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.02), lam('#a88a50'));
    l.position.set(0, 0.02, i * 0.22); g.add(l);
  }
  return g;
}
export function makeFootprints(points, heightAt, { color = '#3e3226', opacity = 0.55, size = 1 } = {}) {
  const grp = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const g = new THREE.CircleGeometry(0.1 * size, 8); g.scale(1, 1.9, 1); g.rotateX(-Math.PI / 2);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(points.length - 1, i + 1)], r = points[Math.max(0, i - 1)];
    const ang = Math.atan2(q.x - r.x, q.z - r.z);
    const side = i % 2 ? 1 : -1;
    const f = new THREE.Mesh(g, m);
    const ox = Math.cos(ang) * 0.13 * side, oz = -Math.sin(ang) * 0.13 * side;
    f.position.set(p.x + ox, heightAt(p.x + ox, p.z + oz) + 0.03, p.z + oz);
    f.rotation.y = ang;
    grp.add(f);
  }
  return grp;
}
export function pathPoints(pts, step = 0.7) {
  // 由折線生成等距點
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.floor(L / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  out.push(pts[pts.length - 1]);
  return out;
}
export function makeStaff() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.5, 6), lam('#a8a25a'));
  s.position.y = 0.75; g.add(s);
  for (let i = 1; i < 5; i++) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 6), lam('#7f7a3e'));
    n.position.y = i * 0.3; g.add(n);
  }
  return g;
}

// 亭子
export function makePavilion({ pillar = '#7b2e22', roof = '#3a3a38', floor = '#9b8f7c' } = {}) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.7, 0.5, 6), lam(floor)); base.position.y = 0.25; g.add(base);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 2.8, z = Math.sin(a) * 2.8;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 3, 8), lam(pillar)); p.position.set(x, 2, z); g.add(p);
    pts.push({ x, z, a });
  }
  // 欄杆座椅（美人靠）
  for (let i = 0; i < 6; i++) {
    if (i === 4) continue; // 入口
    const a = pts[i], b = pts[(i + 1) % 6];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(L, 0.08, 0.45), lam('#6a3a28'));
    bench.position.set(mx * 0.93, 0.95, mz * 0.93);
    bench.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    g.add(bench);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.06, 0.06), lam('#6a3a28'));
    rail.position.set(mx, 1.45, mz); rail.rotation.y = bench.rotation.y; g.add(rail);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.3, 6, 1, true), lam('#6a2a20', { side: THREE.DoubleSide })); beam.position.y = 3.55; beam.rotation.y = Math.PI / 6; g.add(beam);
  // 屋頂：翹角六角攢尖
  const roofGeo = new THREE.ConeGeometry(4.3, 2.4, 6, 3, true);
  const rp = roofGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
    const r = Math.hypot(x, z);
    const t = 1 - (y + 1.2) / 2.4;
    const ang = Math.atan2(z, x) - Math.PI / 6;
    const corner = Math.pow(Math.abs(Math.cos(ang * 3)), 6);
    const sag = -Math.sin(t * Math.PI) * 0.45;
    rp.setY(i, y + sag + corner * t * t * 0.9);
    const k = 1 + corner * t * 0.1;
    rp.setX(i, x * k); rp.setZ(i, z * k);
  }
  roofGeo.computeVertexNormals();
  const roofM = new THREE.Mesh(roofGeo, lam(roof, { side: THREE.DoubleSide })); roofM.position.y = 4.8; roofM.rotation.y = Math.PI / 6; g.add(roofM);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lam('#5a4a2a')); knob.position.y = 6.1; g.add(knob);
  return g;
}

export function makeHouse({ w = 5, d = 4, h = 2.6, wall = '#cfc6b4', roof = '#3d3f42' } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(wall)); body.position.y = h / 2; g.add(body);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.5, 0); shape.quadraticCurveTo(-w / 4, 0.3, 0, 1.6); shape.quadraticCurveTo(w / 4, 0.3, w / 2 + 0.5, 0); shape.lineTo(-w / 2 - 0.5, 0);
  const rg = new THREE.ExtrudeGeometry(shape, { depth: d + 0.8, bevelEnabled: false, curveSegments: 4 });
  const r = new THREE.Mesh(rg, lam(roof)); r.position.set(0, h, -d / 2 - 0.4); g.add(r);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.05), lam('#4a3526')); door.position.set(0, 0.85, d / 2 + 0.01); g.add(door);
  return g;
}

export function makeBoat() {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-3, 0.5); shape.quadraticCurveTo(-2.4, -0.1, -1.5, -0.2); shape.lineTo(1.5, -0.2); shape.quadraticCurveTo(2.4, -0.1, 3, 0.5); shape.lineTo(-3, 0.5);
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false }), lam('#6b4a32'));
  hull.position.z = -0.75; g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.06, 1.4), lam('#8a6a48')); deck.position.y = 0.3; g.add(deck);
  // 篷
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 10, 1, true, 0, Math.PI), lam('#5b4a30', { side: THREE.DoubleSide }));
  cover.rotation.z = Math.PI / 2; cover.rotation.y = 0; cover.position.set(0.9, 0.3, 0); cover.rotation.x = Math.PI / 2;
  cover.rotation.set(0, 0, Math.PI / 2);
  g.add(cover);
  return g;
}

// 火焰粒子
export function makeFire(scale = 1) {
  const g = new THREE.Group();
  const flames = [];
  const m1 = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  const m2 = new THREE.MeshBasicMaterial({ color: '#ff5a1f', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.12 * scale, 0.5 * scale, 5), i % 2 ? m1 : m2);
    f.userData.o = Math.random() * 6; f.userData.x = (Math.random() - .5) * 0.25 * scale; f.userData.z = (Math.random() - .5) * 0.25 * scale;
    g.add(f); flames.push(f);
  }
  const light = new THREE.PointLight('#ff9a4a', 2.5 * scale, 6 * scale, 1.6); light.position.y = 0.5 * scale; g.add(light);
  g.userData.animate = (t) => {
    for (const f of flames) {
      const k = (t * 2.2 + f.userData.o) % 1;
      f.position.set(f.userData.x, k * 0.5 * scale, f.userData.z);
      f.scale.setScalar(1 - k * 0.8);
    }
    light.intensity = (2.2 + Math.sin(t * 17) * 0.4) * scale;
  };
  return g;
}

// 煙
export function makeSmoke() {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: '#8d8a86', transparent: true, opacity: 0.35, depthWrite: false });
  const puffs = [];
  for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), m.clone()); p.userData.o = i / 6; g.add(p); puffs.push(p); }
  g.userData.animate = (t) => {
    for (const p of puffs) {
      const k = (t * 0.25 + p.userData.o) % 1;
      p.position.set(Math.sin(k * 5 + p.userData.o * 9) * 0.3, k * 2.5, 0);
      p.scale.setScalar(0.6 + k * 2);
      p.material.opacity = 0.35 * (1 - k);
    }
  };
  return g;
}

// 基本場景（燈光、霧、天空）
export function baseScene({ fog = '#cfd8d4', fogNear = 30, fogFar = 400, sky = {}, hemi = ['#dfe9f0', '#5d5540', 1.4], sun = ['#fff1d6', 1.6, [40, 60, -30]] } = {}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(fog, fogNear, fogFar);
  scene.background = new THREE.Color(fog);
  const h = new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2]); scene.add(h);
  const d = new THREE.DirectionalLight(sun[0], sun[1]); d.position.set(...sun[2]); scene.add(d);
  const s = makeSky(scene, Object.assign({ horizon: fog }, sky));
  return { scene, hemi: h, sun: d, sky: s };
}
