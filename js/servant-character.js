// 老僕（序章，Tripo 立體模型 + 自建 Mixamo 式骨架）。動作已烘焙在 GLB 內：Idle Talk Bow。
// 原模型雙手自然垂在身旁，與衣服相連，因此所有動作都不移動手臂，只有呼吸、輕微點頭和鞠躬。
// 說話時以形變目標 MouthOpen 張合口部（見 assets/characters/README.md、tools/servant-model）。
import { THREE, E } from './engine.js';
import { GLTFLoader } from '../lib/addons/loaders/GLTFLoader.js';
import { clone } from '../lib/addons/utils/SkeletonUtils.js';
import { makePerson } from './people.js';

const MODEL_URL = 'assets/characters/old-servant.glb';
// 模型原高 0.98，放大到約 1.69 米（老人微駝，比柳宗元略矮）。
const SCALE = 1.73;

let loading;
export function loadServantCharacter() {
  if (!loading) loading = fetch(MODEL_URL)
    .then(r => { if (!r.ok) throw new Error(`${MODEL_URL}: ${r.status}`); return r.arrayBuffer(); })
    .then(buf => new GLTFLoader().parseAsync(buf, 'assets/characters/'))
    .catch(error => { console.warn('老僕模型未能載入，使用備用人物。', error); return null; });
  return loading;
}

export async function makeServantCharacter(opts = {}, waitMs = 8000) {
  let timeout;
  const gltf = await Promise.race([loadServantCharacter(), new Promise(r => { timeout = setTimeout(r, waitMs, null); })]);
  clearTimeout(timeout);
  if (!gltf) return makePerson({ preset: 'oldServant', ...opts });

  const root = new THREE.Group(), actor = clone(gltf.scene);
  actor.scale.setScalar(SCALE);
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
    // 老僕只在室內近距離出現，直接取樣原圖即可。
    for (const k of ['map', 'normalMap']) {
      const t = o.material[k];
      if (t && t.generateMipmaps) { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    }
    if (o.morphTargetDictionary && 'MouthOpen' in o.morphTargetDictionary) { mouthMesh = o; mouthIdx = o.morphTargetDictionary.MouthOpen; }
  });
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.7, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.85;
  root.add(hit);

  const bone = name => actor.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('mixamorig:' + name));
  const head = bone('Head'), neck = bone('Neck'), spine = bone('Spine'), chest = bone('Spine2');
  const mixer = new THREE.AnimationMixer(actor);
  const actions = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));

  let current = null, gesture = null, elapsed = 0, gazeYaw = 0, gazePitch = 0;
  const ud = root.userData;
  Object.assign(ud, { name: opts.name || '', pose: 'stand', walking: false, head, upper: new THREE.Group(),
    armL: new THREE.Group(), armR: new THREE.Group(), body: actor, mixer, actions });

  function play(name, { once = false, fade = .4 } = {}) {
    const next = actions[name];
    if (!next || (current === next && !once)) return;
    const previous = current;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (previous && previous !== next) next.crossFadeFrom(previous, fade, false);
    current = next;
  }
  const idleName = () => (ud.name && E.speaker === ud.name ? 'Talk' : 'Idle');
  mixer.addEventListener('finished', e => {
    if (gesture && e.action === actions[gesture.name]) { const g = gesture; gesture = null; play(idleName(), { fade: .6 }); g.done(); }
  });

  ud.setPose = () => {};               // 老僕只會站着
  ud.setIdle = () => {};
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
      if (!gesture) root.rotation.y += angleDiff(root.rotation.y, want) * Math.min(1, dt * speed);
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

  play('Idle', { fade: 0 }); evaluate(0);
  return root;
}
