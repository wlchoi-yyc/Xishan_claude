// 柳宗元（Tripo 立體模型 + Mixamo 骨架）：共用模型資源，每位人物有獨立骨架、材質與動畫狀態。
// 劇情動作已烘焙在 GLB 內（見 assets/characters/README.md）：
//   Idle Walk Talk SitDown StandUp SeatedIdle SeatedTalk Drink LieDown LyingIdle
//   Invite PointFar DrunkSway Bow GazeIdle
import { THREE, E } from './engine.js';
import { GLTFLoader } from '../lib/addons/loaders/GLTFLoader.js';
import { clone } from '../lib/addons/utils/SkeletonUtils.js';
import { makePerson } from './people.js';
import { makeRock } from './world.js';

const MODEL_URL = 'assets/characters/liu-zongyuan.glb';
// 模型原高 0.98，放大到約 1.81 米，與遊戲其他人物一致。
const SCALE = 1.85;

let loading;
export function loadLiuCharacter() {
  if (!loading) loading = fetch(MODEL_URL)
    .then(r => { if (!r.ok) throw new Error(`${MODEL_URL}: ${r.status}`); return r.arrayBuffer(); })
    .then(buf => new GLTFLoader().parseAsync(buf, 'assets/characters/'))
    .catch(error => { console.warn('柳宗元模型未能載入，使用備用人物。', error); return null; });
  return loading;
}

export async function makeLiuCharacter(opts = {}) {
  let timeout;
  const gltf = await Promise.race([loadLiuCharacter(), new Promise(r => { timeout = setTimeout(r, 8000, null); })]);
  clearTimeout(timeout);
  if (!gltf) return makePerson({ preset: 'liu', ...opts });

  const root = new THREE.Group(), actor = clone(gltf.scene);
  actor.scale.setScalar(SCALE);
  root.add(actor);
  actor.traverse(o => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    // 動態骨架的包圍盒不能只沿用站姿；單一主角不必每幀重算頂點。
    o.frustumCulled = false;
    o.castShadow = false;
    o.receiveShadow = true;
  });
  // 口部張合：模型內的形變目標 MouthOpen（說話時張合，其餘時間閉口）
  let mouthMesh = null, mouthIdx = -1, mouth = 0;
  actor.traverse(o => { if (o.morphTargetDictionary && 'MouthOpen' in o.morphTargetDictionary) { mouthMesh = o; mouthIdx = o.morphTargetDictionary.MouthOpen; } });
  const bone = name => actor.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('mixamorig:' + name));
  const head = bone('Head'), neck = bone('Neck'), spine = bone('Spine'), chest = bone('Spine2');
  const hand = bone('RightHand'), middle = bone('RightHandMiddle1'), thumb = bone('RightHandThumb1');

  // 坐着時臀下的一塊扁石（坐姿是小腿垂直放下，需要有座位）。座面高約 0.43 米，與 tools/liu-model 的坐姿一致。
  const seat = makeRock(0.32, '#8b877b', 77);
  seat.scale.set(1.15, 0.8, 1.0); seat.position.set(0, 0.15, -0.07);
  seat.castShadow = false; seat.receiveShadow = true; seat.visible = false;
  root.add(seat);
  const mixer = new THREE.AnimationMixer(actor);
  const actions = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
  const ONCE = new Set(['SitDown', 'StandUp', 'LieDown', 'Invite', 'PointFar', 'Bow', 'Drink']);

  let current = null, queue = [], held = null, heldLift = 0, drinking = false, gesture = null, elapsed = 0;
  let gazeYaw = 0, gazePitch = 0, twist = 0;
  // 舊介面相容：upper.rotation.z 讓上身左右搖晃；armL 只供備用人物使用。
  const upper = new THREE.Group(), armL = new THREE.Group();
  const ud = root.userData;
  Object.assign(ud, { name: opts.name || '', pose: 'stand', walking: false, walkRate: 1,
    head, upper, armL, armR: new THREE.Group(), body: actor, isBlenderLiu: true, mixer, actions, idle: null });

  function play(name, { loop = !ONCE.has(name), reverse = false, fade = .3, rate = 1 } = {}) {
    const next = actions[name];
    if (!next) return;
    if (current === next && loop && !next.paused) { next.setEffectiveTimeScale(rate); return; }
    const previous = current;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(reverse ? -rate : rate);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    if (reverse) next.time = next.getClip().duration;
    next.play();
    if (previous && previous !== next) next.crossFadeFrom(previous, fade, false);
    current = next;
  }
  const idleName = () => {
    if (ud.pose === 'lie') return 'LyingIdle';
    const talking = ud.name && E.speaker === ud.name;
    if (ud.pose === 'sit') return ud.idle === 'DrunkSway' ? 'DrunkSway' : talking ? 'SeatedTalk' : 'SeatedIdle';
    if (ud.walking) return 'Walk';
    if (ud.idle === 'GazeIdle') return 'GazeIdle';
    return talking ? 'Talk' : 'Idle';
  };
  function advance() { if (queue.length) { const [n, o] = queue.shift(); play(n, o); } }
  mixer.addEventListener('finished', e => {
    if (e.action !== current) return;
    if (gesture && e.action === actions[gesture.name]) { const g = gesture; gesture = null; g.done(); }
    advance();
  });

  ud.setPose = (pose, { instant = false } = {}) => {
    const previous = ud.pose;
    ud.pose = pose; seat.visible = pose === 'sit'; queue = []; drinking = false; gesture?.done(); gesture = null;
    if (pose !== 'sit') ud.idle = ud.idle === 'DrunkSway' ? null : ud.idle;
    // 首次放進場景前、或劇情要求（instant）時直接就位，不播放坐下／站起等過渡動作。
    if (instant || !root.parent || previous === pose) { play(idleName(), { fade: 0 }); evaluate(0); return; }
    if (previous === 'lie') queue.push(['LieDown', { reverse: true }]);
    if (pose === 'stand') queue.push(['StandUp', {}]);
    else if (previous === 'stand') queue.push(['SitDown', {}]);
    if (pose === 'lie') queue.push(['LieDown', {}]);
    advance();
  };
  // 一次性劇情手勢：Invite（邀坐）、PointFar（指點遠山）、Bow（作揖）。動作完成後自動回到待機。
  ud.gesture = name => new Promise(done => {
    gesture?.done(); queue = [];
    gesture = { name, done };
    play(name, { fade: .35 });
  });
  // 指定待機：'GazeIdle'（負手遠眺）、'DrunkSway'（頹然就醉）或 null。
  ud.setIdle = name => {
    const wasDrunk = ud.idle === 'DrunkSway';
    ud.idle = name;
    // 由低頭醉態回復時慢慢抬頭，不要一下子彈回
    if (wasDrunk && name !== 'DrunkSway' && !drinking && !gesture && !queue.length) play(idleName(), { fade: 1.6 });
  };
  // 姿勢轉換是否仍在播放（坐下、站起、躺下）。
  ud.busy = () => queue.length > 0 || (current && current.loop === THREE.LoopOnce && !current.paused && !drinking);

  ud.holdCup = (obj, { lift = 0 } = {}) => {
    if (held) root.remove(held);
    held = obj; heldLift = lift; root.add(obj); obj.rotation.set(0, 0, 0);
    ud.customArms = true;
  };
  ud.drinkPose = k => {
    queue = []; drinking = true; gesture = null;
    ud.drinkK = THREE.MathUtils.clamp(k, 0, 2);
    if (current !== actions.Drink) play('Drink', { fade: .25 });
    current.paused = true;
    // 片段長 2.5 秒：0 手在膝上 → 1.25 杯到唇邊 → 2.5 仰頭飲盡。
    current.time = ud.drinkK / 2 * actions.Drink.getClip().duration;
  };
  ud.releaseCup = () => {
    if (held) root.remove(held);
    held = null; drinking = false; ud.drinkK = 0; ud.customArms = false;
    if (current) current.paused = false;
    play(idleName(), { fade: .5 });
  };

  // 以角色座標的軸轉動骨骼（Mixamo 骨骼的本地軸與角色方向不一致）。
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), axis = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  function rotateChar(b, ax, angle) {
    if (!angle) return;
    b.getWorldQuaternion(qa); actor.getWorldQuaternion(qb);
    qa.premultiply(qb.invert()).invert();
    b.rotateOnAxis(axis.copy(ax).applyQuaternion(qa).normalize(), angle);
    b.updateMatrixWorld(true);
  }
  // 恆定的動畫軌不會每幀寫回骨骼：疊加轉頭／搖晃之前先還原上一幀的動畫結果，防止扭曲累積。
  const overlay = [spine, chest, neck, head], base = overlay.map(b => b.quaternion.clone());
  function evaluate(dt) {
    overlay.forEach((b, i) => b.quaternion.copy(base[i]));
    mixer.update(dt);
    overlay.forEach((b, i) => base[i].copy(b.quaternion));
    actor.updateMatrixWorld(true);
  }

  // 托杯：杯子放在右手掌心上，跟隨手掌方向；與 tools/liu-model/anims.py 的 CUP_N 一致。
  const pHand = new THREE.Vector3(), pMid = new THREE.Vector3(), tmp = new THREE.Vector3();
  const hq = new THREE.Quaternion(), rootQ = new THREE.Quaternion(), basis = new THREE.Matrix4();
  const fW = new THREE.Vector3(), nW = new THREE.Vector3(), uW = new THREE.Vector3();
  // 靜止姿勢下計算右手本地的手指方向、掌心朝向（朝身體中線）和拇指方向
  actor.updateMatrixWorld(true);
  const fLoc = new THREE.Vector3(), nLoc = new THREE.Vector3(), uLoc = new THREE.Vector3();
  {
    hand.getWorldPosition(pHand); middle.getWorldPosition(pMid);
    hand.getWorldQuaternion(hq); actor.getWorldQuaternion(rootQ);
    const inv = hq.clone().invert();
    fLoc.copy(pMid).sub(pHand).normalize().applyQuaternion(inv);
    nLoc.set(1, 0, 0).applyQuaternion(rootQ).applyQuaternion(inv);
    nLoc.addScaledVector(fLoc, -nLoc.dot(fLoc)).normalize();
    uLoc.crossVectors(fLoc, nLoc).normalize();
  }
  const CUP_N = 0.012 * SCALE;
  function placeHeld() {
    if (!held) return;
    hand.getWorldPosition(pHand); middle.getWorldPosition(pMid); hand.getWorldQuaternion(hq);
    fW.copy(fLoc).applyQuaternion(hq); nW.copy(nLoc).applyQuaternion(hq); uW.copy(uLoc).applyQuaternion(hq);
    tmp.copy(pHand).lerp(pMid, .55).addScaledVector(nW, CUP_N + heldLift);
    root.worldToLocal(tmp);
    held.position.copy(tmp);
    // 杯子的 Y 軸 = 掌心朝向（托杯）；X 軸 = 手指方向
    uW.crossVectors(fW, nW);
    basis.makeBasis(fW, nW, uW);
    held.quaternion.setFromRotationMatrix(basis);
    root.getWorldQuaternion(rootQ);
    held.quaternion.premultiply(rootQ.invert());
  }

  ud.update = dt => {
    elapsed += dt;
    const transitioning = current && current.loop === THREE.LoopOnce && !current.paused;
    if (!drinking && !gesture && !transitioning && !queue.length) {
      play(idleName(), { rate: ud.walking ? ud.walkRate : 1 });
    }
    evaluate(dt);
    if (mouthMesh) {
      // 像說話的節奏：兩個不同頻率疊加，偶爾停頓；文字打完便閉口
      const talking = ud.name && E.speaker === ud.name;
      const syl = Math.max(0, Math.sin(elapsed * 11) * 0.65 + Math.sin(elapsed * 17.3 + 1) * 0.35);
      const want = talking ? 0.25 + 0.75 * syl : 0;
      mouth += (want - mouth) * Math.min(1, dt * 18);
      mouthMesh.morphTargetInfluences[mouthIdx] = mouth;
    }
    if (upper.rotation.z) rotateChar(chest, Z, upper.rotation.z);
    placeHeld();
    ud.extraUpdate?.(dt);
  };

  const pos = new THREE.Vector3(), headPos = new THREE.Vector3(), pitchAxis = new THREE.Vector3();
  const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  ud.updateLook = (target, dt) => {
    let yaw = 0, pitch = 0, wantTwist = 0;
    if (target && ud.pose !== 'lie') {
      root.getWorldPosition(pos);
      const want = Math.atan2(target.x - pos.x, target.z - pos.z) - (root.parent?.rotation.y || 0);
      const speed = ud.turnSpeed ?? 2.2;
      if (ud.bodyFollow !== false && ud.pose === 'stand' && !gesture) root.rotation.y += angleDiff(root.rotation.y, want) * Math.min(1, dt * speed);
      yaw = angleDiff(root.rotation.y, want);
      if (ud.pose === 'sit') wantTwist = THREE.MathUtils.clamp(yaw * .45, -.65, .65);
      yaw = THREE.MathUtils.clamp(yaw - wantTwist, -1.0, 1.0);
      head.getWorldPosition(headPos);
      pitch = THREE.MathUtils.clamp(-Math.atan2(target.y - headPos.y, Math.hypot(target.x - headPos.x, target.z - headPos.z)), -.55, .45);
      if (drinking) { yaw *= .3; pitch = 0; }
    }
    const blend = Math.min(1, dt * (ud.turnSpeed ?? 2.2) * 1.6);
    gazeYaw += (yaw - gazeYaw) * blend; gazePitch += (pitch - gazePitch) * blend; twist += (wantTwist - twist) * blend;
    rotateChar(spine, Y, twist);
    rotateChar(neck, Y, gazeYaw * .4); rotateChar(head, Y, gazeYaw * .6);
    // 抬頭／低頭要繞「頭轉向之後」的左右軸，否則轉身望人時會變成歪頭。
    rotateChar(neck, pitchAxis.copy(X).applyAxisAngle(Y, twist + gazeYaw * .4), gazePitch * .4);
    rotateChar(head, pitchAxis.copy(X).applyAxisAngle(Y, twist + gazeYaw), gazePitch * .6);
    placeHeld();
  };

  play('Idle', { fade: 0 }); evaluate(0);
  return root;
}
