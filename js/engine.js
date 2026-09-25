// 引擎：渲染、第一人稱鏡頭、移動、點擊互動、補間動畫
import * as THREE from '../lib/three.module.js';

export { THREE };

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
// 光影：柔和陰影與電影式色調
const LOW_END = matchMedia('(pointer: coarse)').matches && (navigator.hardwareConcurrency || 4) <= 4;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 6000);
camera.rotation.order = 'YXZ';

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------------- 狀態 ----------------
export const E = {
  THREE, renderer, camera,
  world: null,
  time: 0,
  player: {
    pos: new THREE.Vector3(), yaw: 0, pitch: 0,
    eye: 1.6, speed: 3.6, groundY: 0,
    bob: 0, yOffset: 0,
  },
  input: { move: false, look: true, interact: false },
  fovTarget: 70,
  shake: 0,
  tool: null,            // 工具模式（斧頭、火把）
  onUpdate: [],          // 其他每幀回調
  persons: new Set(),    // 需要處理「看鏡頭」的人物
  interactables: [],
  walkLock: false,
};

// ---------------- 補間動畫 ----------------
const tweens = [];
export const ease = {
  linear: k => k,
  inOut: k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2,
  out: k => 1 - Math.pow(1 - k, 3),
  in: k => k * k * k,
  sine: k => -(Math.cos(Math.PI * k) - 1) / 2,
};
export function tween(duration, fn, easing = ease.inOut) {
  return new Promise(resolve => {
    tweens.push({ t: 0, duration: Math.max(0.0001, duration), fn, easing, resolve });
  });
}
export function wait(sec) { return tween(sec, () => {}); }
export function lerp(a, b, k) { return a + (b - a) * k; }
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// 朝向某點所需的 yaw / pitch
export function yawPitchTo(target, from = E.player.pos) {
  const dx = target.x - from.x, dz = target.z - from.z, dy = target.y - (from.y);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { yaw, pitch };
}
export async function lookAt(target, duration = 1.2, pitchOverride) {
  const p = E.player;
  const eyePos = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
  const { yaw, pitch } = yawPitchTo(target, eyePos);
  const y0 = p.yaw, dy = angleDiff(p.yaw, yaw), p0 = p.pitch;
  const p1 = pitchOverride ?? pitch;
  await tween(duration, k => { p.yaw = y0 + dy * k; p.pitch = lerp(p0, p1, k); });
}
export async function turnTo(yaw, pitch, duration = 1.2) {
  const p = E.player;
  const y0 = p.yaw, dy = angleDiff(p.yaw, yaw), p0 = p.pitch;
  await tween(duration, k => { p.yaw = y0 + dy * k; if (pitch !== undefined) p.pitch = lerp(p0, pitch, k); });
}
export async function moveTo(x, z, duration = 2, { eye } = {}) {
  const p = E.player;
  const x0 = p.pos.x, z0 = p.pos.z, e0 = p.eye;
  await tween(duration, k => {
    p.pos.x = lerp(x0, x, k); p.pos.z = lerp(z0, z, k);
    if (eye !== undefined) p.eye = lerp(e0, eye, k);
  });
}
export function setPlayer(x, z, yaw = 0, pitch = 0) {
  const p = E.player;
  p.pos.x = x; p.pos.z = z; p.yaw = yaw; p.pitch = pitch;
  const h = E.world ? E.world.heightAt(x, z) : 0;
  p.groundY = h; p.pos.y = h + p.eye;
}

// ---------------- 世界 ----------------
export function setWorld(world) {
  if (E.world && E.world.dispose) E.world.dispose();
  clearInteractables();
  // 只清除不屬於新場景的人物（建構場景時加入的人物要保留）
  for (const p of [...E.persons]) { let o = p; while (o.parent) o = o.parent; if (o !== world.scene) E.persons.delete(p); }
  E.onUpdate.length = 0;
  E.tool = null;
  E.world = world;
  E.freeCam = null;
  E.player.yOffset = 0;
  // 鏡頭加入場景，以便手持工具等子物件能被渲染
  world.scene.add(camera);
  E.sunLight = null;
  world.scene.traverse(o => { if (o.isDirectionalLight && o.userData.follow && !E.sunLight) E.sunLight = o; });
  if (E.sunLight) setupSunShadow(E.sunLight);
  shadowScan = 0;
  E.player.eye = 1.6;
  E.fovTarget = 70;
  camera.fov = 70; camera.updateProjectionMatrix();
}

// ---------------- 互動物件 ----------------
const markersEl = document.getElementById('markers');
const tooltip = document.getElementById('tooltip');

/**
 * 加入可互動物件
 * opts: { object, label, range=2.6, marker=true, onClick, markerOffset=0.4, enabled=true, walk=true }
 */
export function addInteractable(opts) {
  const it = Object.assign({ range: 2.8, marker: true, markerOffset: 0.35, enabled: true, walk: true, hint: false }, opts);
  it.object.traverse(o => { o.userData.interactable = it; });
  if (it.marker) {
    const el = document.createElement('div');
    el.className = 'marker';
    const lab = document.createElement('div');
    lab.className = 'mlabel';
    lab.textContent = it.label || '';
    el.appendChild(lab);
    markersEl.appendChild(el);
    it.el = el;
  }
  E.interactables.push(it);
  return it;
}
export function removeInteractable(it) {
  if (!it) return;
  it.enabled = false;
  if (it.el) it.el.remove();
  it.object.traverse(o => { if (o.userData.interactable === it) delete o.userData.interactable; });
  const i = E.interactables.indexOf(it);
  if (i >= 0) E.interactables.splice(i, 1);
}
export function clearInteractables() {
  [...E.interactables].forEach(removeInteractable);
  markersEl.innerHTML = '';
}
// 等待玩家點擊其中一個物件
export function waitClick(it) {
  return new Promise(res => {
    const prev = it.onClick;
    it.onClick = () => { it.onClick = prev; res(it); };
  });
}

// ---------------- 輸入 ----------------
const keys = new Set();
const dpadState = { f: 0, b: 0, l: 0, r: 0 };
window.addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  keys.add(e.code);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

document.querySelectorAll('#dpad button').forEach(b => {
  const d = b.dataset.dir;
  const on = e => { e.preventDefault(); dpadState[d] = 1; };
  const off = e => { e.preventDefault(); dpadState[d] = 0; };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
});

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointer = { down: false, id: null, x: 0, y: 0, sx: 0, sy: 0, dragging: false, toolDrag: false, lastX: 0, lastY: 0 };
let hoverIt = null;
let autoWalk = null;
let yawAccum = 0; // 累積轉動量（用於「四望如一」）
export function resetYawAccum() { yawAccum = 0; }
export function getYawAccum() { return yawAccum; }

function setNDC(x, y) {
  ndc.x = (x / window.innerWidth) * 2 - 1;
  ndc.y = -(y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
}
export function raycastFrom(x, y, objects) {
  setNDC(x, y);
  return raycaster.intersectObjects(objects, true);
}
function pickInteractable(x, y) {
  const objs = E.interactables.filter(i => i.enabled && i.object.visible).map(i => i.object);
  if (!objs.length) return null;
  const hits = raycastFrom(x, y, objs);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.interactable) o = o.parent;
    if (o && o.userData.interactable && o.userData.interactable.enabled) return { it: o.userData.interactable, point: h.point };
  }
  return null;
}

canvas.addEventListener('pointerdown', e => {
  pointer.down = true; pointer.id = e.pointerId;
  pointer.sx = pointer.lastX = e.clientX; pointer.sy = pointer.lastY = e.clientY;
  pointer.dragging = false; pointer.toolDrag = false;
  canvas.setPointerCapture(e.pointerId);
  if (E.tool && E.tool.onDown && E.input.interact) {
    if (E.tool.onDown(e.clientX, e.clientY)) pointer.toolDrag = true;
  }
});
canvas.addEventListener('pointermove', e => {
  if (pointer.down && e.pointerId === pointer.id) {
    const dx = e.clientX - pointer.lastX, dy = e.clientY - pointer.lastY;
    pointer.lastX = e.clientX; pointer.lastY = e.clientY;
    if (!pointer.dragging && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 6) pointer.dragging = true;
    if (pointer.toolDrag) {
      if (E.tool && E.tool.onDrag) E.tool.onDrag(e.clientX, e.clientY);
    } else if (pointer.dragging && E.input.look) {
      const sens = e.pointerType === 'touch' ? 0.006 : 0.0042;
      E.player.yaw += dx * sens;
      yawAccum += Math.abs(dx * sens);
      E.player.pitch = THREE.MathUtils.clamp(E.player.pitch + dy * sens, -1.25, 1.25);
      if (autoWalk) cancelWalk(false);
    }
  }
  pointer.x = e.clientX; pointer.y = e.clientY;
});
canvas.addEventListener('pointerup', e => {
  if (e.pointerId !== pointer.id) return;
  pointer.down = false;
  if (pointer.toolDrag) { if (E.tool && E.tool.onUp) E.tool.onUp(); pointer.toolDrag = false; return; }
  if (!pointer.dragging) handleClick(e.clientX, e.clientY);
  pointer.dragging = false;
});
canvas.addEventListener('pointercancel', () => { pointer.down = false; pointer.dragging = false; if (E.tool && E.tool.onUp) E.tool.onUp(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function handleClick(x, y) {
  if (!E.input.interact) return;
  if (E.tool && E.tool.onClick && E.tool.onClick(x, y)) return;
  const pick = pickInteractable(x, y);
  if (pick) {
    const it = pick.it;
    const d = distXZ(E.player.pos, it.object.getWorldPosition(new THREE.Vector3()));
    if (d <= it.range || !it.walk || !E.input.move) {
      triggerIt(it);
    } else {
      const target = it.object.getWorldPosition(new THREE.Vector3());
      walkTo(target.x, target.z, it.range * 0.8).then(ok => {
        const d2 = distXZ(E.player.pos, target);
        if (d2 <= it.range + 1.2) triggerIt(it);
      });
    }
    return;
  }
  if (!E.input.move || !E.world || !E.world.walkables) return;
  const hits = raycastFrom(x, y, E.world.walkables);
  if (hits.length) {
    const p = hits[0].point;
    if (distXZ(E.player.pos, p) < 80) walkTo(p.x, p.z, 0.3);
  }
}
function triggerIt(it) {
  if (!it.enabled || !E.input.interact) return;
  if (it.onClick) it.onClick(it);
}
function distXZ(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

export function walkTo(x, z, stopDist = 0.4) {
  cancelWalk(false);
  return new Promise(res => { autoWalk = { x, z, stopDist, res, stuck: 0, last: E.player.pos.clone() }; });
}
function cancelWalk(ok) {
  if (autoWalk) { const r = autoWalk.res; autoWalk = null; r(ok); }
}

// ---------------- 移動與碰撞 ----------------
const tmpV = new THREE.Vector3();
function updateMovement(dt) {
  const p = E.player;
  let fwd = 0, side = 0;
  if (E.input.move) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) side -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) side += 1;
    fwd += dpadState.f - dpadState.b;
    side += dpadState.r - dpadState.l;
  }
  if (E.input.look) {
    if (keys.has('KeyQ')) { p.yaw += 1.6 * dt; yawAccum += 1.6 * dt; }
    if (keys.has('KeyE')) { p.yaw -= 1.6 * dt; yawAccum += 1.6 * dt; }
  }
  let vx = 0, vz = 0;
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  if (fwd || side) {
    cancelWalk(false);
    const len = Math.hypot(fwd, side);
    fwd /= len; side /= len;
    vx = (-sy * fwd + cy * side) * p.speed;
    vz = (-cy * fwd - sy * side) * p.speed;
  } else if (autoWalk && E.input.move) {
    const dx = autoWalk.x - p.pos.x, dz = autoWalk.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= autoWalk.stopDist) { cancelWalk(true); }
    else {
      vx = dx / d * p.speed; vz = dz / d * p.speed;
      if (!pointer.dragging) {
        const want = Math.atan2(-dx, -dz);
        p.yaw += angleDiff(p.yaw, want) * Math.min(1, dt * 3);
      }
      autoWalk.stuck += dt;
      if (autoWalk.stuck > 0.5) {
        if (distXZ(autoWalk.last, p.pos) < 0.25) { cancelWalk(false); }
        else { autoWalk.stuck = 0; autoWalk.last.copy(p.pos); }
      }
    }
  } else if (autoWalk && !E.input.move) {
    cancelWalk(false);
  }
  if (vx || vz) {
    const nx = p.pos.x + vx * dt, nz = p.pos.z + vz * dt;
    tmpV.set(nx, 0, nz);
    collide(tmpV);
    p.pos.x = tmpV.x; p.pos.z = tmpV.z;
    p.bob += dt * 9;
    E.walking = true;
  } else {
    E.walking = false;
  }
}
function collide(v) {
  const w = E.world;
  if (!w) return;
  if (w.blockers) {
    for (const b of w.blockers) {
      if (b.active === false) continue;
      if (b.type === 'box') {
        // 軸對齊方塊（室內牆壁等）
        const px = Math.max(b.minX, Math.min(v.x, b.maxX));
        const pz = Math.max(b.minZ, Math.min(v.z, b.maxZ));
        const dx = v.x - px, dz = v.z - pz, d = Math.hypot(dx, dz);
        const r = b.r ?? 0.3;
        if (d < r) {
          if (d > 1e-5) { v.x = px + dx / d * r; v.z = pz + dz / d * r; }
        }
      } else {
        const dx = v.x - b.x, dz = v.z - b.z, d = Math.hypot(dx, dz);
        const r = b.r + 0.3;
        if (d < r && d > 1e-5) { v.x = b.x + dx / d * r; v.z = b.z + dz / d * r; }
      }
    }
  }
  if (w.clamp) w.clamp(v);
}

// ---------------- 標記與懸停 ----------------
const projV = new THREE.Vector3();
function updateMarkers() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const it of E.interactables) {
    if (!it.el) continue;
    if (!it.enabled || !it.object.visible || it.hideMarker || !E.input.interact) { it.el.style.display = 'none'; continue; }
    it.object.getWorldPosition(projV);
    projV.y += it.markerOffset;
    const dist = projV.distanceTo(camera.position);
    projV.project(camera);
    if (projV.z > 1 || projV.z < -1 || Math.abs(projV.x) > 1.2 || Math.abs(projV.y) > 1.2) { it.el.style.display = 'none'; continue; }
    it.el.style.display = 'block';
    it.el.style.left = ((projV.x + 1) / 2 * w) + 'px';
    it.el.style.top = ((1 - projV.y) / 2 * h) + 'px';
    const s = THREE.MathUtils.clamp(1.4 - dist / 60, 0.55, 1.2);
    it.el.style.transform = `scale(${s})`;
    it.el.classList.toggle('near', dist < 9);
    it.el.classList.toggle('hint', !!it.hint);
  }
}
let hoverTick = 0;
function updateHover(dt) {
  hoverTick += dt;
  if (hoverTick < 0.08) return;
  hoverTick = 0;
  if (!E.input.interact || pointer.dragging || matchMedia('(pointer: coarse)').matches) {
    tooltip.style.display = 'none'; canvas.style.cursor = ''; hoverIt = null; return;
  }
  const pick = pickInteractable(pointer.x, pointer.y);
  const toolHover = E.tool && E.tool.hover ? E.tool.hover(pointer.x, pointer.y) : null;
  if (pick) {
    hoverIt = pick.it;
    tooltip.textContent = pick.it.label || '';
    tooltip.style.display = pick.it.label ? 'block' : 'none';
    tooltip.style.left = (pointer.x + 16) + 'px';
    tooltip.style.top = (pointer.y + 12) + 'px';
    canvas.style.cursor = 'pointer';
  } else if (toolHover) {
    tooltip.textContent = toolHover;
    tooltip.style.display = 'block';
    tooltip.style.left = (pointer.x + 16) + 'px';
    tooltip.style.top = (pointer.y + 12) + 'px';
    canvas.style.cursor = 'crosshair';
  } else {
    hoverIt = null;
    tooltip.style.display = 'none';
    canvas.style.cursor = E.tool ? 'crosshair' : '';
  }
}

// ---------------- 人物看鏡頭 ----------------
const headWorld = new THREE.Vector3();
function updatePersons(dt) {
  for (const person of E.persons) {
    const ud = person.userData;
    if (ud.update) ud.update(dt, E.time);
    const target = ud.watchCamera ? camera.position : ud.lookTarget;
    const seated = ud.pose === 'sit' || ud.pose === 'lie';
    const k = (sp) => Math.min(1, dt * sp);
    if (!target) {
      // 頭部與上身慢慢回正
      ud.head.rotation.y *= 1 - k(2);
      ud.head.rotation.x *= 1 - k(2);
      if (ud.twist !== undefined) { ud.twist *= 1 - k(1.5); ud.upper.rotation.y = ud.twist; }
      continue;
    }
    person.getWorldPosition(headWorld);
    const dx = target.x - headWorld.x, dz = target.z - headWorld.z;
    const want = Math.atan2(dx, dz);
    const parentYaw = person.parent ? person.parent.rotation.y : 0;
    const localWant = want - parentYaw;
    const speed = ud.turnSpeed ?? 2.2;
    // 坐着時雙腳不動，只扭轉上身與頭，避免腿插進地裏
    if (ud.bodyFollow !== false && !seated) {
      const d = angleDiff(person.rotation.y, localWant);
      person.rotation.y += d * k(speed);
    }
    let remain = angleDiff(person.rotation.y, localWant);
    if (seated) {
      const tw = THREE.MathUtils.clamp(remain * 0.45, -0.75, 0.75);
      ud.twist = (ud.twist || 0) + (tw - (ud.twist || 0)) * k(speed);
      ud.upper.rotation.y = ud.twist;
      remain -= ud.twist;
    }
    remain = THREE.MathUtils.clamp(remain, -1.15, 1.15);
    ud.head.rotation.y += (remain - ud.head.rotation.y) * k(speed * 1.6);
    ud.head.getWorldPosition(headWorld);
    const pitch = Math.atan2(target.y - headWorld.y, Math.hypot(dx, dz));
    const wantX = THREE.MathUtils.clamp(-pitch, -0.6, 0.6);
    ud.head.rotation.x += (wantX - ud.head.rotation.x) * k(speed * 1.6);
  }
}

// ---------------- 陰影 ----------------
function setupSunShadow(sun) {
  if (!sun.userData.dir) sun.userData.dir = sun.position.clone().normalize();
  sun.castShadow = true;
  const sz = LOW_END ? 1024 : 2048;
  sun.shadow.mapSize.set(sz, sz);
  const c = sun.shadow.camera;
  c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 400;
  c.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  if (!sun.target.parent) sun.parent.add(sun.target);
}
// 新加入場景的物件也要投射／接收陰影（每秒掃描一次）
let shadowScan = 0;
function scanShadows(scene) {
  scene.traverse(o => {
    if (!o.isMesh || o.userData.shadowSet) return;
    o.userData.shadowSet = true;
    const m = o.material;
    if (Array.isArray(m) || !m) return;
    if (o.userData.terrain) { o.receiveShadow = true; return; }
    if (m.transparent || m.isShaderMaterial || m.isMeshBasicMaterial || m.isPointsMaterial || m.visible === false) return;
    o.castShadow = true; o.receiveShadow = true;
  });
}
const _fwd = new THREE.Vector3();
function updateSun() {
  const sun = E.sunLight;
  if (!sun) return;
  // 陰影範圍跟着玩家，並稍為偏向前方
  _fwd.set(-Math.sin(E.player.yaw), 0, -Math.cos(E.player.yaw)).multiplyScalar(18).add(E.player.pos);
  sun.target.position.copy(_fwd);
  sun.position.copy(_fwd).addScaledVector(sun.userData.dir, 180);
  sun.target.updateMatrixWorld();
}

// ---------------- 主迴圈 ----------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;
  dt *= (window.__speed || 1);
  E.time += dt;

  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.duration);
    tw.fn(tw.easing(k));
    if (k >= 1) { tweens.splice(i, 1); tw.resolve(); }
  }

  updateMovement(dt);

  const p = E.player;
  if (E.world) {
    const g = E.world.heightAt(p.pos.x, p.pos.z);
    p.groundY += (g - p.groundY) * Math.min(1, dt * 10);
    const bob = E.walking ? Math.sin(p.bob) * 0.04 : 0;
    p.pos.y = p.groundY + p.eye + bob + p.yOffset;
  }
  if (E.freeCam) {
    camera.position.copy(E.freeCam.pos);
    camera.lookAt(E.freeCam.target);
  } else {
    camera.position.copy(p.pos);
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  }
  if (E.shake > 0) {
    camera.position.x += (Math.random() - .5) * E.shake;
    camera.position.y += (Math.random() - .5) * E.shake;
    E.shake = Math.max(0, E.shake - dt * 0.6);
  }
  if (Math.abs(camera.fov - E.fovTarget) > 0.01) {
    camera.fov += (E.fovTarget - camera.fov) * Math.min(1, dt * 2.2);
    camera.updateProjectionMatrix();
  }

  if (E.world) {
    shadowScan -= dt;
    if (shadowScan <= 0) { shadowScan = 1; scanShadows(E.world.scene); }
    updateSun();
  }
  if (E.world && E.world.animated) for (const o of E.world.animated) o.userData.animate(E.time);
  if (E.world && E.world.update) E.world.update(dt, E.time);
  for (const fn of E.onUpdate) fn(dt, E.time);
  updatePersons(dt);
  updateMarkers();
  updateHover(dt);

  if (E.world) renderer.render(E.world.scene, camera);
}
requestAnimationFrame(frame);

export function setControls({ move, look, interact }) {
  if (move !== undefined) E.input.move = move;
  if (look !== undefined) E.input.look = look;
  if (interact !== undefined) E.input.interact = interact;
  if (!E.input.move) cancelWalk(false);
  if (!E.input.interact) { tooltip.style.display = 'none'; canvas.style.cursor = ''; }
}
export function freeze() { setControls({ move: false, look: false, interact: false }); }
export function unfreeze() { setControls({ move: true, look: true, interact: true }); }

// 判斷鏡頭是否正望向某點（容許角度）
export function isLookingAt(target, tol = 0.2) {
  const { yaw, pitch } = yawPitchTo(target, E.player.pos);
  return Math.abs(angleDiff(E.player.yaw, yaw)) < tol && Math.abs(E.player.pitch - pitch) < tol * 2.2;
}
