// 第一關：尋找舊足跡（永州山林）
// 第二關：重建「平日遊山」（山林深處）
import { E, THREE, ui, audio, enter, clue, watch, dist2D, until } from './common.js';
import { addInteractable, removeInteractable, freeze, unfreeze, wait, lookAt, moveTo, turnTo, tween, setControls, lerp } from '../engine.js';
import {
  baseScene, makeTerrain, makeTrees, scatter, makeRock, makeGrassPatch, makeWinePot, makeCup, makeMat,
  makeFootprints, pathPoints, makeRibbon, makeWater, makePerson, fbm, noise2, rng, mixHex, smoothstep, lam, textCanvas, makeStaff,
} from '../world.js';

// ---------------- 共用地形著色 ----------------
function forestColor(h, slope, x, z) {
  const n = noise2(x * 0.08, z * 0.08, 5) * 0.5 + 0.5;
  let c = mixHex('#5f7a3f', '#7d8a48', n);
  if (slope > 0.35) c = mixHex(c, '#7a6e58', smoothstep(0.35, 0.6, slope));
  if (h > 16) c = mixHex(c, '#8a8a70', smoothstep(16, 28, h));
  return c;
}
function distToPolyline(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best) best = d;
  }
  return best;
}

// ================= 第一關世界 =================
const CREEK = [
  { x: 95, z: 95 }, { x: 70, z: 70 }, { x: 58, z: 52 }, { x: 70, z: 35 }, { x: 58, z: 16 }, { x: 38, z: 10 }, { x: 30, z: -8 }, { x: 44, z: -24 }, { x: 36, z: -40 }, { x: 16, z: -46 }, { x: 4, z: -62 }, { x: 10, z: -110 },
];
const ZONES = {
  creek: { x: 52, z: 30, name: '迴溪' },
  forest: { x: -52, z: 18, name: '深林' },
  spring: { x: -34, z: -40, name: '幽泉' },
  rocks: { x: 62, z: -50, name: '怪石' },
  hill: { x: -6, z: -86, name: '高山' },
};
function forestHeight(x, z) {
  let h = fbm(x * 0.012, z * 0.012, 4, 1) * 6 + fbm(x * 0.05, z * 0.05, 2, 2) * 0.8;
  // 高山
  const dh = Math.hypot(x - (-6), z - (-100));
  h += 34 * Math.exp(-(dh * dh) / (2 * 30 * 30));
  // 四周山嶺
  const r = Math.hypot(x, z);
  h += smoothstep(95, 150, r) * 22;
  // 幽泉凹地
  const ds = Math.hypot(x - ZONES.spring.x, z - ZONES.spring.z);
  h -= 3.2 * Math.exp(-(ds * ds) / (2 * 7 * 7));
  // 溪谷
  const dc = distToPolyline(x, z, CREEK);
  h -= 1.6 * (1 - smoothstep(1.5, 6, dc));
  return h;
}

function buildForest() {
  const B = baseScene({ fog: '#c9d3cf', fogNear: 25, fogFar: 230, sky: { top: '#7ea6c9', sunDir: [0.4, 0.5, -0.6] }, sun: ['#fff0d0', 1.5, [60, 80, -40]] });
  const { scene } = B;
  const terrain = makeTerrain({ size: 320, seg: 128, heightAt: forestHeight, colorAt: forestColor });
  scene.add(terrain);

  // 溪流
  const creekPts = pathPoints(CREEK, 2).map(p => ({ x: p.x, z: p.z }));
  const creek = makeRibbon(creekPts, 3.2, (x, z) => forestHeight(x, z), { color: '#7fa9b4', lift: 0.55, seg: 2 });
  scene.add(creek);
  // 幽泉水面
  const pool = new THREE.Mesh(new THREE.CircleGeometry(7.5, 24), new THREE.MeshPhongMaterial({ color: '#4f7f86', shininess: 90, transparent: true, opacity: 0.9 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(ZONES.spring.x, forestHeight(ZONES.spring.x, ZONES.spring.z) + 0.9, ZONES.spring.z);
  scene.add(pool);

  // 樹木
  const avoid = (x, z) => distToPolyline(x, z, CREEK) < 5 || Math.hypot(x - ZONES.spring.x, z - ZONES.spring.z) < 11 || Math.hypot(x - ZONES.rocks.x, z - ZONES.rocks.z) < 10 || Math.hypot(x - 0, z - 90) < 14;
  const trees = scatter(420, 11, (x, z, r) => {
    if (avoid(x, z)) return false;
    const dense = Math.hypot(x - ZONES.forest.x, z - ZONES.forest.z) < 32;
    const edge = Math.hypot(x, z) > 60;
    if (!dense && !edge && r() > 0.35) return false;
    const t = r();
    return { type: dense ? (t < 0.6 ? 'pine' : 'broad') : (t < 0.4 ? 'pine' : t < 0.75 ? 'broad' : t < 0.9 ? 'maple' : 'bamboo'), s: dense ? 1.1 + r() * 0.8 : 0.8 + r() * 0.7 };
  }, { x0: -150, x1: 150, z0: -150, z1: 150 });
  // 高山路徑附近保持開闊
  scene.add(makeTrees(trees, forestHeight));
  const bushes = scatter(120, 22, (x, z) => !avoid(x, z), { x0: -120, x1: 120, z0: -120, z1: 120 }).map(b => Object.assign(b, { type: 'bush', s: 0.6 + b.s * 0.4 }));
  scene.add(makeTrees(bushes, forestHeight));

  // 怪石
  const rr = rng(7);
  for (let i = 0; i < 9; i++) {
    const s = 1.5 + rr() * 3;
    const rock = makeRock(s, i % 2 ? '#8b8678' : '#9a9383', 30 + i);
    const a = rr() * 6.28, d = 2 + rr() * 7;
    const x = ZONES.rocks.x + Math.cos(a) * d, z = ZONES.rocks.z + Math.sin(a) * d;
    rock.position.set(x, forestHeight(x, z) + s * 0.5, z);
    rock.scale.set(0.7 + rr() * 0.4, 1.2 + rr() * 1.3, 0.7 + rr() * 0.4);
    rock.rotation.set(rr() * 0.4, rr() * 6, rr() * 0.4);
    scene.add(rock);
  }
  // 泉邊石頭
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * 6.28, x = ZONES.spring.x + Math.cos(a) * 7.5, z = ZONES.spring.z + Math.sin(a) * 7.5;
    const rock = makeRock(0.8 + rr() * 0.8, '#7b7a70', 60 + i);
    rock.position.set(x, forestHeight(x, z) + 0.4, z); scene.add(rock);
  }
  // 草叢
  for (let i = 0; i < 70; i++) {
    const x = (rr() - .5) * 200, z = (rr() - .5) * 200;
    if (avoid(x, z)) continue;
    const g = makeGrassPatch(10, 0.9, { seed: i, color: '#89974f' });
    g.position.set(x, forestHeight(x, z), z); scene.add(g);
  }

  const world = {
    scene,
    heightAt: forestHeight,
    clamp: v => { const r = Math.hypot(v.x, v.z); if (r > 118) { v.x *= 118 / r; v.z *= 118 / r; } },
    blockers: trees.filter(t => t.s > 0.9).map(t => ({ x: t.x, z: t.z, r: 0.35 * t.s })),
    walkables: [terrain],
    update: (dt, t) => { creek.material.color.setHSL(0.53, 0.25, 0.58 + Math.sin(t * 2) * 0.02); },
  };
  return world;
}

function place(obj, x, z, h, lift = 0) { obj.position.set(x, h(x, z) + lift, z); return obj; }

export async function chapter1() {
  audio.ambience({ wind: 0.35, water: 0.25, waterFreq: 1100, birds: 0.7 });
  audio.music('yongzhou');
  const world = await enter(buildForest, { x: 0, z: 100, yaw: 0, pitch: -0.05 });
  const scene = world.scene, H = forestHeight;
  ui.mapVisit('forest');
  ui.mapRoute(['home', 'forest']);
  if (document.getElementById('btnMap').classList.contains('hidden')) { ui.unlockButton('btnMap'); ui.toast('老僕把柳先生手繪的永州簡圖交給了你（右上角「地圖」）'); }
  ui.showDpad(true);
  await ui.chapterCard('第一關', '尋找舊足跡', '永州・城外山林');
  await ui.say('你', '柳先生常來這片山林……他會在哪裏？');
  await ui.say('', '四周都是山林。高山、深林、溪谷、泉水、怪石——哪裏都可能有他的痕跡。');
  ui.hideDialog();

  let found = 0;
  const TOTAL = 5;
  const progress = () => ui.objective(`在山林中尋找柳宗元的痕跡（${found}／${TOTAL}）`, '四處走走，點擊發光的標記。可以用滑鼠拖曳轉動視角，點擊地面走過去。');
  progress();
  unfreeze();

  // --- 迴溪：腳印 → 草席 ---
  const fpStart = { x: 60, z: 50 };
  const fpPts = pathPoints([fpStart, { x: 66, z: 38 }, { x: 60, z: 24 }, { x: 48, z: 16 }, { x: 40, z: 12 }], 0.75);
  const prints = makeFootprints(fpPts, H, { opacity: 0.6 });
  prints.visible = true; scene.add(prints);
  const mat = place(makeMat(), 40, 12, H, 0.02); mat.rotation.y = 0.6; scene.add(mat);
  const fpHit = new THREE.Mesh(new THREE.SphereGeometry(1.2), new THREE.MeshBasicMaterial({ visible: false }));
  place(fpHit, fpStart.x, fpStart.z, H, 0.3); scene.add(fpHit);

  const creekClue = (async () => {
    await clue(fpHit, '地上的痕跡', async () => {
      await ui.say('你', '腳印！溪邊的泥地上有腳印——是柳先生的嗎？');
      await ui.say('', '腳印沿着彎彎曲曲的溪流一直延伸下去。');
      ui.hideDialog();
    });
    await clue(mat, '腳印的盡頭', async () => {
      await ui.say('', '腳印到這裏便停了。溪邊只有一張舊草席，已經被露水打濕。');
      await ui.say('你', '他以前來過這裏……但不是今天。');
      ui.hideDialog();
      ui.journalAdd('遊蹤', '迴溪：溪邊留下舊草席。', '窮迴溪');
    });
    found++; progress();
  })();

  // --- 深林：壓倒的草 ---
  const pressed = place(makeGrassPatch(26, 1.3, { pressed: true, color: '#8f9a55', seed: 31 }), ZONES.forest.x, ZONES.forest.z, H, 0.02);
  scene.add(pressed);
  const forestClue = clue(pressed, '深林中的草地', async () => {
    await ui.say('', '密林深處，一片草被壓倒了，形狀像有幾個人曾經坐在這裏。');
    await ui.say('你', '這裏也來過……可是草已經重新立起了一半，不是今天留下的。');
    ui.hideDialog();
    ui.journalAdd('遊蹤', '深林：一片被壓倒的草。', '入深林');
  }, { range: 3 }).then(() => { found++; progress(); });

  // --- 幽泉：空酒壺 ---
  const pot = place(makeWinePot('#6c7a66'), ZONES.spring.x + 7.2, ZONES.spring.z + 2, H, 0.2);
  pot.rotation.z = Math.PI / 2.2; scene.add(pot);
  const springClue = clue(pot, '泉邊的東西', async () => {
    await ui.say('', '幽靜的泉水旁，倒着一個空酒壺。壺口還有淡淡酒香，但早已乾了。');
    await ui.say('你', '和書案上那個一模一樣。他在這裏喝過酒……然後呢？');
    ui.hideDialog();
    ui.journalAdd('遊蹤', '幽泉：泉邊一個空酒壺。', '幽泉');
  }).then(() => { found++; progress(); });

  // --- 怪石：酒杯 ---
  const cup = place(makeCup(), ZONES.rocks.x - 4, ZONES.rocks.z + 5, H, 0.05);
  cup.scale.setScalar(2); scene.add(cup);
  const rockClue = clue(cup, '怪石之間', async () => {
    await ui.say('', '奇形怪狀的大石之間，擱着一隻小酒杯。杯底積了雨水，長了青苔。');
    await ui.say('你', '怪石這裏也留下了東西……他真是哪裏都去過。');
    ui.hideDialog();
    ui.journalAdd('遊蹤', '怪石：石間一隻舊酒杯。', '怪石');
  }).then(() => { found++; progress(); });

  // --- 高山：四散的腳印 ---
  const hx = ZONES.hill.x, hz = ZONES.hill.z;
  const scatterPrints = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * 6.28 + 0.3;
    const pts = pathPoints([{ x: hx, z: hz }, { x: hx + Math.cos(a) * 9, z: hz + Math.sin(a) * 9 }, { x: hx + Math.cos(a + 0.6) * 15, z: hz + Math.sin(a + 0.6) * 15 }], 0.8);
    scatterPrints.add(makeFootprints(pts, H, { opacity: 0.45 }));
  }
  scene.add(scatterPrints);
  const hillHit = place(makeStaff(), hx, hz, H, 0); hillHit.rotation.z = 1.4; hillHit.position.y += 0.1; scene.add(hillHit);
  const hillClue = clue(hillHit, '山坡上的痕跡', async () => {
    await ui.say('', '山坡上有一根斷了的竹杖。四周的腳印向四方散開：有的往上，有的往下，有的繞了一圈又回來。');
    await ui.say('你', '好像……沒有特別要去的地方，走到哪裏算哪裏。');
    ui.hideDialog();
    ui.journalAdd('遊蹤', '高山：斷竹杖，腳印四散，沒有方向。', '上高山');
  }, { range: 3.2 }).then(() => { found++; progress(); });

  await Promise.all([creekClue, forestClue, springClue, rockClue, hillClue]);
  freeze();
  await ui.say('你', '高山、深林、迴溪、幽泉、怪石……每一處都有他的痕跡，卻沒有一處找到他。');
  await ui.say('你', '柳先生以前到過這麼多地方。');
  ui.hideDialog();

  await ui.question({
    title: '柳宗元平日遊山有甚麼特點？',
    lead: '根據你找到的線索：溪邊的草席、泉邊的酒壺、深林的壓草、怪石間的酒杯、山坡上四散的腳印……',
    options: [
      { label: '只到著名景點', feedback: '這些都是無名的溪谷、泉水、石堆——不是甚麼名勝。' },
      { label: '漫無目的，到處遊歷', correct: true, feedback: '沒錯。痕跡遍佈各處，腳印四散，沒有固定方向——他是隨意地、漫無目的地遊。' },
      { label: '每次都有固定目的地', feedback: '腳印四散，繞圈又回頭，看不出有目的地。' },
      { label: '只喜歡平坦地方', feedback: '他上過高山，也入過深林，並不只去平地。' },
    ],
  });
  await ui.caption('施施而行，漫漫而遊。', { gloss: '施施：緩慢地走；漫漫：隨意、漫無目的。——不是單純「慢慢走」，而是沒有方向、沒有目標的遊蕩。', hold: 7 });
  ui.journalAdd('字詞', '施施：慢慢地行走的樣子。漫漫：隨意、漫無目的的樣子。', '施施而行，漫漫而遊');
  ui.journalAdd('活動', '公餘之時，漫無目的地到處遊歷。', '其隙也，則施施而行，漫漫而遊');
  await ui.caption('日與其徒上高山，入深林，窮迴溪，幽泉怪石，無遠不到。', { gloss: '每天和同伴登高山、入深林、走到迴環溪流的盡頭；幽泉怪石，再遠也都去過。', hold: 7 });
  ui.litText('日與其徒上高山，入深林，窮迴溪，幽泉怪石，無遠不到');
  ui.setMood('wander');
  await wait(1);

  await ui.say('你', '他常和朋友一起來。那他們到了這些地方，又做些甚麼？');
  await ui.say('', '北面的樹林更深更密。那邊好像還有更多痕跡。');
  ui.hideDialog();
  ui.objective('往山林深處走', '沿着北面的小路走進山林深處。');
  const deep = new THREE.Mesh(new THREE.SphereGeometry(1.5), new THREE.MeshBasicMaterial({ visible: false }));
  place(deep, -40, -8, H, 1); scene.add(deep);
  unfreeze();
  await clue(deep, '往山林深處', async () => {});
  freeze();
}

// ================= 第二關世界 =================
function gladeHeight(x, z) {
  const r = Math.hypot(x, z);
  return fbm(x * 0.03, z * 0.03, 3, 9) * 1.5 + smoothstep(18, 45, r) * 6;
}
function buildGlade() {
  const B = baseScene({ fog: '#b9c7b8', fogNear: 15, fogFar: 110, sky: { top: '#86a9c2', sunDir: [0.2, 0.7, -0.4] }, hemi: ['#e8f0e0', '#4a5a38', 1.3], sun: ['#fff0c8', 1.7, [20, 60, -10]] });
  const { scene } = B;
  const terrain = makeTerrain({ size: 140, seg: 70, heightAt: gladeHeight, colorAt: (h, s, x, z) => mixHex('#6d8a43', '#8e9a52', noise2(x * 0.15, z * 0.15, 3) * 0.5 + 0.5) });
  scene.add(terrain);
  const trees = scatter(160, 5, (x, z, r) => { const d = Math.hypot(x, z); if (d < 17) return false; if (Math.abs(x) < 3 && z > 0) return false; return { type: r() < 0.5 ? 'pine' : r() < 0.8 ? 'broad' : 'maple', s: 1 + r() * 0.8 }; }, { x0: -60, x1: 60, z0: -60, z1: 60 });
  scene.add(makeTrees(trees, gladeHeight));
  const rr = rng(3);
  for (let i = 0; i < 26; i++) {
    const a = rr() * 6.28, d = rr() * 15;
    const g = makeGrassPatch(12, 1, { seed: 100 + i, color: '#94a35a' });
    g.position.set(Math.cos(a) * d, gladeHeight(Math.cos(a) * d, Math.sin(a) * d), Math.sin(a) * d); scene.add(g);
  }
  // 光束
  const beamM = new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 2.5, 30, 8, 1, true), beamM);
    b.position.set((rr() - .5) * 20, 12, (rr() - .5) * 20); b.rotation.z = 0.25; b.rotation.x = 0.1; scene.add(b);
  }
  const bigRock = makeRock(1.3, '#8a8778', 5); bigRock.position.set(3.5, gladeHeight(3.5, -2) + 0.5, -2); bigRock.scale.y = 0.7; scene.add(bigRock);
  return {
    scene, heightAt: gladeHeight,
    clamp: v => { const r = Math.hypot(v.x, v.z); if (r > 22) { v.x *= 22 / r; v.z *= 22 / r; } },
    blockers: [{ x: 3.5, z: -2, r: 1 }],
    walkables: [terrain],
  };
}

export async function chapter2() {
  audio.ambience({ wind: 0.2, water: 0.05, birds: 1 });
  audio.music('yongzhou');
  const world = await enter(buildGlade, { x: 0, z: 20, yaw: 0, pitch: -0.1 });
  const scene = world.scene, H = gladeHeight;
  ui.showDpad(true);
  await ui.chapterCard('第二關', '重建「平日遊山」', '永州・山林深處');
  await ui.say('', '林中有一片開闊的草地，陽光從樹葉間漏下來。');
  await ui.say('你', '這裏的痕跡特別多……好像有人常常在這裏停留。');
  ui.hideDialog();

  const TOTAL = 5; let found = 0;
  const prog = () => ui.objective(`找出草地上的五種痕跡（${found}／${TOTAL}）`, '草地四周都有痕跡，走近點擊標記。');
  prog();
  unfreeze();

  // 1 被壓倒的草
  const grass = place(makeGrassPatch(30, 1.6, { pressed: true, seed: 71, color: '#97a55a' }), -3, 2, H, 0.02); scene.add(grass);
  // 2 酒壺
  const pot = place(makeWinePot('#7a8a70'), 3, -0.6, H, 0.1); pot.rotation.z = 1.4; scene.add(pot);
  // 3 枕在一起的痕跡：兩個人形壓痕，頭挨着頭
  const pillow = new THREE.Group();
  for (const s of [1, -1]) {
    const dent = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.2, 3, 8), new THREE.MeshLambertMaterial({ color: '#6c7a3e' }));
    dent.rotation.z = Math.PI / 2; dent.rotation.y = s * 0.5; dent.scale.set(1, 1, 0.25);
    dent.position.set(s * 0.95, 0.05, 0); pillow.add(dent);
  }
  place(pillow, -5, -6, H, 0.02); scene.add(pillow);
  // 4 夢境圖案：地上用樹枝畫的雲山圖
  const dreamTex = textCanvas([], { w: 512, h: 512, bg: null, draw: (g) => {
    g.strokeStyle = 'rgba(70,50,30,.9)'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(60, 360); g.lineTo(150, 200); g.lineTo(210, 290); g.lineTo(290, 130); g.lineTo(380, 300); g.lineTo(450, 230); g.stroke();
    for (const [x, y, r] of [[140, 110, 40], [200, 90, 50], [260, 110, 38], [360, 420, 34], [410, 400, 44]]) { g.beginPath(); g.arc(x, y, r, Math.PI, 0); g.stroke(); }
    g.beginPath(); g.moveTo(40, 440); g.bezierCurveTo(160, 400, 300, 470, 470, 430); g.stroke();
  } });
  const dream = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: dreamTex, transparent: true, depthWrite: false }));
  dream.rotation.x = -Math.PI / 2; place(dream, 6, 5, H, 0.06); scene.add(dream);
  const dreamGlow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), new THREE.MeshBasicMaterial({ color: '#fff0c0', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
  dreamGlow.rotation.x = -Math.PI / 2; place(dreamGlow, 6, 5, H, 0.08); scene.add(dreamGlow);
  // 5 歸途腳印：通往林外
  const retPts = pathPoints([{ x: -1, z: -3 }, { x: -6, z: -10 }, { x: -12, z: -16 }, { x: -18, z: -20 }], 0.75);
  scene.add(makeFootprints(retPts, H, { opacity: 0.5 }));
  const retHit = new THREE.Mesh(new THREE.SphereGeometry(0.9), new THREE.MeshBasicMaterial({ visible: false }));
  place(retHit, -9, -13, H, 0.3); scene.add(retHit);

  const one = (obj, label, lines, j) => clue(obj, label, async () => {
    for (const l of lines) await ui.say(l[0], l[1]);
    ui.hideDialog();
    if (j) ui.journalAdd('活動', j);
  }).then(() => { found++; prog(); });

  await Promise.all([
    one(grass, '被壓倒的草', [['', '一大片草被壓得平平的——有人撥開草，就地坐下。'], ['你', '他們坐在草地上。']], '痕跡：被壓倒的草——有人撥開草坐下。'),
    one(pot, '倒下的酒壺', [['', '酒壺倒在石旁，壺裏一滴不剩。'], ['你', '喝得很盡興……大概都醉了。']], '痕跡：倒空的酒壺——喝醉了。'),
    one(pillow, '並排的壓痕', [['', '草地上有兩個人形的壓痕，頭挨着頭，像互相枕着對方睡過。']], '痕跡：頭挨着頭的壓痕——互相枕着躺下。'),
    one(dream, '奇怪的圖案', [['', '地上有人用樹枝畫了一幅畫：雲、山、水……像是醒來後，想把夢裏看見的畫下來。'], ['你', '他們睡着了，還做了夢？']], '痕跡：地上畫的夢境——睡着做夢。'),
    one(retHit, '離開的腳印', [['', '一行腳印離開草地，穿過樹林。方向……是回城的路。'], ['你', '醒來以後，便回家了。']], '痕跡：離開的腳印——醒來回家。'),
  ]);

  freeze();
  await ui.say('你', '把這些痕跡連起來……就是他們每次遊山做的事。');
  ui.hideDialog();
  await ui.sortGame({
    title: '柳宗元過去遊山，一般會做甚麼？',
    lead: '依照事情發生的先後，把五種痕跡排好次序。點擊卡片放入格子；點擊格子可取回。',
    items: [
      { id: 'grass', glyph: '草', label: '被壓倒的草', phrase: '披草而坐' },
      { id: 'pot', glyph: '壺', label: '倒空的酒壺', phrase: '傾壺而醉' },
      { id: 'pillow', glyph: '枕', label: '頭挨頭的壓痕', phrase: '更相枕以臥' },
      { id: 'dream', glyph: '夢', label: '夢境圖案', phrase: '臥而夢' },
      { id: 'home', glyph: '歸', label: '離開的腳印', phrase: '覺而起，起而歸' },
    ],
    hints: {
      pot: '先有地方坐下，才會喝酒吧？',
      pillow: '還沒喝醉，會就地躺下睡覺嗎？',
      dream: '要先躺下睡着，才會做夢。',
      home: '回家應該是最後一步——醒來之後。',
      grass: '到達以後，第一件事是找地方坐下。',
    },
  });

  // ------- 小動畫：柳宗元與友人 -------
  ui.objective('');
  // 走到草地邊，看「當時的情景」
  await moveTo(2.5, 8.5, 1.4);
  await lookAt(new THREE.Vector3(-0.6, gladeHeight(-0.6, 2) + 0.4, 2), 1.2);
  const liu = makePerson({ preset: 'liu' });
  const f1 = makePerson({ preset: 'friend1' });
  const f2 = makePerson({ preset: 'friend2' });
  const group = [liu, f1, f2];
  // 半透明，表示是「過去」的情景
  group.forEach(p => { p.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.0; } }); scene.add(p); E.persons.add(p); });
  const setOpacity = (v) => group.forEach(p => p.traverse(o => { if (o.material) o.material.opacity = v; }));
  const starts = [{ x: -14, z: -14 }, { x: -16, z: -12 }, { x: -12, z: -16 }];
  const seats = [{ x: -1.2, z: 1.2, ry: 0.4 }, { x: 0.8, z: 2.2, ry: -0.8 }, { x: -2.5, z: 3.4, ry: 2.6 }];
  group.forEach((p, i) => { p.position.set(starts[i].x, H(starts[i].x, starts[i].z), starts[i].z); p.rotation.y = Math.atan2(seats[i].x - starts[i].x, seats[i].z - starts[i].z); });
  await tween(1.2, k => setOpacity(k * 0.75));

  // 走入
  group.forEach(p => p.userData.walking = true);
  await tween(4, k => group.forEach((p, i) => { const x = lerp(starts[i].x, seats[i].x, k), z = lerp(starts[i].z, seats[i].z, k); p.position.set(x, H(x, z), z); }), t => t);
  group.forEach((p, i) => { p.userData.walking = false; p.rotation.y = seats[i].ry; p.userData.setPose('sit'); });
  ui.whisper('披草而坐', { hold: 2.4 });
  await wait(2.2);
  // 喝酒
  const cupPot = makeWinePot('#7a8a70'); cupPot.scale.setScalar(0.9);
  liu.userData.armR.add(cupPot); cupPot.position.set(0, -0.7, 0.05);
  liu.userData.customArms = true;
  await tween(1, k => { liu.userData.armR.rotation.x = -0.7 - k * 1.6; });
  ui.whisper('傾壺而醉', { hold: 2.6 });
  await tween(1.6, k => { liu.userData.armR.rotation.x = -2.3 + Math.sin(k * Math.PI) * 0.3; group.forEach(p => { p.userData.upper.rotation.z = Math.sin(k * 8) * 0.08; }); });
  await tween(0.8, k => { liu.userData.armR.rotation.x = lerp(-2.3, -0.7, k); });
  liu.userData.armR.remove(cupPot);
  // 醉臥
  await tween(1, k => group.forEach(p => { p.userData.upper.rotation.z = Math.sin(k * 6) * 0.12; }));
  const beds = [{ x: -0.4, z: 1.2, ry: 1.6 }, { x: 1.6, z: 1.2, ry: -1.6 }, { x: -2.4, z: 3.6, ry: 2.8 }];
  group.forEach((p, i) => { p.userData.setPose('lie'); p.position.set(beds[i].x, H(beds[i].x, beds[i].z), beds[i].z); p.rotation.y = beds[i].ry; });
  ui.whisper('醉則更相枕以臥', { hold: 2.6 });
  await wait(2.6);
  // 夢
  const cloud = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: dreamTex, transparent: true, opacity: 0, depthWrite: false }));
  cloud.position.set(0.5, H(0.5, 1.4) + 2.4, 1.4); scene.add(cloud);
  cloud.lookAt(E.camera.position);
  await tween(1.2, k => { cloud.material.opacity = k * 0.8; });
  ui.whisper('臥而夢。意有所極，夢亦同趣。', { hold: 3.4 });
  await tween(3.2, k => { cloud.position.y += 0.003; cloud.rotation.z = Math.sin(k * 3) * 0.05; });
  await tween(1, k => { cloud.material.opacity = 0.8 * (1 - k); });
  scene.remove(cloud);
  // 醒來、回家
  group.forEach((p, i) => { p.userData.setPose('stand'); p.position.set(seats[i].x, H(seats[i].x, seats[i].z), seats[i].z); p.rotation.y = Math.atan2(-18 - seats[i].x, -20 - seats[i].z); });
  ui.whisper('覺而起，起而歸。', { hold: 2.8 });
  await wait(0.6);
  group.forEach(p => p.userData.walking = true);
  const ends = [{ x: -17, z: -19 }, { x: -18, z: -17 }, { x: -15, z: -21 }];
  await tween(4, k => {
    group.forEach((p, i) => { const x = lerp(seats[i].x, ends[i].x, k), z = lerp(seats[i].z, ends[i].z, k); p.position.set(x, H(x, z), z); });
    if (k > 0.6) setOpacity(0.75 * (1 - (k - 0.6) / 0.4));
  }, t => t);
  group.forEach(p => { scene.remove(p); E.persons.delete(p); });
  await wait(0.6);

  await ui.caption('以為凡是州之山水有異態者，皆我有也。', { gloss: '他以為永州凡是有奇特姿態的山水，都已經被自己遊遍、盡歸所有了。', hold: 7 });
  ['披草而坐', '傾壺而醉', '醉則更相枕以臥', '臥而夢', '意有所極，夢亦同趣', '覺而起，起而歸'].forEach(q => ui.litText(q));
  ui.journalAdd('活動', '平日遊山的模式：披草而坐 → 傾壺而醉 → 更相枕以臥 → 臥而夢 → 覺而起，起而歸。', '到則披草而坐，傾壺而醉');
  ui.journalAdd('字詞', '更相：互相。更相枕以臥：互相枕着對方躺下。', '更相枕以臥');
  ui.setMood('possess');
  await wait(0.8);
  await ui.say('你', '坐下、喝醉、睡覺、做夢、回家……每次都一樣。');
  await ui.say('你', '他覺得自己已經看遍了永州。那今天，他還能去哪裏？');
  ui.hideDialog();

  // 新的腳印
  const newPts = pathPoints([{ x: 2, z: -4 }, { x: 8, z: -10 }, { x: 14, z: -15 }, { x: 19, z: -18 }], 0.7);
  const newPrints = makeFootprints(newPts, H, { opacity: 0.8, color: '#2c2016' });
  scene.add(newPrints);
  const newHit = new THREE.Mesh(new THREE.SphereGeometry(0.9), new THREE.MeshBasicMaterial({ visible: false }));
  place(newHit, 8, -10, H, 0.3); scene.add(newHit);
  ui.objective('草地另一邊出現了一行不同的腳印', '看看草地東北方。');
  unfreeze();
  await clue(newHit, '新的腳印', async () => {
    await ui.say('', '這一行腳印很新，泥土還是濕的。步子很大，一直向前，沒有繞圈。');
    await ui.say('你', '這是今天的！方向……不是回城，是往山下的法華寺。');
    ui.hideDialog();
    ui.journalAdd('遊蹤', '山林深處：發現今天留下的新腳印，通往法華寺。');
  });
  freeze();
  ui.mapVisit('temple');
  ui.mapRoute(['home', 'forest', 'temple']);
}
