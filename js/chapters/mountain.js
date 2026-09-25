// 第五關：山路消失了（西山山腳）——斫榛莽，焚茅茷
// 第六關：攀援而登（西山山腰）
import { E, THREE, ui, audio, enter, clue, watch, until, addHitProxy } from './common.js';
import { addInteractable, removeInteractable, freeze, unfreeze, wait, lookAt, moveTo, turnTo, tween, setControls, lerp, raycastFrom, angleDiff } from '../engine.js';
import {
  baseScene, makeTerrain, makeTrees, scatter, makeRock, makeGrassPatch, makeRibbon, makeFootprints, pathPoints, makeFire, makeSmoke, makeStaff,
  mergeColored, mat, vcMat, fbm, noise2, rng, mixHex, smoothstep, lam,
} from '../world.js';
import { makeClouds, makeMist, makeGrassField, makePinnacle } from '../scenery.js';

// ================= 第五關 =================
function footH(x, z) {
  let h = fbm(x * 0.05, z * 0.05, 3, 21) * 0.8;
  if (x < 0) h += -x * 0.22;
  const az = Math.abs(z);
  // 兩側陡峭山壁，中間是一條山溝
  const wall = smoothstep(6, 11, az) * (8 + Math.max(0, -x) * 0.25) + smoothstep(11, 40, az) * 20;
  h += wall;
  if (x > 6) h += smoothstep(6, 60, x) * 6 + fbm(x * 0.02, z * 0.02, 3, 5) * 3;
  return h;
}
function footColor(h, slope, x, z) {
  const n = noise2(x * 0.1, z * 0.1, 3) * 0.5 + 0.5;
  let c = mixHex('#5e7a3f', '#78874a', n);
  if (slope > 0.35) c = mixHex(c, '#8a8070', smoothstep(0.35, 0.6, slope));
  return c;
}

function makeThornBush(seed) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < 7; i++) parts.push({ geo: new THREE.IcosahedronGeometry(0.55 + r() * 0.4, 0), color: new THREE.Color('#3f5a30').offsetHSL(0, 0, (r() - .5) * 0.08), matrix: mat((r() - .5) * 1.6, 0.5 + r() * 1.3, (r() - .5) * 1.4, 0, r() * 3, 0, 1, 0.9, 1) });
  for (let i = 0; i < 8; i++) parts.push({ geo: new THREE.CylinderGeometry(0.02, 0.035, 1.4, 4), color: '#4a3a2a', matrix: mat((r() - .5) * 1.4, 0.8, (r() - .5) * 1.2, (r() - .5) * 1.2, 0, (r() - .5) * 1.2) });
  const m = new THREE.Mesh(mergeColored(parts), vcMat());
  return m;
}
function makeThatch(seed) {
  const g = makeGrassPatch(30, 1.1, { seed, color: '#c4a960', height: 1.9 });
  g.material = vcMat();
  return g;
}
function makeAxe() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.75, 6), lam('#7a5a3a')); handle.position.y = 0.37; g.add(handle);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.035), lam('#6d7075')); head.position.set(0.08, 0.7, 0); g.add(head);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.03), lam('#b5b8bc')); edge.position.set(0.19, 0.7, 0); g.add(edge);
  return g;
}
function makeTorch(lit = true) {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.7, 6), lam('#6a4a30')); stick.position.y = 0.35; g.add(stick);
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.14, 6), lam('#4b3b28')); wrap.position.y = 0.72; g.add(wrap);
  if (lit) { const f = makeFire(0.5); f.position.y = 0.76; g.add(f); g.userData.fire = f; }
  return g;
}

function buildFoot() {
  const B = baseScene({ fog: '#d4d8cf', fogNear: 30, fogFar: 320, sky: { top: '#6d9bc6', sunDir: [-0.45, 0.46, 0.35], sunColor: '#ffeccc' }, hemi: ['#e2e8ea', '#5a5240', 1.05], sun: ['#ffe8c6', 1.9] });
  const { scene } = B;
  const terrain = makeTerrain({ size: 260, seg: 130, heightAt: footH, colorAt: footColor });
  scene.add(terrain);
  // 染溪源頭
  const creek = makeRibbon(pathPoints([{ x: 3, z: 2 }, { x: 14, z: 5 }, { x: 30, z: 2 }, { x: 60, z: 8 }, { x: 100, z: 4 }], 2), 2.4, footH, { color: '#9cc0c6', lift: 0.15 });
  scene.add(creek);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 16), new THREE.MeshPhongMaterial({ color: '#7fa9b2', shininess: 90 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(3, footH(3, 2) + 0.12, 2); scene.add(pool);
  // 山溝兩側的石壁
  const rr = rng(33);
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1, x = 4 - rr() * 50, z = side * (7 + rr() * 3);
    const rock = makeRock(1.5 + rr() * 2, '#8a8474', 200 + i); rock.position.set(x, footH(x, z) + 0.5, z); rock.scale.y = 1.4 + rr(); scene.add(rock);
  }
  const trees = scatter(260, 71, (x, z, r) => {
    if (Math.abs(z) < 12 && x < 8 && x > -60) return false;
    if (Math.abs(z) < 7) return false;
    const t = r();
    return { type: t < 0.4 ? 'pine' : t < 0.6 ? 'song' : t < 0.8 ? 'broad' : 'maple', s: 1 + r() * 0.9 };
  }, { x0: -120, x1: 120, z0: -120, z1: 120 });
  scene.add(makeTrees(trees, footH));
  scene.add(makeGrassField({ count: 700, area: { x0: -45, x1: 14, z0: -8, z1: 8 }, heightAt: footH, accept: (x, z) => (x > -5 || x < -19) && Math.hypot(x - 3, z - 2) > 2.5, seed: 17, scale: [0.4, 0.8] }));
  const clouds = makeClouds({ count: 16, rMin: 250, rMax: 700, yMin: 130, yMax: 220, size: [150, 300], seed: 18 });
  scene.add(clouds);

  // 榛莽（第一排）與茅茷（第二排）
  const bushes = [];
  const bushZ = [-4.2, -2.1, 0, 2.1, 4.2];
  bushZ.forEach((z, i) => {
    const b = makeThornBush(40 + i);
    const x = -8 - (i % 2) * 0.8;
    b.position.set(x, footH(x, z) - 0.1, z);
    b.scale.setScalar(1.2);
    scene.add(b);
    b.userData.hp = 3; b.userData.kind = 'bush';
    bushes.push(b);
  });
  const thatch = [];
  const tz = [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5];
  tz.forEach((z, i) => {
    const t = makeThatch(60 + i);
    const x = -13 - (i % 2) * 1.2;
    t.position.set(x, footH(x, z), z);
    t.scale.set(1.1, 1.1, 1.1);
    scene.add(t);
    t.userData.heat = 0; t.userData.kind = 'grass';
    // 草葉很細，另加一個看不見的圓柱方便點擊／拖動
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1; t.add(hit);
    thatch.push(t);
  });
  // 更遠處的茂密草木（純裝飾）
  for (let i = 0; i < 16; i++) {
    const x = -20 - rr() * 20, z = (rr() - .5) * 10;
    const g = makeGrassPatch(10, 1, { seed: 400 + i, color: '#8f9a55', height: 0.9 }); g.position.set(x, footH(x, z), z); scene.add(g);
  }
  // 開出的路（完成後出現）
  const path = makeRibbon(pathPoints([{ x: -6, z: 0 }, { x: -14, z: 0.5 }, { x: -24, z: -0.5 }, { x: -40, z: 0 }], 1.5), 2, footH, { color: '#8e7c5a', opacity: 1, lift: 0.07 });
  path.material = new THREE.MeshLambertMaterial({ color: '#8e7c5a', side: THREE.DoubleSide });
  path.visible = false; scene.add(path);

  const bushWall = { type: 'box', minX: -10, maxX: -6.5, minZ: -7, maxZ: 7, r: 0.4 };
  const grassWall = { type: 'box', minX: -15.5, maxX: -11.5, minZ: -7, maxZ: 7, r: 0.4 };
  return {
    scene, heightAt: footH, bushes, thatch, path, bushWall, grassWall, animated: [clouds],
    clamp: v => { v.z = Math.max(-5.8, Math.min(5.8, v.z)); v.x = Math.max(-44, Math.min(12, v.x)); },
    blockers: [bushWall, grassWall, { x: 3, z: 2, r: 1.8 }],
    walkables: [terrain],
    update: (dt, t) => { scene.traverse(o => { if (o.userData.animate) o.userData.animate(t); }); },
  };
}

export async function chapter5() {
  audio.ambience({ wind: 0.4, water: 0.25, waterFreq: 1300, birds: 0.6 });
  audio.music('xishan');
  const world = await enter(buildFoot, { x: 8, z: 0, yaw: Math.PI / 2, pitch: 0.02 });
  const scene = world.scene, H = footH;
  ui.showDpad(true);
  ui.mapVisit('xishan');
  ui.mapRoute(['home', 'forest', 'temple', 'ferry', 'creek', 'xishan']);
  await ui.chapterCard('第五關', '山路消失了', '西山・山腳');
  await ui.say('', '染溪在這裏到了盡頭。');
  await ui.say('', '可是前面——沒有路了。');
  await ui.say('', '山溝裏長滿了帶刺的灌木，後面是一人多高的茅草，密不透風。');
  await ui.say('你', '是不是走錯了？柳先生不可能從這裏上去吧……');
  ui.hideDialog();

  let found = 0;
  const prog = () => ui.objective(`搜查灌木叢前的痕跡（${found}／3）`, '在草木前面仔細看看地上。');
  prog();
  unfreeze();

  // 三種痕跡
  const branch = new THREE.Group();
  const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.2, 5), lam('#5a4332')); b1.rotation.z = Math.PI / 2; b1.position.y = 0.06; branch.add(b1);
  const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 5), lam('#d8c29a')); b2.rotation.z = Math.PI / 2 + 0.5; b2.position.set(0.7, 0.12, 0); branch.add(b2);
  branch.position.set(-4.5, H(-4.5, -3.2), -3.2); scene.add(branch);
  const cutPile = makeThornBush(90); cutPile.scale.set(0.5, 0.25, 0.5); cutPile.rotation.z = 1.2; cutPile.position.set(-5, H(-5, 3.6) + 0.3, 3.6); scene.add(cutPile);
  const burnt = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12), new THREE.MeshBasicMaterial({ color: '#1f1b17', transparent: true, opacity: 0.85, depthWrite: false }));
  burnt.rotation.x = -Math.PI / 2; burnt.position.set(-4, H(-4, 0.6) + 0.05, 0.6); scene.add(burnt);
  const stubble = makeGrassPatch(14, 0.9, { seed: 5, color: '#2c2621', height: 0.25 }); stubble.position.copy(burnt.position); scene.add(stubble);
  const smoke = makeSmoke(); smoke.position.copy(burnt.position); scene.add(smoke);

  await Promise.all([
    clue(branch, '斷掉的樹枝', async () => { await ui.say('', '一根樹枝斷在地上。斷口很整齊，還是新的——不是自己折斷的，是被砍下來的。'); ui.hideDialog(); }).then(() => { found++; prog(); }),
    clue(cutPile, '一堆灌木', async () => { await ui.say('', '一堆帶刺的灌木被砍倒，拖到路邊。枝葉還是綠的。'); ui.hideDialog(); }).then(() => { found++; prog(); }),
    clue(stubble, '燒焦的地面', async () => { await ui.say('', '地上一大片焦黑，還冒着細細的煙。是茅草被燒過的痕跡。'); ui.hideDialog(); }).then(() => { found++; prog(); }),
  ]);
  freeze();
  await ui.question({
    title: '柳宗元等人為甚麼會留下這些痕跡？',
    lead: '被砍斷的樹枝、砍倒的灌木、燒焦的茅草……而且都是今天留下的。',
    options: [
      { label: '他們在這裏生火煮食', feedback: '如果只是煮食，用不着砍倒整片灌木。' },
      { label: '他們迷路了，留下記號', feedback: '記號不必砍倒一大片草木、還要放火。' },
      { label: '他們要在沒有路的地方開出一條上山的路', correct: true, feedback: '對！山上本來沒有路。他們砍掉灌木、燒掉茅草，硬是開出一條路來。' },
      { label: '僕人砍柴，準備帶回家', feedback: '砍下的灌木都丟在一旁，沒有帶走。' },
    ],
  });
  await ui.say('你', '他們開過路，可是倒下的枝葉和亂草又把縫隙堵住了。');
  await ui.say('你', '我也得自己開路。先找工具。');
  ui.hideDialog();

  // 工具
  ui.objective('找到開路的工具：斧頭、火把', '看看樹樁和還冒着煙的火堆。');
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.5, 8), lam('#6b513a')); stump.position.set(-2.5, H(-2.5, -5) + 0.25, -5); scene.add(stump);
  const axeOnStump = makeAxe(); axeOnStump.rotation.z = 0.5; axeOnStump.position.set(-2.4, H(-2.5, -5) + 0.35, -5); scene.add(axeOnStump);
  const embers = makeFire(0.5); embers.position.set(-1.5, H(-1.5, 4.8) + 0.05, 4.8); scene.add(embers);
  const ring = new THREE.Group(); for (let i = 0; i < 7; i++) { const s = makeRock(0.18, '#6b665c', 500 + i); const a = i / 7 * 6.28; s.position.set(Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5); ring.add(s); } ring.position.copy(embers.position); scene.add(ring);
  const torchOnGround = makeTorch(false); torchOnGround.rotation.z = 1.3; torchOnGround.position.set(-0.8, H(-0.8, 4.4) + 0.08, 4.4); scene.add(torchOnGround);

  const tools = new Set();
  const heldAxe = makeAxe(); heldAxe.position.set(0.38, -0.66, -0.8); heldAxe.rotation.set(-0.2, 0, 0.35); heldAxe.visible = false; E.camera.add(heldAxe);
  const heldTorch = makeTorch(true); heldTorch.scale.setScalar(0.7); heldTorch.position.set(0.42, -0.62, -0.95); heldTorch.rotation.set(-0.35, 0, 0.25); heldTorch.visible = false; E.camera.add(heldTorch);
  let current = null;
  const toolHandlers = {};
  const setTool = (id) => {
    current = id;
    heldAxe.visible = id === 'axe'; heldTorch.visible = id === 'torch';
    ui.toolbarActive(id);
    E.tool = toolHandlers[id];
  };
  const refreshBar = () => ui.toolbar([...tools].map(id => ({ id, label: id === 'axe' ? '斧頭' : '火把' })), setTool);

  unfreeze();
  const gotAxe = clue(axeOnStump, '斧頭', async () => {
    await ui.say('', '樹樁上插着一把斧頭，大概是僕人留下的。');
    ui.hideDialog();
    scene.remove(axeOnStump);
    tools.add('axe'); refreshBar(); setTool('axe');
    ui.toast('獲得：斧頭');
  });
  const gotTorch = clue(torchOnGround, '火把', async () => {
    await ui.say('', '火堆旁有一支燒過的火把。你把它湊到餘燼上——火重新燃了起來。');
    ui.hideDialog();
    scene.remove(torchOnGround);
    tools.add('torch'); refreshBar(); setTool('torch');
    ui.toast('獲得：火把');
  });
  await Promise.all([gotAxe, gotTorch]);

  // ---- 砍與燒 ----
  let cut = 0, burned = 0;
  const prog2 = () => ui.objective(`斫榛莽：用斧頭砍開灌木（${cut}／${world.bushes.length}）　焚茅茷：用火把燒掉茅草（${burned}／${world.thatch.length}）`, '在右下角選擇工具。斧頭：點擊灌木。火把：按住茅草並拖動。');
  prog2();
  let resolveAll;
  const allDone = new Promise(r => resolveAll = r);
  const check = () => {
    prog2();
    if (cut === world.bushes.length) world.bushWall.active = false;
    if (burned === world.thatch.length) world.grassWall.active = false;
    if (cut === world.bushes.length && burned === world.thatch.length) resolveAll();
  };
  const targets = () => [...world.bushes.filter(b => b.userData.hp > 0), ...world.thatch.filter(t => t.userData.heat < 1)];
  const hitTarget = (x, y) => {
    const hits = raycastFrom(x, y, targets());
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.kind) o = o.parent;
    return o ? { obj: o, dist: hits[0].distance, point: hits[0].point } : null;
  };
  let swinging = false;
  const swing = async () => {
    swinging = true;
    await tween(0.12, k => { heldAxe.rotation.x = -0.2 - k * 1.2; });
    await tween(0.18, k => { heldAxe.rotation.x = -1.4 + k * 1.2; });
    swinging = false;
  };
  let burning = null;
  Object.assign(toolHandlers, {
    axe: {
      hover: (x, y) => { const h = hitTarget(x, y); return h && h.obj.userData.kind === 'bush' ? '砍' : null; },
      onClick: (x, y) => {
        const h = hitTarget(x, y);
        if (!h) return false;
        if (h.obj.userData.kind !== 'bush') { ui.toast('茅草太密，砍不完——試試用火把。'); return true; }
        if (h.dist > 4.2) { ui.toast('太遠了，走近一點。'); return true; }
        if (swinging) return true;
        swing();
        audio.chop();
        const b = h.obj;
        b.userData.hp--;
        const r0 = b.rotation.z;
        tween(0.25, k => { b.rotation.z = r0 + Math.sin(k * Math.PI * 3) * 0.08; });
        E.shake = 0.03;
        if (b.userData.hp <= 0) {
          audio.crack();
          const y0 = b.position.y;
          tween(1.2, k => { b.rotation.z = r0 + k * 1.4; b.position.y = y0 - k * 0.8; b.scale.setScalar(1.2 * (1 - k * 0.5)); }).then(() => { b.visible = false; });
          cut++; check();
        }
        return true;
      },
    },
    torch: {
      hover: (x, y) => { const h = hitTarget(x, y); return h && h.obj.userData.kind === 'grass' ? '按住拖動，點燃茅草' : null; },
      onClick: (x, y) => {
        const h = hitTarget(x, y);
        if (h && h.obj.userData.kind === 'bush') { ui.toast('灌木太濕，燒不起來——試試用斧頭砍。'); return true; }
        return false;
      },
      onDown: (x, y) => {
        const h = hitTarget(x, y);
        if (!h || h.obj.userData.kind !== 'grass') return false;
        if (h.dist > 9) { ui.toast('太遠了，走近一點。'); return false; }
        burning = h.obj; return true;
      },
      onDrag: (x, y) => { const h = hitTarget(x, y); burning = (h && h.obj.userData.kind === 'grass' && h.dist < 9) ? h.obj : null; if (burning) burning.userData.heat += 0.03; },
      onUp: () => { burning = null; },
    },
  });
  // 燃燒進度
  let crackleT = 0;
  const burnUpdate = (dt) => {
    heldTorch.userData.fire.userData.animate(E.time);
    if (!burning) return;
    const t = burning;
    t.userData.heat += dt * 0.9;
    crackleT -= dt;
    if (crackleT <= 0) { audio.crackle(); crackleT = 0.35; }
    if (!t.userData.fire) {
      const f = makeFire(1.4); f.position.y = 0.2; t.add(f); t.userData.fire = f;
    }
    // 慢慢變黑
    const k = Math.min(1, t.userData.heat);
    t.material.color.setRGB(1 - k * 0.8, 1 - k * 0.82, 1 - k * 0.85);
    if (t.userData.heat >= 1 && !t.userData.done) {
      t.userData.done = true;
      burning = null;
      const s0 = t.scale.y;
      tween(1.5, kk => { t.scale.y = s0 * (1 - kk * 0.85); }).then(() => {
        setTimeout(() => { if (t.userData.fire) { t.remove(t.userData.fire); } const sm = makeSmoke(); t.add(sm); }, 1200);
      });
      burned++; check();
    }
  };
  E.onUpdate.push(burnUpdate);
  await allDone;

  // 完成
  freeze();
  E.onUpdate.splice(E.onUpdate.indexOf(burnUpdate), 1);
  E.tool = null; E.camera.remove(heldAxe, heldTorch); ui.toolbar([]);
  world.path.visible = true;
  await tween(1.2, k => { world.path.material.opacity = k; });
  await ui.say('', '灌木倒下了，茅草燒成了灰。一條小路，從山溝裏露了出來。');
  ui.hideDialog();
  await lookAt(new THREE.Vector3(-30, H(-30, 0) + 2, 0), 1.2);
  await ui.caption('遂命僕人過湘江，緣染溪，斫榛莽，焚茅茷。', { gloss: '於是命令僕人渡過湘江，沿着染溪，砍伐叢生的草木，焚燒茂密的茅草。', hold: 8 });
  ui.journalAdd('字詞', '斫：砍。榛莽：叢生的草木。焚：燒。茅茷：茂密的茅草。', '斫榛莽，焚茅茷');
  ui.journalAdd('活動', '命僕人開路：砍伐草木、焚燒茅草——目標明確，一往直前。', '遂命僕人過湘江，緣染溪，斫榛莽，焚茅茷');
  ui.journalAdd('遊蹤', '西山山腳：開出上山的路。');
  await ui.say('你', '以前他「漫漫而遊」，走到哪裏算哪裏。今天卻是自己開路，非上去不可。');
  ui.hideDialog();
  ui.objective('沿着開出的路上山');
  const up = new THREE.Mesh(new THREE.SphereGeometry(1.2), new THREE.MeshBasicMaterial({ visible: false }));
  up.position.set(-34, H(-34, 0) + 1, 0); scene.add(up);
  unfreeze();
  await clue(up, '上山', async () => {});
  freeze();
}

// ================= 第六關 =================
function cliffX(y) { return -y / 4.4; }
const LEDGES = [
  { x: 3, z: 0, y: 0 },
  { x: cliffX(20) + 1.7, z: -1.5, y: 20 },
  { x: cliffX(43) + 1.7, z: 1.8, y: 43 },
  { x: cliffX(72) + 1.7, z: -0.8, y: 72 },
  { x: cliffX(104) - 1.5, z: 0.5, y: 104 },
];
function slopeH(x, z) {
  let h;
  if (x < 0) {
    h = -x * 4.4 + fbm(x * 0.2, z * 0.2, 3, 8) * (Math.abs(z) < 5 ? 0.8 : 2.5);
    if (x < -23.5) h = 104 + fbm(x * 0.05, z * 0.05, 3, 8) * 2 + (-(x + 23.5)) * 0.3;
  } else {
    h = -Math.min(x, 60) * 0.08 + fbm(x * 0.02, z * 0.02, 3, 6) * 2;
    if (x > 60) h = -4.8 - (x - 60) * 0.02 + fbm(x * 0.004, z * 0.004, 4, 6) * 14;
  }
  // 山的兩側向下
  h -= smoothstep(18, 120, Math.abs(z)) * Math.max(0, -x) * 2;
  // 湘江河道
  h = lerp(h, -22, 1 - smoothstep(70, 110, Math.abs(x - 500)));
  return h;
}
function slopeColor(h, slope, x, z) {
  const n = noise2(x * 0.08, z * 0.08, 9) * 0.5 + 0.5;
  let c = mixHex('#55713d', '#6f8446', n);
  if (slope > 0.45) c = mixHex(c, mixHex('#8d8575', '#a39a88', n), smoothstep(0.45, 0.7, slope));
  if (x > 200) c = mixHex('#6c8a4a', '#88965a', n);
  return c;
}
function makeHold(type, seed) {
  const g = new THREE.Group();
  const r = rng(seed);
  if (type === 'rock') {
    const m = makeRock(0.45, '#8f897b', seed); m.scale.set(1.2, 0.8, 1); g.add(m);
  } else if (type === 'loose') {
    for (let i = 0; i < 9; i++) { const m = makeRock(0.1 + r() * 0.08, '#aaa290', seed + i); m.position.set((r() - .5) * 0.6, (r() - .5) * 0.3, (r() - .5) * 0.3); g.add(m); }
  } else if (type === 'moss') {
    const m = makeRock(0.42, '#4d7a3a', seed); m.material = new THREE.MeshPhongMaterial({ color: '#4f7d3b', shininess: 120, specular: 0x88aa88, flatShading: true }); g.add(m);
  } else if (type === 'root') {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.8, -0.2), new THREE.Vector3(0.25, 0.3, 0.15), new THREE.Vector3(0, -0.2, 0.25), new THREE.Vector3(-0.3, -0.6, 0)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.085, 6), lam('#6b4a30')));
  } else if (type === 'twig') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, 0.9, 4), lam('#9a948a')); m.rotation.x = Math.PI / 2 - 0.3; m.position.z = 0.4; g.add(m);
    const m2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.35, 4), lam('#9a948a')); m2.rotation.set(Math.PI / 2 - 0.3, 0, 0.7); m2.position.set(0.1, 0.05, 0.6); g.add(m2);
  } else if (type === 'vine') {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.8, -0.1), new THREE.Vector3(0.1, 0.9, 0.12), new THREE.Vector3(-0.1, 0, 0.18), new THREE.Vector3(0.05, -0.8, 0.15)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.05, 5), lam('#55642f')));
    for (let i = 0; i < 8; i++) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.09, 5), new THREE.MeshLambertMaterial({ color: '#5f8a3a', side: THREE.DoubleSide })); const p = curve.getPoint(i / 8); l.position.copy(p); l.position.z += 0.05; l.rotation.set(r(), r(), r()); g.add(l); }
  }
  return g;
}
const HOLD_INFO = {
  rock: { label: '突出的岩石', ok: true, msg: '岩石牢牢嵌在山壁裏，踩上去紋絲不動。' },
  root: { label: '粗壯的樹根', ok: true, msg: '樹根又粗又韌，抓得很穩。' },
  vine: { label: '粗壯的藤蔓', ok: true, msg: '藤蔓纏得很緊，拉一拉，承得住人。' },
  loose: { label: '一堆碎石', ok: false, msg: '碎石一踩便嘩啦啦地滑下山去！' },
  moss: { label: '長滿青苔的濕石', ok: false, msg: '青苔又濕又滑，腳一踏便溜開了！' },
  twig: { label: '乾枯的細枝', ok: false, msg: '枯枝「啪」的一聲折斷了！' },
};
const STAGES = [
  ['rock', 'loose', 'moss'],
  ['root', 'twig', 'loose'],
  ['vine', 'moss', 'twig'],
  ['rock', 'twig', 'loose'],
];

function buildSlope() {
  const B = baseScene({ fog: '#dcdcd0', fogNear: 120, fogFar: 1900, sky: { top: '#6897c4', sunDir: [-0.5, 0.4, 0.35], sunColor: '#ffe6c2' }, hemi: ['#e4e6e4', '#5a5240', 1.05], sun: ['#ffe2bc', 1.9] });
  const { scene } = B;
  const near = makeTerrain({ size: 200, seg: 150, heightAt: slopeH, colorAt: slopeColor }); scene.add(near);
  const far = makeTerrain({ size: 2600, seg: 150, cx: 900, heightAt: (x, z) => (x < 110 && Math.abs(z) < 110 ? slopeH(x, z) - 30 : slopeH(x, z) - 0.3), colorAt: slopeColor }); scene.add(far);
  // 山下的染溪與遠處的湘江
  const creekPts = pathPoints([{ x: 8, z: 0 }, { x: 40, z: 6 }, { x: 90, z: -4 }, { x: 150, z: 10 }, { x: 230, z: 4 }, { x: 330, z: 16 }, { x: 420, z: 8 }], 3);
  const creek = makeRibbon(creekPts, 3, (x, z) => slopeH(x, z) - 0.3, { color: '#a9ccd2', lift: 0.5 }); scene.add(creek);
  const river = new THREE.Mesh(new THREE.PlaneGeometry(160, 2600), new THREE.MeshPhongMaterial({ color: '#9fc2cc', shininess: 80 }));
  river.rotation.x = -Math.PI / 2; river.position.set(500, -19.5, 0); scene.add(river);
  const trees = scatter(900, 17, (x, z, r) => {
    if (Math.abs(z) < 8 && x < 6 && x > -26) return false;
    if (x > 440 && x < 580) return false;
    const t = r();
    return { type: x < 0 ? (t < 0.6 ? 'song' : 'pine') : t < 0.4 ? 'pine' : t < 0.7 ? 'broad' : t < 0.88 ? 'maple' : 'ginkgo', s: 1.2 + r() * (x > 60 ? 3 : 1), tilt: x < 0 ? 0.15 : 0 };
  }, { x0: -80, x1: 1400, z0: -800, z1: 800 });
  // 崖壁上的松：沿着攀爬路線兩旁
  for (let i = 0; i < 14; i++) { const y = 8 + i * 7, side = i % 2 ? 1 : -1; trees.push({ type: 'song', x: cliffX(y) + 0.6, z: side * (4 + (i * 1.3) % 3), s: 0.7 + (i % 3) * 0.2, rot: side > 0 ? 0.3 : 3.4, tilt: 0.25 }); }
  scene.add(makeTrees(trees, slopeH));
  const clouds = makeClouds({ count: 24, rMin: 500, rMax: 1500, yMin: 60, yMax: 260, size: [260, 520], seed: 19 });
  const mist = makeMist({ count: 30, center: [300, 0], rMax: 700, y: -8, yJitter: 6, size: [120, 260], opacity: 0.3, seed: 20 });
  scene.add(clouds, mist);
  // 平台
  LEDGES.forEach((L, i) => {
    if (i === 0) return;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.1, 0.6, 7), lam('#8a8474'));
    p.position.set(L.x - 0.5, L.y - 0.3, L.z); scene.add(p);
  });
  const heightAt = (x, z) => {
    for (let i = LEDGES.length - 1; i >= 1; i--) { const L = LEDGES[i]; if (Math.hypot(x - L.x + 0.5, z - L.z) < 1.8) return L.y; }
    return slopeH(x, z);
  };
  return { scene, heightAt, clamp: () => {}, blockers: [], walkables: [], animated: [clouds, mist] };
}

export async function chapter6() {
  audio.ambience({ wind: 0.55, water: 0, birds: 0.5 });
  audio.music('xishan');
  const world = await enter(buildSlope, { x: LEDGES[0].x, z: 0, yaw: Math.PI / 2, pitch: 0.55 });
  const scene = world.scene;
  setControls({ move: false, look: true, interact: false });
  ui.showDpad(false);
  await ui.chapterCard('第六關', '攀援而登', '西山・山腰');
  await ui.say('', '路開好了，以為就到了。');
  await ui.say('', '抬頭一看——西山仍然很高。山壁幾乎是直立的。');
  await ui.say('你', '柳先生就是從這裏爬上去的？');
  ui.hideDialog();
  await ui.caption('攀援而登', { gloss: '攀：抓住；援：牽引。抓着草木、手腳並用地往上爬。', hold: 4.5 });

  const clueAt = [
    { label: '勾在枝上的布絲', text: '一縷淺灰色的布絲勾在石縫的枝條上——和柳先生衣服的顏色一樣。', make: () => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.12), new THREE.MeshLambertMaterial({ color: '#a7b3b0', side: THREE.DoubleSide })); m.rotation.y = 0.8; return m; } },
    { label: '平台上的鞋印', text: '平台的泥上有一個鞋印，腳尖朝上。他就在前面。', make: () => makeFootprints([{ x: 0, z: -0.2 }, { x: 0, z: 0.2 }], () => 0.02, { opacity: 0.7 }) },
    { label: '竹杖', text: '柳先生的竹杖靠在石旁——山太陡，他要騰出雙手來爬了。', make: () => { const s = makeStaff(); s.rotation.z = 0.25; return s; } },
  ];

  for (let s = 0; s < STAGES.length; s++) {
    const L = LEDGES[s], N = LEDGES[s + 1];
    ui.objective(`攀援而登：選擇可靠的落腳點（${s + 1}／${STAGES.length}）`, '想想哪一樣承得住人的重量。');
    const types = [...STAGES[s]].sort(() => Math.random() - 0.5);
    const holds = types.map((t, i) => {
      const z = (i - 1) * 1.8;
      const y = L.y + 2.4 + Math.abs(i - 1) * 0.3;
      const h = makeHold(t, 900 + s * 10 + i);
      h.position.set(cliffX(y) + 0.75, y, L.z + z * 0.8);
      h.rotation.y = Math.PI / 2;
      scene.add(h);
      addHitProxy(h, 0.45);
      return h;
    });
    await turnTo(Math.PI / 2, 0.45, 0.8);
    setControls({ move: false, look: true, interact: true });
    // 等待正確選擇
    await new Promise(res => {
      holds.forEach((h, i) => {
        const info = HOLD_INFO[types[i]];
        const it = addInteractable({
          object: h, label: info.label, walk: false, range: 99,
          onClick: async () => {
            setControls({ interact: false });
            if (info.ok) {
              audio.discover();
              ui.toast(info.msg);
              holds.forEach(o => E.interactables.filter(x => x.object === o).forEach(removeInteractable));
              res();
            } else {
              audio.slip(); E.shake = 0.12;
              ui.toast(info.msg);
              removeInteractable(it);
              const y0 = h.position.y;
              tween(1.2, k => { h.position.y = y0 - k * 8; h.rotation.x += 0.1; }).then(() => scene.remove(h));
              await wait(0.6);
              setControls({ interact: true });
            }
          },
        });
      });
    });
    // 攀爬
    setControls({ move: false, look: false, interact: false });
    const p = E.player;
    const sx = p.pos.x, sz = p.pos.z, sy = p.groundY;
    audio.whoosh();
    const eyeOld = p.eye;
    // 暫時以直接控制高度的方式攀爬
    const ground = world.heightAt;
    let climbK = 0;
    world.heightAt = () => lerp(sy, N.y, climbK);
    await tween(3.2, k => {
      climbK = k;
      p.pos.x = lerp(sx, N.x, k); p.pos.z = lerp(sz, N.z, k);
      p.pitch = 0.45 + Math.sin(k * Math.PI) * 0.3;
      p.groundY = lerp(sy, N.y, k);
      E.player.bob += 0.2; p.yOffset = Math.sin(k * Math.PI * 6) * 0.05;
    });
    p.yOffset = 0;
    world.heightAt = ground;
    holds.forEach(h => scene.remove(h));

    // 路上的痕跡
    if (s < clueAt.length) {
      const c = clueAt[s];
      const obj = c.make();
      obj.position.set(N.x + 0.3, N.y + (s === 0 ? 0.6 : 0.02), N.z + 0.7);
      scene.add(obj);
      await turnTo(Math.atan2(-(obj.position.x - p.pos.x), -(obj.position.z - p.pos.z)), -0.5, 0.8);
      setControls({ look: true, interact: true });
      await clue(obj, c.label, async () => { await ui.say('', c.text); ui.hideDialog(); }, { walk: false, range: 99 });
      setControls({ move: false });
    }

    // 回頭
    if (s === 2) {
      ui.objective('回頭看看', '轉身，望向山下。');
      setControls({ move: false, look: true, interact: false });
      await ui.say('你', '已經爬了很高了……回頭看看？');
      ui.hideDialog();
      setControls({ move: false, look: true, interact: false });
      await new Promise(res => {
        const fn = () => {
          if (Math.abs(angleDiff(E.player.yaw, -Math.PI / 2)) < 0.6 && E.player.pitch < 0.1) { E.onUpdate.splice(E.onUpdate.indexOf(fn), 1); res(); }
        };
        E.onUpdate.push(fn);
      });
      setControls({ look: false });
      await turnTo(-Math.PI / 2, -0.28, 1.5);
      audio.whoosh();
      await ui.say('', '剛才走過的染溪，已經細得像一根絲線。遠處的湘江，也只剩下一條白色的帶子。');
      await ui.say('你', '原來已經這麼高了……');
      ui.hideDialog();
      await wait(1.5);
    }
  }

  // 登頂
  setControls({ move: false, look: false, interact: false });
  await turnTo(Math.PI / 2, 0.1, 1);
  await ui.caption('窮山之高而止', { gloss: '一直走到山的最高處才停下來。窮：盡、走到盡頭。', hold: 5 });
  ui.journalAdd('遊蹤', '西山山腰：攀援而登，一直到山頂。', '窮山之高而止');
  ui.journalAdd('活動', '攀援而登：抓着草木、手腳並用地往上爬。', '攀援而登');
  ui.journalAdd('字詞', '窮：盡。窮山之高而止：到了山的最高處才停止。', '窮山之高而止');
}
