// Blender 柳宗元：共用模型資源，每位人物有獨立骨架、材質與動畫狀態。
import { THREE, E } from './engine.js';
import { GLTFLoader } from '../lib/addons/loaders/GLTFLoader.js';
import { clone } from '../lib/addons/utils/SkeletonUtils.js';
import { makePerson } from './people.js';
import { createLiuFootPose } from './liu-foot-pose.js';

let loading;
export function loadLiuCharacter() {
  if (!loading) loading = (async () => {
      // Small binary parts avoid oversized upload requests; reconstruct the original GLB exactly.
      const parts = new Array(19);
      let cursor = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (cursor < parts.length) {
          const i = cursor++;
          const response = await fetch(`assets/characters/liu-zongyuan/part-${String(i).padStart(2, '0')}.bin`);
          if (!response.ok) throw new Error(`Character part ${i}: ${response.status}`);
          parts[i] = new Uint8Array(await response.arrayBuffer());
        }
      }));
      const bytes = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      return new GLTFLoader().parseAsync(bytes.buffer, 'assets/characters/');
    })()
    .catch(error => { console.warn('柳宗元模型未能載入，使用備用人物。', error); return null; });
  return loading;
}

export async function makeLiuCharacter(opts = {}) {
  let timeout;
  const gltf = await Promise.race([loadLiuCharacter(), new Promise(r => { timeout = setTimeout(r, 8000, null); })]);
  clearTimeout(timeout);
  if (!gltf) return makePerson({ preset: 'liu', ...opts });
  const root = new THREE.Group(), actor = clone(gltf.scene);
  root.add(actor);
  actor.traverse(o => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
    // 動態骨架的包圍盒不能只沿用站姿；單一主角避免每幀重算所有頂點。
    o.frustumCulled = false;
    o.castShadow = false;
    o.receiveShadow = true;
  });
  const bone = name => actor.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  const head = bone('Head'), spine = bone('Spine'), chest = bone('Chest');
  const armL = bone('UpperArm.L'), armR = bone('UpperArm.R');
  const thighL = bone('Thigh.L'), thighR = bone('Thigh.R');
  const cupMesh = bone('Liu_CeladonCup'), cupBone = bone('Cup');
  cupMesh.visible = false;
  // 杯骨在非飲酒片段會縮成零；獨立握點保留酒壺與酒杯的原有尺寸。
  const grip = new THREE.Group();
  grip.position.copy(cupBone.position); grip.quaternion.copy(cupBone.quaternion);
  cupBone.parent.add(grip);
  const mixer = new THREE.AnimationMixer(actor);
  const footPose = createLiuFootPose(actor);
  const overlayBones = [head, spine, chest, armL, armR, thighL, thighR];
  const baseRotations = overlayBones.map(b => b.quaternion.clone());
  function evaluate(dt) {
    // 恆定動畫軌不會每幀寫回骨骼；先移除上一幀疊加，防止轉頭／步行累積扭曲。
    footPose.restore();
    overlayBones.forEach((b,i) => b.quaternion.copy(baseRotations[i]));
    mixer.update(dt);
    overlayBones.forEach((b,i) => baseRotations[i].copy(b.quaternion));
    footPose.apply();
  }
  const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c.clone().optimize()]));
  // 坐着說話仍保留盤腿姿勢，只套用說話的上身、手勢及面部動畫。
  const talkTracks = clips.Talk.tracks.filter(t => /^(Head|Neck|Chest|Spine|UpperArm|Forearm|Hand|Finger)/.test(t.name) || (/morphTargetInfluences/.test(t.name) && !/Liu_(CharcoalCloth|IndigoLinen\.|IvoryLinen)/.test(t.name)));
  const replaced = new Set(talkTracks.map(t => t.name));
  clips.SeatedTalk = new THREE.AnimationClip('SeatedTalk', clips.Talk.duration,
    [...clips.SeatedIdle.tracks.filter(t => !replaced.has(t.name)), ...talkTracks].map(t => t.clone()));
  const actions = Object.fromEntries(Object.entries(clips).map(([n,c]) => [n,mixer.clipAction(c)]));
  let current, queue = [], elapsed = 0, held = null, drinking = false;
  let gazeYaw = 0, gazePitch = 0, twist = 0;
  // 劇情手勢使用代理節點，動畫每幀後疊加，避免覆蓋 Blender 骨骼的靜止方向。
  const upper = new THREE.Group(), gestureL = new THREE.Group();
  const ud = root.userData;
  Object.assign(ud, { name: opts.name || '', pose: 'stand', walking: false,
    head, upper, armL: gestureL, armR, body: actor, isBlenderLiu: true, mixer, actions });
  function play(name, loop = true, reverse = false, fade = .22) {
    const next = actions[name];
    if (current === next && loop && !next.paused) return;
    const previous = current;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(reverse ? -1 : 1);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    if (reverse) next.time = next.getClip().duration;
    next.play();
    if (previous && previous !== next) next.crossFadeFrom(previous, fade, false);
    current = next;
  }
  function advance() { if (queue.length) play(...queue.shift()); }
  mixer.addEventListener('finished', e => { if (e.action === current) advance(); });
  ud.setPose = pose => {
    const previous = ud.pose;
    ud.pose = pose; queue = []; drinking = false;
    upper.rotation.set(0,0,0); gestureL.rotation.set(0,0,0);
    const idle = pose === 'sit' ? 'SeatedIdle' : pose === 'lie' ? 'LyingIdle' : 'Idle';
    // 首次放進場景前直接就位；劇情中的變化才播放過渡動作。
    if (!root.parent || previous === pose) { play(idle); evaluate(0); return; }
    if (previous === 'lie' && pose !== 'lie') queue.push(['LieDown', false, true]);
    if (pose === 'stand') queue.push(['StandUp', false]);
    else if (previous === 'stand') queue.push(['SitDown', false]);
    if (pose === 'lie') queue.push(['LieDown', false]);
    queue.push([idle]); advance();
  };
  ud.holdCup = (obj, { lift = -.02 } = {}) => {
    if (held) grip.remove(held);
    held = obj; grip.add(obj); obj.position.set(0,lift,0); obj.rotation.set(0,0,0);
    ud.customArms = true;
  };
  ud.drinkPose = k => {
    queue = []; drinking = true; ud.drinkK = THREE.MathUtils.clamp(k,0,2);
    if (current !== actions.Drink) { mixer.stopAllAction(); current = null; play('Drink', false); }
    current.paused = true;
    // 使用舉杯片段的前半段：劇情 k 決定舉起、停留和放下的節奏。
    current.time = .033333 + ud.drinkK / 2 * 2.45;
    evaluate(0);
  };
  ud.releaseCup = () => {
    if (held) grip.remove(held);
    held = null; drinking = false; ud.drinkK = 0; ud.customArms = false;
    mixer.stopAllAction(); current = null;
    play(ud.pose === 'sit' ? 'SeatedIdle' : 'Idle');
  };
  ud.update = dt => {
    elapsed += dt;
    const transitioning = current && current.loop === THREE.LoopOnce && !current.paused;
    if (!drinking && !transitioning && !queue.length) {
      const talking = ud.name && E.speaker === ud.name;
      play(ud.pose === 'lie' ? 'LyingIdle' : ud.pose === 'sit' ? (talking ? 'SeatedTalk' : 'SeatedIdle') : (talking ? 'Talk' : 'Idle'));
    }
    evaluate(dt);
    if (ud.walking && ud.pose === 'stand') {
      const swing = Math.sin(elapsed * 7);
      thighL.rotateX(swing * .28); thighR.rotateX(-swing * .28);
      armL.rotateX(-swing * .18); armR.rotateX(swing * .18);
    }
    chest.rotateZ(upper.rotation.z);
    if (ud.customArms && !held && !drinking) {
      armL.rotateX(gestureL.rotation.x * .35);
      armL.rotateZ(gestureL.rotation.z * .5);
    }
    ud.extraUpdate?.(dt);
  };
  const pos = new THREE.Vector3(), headPos = new THREE.Vector3();
  const angleDiff = (a,b) => Math.atan2(Math.sin(b-a),Math.cos(b-a));
  ud.updateLook = (target,dt) => {
    let yaw = 0, pitch = 0, wantTwist = 0;
    if (target && ud.pose !== 'lie') {
      root.getWorldPosition(pos);
      const want = Math.atan2(target.x-pos.x,target.z-pos.z) - (root.parent?.rotation.y || 0);
      const speed = ud.turnSpeed ?? 2.2;
      if (ud.bodyFollow !== false && ud.pose === 'stand') root.rotation.y += angleDiff(root.rotation.y,want)*Math.min(1,dt*speed);
      yaw = angleDiff(root.rotation.y,want);
      if (ud.pose === 'sit') wantTwist = THREE.MathUtils.clamp(yaw*.45,-.65,.65);
      yaw = THREE.MathUtils.clamp(yaw-wantTwist,-.95,.95);
      head.getWorldPosition(headPos);
      pitch = THREE.MathUtils.clamp(-Math.atan2(target.y-headPos.y,Math.hypot(target.x-headPos.x,target.z-headPos.z)),-.4,.4);
    }
    const blend = Math.min(1,dt*(ud.turnSpeed ?? 2.2)*1.6);
    gazeYaw += (yaw-gazeYaw)*blend; gazePitch += (pitch-gazePitch)*blend; twist += (wantTwist-twist)*blend;
    spine.rotateY(twist); head.rotateY(gazeYaw); head.rotateX(gazePitch);
  };
  play('Idle'); evaluate(0);
  return root;
}
