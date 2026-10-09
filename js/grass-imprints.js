// 草地上「有人坐過」的壓痕（「披草而坐」）。
// 現實中坐過的草地：四周是一片仍然直立、略為垂頭的草；人坐下的地方，草被壓向外倒、
// 平貼地面，被壓平的葉子露出較淺、較黃的一面，所以顏色比四周淡；中間偶見露出的枯草和泥土。
// 過了一段時間，被壓的草會由葉尖開始慢慢翹回來（recover 愈大，草愈「立起了一半」）。
//
// 整片草和壓痕合成一個網格，只佔兩次繪製（草葉＋貼地底色），沒有額外貼圖運算的負擔。
import * as THREE from '../lib/three.module.js';
import { rng, noise2, addBlade, bladeBuffer, bladeGeometry, bladeMat } from './world.js';

const smooth = (a, b, v) => { const x = Math.max(0, Math.min(1, (v - a) / (b - a))); return x * x * (3 - 2 * x); };
const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); };
const ellipse = (u, v, ru, rv) => (Math.hypot(u / ru, v / rv) - 1) * Math.min(ru, rv);

/**
 * @param heightAt (x, z) → 地面高度（世界座標）
 * @param cx, cz   壓痕中心（世界座標）
 * @param opts.seats   坐處：[{ a, r }]（a = 方位角，r = 離中心距離；人面向中心盤腿而坐）
 * @param opts.recover 0 = 剛剛壓平；1 = 差不多全部立回來
 * @param opts.radius  整片草地半徑
 * @param opts.trail   有人撥開草走進來的方向（方位角）；null = 不設
 */
export function makeSeatImprints(heightAt, cx, cz, {
  seats = [{ a: 0.3, r: 0.95 }, { a: 2.4, r: 1.0 }, { a: 4.3, r: 0.9 }],
  recover = 0.5, radius = 2.8, seed = 7, trail = null, density = 1,
} = {}) {
  const r = rng(seed);
  const h0 = heightAt(cx, cz);
  const gy = (x, z) => heightAt(cx + x, cz + z) - h0;

  // 每個坐處：臀部一個橢圓、盤起的雙腿向前一個較闊的橢圓，連成一個自然的凹痕
  const S = seats.map((s, i) => {
    const x = Math.cos(s.a) * s.r, z = Math.sin(s.a) * s.r;
    const fa = Math.atan2(-z, -x) + (r() - 0.5) * 0.5;      // 面向中心，略有偏差
    return { x, z, fx: Math.cos(fa), fz: Math.sin(fa), k: 0.9 + r() * 0.2, ph: i * 3.1 };
  });
  const seatD = (x, z) => {
    let best = Infinity, w = 0;
    S.forEach((s, i) => {
      const px = x - s.x, pz = z - s.z;
      const u = px * s.fx + pz * s.fz, v = -px * s.fz + pz * s.fx;
      const hip = ellipse(u + 0.1, v, 0.27 * s.k, 0.29 * s.k);
      const legs = ellipse(u - 0.2, v, 0.22 * s.k, 0.43 * s.k);
      let d = smin(hip, legs, 0.12);
      d += noise2(x * 7 + s.ph, z * 7, 41) * 0.035;            // 邊緣不規則
      if (d < best) { best = d; w = i; }
    });
    return [best, w];
  };
  // 坐處之間的地方（放酒壺、伸腳、走動）也被踩得半倒
  const midD = (x, z) => Math.hypot(x, z) - 0.42 + noise2(x * 5, z * 5, 43) * 0.08;
  const trailD = (x, z) => {
    if (trail == null) return Infinity;
    const dx = Math.cos(trail), dz = Math.sin(trail);
    const t = Math.max(0.3, x * dx + z * dz);
    return Math.hypot(x - dx * t, z - dz * t) - 0.22 - noise2(x * 4, z * 4, 47) * 0.06;
  };
  // 壓平程度 0..1（1 = 完全壓平）
  const flatAt = (x, z) => {
    const [d, w] = seatD(x, z);
    const seat = 1 - smooth(-0.04, 0.07, d);
    const mid = 0.6 * (1 - smooth(-0.05, 0.12, midD(x, z)));
    const tr = 0.75 * (1 - smooth(-0.05, 0.1, trailD(x, z)));
    return [Math.max(seat, mid, tr), w, d, seat >= mid && seat >= tr ? 'seat' : (mid >= tr ? 'mid' : 'trail')];
  };
  // 整片草地的邊緣：不規則地漸漸稀疏，融入四周
  const edgeAt = (x, z) => 1 - smooth(radius * 0.55, radius, Math.hypot(x, z) * (1 + noise2(x * 0.9, z * 0.9, 45) * 0.28));

  const out = bladeBuffer();
  const freshBase = '#6f7240', freshTip = '#b3b07a';          // 剛壓平：露出較淺、較黃的葉背
  const oldBase = '#55602f', oldTip = '#9aa564';              // 壓了一段時間：已轉回青黃
  const mix = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
  const pBase = mix(freshBase, oldBase, recover), pTip = mix(freshTip, oldTip, recover);
  // 每片倒下的葉子深淺不一（有的露葉背、有的露葉面），避免一整片同色
  const tone = () => { const k = r(); return k < 0.25 ? mix(pTip, '#7d8a45', 0.5) : k < 0.4 ? mix(pTip, '#d2c992', 0.35) : pTip; };
  const upTips = ['#93a253', '#a3ab5d', '#8a9a4c', '#b4ad68', '#9fa758'];

  // 被壓倒的草：平貼地面，由坐處中心向外倒（像被身體向外擠開），帶點旋渦
  const flatBlade = (x, z, f, w, kind) => {
    // 倒向像梳過的頭髮：同一片地方的葉子大致順着同一方向（坐下時身體向前滑、雙腿向外伸），
    // 再加上緩慢變化的旋渦；不是由一點向四周放射。
    let dx, dz;
    if (kind === 'seat') {
      const s = S[w], px = x - s.x, pz = z - s.z, pl = Math.hypot(px, pz) || 1;
      dx = s.fx + px / pl * 0.45; dz = s.fz + pz / pl * 0.45;
    } else if (kind === 'trail') { dx = Math.cos(trail); dz = Math.sin(trail); }
    else { const t = Math.atan2(z, x) + Math.PI / 2; dx = Math.cos(t); dz = Math.sin(t); }
    const yaw = Math.atan2(dx, dz) + noise2(x * 1.6, z * 1.6, 49) * 0.9 + (r() - 0.5) * 0.35;
    // 回復：葉身仍貼地，葉尖慢慢翹起
    const rec = recover * (0.6 + r() * 0.6) * (1.15 - f * 0.3);
    addBlade(out, {
      x, y: gy(x, z) + 0.03, z, yaw,
      lean: Math.PI / 2 - 0.04 - rec * 0.25 - r() * 0.05,
      bend: -(0.12 + rec * 1.1 + r() * 0.15),
      len: 0.32 + r() * 0.3, width: 0.019 + r() * 0.008, seg: 3,
      base: pBase, tip: tone(), twist: (r() - 0.5) * 0.5,
    });
  };
  // 壓痕內密密鋪滿倒下的草（每平方米約四百片），只看得見少許底下的枯草泥土
  for (let i = 0, made = 0; i < 40000 && made < 1400 * density; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const [f, w, , kind] = flatAt(x, z);
    if (f <= 0.45 || r() > f * 1.3) continue;
    flatBlade(x, z, f, w, kind); made++;
  }

  const N = Math.round(2100 * density);
  for (let i = 0; i < N; i++) {
    // 在圓內均勻撒點
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const e = edgeAt(x, z);
    if (r() > e) continue;
    const [f, w, sd, kind] = flatAt(x, z);
    const y = gy(x, z) - 0.005;
    if (f > 0.45) {
      continue;   // 壓痕內的草另外密密地鋪（見下）
    } else {
      // ---- 仍然直立的草：靠近凹痕的草被擠得向外傾，愈遠愈直、愈高 ----
      const push = Math.max(0, 1 - smooth(0.0, 0.35, Math.min(sd, midD(x, z) + 0.1, trailD(x, z))));
      let ox = x, oz = z;
      if (S[w]) { ox = x - S[w].x; oz = z - S[w].z; }
      const away = Math.atan2(ox, oz);
      const yaw = push > 0.05 ? away + (r() - 0.5) * 0.7 : r() * Math.PI * 2;
      const tall = 0.32 + r() * 0.24 + smooth(0.2, 1.2, sd) * 0.12;
      addBlade(out, {
        x, y, z, yaw,
        lean: 0.1 + r() * 0.3 + push * (0.5 + f * 1.4),
        bend: 0.35 + r() * 0.6,
        len: tall * (0.85 + e * 0.25), width: 0.016 + r() * 0.008, seg: 3,
        base: '#45542a', tip: upTips[Math.floor(r() * upTips.length)], twist: (r() - 0.5) * 0.6,
      });
      // 直立的草一般成叢生長，旁邊多長一兩片
      if (r() < 0.55) addBlade(out, {
        x: x + (r() - 0.5) * 0.05, y, z: z + (r() - 0.5) * 0.05, yaw: yaw + (r() - 0.5) * 1.2,
        lean: 0.15 + r() * 0.3 + push * (0.5 + f * 1.4), bend: 0.4 + r() * 0.6,
        len: tall * 0.8, width: 0.015 + r() * 0.006, seg: 3,
        base: '#45542a', tip: upTips[Math.floor(r() * upTips.length)],
      });
    }
  }

  const group = new THREE.Group();
  group.position.set(cx, h0, cz);
  const blades = new THREE.Mesh(bladeGeometry(out), bladeMat(0.1));
  group.add(blades);

  // ---- 貼地底色：草地範圍內地面略深；壓痕內露出枯草、泥土，顏色較淡較黃 ----
  const W = radius * 2 + 0.4, PX = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = PX;
  const g = cv.getContext('2d'); const img = g.createImageData(PX, PX);
  const meadow = [62, 76, 38], matted = [112, 110, 66], soil = [88, 78, 52];
  for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
    const x = (i + 0.5) / PX * W - W / 2, z = (j + 0.5) / PX * W - W / 2;
    const e = edgeAt(x, z);
    const o = (j * PX + i) * 4;
    if (e <= 0.01) { img.data[o + 3] = 0; continue; }
    const [f] = flatAt(x, z);
    const n = noise2(x * 9, z * 9, 51) * 0.5 + 0.5;
    const base = matted.map((v, k) => v + (soil[k] - v) * smooth(0.6, 0.95, n) * 0.6);
    const k = smooth(0.1, 0.9, f) * (1 - recover * 0.4);
    for (let c = 0; c < 3; c++) img.data[o + c] = meadow[c] + (base[c] - meadow[c]) * k;
    img.data[o + 3] = 255 * Math.min(1, e * 1.1) * (0.3 + 0.6 * k);   // 草地範圍只輕輕壓暗地面，壓痕內才明顯
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(W, W, 24, 24); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, gy(pos.getX(i), pos.getZ(i)) + 0.008);
  geo.computeVertexNormals();
  const decal = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  decal.renderOrder = 1;
  group.add(decal);
  return group;
}
