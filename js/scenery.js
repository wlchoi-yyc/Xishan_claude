// 山水點景：雲、霧、草地、石峰、斷崖台地
import { THREE } from './engine.js';
import { rng, noise2, mergeColored, mat, vcMat, smoothstep, windMat } from './world.js';

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
  // 從側面（視線貼近霧片高度）看時霧片會變成一條橫帶，所以按視線角度淡出
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vMistWP;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vMistWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vMistWP;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      'diffuseColor.a *= smoothstep(0.02, 0.22, abs(normalize(cameraPosition - vMistWP).y));\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'mist-v1';
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
  const mesh = new THREE.InstancedMesh(grassGeo(), windMat(0.12), pts.length);
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
  // 頂部較寬、崩裂參差（不做圓頂），石身有橫向岩層，像風化的喀斯特石峰
  const geo = new THREE.CylinderGeometry(rad * 0.55, rad, height, 9, 12);
  const pos = geo.attributes.position;
  const lean = (r() - 0.5) * 0.25, lean2 = (r() - 0.5) * 0.25;
  const half = height / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = pos.getY(i);
    const k = (y / height) + 0.5;
    const ang = Math.atan2(z, x);
    const n = 0.7 + 0.6 * (noise2(Math.cos(ang) * 2 + seed, y * 0.3, seed) * 0.5 + 0.5);
    // 岩層：每隔一段向內收一級
    const strata = 1 - 0.1 * (Math.floor(k * 7 + noise2(ang, seed, 3) * 0.8) % 2);
    const waist = 1 - Math.sin(k * Math.PI) * 0.12;
    // 頂部：不平的斷口，有高有低
    if (y > half - 1e-3) y -= (noise2(Math.cos(ang) * 1.7 + seed * 3, Math.sin(ang) * 1.7, seed + 7) * 0.5 + 0.5) * height * 0.22 + (Math.hypot(x, z) < 1e-3 ? height * 0.05 : 0);
    pos.setXYZ(i, x * n * waist * strata + lean * k * height, y, z * n * waist * strata + lean2 * k * height);
  }
  let g = geo.toNonIndexed(); g.computeVertexNormals();
  const p = g.attributes.position, nrm = g.attributes.normal;
  const cols = new Float32Array(p.count * 3), c = new THREE.Color(), cr = new THREE.Color(rock), cm = new THREE.Color(moss), dark = new THREE.Color(rock).multiplyScalar(0.72);
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 / height + 0.5;
    const up = nrm.getY(i);
    c.copy(cr).lerp(dark, 0.35 * (1 - y) + (noise2(i * 0.37, y * 7, seed) * 0.5 + 0.5) * 0.3);
    if (up > 0.55) c.lerp(cm, 0.7);   // 只在平台面長青苔，不再整個頂部蓋綠
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

// ---------------- 遠山層疊 ----------------
/**
 * 山水畫式的遠山：幾重淡出的山脊剪影環繞地平線，愈遠愈淡，山腳溶入霧中。
 * 顏色每幀取自場景霧色，所以黃昏、入夜時會自動跟隨變色。
 * layers: [{ r: 半徑, h: 最高山峰高度, y: 山腳高度, ink: 山色, k: 濃淡 0–1, seed }]
 */
export function makeFarRanges(layers, { follow = true } = {}) {
  const group = new THREE.Group();
  layers.forEach((L, li) => {
    const seg = 320, r = rng(L.seed ?? (li * 17 + 3));
    const verts = [], vv = [], idx = [];
    const base = (L.y ?? 0) - 300;
    const ph = r() * 100;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      const u = a * 6 + ph;
      // 尖峰：取絕對值的雜訊製造山脊，再乘上大尺度起伏，令山勢有主有次
      const ridge = 1 - Math.abs(noise2(Math.cos(a) * 3 + ph, Math.sin(a) * 3, li + 5));
      const roll = noise2(Math.cos(a) * 1.2 + ph, Math.sin(a) * 1.2, li + 9) * 0.5 + 0.5;
      const peak = Math.pow(ridge, 2.2) * (0.35 + roll * 0.9) + noise2(u * 2.5, li, 3) * 0.06;
      const top = (L.y ?? 0) + Math.max(0.08, peak) * L.h;
      const x = Math.cos(a) * L.r, z = Math.sin(a) * L.r;
      verts.push(x, top, z, x, base, z);
      vv.push(1, 0);
      if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('vtop', new THREE.Float32BufferAttribute(vv, 1));
    geo.setIndex(idx);
    const uniforms = { fogColor: { value: new THREE.Color('#cfd8d4') }, ink: { value: new THREE.Color(L.ink || '#6f8a86') }, k: { value: L.k ?? 0.4 }, hTop: { value: (L.y ?? 0) + L.h }, hBase: { value: L.y ?? 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms, side: THREE.DoubleSide, fog: false, depthWrite: false,
      vertexShader: `attribute float vtop; varying float vY; varying float vTop; void main(){ vY = position.y; vTop = vtop; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 fogColor; uniform vec3 ink; uniform float k; uniform float hTop; uniform float hBase; varying float vY; varying float vTop;
        void main(){
          float t = clamp((vY - hBase) / max(1.0, hTop - hBase), 0.0, 1.0);
          // 山頂較濃，向下漸漸溶入霧（留白）
          float a = k * (0.25 + 0.75 * smoothstep(0.0, 0.75, t));
          gl_FragColor = vec4(mix(fogColor, ink, a), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -9 + li * 0; // 緊接天空之後
    mesh.userData.shadowSet = true;
    mesh.userData.layer = L;
    mesh.onBeforeRender = (rd, scene, cam) => {
      if (scene.fog) uniforms.fogColor.value.copy(scene.fog.color);
      if (follow) { mesh.position.x = cam.position.x; mesh.position.z = cam.position.z; }
    };
    group.add(mesh);
  });
  // 由遠至近繪畫，近的一重蓋住遠的
  group.children.sort((a, b) => b.userData.layer.r - a.userData.layer.r).forEach((m, i) => { m.renderOrder = -9 + i * 0.01; });
  return group;
}
