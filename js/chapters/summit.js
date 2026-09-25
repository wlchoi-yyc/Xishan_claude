// 第七關：西山之頂——重組全景
// 第八關：為甚麼西山「怪特」？
// 第九關：找到柳宗元（山頂黃昏）
// 終章：精神之境
import { E, THREE, ui, audio, enter, clue, watch, until, dist2D } from './common.js';
import { addInteractable, removeInteractable, freeze, unfreeze, wait, lookAt, moveTo, turnTo, tween, setControls, lerp, angleDiff, resetYawAccum, getYawAccum, isLookingAt, yawPitchTo } from '../engine.js';
import {
  baseScene, makeTerrain, makeTrees, scatter, makeRock, makeGrassPatch, makeRibbon, makeFootprints, pathPoints, makePerson, makeWinePot, makeCup, makeStaff,
  fbm, noise2, rng, mixHex, smoothstep, lam,
} from '../world.js';
import { RECON } from '../data.js';

// ---------------- 地形 ----------------
const LEDGE = { x: -19, z: 4.5, y: -5.2 };   // 柳宗元坐的崖邊（山頂之下的一塊突石）
const RIM = { x: -11, z: 2 };
const TOP_R = 12;
const DOME = 0.03;

const lowBumps = (() => {
  const r = rng(404), out = [];
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2, d = 380 + Math.pow(r(), 0.7) * 2300;
    out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h: (r() < 0.12 ? -1 : 1) * (12 + r() * 40), s: 30 + r() * 70 });
  }
  return out;
})();
const RIVERS = [
  [{ x: 2600, z: -900 }, { x: 1600, z: -600 }, { x: 900, z: -750 }, { x: 500, z: -420 }, { x: 200, z: -600 }, { x: -300, z: -500 }, { x: -800, z: -900 }, { x: -1500, z: -700 }, { x: -2600, z: -1100 }],
  [{ x: 700, z: 2600 }, { x: 800, z: 1700 }, { x: 550, z: 1100 }, { x: 750, z: 600 }, { x: 600, z: 300 }, { x: 900, z: -100 }, { x: 700, z: -500 }, { x: 900, z: -1200 }, { x: 700, z: -2600 }],
  [{ x: -2600, z: 900 }, { x: -1800, z: 700 }, { x: -1200, z: 1000 }, { x: -600, z: 700 }, { x: -300, z: 1100 }, { x: 200, z: 900 }, { x: 600, z: 1100 }],
];
function distToPolyline(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}
function distSeg(x, z, a, b) { return distToPolyline(x, z, [a, b]); }
function summitRim() { return -DOME * Math.hypot(RIM.x, RIM.z) ** 2; }

function summitH(x, z) {
  const r = Math.hypot(x, z);
  let h = -DOME * r * r + fbm(x * 0.08, z * 0.08, 3, 1) * 0.35;
  if (r > TOP_R) {
    const rim = -DOME * TOP_R * TOP_R;
    h = rim - 262 * (1 - Math.exp(-(r - TOP_R) / 85)) + fbm(x * 0.03, z * 0.03, 3, 2) * 6 * Math.min(1, (r - TOP_R) / 30);
  }
  // 崖邊小平台與下去的小徑
  const dl = Math.hypot(x - LEDGE.x, z - LEDGE.z);
  const ds = distSeg(x, z, RIM, LEDGE);
  if (ds < 6) { const t = Math.min(1, Math.hypot(x - RIM.x, z - RIM.z) / Math.hypot(LEDGE.x - RIM.x, LEDGE.z - RIM.z)); h = Math.max(h, lerp(summitRim(), LEDGE.y, t) - (ds > 1.4 ? (ds - 1.4) * 8 : 0)); }
  if (dl < 8) h = Math.max(h, LEDGE.y - (dl > 3 ? (dl - 3) * 6 : 0) + fbm(x * 0.3, z * 0.3, 2, 5) * 0.15);
  // 遠方的「培塿」與穴
  if (r > 300) {
    for (const b of lowBumps) { const dx = x - b.x, dz = z - b.z, d2 = dx * dx + dz * dz; if (d2 < 9 * b.s * b.s) h += b.h * Math.exp(-d2 / (2 * b.s * b.s)); }
    h += fbm(x * 0.002, z * 0.002, 4, 7) * 30;
    for (const rv of RIVERS) { const d = distToPolyline(x, z, rv); if (d < 90) h = lerp(h, -275, 1 - smoothstep(20, 90, d)); }
    // 天邊的群山
    h += smoothstep(2000, 2900, r) * (60 + fbm(x * 0.003, z * 0.003, 3, 11) * 80);
  }
  return h;
}
function summitColor(h, slope, x, z) {
  const n = noise2(x * 0.004, z * 0.004, 3) * 0.5 + 0.5;
  const r = Math.hypot(x, z);
  if (r < 26) {
    let c = mixHex('#6f8446', '#8a8f55', noise2(x * 0.2, z * 0.2, 4) * 0.5 + 0.5);
    if (slope > 0.4) c = mixHex(c, '#9a927f', 0.7);
    return c;
  }
  if (r < 400) { let c = mixHex('#3f5d3a', '#4d6a3e', n); if (slope > 0.4) c = mixHex(c, '#bfb49a', smoothstep(0.4, 0.7, slope)); return c; }
  // 青山
  let c = mixHex('#5d7d58', '#6f8c5c', n);
  if (h > -230) c = mixHex(c, '#4d7263', smoothstep(-230, -180, h));
  if (h < -260) c = mixHex(c, '#8d9270', 0.4);
  return c;
}

// ---------------- 場景 ----------------
function buildSummit() {
  const B = baseScene({
    fog: '#d9e2e4', fogNear: 300, fogFar: 3600,
    sky: { top: '#5f95c8', horizon: '#dde6e6', sunDir: [-0.6, 0.55, 0.2], sunColor: '#fff2d4', radius: 5000 },
    hemi: ['#e6eef4', '#5b5a44', 1.25], sun: ['#fff2d8', 1.6, [-300, 280, 100]],
  });
  const { scene } = B;
  E.camera.far = 9000; E.camera.updateProjectionMatrix();
  const near = makeTerrain({ size: 800, seg: 200, heightAt: summitH, colorAt: summitColor });
  scene.add(near);
  const far = makeTerrain({ size: 6400, seg: 220, heightAt: (x, z) => { const r = Math.hypot(x, z); return r < 380 ? summitH(x, z) - 60 : summitH(x, z) - (r < 600 ? 1.5 : 0); }, colorAt: summitColor });
  scene.add(far);
  // 白水
  const riverMats = [];
  for (const rv of RIVERS) {
    const pts = pathPoints(rv, 25);
    const m = makeRibbon(pts, 38, () => -272, { color: '#e3eef0', lift: 0, opacity: 1 });
    m.material = new THREE.MeshPhongMaterial({ color: '#dfeaec', emissive: '#6f8a90', emissiveIntensity: 0.3, shininess: 120, side: THREE.DoubleSide });
    riverMats.push(m.material);
    scene.add(m);
  }
  // 山頂的樹與石
  const trees = [{ type: 'pine', x: 7, z: -9, s: 1.1, rot: 1 }, { type: 'pine', x: 4, z: 10, s: 0.9, rot: 2 }];
  scene.add(makeTrees(trees, summitH));
  // 遠處山坡的樹（稀疏、大）
  const farTrees = scatter(700, 29, (x, z, r) => { const d = Math.hypot(x, z); if (d < 45 || d > 380) return false; return { type: 'pine', s: 3 + r() * 2 }; }, { x0: -380, x1: 380, z0: -380, z1: 380 });
  scene.add(makeTrees(farTrees, summitH));
  const rr = rng(71);
  const rockPos = [[8, 5.5], [6.5, -6.5], [9.5, -1.5]];
  rockPos.forEach(([x, z], i) => { const s = 1 + rr() * 1.4; const m = makeRock(s, '#948d7c', 700 + i); m.position.set(x, summitH(x, z) + s * 0.3, z); m.scale.y = 0.8 + rr() * 0.8; scene.add(m); });
  for (let i = 0; i < 12; i++) { const a = rr() * 6.28, d = 4 + rr() * 7; const x = Math.cos(a) * d, z = Math.sin(a) * d; if (x < 2) continue; const g = makeGrassPatch(8, 0.8, { seed: 800 + i, color: '#9aa35c', height: 0.4 }); g.position.set(x, summitH(x, z), z); scene.add(g); }
  // 雲
  const cloudM = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
  const clouds = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(60 + rr() * 80, 1), cloudM);
    const a = rr() * 6.28, d = 1500 + rr() * 2200;
    c.position.set(Math.cos(a) * d, -40 + rr() * 260, Math.sin(a) * d); c.scale.y = 0.25; clouds.add(c);
  }
  scene.add(clouds);
  // 星與月（夜晚才出現）
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 900; i++) { const u = rr() * 2 - 1, th = rr() * 6.28; const y = Math.abs(u); const k = Math.sqrt(1 - y * y); sp.push(Math.cos(th) * k * 4500, y * 4500 + 100, Math.sin(th) * k * 4500); }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#fff8e6', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(90, 32), new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0, fog: false }));
  moon.position.set(2600, 1500, -3000); moon.lookAt(0, 0, 0); scene.add(moon);

  // 走動範圍：山頂平台＋往崖邊的小徑＋崖邊平台
  const valid = (x, z) => Math.hypot(x, z) < TOP_R - 0.8 || distSeg(x, z, RIM, LEDGE) < 1.3 || Math.hypot(x - LEDGE.x, z - LEDGE.z) < 2.8;
  const clamp = (v) => {
    if (valid(v.x, v.z)) return;
    const c = E.player.pos;
    if (valid(v.x, c.z)) { v.z = c.z; return; }
    if (valid(c.x, v.z)) { v.x = c.x; return; }
    v.x = c.x; v.z = c.z;
  };
  return {
    scene, heightAt: summitH, clamp,
    blockers: rockPos.map(([x, z]) => ({ x, z, r: 1.1 })).concat(trees.map(t => ({ x: t.x, z: t.z, r: 0.5 }))),
    walkables: [near],
    sky: B.sky, sunLight: B.sun, hemi: B.hemi, riverMats, stars, moon, clouds,
    update: (dt, t) => { clouds.rotation.y += dt * 0.002; },
  };
}

// ---------------- 天色 ----------------
function skyState(w) {
  const u = w.sky.uniforms;
  return {
    top: u.top.value.clone(), horizon: u.horizon.value.clone(), bottom: u.bottom.value.clone(), sunColor: u.sunColor.value.clone(), sunDir: u.sunDir.value.clone(),
    fog: w.scene.fog.color.clone(), near: w.scene.fog.near, far: w.scene.fog.far,
    hemiSky: w.hemi.color.clone(), hemiGround: w.hemi.groundColor.clone(), hemiI: w.hemi.intensity, sunI: w.sunLight.intensity, sunL: w.sunLight.color.clone(),
    dark: u.dark.value, stars: w.stars.material.opacity, moon: w.moon.material.opacity, river: w.riverMats[0].emissiveIntensity,
  };
}
const C = (h) => new THREE.Color(h);
async function skyTo(w, target, dur) {
  const a = skyState(w);
  const u = w.sky.uniforms;
  const tc = (k) => ({
    top: target.top ? C(target.top) : a.top, horizon: target.horizon ? C(target.horizon) : a.horizon, sunColor: target.sunColor ? C(target.sunColor) : a.sunColor,
    fog: target.fog ? C(target.fog) : a.fog, hemiSky: target.hemiSky ? C(target.hemiSky) : a.hemiSky, hemiGround: target.hemiGround ? C(target.hemiGround) : a.hemiGround, sunL: target.sunL ? C(target.sunL) : a.sunL,
  });
  const T = tc();
  const sd = target.sunDir ? new THREE.Vector3(...target.sunDir).normalize() : a.sunDir;
  await tween(dur, k => {
    u.top.value.lerpColors(a.top, T.top, k);
    u.horizon.value.lerpColors(a.horizon, T.horizon, k);
    u.bottom.value.copy(u.horizon.value);
    u.sunColor.value.lerpColors(a.sunColor, T.sunColor, k);
    u.sunDir.value.lerpVectors(a.sunDir, sd, k).normalize();
    w.scene.fog.color.lerpColors(a.fog, T.fog, k);
    w.scene.background.copy(w.scene.fog.color);
    if (target.near !== undefined) w.scene.fog.near = lerp(a.near, target.near, k);
    if (target.far !== undefined) w.scene.fog.far = lerp(a.far, target.far, target.farEase ? Math.pow(k, 0.5) : k);
    w.hemi.color.lerpColors(a.hemiSky, T.hemiSky, k);
    w.hemi.groundColor.lerpColors(a.hemiGround, T.hemiGround, k);
    if (target.hemiI !== undefined) w.hemi.intensity = lerp(a.hemiI, target.hemiI, k);
    if (target.sunI !== undefined) w.sunLight.intensity = lerp(a.sunI, target.sunI, k);
    w.sunLight.color.lerpColors(a.sunL, T.sunL, k);
    w.sunLight.position.copy(u.sunDir.value).multiplyScalar(400);
    if (target.dark !== undefined) u.dark.value = lerp(a.dark, target.dark, k);
    if (target.stars !== undefined) w.stars.material.opacity = lerp(a.stars, target.stars, k);
    if (target.moon !== undefined) w.moon.material.opacity = lerp(a.moon, target.moon, k);
    if (target.river !== undefined) w.riverMats.forEach(m => m.emissiveIntensity = lerp(a.river, target.river, k));
    if (target.sunStrength !== undefined) u.sunStrength.value = lerp(u.sunStrength.value, target.sunStrength, k);
  }, t => t);
}

// ================= 第七關 =================
let W = null;
export async function chapter7() {
  audio.ambience({ wind: 0.7, water: 0, birds: 0.3 });
  audio.music('xishan');
  W = await enter(buildSummit, { x: -3, z: -1, yaw: Math.PI / 2, pitch: -0.14 }, { fade: 1.6 });
  ui.showDpad(true);
  await ui.chapterCard('第七關', '西山之頂', '全遊戲第一個高潮');
  freeze();
  await ui.say('', '你終於登上了西山之頂。');
  await ui.say('', '山頂上……沒有人。');
  await ui.say('你', '柳先生呢？');
  ui.hideDialog();
  // 緩緩環視
  await turnTo(Math.PI / 2 + 0.9, -0.12, 3);
  await turnTo(Math.PI / 2 - 0.9, -0.12, 4);
  await turnTo(Math.PI / 2, -0.1, 2);
  await ui.say('', '眼前只有一個極廣闊的世界。');
  ui.hideDialog();
  await ui.caption('攀援而登，箕踞而遨，則凡數州之土壤，皆在衽席之下。', { gloss: '攀爬上山，隨意地伸開兩腿坐着遊賞，幾個州的土地，全都在坐席之下。', hold: 7.5 });
  ui.journalAdd('字詞', '箕踞：兩腿伸直岔開而坐，形如簸箕，是隨意自在的坐姿。遨：遊賞。衽席：坐席。', '箕踞而遨');
  ui.journalAdd('景物', '數州的土地都在坐席之下——山極高，視野極廣。', '則凡數州之土壤，皆在衽席之下');
  ui.setMood('open');
  await ui.say('你', '柳先生站在這裏的時候，看見的也是這些嗎？');
  ui.hideDialog();

  // ------ 重建柳宗元所見之景 ------
  ui.objective('重建柳宗元所見之景（0／4）', '拖曳畫面環顧四周，點擊遠處發光的標記。');
  setControls({ move: true, look: true, interact: true });
  let n = 0;
  const prog = () => ui.objective(`重建柳宗元所見之景（${n}／4）`, '拖曳畫面環顧四周，點擊遠處發光的標記。');
  const spot = (x, z, label, r = 60) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(x, summitH(x, z) + 30, z);
    W.scene.add(m);
    return m;
  };
  const sUpDown = spot(-380, -560, '高低起伏的地勢', 70);
  const sFar = spot(-2200, 900, '遠處的土地', 160);
  const sGreen = spot(900, -300, '青山與白水', 110);

  const pUpDown = clue(sUpDown, '高低起伏的地勢', async () => {
    await lookAt(sUpDown.position, 1.2);
    await ui.say('', '從山頂往下看：有的地方隆起，像蟻穴旁的小土堆；有的地方凹陷，像一個個洞穴。');
    ui.hideDialog();
    await ui.caption('其高下之勢，岈然窪然，若垤若穴。', { gloss: '岈然：山谷空闊深邃的樣子；窪然：低凹的樣子。高的像小土堆（垤），低的像洞穴。', hold: 7.5 });
    ui.journalAdd('景物', '地勢高低起伏：高處像小土堆，低處像洞穴。', '岈然窪然，若垤若穴');
    ui.journalAdd('字詞', '岈然：山谷空闊深邃貌。窪然：低陷貌。垤：蟻穴外隆起的小土堆。', '岈然窪然');
  }, { walk: false, range: 1e9 }).then(() => { n++; prog(); });

  const pFar = clue(sFar, '遠處的土地', async () => {
    await lookAt(sFar.position, 1.2);
    await ui.say('', '把目光推向最遠的地方——');
    ui.hideDialog();
    E.fovTarget = 16;
    audio.whoosh();
    await wait(3);
    await ui.say('', '千里之外的山河，看起來卻只有尺寸之大，一層層擠在一起，全都擺在眼前。');
    ui.hideDialog();
    E.fovTarget = 70;
    await wait(1.5);
    await ui.caption('尺寸千里，攢蹙累積，莫得遯隱。', { gloss: '千里之遙，看起來只在尺寸之間；遠方景物聚攏、堆疊，沒有一處能躲藏起來。', hold: 7.5 });
    ui.journalAdd('景物', '千里之遠，縮成尺寸；景物聚攏重疊，無一能隱藏。', '尺寸千里，攢蹙累積，莫得遯隱');
    ui.journalAdd('字詞', '攢蹙：聚集收縮。遯隱：躲藏。', '攢蹙累積');
  }, { walk: false, range: 1e9 }).then(() => { n++; prog(); });

  const pGreen = clue(sGreen, '青山與白水', async () => {
    await lookAt(sGreen.position, 1.2);
    await tween(2, k => W.riverMats.forEach(m => m.emissiveIntensity = 0.3 + k * 0.5));
    await ui.say('', '青色的山巒一重接一重，白色的江水在山間迴環纏繞，一直伸向天邊，和天空連在一起。');
    ui.hideDialog();
    await ui.caption('縈青繚白，外與天際。', { gloss: '青山白水互相縈繞，向外延伸到天邊，與天相接。', hold: 7 });
    await tween(2, k => W.riverMats.forEach(m => m.emissiveIntensity = 0.8 - k * 0.5));
    ui.journalAdd('景物', '青山白水互相縈繞，一直延伸到天邊。', '縈青繚白，外與天際');
  }, { walk: false, range: 1e9 }).then(() => { n++; prog(); });

  await Promise.all([pUpDown, pFar, pGreen]);

  // 四望如一
  freeze();
  await ui.say('你', '還有……');
  ui.hideDialog();
  ui.objective('慢慢轉身一周，環顧四方（0%）', '按住畫面向左或向右拖曳，轉一整圈。');
  setControls({ move: false, look: true, interact: false });
  resetYawAccum();
  await new Promise(res => {
    const fn = () => {
      const pct = Math.min(100, Math.round(getYawAccum() / (Math.PI * 2) * 100));
      document.getElementById('objText').textContent = `慢慢轉身一周，環顧四方（${pct}%）`;
      if (pct >= 100) { E.onUpdate.splice(E.onUpdate.indexOf(fn), 1); res(); }
    };
    E.onUpdate.push(fn);
  });
  freeze();
  n++; prog();
  await ui.caption('四望如一。', { gloss: '向四方望去，景色都一樣，渾然一體。', hold: 5 });
  ui.journalAdd('景物', '向四方望去，渾然一體。', '四望如一');
  await ui.caption('然後知是山之特立，不與培塿為類。', { gloss: '這才知道西山高聳特出，不與小土丘同類。培塿：小土丘。', hold: 7 });
  ui.journalAdd('字詞', '特立：高聳特出。培塿：小土丘。', '然後知是山之特立，不與培塿為類');
  ui.journalAdd('景物', '西山特立，不與小土丘同類——這就是西山的「怪特」。', '是山之特立');
  ui.objective('');
}

// ================= 第八關 =================
export async function chapter8() {
  if (!W) { W = await enter(buildSummit, { x: -3, z: -1, yaw: Math.PI / 2, pitch: -0.14 }); audio.music('xishan'); audio.ambience({ wind: 0.7, birds: 0.3 }); }
  freeze();
  await ui.chapterCard('第八關', '為甚麼西山「怪特」？', '');
  await ui.say('你', '柳先生以前明明已經「遊遍」永州……');
  await ui.say('你', '為甚麼他會覺得，今天才是真正開始「遊」？');
  ui.hideDialog();
  const left = `<svg viewBox="0 0 300 180"><rect width="300" height="180" fill="#e9e1cb"/>
    <path d="M0 150 Q40 110 80 140 T160 135 T240 140 T300 130 V180 H0Z" fill="#9aa87a"/>
    <path d="M0 165 Q60 140 120 160 T300 155 V180 H0Z" fill="#7e9161"/>
    <g fill="#6d6250"><ellipse cx="110" cy="152" rx="22" ry="5"/><ellipse cx="140" cy="155" rx="22" ry="5"/><circle cx="90" cy="150" r="5"/><circle cx="160" cy="153" r="5"/></g>
    <path d="M175 146 l10 -14 l6 3 l-8 13z" fill="#7d8b75"/>
    <text x="150" y="112" font-size="22" fill="#6d6250" text-anchor="middle" font-family="LXGW WenKai TC, serif">Ｚｚｚ</text>
    <text x="150" y="40" font-size="17" fill="#3a2a1c" text-anchor="middle" font-family="LXGW WenKai TC, serif">坐 → 醉 → 臥 → 夢 → 歸</text>
    <path d="M60 60 A 90 30 0 1 0 240 60" fill="none" stroke="#b3372b" stroke-width="2" stroke-dasharray="5 4"/>
    <path d="M236 52 l6 9 l-10 2" fill="none" stroke="#b3372b" stroke-width="2"/></svg>`;
  const right = `<svg viewBox="0 0 300 180"><defs><linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb6d8"/><stop offset="1" stop-color="#e8edea"/></linearGradient></defs>
    <rect width="300" height="180" fill="url(#skyg)"/>
    <circle cx="245" cy="45" r="14" fill="#fff4d6"/>
    <path d="M0 128 Q30 122 60 128 T120 126 T180 128 T240 125 T300 128 V180 H0Z" fill="#8aa07c"/>
    <path d="M0 140 C 50 132, 90 150, 150 138 S 250 150, 300 138" fill="none" stroke="#f4f8f8" stroke-width="4"/>
    <path d="M20 160 C 80 150, 140 170, 200 156 S 280 168, 300 160" fill="none" stroke="#f4f8f8" stroke-width="3"/>
    <path d="M110 180 L150 70 L190 180Z" fill="#4f6b3d"/>
    <path d="M150 70 L162 100 L150 96 L140 104Z" fill="#c9bfa6"/>
    <circle cx="150" cy="63" r="3.4" fill="#3a3a3a"/><path d="M146 67 h8 l2 6 h-12z" fill="#a7b3b0"/>
    <path d="M150 63 m-30 -10 a40 20 0 0 1 60 0" fill="none" stroke="#fff" stroke-width="1.5" opacity=".7"/>
    <path d="M150 63 m-55 -18 a70 34 0 0 1 110 0" fill="none" stroke="#fff" stroke-width="1.2" opacity=".5"/></svg>`;
  await ui.question({
    tag: '理解',
    title: '柳宗元以前已遊遍永州山水，為甚麼今天才認為自己真正開始「遊」？',
    lead: `比較兩幅畫面，再選出最能解釋的「理解卡」。
      <div class="compare"><figure>${left}<figcaption><b>以前遊山</b>：披草而坐，傾壺而醉，更相枕以臥，臥而夢，覺而起，起而歸。</figcaption></figure>
      <figure>${right}<figcaption><b>今日西山</b>：尺寸千里，縈青繚白，外與天際，四望如一。</figcaption></figure></div>`,
    options: [
      { label: '「西山比以前的山更高。」', feedback: '西山確實高——但他以前也「上高山」。單是山的外形不同，還不足以說「遊於是乎始」。' },
      { label: '「柳宗元在西山感受到自己與天地自然融為一體。」', correct: true, feedback: '<b>不只是山的外形不同，而是柳宗元的精神境界改變了。</b><br>以前他人到了，心卻沒有投入：坐、醉、臥、夢、歸，只是借遊排遣憂懼。今天在西山，他的心與浩大的天地相通——這才是真正的「遊」。' },
      { label: '「因為今日喝了更多酒。」', feedback: '以前他也「傾壺而醉」。喝酒並不是分別所在。' },
      { label: '「因為以前沒有朋友同行。」', feedback: '以前他「日與其徒」同遊，並不孤單。' },
    ],
  });
  await ui.caption('悠悠乎與灝氣俱，而莫得其涯；洋洋乎與造物者遊，而不知其所窮。', { gloss: '心神悠悠，與天地間浩大之氣同在，找不到它的邊際；洋洋自得，與大自然一同遨遊，不知道它的盡頭。', hold: 9 });
  ui.journalAdd('心境', '心與天地浩氣同在，與大自然同遊，無邊無際。', '悠悠乎與灝氣俱，而莫得其涯；洋洋乎與造物者遊，而不知其所窮');
  ui.journalAdd('字詞', '灝氣：天地間浩大的元氣。造物者：大自然。窮：盡頭。', '與造物者遊');
  ui.setMood('serene');
}

// ================= 第九關 ＋ 終章 =================
export async function chapter9() {
  if (!W) { W = await enter(buildSummit, { x: -3, z: -1, yaw: Math.PI / 2, pitch: -0.14 }); }
  const w = W, scene = w.scene;
  freeze();
  audio.music(null, 4);
  audio.ambience({ wind: 0.5, water: 0, birds: 0.45 }, 3);
  // 時間流逝：黃昏
  const golden = skyTo(w, { top: '#5a7fb2', horizon: '#f0d2a2', sunColor: '#ffd08a', sunDir: [-1, 0.16, 0.1], fog: '#e8d4b0', hemiSky: '#f3dfbf', hemiGround: '#5a4a3a', hemiI: 1.1, sunI: 1.5, sunL: '#ffcf96' }, 6);
  await ui.chapterCard('第九關', '找到柳宗元', '山頂・黃昏');
  await golden;

  // 柳宗元（背對玩家，坐在崖邊）
  const liu = makePerson({ robe: '#a7b3b0', inner: '#ece5d4', beard: true, cap: 'scholar', skin: '#dfb792' });
  liu.userData.setPose('sit');
  liu.position.set(LEDGE.x, LEDGE.y, LEDGE.z);
  liu.rotation.y = -Math.PI / 2; // 面向西（夕陽）
  scene.add(liu); E.persons.add(liu);
  const pot = makeWinePot('#7d8b75'); pot.position.set(LEDGE.x + 0.1, LEDGE.y, LEDGE.z - 0.75); scene.add(pot);
  const cup = makeCup(); cup.scale.setScalar(1.4); cup.position.set(LEDGE.x - 0.3, LEDGE.y + 0.02, LEDGE.z - 0.55); scene.add(cup);
  w.blockers.push({ x: LEDGE.x, z: LEDGE.z, r: 0.5 });
  // 足跡：從山頂一路到崖邊
  const fp = pathPoints([{ x: 5, z: 2 }, { x: 1, z: 3.5 }, { x: -4, z: 3 }, { x: -8, z: 2.5 }, RIM, { x: (RIM.x + LEDGE.x) / 2, z: (RIM.z + LEDGE.z) / 2 }, { x: LEDGE.x + 1.6, z: LEDGE.z - 0.3 }], 0.75);
  scene.add(makeFootprints(fp, summitH, { opacity: 0.6 }));

  await ui.say('', '夕陽西斜。山頂的泥地上，有一行腳印。');
  await ui.say('', '腳印繞過石堆，一直通向西邊的崖邊。');
  ui.hideDialog();
  ui.objective('循着腳印走', '跟着地上的腳印走。');
  unfreeze();
  ui.showDpad(true);

  // 靜靜走近——不顯示「你找到柳宗元了！」
  await until(() => dist2D(E.player.pos, { x: LEDGE.x, z: LEDGE.z }) < 9);
  ui.objective('');
  audio.ambience({ wind: 0.35, birds: 0.6 }, 2);
  await until(() => dist2D(E.player.pos, { x: LEDGE.x, z: LEDGE.z }) < 3.6);
  freeze();
  audio.step();
  await wait(0.8);
  // 他聽到腳步聲，慢慢回頭
  const headTarget = () => new THREE.Vector3(liu.position.x, liu.position.y + 1.05, liu.position.z);
  await lookAt(headTarget(), 1.2);
  await wait(0.6);
  // 先轉頭，再慢慢轉身
  liu.userData.bodyFollow = false;
  liu.userData.turnSpeed = 0.9;
  watch(liu, true);
  await wait(2.2);
  liu.userData.bodyFollow = true;
  liu.userData.turnSpeed = 1.1;
  await wait(1.6);
  await ui.whisper('……是柳宗元。', { hold: 2.2 });
  await ui.say('柳宗元', '你怎麼也尋到這裏來了？');
  await ui.choose([{ label: '大家都在找你。天快黑了，我們一起下山吧。' }], { name: '你' });
  // 他望向遠處，停頓
  watch(liu, false);
  liu.userData.lookTarget = new THREE.Vector3(-2000, -150, 200);
  await ui.say('柳宗元', '下山？', { auto: 0 });
  ui.hideDialog();
  await wait(1.8);
  watch(liu, true);
  await wait(1);
  await ui.say('柳宗元', '我現在……仍不想回去。');
  await ui.say('柳宗元', '既然你千辛萬苦來到這裏，不如先別急着走。');
  // 指向旁邊的位置
  liu.userData.customArms = true;
  await tween(0.8, k => { liu.userData.armL.rotation.set(lerp(-0.7, -1.2, k), 0, lerp(0.1, 0.9, k)); });
  await ui.say('柳宗元', '坐下來吧。');
  await tween(0.8, k => { liu.userData.armL.rotation.set(lerp(-1.2, -0.7, k), 0, lerp(0.9, 0.1, k)); });
  await ui.say('柳宗元', '不要想着趕路，也不要想別的事情。');
  await ui.say('柳宗元', '看看這山，看看遠處的水。');
  await ui.say('柳宗元', '我們一起坐一會兒，靜靜地感受——人和這片天地，原來可以合而為一。');
  await ui.say('柳宗元', '也許你便會明白，為甚麼我不想離開。');
  ui.hideDialog();
  await ui.bigAction('坐下');

  // 並肩而坐
  // 坐在柳宗元身旁稍後的位置：望向遠方時，他就在視野右邊
  const seat = { x: LEDGE.x + 0.8, z: LEDGE.z + 1.2 };
  await Promise.all([
    moveTo(seat.x, seat.z, 2.2, { eye: 0.95 }),
    turnTo(Math.PI / 2 - 0.22, -0.04, 2.4),
  ]);
  watch(liu, false);
  liu.userData.lookTarget = null;
  await tween(1.5, k => { liu.rotation.y = lerp(liu.rotation.y, -Math.PI / 2, k * 0.3); });
  liu.rotation.y = -Math.PI / 2;
  ui.showDpad(false);
  setControls({ move: false, look: true, interact: false });
  await wait(1.5);
  ui.journalAdd('活動', '在山頂崖邊，與柳宗元並肩而坐。');

  // ---------- 「與萬化冥合」：只體驗，不測驗 ----------
  await ui.whisper('先不要說話。', { who: '柳宗元', hold: 3.2 });
  audio.ambience({ wind: 0.45, birds: 0.35 }, 4);
  await wait(3);

  // 第一階段：尺寸千里
  E.fovTarget = 56;
  await ui.whisper('站在這裏，千里景物，都像聚集在眼前。', { who: '柳宗元', hold: 4 });
  const c1 = ui.caption('尺寸千里，攢蹙累積，莫得遯隱。', { hold: 4.5 });
  await wait(3);
  await c1;

  // 第二階段：天地包圍自己（黃昏）
  const dusk = skyTo(w, { top: '#34426e', horizon: '#ef8b5c', sunColor: '#ff9a5a', sunDir: [-1, 0.04, 0.12], fog: '#d99470', hemiSky: '#f0b38a', hemiGround: '#4a3638', hemiI: 0.95, sunI: 1.2, sunL: '#ff9c6a', river: 0.9 }, 12);
  audio.music('dusk', 6);
  await wait(3);
  ui.caption('縈青繚白', { hold: 4 });
  await wait(5);
  await ui.whisper('你還覺得自己是在「看」這座山嗎？', { who: '柳宗元', hold: 4 });
  await wait(2.5);
  await ui.whisper('還是……自己已經成為這天地的一部分？', { who: '柳宗元', hold: 4.5 });
  await dusk;

  // 第三階段：冥合——介面消失，「我」也消失
  setControls({ move: false, look: false, interact: false });
  await ui.fadeHUD(true, 4);
  audio.music('final', 5);
  audio.ambience({ wind: 0.7, water: 0.12, waterFreq: 400, birds: 0.5 }, 5);
  const canvas = document.getElementById('gl');
  canvas.style.transition = 'filter 6s ease';
  canvas.style.filter = 'saturate(1.25) brightness(1.06) blur(1.4px)';
  document.getElementById('vignette').style.opacity = '1';
  const p = E.player;
  const baseYaw = p.yaw;
  const drift = (dt) => { p.yaw = baseYaw + Math.sin(E.time * 0.12) * 0.12; p.pitch = -0.04 + Math.sin(E.time * 0.2) * 0.02; };
  E.onUpdate.push(drift);
  E.fovTarget = 64;
  await wait(2);
  await ui.whisper('不再想着自己。', { who: '柳宗元', hold: 3.5 });
  await wait(1.5);
  await ui.whisper('也不再想着眼前是山、是水。', { who: '柳宗元', hold: 3.8 });
  await ui.whisper('只是靜靜地留在天地之間。', { who: '柳宗元', hold: 4 });
  await wait(1);
  // 刻意停留，不能操作
  const merge = ui.caption('心凝形釋，與萬化冥合。', { hold: 9 });
  await wait(10);
  await merge;
  ui.journalAdd('心境', '精神凝定，形體彷彿消散，與萬物融合為一。', '心凝形釋，與萬化冥合');
  ui.journalAdd('字詞', '心凝：精神凝聚專注。形釋：形體好像消散。萬化：萬物。冥合：暗暗地融合為一。', '心凝形釋');
  canvas.style.filter = '';
  document.getElementById('vignette').style.opacity = '0';

  // 引觴滿酌
  liu.userData.customArms = true;
  const liuCup = makeCup(); liuCup.scale.setScalar(1.4); liu.userData.armR.add(liuCup); liuCup.position.set(0, -0.68, 0.06);
  scene.remove(cup);
  await tween(1.4, k => { liu.userData.armR.rotation.x = lerp(-0.7, -2.0, k); });
  const c2 = ui.caption('引觴滿酌，頹然就醉，不知日之入。', { gloss: '拿起酒杯斟滿，醉得東歪西倒，連太陽下山了也不知道。', hold: 6.5 });
  await wait(2);
  await tween(1.2, k => { liu.userData.armR.rotation.x = lerp(-2.0, -0.7, k); });
  await c2;
  ui.journalAdd('活動', '引觴滿酌，頹然就醉，不知日之入。', '引觴滿酌，頹然就醉，不知日之入');

  // 第四階段：蒼然暮色，自遠而至
  E.onUpdate.splice(E.onUpdate.indexOf(drift), 1);
  audio.ambience({ wind: 0.4, birds: 0, crickets: 0.8 }, 6);
  const dark = skyTo(w, { top: '#0b1022', horizon: '#253047', sunColor: '#40304a', sunDir: [-1, -0.1, 0.1], fog: '#1b2233', near: 0, far: 26, farEase: true, hemiSky: '#3a4666', hemiGround: '#111018', hemiI: 0.45, sunI: 0.05, sunL: '#553a50', dark: 0.35, river: 0.1 }, 16);
  await wait(4);
  const c3 = ui.caption('蒼然暮色，自遠而至，至無所見。', { gloss: '蒼茫的暮色由遠處漸漸逼近，直到甚麼也看不見。', hold: 8 });
  await dark;
  await c3;
  ui.journalAdd('景物', '暮色由遠而近，直到甚麼也看不見。', '蒼然暮色，自遠而至，至無所見');

  await ui.say('柳宗元', '天已黑了。');
  await ui.choose([{ label: '現在總該回去了吧？' }], { name: '你' });
  watch(liu, true);
  await wait(0.8);
  await ui.say('柳宗元', '是啊。');
  ui.hideDialog();
  await wait(1.6);
  await ui.say('柳宗元', '可惜，我還是不太捨得。');
  ui.hideDialog();
  await ui.caption('而猶不欲歸。', { gloss: '卻仍然不想回去。', hold: 5 });
  ui.journalAdd('心境', '天黑了，仍然不想回去——依戀這份天人合一的感受。', '而猶不欲歸');

  // 心境回來：心凝形釋
  await ui.fadeHUD(false, 2);
  ui.setMood('union');
  await wait(1.5);

  // ---------- 終章 ----------
  await epilogue(w, liu);
}

async function epilogue(w, liu) {
  const scene = w.scene;
  ui.objective('');
  ui.showDpad(false);
  // 燈籠：夜裏山頂上的一點暖光
  const lantern = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 10), new THREE.MeshBasicMaterial({ color: '#ffcf8a' }));
  paper.position.y = 0.2; lantern.add(paper);
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.05, 10), lam('#3a2a1c')); capTop.position.y = 0.37; lantern.add(capTop);
  const glow = new THREE.PointLight('#ffb870', 0, 14, 1.5); glow.position.y = 0.3; lantern.add(glow);
  lantern.position.set(LEDGE.x + 0.9, LEDGE.y, LEDGE.z + 0.4);
  scene.add(lantern);
  tween(4, k => { glow.intensity = k * 6; });
  // 月出：稍微看得見
  const night = skyTo(w, { top: '#101a36', horizon: '#34466a', fog: '#26324c', near: 20, far: 1400, hemiSky: '#8fa4d0', hemiGround: '#1c1c28', hemiI: 0.75, sunI: 0.25, sunL: '#9fb3e0', sunDir: [0.5, 0.35, -0.6], dark: 0.15, stars: 1, moon: 1, river: 0.35 }, 5);
  await ui.chapterCard('終章', '精神之境', '');
  await night;

  // 兩人站起來
  await ui.fadeOut(0.8);
  liu.userData.setPose('stand');
  liu.userData.customArms = false;
  liu.position.set(LEDGE.x - 0.2, LEDGE.y, LEDGE.z);
  E.player.eye = 1.6;
  E.player.pos.x = LEDGE.x + 1.6; E.player.pos.z = LEDGE.z + 1.2;
  watch(liu, true);
  const ht = new THREE.Vector3(liu.position.x, LEDGE.y + 1.7, liu.position.z);
  const yp = yawPitchTo(ht, new THREE.Vector3(E.player.pos.x, LEDGE.y + 1.6, E.player.pos.z));
  E.player.yaw = yp.yaw; E.player.pitch = yp.pitch;
  liu.rotation.y = Math.atan2(E.player.pos.x - liu.position.x, E.player.pos.z - liu.position.z);
  await ui.fadeIn(1.2);
  await wait(0.6);

  await ui.say('柳宗元', '你今天一直在找我。');
  await ui.say('柳宗元', '現在，你找到我了嗎？');
  const ans = await ui.choose([
    { label: 'A. 找到了，你就在西山。', value: 'A' },
    { label: 'B. 找到了，我知道你今天走過哪些地方。', value: 'B' },
    { label: 'C. 好像找到了，但我現在才開始明白你為甚麼來這裏。', value: 'C' },
  ], { name: '你' });
  if (ans === 'C') {
    ui.hideDialog();
    await ui.whisper('柳宗元微笑。', { hold: 2.4 });
  } else {
    await ui.say('柳宗元', '也對。');
  }
  watch(liu, false);
  liu.userData.lookTarget = new THREE.Vector3(-2000, -100, 300);
  await wait(1.2);
  await ui.say('柳宗元', '不過今天，我自己也像是第一次找到了一些東西。');
  await ui.choose([{ label: '甚麼？' }], { name: '你' });
  watch(liu, true);
  await wait(0.8);
  await ui.say('柳宗元', '以前，我以為自己早已遊遍永州。');
  ui.hideDialog();
  await wait(1.8);
  await ui.say('柳宗元', '今天才知道——');
  ui.hideDialog();

  // 鏡頭慢慢離開，轉向西山：你和柳宗元並立山頂
  await ui.fadeHUD(true, 1.5);
  const you = makePerson({ robe: '#3d5f58', inner: '#e0d8c6', cap: 'band', skin: '#e2b999', scale: 0.95 });
  you.position.set(E.player.pos.x, LEDGE.y, E.player.pos.z);
  you.rotation.y = -Math.PI / 2;
  scene.add(you);
  liu.userData.lookTarget = new THREE.Vector3(-2000, -100, 300); watch(liu, false);
  await tween(2, k => { liu.rotation.y = lerp(liu.rotation.y, -Math.PI / 2 - 0.2, k); });
  const start = new THREE.Vector3(E.player.pos.x, E.player.pos.y, E.player.pos.z);
  const target = new THREE.Vector3(LEDGE.x, LEDGE.y + 1.4, LEDGE.z + 0.6);
  E.freeCam = { pos: start.clone(), target: start.clone().add(new THREE.Vector3(-10, 0, 0)) };
  audio.whoosh();
  const end = new THREE.Vector3(-150, 20, 115);
  const lookEnd = new THREE.Vector3(0, -40, 0);
  await tween(14, k => {
    const e = k * k * (3 - 2 * k);
    E.freeCam.pos.lerpVectors(start, end, e);
    E.freeCam.pos.y += Math.sin(e * Math.PI) * 20;
    E.freeCam.target.lerpVectors(target, lookEnd, Math.min(1, e * 1.4));
  }, t => t);
  await ui.caption('然後知吾嚮之未始遊，遊於是乎始。', { gloss: '這才知道我從前未曾真正遊賞過；真正的遊賞，從這一次才開始。', hold: 0 });
  ui.journalAdd('心境', '從前未曾真正遊賞；真正的「遊」，從這一次西山之遊才開始。', '然後知吾嚮之未始遊，遊於是乎始');
  await wait(8);
  await ui.hideCaption();
  await ui.chapterCard('', '《尋找柳宗元》', '');
  await ui.whisper('原來「尋找柳宗元」，不只是你在尋找柳宗元——也是柳宗元在西山，重新找到了自己。', { hold: 7 });
  await ui.caption('故為之文以志。是歲，元和四年也。', { gloss: '所以寫下這篇文章記錄這件事。這一年，是元和四年（公元 809 年）。', hold: 6 });
  ui.litText('故為之文以志');
  ui.litText('是歲，元和四年也');
  ui.litText('今年九月二十八日');
  await ending();
}

async function ending() {
  const table = RECON.map(sec => sec.rows.map((r, i) => `<tr>${i === 0 ? `<td class="stage" rowspan="${sec.rows.length}">${sec.stage}</td>` : ''}<th>${r[0]}</th><td>${r[1]}</td></tr>`).join('')).join('');
  const html = `<div class="endTitle"><h2><span class="seal">遊記</span>你重建的《始得西山宴遊記》</h2></div>
    <p class="lead">你追尋柳宗元的每一步，都是文章的一部分：遊蹤、活動、景物、心境——由「未遊西山」到「始遊西山」。</p>
    <table class="recon">${table}</table>
    <h2 style="margin-top:22px;font-size:20px">原文（你親身重建的句子已標亮）</h2>
    ${ui.fullTextHTML()}
    <div style="text-align:center;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="primary" id="endJournal">翻看日誌</button>
      <button class="primary" id="endReplay" style="background:#3d5f58">再玩一次</button>
    </div>`;
  const p = ui.modal(html, { closable: false });
  document.getElementById('endJournal').addEventListener('click', async () => { ui.closeModal(); await ui.openJournal('心境'); ending(); });
  document.getElementById('endReplay').addEventListener('click', () => { location.href = location.pathname; });
  await p;
}
