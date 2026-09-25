// 第四關（下）：過湘江，緣染溪
import { E, THREE, ui, audio, enter, clue, watch } from './common.js';
import { addInteractable, removeInteractable, freeze, unfreeze, wait, lookAt, moveTo, turnTo, tween, setControls, lerp, angleDiff } from '../engine.js';
import { baseScene, makeTerrain, makeTrees, scatter, makeRock, makeGrassPatch, makeBoat, makePerson, makeRibbon, makeFootprints, pathPoints, fbm, noise2, rng, mixHex, smoothstep, lam } from '../world.js';
import { xishanShape, xishanColor, addXishanPinnacles, autumnGround } from './pavilion.js';
import { makeClouds, makeMist, makeGrassField } from '../scenery.js';

const RIVER_HALF = 80;
const CREEK = [{ x: -76, z: 16 }, { x: -110, z: 14 }, { x: -140, z: 22 }, { x: -175, z: 18 }, { x: -210, z: 28 }, { x: -250, z: 24 }, { x: -300, z: 36 }, { x: -380, z: 30 }];
const WEST_HILL = { x: -760, z: 60, h: 250 };

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
function terrainH(x, z) {
  let h = 2.5 + fbm(x * 0.01, z * 0.01, 4, 17) * 4;
  // 河道
  const ax = Math.abs(x);
  h = lerp(h, -4, 1 - smoothstep(RIVER_HALF - 4, RIVER_HALF + 6, ax));
  // 西岸往西漸高
  if (x < -100) h += smoothstep(-100, -500, x) * 25 * (0.6 + 0.4 * fbm(x * 0.006, z * 0.006, 3, 4));
  // 東岸山丘
  if (x > 200) h += smoothstep(200, 600, x) * 30;
  // 染溪
  if (x < -70) {
    const dc = distToPolyline(x, z, CREEK);
    h -= 1.8 * (1 - smoothstep(1.5, 5, dc));
  }
  h += xishanShape(x, z, WEST_HILL.x, WEST_HILL.z, WEST_HILL.h);
  return h;
}
function colorAt(h, slope, x, z) {
  const n = noise2(x * 0.05, z * 0.05, 2) * 0.5 + 0.5;
  if (h < -1) return mixHex('#6f6a54', '#5e5a48', n);
  let c = autumnGround(x, z, mixHex('#6d8747', '#8b9555', n));
  if (Math.abs(x) < RIVER_HALF + 10) c = mixHex('#a39a74', c, smoothstep(RIVER_HALF + 2, RIVER_HALF + 10, Math.abs(x)));
  if (Math.hypot(x - WEST_HILL.x, z - WEST_HILL.z) < 320) c = xishanColor(h, slope, x, z, n);
  return c;
}

function buildRiver() {
  const B = baseScene({ fog: '#d6ddd8', fogNear: 120, fogFar: 1500, sky: { top: '#6c9fcc', sunDir: [-0.55, 0.5, 0.15], sunColor: '#fff0d4' }, hemi: ['#e2ebf1', '#5a5842', 1.1], sun: ['#fff0d6', 1.9] });
  const { scene } = B;
  const terrain = makeTerrain({ size: 1800, sizeZ: 1400, seg: 180, segZ: 140, heightAt: terrainH, colorAt });
  scene.add(terrain);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(RIVER_HALF * 2 + 20, 1400, 20, 60), new THREE.MeshPhongMaterial({ color: '#86aebb', shininess: 90, transparent: true, opacity: 0.9, flatShading: true }));
  water.rotation.x = -Math.PI / 2; water.position.y = 0; scene.add(water);
  const wpos = water.geometry.attributes.position; const wbase = wpos.array.slice();
  // 染溪
  const creek = makeRibbon(pathPoints(CREEK, 2), 3.4, terrainH, { color: '#9cc0c6', lift: 0.6, seg: 2 });
  scene.add(creek);

  // 碼頭（東岸）
  const dock = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 0.25, 4), lam('#7a5b3e')); deck.position.set(84, 1.1, 0); dock.add(deck);
  for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), lam('#5a4330')); p.position.set(77 + i * 2.8, -1, i % 2 ? 1.9 : -1.9); dock.add(p); }
  scene.add(dock);
  // 對岸小碼頭
  const deck2 = new THREE.Mesh(new THREE.BoxGeometry(10, 0.25, 3), lam('#7a5b3e')); deck2.position.set(-82, 1.1, 0); scene.add(deck2);

  // 船與船家
  const boat = makeBoat(); boat.position.set(73, 0.1, 0); scene.add(boat);
  const boatman = makePerson({ preset: 'boatman', name: '船家' });
  boatman.position.set(2.2, 0.3, 0); boatman.rotation.y = -Math.PI / 2; boat.add(boatman);
  E.persons.add(boatman);
  const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 5), lam('#8a6a48')); oar.position.set(0.25, -0.9, 0.2); oar.rotation.x = 0.6; boatman.userData.armR.add(oar);

  // 路（三條）
  const pathM = { color: '#9a8b68', opacity: 1, lift: 0.08, seg: 1 };
  const along = makeRibbon(pathPoints([{ x: -92, z: 8 }, { x: -120, z: 8 }, { x: -150, z: 13 }, { x: -185, z: 10 }, { x: -220, z: 19 }], 2), 1.6, terrainH, pathM);
  const back = makeRibbon(pathPoints([{ x: -92, z: -4 }, { x: -95, z: -40 }, { x: -92, z: -90 }, { x: -96, z: -150 }], 2), 1.6, terrainH, pathM);
  scene.add(along, back);
  along.material = back.material = new THREE.MeshLambertMaterial({ color: '#9a8b68', side: THREE.DoubleSide });

  // 竹杖痕跡與腳印（沿溪）
  const staffPts = pathPoints([{ x: -93, z: 9 }, { x: -118, z: 8.5 }, { x: -148, z: 12.5 }], 0.9);
  const holes = new THREE.Group();
  const holeM = new THREE.MeshBasicMaterial({ color: '#2b2118', transparent: true, opacity: 0.7, depthWrite: false });
  staffPts.forEach((p, i) => { if (i % 2) return; const h = new THREE.Mesh(new THREE.CircleGeometry(0.06, 8), holeM); h.rotation.x = -Math.PI / 2; h.position.set(p.x + 0.45, terrainH(p.x + 0.45, p.z) + 0.1, p.z + 0.3); holes.add(h); });
  scene.add(holes);
  scene.add(makeFootprints(staffPts, (x, z) => terrainH(x, z) + 0.06, { opacity: 0.55 }));

  // 樹與蘆葦
  const trees = scatter(700, 9, (x, z, r) => {
    if (Math.abs(x) < RIVER_HALF + 8) return false;
    if (x < -70 && distToPolyline(x, z, CREEK) < 7) return false;
    if (Math.hypot(x + 92, z - 4) < 16 || Math.hypot(x - 86, z) < 14) return false;
    const near = Math.hypot(x + 150, z - 10) < 90 || Math.abs(x - 110) < 60;
    if (!near && r() < 0.6) return false;
    if (Math.hypot(x - WEST_HILL.x, z - WEST_HILL.z) < 280) return r() < 0.5 ? { type: r() < 0.6 ? 'song' : 'pine', s: 2.5 + r() * 2 } : false;
    const t = r();
    return { type: t < 0.3 ? 'pine' : t < 0.55 ? 'broad' : t < 0.72 ? 'bamboo' : t < 0.88 ? 'maple' : 'ginkgo', s: 1 + r() * 1.2 };
  }, { x0: -900, x1: 700, z0: -600, z1: 600 });
  // 岸邊蘆葦
  const rr = rng(5);
  for (let i = 0; i < 140; i++) {
    const side = rr() < 0.5 ? -1 : 1, x = side * (RIVER_HALF - 1 + rr() * 7), z = (rr() - .5) * 400;
    if (Math.abs(z) < 7) continue;
    trees.push({ type: 'reed', x, z, s: 0.8 + rr() * 0.6, rot: rr() * 6 });
  }
  // 染溪邊的蘆葦
  pathPoints(CREEK, 6).forEach((p, i) => { if (i % 2) return; const side = i % 4 ? 3.5 : -3.5; trees.push({ type: 'reed', x: p.x + rr() * 2, z: p.z + side, s: 0.7 + rr() * 0.4 }); });
  scene.add(makeTrees(trees, terrainH));
  scene.add(makeGrassField({ count: 1600, area: { x0: -240, x1: 140, z0: -60, z1: 60 }, heightAt: terrainH, accept: (x, z) => Math.abs(x) > RIVER_HALF + 6 && !(x < -70 && distToPolyline(x, z, CREEK) < 3), seed: 21 }));
  addXishanPinnacles(scene, WEST_HILL.x, WEST_HILL.z, terrainH, 7, 10);
  const clouds = makeClouds({ count: 30, rMin: 600, rMax: 1600, yMin: 260, yMax: 460, seed: 8 });
  const mist = makeMist({ count: 30, center: [0, 0], rMax: 600, y: 2, yJitter: 3, size: [60, 140], opacity: 0.28, seed: 9 });
  const hillMist = makeMist({ count: 20, center: [WEST_HILL.x + 150, WEST_HILL.z], rMax: 300, y: 40, yJitter: 20, size: [120, 240], opacity: 0.4, seed: 10 });
  scene.add(clouds, mist, hillMist);

  const S = { boating: false };
  const heightAt = (x, z) => S.boating ? Math.max(terrainH(x, z), 0) + 0.45 : (Math.abs(x) < RIVER_HALF + 8 && Math.abs(z) < 2.2 && Math.abs(x) > RIVER_HALF - 12 ? 1.23 : Math.max(terrainH(x, z), 0.2));
  return {
    scene, heightAt, S, boat, boatman, oar,
    clamp: v => {
      if (S.boating) return;
      if (v.x > 0) { v.x = Math.max(v.x, Math.abs(v.z) < 2 ? 78 : RIVER_HALF + 3); v.x = Math.min(v.x, 140); }
      else { v.x = Math.min(v.x, Math.abs(v.z) < 1.5 ? -78 : -RIVER_HALF - 3); v.x = Math.max(v.x, -240); }
      v.z = Math.max(-120, Math.min(120, v.z));
      // 不可越過染溪
      if (v.x < -85 && v.z > 12.5 && distToPolyline(v.x, v.z, CREEK) < 4) v.z = Math.min(v.z, 12.5);
    },
    blockers: trees.filter(t => t.s > 1).map(t => ({ x: t.x, z: t.z, r: 0.4 })),
    walkables: [terrain, deck, deck2],
    animated: [clouds, mist, hillMist],
    update: (dt, t) => {
      const a = wpos.array;
      for (let i = 0; i < a.length; i += 3) a[i + 2] = wbase[i + 2] + Math.sin(wbase[i] * 0.2 + t * 1.2) * 0.12 + Math.cos(wbase[i + 1] * 0.05 + t) * 0.1;
      wpos.needsUpdate = true;
      boat.position.y = 0.1 + Math.sin(t * 1.3) * 0.05;
      boat.rotation.z = Math.sin(t * 0.9) * 0.015;
    },
  };
}

export async function chapter4() {
  audio.ambience({ wind: 0.4, water: 0.6, waterFreq: 500, birds: 0.5 });
  audio.music('xishan');
  const world = await enter(buildRiver, { x: 100, z: 0, yaw: Math.PI / 2, pitch: -0.05 });
  const { boat, boatman, oar, S } = world;
  ui.showDpad(true);
  await ui.chapterCard('第四關', '過湘江，緣染溪', '湘江渡口');
  await ui.say('', '湘江在眼前鋪開，江面寬闊。對岸遠處，那座奇異的山靜靜地立着。');
  ui.hideDialog();
  ui.objective('找船家渡江', '走到碼頭盡頭，點擊船上的船家。');
  unfreeze();

  await clue(boatman, '船家', async () => {
    watch(boatman, true);
    await lookAt(new THREE.Vector3(boat.position.x + 2.2, 2, 0), 0.8);
    await ui.say('船家', '要過江嗎？');
    await ui.choose([{ label: '請問今天有沒有一位先生，帶着僕人過江？' }], { name: '你' });
    await ui.say('船家', '柳先生？有啊，還是我撐船送過去的。');
    await ui.say('船家', '他一上船便站在船頭，一直望着對面那座山，連話也不多說。以前他出來，可從來不是這樣急。');
    await ui.say('船家', '上來吧，我送你過去。');
    ui.hideDialog();
  }, { range: 4.5 });

  // 上船
  freeze();
  S.boating = true;
  await moveTo(boat.position.x - 1, 0, 1.5, { eye: 1.5 });
  watch(boatman, false);
  boatman.userData.lookTarget = null;
  boatman.rotation.y = -Math.PI / 2;
  boatman.userData.customArms = true;
  await turnTo(Math.PI / 2, 0.02, 1);
  setControls({ move: false, look: true, interact: false });
  ui.objective('過湘江');
  const x0 = boat.position.x, x1 = -74;
  let oarT = 0;
  const row = (dt) => {
    oarT += dt;
    boatman.userData.armR.rotation.x = -0.9 + Math.sin(oarT * 1.6) * 0.5;
    boatman.userData.armL.rotation.x = -0.9 + Math.sin(oarT * 1.6) * 0.5;
    if (Math.sin(oarT * 1.6) > 0.98 && !row.p) { audio.oar(); row.p = true; } else if (Math.sin(oarT * 1.6) < 0.5) row.p = false;
  };
  E.onUpdate.push(row);
  const cap = (async () => { await wait(4); await ui.caption('過湘江', { gloss: '渡過湘江', hold: 4 }); })();
  await tween(13, k => {
    boat.position.x = lerp(x0, x1, k);
    E.player.pos.x = boat.position.x - 1;
  }, t => t < 0.1 ? t * t * 5 : t > 0.9 ? 1 - (1 - t) * (1 - t) * 5 : t);
  await cap;
  E.onUpdate.splice(E.onUpdate.indexOf(row), 1);
  ui.journalAdd('遊蹤', '湘江：乘船渡過湘江。', '過湘江');

  // 上岸
  await moveTo(-84, 0, 1.2, { eye: 1.6 });
  S.boating = false;
  await moveTo(-90, -1, 1);
  await turnTo(Math.PI, -0.12, 1.2);
  ui.mapVisit('creek');
  ui.mapRoute(['home', 'forest', 'temple', 'ferry', 'creek']);
  await ui.say('', '上了岸，前面是一條清澈的小溪，由西邊的山谷流出來，注入湘江——這就是染溪。');
  await ui.say('', '岸邊有好幾條路：一條越過小溪往南，一條沿着溪邊往西，一條沿江往北回城。');
  await ui.say('你', '柳先生會走哪一條？地上有沒有他的痕跡……');
  ui.hideDialog();
  ui.objective('留意地上的痕跡，判斷柳宗元的去向', '看看溪邊的泥地。');
  ui.showDpad(true);
  unfreeze();
  const mark = new THREE.Mesh(new THREE.SphereGeometry(0.8), new THREE.MeshBasicMaterial({ visible: false }));
  mark.position.set(-96, world.heightAt(-96, 9) + 0.3, 9); world.scene.add(mark);
  await clue(mark, '泥地上的痕跡', async () => {
    await lookAt(new THREE.Vector3(-100, world.heightAt(-100, 9), 9), 0.8);
    await ui.say('', '泥地上有一排小圓孔——是竹杖戳下的痕跡。旁邊還有好幾個人的腳印。');
    await ui.say('你', '是柳先生的竹杖！痕跡往……');
    ui.hideDialog();
  }, { range: 4 });

  // 面向染溪，讓箭嘴對應畫面方向
  freeze();
  await moveTo(-93, 2, 1);
  await turnTo(Math.PI, -0.1, 1);
  const res = await ui.arrowPick({
    prompt: '竹杖痕跡往哪個方向延伸？（「緣染溪」的「緣」）',
    options: [
      { arrow: '←', label: '遠離溪流', feedback: '那條路沿江往北，是回城的路。竹杖痕跡不在那邊。' },
      { arrow: '↑', label: '越過溪流', feedback: '溪上沒有橋，對岸泥地上也沒有任何腳印。' },
      { arrow: '→', label: '沿着溪流', correct: true },
    ],
  });
  await ui.caption('緣染溪', { gloss: '緣：沿着。沿着染溪向上游走。', hold: 4.5 });
  ui.journalAdd('字詞', '緣：沿着。「緣染溪」即沿着染溪而行。', '緣染溪');
  ui.journalAdd('遊蹤', '染溪：沿着溪流向西走，竹杖痕跡一路延伸。', '緣染溪');

  // 沿溪而行
  ui.objective('沿着染溪，追蹤竹杖痕跡');
  const route = pathPoints([{ x: -93, z: 8 }, { x: -120, z: 8 }, { x: -150, z: 13 }, { x: -185, z: 10 }, { x: -220, z: 19 }], 1);
  let i = 0;
  const L = route.length - 1;
  await tween(12, k => {
    const f = k * L, a = Math.floor(f), b = Math.min(L, a + 1), t = f - a;
    const x = lerp(route[a].x, route[b].x, t), z = lerp(route[a].z, route[b].z, t);
    E.player.pos.x = x; E.player.pos.z = z;
    E.walking = true; E.player.bob += 0.15;
    const want = Math.atan2(-(route[b].x - route[a].x), -(route[b].z - route[a].z));
    E.player.yaw += angleDiff(E.player.yaw, want) * 0.05;
    E.player.pitch += (0.08 - E.player.pitch) * 0.03;
  }, t => t);
  await ui.say('', '溪水越來越窄，山勢越來越高。那座山，已經近在眼前。');
  ui.hideDialog();
}
