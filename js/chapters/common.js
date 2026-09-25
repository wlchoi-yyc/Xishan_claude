// 章節共用工具
import { E, THREE, setWorld, setPlayer, freeze, unfreeze, addInteractable, removeInteractable, wait, tween, lookAt } from '../engine.js';
import * as ui from '../ui.js';
import { audio } from '../audio.js';

export { E, THREE, ui, audio };

/** 切換場景：淡出 → 建立世界 → 放置玩家 → 淡入 */
export async function enter(buildWorld, spawn, { fade = 1 } = {}) {
  freeze();
  await ui.fadeOut(fade);
  ui.hideDialog();
  const world = buildWorld();
  setWorld(world);
  setPlayer(spawn.x, spawn.z, spawn.yaw ?? 0, spawn.pitch ?? 0);
  await wait(0.15);
  await ui.fadeIn(fade * 1.2);
  return world;
}

/** 建立一個會觸發一次的「痕跡」，回傳 Promise（在觸發並完成 handler 後 resolve） */
export function clue(object, label, handler, opts = {}) {
  return new Promise(res => {
    const it = addInteractable(Object.assign({
      object, label,
      onClick: async () => {
        if (it.busy) return;
        it.busy = true;
        freeze();
        audio.discover();
        await handler(it);
        if (!opts.keep) removeInteractable(it);
        it.busy = false;
        unfreeze();
        res(it);
      },
    }, opts));
  });
}

/** 對話時讓人物看着鏡頭 */
export function watch(person, on = true) {
  person.userData.watchCamera = on;
  if (on) person.userData.lookTarget = null;
}

/** 等待條件成立（每幀檢查） */
export function until(fn, every = 0.1) {
  return new Promise(res => {
    const iv = setInterval(() => { if (fn()) { clearInterval(iv); res(); } }, every * 1000);
  });
}

export function dist2D(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// 章節間共享的狀態
export const S = {
  jumped: false,
};

/** 教師跳關時，補回前面章節應有的狀態 */
export function prepState(ch) {
  const moodByCh = ['tremble', 'tremble', 'wander', 'possess', 'wonder', 'eager', 'eager', 'eager', 'open', 'serene', 'serene'];
  ui.showHUD(true);
  ui.setMood(moodByCh[ch] || 'tremble', { silent: true });
  if (ch >= 1) { ui.unlockButton('btnMap'); ui.mapVisit('home'); }
  if (ch >= 2) ui.mapVisit('forest');
  if (ch >= 4) { ui.mapVisit('temple'); ui.mapRoute(['home', 'forest', 'temple']); }
  if (ch >= 5) { ui.mapVisit('ferry'); ui.mapVisit('creek'); ui.mapKnowXishan(); ui.mapRoute(['home', 'forest', 'temple', 'ferry', 'creek', 'xishan']); }
  document.getElementById('btnJournal').classList.remove('hidden');
}
