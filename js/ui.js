// 介面：對話、字幕、心境、日誌、地圖、各種解謎介面
import { audio } from './audio.js';
import { FULL_TEXT, MOODS, JOURNAL_CATS } from './data.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms / (window.__speed || 1)));
export { sleep };

// ================= 對話 =================
const dlg = $('dialog'), dlgName = $('dlgName'), dlgText = $('dlgText'), dlgChoices = $('dlgChoices'), dlgNext = $('dlgNext');
let advance = null;
let typing = null; // { finish() }
dlg.addEventListener('click', () => { if (advance) advance(); });
window.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'Enter') && advance && !dlg.classList.contains('hidden')) { e.preventDefault(); advance(); }
});

function typeText(text) {
  return new Promise(res => {
    dlgText.textContent = '';
    let i = 0, timer = null;
    const chars = [...text];
    const finish = () => { clearTimeout(timer); dlgText.textContent = text; typing = null; res(); };
    const step = () => {
      if (i >= chars.length) { typing = null; res(); return; }
      dlgText.textContent += chars[i++];
      timer = setTimeout(step, 38 / (window.__speed || 1));
    };
    typing = { finish };
    timer = setTimeout(step, 38 / (window.__speed || 1));
  });
}

/** 顯示一句對話。name 為空則為旁白；name === '你' 以玩家顏色顯示 */
export async function say(name, text, { auto = 0 } = {}) {
  dlg.classList.remove('hidden');
  dlgName.textContent = name || '';
  dlgName.classList.toggle('player', name === '你');
  dlgText.classList.toggle('narration', !name);
  dlgChoices.innerHTML = '';
  dlgNext.style.visibility = 'hidden';
  advance = () => { if (typing) typing.finish(); };
  audio.blip && audio.blip();
  await typeText(text);
  if (auto) { advance = null; await sleep(auto * 1000); return; }
  dlgNext.style.visibility = 'visible';
  await new Promise(res => { advance = () => { advance = null; audio.click(); res(); }; });
}
export async function sayAll(lines) { for (const [n, t, o] of lines) await say(n, t, o); }
export function hideDialog() { dlg.classList.add('hidden'); advance = null; }

/** 對話選項：options = [{label, value}] */
export function choose(options, { name = '', text = '' } = {}) {
  return new Promise(res => {
    dlg.classList.remove('hidden');
    dlgName.textContent = name;
    dlgName.classList.toggle('player', name === '你');
    dlgText.textContent = text;
    dlgText.classList.toggle('narration', !name);
    dlgNext.style.visibility = 'hidden';
    advance = null;
    dlgChoices.innerHTML = '';
    options.forEach(o => {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.addEventListener('click', ev => { ev.stopPropagation(); audio.click(); dlgChoices.innerHTML = ''; res(o.value ?? o.label); });
      dlgChoices.appendChild(b);
    });
  });
}

// ================= 原文字幕 =================
const capWrap = $('caption'), capText = $('captionText');
let capTimer = null;
/** 顯示原文。gloss 為小字說明。hold 秒後自動隱藏（0 = 需手動 hideCaption） */
export async function caption(text, { gloss = '', hold = 5, top } = {}) {
  clearTimeout(capTimer);
  capWrap.classList.remove('hidden');
  capWrap.style.top = top || '';
  capText.innerHTML = '';
  capText.appendChild(document.createTextNode(text));
  if (gloss) { const g = document.createElement('span'); g.className = 'gloss'; g.textContent = gloss; capText.appendChild(g); }
  capText.classList.remove('show');
  void capText.offsetWidth;
  capText.classList.add('show');
  audio.bell();
  if (hold > 0) {
    await sleep(hold * 1000);
    await hideCaption();
  }
}
export async function hideCaption() {
  capText.classList.remove('show');
  await sleep(1600);
}

const whisperEl = $('whisper');
export async function whisper(text, { who = '', hold = 4 } = {}) {
  whisperEl.classList.remove('hidden');
  whisperEl.innerHTML = '';
  if (who) { const w = document.createElement('span'); w.className = 'who'; w.textContent = who; whisperEl.appendChild(w); }
  whisperEl.appendChild(document.createTextNode(text));
  whisperEl.classList.remove('show'); void whisperEl.offsetWidth; whisperEl.classList.add('show');
  if (hold > 0) { await sleep(hold * 1000); whisperEl.classList.remove('show'); await sleep(1200); }
}
export function hideWhisper() { whisperEl.classList.remove('show'); }

// ================= 章節卡、目標、通知 =================
export async function chapterCard(num, name, sub) {
  const el = $('chapterCard');
  el.querySelector('.ccNum').textContent = num;
  el.querySelector('.ccName').textContent = name;
  el.querySelector('.ccSub').textContent = sub || '';
  el.classList.remove('hidden');
  void el.offsetWidth;
  el.classList.add('show');
  $('chapterTag').textContent = `${num}　${name}`;
  await sleep(2600);
  el.classList.remove('show');
  await sleep(1200);
  el.classList.add('hidden');
}
let hintText = '';
export function objective(text, hint = '') {
  const el = $('objective');
  if (!text) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('objText').textContent = text;
  hintText = hint;
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
export function setHint(h) { hintText = h; }
export function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

// ================= HUD 顯示／隱藏 =================
export function showHUD(on = true) { $('hud').classList.toggle('hidden', !on); }
export async function fadeHUD(out, dur = 2.5) {
  const els = [$('hud'), $('markers'), $('dpad'), $('crosshair'), $('controlsHelp')];
  els.forEach(el => { el.style.transition = `opacity ${dur}s ease`; el.style.opacity = out ? '0' : '1'; el.style.pointerEvents = out ? 'none' : ''; });
  await sleep(dur * 1000);
}
export function showDpad(on) {
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  $('dpad').classList.toggle('hidden', !(on && touch));
  $('controlsHelp').classList.toggle('hidden', !on || touch);
}

// ================= 淡入淡出 =================
export async function fadeOut(dur = 1) {
  const f = $('fade'); f.style.transition = `opacity ${dur}s ease`; f.style.opacity = '1'; await sleep(dur * 1000);
}
export async function fadeIn(dur = 1) {
  const f = $('fade'); f.style.transition = `opacity ${dur}s ease`; f.style.opacity = '0'; await sleep(dur * 1000);
}

// ================= 心境 =================
let moodKey = null;
export function setMood(key, { silent = false } = {}) {
  const m = MOODS[key];
  if (!m) return;
  const el = $('mood');
  el.classList.remove('hidden');
  const changed = moodKey && moodKey !== key;
  moodKey = key;
  document.getElementById('heartPath').style.fill = m.color;
  $('moodLabel').textContent = m.label;
  document.getElementById('heartBinds').style.opacity = m.binds;
  el.classList.toggle('tremble', !!m.tremble);
  el.classList.toggle('glow', !!m.glow);
  el.style.setProperty('--heart-glow', m.color);
  el.querySelector('svg').style.transform = `scale(${m.scale || 1})`;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  if (changed && !silent) { toast(`柳宗元的心境改變了：${m.label}`); audio.chime(); }
  journalAdd('心境', `${m.label}——${m.desc}`, m.quote, { silent: true });
}
$('mood').addEventListener('click', () => {
  if (!moodKey) return;
  const m = MOODS[moodKey];
  modal(`<h2><span class="seal">心境</span>${m.label}</h2><p class="lead">${m.desc}</p>${m.quote ? `<p class="lead" style="color:#7a2a20">「${m.quote}」</p>` : ''}<p style="font-size:14px;color:#8a7555">左上角的「心」會隨着旅程改變。留意它——它記錄的是柳宗元，而不只是你。</p><button class="primary" data-close>繼續</button>`);
});

// ================= 模態 =================
const modalEl = $('modal'), modalBox = $('modalBox');
let modalOnClose = null;
export function modal(html, { closable = true } = {}) {
  return new Promise(res => {
    modalBox.innerHTML = html + (closable ? '<button class="close" data-close>×</button>' : '');
    modalEl.classList.remove('hidden');
    modalOnClose = res;
    modalBox.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { audio.click(); closeModal(); }));
  });
}
export function closeModal(val) {
  modalEl.classList.add('hidden');
  modalBox.innerHTML = '';
  const r = modalOnClose; modalOnClose = null;
  if (r) r(val);
}

// ================= 問答 =================
/** 多項選擇：直到答對為止。options: [{label, correct, feedback}] */
export function question({ tag = '推理', title, lead = '', options, onCorrect }) {
  return new Promise(res => {
    modalBox.innerHTML = `<h2><span class="seal">${tag}</span>${title}</h2>${lead ? `<p class="lead">${lead}</p>` : ''}<div class="opts"></div><div class="feedback"></div><div class="after"></div>`;
    modalEl.classList.remove('hidden');
    const opts = modalBox.querySelector('.opts'), fb = modalBox.querySelector('.feedback'), after = modalBox.querySelector('.after');
    let done = false;
    options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.innerHTML = `${String.fromCharCode(65 + i)}．${o.label}`;
      b.addEventListener('click', () => {
        if (done) return;
        if (o.correct) {
          done = true;
          b.classList.add('right');
          fb.className = 'feedback good';
          fb.innerHTML = o.feedback || '';
          audio.chime();
          const btn = document.createElement('button');
          btn.className = 'primary'; btn.textContent = '繼續';
          btn.addEventListener('click', () => { audio.click(); closeModal(); res(o); });
          if (onCorrect) onCorrect(after);
          after.appendChild(btn);
        } else {
          b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong');
          fb.className = 'feedback';
          fb.innerHTML = o.feedback || '再想想。';
          audio.wrong();
        }
      });
      opts.appendChild(b);
    });
  });
}

// ================= 排序遊戲 =================
/** items: [{id, glyph, label, phrase}]（正確次序） */
export function sortGame({ title, lead, items, hints = {} }) {
  return new Promise(res => {
    const shuffled = [...items].sort(() => Math.random() - 0.5);
    // 保證不是原本次序
    if (shuffled.every((x, i) => x.id === items[i].id)) shuffled.reverse();
    modalBox.innerHTML = `<h2><span class="seal">重建</span>${title}</h2><p class="lead">${lead}</p>
      <div class="sortPool"></div><div class="sortSlots"></div><div class="feedback"></div>
      <div style="text-align:center"><button class="primary" id="sortCheck" disabled>確定次序</button></div>`;
    modalEl.classList.remove('hidden');
    const pool = modalBox.querySelector('.sortPool'), slotsEl = modalBox.querySelector('.sortSlots'), fb = modalBox.querySelector('.feedback'), check = modalBox.querySelector('#sortCheck');
    const slots = items.map(() => null);
    const cards = {};
    let solved = false;
    shuffled.forEach(it => {
      const c = document.createElement('button');
      c.className = 'sortCard';
      c.innerHTML = `<div class="sortGlyph">${it.glyph}</div><div>${it.label}</div>`;
      c.addEventListener('click', () => {
        const i = slots.indexOf(null);
        if (i < 0 || solved) return;
        slots[i] = it; audio.click(); render();
      });
      pool.appendChild(c); cards[it.id] = c;
    });
    function render() {
      slotsEl.innerHTML = '';
      slots.forEach((s, i) => {
        if (i > 0) { const a = document.createElement('div'); a.className = 'sortArrow'; a.textContent = '→'; slotsEl.appendChild(a); }
        const d = document.createElement('div');
        d.className = 'sortSlot' + (s ? ' filled' : '');
        d.innerHTML = `<div class="num">第${'一二三四五六'[i]}步</div>` + (s ? `<div class="sortGlyph">${s.glyph}</div><div>${s.label}</div>` : '');
        if (s) d.addEventListener('click', () => { if (solved) return; slots[i] = null; audio.click(); render(); });
        slotsEl.appendChild(d);
      });
      for (const id in cards) cards[id].classList.toggle('used', slots.some(s => s && s.id === id));
      check.disabled = slots.includes(null);
      fb.textContent = '';
    }
    render();
    check.addEventListener('click', () => {
      const els = slotsEl.querySelectorAll('.sortSlot');
      let ok = true;
      let firstBad = -1;
      slots.forEach((s, i) => {
        const good = s.id === items[i].id;
        els[i].classList.toggle('good', good); els[i].classList.toggle('bad', !good);
        if (!good) { ok = false; if (firstBad < 0) firstBad = i; }
      });
      if (!ok) {
        audio.wrong();
        fb.className = 'feedback';
        const s = slots[firstBad];
        fb.textContent = hints[s.id] || '次序不太對。想想：一個人在山中，怎樣才會由坐下，一步步走到回家？';
        return;
      }
      audio.chime();
      solved = true;
      slots.forEach((s, i) => { els[i].innerHTML += `<div class="phrase">${s.phrase}</div>`; els[i].style.cursor = 'default'; });
      fb.className = 'feedback good';
      fb.textContent = '你重建了柳宗元過去遊山的模式。';
      check.textContent = '看看當時的情景';
      // 以複製節點移除原本的「檢查」監聽器
      check.replaceWith(check.cloneNode(true));
      modalBox.querySelector('#sortCheck').addEventListener('click', () => { audio.click(); closeModal(); res(); });
    });
  });
}

// ================= 箭嘴方向選擇 =================
export function arrowPick({ prompt, options }) {
  return new Promise(res => {
    const wrap = document.createElement('div');
    wrap.id = 'arrowPick';
    wrap.innerHTML = `<div class="arrowPrompt">${prompt}</div>`;
    const fb = document.createElement('div'); fb.className = 'arrowPrompt'; fb.style.fontSize = '18px'; fb.style.minHeight = '1.5em';
    options.forEach(o => {
      const b = document.createElement('button');
      b.innerHTML = `<span class="big">${o.arrow}</span><span>${o.label}</span>`;
      b.addEventListener('click', () => {
        if (o.correct) { audio.chime(); wrap.remove(); res(o); }
        else { audio.wrong(); b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong'); fb.textContent = o.feedback; }
      });
      wrap.appendChild(b);
    });
    wrap.appendChild(fb);
    document.body.appendChild(wrap);
  });
}

// ================= 大按鈕 =================
export function bigAction(label) {
  return new Promise(res => {
    const wrap = $('bigAction'), b = $('bigActionBtn');
    b.textContent = label;
    wrap.classList.remove('hidden');
    const h = () => { b.removeEventListener('click', h); wrap.classList.add('hidden'); audio.click(); res(); };
    b.addEventListener('click', h);
  });
}

// ================= 工具欄 =================
export function toolbar(tools, onPick) {
  const el = $('toolSlot');
  el.innerHTML = '<span style="font-size:13px;color:#b9ab8f">工具</span>';
  if (!tools.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  tools.forEach(t => {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.dataset.id = t.id;
    b.addEventListener('click', () => { audio.click(); onPick(t.id); });
    el.appendChild(b);
  });
}
export function toolbarActive(id) {
  $('toolSlot').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.id === id));
}

// ================= 日誌 =================
const journal = { '遊蹤': [], '活動': [], '景物': [], '心境': [], '字詞': [] };
const litPhrases = new Set();
export function journalAdd(cat, text, quote = '', { silent = false } = {}) {
  if (!journal[cat]) journal[cat] = [];
  if (journal[cat].some(e => e.text === text)) return;
  journal[cat].push({ text, quote });
  if (quote) litPhrases.add(quote);
  if (!silent) toast(`日誌已更新：${cat}`);
  $('btnJournal').classList.remove('hidden');
}
export function litText(quote) { litPhrases.add(quote); }
export function journalData() { return journal; }

function renderFullText() {
  // 將已解鎖的句子標亮
  let html = '';
  for (const para of FULL_TEXT) {
    let p = '';
    for (const sentence of para) {
      const lit = [...litPhrases].some(q => q && (sentence.includes(q) || q.includes(sentence.replace(/[，。；]/g, ''))));
      p += lit ? `<span class="lit">${sentence}</span>` : sentence;
    }
    html += `<p>${p}</p>`;
  }
  return `<div class="fullText">${html}</div>`;
}
export function openJournal(startTab = '遊蹤') {
  const tabs = [...JOURNAL_CATS, '原文'];
  const draw = (tab) => {
    let body;
    if (tab === '原文') body = `<p style="font-size:14px;color:#8a7555">你在旅程中親身重建的句子會被標亮。</p>` + renderFullText();
    else {
      const list = journal[tab] || [];
      body = `<ul class="journalList">${list.length ? list.map(e => `<li>${e.quote ? `<span class="q">「${e.quote}」</span>` : ''}${e.text}</li>`).join('') : '<li class="empty">尚未有紀錄。</li>'}</ul>`;
    }
    modalBox.innerHTML = `<h2><span class="seal">日誌</span>尋找柳宗元</h2>
      <div class="journalTabs">${tabs.map(t => `<button data-tab="${t}" class="${t === tab ? 'active' : ''}">${t}</button>`).join('')}</div>${body}
      <button class="close" data-close>×</button>`;
    modalBox.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { audio.click(); draw(b.dataset.tab); }));
    modalBox.querySelector('[data-close]').addEventListener('click', () => { audio.click(); closeModal(); });
  };
  modalEl.classList.remove('hidden');
  draw(startTab);
  return new Promise(res => { modalOnClose = res; });
}
export function fullTextHTML() { return renderFullText(); }

// ================= 地圖 =================
const MAP_NODES = {
  home: { x: 520, y: 330, name: '柳宅（永州城）' },
  forest: { x: 610, y: 170, name: '永州山林' },
  temple: { x: 430, y: 250, name: '法華寺西亭' },
  ferry: { x: 330, y: 290, name: '湘江渡口' },
  creek: { x: 190, y: 250, name: '染溪' },
  xishan: { x: 110, y: 130, name: '？' },
};
let mapState = { visited: ['home'], xishanKnown: false, route: [] };
export function mapVisit(id) { if (!mapState.visited.includes(id)) mapState.visited.push(id); }
export function mapRoute(ids) { mapState.route = ids; }
export function mapKnowXishan() { mapState.xishanKnown = true; }

function mapSVG(pickIds = []) {
  const n = MAP_NODES;
  const nodes = Object.entries(n).map(([id, v]) => {
    const visited = mapState.visited.includes(id);
    let name = v.name;
    if (id === 'xishan') name = mapState.xishanKnown ? '西山' : (mapState.visited.includes('temple') ? '那座奇異的山' : '？');
    const pick = pickIds.includes(id);
    return `<g class="mapNode ${pick ? 'pick' : ''}" data-id="${id}">
      ${pick ? `<circle class="ring" cx="${v.x}" cy="${v.y}" r="16" fill="none" stroke="#b3372b" stroke-width="2"/>` : ''}
      <circle cx="${v.x}" cy="${v.y}" r="${visited ? 8 : 6}" fill="${visited ? '#b3372b' : '#f5ecd9'}" stroke="#3a2a1c" stroke-width="2"/>
      <text x="${v.x}" y="${v.y - 16}" text-anchor="middle" font-size="17" fill="#2a2018" font-family="LXGW WenKai TC, serif">${name}</text>
      ${pick ? `<circle cx="${v.x}" cy="${v.y}" r="26" fill="transparent"/>` : ''}
    </g>`;
  }).join('');
  const route = mapState.route.map(id => n[id]).filter(Boolean);
  const routePath = route.length > 1 ? `<polyline points="${route.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#b3372b" stroke-width="3" stroke-dasharray="8 6" opacity=".85"/>` : '';
  return `<svg viewBox="0 0 720 420" xmlns="http://www.w3.org/2000/svg">
    <rect width="720" height="420" fill="#efe3c8"/>
    <g opacity=".5" stroke="#6b5a44" fill="none" stroke-width="1.3">
      <path d="M560 120 l20 -30 l22 30 M600 110 l18 -26 l20 26 M640 140 l16 -22 l18 22"/>
      <path d="M640 230 l18 -26 l20 26 M600 240 l14 -20 l16 20"/>
      <path d="M470 180 l14 -18 l16 18 M500 170 l12 -16 l14 16"/>
      <path d="M150 360 l14 -18 l16 18 M70 300 l14 -20 l16 20 M230 350 l12 -16 l14 16"/>
    </g>
    <path d="M60 160 L95 70 L110 95 L125 60 L150 150 Z" fill="#cdbd98" stroke="#5a4a36" stroke-width="2" opacity="${mapState.visited.includes('temple') ? 1 : .35}"/>
    <path d="M300 0 C 320 90, 280 160, 320 230 S 360 350, 330 420" fill="none" stroke="#7fa3b5" stroke-width="26" opacity=".75"/>
    <text x="300" y="60" font-size="18" fill="#3f6275" font-family="LXGW WenKai TC, serif" transform="rotate(80 300 60)">湘江</text>
    <path d="M318 262 C 280 250, 240 270, 200 250 S 150 200, 120 150" fill="none" stroke="#8fb3c0" stroke-width="7" opacity="${mapState.visited.includes('ferry') ? .9 : .35}"/>
    <rect x="495" y="305" width="60" height="44" fill="none" stroke="#6b5a44" stroke-width="2" stroke-dasharray="4 3"/>
    ${routePath}
    ${nodes}
    <text x="700" y="405" text-anchor="end" font-size="13" fill="#8a7555" font-family="LXGW WenKai TC, serif">永州簡圖（柳先生手繪）</text>
  </svg>`;
}
export function openMap({ pick = null, title = '永州簡圖', lead = '' } = {}) {
  return new Promise(res => {
    const pickIds = pick ? pick.options.map(o => o.id) : [];
    modalBox.innerHTML = `<h2><span class="seal">地圖</span>${title}</h2>${lead ? `<p class="lead">${lead}</p>` : ''}<div class="mapWrap">${mapSVG(pickIds)}</div><div class="feedback"></div>${pick ? '' : '<button class="close" data-close>×</button>'}`;
    modalEl.classList.remove('hidden');
    const fb = modalBox.querySelector('.feedback');
    if (!pick) {
      modalOnClose = res;
      modalBox.querySelector('[data-close]').addEventListener('click', () => { audio.click(); closeModal(); });
      return;
    }
    modalBox.querySelectorAll('.mapNode.pick').forEach(g => {
      g.addEventListener('click', () => {
        const o = pick.options.find(x => x.id === g.dataset.id);
        if (o.correct) { audio.chime(); fb.className = 'feedback good'; fb.textContent = o.feedback || ''; setTimeout(() => { closeModal(); res(o); }, 1400); }
        else { audio.wrong(); fb.className = 'feedback'; fb.textContent = o.feedback || '再想想僕人的話。'; }
      });
    });
  });
}

// ================= 按鈕 =================
export function initButtons({ onHint }) {
  $('btnJournal').addEventListener('click', () => { audio.click(); $('btnJournal').classList.remove('new'); openJournal(); });
  $('btnMap').addEventListener('click', () => { audio.click(); $('btnMap').classList.remove('new'); openMap(); });
  $('btnHint').addEventListener('click', () => { audio.click(); onHint(hintText); });
  $('btnSound').addEventListener('click', () => {
    const on = audio.toggle();
    $('btnSound').classList.toggle('off', !on);
  });
}
export function unlockButton(id) { const b = $(id); b.classList.remove('hidden'); b.classList.add('new'); }
