const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../auto-update.js'), 'utf8');
const A = '1'.repeat(40), B = '2'.repeat(40);

function setup({active = false, locked = false, failed = false, version = A} = {}) {
  let now = 1000000, nextId = 0, mutation;
  const timers = new Map(), events = {}, storage = new Map(), navigations = [];
  const state = {version, failed, fetches: 0};
  function element(classes = []) {
    const values = new Set(classes);
    return {style: {}, content: A, textContent: '', setAttribute() {}, appendChild() {},
      classList: {contains: x => values.has(x), add(x) {values.add(x); mutation?.();}, remove(x) {values.delete(x); mutation?.();}}};
  }
  const title = element(active ? ['out'] : []), body = element(locked ? ['auth-locked'] : []);
  const experience = {hidden: false};
  const map = {classList: {add() {title.classList.remove('out');}, remove() {title.classList.add('out');}}};
  const document = {hidden: false, body, querySelector: s => s.startsWith('meta') ? element() : element(),
    getElementById: id => id === 'title' ? title : id === 'experience' ? experience : null,
    createElement: () => element(), addEventListener: (name, fn) => {events[name] = fn;}};
  const timeout = (fn, delay) => {const id = ++nextId; timers.set(id, {fn, at: now + delay}); return id;};
  const context = {document, navigator: {onLine: true}, URL, AbortController,
    Date: {now: () => now}, location: {href: 'https://example.test/?teacher=1', replace: u => navigations.push(u)},
    sessionStorage: {getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v)},
    MutationObserver: class {constructor(fn) {mutation = fn;} observe() {}},
    window: {addEventListener: (name, fn) => {events[name] = fn;}},
    setTimeout: timeout, clearTimeout: id => timers.delete(id), setInterval: fn => {events.interval = fn;},
    fetch: async (_, options) => {state.fetches++; assert.equal(options.cache, 'no-store'); if (state.failed) throw Error('offline'); return {ok: true, json: async () => ({version: state.version})};}};
  vm.runInNewContext(source, context);
  async function settle() {for (let i = 0; i < 8; i++) await Promise.resolve();}
  async function advance(ms) {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) {timers.delete(id); t.fn();}
    await settle();
  }
  async function check() {await advance(60000); events.interval(); await settle();}
  return {state, context, title, map, body, document, events, storage, navigations, settle, advance, check};
}
(async () => {
  let t = setup(); await t.settle(); await t.advance(5000); assert.equal(t.navigations.length, 0);
  t.state.version = B; await t.check(); await t.advance(2001);
  assert.equal(t.navigations.length, 1); assert(t.navigations[0].includes('teacher=1'));
  assert.equal(new URL(t.navigations[0]).searchParams.get('_xishan_release'), B);
  t = setup({active: true, version: B}); await t.settle(); await t.advance(5000); assert.equal(t.navigations.length, 0);
  t.map.classList.add('on'); await t.advance(1000); t.map.classList.remove('on'); await t.advance(3000); assert.equal(t.navigations.length, 0);
  t.map.classList.add('on'); await t.advance(2001); assert.equal(t.navigations.length, 1);
  t = setup({locked: true, version: B}); await t.settle(); await t.advance(5000); assert.equal(t.navigations.length, 0);
  t.body.classList.remove('auth-locked'); await t.advance(2001); assert.equal(t.navigations.length, 1);
  t = setup({failed: true}); await t.settle(); await t.advance(5000); assert.equal(t.navigations.length, 0);
  t.state.failed = false; t.state.version = 'invalid'; await t.check(); await t.advance(3000); assert.equal(t.navigations.length, 0);
  t = setup({version: B}); await t.settle(); t.document.hidden = true; t.events.visibilitychange(); await t.advance(3000); assert.equal(t.navigations.length, 0);
  t.document.hidden = false; t.events.visibilitychange(); await t.advance(2001); assert.equal(t.navigations.length, 1);
  t = setup({version: B}); t.storage.set('xishan.updateAttempt', JSON.stringify({version: B, time: 1000000})); await t.settle(); await t.advance(5000); assert.equal(t.navigations.length, 0);
  console.log('PASS: unchanged release, automatic update, active-chapter deferral, countdown cancellation, login gating, offline/invalid response, visibility resume, redirect-loop protection');
})().catch(error => {console.error(error); process.exitCode = 1;});
