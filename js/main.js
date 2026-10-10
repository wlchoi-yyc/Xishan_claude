import { loadLiuCharacter } from './liu-character.js';
import { loadServantCharacter, loadYoungServant, loadBoatman } from './servant-character.js';
// 主程式：標題畫面、章節流程
import { E, freeze, setPaused } from './engine.js';
import * as ui from './ui.js';
import { audio } from './audio.js';
import { prepState, S } from './chapters/common.js';
import { prologue } from './chapters/prologue.js';
import { chapter1, chapter2 } from './chapters/forest.js';
import { chapter3 } from './chapters/pavilion.js';
import { chapter4 } from './chapters/river.js';
import { chapter5, chapter6 } from './chapters/mountain.js';
import { chapter7, chapter8, chapter9 } from './chapters/summit.js';
import { loadNature } from './nature.js';
import { applyWind } from './world.js';

// 標題畫面時已在背景載入景物素材；按「開始」時最多再等幾秒，載不到便用程式樹
const natureReady = loadNature(applyWind);
loadLiuCharacter();
loadServantCharacter();
loadYoungServant();
loadBoatman();

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

async function start(from = 0) {
  audio.init();
  const title = document.getElementById('title');
  title.classList.add('out');
  setTimeout(() => title.classList.add('hidden'), 1500);
  freeze();
  await Promise.race([natureReady, new Promise(r => setTimeout(r, 6000))]);
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


const pausePanel=document.getElementById('pausePanel');
const resumeButton=document.getElementById('btnResume');
const homeButton=document.getElementById('btnPauseHome');
const logoutButton=document.getElementById('authLogout');
let pausedElements=[],previousFocus=null;
function openPause(){
 previousFocus=document.activeElement;setPaused(true);audio.setPaused(true);
 document.body.classList.add('game-paused');
 pausedElements=[...document.getElementById('experience').children].filter(el=>el!==pausePanel).map(el=>[el,el.inert]);
 pausedElements.forEach(([el])=>el.inert=true);
 pausePanel.hidden=false;resumeButton.focus();
}
function closePause(){
 pausePanel.hidden=true;pausedElements.forEach(([el,inert])=>el.inert=inert);pausedElements=[];
 document.body.classList.remove('game-paused');setPaused(false);audio.setPaused(false);
 if(previousFocus?.isConnected)previousFocus.focus();
}
document.getElementById('btnHome').addEventListener('click',openPause);
resumeButton.addEventListener('click',closePause);
homeButton.addEventListener('click',()=>{location.href=location.pathname+'?menu=1';});
document.addEventListener('keydown',e=>{
 if(pausePanel.hidden)return;
 if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();closePause();}
 if(e.code==='Tab'){e.preventDefault();const buttons=[resumeButton,homeButton,logoutButton];const i=buttons.indexOf(document.activeElement);buttons[(i+(e.shiftKey?2:1)+3)%3].focus();}
},true);
