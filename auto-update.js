/* Small release checks; apply updates only between chapters. */
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="xishan-release"]');
  var current = meta && meta.content;
  if (!/^[0-9a-f]{40}$/.test(current || '')) return;
  var pending = null, busy = false, timer = null, lastCheck = 0;
  var note = document.createElement('div');
  note.id = 'release-status';
  note.setAttribute('role', 'status');
  note.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:9999;max-width:88vw;padding:10px 16px;border:1px solid #b99a61;border-radius:8px;background:#211b14;color:#fff5da;font:15px/1.5 sans-serif;text-align:center;pointer-events:none;display:none';
  document.body.appendChild(note);
  var foot = document.querySelector('.titleNote');
  if (foot) {
    var label = document.createElement('span');
    label.style.cssText = 'display:block;font-size:11px;opacity:.65;margin-top:6px';
    label.textContent = '版本 ' + current.slice(0, 8);
    foot.appendChild(label);
  }
  function safe() {
    if (document.hidden || document.body.classList.contains('auth-locked')) return false;
    return (function () {
      var el = document.getElementById('title');
      var experience = document.getElementById('experience');
      return experience && !experience.hidden && el && !el.classList.contains('out') && !el.classList.contains('hidden');
    })();
  }
  function recentlyRetried(version) {
    try {
      var previous = JSON.parse(sessionStorage.getItem('xishan.updateAttempt') || 'null');
      return previous && previous.version === version && Date.now() - previous.time < 300000;
    } catch (_) { return false; }
  }
  function applyWhenSafe() {
    if (!pending) return;
    var ready = safe();
    note.style.display = document.hidden || document.body.classList.contains('auth-locked') ? 'none' : 'block';
    note.textContent = ready ? '發現新版本，正在自動更新…' : '已有新版本，返回首頁時會自動更新。';
    if (!ready) {
      clearTimeout(timer); timer = null;
      return;
    }
    if (timer || recentlyRetried(pending)) return;
    timer = setTimeout(function () {
      timer = null;
      if (!safe() || navigator.onLine === false) return;
      try { sessionStorage.setItem('xishan.updateAttempt', JSON.stringify({version: pending, time: Date.now()})); } catch (_) {}
      var url = new URL(location.href);
      url.searchParams.set('_xishan_release', pending);
      location.replace(url.href);
    }, 2000);
  }
  async function check() {
    if (busy || document.hidden || navigator.onLine === false || Date.now() - lastCheck < 10000) return;
    busy = true; lastCheck = Date.now();
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 8000);
    try {
      var response = await fetch(new URL('./release.json', location.href).href, {cache: 'no-store', signal: controller.signal});
      if (!response.ok) return;
      var release = await response.json();
      if (!/^[0-9a-f]{40}$/.test(release.version || '')) return;
      pending = release.version !== current ? release.version : null;
      if (!pending) { clearTimeout(timer); timer = null; note.style.display = 'none'; }
      else applyWhenSafe();
    } catch (_) { /* Offline or unavailable: keep the current lesson running. */ }
    finally { clearTimeout(timeout); busy = false; }
  }
  new MutationObserver(applyWhenSafe).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['class']});
  document.addEventListener('visibilitychange', function () { applyWhenSafe(); if (!document.hidden) check(); });
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  window.addEventListener('online', check);
  setInterval(check, 60000);
  check();
})();
