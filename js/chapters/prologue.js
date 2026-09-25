// 序章：柳宗元去了哪裏？（永州居所）
import { E, THREE, ui, audio, enter, watch } from './common.js';
import { addInteractable, removeInteractable, freeze, unfreeze, wait, lookAt, moveTo, turnTo, tween } from '../engine.js';
import { makePerson, makeWinePot, makeStrawHat, makeHouse, textCanvas, lam, makeRock, fbm, rng } from '../world.js';

function buildRoom() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#6f747a');
  scene.fog = new THREE.Fog('#6f747a', 12, 140);

  scene.add(new THREE.HemisphereLight('#c3cad2', '#4a3a2c', 1.25));
  const lamp = new THREE.PointLight('#ffbe7a', 7, 10, 1.3); lamp.position.set(0.8, 2.2, -0.3); scene.add(lamp);
  const winLight = new THREE.DirectionalLight('#c6ced6', 2.4); winLight.position.set(1.2, 6.5, -8); scene.add(winLight);
  // 窗外的天光透過窗櫺照進屋裏，在地上投下格子影
  winLight.userData.follow = true;
  // 從窗口斜斜射入的一道光柱
  {
    const dir = new THREE.Vector3(-1.2, -6.5, 8).normalize(), len = 3.4;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.3, len), new THREE.MeshBasicMaterial({ color: '#dfe6ee', transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending }));
    const start = new THREE.Vector3(0, 1.7, -3.55);
    beam.position.copy(start).addScaledVector(dir, len / 2);
    beam.lookAt(start.clone().addScaledVector(dir, len));
    scene.add(beam);
  }

  const W = 4, D = 3.6, H = 3.2;
  const wood = '#6d5039', wall = '#d8cdb6', beam = '#4a3325';
  // 地板
  for (let i = -4; i < 4; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, D * 2), lam(new THREE.Color(wood).offsetHSL(0, 0, (i % 3) * 0.02)));
    plank.position.set(i + 0.5, -0.05, 0); scene.add(plank);
  }
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.1, D * 2), lam('#3f2d21')); ceil.position.y = H; scene.add(ceil);
  const wm = lam(wall);
  // 牆（北牆開窗）
  const addBox = (w, h, d, x, y, z, m = wm) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); scene.add(b); return b; };
  addBox(W * 2, H, 0.2, 0, H / 2, D);             // 南
  addBox(0.2, H, D * 2, -W, H / 2, 0);            // 西
  // 東牆（留門洞）
  addBox(0.2, H, D - 0.6, W, H / 2, -(D + 0.6) / 2);
  addBox(0.2, H, D - 0.6, W, H / 2, (D + 0.6) / 2);
  addBox(0.2, H - 2.3, 1.2, W, 2.3 + (H - 2.3) / 2, 0);
  // 北牆（窗洞 x:-1.3..1.3, y:1.0..2.4）
  addBox(W - 1.3, H, 0.2, -(W + 1.3) / 2, H / 2, -D);
  addBox(W - 1.3, H, 0.2, (W + 1.3) / 2, H / 2, -D);
  addBox(2.6, 1.0, 0.2, 0, 0.5, -D);
  addBox(2.6, H - 2.4, 0.2, 0, 2.4 + (H - 2.4) / 2, -D);
  // 樑柱
  for (const x of [-W + 0.15, W - 0.15]) for (const z of [-D + 0.15, D - 0.15]) addBox(0.25, H, 0.25, x, H / 2, z, lam(beam));
  addBox(W * 2, 0.22, 0.25, 0, H - 0.2, -D + 0.2, lam(beam));

  // 窗櫺
  const win = new THREE.Group(); win.position.set(0, 1.7, -D);
  const frameM = lam('#3d2a1d');
  for (let i = 0; i <= 6; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.4, 0.06), frameM); v.position.x = -1.3 + i * (2.6 / 6); win.add(v); }
  for (let j = 0; j <= 4; j++) { const h = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 0.06), frameM); h.position.y = -0.7 + j * 0.35; win.add(h); }
  const winHit = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), new THREE.MeshBasicMaterial({ visible: false }));
  win.add(winHit);
  scene.add(win);

  // 門
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.25, 1.15), lam('#5a3c28'));
  door.position.set(W - 0.02, 1.125, 0); scene.add(door);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 5, 12), lam('#b08d4a')); ring.position.set(W - 0.08, 1.1, 0.3); ring.rotation.y = Math.PI / 2; scene.add(ring);

  // 書案
  const tableM = lam('#5b3a25');
  const table = new THREE.Group(); table.position.set(0.3, 0, -0.9);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.95), tableM); top.position.y = 0.78; table.add(top);
  for (const x of [-0.85, 0.85]) for (const z of [-0.4, 0.4]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, 0.07), tableM); l.position.set(x, 0.39, z); table.add(l); }
  scene.add(table);
  const onTable = (obj, x, z, ry = 0) => { obj.position.set(0.3 + x, 0.82, -0.9 + z); obj.rotation.y = ry; scene.add(obj); return obj; };

  const pot = onTable(makeWinePot('#7d8b75'), -0.7, 0.15);
  pot.scale.setScalar(1.3);
  const hat = onTable(makeStrawHat(), 0.65, -0.18, 0.4);
  const mapTex = textCanvas([], { w: 512, h: 384, bg: '#e9dcbc', draw: (g, w, h) => {
    g.strokeStyle = '#6a5438'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(200, 0); g.bezierCurveTo(230, 120, 170, 220, 220, 384); g.strokeStyle = '#7fa3b5'; g.lineWidth = 14; g.stroke();
    g.strokeStyle = '#5a4a36'; g.lineWidth = 3;
    const r = rng(4);
    for (let i = 0; i < 14; i++) { const x = 260 + r() * 230, y = 30 + r() * 320; g.beginPath(); g.moveTo(x - 20, y + 12); g.lineTo(x, y - 14); g.lineTo(x + 20, y + 12); g.stroke(); }
    g.strokeStyle = '#b3372b'; g.lineWidth = 2.5;
    for (let i = 0; i < 12; i++) { const x = 260 + r() * 230, y = 30 + r() * 320; g.beginPath(); g.arc(x, y, 12 + r() * 10, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#5a4a36'; g.font = '26px "LXGW WenKai TC", serif'; g.fillText('永州', 420, 330);
  } });
  const map = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.42), new THREE.MeshLambertMaterial({ map: mapTex }));
  map.rotation.x = -Math.PI / 2; onTable(map, 0.1, 0.12, 0); map.rotation.set(-Math.PI / 2, 0, 0.15); map.position.y = 0.825;
  const letterTex = textCanvas(['今日天色甚佳，', '我出去走走……'], { w: 256, h: 512, vertical: true, size: 34, bg: '#f1e8d2', color: '#1d1712' });
  const letter = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5), new THREE.MeshLambertMaterial({ map: letterTex }));
  letter.rotation.set(-Math.PI / 2, 0, -0.1); letter.position.set(0.3 - 0.25, 0.826, -0.9 - 0.12); scene.add(letter);
  // 筆、硯
  const ink = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.12), lam('#1f1f22')); onTable(ink, -0.3, -0.28); ink.position.y = 0.835;
  const brush = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), lam('#8a6b3a')); brush.rotation.z = Math.PI / 2; onTable(brush, -0.05, -0.3); brush.position.y = 0.845;

  // 官服架與文書
  const rack = new THREE.Group(); rack.position.set(-W + 0.45, 0, 0.9); rack.rotation.y = Math.PI / 2;
  const pole = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.05), lam(beam)); pole.position.y = 1.9; rack.add(pole);
  for (const x of [-0.65, 0.65]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.06), lam(beam)); p.position.set(x, 0.95, 0); rack.add(p); }
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, 1.35, 8, 1, true), new THREE.MeshLambertMaterial({ color: '#2f5a4a', side: THREE.DoubleSide, flatShading: true }));
  robe.scale.z = 0.35; robe.position.y = 1.2; rack.add(robe);
  const sleeves = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.2, 0.12), lam('#2f5a4a')); sleeves.position.y = 1.8; rack.add(sleeves);
  scene.add(rack);
  const shelf = new THREE.Group(); shelf.position.set(-W + 0.45, 0, -1.6);
  const sb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.9), lam('#5b3a25')); sb.position.y = 0.45; shelf.add(sb);
  for (let i = 0; i < 5; i++) { const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), lam(i % 2 ? '#e8dcc0' : '#d9c89f')); sc.rotation.x = Math.PI / 2; sc.position.set(-0.1 + (i % 3) * 0.1, 0.95 + Math.floor(i / 3) * 0.1, 0); shelf.add(sc); }
  scene.add(shelf);

  // 僕人（老僕）
  const servant = makePerson({ preset: 'oldServant', name: '老僕' });
  servant.position.set(2.6, 0, 1.9); servant.rotation.y = -2.4;
  scene.add(servant);
  E.persons.add(servant);

  // 窗外：陰暗的永州城
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), lam('#565a52')); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -1.5, -150); scene.add(ground);
  const r = rng(12);
  for (let i = 0; i < 38; i++) {
    const h = makeHouse({ w: 4 + r() * 3, d: 3 + r() * 2, h: 2.2 + r() * 1.2, wall: new THREE.Color('#9d978b').offsetHSL(0, 0, (r() - .5) * 0.08), roof: '#2e3033' });
    h.position.set((r() - .5) * 90, -1.5, -14 - r() * 70);
    h.rotation.y = (r() - .5) * 0.3;
    scene.add(h);
  }
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(30 + r() * 30, 25 + r() * 25, 7), lam('#4c5550'));
    m.position.set((r() - .5) * 300, -1.5, -110 - r() * 60); scene.add(m);
  }
  // 陰雲
  const cloudM = new THREE.MeshLambertMaterial({ color: '#5e636a', transparent: true, opacity: 0.8 });
  for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(new THREE.IcosahedronGeometry(10 + r() * 8, 0), cloudM); c.scale.y = 0.35; c.position.set((r() - .5) * 200, 35 + r() * 15, -60 - r() * 60); scene.add(c); }

  const world = {
    scene,
    heightAt: () => 0,
    clamp: v => { v.x = Math.max(-W + 0.45, Math.min(W - 0.45, v.x)); v.z = Math.max(-D + 0.45, Math.min(D - 0.45, v.z)); },
    blockers: [
      { type: 'box', minX: -0.7, maxX: 1.3, minZ: -1.4, maxZ: -0.4, r: 0.35 },
      { type: 'box', minX: -W, maxX: -W + 0.8, minZ: -2.1, maxZ: 1.7, r: 0.3 },
      { x: servant.position.x, z: servant.position.z, r: 0.35 },
    ],
    walkables: [],
    refs: { pot, hat, map, letter, rack, shelf, win: winHit, door, servant },
  };
  // 地板可點擊行走
  const floorHit = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), new THREE.MeshBasicMaterial({ visible: false }));
  floorHit.rotation.x = -Math.PI / 2; floorHit.position.y = 0.01; scene.add(floorHit);
  world.walkables.push(floorHit);
  return world;
}

export async function prologue() {
  audio.ambience({ wind: 0.25, water: 0, birds: 0.15, crickets: 0 });
  audio.music('yongzhou');
  const world = await enter(buildRoom, { x: 1.8, z: 2.4, yaw: 0.55, pitch: -0.12 });
  const R = world.refs;
  ui.showHUD(true);
  ui.showDpad(true);
  await ui.chapterCard('序章', '柳宗元去了哪裏？', '永州・柳宅');

  await ui.say('', '房間裏沒有人。');
  await ui.say('', '書案上留下了幾件東西：一個酒壺、一頂斗笠、一張簡略的地圖，還有一封沒有寫完的信。');
  ui.hideDialog();
  ui.objective('搜查柳宗元的房間，找出他去向的線索', '點擊發光的標記查看物件。書案上的信、窗戶、官服都值得細看。');
  unfreeze();

  const seen = new Set();
  let servantIt, doorIt;
  const need = ['letter', 'window', 'robe'];
  const done = () => need.every(k => seen.has(k));

  const onSeen = (k) => {
    seen.add(k);
    if (done() && servantIt) { servantIt.hint = true; ui.objective('問問家中的老僕', '點擊站在門邊的老僕。'); }
  };

  const item = (obj, label, key, fn, opts = {}) => {
    const it = addInteractable(Object.assign({
      object: obj, label, range: 2.4,
      onClick: async () => {
        freeze();
        await fn();
        ui.hideDialog();
        if (!opts.repeat) removeInteractable(it);
        onSeen(key);
        unfreeze();
      },
    }, opts));
    return it;
  };

  item(R.letter, '未寫完的信', 'letter', async () => {
    await lookAt(new THREE.Vector3(R.letter.position.x, 0.8, R.letter.position.z), 0.8);
    await ui.say('', '信上只有一句：');
    ui.hideDialog();
    await ui.caption('今日天色甚佳，我出去走走……', { hold: 3.6 });
    await ui.say('你', '沒有寫完……「出去走走」——他去了哪裏？');
    ui.journalAdd('遊蹤', '柳宅：柳宗元留下未寫完的信——「今日天色甚佳，我出去走走……」');
  });
  item(R.pot, '酒壺', 'pot', async () => {
    await ui.say('', '酒壺是空的。旁邊的木架上留着一圈酒漬——本來應該還有另一個酒壺。');
    await ui.say('你', '看來他帶着酒出門了。');
  });
  item(R.hat, '斗笠', 'hat', async () => {
    await ui.say('', '他的斗笠還在。');
    await ui.say('你', '天氣好，他大概以為很快便會回來，所以連斗笠也沒有帶。');
  });
  item(R.map, '簡略地圖', 'map', async () => {
    await ui.say('', '一張柳宗元親手畫的永州簡圖。城外的山林、溪谷上畫滿了紅圈——密密麻麻，像是去過的地方都圈了起來。');
    await ui.say('', '奇怪的是，大江西邊的一大片地方，一個圈也沒有。');
    ui.unlockButton('btnMap');
    ui.toast('獲得：永州簡圖（右上角「地圖」）');
  });
  item(R.rack, '官服與文書', 'robe', async () => {
    await ui.say('', '架上掛着一件深綠色的官服，旁邊堆着文書。');
    await ui.modal(`<h2><span class="seal">背景</span>「僇人」柳宗元</h2>
      <p class="lead">柳宗元（773–819），字子厚。年輕時已是朝中才俊，參與了唐順宗時的政治改革（史稱「永貞革新」）。</p>
      <p class="lead">改革很快失敗。805 年，柳宗元被貶到偏遠的永州，當一個有名無實的「司馬」。官服還在，權力卻沒有了。</p>
      <p class="lead">他形容自己是<b style="color:#b3372b">「僇人」</b>——受過刑辱、獲罪的人。</p>
      <button class="primary" data-close>繼續</button>`);
    ui.journalAdd('字詞', '僇人：受過刑辱、獲罪之人。柳宗元以此自稱，說明被貶的處境。', '自余為僇人');
  });
  item(R.win, '窗戶', 'window', async () => {
    await moveTo(0, -2.4, 1.4);
    await turnTo(0, -0.02, 1);
    await ui.say('', '窗外是陰沉沉的永州城。低矮的屋頂，灰色的天，遠山像壓在城上。');
    ui.hideDialog();
    audio.heartbeat();
    await ui.caption('自余為僇人，居是州，恆惴慄。', { gloss: '自從我成了獲罪之人，住在這個州裏，便常常憂懼不安。', hold: 6.5 });
    ui.setMood('tremble', { silent: true });
    document.getElementById('mood').classList.remove('hidden');
    await ui.say('', '（左上角出現了一顆「心」。它代表柳宗元的心境——此刻，它被繩子緊緊綁住，微微顫抖。）');
    await ui.say('', '（這顆心會隨着旅程改變。留意它。）');
    ui.journalAdd('心境', '被貶永州，身為罪人，常常憂懼不安。', '恆惴慄');
  });

  servantIt = addInteractable({
    object: R.servant, label: '老僕', range: 2.8,
    onClick: async () => {
      freeze();
      watch(R.servant, true);
      await lookAt(new THREE.Vector3(R.servant.position.x, 1.65, R.servant.position.z), 0.8);
      if (!done()) {
        await ui.say('老僕', '你先看看先生的房間吧。書案上的信、窗外、先生的官服……也許能看出些端倪。');
        ui.hideDialog();
        unfreeze();
        return;
      }
      removeInteractable(servantIt);
      await ui.say('老僕', '你看出甚麼來了嗎？');
      await ui.say('老僕', '柳先生近日經常外出遊山，但今日已經出去很久。');
      await ui.say('老僕', '以往先生出門，總說「只是隨便走走」。喝點酒，睡一覺，天黑前便回來了。');
      await ui.say('老僕', '可是今天……到了這個時辰，還未見人影。');
      const q = await ui.choose([{ label: '他平日都去哪裏遊玩？', value: 1 }, { label: '他出門時說了甚麼？', value: 2 }], { name: '你' });
      if (q === 1) {
        await ui.say('老僕', '哪裏都去。高山、深林、溪谷……城外的山，差不多都讓先生走遍了。');
      } else {
        await ui.say('老僕', '甚麼也沒說，信也沒寫完便出去了。先生走路總是慢慢的，走到哪裏算哪裏。');
      }
      await ui.say('老僕', '你到城外山林找找吧。先生走過的地方，總會留下些痕跡。');
      await ui.choose([{ label: '好，我去找他。' }], { name: '你' });
      ui.hideDialog();
      audio.chime();
      ui.objective('尋找柳宗元：循着他留下的痕跡，找出他的去向', '從東邊的門離開柳宅。');
      ui.toast('新任務：尋找柳宗元');
      doorIt.enabled = true; doorIt.hint = true;
      watch(R.servant, false);
      R.servant.userData.lookTarget = null;
      unfreeze();
    },
  });

  let resolveDoor;
  const doorDone = new Promise(r => resolveDoor = r);
  doorIt = addInteractable({
    object: R.door, label: '出門', range: 2.6, enabled: false,
    onClick: () => { freeze(); resolveDoor(); },
  });
  await doorDone;
  ui.objective('');
}
