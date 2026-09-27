// 現成景物素材：Quaternius「Stylized Nature MegaKit」（CC0，可自由使用）
// 已預先轉成精簡格式（assets/nature/）：約 1.3MB，傳輸時壓縮後約 0.7MB。
// 為免拖慢：
//   1. 只在玩家附近（約 40 米內，低階平板 28 米）用素材樹；
//      素材樹本身不投影，影子改由原本的低多邊形樹「代投」（看不見、只畫影子），省去最貴的樹葉陰影計算，遠處仍用原本極輕量的程式樹；
//   2. 樹葉用 Lambert 材質 + alphaTest（不透明排序），不做半透明混合；
//   3. 載入失敗（例如離線單檔版）便自動沿用程式樹，遊戲照常。
import { THREE, E } from './engine.js';

// 以網頁位置計算素材路徑（離線單檔版沒有 import.meta.url，屆時不載入素材）
let BASE = 'assets/nature/';
try { BASE = new URL('../assets/nature/', import.meta.url).href; } catch (e) { /* 單檔版 */ }
const LOW_END = matchMedia('(pointer: coarse)').matches && (navigator.hardwareConcurrency || 4) <= 4;
const BASE_RADIUS = LOW_END ? 28 : 40;
// 自動保護：如果畫面持續慢於約 45 格／秒，就逐步縮細素材樹範圍，最後完全改回程式樹（只降不升，免得忽快忽慢）
export const quality = { radius: BASE_RADIUS, level: 0 };
const LEVELS = [1, 0.7, 0.45, 0];
let _last = 0, _slow = 0, _count = 0;
const FORCE = new URLSearchParams(location.search).get('nature') === '1';   // ?nature=1：強制使用素材（測試用，不自動降級）
function watchFps(now) {
  if (FORCE) return;
  if (_last) {
    const dt = now - _last;
    if (dt < 250) {                      // 忽略切換分頁、載入等長停頓
      _count++;
      _slow = _slow * 0.95 + (dt > 22 ? 1 : 0) * 0.05;
      if (_count > 90 && _slow > 0.6 && quality.level < LEVELS.length - 1) {
        quality.level++; quality.radius = BASE_RADIUS * LEVELS[quality.level];
        _count = 0; _slow = 0;
        console.info('畫面偏慢，素材樹範圍縮為', quality.radius, '米');
      }
    }
  }
  _last = now;
}

export const nature = { ready: false, geos: {}, info: {}, mats: {} };

// 每種程式樹對應的素材（多款輪流使用）。楓、銀杏、竹、中國松保留程式造型（素材庫沒有合適款式）
export const TREE_ASSETS = {
  pine: { models: ['Pine_5', 'Pine_4'], height: 5.6 },
  broad: { models: ['CommonTree_5', 'CommonTree_3'], height: 5.0 },
  bush: { models: ['Bush_Common'], height: 1.3 },
};

function loadTex(file, srgb = true) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(BASE + file, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    res(t);
  }, undefined, rej));
}

let _loading = null;
export function loadNature(windPatch) {
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      if (location.protocol === 'file:') return false;
      if (new URLSearchParams(location.search).get('nature') === '0') return false;   // ?nature=0：改回程式樹作比較
      const [info, bin] = await Promise.all([
        fetch(BASE + 'nature.json').then(r => { if (!r.ok) throw 0; return r.json(); }),
        fetch(BASE + 'nature.bin').then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); }),
      ]);
      const names = ['bark.jpg', 'leaves.png', 'pine.png', 'rocks.jpg', 'bush.png'];
      const texs = await Promise.all(names.map(n => loadTex(n)));
      const T = Object.fromEntries(names.map((n, i) => [n.split('.')[0], texs[i]]));
      const mk = (map, opts = {}) => {
        const m = new THREE.MeshLambertMaterial(Object.assign({ map, vertexColors: true, alphaTest: 0.22, side: THREE.DoubleSide }, opts));
        return m;
      };
      const leafMat = (t) => windPatch(mk(t), 0.0045, true);
      nature.mats = {
        Bark_NormalTree: windPatch(mk(T.bark, { alphaTest: 0, side: THREE.FrontSide }), 0.0045, false),
        Leaves_NormalTree: leafMat(T.leaves),
        Leaves_Pine: leafMat(T.pine),
        Leaves_TwistedTree: windPatch(mk(T.bush), 0.02, true),   // 灌木（原為紅葉，已轉成綠色）
        // 石頭背光面加少許天光，免得變成黑色一團（風擺幅度為 0）
        Rocks: windPatch(new THREE.MeshLambertMaterial({ map: T.rocks, vertexColors: true }), 0, true),
      };
      for (const [name, m] of Object.entries(info.models)) {
        nature.info[name] = m;
        nature.geos[name] = m.parts.map(p => {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, p.pos, p.count * 3), 3));
          g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, p.nrm, p.count * 4), 4, true));
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, p.uv, p.count * 2), 2));
          g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(bin, p.col, p.count * 4), 4, true));
          g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, p.idx, p.index), 1));
          g.computeBoundingSphere();
          return { geo: g, mat: p.mat };
        });
      }
      nature.ready = true;
      return true;
    } catch (e) {
      console.warn('景物素材未能載入，沿用程式生成的樹木。', e);
      return false;
    }
  })();
  return _loading;
}

/** 單件素材（例如石頭）：回傳 Group，底部貼地（y=0），高度約為 height */
export function natureMesh(name, { height, color } = {}) {
  const info = nature.info[name], parts = nature.geos[name];
  const g = new THREE.Group();
  const k = height ? height / (info.max[1] - info.min[1]) : 1;
  for (const p of parts) {
    let m = nature.mats[p.mat];
    if (color) {
      const base = m; m = base.clone(); m.color.set(color);
      // clone() 不會複製著色器修改，要手動帶過去
      m.onBeforeCompile = base.onBeforeCompile; m.customProgramCacheKey = base.customProgramCacheKey;
    }
    const mesh = new THREE.Mesh(p.geo, m);
    mesh.position.y = -info.min[1] * k; mesh.scale.setScalar(k);
    g.add(mesh);
  }
  return g;
}

// ---------------- 近處換成素材樹（LOD） ----------------
const lodSets = [];
E.preRender.push((scene) => {
  let active = false;
  for (const L of lodSets) {
    let root = L.group; while (root.parent) root = root.parent;
    if (root !== scene) continue;
    active = true;
    const now = performance.now();
    if (now - L.t < 250) continue;
    L.t = now;
    L.update(E.camera.position);
  }
  // 只在有素材樹的場景監察流暢度
  if (active) watchFps(performance.now()); else _last = 0;
});

/**
 * items：同 makeTrees 的清單；procMeshes：每種類型的程式樹 InstancedMesh 及原本矩陣
 * 回傳一個 Group，內含所有素材樹 InstancedMesh；每 0.25 秒按鏡頭位置更新
 */
export function makeNatureLOD(entries) {
  // entries: [{ type, items:[{x,y,z,s,rot,tilt, i}], proc: InstancedMesh, mats: Matrix4[] }]
  const group = new THREE.Group();
  const buckets = [];   // 每個素材款式一組
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color();
  for (const en of entries) {
    const spec = TREE_ASSETS[en.type];
    const per = {};
    en.items.forEach((it, idx) => { const mi = (idx * 7 + 3) % spec.models.length; (per[mi] = per[mi] || []).push(idx); });
    en.variant = new Int16Array(en.items.length);
    en.near = new Uint8Array(en.items.length);
    for (const mi in per) {
      const name = spec.models[mi], info = nature.info[name];
      const hk = spec.height / (info.max[1] - info.min[1]);
      const meshes = nature.geos[name].map(part => {
        let mat = nature.mats[part.mat];
        if (spec.leaves && part.mat.startsWith('Leaves')) mat = nature.mats[spec.leaves];
        const im = new THREE.InstancedMesh(part.geo, mat, per[mi].length);
        im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true; im.userData.shadowSet = true;
        group.add(im);
        return im;
      });
      per[mi].forEach(idx => { en.variant[idx] = buckets.length; });
      buckets.push({ meshes, hk, minY: info.min[1] });
    }
  }
  // 影子代投：與程式樹同一幾何，只寫深度不寫顏色（主畫面看不見），但會投下影子
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  for (const en of entries) {
    const px = new THREE.InstancedMesh(en.proc.geometry, proxyMat, en.items.length);
    px.count = 0; px.frustumCulled = false; px.castShadow = true; px.receiveShadow = false; px.userData.shadowSet = true;
    px.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    en.proxy = px; group.add(px);
  }
  function update(cam) {
    const R2 = quality.radius * quality.radius;
    for (const b of buckets) b.n = 0;
    for (const en of entries) {
      let procDirty = false, np = 0;
      en.items.forEach((it, idx) => {
        const dx = it.x - cam.x, dz = it.z - cam.z;
        const near = dx * dx + dz * dz < R2 ? 1 : 0;
        if (near !== en.near[idx]) { en.near[idx] = near; en.proc.setMatrixAt(idx, near ? zero : en.mats[idx]); procDirty = true; }
        if (!near) return;
        en.proxy.setMatrixAt(np++, en.mats[idx]);
        const b = buckets[en.variant[idx]];
        const k = it.s * b.hk;
        q.setFromEuler(new THREE.Euler(it.tilt ?? 0, it.rot ?? 0, 0));
        s.set(k, k * (it.sy ?? 1), k);
        p.set(it.x, it.y - b.minY * k - 0.1, it.z);
        m4.compose(p, q, s);
        const r1 = ((idx * 9301 + 49297) % 233280) / 233280;
        c.setRGB(0.88 + r1 * 0.2, 0.9 + r1 * 0.16, 0.86 + r1 * 0.16);
        for (const im of b.meshes) { im.setMatrixAt(b.n, m4); im.setColorAt(b.n, c); }
        b.n++;
      });
      if (procDirty) en.proc.instanceMatrix.needsUpdate = true;
      en.proxy.count = np; en.proxy.instanceMatrix.needsUpdate = true;
    }
    for (const b of buckets) for (const im of b.meshes) {
      im.count = b.n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
  const L = { group, update, t: 0 };
  lodSets.push(L);
  // 建好即按出生點更新一次（setPlayer 之前鏡頭位置未必正確，之後每 0.25 秒再更新）
  update(E.camera.position);
  return group;
}

/**
 * 可直接取代 makeRock 的素材石頭：中心在原點、大小約 2×size，外層 Group 可照舊設定位置與縮放。
 * 素材未載入時回傳 null（呼叫處改用 makeRock）。
 */
export function natureRock(size = 1, color = '#8a867b', seed = 1) {
  if (!nature.ready) return null;
  const name = 'Rock_Medium_' + (1 + (Math.abs(seed) % 3));
  const info = nature.info[name];
  const h = info.max[1] - info.min[1], w = Math.max(info.max[0] - info.min[0], info.max[2] - info.min[2]);
  const k = (2 * size) / h;
  // 原本的深色石色乘在素材貼圖上會太暗，所以先調亮一半
  const tint = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.5);
  const inner = natureMesh(name, { height: 2 * size, color: tint });
  inner.position.y = -size;
  inner.scale.set((2 * size) / (w * k), 1, (2 * size) / (w * k));
  inner.rotation.y = (seed * 1.37) % 6.28;
  const g = new THREE.Group(); g.add(inner);
  return g;
}
