// 程序化聲音：風、水、鳥、蟲、古琴式撥弦音樂與音效（Web Audio，無需音檔）

class AudioSys {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.levels = { wind: 0, water: 0, birds: 0, crickets: 0 };
    this.mode = null;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(ctx.destination);
    // 殘響
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.45;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);

    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0; this.musicBus.connect(this.master); this.musicBus.connect(this.reverb);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 1; this.ambBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.8; this.sfxBus.connect(this.master); this.sfxBus.connect(this.reverb);

    this.noiseBuf = this.makeNoise(3);
    this.brownBuf = this.makeNoise(3, true);

    // 風
    const wind = ctx.createBufferSource(); wind.buffer = this.brownBuf; wind.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 500; this.windF.Q.value = 1.5;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    wind.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.ambBus); wind.start();
    // 水
    const water = ctx.createBufferSource(); water.buffer = this.noiseBuf; water.loop = true;
    this.waterF = ctx.createBiquadFilter(); this.waterF.type = 'bandpass'; this.waterF.frequency.value = 900; this.waterF.Q.value = 0.7;
    this.waterG = ctx.createGain(); this.waterG.gain.value = 0;
    water.connect(this.waterF); this.waterF.connect(this.waterG); this.waterG.connect(this.ambBus); water.start();

    this.tick = this.tick.bind(this);
    this.nextNote = 0; this.nextBird = 0; this.nextCricket = 0;
    this.timer = setInterval(this.tick, 60);
  }
  impulse(sec) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    return buf;
  }
  makeNoise(sec, brown = false) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  toggle() {
    this.enabled = !this.enabled;
    if (this.ctx) this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, this.ctx.currentTime, 0.2);
    return this.enabled;
  }
  /** 環境聲：{wind, water, birds, crickets, waterFreq} 0..1 */
  ambience(o, ramp = 2) {
    Object.assign(this.levels, o);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (o.wind !== undefined) this.windG.gain.setTargetAtTime(o.wind * 0.5, t, ramp / 3);
    if (o.water !== undefined) this.waterG.gain.setTargetAtTime(o.water * 0.12, t, ramp / 3);
    if (o.waterFreq) this.waterF.frequency.setTargetAtTime(o.waterFreq, t, ramp / 3);
  }
  /** 音樂模式：null | 'yongzhou' | 'xishan' | 'dusk' | 'final' */
  music(mode, ramp = 3) {
    this.mode = mode;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(mode ? 0.55 : 0, t, ramp / 3);
    if (this.pad) { const p = this.pad; this.pad = null; p.gain.gain.setTargetAtTime(0, t, 1.5); setTimeout(() => p.oscs.forEach(o => o.stop()), 6000); }
    if (mode === 'xishan' || mode === 'final' || mode === 'dusk') {
      const root = mode === 'xishan' ? 146.83 : mode === 'dusk' ? 130.81 : 110;
      const ratios = mode === 'dusk' ? [1, 1.5, 2, 2.4] : [1, 1.5, 2, 2.25];
      const gain = this.ctx.createGain(); gain.gain.value = 0; gain.connect(this.musicBus);
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(gain);
      const oscs = ratios.map((r, i) => { const o = this.ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = root * r; o.detune.value = (i - 1.5) * 4; o.connect(lp); o.start(); return o; });
      gain.gain.setTargetAtTime(mode === 'final' ? 0.06 : 0.045, t, 2.5);
      this.pad = { gain, oscs };
    }
  }
  tick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 風的起伏
    this.windF.frequency.setTargetAtTime(380 + Math.sin(t * 0.13) * 180 + Math.sin(t * 0.41) * 90, t, 0.5);
    if (this.levels.water > 0) this.waterG.gain.setTargetAtTime(this.levels.water * (0.1 + Math.random() * 0.05), t, 0.08);
    // 鳥鳴
    if (this.levels.birds > 0 && t > this.nextBird) {
      this.bird();
      this.nextBird = t + (2 + Math.random() * 6) / this.levels.birds;
    }
    if (this.levels.crickets > 0 && t > this.nextCricket) {
      this.cricket();
      this.nextCricket = t + 0.8 + Math.random() * 1.5;
    }
    // 音樂
    if (this.mode && t > this.nextNote) this.phrase();
  }
  phrase() {
    const t = this.ctx.currentTime;
    const S = {
      // 羽調：低沉、疏落
      yongzhou: { notes: [110, 130.81, 146.83, 164.81, 196, 220, 261.63], gap: [2.2, 4.5], len: [1, 3] },
      // 宮調：明亮、開闊
      xishan: { notes: [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25], gap: [1.6, 3.2], len: [2, 4] },
      dusk: { notes: [196, 220, 261.63, 293.66, 329.63, 392], gap: [3, 6], len: [1, 2] },
      final: { notes: [220, 246.94, 293.66, 329.63, 369.99, 440], gap: [4, 7], len: [1, 2] },
    }[this.mode];
    if (!S) { this.nextNote = t + 2; return; }
    const n = S.len[0] + Math.floor(Math.random() * (S.len[1] - S.len[0] + 1));
    let when = t + 0.05;
    let idx = Math.floor(Math.random() * S.notes.length);
    for (let i = 0; i < n; i++) {
      idx = Math.max(0, Math.min(S.notes.length - 1, idx + (Math.floor(Math.random() * 5) - 2)));
      this.pluck(S.notes[idx], when, 0.16 + Math.random() * 0.06, Math.random() < 0.3);
      when += 0.35 + Math.random() * 0.6;
    }
    this.nextNote = when + S.gap[0] + Math.random() * (S.gap[1] - S.gap[0]);
  }
  pluck(freq, when, vol = 0.18, slide = false) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, when); lp.frequency.exponentialRampToValueAtTime(700, when + 1.5);
    lp.connect(g); g.connect(this.musicBus);
    const o1 = ctx.createOscillator(); o1.type = 'triangle';
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    o1.frequency.setValueAtTime(freq, when); o2.frequency.setValueAtTime(freq * 2, when);
    if (slide) { o1.frequency.setValueAtTime(freq * 0.94, when); o1.frequency.exponentialRampToValueAtTime(freq, when + 0.25); }
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    o1.connect(lp); o2.connect(g2); g2.connect(lp);
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.008); g.gain.exponentialRampToValueAtTime(0.001, when + 3.2);
    o1.start(when); o2.start(when); o1.stop(when + 3.4); o2.stop(when + 3.4);
  }
  bird() {
    const ctx = this.ctx, t = ctx.currentTime;
    const base = 2200 + Math.random() * 1800, reps = 2 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain(); out.gain.value = 0.05 * this.levels.birds;
    if (pan) { pan.pan.value = Math.random() * 2 - 1; out.connect(pan); pan.connect(this.ambBus); pan.connect(this.reverb); } else out.connect(this.ambBus);
    for (let i = 0; i < reps; i++) {
      const w = t + i * (0.12 + Math.random() * 0.05);
      const o = ctx.createOscillator(); o.type = 'sine';
      const g = ctx.createGain(); g.gain.value = 0;
      o.frequency.setValueAtTime(base, w); o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), w + 0.06);
      g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(1, w + 0.01); g.gain.exponentialRampToValueAtTime(0.001, w + 0.09);
      o.connect(g); g.connect(out); o.start(w); o.stop(w + 0.1);
    }
  }
  cricket() {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.018 * this.levels.crickets; out.connect(this.ambBus);
    for (let i = 0; i < 3; i++) {
      const w = t + i * 0.07;
      const o = ctx.createOscillator(); o.frequency.value = 4400 + Math.random() * 200;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(1, w + 0.01); g.gain.linearRampToValueAtTime(0, w + 0.05);
      o.connect(g); g.connect(out); o.start(w); o.stop(w + 0.06);
    }
  }
  // -------- 音效 --------
  tone(freq, dur, { type = 'sine', vol = 0.15, when = 0, slideTo } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, { freq = 1000, q = 1, vol = 0.3, type = 'bandpass', when = 0, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  click() { this.tone(880, 0.08, { type: 'triangle', vol: 0.05 }); }
  blip() { this.tone(660, 0.05, { type: 'sine', vol: 0.02 }); }
  bell() { this.tone(523.25, 2.5, { vol: 0.07 }); this.tone(1046.5, 1.8, { vol: 0.03 }); this.tone(1568, 1.2, { vol: 0.015 }); }
  chime() { this.tone(587.33, 1.2, { vol: 0.08 }); this.tone(880, 1.4, { vol: 0.07, when: 0.12 }); this.tone(1174.66, 1.6, { vol: 0.05, when: 0.24 }); }
  discover() { this.tone(440, 1.5, { vol: 0.07, type: 'triangle' }); this.tone(659.25, 1.8, { vol: 0.06, when: 0.15, type: 'triangle' }); }
  wrong() { this.tone(196, 0.3, { type: 'triangle', vol: 0.08, slideTo: 150 }); }
  chop() { this.noise(0.15, { freq: 1800, q: 0.8, vol: 0.5 }); this.tone(110, 0.2, { type: 'triangle', vol: 0.2, slideTo: 60 }); }
  crack() { this.noise(0.4, { freq: 600, q: 0.5, vol: 0.4 }); this.tone(80, 0.5, { type: 'triangle', vol: 0.15, slideTo: 40 }); }
  crackle() { for (let i = 0; i < 4; i++) this.noise(0.04, { freq: 2500 + Math.random() * 2000, q: 2, vol: 0.25, when: Math.random() * 0.3 }); this.noise(0.5, { freq: 300, q: 0.4, vol: 0.12, type: 'lowpass', attack: 0.1 }); }
  step() { this.noise(0.08, { freq: 400, q: 0.6, vol: 0.06, type: 'lowpass' }); }
  slip() { this.noise(0.6, { freq: 900, q: 0.4, vol: 0.3, attack: 0.02 }); for (let i = 0; i < 5; i++) this.tone(300 + Math.random() * 300, 0.08, { type: 'triangle', vol: 0.05, when: 0.1 + i * 0.12 }); }
  oar() { this.noise(0.8, { freq: 700, q: 0.5, vol: 0.18, attack: 0.25 }); }
  whoosh() { this.noise(1.6, { freq: 500, q: 0.4, vol: 0.2, attack: 0.6 }); }
  heartbeat() { this.tone(60, 0.25, { vol: 0.25, type: 'sine' }); this.tone(55, 0.25, { vol: 0.2, when: 0.22 }); }
}

export const audio = new AudioSys();
