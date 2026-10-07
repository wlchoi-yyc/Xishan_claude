// 自建骨架的 Tripo 人物（tools/servant-model）。動作已烘焙在 GLB 內，說話時以形變目標 MouthOpen 張合口部。
//   老僕（序章）：old-servant.glb，Idle Talk Bow；雙手垂在身旁，所有動作都不移動手臂。
//   年輕僕人（第三關，法華寺外）：young-servant.glb，坐在草地上；Idle 輕揉腳踝，Talk 停手、輕輕點頭。
//   船家（第四關，湘江渡口）：boatman.glb，戴斗笠、披蓑衣；Idle／Talk 左手握着插在水中的竹篙，
//     Row 面向船外雙手撐篙，PoleRest 撐船後雙手握篙站着。竹篙由 makeBoatman() 按手的位置每格擺放。
import { THREE, E } from './engine.js';
import { GLTFLoader } from '../lib/addons/loaders/GLTFLoader.js';
import { clone } from '../lib/addons/utils/SkeletonUtils.js';
import { makePerson } from './people.js';

const MODELS = {
  // 模型原高 0.98，放大到約 1.69 米（老人微駝，比柳宗元略矮）。
  old: { url: 'assets/characters/old-servant.glb', scale: 1.73, fallback: 'oldServant', label: '老僕', hitH: 1.7 },
  // 年輕僕人約 1.62 米；坐在地上，身體不轉向玩家，只轉頭。
  young: { url: 'assets/characters/young-servant.glb', scale: 1.65, fallback: 'servant', label: '年輕僕人', hitH: 1.0, seated: true },
  // 模型原高 0.98（連斗笠），放大到約 1.74 米（身高約 1.62 米）。遠在碼頭另一端也看得見，貼圖保留 mipmap，免得草衣閃爍。
  // 點擊範圍用較粗的圓柱（不按外框計算：外框連竹篙長達三米多）。
  boatman: { url: 'assets/characters/boatman.glb', scale: 1.78, fallback: 'boatman', label: '船家', hitH: 1.75, hitR: 0.5, ownHit: true, mipmaps: true },
};
const loading = {};
function load(kind) {
  const M = MODELS[kind];
  if (!loading[kind]) loading[kind] = fetch(M.url)
    .then(r => { if (!r.ok) throw new Error(`${M.url}: ${r.status}`); return r.arrayBuffer(); })
    .then(buf => new GLTFLoader().parseAsync(buf, 'assets/characters/'))
    .catch(error => { console.warn(`${M.label}模型未能載入，使用備用人物。`, error); return null; });
  return loading[kind];
}
export const loadServantCharacter = () => load('old');
export const loadYoungServant = () => load('young');
export const loadBoatman = () => load('boatman');
export const makeServantCharacter = (opts = {}, waitMs = 8000) => makeCharacter('old', opts, waitMs);
export const makeYoungServant = (opts = {}, waitMs = 8000) => makeCharacter('young', opts, waitMs);

async function makeCharacter(kind, opts, waitMs) {
  const M = MODELS[kind];
  let timeout;
  const gltf = await Promise.race([load(kind), new Promise(r => { timeout = setTimeout(r, waitMs, null); })]);
  clearTimeout(timeout);
  if (!gltf) { const p = makePerson({ preset: M.fallback, ...opts }); if (M.seated) p.userData.setPose('sit'); return p; }

  const root = new THREE.Group(), actor = clone(gltf.scene);
  let ud_hit = null;
  actor.scale.setScalar(M.scale);
  root.add(actor);
  let mouthMesh = null, mouthIdx = -1, mouth = 0;
  actor.traverse(o => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.frustumCulled = false;
    o.castShadow = false;
    // 室內不需要人物接收陰影，省下運算
    o.receiveShadow = false;
    // 點擊判定交給下面的簡單碰撞體，不必逐個三角形做蒙皮運算
    o.raycast = () => {};
    // 模型的貼圖分塊很碎，皮膚旁邊就是深色衣料：遠看時縮小貼圖（mipmap）會把深色混進臉上，成為黑色條紋。
    // 兩位僕人都只在近距離出現，直接取樣原圖即可。
    if (!M.mipmaps) for (const k of ['map', 'normalMap']) {
      const t = o.material[k];
      if (t && t.generateMipmaps) { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    }
    if (o.morphTargetDictionary && 'MouthOpen' in o.morphTargetDictionary) { mouthMesh = o; mouthIdx = o.morphTargetDictionary.MouthOpen; }
  });
  const hr = M.hitR ?? (M.seated ? 0.45 : 0.28);
  const hit = ud_hit = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, M.hitH, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = M.hitH / 2;
  root.add(hit);

  const bone = name => actor.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('mixamorig:' + name));
  const head = bone('Head'), neck = bone('Neck'), spine = bone('Spine'), chest = bone('Spine2');
  const mixer = new THREE.AnimationMixer(actor);
  const actions = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));

  let current = null, gesture = null, elapsed = 0, gazeYaw = 0, gazePitch = 0;
  const ud = root.userData;
  Object.assign(ud, { name: opts.name || '', pose: M.seated ? 'sit' : 'stand', walking: false, head, upper: new THREE.Group(),
    armL: new THREE.Group(), armR: new THREE.Group(), body: actor, mixer, actions });

  function play(name, { once = false, fade = .4 } = {}) {
    const next = actions[name];
    if (!next || (current === next && !once)) return;
    const previous = current;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (previous && previous !== next) { if (fade > 0) next.crossFadeFrom(previous, fade, false); else previous.stop(); }
    current = next;
  }
  let idleClip = 'Idle', talkClip = 'Talk';
  const idleName = () => (ud.name && E.speaker === ud.name ? talkClip : idleClip);
  mixer.addEventListener('finished', e => {
    if (gesture && e.action === actions[gesture.name]) { const g = gesture; gesture = null; play(idleName(), { fade: .6 }); g.done(); }
  });

  ud.setPose = () => {};               // 姿勢固定（老僕站着、年輕僕人坐在地上）
  // 指定待機動作（船家：Idle、Row、PoleRest）；說話時用 talk（預設 Idle → Talk，其餘不變）。instant：立即轉換，不淡入。
  ud.setIdle = (name, { talk, instant = false } = {}) => {
    if (!actions[name]) return;
    idleClip = name; talkClip = actions[talk ?? (name === 'Idle' ? 'Talk' : name)] ? (talk ?? (name === 'Idle' ? 'Talk' : name)) : name;
    if (!gesture) play(idleName(), { fade: instant ? 0 : .5 });
  };
  ud.idleClip = () => idleClip;
  ud.busy = () => !!gesture;
  // 一次性動作：Bow（雙手不動，只彎上背、低頭）
  ud.gesture = name => new Promise(done => {
    if (!actions[name]) { done(); return; }
    gesture?.done();
    gesture = { name, done };
    play(name, { once: true, fade: .5 });
  });

  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), axis = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  function rotateChar(b, ax, angle) {
    if (!angle) return;
    b.getWorldQuaternion(qa); actor.getWorldQuaternion(qb);
    qa.premultiply(qb.invert()).invert();
    b.rotateOnAxis(axis.copy(ax).applyQuaternion(qa).normalize(), angle);
    b.updateMatrixWorld(true);
  }
  // 疊加轉頭之前先還原上一幀的動畫結果，防止扭曲累積（與柳宗元相同）。
  const overlay = [spine, chest, neck, head], base = overlay.map(b => b.quaternion.clone());
  function evaluate(dt) {
    overlay.forEach((b, i) => b.quaternion.copy(base[i]));
    mixer.update(dt);
    overlay.forEach((b, i) => base[i].copy(b.quaternion));
    actor.updateMatrixWorld(true);
  }

  ud.update = dt => {
    elapsed += dt;
    if (!gesture) play(idleName());
    evaluate(dt);
    if (mouthMesh) {
      const talking = ud.name && E.speaker === ud.name;
      const syl = Math.max(0, Math.sin(elapsed * 10.5) * 0.65 + Math.sin(elapsed * 16.1 + 1) * 0.35);
      const want = talking ? 0.25 + 0.75 * syl : 0;
      mouth += (want - mouth) * Math.min(1, dt * 18);
      mouthMesh.morphTargetInfluences[mouthIdx] = mouth;
    }
  };

  const pos = new THREE.Vector3(), headPos = new THREE.Vector3(), pitchAxis = new THREE.Vector3();
  const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  ud.updateLook = (target, dt) => {
    let yaw = 0, pitch = 0;
    if (target) {
      root.getWorldPosition(pos);
      const want = Math.atan2(target.x - pos.x, target.z - pos.z) - (root.parent?.rotation.y || 0);
      const speed = ud.turnSpeed ?? 2.2;
      if (!gesture && !M.seated) root.rotation.y += angleDiff(root.rotation.y, want) * Math.min(1, dt * speed);
      yaw = THREE.MathUtils.clamp(angleDiff(root.rotation.y, want), -1.0, 1.0);
      head.getWorldPosition(headPos);
      pitch = THREE.MathUtils.clamp(-Math.atan2(target.y - headPos.y, Math.hypot(target.x - headPos.x, target.z - headPos.z)), -.5, .4);
      if (gesture) { yaw *= .3; pitch *= .3; }
    }
    const blend = Math.min(1, dt * (ud.turnSpeed ?? 2.2) * 1.6);
    gazeYaw += (yaw - gazeYaw) * blend; gazePitch += (pitch - gazePitch) * blend;
    rotateChar(neck, Y, gazeYaw * .4); rotateChar(head, Y, gazeYaw * .6);
    rotateChar(neck, pitchAxis.copy(X).applyAxisAngle(Y, gazeYaw * .4), gazePitch * .4);
    rotateChar(head, pitchAxis.copy(X).applyAxisAngle(Y, gazeYaw), gazePitch * .6);
  };

  // 船家的點擊範圍就是上面的圓柱（common.js 的 addHitProxy 不必再按外框另加一個）
  if (M.ownHit) ud.hitProxy = ud_hit;
  ud.gltf = gltf;
  play('Idle', { fade: 0 }); evaluate(0);
  return root;
}

// ---------------- 船家與竹篙 ----------------
// 竹篙不烘焙在模型內：每格按手骨的位置擺放，所以無論動作怎樣轉換，竹篙都一定握在手中。
// 握篙點與篙軸以手骨的本地座標記錄在 GLB 的 asset.extras（tools/servant-model/build_boatman.py）。
//   Idle／Talk：左手單手握篙，篙沿左手的篙軸方向；Row／PoleRest：雙手握篙，篙穿過兩手的握篙點。
export async function makeBoatman(opts = {}, waitMs = 8000) {
  const root = await makeCharacter('boatman', opts, waitMs);
  const ud = root.userData;
  if (!ud.actions) return root;                   // 載不到模型：程式人物（由 river.js 自行加上竹篙）
  const ex = ud.gltf.asset?.extras || {};
  const bone = name => ud.body.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('mixamorig:' + name));
  const hands = { Left: bone('LeftHand'), Right: bone('RightHand') };
  const grip = { Left: new THREE.Vector3(...(ex.grip?.Left || [0.02, -0.05, 0])), Right: new THREE.Vector3(...(ex.grip?.Right || [-0.02, -0.05, 0])) };
  const axisL = new THREE.Vector3(...(ex.poleAxis?.Left || [0, 0, 1]));
  const rowPeriod = ex.rowPeriod || 2 * Math.PI / 1.6;

  // 竹篙：與舊版相同的竹節外觀，長約 3.6 米
  const pole = new THREE.Group();
  const lam = c => new THREE.MeshLambertMaterial({ color: c });
  pole.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 1, 7), lam('#9c8a55')));
  for (let i = 1; i < 9; i++) { const n = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.018, 7), lam('#7a6a3c')); n.position.y = -0.5 + i / 9; pole.add(n); }
  pole.traverse(o => { o.raycast = () => {}; });
  root.add(pole);

  const pL = new THREE.Vector3(), pR = new THREE.Vector3(), dir = new THREE.Vector3(), top = new THREE.Vector3(), bot = new THREE.Vector3();
  const q = new THREE.Quaternion(), qRoot = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  function placePole() {
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(qRoot).invert();
    root.worldToLocal(hands.Left.localToWorld(pL.copy(grip.Left)));
    const two = ud.idleClip() === 'Row' || ud.idleClip() === 'PoleRest';
    if (two) {
      root.worldToLocal(hands.Right.localToWorld(pR.copy(grip.Right)));
      dir.subVectors(pL, pR);
      const gap = dir.length(); dir.divideScalar(gap || 1);
      bot.copy(pR).addScaledVector(dir, -2.2); top.copy(pL).addScaledVector(dir, 1.2);
    } else {
      hands.Left.getWorldQuaternion(q);
      dir.copy(axisL).applyQuaternion(q).applyQuaternion(qRoot).normalize();
      bot.copy(pL).addScaledVector(dir, -2.1); top.copy(pL).addScaledVector(dir, 1.5);
    }
    const len = top.distanceTo(bot);
    pole.position.addVectors(top, bot).multiplyScalar(0.5);
    pole.quaternion.setFromUnitVectors(Y, dir);
    pole.scale.set(1, len, 1);
    pole.children.forEach((c, i) => { if (i) c.scale.set(1, 1 / len, 1); });
  }
  const look = ud.updateLook;
  ud.updateLook = (target, dt) => { look(target, dt); placePole(); };
  // 撐船節奏：0 = 下篙入水（雙手較高、篙較直），約 0.58 推到盡頭
  ud.rowPhase = () => ((ud.actions.Row?.time || 0) / rowPeriod) % 1;
  ud.pole = pole;
  placePole();
  return root;
}
