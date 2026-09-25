// 第三關：法華西亭——第一個真正的線索
// 第四關（上）：亭下的僕人
import { E, THREE, ui, audio, enter, clue, watch, until, dist2D } from './common.js';
import { addInteractable, removeInteractable, freeze, unfreeze, wait, lookAt, moveTo, turnTo, tween, setControls, isLookingAt, lerp } from '../engine.js';
import { baseScene, makeTerrain, makeTrees, scatter, makeRock, makeGrassPatch, makePavilion, makeHouse, makePerson, fbm, noise2, rng, mixHex, smoothstep, lam } from '../world.js';
import { makeClouds, makeMist, makeGrassField, makePinnacle, terrace } from '../scenery.js';

// 西山位置（相對法華西亭）
export const XISHAN = { x: -900, z: -150, h: 250 };

// 西山的形狀：陡峭、有稜角、與四周圓潤的小山不同
const XS_PEAKS = [[0, 0, 1.0, 260], [85, -70, 0.72, 150], [-95, 45, 0.62, 140], [35, 115, 0.55, 120], [-60, -110, 0.48, 110]];
export function xishanShape(x, z, cx, cz, H) {
  let h = 0, baseMax = 0;
  for (const [ox, oz, w, R] of XS_PEAKS) {
    const dx = x - cx - ox, dz = z - cz - oz;
    const d = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    const ridge = 1 + 0.2 * Math.sin(ang * 5 + ox) + 0.1 * Math.sin(ang * 11 + oz);
    const base = Math.max(0, 1 - d / (R * ridge));
    baseMax = Math.max(baseMax, base);
    h = Math.max(h, H * w * Math.pow(base, 1.45));
  }
  // 稜角分明的岩脊
  const crag = (1 - Math.abs(noise2(x * 0.018, z * 0.018, 44))) * 0.16 * H * baseMax;
  // 一級級斷崖：西山的「怪特」
  return terrace(h + crag, H * 0.075, 0.7 * Math.min(1, baseMax * 3));
}

/** 西山的岩壁顏色：平台長樹、崖壁灰白，並有一道道岩層 */
export function xishanColor(h, slope, x, z, n) {
  let c = mixHex('#3f5d3a', '#56703f', n);
  const rock = mixHex('#c9bfa6', '#aaa08a', noise2(x * 0.05, h * 0.2, 7) * 0.5 + 0.5);
  c = c.lerp(rock, smoothstep(0.42, 0.62, slope));
  const strata = Math.abs(Math.sin(h * 0.35)) ;
  if (slope > 0.5) c.multiplyScalar(0.86 + strata * 0.18);
  return c;
}

/** 西山四周的石峰（永州一帶的喀斯特地貌） */
export function addXishanPinnacles(scene, cx, cz, heightAt, seed = 3, count = 9) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = 130 + r() * 170;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const h = 45 + r() * 75;
    const p = makePinnacle(h, seed * 10 + i, { width: 0.2 + r() * 0.1 });
    p.position.set(x, heightAt(x, z) - 6, z);
    scene.add(p);
  }
}

/** 通用的「秋日山林」地面著色：草地、秋黃、裸土斑塊 */
export function autumnGround(x, z, base) {
  const n1 = noise2(x * 0.004, z * 0.004, 31) * 0.5 + 0.5;
  const n2 = noise2(x * 0.03, z * 0.03, 32) * 0.5 + 0.5;
  let c = base.clone();
  c.lerp(new THREE.Color('#a39a58'), smoothstep(0.62, 0.85, n1) * 0.55);
  c.lerp(new THREE.Color('#8a7a58'), smoothstep(0.75, 0.95, n2) * 0.35);
  c.multiplyScalar(0.92 + n2 * 0.16);
  return c;
}

const bumps = (() => {
  const r = rng(88), out = [];
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = 140 + r() * 1100;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - XISHAN.x, z - XISHAN.z) < 330) continue;
    if (x < -220 && x > -380) continue; // 湘江河道
    out.push({ x, z, h: 10 + r() * 26, s: 45 + r() * 60 });
  }
  return out;
})();

function vistaHeight(x, z) {
  let h = fbm(x * 0.004, z * 0.004, 4, 3) * 18;
  for (const b of bumps) { const dx = x - b.x, dz = z - b.z; const d2 = dx * dx + dz * dz; if (d2 < 9 * b.s * b.s) h += b.h * Math.exp(-d2 / (2 * b.s * b.s)); }
  // 亭所在的小山
  const d0 = Math.hypot(x, z);
  h += 75 * Math.exp(-(d0 * d0) / (2 * 55 * 55));
  if (d0 < 10) h = lerp(h, 75 + fbm(0, 0, 4, 3) * 18, 1 - smoothstep(6, 10, d0));
  // 湘江河道
  const riverX = -300 + Math.sin(z * 0.004) * 30;
  const dr = Math.abs(x - riverX);
  h = lerp(h, -6, 1 - smoothstep(50, 90, dr));
  // 西山
  h += xishanShape(x, z, XISHAN.x, XISHAN.z, XISHAN.h);
  return h;
}
function vistaColor(h, slope, x, z) {
  const dW = Math.hypot(x - XISHAN.x, z - XISHAN.z);
  const n = noise2(x * 0.01, z * 0.01, 8) * 0.5 + 0.5;
  if (dW < 300) {
    // 西山：蒼翠中露出淺色岩壁
    return xishanColor(h, slope, x, z, n);
  }
  let c = autumnGround(x, z, mixHex('#6f8a4a', '#8a9656', n));
  if (h < -2) c = mixHex('#7c7a5e', '#6d6a55', n);
  if (slope > 0.45) c = mixHex(c, '#7d735c', 0.5);
  return c;
}

function buildVista() {
  const B = baseScene({ fog: '#d5dcd6', fogNear: 150, fogFar: 2300, sky: { top: '#6e9cc6', sunDir: [-0.6, 0.45, -0.3], sunColor: '#fff0cc' }, sun: ['#fff1d8', 1.7, [-300, 260, -120]], hemi: ['#e4ecf2', '#5d5a44', 1.25] });
  const { scene } = B;
  const terrain = makeTerrain({ size: 2800, seg: 200, heightAt: vistaHeight, colorAt: vistaColor });
  scene.add(terrain);
  // 湘江
  const river = new THREE.Mesh(new THREE.PlaneGeometry(200, 2800), new THREE.MeshPhongMaterial({ color: '#8fb4c2', shininess: 80, transparent: true, opacity: 0.92 }));
  river.rotation.x = -Math.PI / 2; river.position.set(-300, -1.5, 0); scene.add(river);

  // 亭
  const pav = makePavilion();
  const top = vistaHeight(0, 0);
  pav.position.set(0, top - 0.02, 0);
  scene.add(pav);
  // 法華寺屋頂
  const r = rng(21);
  for (let i = 0; i < 6; i++) {
    const a = 0.2 + i * 0.35, d = 28 + r() * 12;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = makeHouse({ w: 7 + r() * 3, d: 5, h: 3.2, wall: '#c7b79a', roof: '#3b3c3d' });
    h.position.set(x, vistaHeight(x, z) - 0.3, z); h.rotation.y = -a + Math.PI / 2; scene.add(h);
  }
  // 樹
  const trees = scatter(900, 4, (x, z, rr) => {
    const d0 = Math.hypot(x, z);
    if (d0 < 12) return false;
    if (Math.hypot(x - XISHAN.x, z - XISHAN.z) < 280) return rr() < 0.6 ? { type: rr() < 0.5 ? 'song' : 'pine', s: 3 + rr() * 2 } : false;
    const h = vistaHeight(x, z);
    if (h < 0) return false;
    if (d0 > 80 && rr() < 0.5) return false;
    const t = rr();
    return { type: t < 0.35 ? 'pine' : t < 0.65 ? 'broad' : t < 0.8 ? 'maple' : t < 0.9 ? 'ginkgo' : 'bamboo', s: d0 < 80 ? 1 + rr() * 0.8 : 2.5 + rr() * 2 };
  }, { x0: -1300, x1: 1300, z0: -1300, z1: 1300 });
  // 亭旁兩棵古松，框住景色
  trees.push({ type: 'song', x: 9, z: 7, s: 1.6, rot: 2.2 }, { type: 'song', x: -8, z: 10, s: 1.3, rot: 0.6 });
  scene.add(makeTrees(trees, vistaHeight));
  scene.add(makeGrassField({ count: 1400, area: { x0: -40, x1: 40, z0: -40, z1: 40 }, heightAt: vistaHeight, accept: (x, z) => Math.hypot(x, z) > 4.5, seed: 12, scale: [0.45, 0.9] }));
  addXishanPinnacles(scene, XISHAN.x, XISHAN.z, vistaHeight, 3);

  // 西山頂的光暈（「始指異之」時亮起）
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,240,200,1)'); grd.addColorStop(0.4, 'rgba(255,225,170,.35)'); grd.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, opacity: 0.0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  const peakY = vistaHeight(XISHAN.x, XISHAN.z);
  halo.position.set(XISHAN.x - 60, peakY + 40, XISHAN.z - 10);
  halo.scale.set(900, 700, 1);
  scene.add(halo);
  // 雲與霧
  const clouds = makeClouds({ count: 34, rMin: 700, rMax: 2000, yMin: 300, yMax: 520, seed: 4 });
  const mist = makeMist({ count: 26, center: [XISHAN.x + 120, XISHAN.z], rMax: 420, y: 18, yJitter: 16, size: [120, 260], opacity: 0.45, seed: 5 });
  const riverMist = makeMist({ count: 18, center: [-300, 0], rMax: 700, y: 6, size: [120, 220], opacity: 0.3, seed: 6 });
  scene.add(clouds, mist, riverMist);

  // 亭內可坐處的碰撞（柱與欄杆）
  const blockers = [];
  const pts = [];
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; pts.push({ x: Math.cos(a) * 2.8, z: Math.sin(a) * 2.8 }); blockers.push({ x: pts[i].x, z: pts[i].z, r: 0.18 }); }
  for (let i = 0; i < 6; i++) {
    if (i === 4) continue;
    const a = pts[i], b = pts[(i + 1) % 6];
    for (let k = 1; k < 6; k++) blockers.push({ x: lerp(a.x, b.x, k / 6), z: lerp(a.z, b.z, k / 6), r: 0.2 });
  }
  const heightAt = (x, z) => vistaHeight(x, z) + (Math.hypot(x, z) < 3.5 ? 0.5 : 0);
  return {
    scene, heightAt, sky: B.sky, sun: B.sun,
    clamp: v => { const d = Math.hypot(v.x, v.z); if (d > 22) { v.x *= 22 / d; v.z *= 22 / d; } },
    blockers, walkables: [terrain, pav],
    peak: new THREE.Vector3(XISHAN.x, peakY + 10, XISHAN.z),
    halo, animated: [clouds, mist, riverMist],
  };
}

export async function chapter3() {
  audio.ambience({ wind: 0.4, water: 0, birds: 0.5 });
  audio.music('yongzhou');
  const world = await enter(buildVista, { x: 1.2, z: -2.2, yaw: -0.4, pitch: -0.05 });
  ui.mapVisit('temple');
  ui.mapRoute(['home', 'forest', 'temple']);
  ui.showDpad(true);
  await ui.chapterCard('第三關', '法華西亭', '永州・法華寺');
  await ui.say('', '腳印一直通到法華寺西邊的小亭。亭子建在高處，四面開闊。');
  await ui.say('你', '柳先生常說喜歡坐在這裏。他今天也來過……他在這裏看見了甚麼？');
  ui.hideDialog();
  ui.objective('在西亭坐下，像柳宗元一樣四處眺望', '點擊亭內的座位坐下，然後拖曳畫面環顧四周。');
  unfreeze();

  // 座位
  // 座位在東側，背向西山；由此望西山，視線剛好穿過兩柱之間
  const seatDir = { x: 1, z: 0 };
  const seatPos = { x: seatDir.x * 2.15, z: seatDir.z * 2.15 };
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
  seat.position.set(seatPos.x * 1.05, world.heightAt(seatPos.x, seatPos.z) + 0.5, seatPos.z * 1.05);
  world.scene.add(seat);
  await clue(seat, '坐下', async () => {
    await moveTo(seatPos.x, seatPos.z, 1.2, { eye: 1.15 });
    await turnTo(-Math.PI / 2, -0.05, 1);
  });
  setControls({ move: false, look: true, interact: true });
  ui.showDpad(false);
  await ui.say('', '你坐了下來。四周是一座座圓圓的小山、田野、樹林……都很普通。');
  ui.hideDialog();
  setControls({ move: false, look: true, interact: true });
  ui.objective('四處眺望：柳宗元在這裏看見了甚麼？', '慢慢轉動視角，望向大江的另一邊。');

  // 等待玩家望向西山
  let held = 0, hinted = false;
  const t0 = E.time;
  await new Promise(res => {
    const fn = (dt) => {
      if (isLookingAt(world.peak, 0.24)) { held += dt; } else held = Math.max(0, held - dt * 2);
      if (!hinted && E.time - t0 > 25) { hinted = true; ui.toast('提示：試試轉身，望向大江對岸。'); }
      if (held > 0.7) { E.onUpdate.splice(E.onUpdate.indexOf(fn), 1); res(); }
    };
    E.onUpdate.push(fn);
  });

  // ------ 始指異之 ------
  freeze();
  audio.music(null, 1);
  audio.ambience({ wind: 0.15, birds: 0 }, 1);
  await lookAt(world.peak, 1.2);
  E.fovTarget = 32;
  await tween(3, k => { world.halo.material.opacity = k * 0.55; });
  audio.music('xishan', 2);
  audio.bell();
  await wait(1.5);
  await ui.caption('今年九月二十八日，因坐法華西亭，望西山，始指異之。', { hold: 7.5 });
  ui.journalAdd('遊蹤', '法華西亭：坐在亭中，望見了西山。', '因坐法華西亭，望西山');
  E.fovTarget = 70;
  await wait(1.2);

  await ui.question({
    tag: '感受',
    title: '柳宗元看見西山時，最大的感受是甚麼？',
    lead: '他坐在法華西亭，望見江對岸這座山，不禁伸手指着它……',
    options: [
      { label: '普通', feedback: '如果普通，他不會特別伸手「指」着它。' },
      { label: '熟悉', feedback: '他自以為遊遍永州，卻從來沒有注意過這座山——談不上熟悉。' },
      { label: '奇異', correct: true, feedback: '對。「異之」：以之為異——覺得它與眾不同、很奇特。' },
      { label: '恐懼', feedback: '文中沒有害怕的意思。他是被吸引，而不是被嚇到。' },
    ],
  });
  ui.journalAdd('字詞', '始指異之：開始（指着它）發現西山與眾不同。「異」作動詞：以之為異，覺得它奇特。', '始指異之');
  await ui.caption('……而未始知西山之怪特。', { gloss: '原來從前自以為遊遍永州，卻從未認識西山的奇特。', hold: 6 });
  ui.litText('而未始知西山之怪特');
  ui.setMood('wonder');
  ui.mapKnowXishan();
  await tween(2, k => { world.halo.material.opacity = 0.55 * (1 - k) + 0.15 * k; });
  ui.objective('新目標：追尋西山方向的足跡', '亭子下面好像有人。');
  ui.toast('新目標：追尋西山方向的足跡');

  // ------ 第四關（上）：亭下的僕人 ------
  audio.music('yongzhou', 3);
  audio.ambience({ wind: 0.35, birds: 0.5 });
  const servant = makePerson({ preset: 'servant', name: '僕人' });
  const sp = { x: 5.5, z: -10.5 };
  servant.position.set(sp.x, world.heightAt(sp.x, sp.z), sp.z);
  servant.userData.setPose('sit');
  servant.rotation.y = Math.PI * 0.9;
  world.scene.add(servant); E.persons.add(servant);
  const tree = makeTrees([{ type: 'broad', x: sp.x + 1.6, z: sp.z - 1.2, s: 1.3 }], world.heightAt); world.scene.add(tree);
  world.blockers.push({ x: sp.x, z: sp.z, r: 0.6 });
  audio.tone(220, 0.4, { type: 'triangle', vol: 0.05, slideTo: 180 });

  await moveTo(seatPos.x * 0.6, seatPos.z * 0.6, 1, { eye: 1.6 });
  await lookAt(new THREE.Vector3(sp.x, world.heightAt(sp.x, sp.z) + 1, sp.z), 1.2);
  await ui.say('', '亭子下面傳來一聲輕輕的呻吟。樹下坐着一個人，正揉着腳踝。');
  ui.hideDialog();
  ui.showDpad(true);
  unfreeze();
  await clue(servant, '樹下的人', async () => {
    watch(servant, true);
    await lookAt(new THREE.Vector3(sp.x, world.heightAt(sp.x, sp.z) + 0.9, sp.z), 0.8);
    await wait(0.6);
    await ui.say('僕人', '你……是府上派來找柳先生的？');
    await ui.choose([{ label: '是。你見過柳先生嗎？' }], { name: '你' });
    await ui.say('僕人', '見過。先生今早坐在那亭子裏，望着江對面那座山，望了很久很久。');
    await ui.say('僕人', '然後他忽然站起來，指着那座山……');
    await ui.say('僕人', '柳先生方才命我一起前往那座山。');
    await ui.choose([{ label: '那你怎麼在這裏？' }], { name: '你' });
    await ui.say('僕人', '我走到半路扭傷了腳。先生讓其他人陪他繼續走，叫我先回來歇着。');
    await ui.choose([{ label: '你們是怎樣走的？' }], { name: '你' });
    await ui.say('僕人', '我們先過了一條大江。');
    await ui.say('僕人', '之後的路……你看看地圖吧。先生拄着竹杖，一路都會留下痕跡的。');
    ui.hideDialog();
  }, { range: 3 });

  ui.setMood('eager');
  const pick = await ui.openMap({
    title: '下一個地點是哪裏？',
    lead: '僕人說：「我們先過了一條大江。」要去江對岸，應該先到哪裏？',
    pick: {
      options: [
        { id: 'ferry', correct: true, feedback: '要過大江，先要到渡口乘船。' },
        { id: 'home', feedback: '那是回城的方向。' },
        { id: 'forest', feedback: '城外山林你已經找過了——柳先生說那裏他早已遊遍。' },
        { id: 'temple', feedback: '你現在就在法華寺。' },
      ],
    },
  });
  ui.mapVisit('ferry');
  ui.mapRoute(['home', 'forest', 'temple', 'ferry']);
  watch(servant, true);
  await ui.say('僕人', '對，到渡口去。船家認得柳先生。');
  await ui.say('僕人', '……找到先生的話，請告訴他，我的腳不礙事。');
  ui.hideDialog();
}
