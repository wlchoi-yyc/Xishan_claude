// 人物造型：唐代文人（幞頭、交領廣袖長袍）、僕役（頭巾、短褐、綁腿）、船家（斗笠、蓑衣）
// 正面朝 +z。會眨眼；輪到自己說話時嘴巴會動、頭會輕輕點動。
import { THREE, E } from './engine.js';

const mats = new Map();
function M(color, opts) {
  const key = color + (opts ? JSON.stringify(opts) : '');
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, opts || {})));
  return mats.get(key);
}
function mesh(geo, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(geo, M(color, opts));
  m.position.set(x, y, z);
  return m;
}
function lathe(profile, color, seg = 14) {
  return new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg), M(color, { side: THREE.DoubleSide }));
}
// 一條由 a 到 b 的圓柱（用於四肢、衣帶）
function limb(a, b, r0, r1, color, seg = 7) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), M(color));
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}
const shade = (hex, l) => '#' + new THREE.Color(hex).offsetHSL(0, 0, l).getHexString();

const PRESETS = {
  // 柳宗元：淡青灰交領長袍、黑幞頭、長鬚
  liu: { outfit: 'robe', robe: '#b7c3bd', inner: '#efe8d6', trim: '#6f7f7a', belt: '#3a3029', cap: 'futou', beard: 'long', hair: '#15130f', skin: '#e2b995', height: 1 },
  friend1: { outfit: 'robe', robe: '#9a8466', inner: '#ece3cf', trim: '#5e4b36', belt: '#3a3029', cap: 'futou', beard: 'short', hair: '#15130f', skin: '#dcb18c', height: 0.98 },
  friend2: { outfit: 'robe', robe: '#6f8190', inner: '#e8e3d6', trim: '#3f4d58', belt: '#2d2a26', cap: 'kerchief', capColor: '#2c3a3a', beard: 'long', hair: '#1b1917', skin: '#e0b58f', height: 1.01 },
  // 老僕：灰髮、短鬚、短褐
  oldServant: { outfit: 'tunic', robe: '#7d6a52', inner: '#d9cfbb', trim: '#4f4232', belt: '#3b2f24', pants: '#5b5043', wrap: '#c9bd9c', cap: 'kerchief', capColor: '#4a524e', beard: 'short', hair: '#8e8a83', skin: '#d4a883', height: 0.95, stoop: 0.12 },
  // 年輕僕人
  servant: { outfit: 'tunic', robe: '#8c7250', inner: '#ddd3bd', trim: '#5a4630', belt: '#3b2f24', pants: '#5f5242', wrap: '#cfc2a0', cap: 'kerchief', capColor: '#51605d', beard: null, hair: '#1b1916', skin: '#d9a883', height: 0.95 },
  // 船家：斗笠、蓑衣
  boatman: { outfit: 'tunic', robe: '#5e5a4e', inner: '#cdc4ae', trim: '#3d3a32', belt: '#2d2a24', pants: '#4b473d', wrap: '#bfb393', cap: 'hat', cape: true, beard: 'stubble', hair: '#1b1916', skin: '#c79770', height: 0.97 },
  // 玩家（終章鏡頭拉遠時出現）
  student: { outfit: 'tunic', robe: '#3f6159', inner: '#e3dccb', trim: '#27403a', belt: '#2d2a24', pants: '#3a4440', wrap: '#d3c9ae', cap: 'kerchief', capColor: '#23302d', beard: null, hair: '#171513', skin: '#e3bb98', height: 0.93 },
};

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

  // ---------- 下身（站） ----------
  if (robeOutfit) {
    // 長袍下擺：由腰向下張開，微微露出雲頭履
    standLower.add(lathe([[0, 0.07], [0.3, 0.07], [0.33, 0.1], [0.3, 0.35], [0.25, 0.7], [0.215, 1.0], [0, 1.0]], o.robe, 16));
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.018, 4, 18), M(o.trim)); hem.rotation.x = Math.PI / 2; hem.position.y = 0.09; standLower.add(hem);
    for (const s of [1, -1]) {
      const shoe = mesh(new THREE.BoxGeometry(0.09, 0.07, 0.2), '#1d1b19', 0.09 * s, 0.035, 0.1); standLower.add(shoe);
      const toe = mesh(new THREE.BoxGeometry(0.07, 0.06, 0.04), '#1d1b19', 0.09 * s, 0.08, 0.2); toe.rotation.x = -0.5; standLower.add(toe);
    }
  } else {
    // 短褐下擺到膝，下面是褲、綁腿、草鞋
    standLower.add(lathe([[0, 0.52], [0.26, 0.52], [0.27, 0.56], [0.245, 0.75], [0.215, 1.0], [0, 1.0]], o.robe, 14));
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.015, 4, 16), M(o.trim)); hem.rotation.x = Math.PI / 2; hem.position.y = 0.54; standLower.add(hem);
    for (const s of [1, -1]) {
      const leg = new THREE.Group(); leg.position.set(0.095 * s, 0.62, 0);
      leg.add(limb([0, 0, 0], [0, -0.3, 0], 0.075, 0.065, o.pants));
      leg.add(limb([0, -0.3, 0], [0, -0.55, 0], 0.062, 0.052, o.wrap));
      for (let k = 0; k < 3; k++) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.006, 3, 10), M(shade(o.wrap, -0.12))); band.rotation.x = Math.PI / 2; band.position.y = -0.35 - k * 0.07; leg.add(band); }
      leg.add(mesh(new THREE.BoxGeometry(0.1, 0.035, 0.22), '#b89a5c', 0, -0.6, 0.04));
      leg.add(mesh(new THREE.BoxGeometry(0.08, 0.03, 0.12), o.skin, 0, -0.575, 0.04));
      standLower.add(leg); legs.push(leg);
    }
  }

  // ---------- 下身（坐：箕踞，兩腿伸直岔開） ----------
  {
    const clothLow = robeOutfit ? o.robe : o.pants;
    sitLower.add(lathe([[0, 0.02], [0.42, 0.02], [0.38, 0.1], [0.27, 0.24], [0.22, 0.3], [0, 0.3]], o.robe, 16));
    for (const s of [1, -1]) {
      const a = 0.32 * s;
      const hx = 0.11 * s, dirx = Math.sin(a), dirz = Math.cos(a);
      const kx = hx + dirx * 0.42, kz = 0.05 + dirz * 0.42;
      const fx = hx + dirx * 0.8, fz = 0.05 + dirz * 0.8;
      sitLower.add(limb([hx, 0.14, 0.05], [kx, 0.13, kz], 0.1, 0.085, clothLow));
      sitLower.add(limb([kx, 0.13, kz], [fx, 0.08, fz], 0.075, 0.06, robeOutfit ? o.robe : o.wrap));
      const foot = mesh(new THREE.BoxGeometry(0.09, 0.16, 0.08), robeOutfit ? '#1d1b19' : '#b89a5c', fx + dirx * 0.04, 0.1, fz + dirz * 0.04);
      foot.rotation.y = a; sitLower.add(foot);
    }
    // 衣襬垂在兩腿之間
    const drape = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 5, 1, true), M(o.robe, { side: THREE.DoubleSide }));
    drape.rotation.x = Math.PI / 2 + 0.15; drape.position.set(0, 0.12, 0.3); drape.scale.set(1, 1, 0.3); sitLower.add(drape);
  }

  // ---------- 上身 ----------
  const torso = lathe([[0, 0.98], [0.215, 0.98], [0.225, 1.12], [0.215, 1.3], [0.2, 1.43], [0.15, 1.5], [0.06, 1.53], [0, 1.53]], o.robe, 14);
  upper.add(torso);
  for (const s of [1, -1]) { const sh = mesh(new THREE.SphereGeometry(0.075, 8, 6), o.robe, 0.185 * s, 1.42, 0); sh.scale.y = 0.8; upper.add(sh); }
  // 交領右衽：左襟壓右襟（沿胸前曲面畫出衣襟）
  const torsoR = (y) => { const P = [[1.12, 0.225], [1.3, 0.215], [1.43, 0.2], [1.5, 0.15], [1.53, 0.07]]; for (let i = 0; i < P.length - 1; i++) { if (y <= P[i + 1][0]) { const k = (y - P[i][0]) / (P[i + 1][0] - P[i][0]); return P[i][1] + (P[i + 1][1] - P[i][1]) * Math.max(0, k); } } return 0.07; };
  const lapel = (x0, y0, x1, y1, color, r, off) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const k = i / 8, x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k; const R = torsoR(y); pts.push(new THREE.Vector3(x, y, Math.sqrt(Math.max(0.0001, R * R - x * x)) + off)); }
    upper.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 4), M(color)));
  };
  lapel(-0.045, 1.5, 0.15, 1.1, o.inner, 0.016, 0.004);
  lapel(-0.025, 1.5, 0.17, 1.1, o.trim, 0.011, 0.008);
  lapel(0.045, 1.5, 0.0, 1.36, o.inner, 0.014, 0.002);
  const collar = mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.06, 10), o.inner, 0, 1.53, 0); upper.add(collar);
  // 腰帶與垂下的帶子
  const belt = mesh(new THREE.CylinderGeometry(0.228, 0.228, 0.065, 14), o.belt, 0, 1.02, 0); upper.add(belt);
  for (const s of [1, -1]) { const tie = mesh(new THREE.BoxGeometry(0.035, robeOutfit ? 0.42 : 0.28, 0.01), o.belt, 0.04 * s, robeOutfit ? 0.8 : 0.87, 0.225); tie.rotation.z = 0.06 * s; upper.add(tie); }
  // 蓑衣
  if (o.cape) {
    const cape = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 18, 3, true), M('#a88d57', { side: THREE.DoubleSide }));
    const p = cape.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { if (p.getY(i) < -0.3) p.setY(i, p.getY(i) - (i % 2) * 0.07); }
    cape.geometry.computeVertexNormals();
    cape.position.y = 1.27; upper.add(cape);
    const cape2 = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.3, 14, 1, true), M('#957947', { side: THREE.DoubleSide })); cape2.position.y = 1.48; upper.add(cape2);
  }

  // ---------- 手臂（肩為支點；廣袖或窄袖） ----------
  function arm(side) {
    const g = new THREE.Group(); g.position.set(0.215 * side, 1.44, 0);
    g.add(limb([0, 0, 0], [0.02 * side, -0.3, 0], 0.07, 0.075, o.robe));
    if (robeOutfit) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.16, 0.34, 9, 1, true), M(o.robe, { side: THREE.DoubleSide }));
      sleeve.position.set(0.025 * side, -0.46, 0.01); g.add(sleeve);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.16, 0.04, 9, 1, true), M(o.trim, { side: THREE.DoubleSide })); cuff.position.set(0.025 * side, -0.61, 0.01); g.add(cuff);
    } else {
      g.add(limb([0.02 * side, -0.3, 0], [0.025 * side, -0.52, 0.01], 0.07, 0.06, o.robe));
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 3, 10), M(o.trim)); cuff.rotation.x = Math.PI / 2; cuff.position.set(0.025 * side, -0.52, 0.01); g.add(cuff);
    }
    const hand = mesh(new THREE.SphereGeometry(0.042, 8, 6), o.skin, 0.025 * side, -0.62, 0.015); hand.scale.set(0.75, 1.25, 0.6); g.add(hand);
    const thumb = mesh(new THREE.SphereGeometry(0.016, 5, 4), o.skin, 0.01 * side, -0.6, 0.04); g.add(thumb);
    g.rotation.z = 0.1 * side;
    upper.add(g);
    return g;
  }
  const armL = arm(1), armR = arm(-1);

  // ---------- 頭 ----------
  const head = new THREE.Group(); head.position.y = 1.555; upper.add(head);
  const face = new THREE.Group(); head.add(face); // 說話時點頭用
  face.add(mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.1, 8), o.skin, 0, 0.0, 0));
  const skull = mesh(new THREE.SphereGeometry(0.108, 16, 12), o.skin, 0, 0.105, 0); skull.scale.set(0.92, 1.12, 1); face.add(skull);
  const jaw = mesh(new THREE.SphereGeometry(0.075, 10, 8), o.skin, 0, 0.05, 0.03); jaw.scale.set(1, 0.8, 0.95); face.add(jaw);
  const cheekM = M(shade(o.skin, -0.02));
  for (const s of [1, -1]) {
    const ear = mesh(new THREE.SphereGeometry(0.024, 6, 5), o.skin, 0.1 * s, 0.1, -0.005); ear.scale.set(0.45, 1, 0.75); face.add(ear);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5), cheekM); cheek.position.set(0.05 * s, 0.07, 0.066); cheek.scale.set(1, 0.65, 0.5); face.add(cheek);
  }
  // 眼睛（可眨）
  const eyes = [];
  for (const s of [1, -1]) {
    const eg = new THREE.Group(); eg.position.set(0.038 * s, 0.112, 0.092); face.add(eg);
    const white = mesh(new THREE.SphereGeometry(0.016, 8, 6), '#f1ebdf'); white.scale.set(1.35, 0.7, 0.45); eg.add(white);
    const pupil = mesh(new THREE.SphereGeometry(0.0085, 6, 5), '#1a1410', 0, 0, 0.006); eg.add(pupil);
    const lid = mesh(new THREE.BoxGeometry(0.044, 0.006, 0.012), shade(o.skin, -0.12), 0, 0.011, 0.002); eg.add(lid);
    eyes.push(eg);
    const brow = mesh(new THREE.BoxGeometry(0.042, 0.008, 0.01), o.hair, 0.04 * s, 0.14, 0.098); brow.rotation.z = -0.18 * s; face.add(brow);
  }
  const nose = mesh(new THREE.BoxGeometry(0.022, 0.05, 0.03), shade(o.skin, -0.03), 0, 0.085, 0.104); nose.rotation.x = -0.25; face.add(nose);
  const mouthG = new THREE.Group(); mouthG.position.set(0, 0.043, 0.098); face.add(mouthG);
  const mouth = mesh(new THREE.BoxGeometry(0.036, 0.008, 0.01), '#6b2f27'); mouthG.add(mouth);
  // 頭髮
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.113, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), M(o.hair));
  hairCap.position.set(0, 0.115, -0.008); hairCap.rotation.x = -0.3; hairCap.scale.set(0.95, 1.1, 1.02); face.add(hairCap);
  const hairBack = mesh(new THREE.SphereGeometry(0.1, 10, 8), o.hair, 0, 0.09, -0.03); hairBack.scale.set(0.95, 1.05, 0.9); face.add(hairBack);
  // 鬍鬚
  if (o.beard === 'long') {
    face.add(limb([0, 0.03, 0.075], [0, -0.13, 0.06], 0.028, 0.006, o.hair, 5));
    for (const s of [1, -1]) {
      face.add(limb([0.008 * s, 0.058, 0.104], [0.036 * s, 0.03, 0.096], 0.004, 0.0025, o.hair, 4));
    }
  } else if (o.beard === 'short') {
    face.add(limb([0, 0.03, 0.075], [0, -0.05, 0.07], 0.026, 0.008, o.hair, 5));
    for (const s of [1, -1]) face.add(limb([0.008 * s, 0.058, 0.104], [0.034 * s, 0.032, 0.096], 0.004, 0.0025, o.hair, 4));
  } else if (o.beard === 'stubble') {
    const st = mesh(new THREE.SphereGeometry(0.074, 8, 6), shade(o.skin, -0.12), 0, 0.045, 0.028); st.scale.set(1.01, 0.78, 0.96); face.add(st);
  }
  // 頭飾
  const ribbons = [];
  if (o.cap === 'futou') {
    // 幞頭：黑紗包住髮髻，腦後垂下兩條軟腳
    const crown = mesh(new THREE.SphereGeometry(0.11, 12, 8), '#161514', 0, 0.17, -0.012); crown.scale.set(0.96, 0.78, 1.04); face.add(crown);
    const knot = mesh(new THREE.SphereGeometry(0.06, 8, 6), '#161514', 0, 0.235, -0.035); knot.scale.set(1.05, 0.8, 0.9); face.add(knot);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.113, 0.116, 0.05, 14), M('#161514')); band.position.set(0, 0.165, -0.008); band.rotation.x = -0.12; face.add(band);
    for (const s of [1, -1]) {
      const rb = new THREE.Group(); rb.position.set(0.035 * s, 0.2, -0.1); face.add(rb);
      const strip = mesh(new THREE.BoxGeometry(0.028, 0.3, 0.006), '#161514', 0, -0.15, 0); rb.add(strip);
      rb.rotation.x = 0.18; rb.rotation.z = 0.08 * s;
      ribbons.push(rb);
    }
  } else if (o.cap === 'kerchief') {
    const bun = mesh(new THREE.SphereGeometry(0.058, 8, 6), o.capColor, 0, 0.215, -0.025); face.add(bun);
    const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.114, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.35), M(o.capColor)); wrap.position.set(0, 0.12, -0.01); wrap.rotation.x = -0.25; face.add(wrap);
    for (const s of [1, -1]) {
      const rb = new THREE.Group(); rb.position.set(0.02 * s, 0.2, -0.08); face.add(rb);
      rb.add(mesh(new THREE.BoxGeometry(0.03, 0.12, 0.006), o.capColor, 0, -0.06, 0));
      rb.rotation.x = 0.3; rb.rotation.z = 0.25 * s; ribbons.push(rb);
    }
  } else if (o.cap === 'hat') {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.17, 16, 1, true), M('#c7a66a', { side: THREE.DoubleSide })); hat.position.y = 0.27; face.add(hat);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.395, 0.01, 3, 20), M('#9d7f45')); rim.rotation.x = Math.PI / 2; rim.position.y = 0.185; face.add(rim);
    const top = mesh(new THREE.SphereGeometry(0.03, 6, 4), '#9d7f45', 0, 0.36, 0); face.add(top);
    for (const s of [1, -1]) face.add(limb([0.1 * s, 0.19, 0], [0.05 * s, 0.0, 0.05], 0.004, 0.004, '#6d5a36', 3));
  }

  // ---------- 整體比例 ----------
  root.scale.setScalar((o.height || 1) * (o.scale || 1));
  if (o.stoop) upper.rotation.x = o.stoop;

  // ---------- 狀態與動畫 ----------
  const ud = root.userData;
  Object.assign(ud, { head, armL, armR, upper, body, pose: 'stand', walkT: 0, walking: false, name: o.name || '' });
  const baseStoop = o.stoop || 0;
  let t = Math.random() * 10, blinkIn = 1 + Math.random() * 3, blinkT = 0;

  ud.setPose = (pose) => {
    ud.pose = pose;
    body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
    standLower.visible = pose !== 'sit'; sitLower.visible = pose === 'sit';
    upper.position.set(0, 0, 0); upper.rotation.set(baseStoop, 0, 0);
    armL.rotation.set(0, 0, 0.1); armR.rotation.set(0, 0, -0.1);
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
    // 眨眼
    blinkIn -= dt;
    if (blinkIn <= 0) { blinkT = 0.13; blinkIn = 2.5 + Math.random() * 3.5; }
    if (blinkT > 0) blinkT -= dt;
    const eyeY = blinkT > 0 ? 0.12 : 1;
    eyes[0].scale.y = eyes[1].scale.y = eyeY;
    // 說話：嘴巴開合、輕輕點頭
    const talking = ud.name && E.speaker === ud.name;
    if (talking) {
      mouth.scale.y = 1 + Math.abs(Math.sin(t * 16)) * 2.6 + Math.abs(Math.sin(t * 7)) * 1.2;
      face.rotation.x = Math.sin(t * 5) * 0.035;
    } else {
      mouth.scale.y += (1 - mouth.scale.y) * Math.min(1, dt * 10);
      face.rotation.x *= 1 - Math.min(1, dt * 5);
    }
    // 軟腳、頭巾隨風
    ribbons.forEach((rb, i) => { rb.rotation.x = (i < 2 ? 0.18 : 0.3) + Math.sin(t * 1.7 + i) * 0.08 + Math.sin(t * 3.1) * 0.03; });
    // 呼吸
    torso.scale.x = torso.scale.z = 1 + Math.sin(t * 1.6) * 0.012;
    if (ud.walking) {
      ud.walkT += dt * 7;
      const sw = Math.sin(ud.walkT);
      armL.rotation.x = sw * 0.4; armR.rotation.x = -sw * 0.4;
      legs.forEach((lg, i) => { lg.rotation.x = (i ? -sw : sw) * 0.45; });
      body.position.y = Math.abs(sw) * 0.035;
      standLower.rotation.z = sw * 0.02;
    } else {
      legs.forEach(lg => { lg.rotation.x *= 0.85; });
      standLower.rotation.z = Math.sin(t * 1.1) * 0.008;
      if (ud.pose === 'stand' && !ud.customArms) {
        armL.rotation.x *= 0.9; armR.rotation.x *= 0.9;
        body.position.y = Math.sin(t * 1.6) * 0.003;
      }
    }
    if (ud.extraUpdate) ud.extraUpdate(dt);
  };
  return root;
}
