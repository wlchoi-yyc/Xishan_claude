// 主程式：標題畫面、章節流程
import { E, freeze } from './engine.js';
import * as ui from './ui.js';
import { audio } from './audio.js';
import { prepState, S } from './chapters/common.js';
import { prologue } from './chapters/prologue.js';
import { chapter1, chapter2 } from './chapters/forest.js';
import { chapter3 } from './chapters/pavilion.js';
import { chapter4 } from './chapters/river.js';
import { chapter5, chapter6 } from './chapters/mountain.js';
import { chapter7, chapter8, chapter9 } from './chapters/summit.js';

const CHAPTERS = [
  { name: '序章　柳宗元去了哪裏？', run: prologue },
  { name: '第一關　尋找舊足跡', run: chapter1 },
  { name: '第二關　重建平日遊山', run: chapter2 },
  { name: '第三關　法華西亭', run: chapter3 },
  { name: '第四關　過湘江，緣染溪', run: chapter4 },
  { name: '第五關　山路消失了', run: chapter5 },
  { name: '第六關　攀援而登', run: chapter6 },
  { name: '第七關　西山之頂', run: chapter7 },
  { name: '第八關　西山為何怪特', run: chapter8 },
  { name: '第九關・終章　找到柳宗元', run: chapter9 },
];

ui.initButtons({
  onHint: (h) => ui.toast(h || '四處看看，點擊發光的標記。'),
});

// 回到首頁：先確認，再重新載入到標題畫面，並展開「教師：章節選擇」
window.__homeReady = true;
document.getElementById('btnHome').addEventListener('click', async () => {
  audio.click();
  const go = await new Promise(res => {
    ui.modal(`<h2><span class="seal">首頁</span>回到首頁？</h2>
      <p class="lead">回到標題畫面後，可在「教師：章節選擇」直接跳到任何一關。<br>目前這一關的進度不會保存。</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="primary" id="homeYes">回到首頁</button>
        <button class="primary" id="homeNo" style="background:#3d5f58">繼續遊戲</button>
      </div>`).then(() => res(false));
    document.getElementById('homeYes').addEventListener('click', () => { ui.closeModal(); res(true); });
    document.getElementById('homeNo').addEventListener('click', () => { ui.closeModal(); res(false); });
  });
  if (go) location.href = location.pathname + '?menu=1';
});

async function start(from = 0) {
  audio.init();
  const title = document.getElementById('title');
  title.classList.add('out');
  setTimeout(() => title.classList.add('hidden'), 1500);
  freeze();
  if (from > 0) { S.jumped = true; prepState(from); }
  for (let i = from; i < CHAPTERS.length; i++) {
    await CHAPTERS[i].run();
  }
}

document.getElementById('btnStart').addEventListener('click', () => start(0));
const list = document.getElementById('chapterList');
CHAPTERS.forEach((c, i) => {
  const b = document.createElement('button');
  b.textContent = c.name;
  b.addEventListener('click', () => start(i));
  list.appendChild(b);
});

// 網址參數 ?ch=N 直接跳到某一關（方便教師示範）
const q = new URLSearchParams(location.search);
// ?menu=1：由遊戲中按「首頁」回來，自動展開教師章節選擇
if (q.has('menu')) {
  const menu = document.getElementById('teacherMenu');
  menu.open = true;
  setTimeout(() => menu.scrollIntoView({ block: 'center' }), 300);
}
// ?speed=N：僅供自動測試加速
if (q.has('speed')) window.__speed = Math.max(1, Math.min(20, parseFloat(q.get('speed')) || 1));
if (q.has('ch')) {
  const n = Math.max(0, Math.min(CHAPTERS.length - 1, parseInt(q.get('ch'), 10) || 0));
  const btn = document.getElementById('btnStart');
  btn.textContent = `開始（${CHAPTERS[n].name.split('　')[0]}）`;
  btn.replaceWith(btn.cloneNode(true));
  document.getElementById('btnStart').addEventListener('click', () => start(n));
}
// 標題背後的黑幕先淡開
document.getElementById('fade').style.opacity = '1';
window.__game = { E, ui };
