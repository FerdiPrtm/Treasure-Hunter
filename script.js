/* =========================================================================
   TREASURE HUNTER — script.js
   Pixel Adventure Fantasy — HTML5 Canvas game (Vanilla JS, ES6 classes)

   Architecture (each concern separated & commented):
     Utils / Tween / ObjectPool
     Storage            (LocalStorage save/load)
     Audio              (Web Audio synth SFX + procedural BGM)
     Input              (keyboard, mouse, touch joystick)
     Sprites            (procedural sprite atlas, no external assets)
     ParticleSystem     (object-pooled particles)
     FloatingText       (pooled floating damage/score text)
     Camera             (follow, shake, zoom, flash)
     Weather            (sunny / rain / night / fog / lightning)
     Map                (parallax bg + tiles + animated water/grass + collision grid)
     Player             (move, sprint, dash, attack, leveling, animations)
     Enemy (base) + Slime, Bat, Skeleton, Goblin, Ghost
     Boss (Treant, Dragon) + Projectile
     Treasure           (coin, diamond, ruby, emerald, golden chest)
     PowerUp            (speed, shield, magnet, double score, heal)
     Portal             (level exit)
     UI                 (DOM overlays, HUD, toasts, minimap)
     Achievements
     Game               (state machine + main loop)
   ========================================================================= */

'use strict';

/* =========================================================================
   SECTION 0 — BOOT
   ========================================================================= */
window.addEventListener('DOMContentLoaded', () => {
  const g = new Game();
  window.__game = g; // handy for debugging in console
  g.init();
});

/* =========================================================================
   SECTION 1 — CONSTANTS & CONFIG
   ========================================================================= */
const CFG = {
  TILE: 32,
  FIXED_DT: 1 / 60,                 // fixed timestep for simulation
  BASE_WORLD: 1800,                 // level 1 world size (square)
  WORLD_GROWTH: 260,                // extra px per level
  MAX_WORLD: 4200,
  COMBAT_TIMEOUT: 2.6,              // seconds to keep combo alive
  POWERUP_DURATION: 10,             // seconds a power-up lasts
  POWERUP_INTERVAL: [13, 22],       // random respawn window
  WEATHER_CHANGE: [40, 75],         // random weather/event timer
  BOSS_LEVELS: [5, 10],
  LEVELS: 10,
};

const TREASURE_VALUES = {
  coin: 10, diamond: 50, ruby: 100, emerald: 150, chest: 500,
};

const PALETTE = {
  g: '#3d9a3f', G: '#2e7d32', d: '#256c2a', l: '#6fbf4f', D: '#1b5e20', // greens
  w: '#f5e9c8', W: '#e8d6a3', b: '#7a4d1e', B: '#5b3a16', o: '#ffd54a', // wood/cream/gold
  r: '#e53935', R: '#b71c1c', p: '#ab47bc', P: '#7b1fa2', k: '#263238',
  y: '#fdd835', Y: '#f9a825', c: '#4dd0e1', C: '#00acc1', s: '#9e9e9e',
  t: '#80cbc4', n: '#ffffff', u: '#455a64', m: '#a1887f', f: '#cfd8dc',
  e: '#66bb6a', i: '#26a69a', x: '#e65100', z: '#1a237e',
};

/* =========================================================================
   SECTION 2 — UTILS (math / easing / pool)
   ========================================================================= */
const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a, b) => a + Math.random() * (b - a),
  randInt: (a, b) => Math.floor(U.rand(a, b + 1)),
  pick: (arr) => arr[(Math.random() * arr.length) | 0],
  dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
  dist2: (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; },
  angTo: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1),
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  now: () => performance.now() / 1000,
};

/** Simple tween runner — animates a property over time with easing. */
class Tween {
  constructor() { this.list = []; }
  add(obj, prop, from, to, dur, ease, onDone) {
    this.list.push({ obj, prop, from, to, dur, t: 0, ease: ease || U.easeInOut, onDone });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const k = tw.dur <= 0 ? 1 : U.clamp(tw.t / tw.dur, 0, 1);
      tw.obj[tw.prop] = U.lerp(tw.from, tw.to, tw.ease(k));
      if (k >= 1) { this.list.splice(i, 1); if (tw.onDone) tw.onDone(); }
    }
  }
  clear() { this.list.length = 0; }
}

/** Generic object pool to avoid GC pressure (used for particles). */
class ObjectPool {
  constructor(factory, size) {
    this.factory = factory;
    this.items = new Array(size);
    for (let i = 0; i < size; i++) this.items[i] = factory();
  }
  get() {
    for (let i = 0; i < this.items.length; i++) if (!this.items[i].alive) return this.items[i];
    return this.items.push(this.factory()) && this.items[this.items.length - 1]; // grow if needed
  }
}

/* =========================================================================
   SECTION 3 — STORAGE (LocalStorage persistence)
   ========================================================================= */
const Storage = {
  key: 'treasureHunter_save_v1',
  _data: null,
  defaults() {
    return { highScore: 0, level: 1, coin: 0, sound: true, music: true, shake: true, particles: true,
             achievements: [], daily: { day: '', claimed: false }, totalKills: 0, totalCoin: 0, dashCount: 0 };
  },
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      this._data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
    } catch (e) { this._data = this.defaults(); }
    return this._data;
  },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this._data)); } catch (e) {} },
  get(k) { return this._data ? this._data[k] : null; },
  set(k, v) { if (this._data) { this._data[k] = v; this.save(); } },
  unlockAch(id) {
    if (!this._data) return false;
    if (this._data.achievements.includes(id)) return false;
    this._data.achievements.push(id);
    this.save();
    return true;
  },
  reset() { localStorage.removeItem(this.key); this._data = this.defaults(); this.save(); },
};

/* =========================================================================
   SECTION 4 — AUDIO (Web Audio synthesis — zero external files)
   ========================================================================= */
class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.muted = false;
    this.musicPlaying = false;
    this.musicTimer = null;
    this.musicStep = 0;
    this.nextNote = 0;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.28;
    this.musicGain.connect(this.master);
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
    return this.muted;
  }
  /* ------- low-level helpers ------- */
  tone(freq, dur, type, vol, opts = {}) {
    if (!this.ctx || this.muted || !Storage.get('sound')) return;
    const t0 = this.ctx.currentTime + (opts.delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, opts.slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  noise(dur, vol, opts = {}) {
    if (!this.ctx || this.muted || !Storage.get('sound')) return;
    const t0 = this.ctx.currentTime + (opts.delay || 0);
    const size = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = opts.filter || 'lowpass'; f.frequency.value = opts.freq || 1200;
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t0); src.stop(t0 + dur);
  }
  /* ------- game SFX ------- */
  coin() { this.tone(920, 0.07, 'square', 0.16); this.tone(1380, 0.14, 'square', 0.16, { delay: 0.06 }); }
  diamond() { this.tone(700, 0.08, 'sine', 0.2); this.tone(1050, 0.08, 'sine', 0.2, { delay: 0.07 }); this.tone(1400, 0.18, 'sine', 0.2, { delay: 0.14 }); }
  attack() { this.noise(0.09, 0.14, { freq: 2600, filter: 'bandpass' }); this.tone(300, 0.1, 'sawtooth', 0.08, { slide: 120 }); }
  hit() { this.tone(160, 0.12, 'square', 0.18, { slide: 80 }); this.noise(0.08, 0.1); }
  hurt() { this.tone(220, 0.18, 'sawtooth', 0.2, { slide: 90 }); this.noise(0.12, 0.14, { freq: 700 }); }
  enemyDie() { this.noise(0.25, 0.22, { freq: 500 }); this.tone(420, 0.22, 'square', 0.16, { slide: 60 }); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'square', 0.18, { delay: i * 0.12 })); }
  lose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, { delay: i * 0.18 })); }
  hover() { this.tone(640, 0.04, 'sine', 0.06); }
  click() { this.tone(520, 0.07, 'square', 0.12); }
  dash() { this.tone(240, 0.14, 'sawtooth', 0.12, { slide: 720 }); }
  powerup() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.16, { delay: i * 0.07 })); }
  levelup() { [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.16, 'square', 0.15, { delay: i * 0.08 })); }
  portal() { this.tone(320, 0.6, 'sine', 0.18, { slide: 980 }); }
  lightning() { this.noise(0.5, 0.3, { freq: 3000, filter: 'highpass' }); }
  bossRoar() { this.tone(90, 0.7, 'sawtooth', 0.3, { slide: 50 }); this.noise(0.5, 0.25, { freq: 250 }); }
  bossDie() { this.noise(0.9, 0.35, { freq: 300 }); this.tone(60, 0.9, 'sawtooth', 0.3, { slide: 20 }); }
  explosion() { this.noise(0.4, 0.3, { freq: 400 }); this.tone(120, 0.4, 'square', 0.2, { slide: 30 }); }
  /* ------- procedural background music ------- */
  startMusic() {
    this.ensure();
    if (this.musicPlaying || !this.ctx) return;
    this.musicPlaying = true;
    this.musicStep = 0;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this._scheduleMusic(), 120);
  }
  stopMusic() {
    this.musicPlaying = false;
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
  _scheduleMusic() {
    if (!this.ctx || this.muted || !Storage.get('music')) return;
    // gentle pentatonic arpeggio — calm adventure feel
    const scale = [262, 294, 330, 392, 440, 523, 587, 659];
    while (this.nextNote < this.ctx.currentTime + 0.5) {
      if (this.musicStep % 2 === 0) {
        const freq = scale[(Math.floor(Math.random() * scale.length * 0.7)) % scale.length];
        this._musicNote(freq, 0.4, 0.12);
      } else {
        const base = scale[Math.floor(Math.random() * 3)] / 2;
        this._musicNote(base, 0.7, 0.2, 'triangle');
      }
      this._musicNote(scale[this.musicStep % scale.length] / 2, 0.9, 0.05, 'sine');
      this.nextNote += 0.24;
      this.musicStep++;
    }
  }
  _musicNote(freq, dur, vol, type) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, this.nextNote);
    g.gain.exponentialRampToValueAtTime(vol, this.nextNote + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, this.nextNote + dur);
    o.connect(g); g.connect(this.musicGain);
    o.start(this.nextNote); o.stop(this.nextNote + dur + 0.02);
  }
}

/* =========================================================================
   SECTION 5 — INPUT (keyboard / mouse / virtual joystick)
   ========================================================================= */
class Input {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.mouse = { x: 0, y: 0, down: false, justPressed: false };
    this.joy = { active: false, dx: 0, dy: 0 };
    this._joyId = null;
    this.bind();
  }
  isDown(...codes) { for (const c of codes) if (this.keys[c]) return true; return false; }
  bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.game.onKeyDown(e);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.down = true; this.mouse.justPressed = true; }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    // ---- virtual joystick (left thumb region) ----
    const joy = document.getElementById('joystick');
    const knob = document.getElementById('joy-knob');
    const base = document.getElementById('joy-base');
    const R = 46; // max knob travel
    let cx = 0, cy = 0;
    const setJoy = (clientX, clientY) => {
      let dx = clientX - cx, dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
      knob.style.left = (50 + (dx / (2 * R)) * 100) + '%';
      knob.style.top = (50 + (dy / (2 * R)) * 100) + '%';
      this.joy.dx = dx / R;
      this.joy.dy = dy / R;
    };
    joy.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.joy.active = true;
      this._joyId = e.pointerId;
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      knob.style.left = '50%'; knob.style.top = '50%';
      joy.setPointerCapture(e.pointerId);
      setJoy(e.clientX, e.clientY);
    });
    joy.addEventListener('pointermove', (e) => {
      if (this.joy.active && e.pointerId === this._joyId) setJoy(e.clientX, e.clientY);
    });
    const release = (e) => {
      if (e.pointerId === this._joyId) {
        this.joy.active = false; this.joy.dx = 0; this.joy.dy = 0;
        knob.style.left = '50%'; knob.style.top = '50%';
        this._joyId = null;
      }
    };
    joy.addEventListener('pointerup', release);
    joy.addEventListener('pointercancel', release);
    // ---- touch buttons ----
    this._bindBtn('btn-dash', () => this.game.playerDash());
    this._bindBtn('btn-attack', () => this.game.playerAttack());
    this._bindBtn('btn-sprint', () => {}, 'toggle');
  }
  _bindBtn(id, onTap, mode) {
    const el = document.getElementById(id);
    let held = false;
    const down = (e) => { e.preventDefault(); if (mode === 'toggle') { held = !held; this.keys['ShiftLeft'] = held; } else { held = true; onTap(); } };
    const up = (e) => { e.preventDefault(); held = false; if (mode === 'toggle') this.keys['ShiftLeft'] = false; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
  }
  /* Returns normalized movement vector (keyboard + joystick combined). */
  moveVector() {
    let x = 0, y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
    if (this.isDown('KeyS', 'ArrowDown')) y += 1;
    if (this.joy.active) { x += this.joy.dx; y += this.joy.dy; }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }
  attacking() { return this.keys['ControlLeft'] || this.keys['ControlRight']; }
  get sprinting() { return this.isDown('ShiftLeft', 'ShiftRight'); }
  endFrame() { this.mouse.justPressed = false; }
}

/* =========================================================================
   SECTION 6 — SPRITES (procedural pixel-art atlas, no downloads)
   ========================================================================= */
function pixelSprite(grid, palette, scale) {
  const h = grid.length, w = grid[0].length;
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = grid[y][x];
    if (ch === '.' || ch === ' ') continue;
    g.fillStyle = palette[ch] || '#f0f';
    g.fillRect(x * scale, y * scale, scale, scale);
  }
  return c;
}

const Sprites = (() => {
  const atlas = {};
  const S = 4; // pixel scale

  // ---------- treasure sprites ----------
  atlas.coin = pixelSprite([
    '..oo..',
    '.oYYo.',
    'oYyyYo',
    'oYyyYo',
    '.oYYo.',
    '..oo..',
  ], { o: PALETTE.x, Y: PALETTE.y, y: PALETTE.Y }, S);

  atlas.diamond = pixelSprite([
    '...cc...',
    '..cCCc..',
    '.cCwwCc.',
    '.cCCCCc.',
    '..cCCc..',
    '...cc...',
  ], { c: PALETTE.C, C: PALETTE.c, w: '#ffffff' }, S);

  atlas.ruby = pixelSprite([
    '....r....',
    '...rRr...',
    '..rRwwr..',
    '..rRrrr..',
    '...rRr...',
    '....r....',
  ], { r: PALETTE.R, R: PALETTE.r, w: '#ffffff' }, S);

  atlas.emerald = pixelSprite([
    '....g....',
    '...gGg...',
    '..gGwwg..',
    '..gGggg..',
    '...gGg...',
    '....g....',
  ], { g: PALETTE.D, G: PALETTE.e, w: '#ffffff' }, S);

  atlas.chest = pixelSprite([
    '..YYYY..',
    '.YWWWWY.',
    '.YWWWWY.',
    '.YWWWWY.',
    '.YnnnnY.',
    'YYYYYYYY',
    'YYWYYWYY',
    'YYWYYWYY',
    '.YWWWWY.',
  ], { Y: PALETTE.o, W: PALETTE.W, n: PALETTE.x }, S);

  // ---------- enemy sprites ----------
  atlas.slime = pixelSprite([
    '..gggg..',
    '.ggGGgg.',
    'gGgnnGGg',
    'gGgnnGGg',
    'gGGGGGGg',
    '.gGGGGg.',
    '..gggg..',
  ], { g: PALETTE.e, G: PALETTE.G, n: PALETTE.n }, S);

  atlas.bat = pixelSprite([
    'P......P',
    'PP....PP',
    '.PPppPP.',
    '..pppp..',
    '.nnppnn.',
    '.nnppnn.',
    '..p..p..',
  ], { P: PALETTE.P, p: PALETTE.p, n: PALETTE.n }, S);

  atlas.skeleton = pixelSprite([
    '..wwww..',
    '.wwwwww.',
    '..nnnn..',
    '..wwww..',
    '.ww..ww.',
    '.ww..ww.',
    '..w..w..',
    '..w..w..',
  ], { w: PALETTE.w, n: PALETTE.n }, S);

  atlas.goblin = pixelSprite([
    '..gggg..',
    '.gGGGGg.',
    '.gGnnGg.',
    '..gggg..',
    '.gGGGGg.',
    '.g.g.g..',
  ], { g: PALETTE.e, G: PALETTE.G, n: PALETTE.n }, S);

  atlas.ghost = pixelSprite([
    '..........',
    '..ffffff..',
    '.fFffffFf.',
    '.fFffnnFf.',
    '.fFffnnFf.',
    '.ffffffff.',
    '.ffffffff.',
    '..fff.ff..',
  ], { f: PALETTE.f, F: PALETTE.m, n: PALETTE.n }, S);

  // ---------- boss sprites ----------
  atlas.treant = pixelSprite([
    '....BBBB....',
    '..BBBBBBBB..',
    '.BBBBBBBBBB.',
    '.BBnnBBnnBB.',
    '.BBnnBBnnBB.',
    '.BBBBBBBBBB.',
    '..BBBBBBBB..',
    '..BwBwBwBw..',
    '..w..w..w...',
  ], { B: PALETTE.B, n: PALETTE.x, w: PALETTE.W }, S);

  atlas.dragon = pixelSprite([
    '..zzzzzz..',
    '.zZnnZnnz.',
    '.zZnnZnnz.',
    '..zzzzzz..',
    '.zZzzzzZz.',
    '.ZzzzzzzZ.',
    '..ZzzzzZ..',
  ], { z: PALETTE.z, Z: PALETTE.i, n: PALETTE.x }, S);

  // ---------- tiles ----------
  atlas.grass = pixelSprite([
    '................',
    '.l..g...g....l..',
    '..g...G...G....g',
    'g...G..g..G.....',
    '..G..G......g..g',
    '...g....G..G....',
    '.G..g..G......g.',
    '.....G..g...g...',
    'g..g......G..G..',
    '..G..g..G..g....',
    '.g.....g.....G..',
    '..G..G....G...g.',
    '......g..g......',
    '.g..G.....G..g..',
    '..G...g..G..G...',
    '..............g.',
  ], { g: PALETTE.g, G: PALETTE.G, l: PALETTE.l }, 2);

  atlas.dirt = pixelSprite([
    'BBBBBBBBBBBBBBBB',
    'BBBbBBBBBBBBbBBB',
    'BBbBBbBBBBBBBBBB',
    'BBBBBBBBBBbBBBBB',
    'BBBBbBBBBBBBBBBB',
    'BbBBBBBBbBBBBbBB',
    'BBBBBBBBBBBBBBBB',
    'BBBbBBBBBBBBbBBB',
  ], { B: PALETTE.B, b: PALETTE.b }, 2);

  atlas.water = pixelSprite([
    'cccccccccCcccccc',
    'cCccccccccccccCc',
    'cccccccCcCcccCcc',
    'cCccCccccccccccc',
    'ccccccccCccCcccc',
    'cccCccccccccccCc',
  ], { c: PALETTE.c, C: PALETTE.C }, 2);

  // ---------- props ----------
  atlas.tree = pixelSprite([
    '....GGGGGG....',
    '..GGGGGGGGGG..',
    '.GGGDDGGDGGGG.',
    'GGGDDGGGGGGDDG',
    'GGGGGGGGDDGGGG',
    '.GGGDDGGGGGGG.',
    '..GGGGGGGGGG..',
    '....BBBBBB....',
    '.....BBBB.....',
    '.....BBBB.....',
    '.....BBBB.....',
  ], { G: PALETTE.G, D: PALETTE.d, B: PALETTE.B }, 4);

  atlas.rock = pixelSprite([
    '...ssss...',
    '.ssssssss.',
    'sbsbsbssss',
    'sssssssbsb',
    'sbsbssssss',
    'sssssbsbsb',
    '.ssssssss.',
    '...ssss...',
  ], { s: PALETTE.s, b: PALETTE.m }, 4);

  atlas.bush = pixelSprite([
    '..GGGG..',
    '.GGGGGG.',
    'GGDDGGGG',
    'GGGGGGDG',
    '.GGGGGG.',
    '..GGGG..',
  ], { G: PALETTE.G, D: PALETTE.d }, 4);

  atlas.flower = pixelSprite([
    '..n..',
    '..y..',
    '..Y..',
    '.GGG.',
    '.G.G.',
  ], { n: '#ffffff', y: PALETTE.y, Y: PALETTE.Y, G: PALETTE.G }, 2);

  // ---------- power-ups ----------
  const potion = (body, top) => pixelSprite([
    '..nn..',
    '.nWWn.',
    '.nWWn.',
    '.nWWn.',
    'nWWWWn',
    'nWWWWn',
    '.nWWn.',
  ], { n: top, W: body }, 3);
  atlas.potion_speed = potion(PALETTE.y, PALETTE.Y);
  atlas.potion_shield = potion(PALETTE.c, PALETTE.C);
  atlas.potion_magnet = potion(PALETTE.p, PALETTE.P);
  atlas.potion_double = potion('#ffffff', PALETTE.x);
  atlas.potion_heal = potion(PALETTE.r, PALETTE.R);

  // ---------- heart (HUD / floating) ----------
  atlas.heart = pixelSprite([
    '.rr.rr.',
    'rRRrRRr',
    'rRRRRRr',
    '.rRRRr.',
    '..rRr..',
    '...r...',
  ], { r: PALETTE.r, R: PALETTE.R }, 2);

  const get = (name) => atlas[name];

  return { get, atlas };
})();

/* =========================================================================
   SECTION 7 — PARTICLE SYSTEM (object pool)
   ========================================================================= */
class Particle {
  constructor() {
    this.alive = false;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.life = 0; this.maxLife = 1;
    this.size = 3; this.color = '#fff'; this.gravity = 0;
    this.glow = false; this.shrink = true; this.spin = 0; this.rot = 0;
  }
  reset() { this.alive = true; this.spin = 0; this.rot = 0; }
}

class ParticleSystem {
  constructor() {
    this.pool = new ObjectPool(() => new Particle(), 700);
  }
  clear() { for (const p of this.pool.items) p.alive = false; }
  spawn(opts) {
    const p = this.pool.get();
    if (!p.alive) p.reset();
    p.x = opts.x; p.y = opts.y;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0;
    p.life = 0; p.maxLife = opts.life || 0.6;
    p.size = opts.size || 3;
    p.color = opts.color || '#ffd54a';
    p.gravity = opts.gravity !== undefined ? opts.gravity : 0;
    p.glow = !!opts.glow;
    p.shrink = opts.shrink !== undefined ? opts.shrink : true;
    p.spin = opts.spin || 0;
    return p;
  }
  burst(x, y, count, color, speed, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = U.rand(speed * 0.3, speed);
      this.spawn({
        x, y,
        vx: Math.cos(a) * sp + (opts.bx || 0),
        vy: Math.sin(a) * sp + (opts.by || 0),
        life: U.rand(0.4, opts.life || 0.9),
        size: U.rand(2, opts.size || 5),
        color: Array.isArray(color) ? U.pick(color) : color,
        gravity: opts.gravity !== undefined ? opts.gravity : 140,
        glow: true,
        spin: U.rand(-6, 6),
      });
    }
  }
  confetti(x, y, n) {
    const cols = ['#ffd54a', '#ff8a65', '#64b5f6', '#a5d6a7', '#f48fb1'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = U.rand(60, 220);
      this.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: U.rand(0.8, 1.6), size: U.rand(3, 6), color: U.pick(cols), gravity: 200, glow: true, spin: U.rand(-10, 10) });
    }
  }
  update(dt) {
    for (const p of this.pool.items) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.alive = false; continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.x < -50 || p.x > 6000 || p.y < -50 || p.y > 6000) p.alive = false;
    }
  }
  draw(ctx) {
    for (const p of this.pool.items) {
      if (!p.alive) continue;
      const k = 1 - p.life / p.maxLife;
      const s = p.shrink ? Math.max(0.2, k) * p.size : p.size;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = k;
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 8; }
      ctx.fillStyle = p.color;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }
}

/* =========================================================================
   SECTION 8 — FLOATING TEXT (pooled)
   ========================================================================= */
class FloatText {
  constructor() { this.alive = false; this.x = 0; this.y = 0; this.vy = 0; this.life = 0; this.maxLife = 1; this.str = ''; this.color = '#fff'; this.size = 16; }
}
class FloatingTextSystem {
  constructor() { this.pool = new ObjectPool(() => new FloatText(), 90); }
  spawn(x, y, str, color = '#fff', size = 17) {
    const t = this.pool.get();
    if (!t.alive) t.alive = true;
    t.x = x + U.rand(-8, 8); t.y = y; t.vy = -70;
    t.life = 0; t.maxLife = 0.9;
    t.str = str; t.color = color; t.size = size;
    return t;
  }
  update(dt) {
    for (const t of this.pool.items) {
      if (!t.alive) continue;
      t.life += dt;
      t.y += t.vy * dt;
      t.vy *= 1 - 2.4 * dt;
      if (t.life >= t.maxLife) t.alive = false;
    }
  }
  draw(ctx) {
    ctx.textAlign = 'center';
    for (const t of this.pool.items) {
      if (!t.alive) continue;
      const k = t.life / t.maxLife;
      ctx.globalAlpha = 1 - k;
      ctx.font = `800 ${t.size}px Rubik, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 4;
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}

/* =========================================================================
   SECTION 9 — CAMERA (follow, shake, zoom, flash)
   ========================================================================= */
class Camera {
  constructor(game) {
    this.game = game;
    this.x = 0; this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.shake = 0;
    this.flashColor = '#ffffff';
    this.flashA = 0;
    this.shakeX = 0; this.shakeY = 0;
  }
  computeZoom() {
    // keep roughly a 960x560 world-view visible regardless of screen
    return U.clamp(Math.min(this.game.vw / 960, this.game.vh / 560), 0.55, 1.5);
  }
  follow(dt) {
    const p = this.game.player;
    const k = 1 - Math.pow(0.0015, dt); // smooth lerp
    this.x = U.lerp(this.x, p.x, k);
    this.y = U.lerp(this.y, p.y, k);
    this.zoom = U.lerp(this.zoom, this.targetZoom, 1 - Math.pow(0.001, dt));
    // clamp to world bounds (minus half screen)
    const halfW = this.game.vw / 2 / this.zoom;
    const halfH = this.game.vh / 2 / this.zoom;
    this.x = U.clamp(this.x, halfW, this.game.world.w - halfW);
    this.y = U.clamp(this.y, halfH, this.game.world.h - halfH);
    // decaying shake
    this.shake = Math.max(0, this.shake - dt * 26);
    this.shakeX = U.rand(-this.shake, this.shake);
    this.shakeY = U.rand(-this.shake, this.shake);
    // flash decay
    this.flashA = Math.max(0, this.flashA - dt * 2.4);
  }
  addShake(amount) { this.shake = Math.min(30, this.shake + amount); }
  flash(color, alpha) { this.flashColor = color; this.flashA = alpha; }
  /* world<->screen transforms (with shake + zoom) */
  screenX(wx) { return (wx - this.x) * this.zoom + this.game.vw / 2 + this.shakeX; }
  screenY(wy) { return (wy - this.y) * this.zoom + this.game.vh / 2 + this.shakeY; }
  worldX(sx) { return (sx - this.game.vw / 2 - this.shakeX) / this.zoom + this.x; }
  worldY(sy) { return (sy - this.game.vh / 2 - this.shakeY) / this.zoom + this.y; }
  apply(ctx) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, this.game.vw / 2 - this.x * this.zoom + this.shakeX, this.game.vh / 2 - this.y * this.zoom + this.shakeY);
  }
}

/* =========================================================================
   SECTION 10 — WEATHER (sunny / rain / night / fog / lightning)
   ========================================================================= */
class Weather {
  constructor(game) {
    this.game = game;
    this.type = 'sunny';
    this.drops = [];
    this.mist = [];
    for (let i = 0; i < 40; i++) this.mist.push({ x: Math.random(), y: Math.random(), s: U.rand(60, 160), a: U.rand(0.05, 0.16), v: U.rand(8, 22) });
  }
  set(type) {
    this.type = type;
    this.game.toast('weather', { sunny: '☀️ Sunny Day', rain: '🌧 Heavy Rain', night: '🌙 Night Falls', fog: '🌫 Dense Fog', lightning: '⚡ Thunderstorm' }[type]);
  }
  randomize() {
    const r = Math.random();
    if (r < 0.42) this.set('sunny');
    else if (r < 0.62) this.set('rain');
    else if (r < 0.78) this.set('fog');
    else if (r < 0.92) this.set('night');
    else this.set('lightning');
  }
  update(dt) {
    if (this.type === 'rain' || this.type === 'lightning') {
      const target = 90;
      while (this.drops.length < target) this.drops.push({ x: Math.random(), y: Math.random(), s: U.rand(14, 26), v: U.rand(520, 760) });
      for (const d of this.drops) {
        d.y += d.v * dt / this.game.vh;
        d.x += 0.06 * dt;
        if (d.y > 1) { d.y = -0.03; d.x = Math.random(); }
      }
    } else { this.drops.length = 0; }
    if (this.type === 'fog' || this.type === 'night') {
      for (const m of this.mist) {
        m.x += m.v * dt / this.game.vw;
        if (m.x > 1.3) m.x = -0.3;
      }
    }
  }
  /* lightning random flash */
  tickLightning() {
    if (this.type === 'lightning' && Math.random() < 0.004) {
      this.game.audio.lightning();
      this.game.camera.flash('#eaf6ff', 0.5);
      this.game.camera.addShake(4);
    }
  }
  /* dark overlay + tint, drawn in screen space (css px) */
  draw(ctx) {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (this.type === 'rain' || this.type === 'lightning') {
      ctx.fillStyle = 'rgba(60,90,140,0.10)';
      ctx.fillRect(0, 0, vw, vh);
      ctx.strokeStyle = 'rgba(160,200,255,0.5)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (const d of this.drops) {
        ctx.moveTo(d.x * vw, d.y * vh);
        ctx.lineTo(d.x * vw - 6, (d.y * vh) + 16);
      }
      ctx.stroke();
    }
    if (this.type === 'night') {
      const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.2, vw / 2, vh / 2, Math.max(vw, vh) * 0.75);
      g.addColorStop(0, 'rgba(10,15,45,0.05)');
      g.addColorStop(1, 'rgba(10,15,45,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vw, vh);
    }
    if (this.type === 'fog') {
      for (const m of this.mist) {
        const x = m.x * vw, y = m.y * vh;
        const g = ctx.createRadialGradient(x, y, 0, x, y, m.s);
        g.addColorStop(0, `rgba(220,235,245,${m.a})`);
        g.addColorStop(1, 'rgba(220,235,245,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - m.s, y - m.s, m.s * 2, m.s * 2);
      }
    }
    if (this.type === 'lightning' && Math.random() < 0.02) {
      ctx.fillStyle = 'rgba(200,225,255,0.08)';
      ctx.fillRect(0, 0, vw, vh);
    }
  }
}

/* =========================================================================
   SECTION 11 — MAP (parallax background + tiles + decor + collision)
   ========================================================================= */
class Map {
  constructor(game) {
    this.game = game;
    this.w = 0; this.h = 0;
    this.water = [];   // animated water tiles
    this.grassTiles = []; // animated grass tufts
    this.decor = [];   // trees/rocks/bushes/flowers (some solid)
    this.coll = null;  // grid: 0 free, 1 solid
    this.tileSpr = null;
  }
  generate(level) {
    const size = Math.min(CFG.BASE_WORLD + (level - 1) * CFG.WORLD_GROWTH, CFG.MAX_WORLD);
    this.w = size; this.h = size;
    this.water = []; this.decor = [];
    const tw = Math.ceil(size / CFG.TILE), th = Math.ceil(size / CFG.TILE);
    this.coll = new Uint8Array(tw * th);
    const t = CFG.TILE;
    // border trees (solid)
    const border = 2;
    for (let x = 0; x < tw; x++) for (let y = 0; y < th; y++) {
      if (x < border || y < border || x >= tw - border || y >= th - border) {
        this.coll[y * tw + x] = 1;
        if ((x + y) % 3 === 0) this.decor.push({ type: 'tree', x: x * t + t / 2, y: y * t + t / 2 });
      }
    }
    // random ponds
    const ponds = U.randInt(1, 2) + (level > 3 ? 1 : 0);
    for (let i = 0; i < ponds; i++) {
      const px = U.randInt(border + 4, tw - border - 5);
      const py = U.randInt(border + 4, th - border - 5);
      const r = U.randInt(2, 4);
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r + 1) {
          const cx = px + x, cy = py + y;
          if (cx >= border && cy >= border && cx < tw - border && cy < th - border) {
            this.coll[cy * tw + cx] = 1;
            this.water.push({ x: cx * t, y: cy * t, phase: Math.random() * 6.28, base: U.rand(0, 1) });
          }
        }
      }
    }
    // random rocks & bushes & flowers (avoid water/border)
    const rockN = U.randInt(18, 30) + level * 2;
    const bushN = U.randInt(24, 40) + level * 2;
    const flowerN = U.randInt(30, 50);
    const place = (type, n) => {
      for (let i = 0; i < n; i++) {
        let tx = U.randInt(border + 1, tw - border - 2);
        let ty = U.randInt(border + 1, th - border - 2);
        let tries = 0;
        while ((this.coll[ty * tw + tx] || this._nearPlayer(tx * t, ty * t)) && tries < 30) {
          tx = U.randInt(border + 1, tw - border - 2);
          ty = U.randInt(border + 1, th - border - 2);
          tries++;
        }
        if (tries >= 30) continue;
        if (type === 'rock') this.coll[ty * tw + tx] = 1;
        this.decor.push({ type, x: tx * t + t / 2, y: ty * t + t / 2 });
      }
    };
    place('rock', rockN);
    place('bush', bushN);
    place('flower', flowerN);
    // animated grass tufts scattered on free tiles
    const tuftN = Math.min(220, (tw * th) / 40);
    for (let i = 0; i < tuftN; i++) {
      const tx = U.randInt(border + 1, tw - border - 2);
      const ty = U.randInt(border + 1, th - border - 2);
      if (this.coll[ty * tw + tx]) continue;
      this.grassTiles.push({ x: tx * t + U.rand(4, t - 4), y: ty * t + t - 4, ph: Math.random() * 6.28, s: U.rand(6, 12) });
    }
    // background prerendered tile strip for speed
    this._preTile();
  }
  _nearPlayer(x, y) { const p = this.game.player; return p && U.dist2(x, y, p.x, p.y) < 120 * 120; }
  _preTile() {
    // single grass tile reused for fill
    this.tileSpr = Sprites.get('grass');
    this.waterSpr = Sprites.get('water');
  }
  isSolid(px, py, r) {
    const t = CFG.TILE;
    const tw = Math.ceil(this.w / t);
    const x0 = Math.floor((px - r) / t), x1 = Math.floor((px + r) / t);
    const y0 = Math.floor((py - r) / t), y1 = Math.floor((py + r) / t);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= tw || y >= Math.ceil(this.h / t)) return true;
      if (this.coll[y * tw + x]) return true;
    }
    return false;
  }
  /* animated grass sway + water shimmer */
  drawGround(ctx, cam) {
    const t = CFG.TILE;
    const halfW = this.game.vw / 2 / cam.zoom, halfH = this.game.vh / 2 / cam.zoom;
    const sx = U.clamp(cam.x - halfW, 0, this.w), sy = U.clamp(cam.y - halfH, 0, this.h);
    const ex = U.clamp(cam.x + halfW, 0, this.w), ey = U.clamp(cam.y + halfH, 0, this.h);
    const tx0 = Math.floor(sx / t), ty0 = Math.floor(sy / t);
    const tx1 = Math.ceil(ex / t), ty1 = Math.ceil(ey / t);
    const time = this.game.time;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        ctx.drawImage(this.tileSpr, tx * t, ty * t);
      }
    }
    // animated water
    for (const w of this.water) {
      const dx = w.x - cam.x, dy = w.y - cam.y;
      if (Math.abs(dx) > halfW + t || Math.abs(dy) > halfH + t) continue;
      ctx.save();
      ctx.translate(w.x + t / 2, w.y + t / 2);
      const shim = Math.sin(time * 3 + w.phase) * 1.4;
      ctx.scale(1 + Math.sin(time * 2 + w.phase) * 0.04, 1);
      ctx.drawImage(this.waterSpr, -t / 2, -t / 2 + shim * 0.4);
      ctx.restore();
    }
  }
  drawDecor(ctx, cam) {
    const halfW = this.game.vw / 2 / cam.zoom, halfH = this.game.vh / 2 / cam.zoom;
    const time = this.game.time;
    for (const d of this.decor) {
      const dx = d.x - cam.x, dy = d.y - cam.y;
      if (Math.abs(dx) > halfW + 90 || Math.abs(dy) > halfH + 90) continue;
      if (d.type === 'tree') {
        ctx.save();
        ctx.translate(d.x, d.y);
        const sway = Math.sin(time * 0.8 + d.x * 0.01) * 0.02;
        ctx.rotate(sway);
        ctx.drawImage(Sprites.get('tree'), -52, -88);
        ctx.restore();
      } else if (d.type === 'rock') {
        ctx.drawImage(Sprites.get('rock'), d.x - 32, d.y - 20);
      } else if (d.type === 'bush') {
        const sway = Math.sin(time * 1.2 + d.x * 0.02) * 0.05;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(sway);
        ctx.drawImage(Sprites.get('bush'), -24, -16);
        ctx.restore();
      } else if (d.type === 'flower') {
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(Math.sin(time * 1.6 + d.x * 0.1) * 0.1);
        ctx.drawImage(Sprites.get('flower'), -5, -10);
        ctx.restore();
      }
    }
    // animated grass tufts
    ctx.fillStyle = '#43a047';
    for (const g of this.grassTiles) {
      const dx = g.x - cam.x, dy = g.y - cam.y;
      if (Math.abs(dx) > halfW + 20 || Math.abs(dy) > halfH + 20) continue;
      const sway = Math.sin(time * 2.4 + g.ph) * 2.5;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(sway * 0.03);
      ctx.fillRect(-1.2, -g.s, 2.4, g.s);
      ctx.fillRect(-4, -g.s * 0.7, 2, g.s * 0.7);
      ctx.fillRect(2, -g.s * 0.7, 2, g.s * 0.7);
      ctx.restore();
    }
  }
  /* three parallax background layers: sky, clouds+sun/moon, mountain + forest strip */
  drawBackground(ctx) {
    const { vw, vh, camera } = this.game;
    // sky gradient (color varies with weather)
    const skyTop = this.game.weather.type === 'night' ? '#0a1030' : this.game.weather.type === 'rain' || this.game.weather.type === 'lightning' ? '#5b748c' : this.game.weather.type === 'fog' ? '#aec9c0' : '#6fc3f0';
    const skyBot = this.game.weather.type === 'night' ? '#16224a' : '#cfeef5';
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, skyTop);
    g.addColorStop(1, skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    const sun = this.game.weather.type === 'night' ? 'moon' : 'sun';
    // sun / moon
    const p = this.game.player;
    const su = 0.25, mv = 0.5;
    const sx = (camera.x * su + vw * 0.35) % (vw + 200) - 100;
    const sy = vh * 0.14 + (camera.y - p.y) * mv * 0.01;
    ctx.save();
    ctx.shadowBlur = 60;
    ctx.shadowColor = '#fff7c0';
    ctx.fillStyle = sun === 'moon' ? '#e8ecf5' : '#ffef9e';
    ctx.beginPath(); ctx.arc(sx, sy, 46, 0, 6.29); ctx.fill();
    ctx.restore();
    if (sun === 'sun') {
      ctx.save(); ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#fff7c0';
      ctx.beginPath(); ctx.arc(sx, sy, 82, 0, 6.29); ctx.fill();
      ctx.restore();
    }
    // clouds (slow drift)
    ctx.save();
    ctx.globalAlpha = this.game.weather.type === 'night' ? 0.4 : 0.85;
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 340 + camera.x * 0.18 + this.game.time * 9) % (vw + 300)) - 150;
      const cy = 50 + i * 42 + Math.sin(this.game.time * 0.3 + i) * 12;
      this._cloud(ctx, cx, cy, 60 + i * 18);
    }
    ctx.restore();
    // far mountain silhouette (parallax 0.4)
    const mo = 0.4;
    const off = camera.x * mo;
    ctx.fillStyle = this.game.weather.type === 'night' ? '#101a3a' : '#2e6b4f';
    ctx.beginPath();
    ctx.moveTo(0, vh);
    for (let x = 0; x <= vw + 40; x += 40) {
      const wx = x + off * 0.0;
      const hgt = 190 + Math.sin((x + off) * 0.006) * 80 + Math.sin((x + off) * 0.016) * 45;
      ctx.lineTo(x, vh - hgt);
    }
    ctx.lineTo(vw, vh); ctx.closePath(); ctx.fill();
    // near forest strip (parallax 0.7) — dense canopy silhouettes
    const fo = 0.7;
    ctx.fillStyle = this.game.weather.type === 'night' ? '#0c1428' : '#1d5c3c';
    ctx.beginPath();
    ctx.moveTo(0, vh);
    for (let x = 0; x <= vw + 40; x += 24) {
      const hgt = 90 + Math.sin((x + camera.x * fo) * 0.012) * 34 + Math.sin((x + camera.x * fo) * 0.03) * 22;
      ctx.lineTo(x, vh - hgt);
    }
    ctx.lineTo(vw, vh); ctx.closePath(); ctx.fill();
  }
  _cloud(ctx, x, y, s) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.45, 0, 6.29);
    ctx.arc(x + s * 0.4, y - s * 0.1, s * 0.35, 0, 6.29);
    ctx.arc(x + s * 0.7, y + s * 0.05, s * 0.3, 0, 6.29);
    ctx.fill();
  }
}

/* =========================================================================
   SECTION 12 — GAME ENTITY BASE + PLAYER
   ========================================================================= */
class Entity {
  constructor(game, x, y, w, h) {
    this.game = game;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.dead = false;
  }
  centerX() { return this.x + this.w / 2; }
  centerY() { return this.y + this.h / 2; }
}

class Player extends Entity {
  constructor(game) {
    super(game, 0, 0, 26, 32);
    this.reset();
  }
  reset() {
    const p = this.game;
    this.x = p.world.w / 2 - this.w / 2;
    this.y = p.world.h / 2 - this.h / 2;
    this.hp = this.maxHp = 100;
    this.speed = 220;
    this.coin = 0;
    this.score = 0;
    this.level = 1;
    this.exp = 0;
    this.expMax = 100;
    this.facing = 1; // 1 right, -1 left
    this.state = 'idle'; // idle|walk|attack|hit|dead
    this.attackT = 0; this.attackCd = 0;
    this.hitFlash = 0;
    this.invuln = 0;
    this.dashT = 0; this.dashCd = 0;
    this.squash = 1; this.stretch = 1;
    this.walkPh = 0;
    this.trail = [];
    this.powerups = {};
    this.alive = true;
    this.buffs = { dmg: 1, coinMult: 1, speedMult: 1 };
  }
  gainExp(n) {
    this.exp += n;
    while (this.exp >= this.expMax) {
      this.exp -= this.expMax;
      this.level++;
      this.expMax = Math.round(this.expMax * 1.35);
      this.maxHp = Math.round(this.maxHp + 20);
      this.hp = Math.min(this.maxHp, this.hp + 40);
      this.audio('levelup');
      this.game.ui.toast('levelup', `⬆ LEVEL ${this.level}!`);
      this.game.burstText(this.centerX(), this.y, `LEVEL ${this.level}!`, '#ffd54a', 22);
      this.game.particles.burst(this.centerX(), this.centerY(), 24, '#ffd54a', 220, { gravity: 40 });
      this.game.achievement('first-level');
    }
  }
  /* shorthand to play sfx through game */
  audio(sfx) { if (this.game.audio[sfx]) this.game.audio[sfx](); }
  update(dt) {
    const inp = this.game.input;
    const mv = inp.moveVector();
    // dead player — only decay timers, no movement/attack
    if (!this.alive) {
      if (this.hitFlash > 0) this.hitFlash -= dt;
      if (this.invuln > 0) this.invuln -= dt;
      return;
    }
    const running = inp.sprinting && mv.x + mv.y !== 0;
    let speed = this.speed * this.buffs.speedMult * (running ? 1.55 : 1);
    if (this.dashT > 0) {
      // dash — high velocity in facing/last direction
      this.dashT -= dt;
      this.vx = this.dashDx * 640;
      this.vy = this.dashDy * 640;
      // dash trail
      this.trail.push({ x: this.centerX(), y: this.centerY(), life: 0.3, dir: this.facing });
      if (this.trail.length > 26) this.trail.shift();
    } else {
      this.vx = mv.x * speed;
      this.vy = mv.y * speed;
    }
    this.dashCd = Math.max(0, this.dashCd - dt);
    // movement with collision
    const nvx = this.vx, nvy = this.vy;
    const r = this.w / 2 - 2;
    let nx = this.x + nvx * dt, ny = this.y + nvy * dt;
    // resolve axis separately for sliding
    if (!this.game.world.isSolid(nx + this.w / 2, this.centerY(), r) && !this.game.world.isSolid(nx + this.w / 2, this.y + r + 1, 0)) this.x = nx;
    if (!this.game.world.isSolid(this.centerX(), ny + this.h / 2, 0) && !this.game.world.isSolid(this.x + r + 1, ny + this.h / 2, 0)) this.y = ny;
    // clamp inside world
    this.x = U.clamp(this.x, 6, this.game.world.w - this.w - 6);
    this.y = U.clamp(this.y, 6, this.game.world.h - this.h - 6);
    if (this.dashT <= 0) {
      if (mv.x !== 0) this.facing = mv.x > 0 ? 1 : -1;
      if (mv.x + mv.y !== 0) {
        if (this.state !== 'attack') this.state = 'walk';
        this.walkPh += dt * (running ? 13 : 8);
        // squash & stretch while walking
        this.squash = 1 + Math.sin(this.walkPh * 2) * 0.05;
        this.stretch = 1 - Math.sin(this.walkPh * 2) * 0.05;
        // footstep dust
        if (Math.random() < dt * (running ? 9 : 3)) {
          this.game.particles.spawn({ x: this.centerX() + U.rand(-6, 6), y: this.y + this.h, vx: -this.vx * 0.05, vy: -U.rand(10, 40), life: 0.35, size: 3, color: '#9e9e9e', gravity: 60 });
        }
      } else { this.state = 'idle'; this.squash = U.lerp(this.squash, 1, dt * 8); this.stretch = U.lerp(this.stretch, 1, dt * 8); }
    } else {
      this.state = 'walk';
      this.squash = 1 + Math.sin(this.game.time * 60) * 0.15;
      this.stretch = 1 - Math.sin(this.game.time * 60) * 0.12;
    }
    // attack
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.attackT = Math.max(0, this.attackT - dt);
    const wantAttack = inp.attacking() || inp.mouse.justPressed;
    if (wantAttack && this.attackCd <= 0 && this.alive && this.state !== 'dead') this.game.doAttack(this);
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    // powerup timers
    for (const k in this.powerups) {
      this.powerups[k] -= dt;
      if (this.powerups[k] <= 0) {
        delete this.powerups[k];
        this.game.applyPowerupEnd(k);
      }
    }
    // trail fade
    for (const tr of this.trail) tr.life -= dt;
    this.trail = this.trail.filter(t => t.life > 0);
  }
  damage(n, src) {
    if (this.invuln > 0 || !this.alive) return false;
    const shield = this.powerups['shield'];
    if (shield && shield > 0) {
      delete this.powerups['shield'];
      this.game.applyPowerupEnd('shield');
      this.game.particles.burst(this.centerX(), this.centerY(), 20, '#4dd0e1', 200, { gravity: 60 });
      this.game.camera.addShake(5);
      this.audio('hurt');
      this.game.burstText(this.centerX(), this.y, 'BLOCKED!', '#4dd0e1', 16);
      return false;
    }
    this.hp -= n;
    this.invuln = 0.7;
    this.hitFlash = 0.35;
    this.audio('hurt');
    this.game.camera.addShake(6);
    this.game.particles.burst(this.centerX(), this.centerY(), 10, '#ef5350', 160, { gravity: 60 });
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
    this.game.ui.updateHud();
    return true;
  }
  die() {
    this.alive = false;
    this.state = 'dead';
    this.audio('lose');
    this.game.camera.flash('#ff5252', 0.35);
    this.game.camera.addShake(14);
    this.game.particles.burst(this.centerX(), this.centerY(), 40, ['#ef5350', '#ffd54a', '#b71c1c'], 260, { gravity: 200 });
    setTimeout(() => this.game.showGameOver(), 1100);
  }
  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); this.game.ui.updateHud(); }
  draw(ctx) {
    const cx = this.centerX(), cy = this.centerY();
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, this.y + this.h, this.w * 0.55 * this.squash, 5, 0, 0, 6.29);
    ctx.fill();
    ctx.restore();
    // dash trail
    for (const tr of this.trail) {
      ctx.save();
      ctx.globalAlpha = tr.life * 0.35;
      ctx.translate(tr.x, tr.y);
      ctx.fillStyle = '#ffd54a';
      ctx.beginPath();
      ctx.arc(0, 0, 12 * tr.life + 2, 0, 6.29);
      ctx.fill();
      ctx.restore();
    }
    if (this.invuln > 0 && Math.floor(this.game.time * 20) % 2 === 0) return; // blink when invulnerable
    const dying = !this.alive;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(this.facing * this.squash, this.stretch);
    if (dying) ctx.rotate(Math.PI / 2);
    if (this.hitFlash > 0) ctx.filter = 'brightness(3) saturate(0.5)';
    // body — green tunic adventurer
    ctx.fillStyle = '#1b5e20';           // legs
    const legSwing = Math.sin(this.walkPh * 2) * 4;
    ctx.fillRect(-6, 4 + legSwing * 0.3, 4, 8);
    ctx.fillRect(2, 4 - legSwing * 0.3, 4, 8);
    ctx.fillStyle = '#e8d6a3';           // boots
    ctx.fillRect(-7, 10 + legSwing * 0.3, 5, 3);
    ctx.fillRect(2, 10 - legSwing * 0.3, 5, 3);
    ctx.fillStyle = '#2e7d32';           // tunic
    ctx.fillRect(-8, -8, 16, 14);
    ctx.fillStyle = '#256c2a';
    ctx.fillRect(-8, -3, 16, 3);
    ctx.fillStyle = '#8b5a2b';           // belt
    ctx.fillRect(-8, 4, 16, 3);
    ctx.fillStyle = '#ffd54a';           // buckle
    ctx.fillRect(-2, 4, 4, 3);
    ctx.fillStyle = '#e8a87c';           // head
    ctx.fillRect(-7, -17, 14, 10);
    ctx.fillStyle = '#5b3a16';           // hair
    ctx.fillRect(-7, -18, 14, 5);
    ctx.fillStyle = '#4e342e';           // cap
    ctx.fillRect(-8, -19, 16, 3);
    ctx.fillStyle = '#000';              // eye
    ctx.fillRect(this.facing > 0 ? 3 : -5, -13, 3, 3);
    ctx.fillStyle = '#e8d6a3';           // arms
    const armLift = Math.sin(this.walkPh) * 3;
    ctx.fillRect(-11, -7 + armLift * 0.3, 4, 7);
    ctx.fillRect(7, -7 - armLift * 0.3, 4, 7);
    // sword when attacking
    if (this.attackT > 0) {
      const prog = 1 - this.attackT / 0.28;
      const ang = -0.9 + Math.sin(prog * Math.PI) * 1.8; // swipe
      ctx.save();
      ctx.rotate(ang);
      ctx.fillStyle = '#cfd8dc';
      ctx.fillRect(6, -16, 4, 16);
      ctx.fillStyle = '#ffd54a';
      ctx.fillRect(6, -18, 4, 3);
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.25 * (1 - prog);
      ctx.beginPath();
      ctx.arc(0, -8, 20 * (1 - prog * 0.5), 0, 6.29);
      ctx.fill();
    }
    ctx.restore();
    // magnet aura / shield aura
    if (this.powerups['shield']) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(this.game.time * 6) * 0.2;
      ctx.strokeStyle = '#4dd0e1';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#4dd0e1'; ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 24, 0, 6.29);
      ctx.stroke();
      ctx.restore();
    }
    if (this.powerups['magnet']) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#ab47bc';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 34 + Math.sin(this.game.time * 5) * 4, 0, 6.29);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* =========================================================================
   SECTION 13 — ENEMY (base + 5 variants) + PROJECTILES
   ========================================================================= */
class Enemy extends Entity {
  constructor(game, x, y, type) {
    super(game, x, y, 24, 24);
    this.type = type;
    this.kind = type; // for sprites
    this.hp = 1; this.maxHp = 1;
    this.dmg = 1;
    this.speed = 80;
    this.aggroRange = 240;
    this.leash = 420;
    this.state = 'patrol';
    this.anchorX = x; this.anchorY = y;
    this.patrolA = U.rand(0, 6.28);
    this.blink = 0;
    this.scoreValue = 25;
    this.floats = false;
    this.ph = Math.random() * 6.28;
    this.attackCd = U.rand(0.5, 1.4);
    this.facing = -1;
    this.spr = null;
    this.x += this.w / 2; this.y += this.h / 2; // center-based
  }
  audio(sfx) { if (this.game.audio[sfx]) this.game.audio[sfx](); }
  configure(stats) {
    this.hp = stats.hp; this.maxHp = stats.hp;
    this.dmg = stats.dmg;
    this.speed = stats.speed;
    this.scoreValue = stats.score;
  }
  scaleByLevel(lv) {
    const f = 1 + (lv - 1) * 0.14;
    this.hp = Math.round(this.hp * f);
    this.maxHp = this.hp;
    this.dmg = Math.round(this.dmg * (1 + (lv - 1) * 0.1));
    this.speed *= 1 + (lv - 1) * 0.045;
    this.scoreValue = Math.round(this.scoreValue * (1 + (lv - 1) * 0.1));
  }
  update(dt) {
    const p = this.game.player;
    if (!p.alive) return;
    const dx = p.centerX() - this.x, dy = p.centerY() - this.y;
    const d = Math.hypot(dx, dy);
    this.ph += dt * 8;
    this.blink = Math.max(0, this.blink - dt);
    this.attackCd -= dt;
    // AI state machine
    if (d < this.aggroRange) {
      this.state = 'chase';
      this.game.enemiesChasing = true;
    } else if (d > this.leash) {
      this.state = 'return';
    }
    let dirx = 0, diry = 0;
    if (this.state === 'chase') {
      dirx = dx / d; diry = dy / d;
    } else if (this.state === 'return') {
      const rx = this.anchorX - this.x, ry = this.anchorY - this.y;
      const rd = Math.hypot(rx, ry) || 1;
      dirx = rx / rd; diry = ry / rd;
      if (rd < 20) { this.state = 'patrol'; this.patrolA = U.rand(0, 6.28); }
    } else { // patrol — wandering around anchor
      this.patrolA += Math.sin(this.ph * 0.4) * dt;
      dirx = Math.cos(this.patrolA); diry = Math.sin(this.patrolA * 0.8);
      if (U.dist2(this.x, this.y, this.anchorX, this.anchorY) > 160 * 160) {
        const back = U.angTo(this.x, this.y, this.anchorX, this.anchorY);
        dirx = Math.cos(back); diry = Math.sin(back);
      }
    }
    if (dirx !== 0) this.facing = dirx > 0 ? 1 : -1;
    // movement (ghost ignores solids, bat flies)
    const sp = this.speed * (this.state === 'chase' ? 1.25 : 1);
    let nx = this.x + dirx * sp * dt;
    let ny = this.y + diry * sp * dt;
    if (!this.floats) {
      if (!this.game.world.isSolid(nx, this.y, this.w / 2)) this.x = nx;
      if (!this.game.world.isSolid(this.x, ny, this.h / 2)) this.y = ny;
    } else {
      this.x = nx; this.y = ny;
    }
    this.x = U.clamp(this.x, 20, this.game.world.w - 20);
    this.y = U.clamp(this.y, 20, this.game.world.h - 20);
    this.y += Math.sin(this.ph * (this.floats ? 1 : 0.7)) * (this.floats ? 14 : 2) * dt;
    // contact damage
    if (this.attackCd <= 0 && d < this.w / 2 + p.w / 2 + 6) {
      this.attackCd = U.rand(0.8, 1.4);
      if (p.damage(this.dmg, this)) {
        this.game.burstText(p.centerX(), p.y, `-${this.dmg}`, '#ff5252', 17);
        this.game.camera.addShake(3);
      }
    }
  }
  damage(n, src) {
    this.hp -= n;
    this.blink = 0.18;
    const knock = n > 0 ? 1 : 0;
    if (this.hp <= 0) { this.die(); return true; }
    this.x += (this.x - src.x) / Math.max(1, U.dist(this.x, this.y, src.x, src.y)) * 12 * knock;
    return false;
  }
  die() {
    if (this.dead) return;
    this.dead = true;
    this.game.onEnemyKill(this);
    this.audio('enemyDie');
    this.game.camera.addShake(4);
    this.game.particles.burst(this.x, this.y, 18, ['#ef5350', '#ffd54a', '#9e9e9e'], 200, { gravity: 220 });
    this.game.particles.spawn({ x: this.x, y: this.y, vx: 0, vy: -120, life: 0.5, size: 26, color: '#ffd54a', glow: true, gravity: 60 });
  }
  draw(ctx) {
    // shadow
    if (!this.floats) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + this.h / 2, this.w * 0.5, 4, 0, 0, 6.29);
      ctx.fill();
      ctx.restore();
    }
    const spr = Sprites.get(this.spr || this.kind);
    const hover = this.floats ? Math.sin(this.ph) * 6 : 0;
    ctx.save();
    ctx.translate(this.x, this.y + hover);
    // blink white when hit
    if (this.blink > 0) ctx.filter = 'brightness(3)';
    // bob + squash animation
    const bob = Math.abs(Math.sin(this.ph)) * (this.floats ? 0 : 2.5);
    ctx.translate(0, bob);
    const sq = 1 + Math.sin(this.ph * 2) * 0.08;
    ctx.scale(1 / sq, sq);
    ctx.rotate(Math.sin(this.ph * 0.8) * 0.04);
    if (this.facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2 + (this.floats ? 4 : 8));
    // hp bar (only when damaged)
    if (this.hp < this.maxHp) {
      ctx.save();
      ctx.scale(this.facing < 0 ? -1 : 1, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(-14, -spr.height / 2 - 12, 28, 4);
      ctx.fillStyle = '#ef5350';
      ctx.fillRect(-13, -11, 26 * U.clamp(this.hp / this.maxHp, 0, 1), 2);
      ctx.restore();
    }
    ctx.restore();
  }
}

/* ---- 5 enemy variants ---- */
class Slime extends Enemy {
  constructor(game, x, y) {
    super(game, x, y, 'slime');
    this.h = 20;
    this.spr = 'slime';
    this.configure({ hp: 40, dmg: 8, speed: 55, score: 25 });
    this.scaleByLevel(game.level);
  }
}
class Bat extends Enemy {
  constructor(game, x, y) {
    super(game, x, y, 'bat');
    this.w = 26; this.h = 20;
    this.spr = 'bat';
    this.floats = true;
    this.aggroRange = 300;
    this.configure({ hp: 30, dmg: 7, speed: 95, score: 30 });
    this.scaleByLevel(game.level);
  }
}
class Skeleton extends Enemy {
  constructor(game, x, y) {
    super(game, x, y, 'skeleton');
    this.spr = 'skeleton';
    this.configure({ hp: 60, dmg: 12, speed: 62, score: 45 });
    this.scaleByLevel(game.level);
  }
}
class Goblin extends Enemy {
  constructor(game, x, y) {
    super(game, x, y, 'goblin');
    this.spr = 'goblin';
    this.aggroRange = 340;
    this.configure({ hp: 45, dmg: 10, speed: 105, score: 40 });
    this.scaleByLevel(game.level);
  }
}
class Ghost extends Enemy {
  constructor(game, x, y) {
    super(game, x, y, 'ghost');
    this.w = 30; this.h = 26;
    this.spr = 'ghost';
    this.floats = true;
    this.configure({ hp: 55, dmg: 9, speed: 70, score: 50 });
    this.scaleByLevel(game.level);
  }
}

const ENEMY_TYPES = [Slime, Slime, Bat, Skeleton, Goblin, Ghost];

/* ---- boss projectiles (fireballs / orbs) ---- */
class Projectile extends Entity {
  constructor(game, x, y, dirx, diry, dmg, color, speed = 240) {
    super(game, x, y, 14, 14);
    this.dirx = dirx; this.diry = diry;
    this.dmg = dmg; this.color = color;
    this.speed = speed;
    this.life = 3.2;
    this.glowCol = color;
    this.x = x; this.y = y;
  }
  update(dt) {
    this.x += this.dirx * this.speed * dt;
    this.y += this.diry * this.speed * dt;
    this.life -= dt;
    this.game.particles.spawn({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.25, size: 4, color: this.color, glow: true, shrink: true });
    const p = this.game.player;
    if (p.alive && U.dist(this.x, this.y, p.centerX(), p.centerY()) < 18) {
      if (p.damage(this.dmg, this)) this.game.burstText(p.centerX(), p.y, `-${this.dmg}`, '#ff5252', 17);
      this.dead = true;
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.shadowColor = this.color; ctx.shadowBlur = 16;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 7 + Math.sin(this.game.time * 12) * 1.5, 0, 6.29);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3, 0, 6.29);
    ctx.fill();
    ctx.restore();
  }
}

/* =========================================================================
   SECTION 14 — BOSS (level 5 Treant & level 10 Dragon)
   ========================================================================= */
class Boss extends Enemy {
  constructor(game, x, y, type) {
    super(game, x, y, type);
    this.w = 64; this.h = 64;
    this.isBoss = true;
    this.spr = type;
    this.phase = 1;
    this.specialCd = 4;
    this.roared = false;
    this.bossName = 'BOSS';
    if (type === 'treant') {
      this.configure({ hp: 420, dmg: 18, speed: 40, score: 600 });
      this.bossName = 'TREANT KING';
    } else {
      this.configure({ hp: 950, dmg: 22, speed: 55, score: 1500 });
      this.bossName = 'DRAGON SOUL';
    }
    this.scaleByLevel(game.level);
    this.maxHp = this.hp;
  }
  roar() {
    if (this.roared) return;
    this.roared = true;
    this.audio('bossRoar');
    this.game.camera.addShake(10);
    this.game.camera.flash('#ffd54a', 0.25);
    this.game.ui.toast('boss', `☠ ${this.bossName} APPEARS!`);
  }
  update(dt) {
    super.update(dt);
    this.specialCd -= dt;
    if (this.specialCd <= 0 && this.state === 'chase') {
      this.specialCd = U.rand(4, 6.5);
      this.useSpecial();
    }
  }
  useSpecial() {
    const p = this.game.player;
    const ang = U.angTo(this.x, this.y, p.centerX(), p.centerY());
    this.game.camera.addShake(6);
    if (this.spr === 'treant') {
      // ground slam — shockwave ring + summon slimes
      this.audio('explosion');
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const pr = new Projectile(this.game, this.x, this.y, Math.cos(a), Math.sin(a), this.dmg, '#8d6e63', 150);
        pr.life = 1.1; pr.w = 22; pr.h = 22;
        this.game.projectiles.push(pr);
      }
      this.game.burstText(this.x, this.y - 50, 'GROUND SLAM!', '#ff8a65', 18);
      this.summon('slime', 2);
    } else {
      // fireball volley + summon bats
      this.audio('bossRoar');
      for (let i = -2; i <= 2; i++) {
        const a = ang + i * 0.22;
        this.game.projectiles.push(new Projectile(this.game, this.x, this.y, Math.cos(a), Math.sin(a), this.dmg, '#ff7043', 270));
      }
      this.game.burstText(this.x, this.y - 60, 'FIRE VOLLEY!', '#ff7043', 18);
      this.summon('bat', 2);
    }
  }
  summon(kind, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      const sx = U.clamp(this.x + Math.cos(a) * 70, 40, this.game.world.w - 40);
      const sy = U.clamp(this.y + Math.sin(a) * 70, 40, this.game.world.h - 40);
      const e = kind === 'slime' ? new Slime(this.game, sx, sy) : new Bat(this.game, sx, sy);
      e.state = 'chase';
      this.game.enemies.push(e);
      this.game.particles.burst(sx, sy, 12, '#ab47bc', 160, { gravity: 60 });
    }
    this.game.ui.updateHud();
  }
  damage(n, src) {
    super.damage(n, src);
    this.game.camera.addShake(3);
    return this.hp <= 0;
  }
  die() {
    if (this.dead) return;
    this.dead = true;
    this.game.onEnemyKill(this, true);
    this.audio('bossDie');
    this.game.camera.addShake(22);
    this.game.camera.flash('#ffd54a', 0.5);
    this.game.setSlowMotion(0.28, 1.2); // dramatic slow-mo
    this.game.particles.burst(this.x, this.y, 90, ['#ffd54a', '#ff7043', '#ffffff', '#ff8a65'], 380, { gravity: 120 });
    this.game.particles.confetti(this.x, this.y, 70);
    this.game.burstText(this.x, this.y - 60, 'BOSS DEFEATED!', '#ffd54a', 26);
    if (this.spr === 'treant') this.game.achievement('boss-treant');
    else this.game.achievement('boss-dragon');
  }
}

/* =========================================================================
   SECTION 15 — TREASURE (with spin, glow, magnet behavior)
   ========================================================================= */
class Treasure extends Entity {
  constructor(game, x, y, kind) {
    super(game, x, y, 20, 20);
    this.kind = kind;
    this.value = TREASURE_VALUES[kind];
    this.spin = 0;
    this.collected = false;
    this.isDrop = false; // dropped by enemies (not required for portal)
    this.angle = U.rand(0, 6.28);
    this.floatPh = Math.random() * 6.28;
    this.spr = Sprites.get(kind === 'coin' ? 'coin' : kind);
  }
  update(dt) {
    this.angle += dt * 3;
    this.floatPh += dt * 2.4;
    this.spin += dt * 4;
    const p = this.game.player;
    // magnet pulls treasure toward player
    const magnet = p.powerups['magnet'];
    const d = U.dist(this.x, this.y, p.centerX(), p.centerY());
    if (magnet && d < 220) {
      const a = U.angTo(this.x, this.y, p.centerX(), p.centerY());
      this.x += Math.cos(a) * 420 * dt;
      this.y += Math.sin(a) * 420 * dt;
    } else if (d < 34) {
      this.collect();
    }
    // coin sparkle
    if (Math.random() < dt * 2) {
      this.game.particles.spawn({ x: this.x + U.rand(-8, 8), y: this.y + U.rand(-8, 8), vx: 0, vy: -20, life: 0.4, size: 2, color: '#ffd54a', glow: true, gravity: 0 });
    }
  }
  collect() {
    if (this.collected) return;
    this.collected = true;
    const p = this.game.player;
    const double = p.powerups['double'];
    const mult = double ? 2 : 1;
    const gain = this.value * mult;
    p.coin += gain;
    p.score += gain;
    this.game.totalGain += gain;
    this.game.audio.coin();
    this.game.particles.burst(this.x, this.y, 14, '#ffd54a', 180, { gravity: 120 });
    this.game.burstText(this.x, this.y - 16, `+${gain}`, '#ffd54a', this.kind === 'chest' ? 22 : 15);
    if (this.kind === 'coin') this.game.particles.spawn({ x: this.x, y: this.y, vx: 0, vy: -90, life: 0.7, size: 8, color: '#ffd54a', glow: true, gravity: 140 });
    if (!this.isDrop) {
      this.game.treasureRemaining--;
      this.game.comboAdd(1);
      this.game.collectedCount++;
      this.game.achievement('treasures');
      if (this.game.treasureRemaining <= 0) this.game.spawnPortal();
    }
    this.game.ui.updateHud();
  }
  draw(ctx) {
    if (this.collected) return;
    const bob = Math.sin(this.floatPh) * 4;
    const scaleX = Math.cos(this.angle);
    const glowA = 0.5 + Math.sin(this.game.time * 4 + this.angle) * 0.3;
    ctx.save();
    ctx.translate(this.x, this.y + bob);
    // pulsing glow
    ctx.save();
    ctx.globalAlpha = glowA * 0.7;
    ctx.shadowColor = '#ffd54a';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ffd54a';
    ctx.beginPath();
    ctx.arc(0, 0, 15 + glowA * 3, 0, 6.29);
    ctx.fill();
    ctx.restore();
    // spinning sprite (squash for coin flip effect)
    ctx.save();
    ctx.scale(Math.max(0.15, Math.abs(scaleX)), 1);
    if (scaleX < 0) ctx.scale(-1, 1);
    ctx.drawImage(this.spr, -this.spr.width / 2, -this.spr.height / 2);
    ctx.restore();
    ctx.restore();
  }
}

/* =========================================================================
   SECTION 16 — POWER-UP (random spawn, 10s duration)
   ========================================================================= */
class PowerUp extends Entity {
  constructor(game, x, y) {
    super(game, x, y, 22, 22);
    const kinds = ['speed', 'shield', 'magnet', 'double', 'heal'];
    this.kind = U.pick(kinds);
    this.spr = Sprites.get('potion_' + this.kind);
    this.ph = Math.random() * 6.28;
  }
  update(dt) {
    this.ph += dt * 3;
    const p = this.game.player;
    if (U.dist(this.x, this.y, p.centerX(), p.centerY()) < 28) this.apply();
  }
  apply() {
    this.dead = true;
    const p = this.game.player;
    const defs = {
      speed: { label: '💨 SPEED BOOST', color: '#fdd835' },
      shield: { label: '🛡 SHIELD', color: '#4dd0e1' },
      magnet: { label: '🧲 COIN MAGNET', color: '#ab47bc' },
      double: { label: '✨ DOUBLE SCORE', color: '#ffffff' },
      heal: { label: '❤ HEAL', color: '#ef5350' },
    };
    const d = defs[this.kind];
    p.powerups[this.kind] = CFG.POWERUP_DURATION;
    this.game.audio.powerup();
    this.game.particles.burst(this.x, this.y, 22, d.color, 200, { gravity: 60 });
    this.game.burstText(this.x, this.y - 18, d.label, d.color, 16);
    this.game.ui.toast('powerup', d.label);
    if (this.kind === 'heal') p.heal(30);
    this.game.applyPowerupStart(this.kind);
    this.game.ui.updatePowerups();
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y + Math.sin(this.ph) * 4);
    ctx.shadowColor = '#ffd54a';
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 0.7 + Math.sin(this.ph * 2) * 0.2;
    ctx.fillStyle = '#ffd54a';
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, 6.29);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.rotate(Math.sin(this.ph) * 0.2);
    ctx.drawImage(this.spr, -this.spr.width / 2, -this.spr.height / 2);
    ctx.restore();
  }
}

/* =========================================================================
   SECTION 17 — PORTAL (level exit)
   ========================================================================= */
class Portal {
  constructor(game) {
    this.game = game;
    this.x = U.rand(0, game.world.w);
    this.y = U.rand(0, game.world.h);
    this.ph = 0;
    this.r = 34;
    this.active = true;
  }
  update(dt) {
    this.ph += dt * 4;
    const p = this.game.player;
    if (this.active && p.alive && U.dist(this.x, this.y, p.centerX(), p.centerY()) < 40) {
      this.active = false;
      this.game.completeLevel();
    }
    // ambient swirl particles
    if (Math.random() < dt * 8) {
      const a = Math.random() * 6.28;
      const rr = U.rand(0, this.r * 0.7);
      this.game.particles.spawn({ x: this.x + Math.cos(a) * rr, y: this.y + Math.sin(a) * rr, vx: Math.cos(a + 1.57) * 40, vy: Math.sin(a + 1.57) * 40, life: 0.5, size: 3, color: Math.random() < 0.5 ? '#ab47bc' : '#ffd54a', glow: true });
    }
  }
  draw(ctx) {
    const pulse = 1 + Math.sin(this.ph) * 0.12;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, this.r * 1.1, this.r * 0.7, 8, 0, 0, 6.29);
    ctx.fill();
    ctx.globalAlpha = 1;
    // outer glow ring
    ctx.shadowColor = '#ab47bc';
    ctx.shadowBlur = 30;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, this.r * pulse);
    g.addColorStop(0, '#ffd54a');
    g.addColorStop(0.45, '#ab47bc');
    g.addColorStop(1, 'rgba(171,71,188,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * pulse, 0, 6.29);
    ctx.fill();
    // swirling inner ring
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffd54a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.6, this.ph, this.ph + 4.5);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.6, this.ph + Math.PI, this.ph + Math.PI + 4);
    ctx.stroke();
    ctx.restore();
  }
}

/* =========================================================================
   SECTION 18 — UI (DOM overlays, HUD, toasts, minimap)
   ========================================================================= */
class UI {
  constructor(game) {
    this.game = game;
    this.$ = (id) => document.getElementById(id);
    this.hud = this.$('hud');
    this.minimap = this.$('minimap');
    this.mmctx = this.minimap.getContext('2d');
    this.toastBox = this.$('toastbox');
    this.bindMenus();
  }
  bindMenus() {
    const $ = this.$;
    // main menu
    $('btn-play').onclick = () => this.game.startGame();
    $('btn-howto').onclick = () => { this.audio('click'); this.show('howto'); };
    $('btn-howto-back').onclick = () => { this.audio('click'); this.show('menu'); };
    $('btn-settings').onclick = () => { this.audio('click'); this.show('settings'); this.refreshSettings(); };
    $('btn-settings2').onclick = () => { this.audio('click'); this.show('settings'); this.refreshSettings(); };
    $('btn-settings-back').onclick = () => {
      const back = this.game.state === 'PAUSED' ? 'pause' : 'menu';
      this.audio('click');
      this.show(back);
    };
    $('btn-highscore').onclick = () => { this.audio('click'); this.refreshHighscore(); this.show('highscore'); };
    $('btn-hs-back').onclick = () => { this.audio('click'); this.show('menu'); };
    $('btn-daily').onclick = () => { this.audio('click'); this.refreshDaily(); this.show('daily'); };
    $('btn-daily-claim').onclick = () => this.claimDaily();
    $('btn-daily-back').onclick = () => { this.audio('click'); this.show('menu'); };
    // pause / resume
    $('btn-resume').onclick = () => this.game.resume();
    $('btn-menu').onclick = () => this.game.toMenu();
    $('btn-menu2').onclick = () => this.game.toMenu();
    $('btn-vicmenu').onclick = () => this.game.toMenu();
    // game over
    $('btn-restart').onclick = () => this.game.restart();
    // level complete
    $('btn-next').onclick = () => this.game.nextLevel();
    // settings toggles
    for (const [id, key] of [['set-sound', 'sound'], ['set-music', 'music'], ['set-shake', 'shake'], ['set-particles', 'particles']]) {
      $(id).onchange = (e) => { Storage.set(key, e.target.checked); this.audio('click'); };
    }
    // corner buttons
    $('btn-mute').onclick = () => { const m = this.game.audio.toggleMute(); $('btn-mute').textContent = m ? '🔇' : '🔊'; };
    $('btn-fullscreen').onclick = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      else document.exitFullscreen && document.exitFullscreen();
    };
    // hover sound
    document.querySelectorAll('.btn').forEach(b => b.addEventListener('mouseenter', () => this.audio('hover')));
  }
  audio(name) { if (this.game.audio[name]) this.game.audio[name](); }
  show(name) {
    const overlays = ['menu', 'pause', 'levelcomplete', 'gameover', 'victory', 'howto', 'settings', 'highscore', 'daily'];
    for (const o of overlays) this.$(o).classList.toggle('hidden', o !== name);
  }
  hideAll() {
    const overlays = ['menu', 'pause', 'levelcomplete', 'gameover', 'victory', 'howto', 'settings', 'highscore', 'daily'];
    for (const o of overlays) this.$(o).classList.add('hidden');
  }
  showHud(v) {
    this.hud.classList.toggle('hidden', !v);
    this.minimap.classList.toggle('hidden', !v);
    document.getElementById('vcontrols').classList.toggle('hidden', !v || !this.game.isTouch);
  }
  updateHud() {
    const p = this.game.player;
    this.$('hpfill').style.width = U.clamp(p.hp / p.maxHp * 100, 0, 100) + '%';
    this.$('hptext').textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
    this.$('expfill').style.width = U.clamp(p.exp / p.expMax * 100, 0, 100) + '%';
    this.$('hud-level').textContent = p.level;
    this.$('hud-score').textContent = p.score;
    this.$('hud-coin').textContent = p.coin;
    this.$('hud-exp').textContent = p.exp;
    this.$('hud-expmax').textContent = p.expMax;
    this.$('hud-enemies').textContent = this.game.enemies.length;
    this.$('hud-treasure').textContent = Math.max(0, this.game.treasureRemaining);
  }
  updateTimer(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    this.$('timer').textContent = `⏱ ${m}:${s.toString().padStart(2, '0')}`;
  }
  updateFps(fps) { this.$('hud-fps').textContent = Math.round(fps); }
  updateCombo() {
    const c = this.game;
    if (c.combo >= 2) {
      this.$('combo').classList.remove('hidden');
      this.$('combo-count').textContent = c.combo;
    } else this.$('combo').classList.add('hidden');
  }
  updatePowerups() {
    const box = this.$('powerup-badges');
    box.innerHTML = '';
    const p = this.game.player;
    const icons = { speed: '💨', shield: '🛡', magnet: '🧲', double: '✨', heal: '❤' };
    for (const k in p.powerups) {
      const d = document.createElement('div');
      d.className = 'pubadge';
      d.textContent = `${icons[k]} ${Math.ceil(p.powerups[k])}s`;
      box.appendChild(d);
    }
  }
  toast(kind, msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this.toastBox.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }
  /* minimap drawn in screen space each frame */
  drawMinimap() {
    const c = this.game;
    const ctx = this.mmctx;
    const W = this.minimap.width, H = this.minimap.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,60,35,0.4)';
    ctx.fillRect(0, 0, W, H);
    const sc = Math.min(W / c.world.w, H / c.world.h);
    const ox = (W - c.world.w * sc) / 2, oy = (H - c.world.h * sc) / 2;
    // water dots
    ctx.fillStyle = 'rgba(77,208,225,0.6)';
    for (const w of c.world.water) ctx.fillRect(ox + w.x * sc, oy + w.y * sc, 3 * sc, 3 * sc);
    // treasure (yellow)
    ctx.fillStyle = '#ffd54a';
    for (const t of c.treasures) if (!t.collected) ctx.fillRect(ox + t.x * sc - 2, oy + t.y * sc - 2, 4, 4);
    // portal (purple)
    if (c.portal) {
      ctx.fillStyle = '#ab47bc';
      ctx.fillRect(ox + c.portal.x * sc - 3, oy + c.portal.y * sc - 3, 6, 6);
    }
    // enemies (red), boss bigger (magenta)
    for (const e of c.enemies) {
      ctx.fillStyle = e.isBoss ? '#e040fb' : '#ef5350';
      const s = e.isBoss ? 6 : 3;
      ctx.fillRect(ox + e.x * sc - s / 2, oy + e.y * sc - s / 2, s, s);
    }
    // player (green)
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(ox + c.player.centerX() * sc - 3, oy + c.player.centerY() * sc - 3, 6, 6);
    // viewport rect
    const vw = c.vw / c.camera.zoom, vh = c.vh / c.camera.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.strokeRect(ox + (c.camera.x - vw / 2) * sc, oy + (c.camera.y - vh / 2) * sc, vw * sc, vh * sc);
  }
  refreshSettings() {
    this.$('set-sound').checked = !!Storage.get('sound');
    this.$('set-music').checked = !!Storage.get('music');
    this.$('set-shake').checked = !!Storage.get('shake');
    this.$('set-particles').checked = !!Storage.get('particles');
  }
  refreshHighscore() {
    this.$('hs-score').textContent = Storage.get('highScore') || 0;
    this.$('hs-level').textContent = Storage.get('level') || 1;
    this.$('hs-coin').textContent = Storage.get('totalCoin') || 0;
  }
  refreshDaily() {
    const d = Storage.get('daily') || { day: '', claimed: false };
    const today = new Date().toDateString();
    this.$('daily-msg').textContent = (d.day === today && d.claimed)
      ? '✅ Already claimed! Come back tomorrow.'
      : '🎉 Claim your daily bonus coins!';
    this.$('btn-daily-claim').disabled = d.day === today && d.claimed;
  }
  claimDaily() {
    const d = Storage.get('daily') || { day: '', claimed: false };
    const today = new Date().toDateString();
    if (d.day === today && d.claimed) return;
    Storage.set('daily', { day: today, claimed: true });
    const bonus = 50;
    Storage.set('totalCoin', (Storage.get('totalCoin') || 0) + bonus);
    this.game.audio.coin();
    this.$('daily-msg').textContent = `+${bonus} coins added to your total!`;
    this.$('btn-daily-claim').disabled = true;
    this.game.toast('reward', `🎁 +${bonus} COINS!`);
  }
  showStars(n) {
    const box = this.$('stars');
    box.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      s.className = 'star' + (i < n ? ' on' : '');
      s.textContent = '★';
      s.style.animationDelay = `${i * 0.25}s`;
      box.appendChild(s);
    }
  }
}

/* =========================================================================
   SECTION 19 — ACHIEVEMENTS (unlockable, persisted, toasts)
   ========================================================================= */
const ACHIEVEMENTS = {
  'first-kill': '⚔ First Blood — defeat 1 enemy',
  'first-level': '⬆ First Level Up',
  'treasures': '💎 Treasure Collector — collect 30 treasures',
  'boss-treant': '🌳 Treant Slayer — defeat Treant King',
  'boss-dragon': '🐉 Dragon Slayer — defeat Dragon Soul',
  'rich': '💰 Rich! — 500 total coins',
  'kills': '⚡ Monster Hunter — 50 kills',
  'dashes': '💨 Dash Master — 100 dashes',
};

class Achievements {
  constructor(game) { this.game = game; }
  unlock(id) {
    if (!Storage.unlockAch(id)) return false;
    this.game.ui.toast('ach', '🏅 ' + ACHIEVEMENTS[id]);
    this.game.audio.levelup();
    return true;
  }
}

/* =========================================================================
   SECTION 20 — GAME (main controller + loop)
   ========================================================================= */
class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.audio = new Audio();
    this.storage = Storage;
    this.state = 'MENU';
    this.level = 1;
    this.time = 0;
    this.levelTimer = 0;
    this.fps = 60;
    this.timeScale = 1;
    this.slowTimer = 0;
    this.paused = false;
    this.combo = 0;
    this.comboT = 0;
    this.totalGain = 0;
    this.collectedCount = 0;
    this.enemiesChasing = false;
    this.weatherTimer = 0;
    this.powerupTimer = 0;
    this.isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    this.dashTimes = 0;
    this.weather = new Weather(this);
    this.camera = new Camera(this);
    this.particles = new ParticleSystem();
    this.texts = new FloatingTextSystem();
    this.tweens = new Tween();
    this.input = new Input(this);
    this.world = new Map(this);
    this.ui = new UI(this);
    this.achievements = new Achievements(this);
    this.enemies = [];
    this.treasures = [];
    this.powerups = [];
    this.projectiles = [];
    this.portal = null;
    this.boss = null;
    this.player = new Player(this);
    this.rainDrops = [];
    this._fpsAcc = 0; this._fpsN = 0;
    this.slowmoQueue = 0;
    Storage.load();
  }
  get vw() { return this.canvas.width; }
  get vh() { return this.canvas.height; }

  /* ---------- lifecycle ---------- */
  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.getElementById('btn-mute').textContent = Storage.get('sound') ? '🔊' : '🔇';
    this.audio.ensure();
    // pretty menu backdrop (static level-1 world behind the menu overlay)
    this.level = 1;
    this.world.generate(1);
    this.player.reset();
    this.camera.x = this.player.centerX();
    this.camera.y = this.player.centerY();
    this.camera.zoom = this.camera.targetZoom = this.camera.computeZoom();
    this.ui.show('menu');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._dpr = dpr;
    this.ctxDpr = dpr;
  }
  /* canvas logical pixel size used by camera/zoom */
  get cw() { return window.innerWidth; }
  get ch() { return window.innerHeight; }

  /* ---------- level generation ---------- */
  buildLevel(lv) {
    this.level = lv;
    this.timeScale = 1;
    this.paused = false;
    this.time = 0;
    this.levelTimer = 0;
    this.combo = 0;
    this.comboT = 0;
    this.comboKills = 0;
    this.totalGain = 0;
    this.collectedCount = 0;
    this.enemiesChasing = false;
    this.powerups = [];
    this.projectiles = [];
    this.portal = null;
    this.boss = null;
    this.world.generate(lv);
    this.player.reset();
    this.player.score = this.level > 1 ? this._carryScore : 0;
    this.player.coin = this.level > 1 ? this._carryCoin || 0 : 0;
    this._carryScore = 0;
    this._carryCoin = 0;
    this.particles.clear();
    this.texts = new FloatingTextSystem();
    this.camera.zoom = this.camera.targetZoom = this.camera.computeZoom();
    this.camera.x = this.player.centerX();
    this.camera.y = this.player.centerY();
    // enemies
    this.enemies = [];
    const nEnemies = Math.min(4 + lv * 2, 30);
    for (let i = 0; i < nEnemies; i++) {
      const kind = this.pickEnemyType(lv);
      const pos = this.randSpawn();
      this.enemies.push(new kind(this, pos.x, pos.y));
    }
    // treasures
    this.treasures = [];
    const nTreasures = Math.min(5 + lv * 2, 24);
    for (let i = 0; i < nTreasures; i++) {
      const kind = this.pickTreasureType(lv);
      const pos = this.randSpawn();
      this.treasures.push(new Treasure(this, pos.x, pos.y, kind));
    }
    this.treasureRemaining = this.treasures.length;
    // boss level
    if (CFG.BOSS_LEVELS.includes(lv)) {
      const pos = this.randSpawn(true);
      this.boss = new Boss(this, pos.x, pos.y, lv === 5 ? 'treant' : 'dragon');
      this.enemies.push(this.boss);
    }
    this.weather.randomize();
    this.weatherTimer = U.rand(CFG.WEATHER_CHANGE[0], CFG.WEATHER_CHANGE[1]);
    this.powerupTimer = U.rand(CFG.POWERUP_INTERVAL[0], CFG.POWERUP_INTERVAL[1]);
    this.ui.updateHud();
    this.ui.hideAll();
    this.ui.showHud(true);
    this.ui.toast('level', `⬇ LEVEL ${lv}`);
    this.audio.startMusic();
    this.state = 'PLAYING';
  }
  pickEnemyType(lv) {
    if (lv <= 1) return U.pick([Slime, Slime, Bat]);
    if (lv <= 3) return U.pick([Slime, Bat, Skeleton]);
    if (lv <= 6) return U.pick([Slime, Bat, Skeleton, Goblin]);
    return U.pick(ENEMY_TYPES);
  }
  pickTreasureType(lv) {
    const pool = ['coin', 'coin', 'coin', 'coin'];
    if (lv >= 2) pool.push('diamond');
    if (lv >= 3) pool.push('diamond', 'ruby');
    if (lv >= 4) pool.push('emerald');
    if (lv >= 7) pool.push('chest');
    return U.pick(pool);
  }
  randSpawn(far = false) {
    const m = this.world;
    const pad = 300;
    const cx = m.w / 2, cy = m.h / 2;
    for (let i = 0; i < 40; i++) {
      const x = U.rand(pad, m.w - pad);
      const y = U.rand(pad, m.h - pad);
      if (far ? U.dist(x, y, cx, cy) > m.w * 0.32 : U.dist(x, y, cx, cy) > 260) {
        if (!m.isSolid(x, y, 20)) return { x, y };
      }
    }
    return { x: cx + 300, y: cy + 300 };
  }

  /* ---------- gameplay actions ---------- */
  doAttack(player) {
    player.attackCd = 0.34;
    player.attackT = 0.28;
    player.state = 'attack';
    this.audio.attack();
    // melee arc in front of player
    const cx = player.centerX() + player.facing * 46;
    const cy = player.centerY() - 4;
    this.particles.burst(cx, cy, 4, '#ffffff', 80, { gravity: 0 });
    this.camera.addShake(1.5);
    // hit all enemies in arc
    const dmg = 25 * player.buffs.dmg * (1 + (player.level - 1) * 0.05);
    let hitAny = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - player.centerX(), dy = e.y - player.centerY();
      if (Math.abs(dx) < 74 && Math.abs(dy) < 58) {
        hitAny = true;
        this.damageEnemy(e, dmg, player);
      }
    }
    if (hitAny) this.audio.hit();
  }
  damageEnemy(e, dmg, src) {
    if (e.dead) return;
    const wasHit = e.damage(dmg, src);
    const crit = Math.random() < 0.08;
    const shown = Math.round(dmg * (crit ? 2 : 1));
    if (crit) {
      this.burstText(e.x, e.y - 16, `CRIT ${shown}!`, '#ff7043', 20);
      this.particles.burst(e.x, e.y, 10, '#ff7043', 160, { gravity: 60 });
    } else {
      this.burstText(e.x, e.y - 16, `${shown}`, '#ffffff', 15);
    }
  }
  onEnemyKill(e, isBoss = false) {
    // combo
    this.comboAdd(1);
    this.comboKills++;
    // score
    const mult = this.combo >= 2 ? Math.min(this.combo, 8) : 1;
    const gain = e.scoreValue * mult;
    this.player.score += gain;
    this.burstText(e.x, e.y - 26, `+${gain}`, '#ffd54a', 16);
    // coin drop
    const coins = isBoss ? 12 : U.randInt(1, 3);
    for (let i = 0; i < coins; i++) {
      const a = U.rand(0, 6.28), sp = U.rand(60, 160);
      const tr = new Treasure(this, e.x, e.y, 'coin');
      tr.isDrop = true;
      tr.collected = false;
      tr.value = 10;
      tr.angle = 0;
      this.treasures.push(tr);
      // give it initial velocity that decays (handled by magnet-less update)
      tr._vx = Math.cos(a) * sp;
      tr._vy = Math.sin(a) * sp;
    }
    this.ui.updateHud();
    // achievements
    if (!isBoss) {
      if (!this._firstKill) { this._firstKill = true; this.achievement('first-kill'); }
    }
    Storage.set('totalKills', (Storage.get('totalKills') || 0) + 1);
    if ((Storage.get('totalKills') || 0) >= 50) this.achievement('kills');
    if (isBoss) {
      // boss drops big gold burst + many coins
      this.particles.burst(e.x, e.y, 50, '#ffd54a', 300, { gravity: 100 });
      this.treasures.forEach(() => {});
    }
  }
  onCoinDropUpdate(tr, dt) {
    // gravity on dropped coins so they arc out then get collected
    if (tr._vx !== undefined) {
      tr.x += tr._vx * dt;
      tr.y += tr._vy * dt;
      tr._vy += 300 * dt;
      if (tr._vy > 0 && tr.y > this.world.h - 10) { tr.y = this.world.h - 10; tr._vy = 0; tr._vx *= 0.8; }
      tr._vx *= 1 - 2.5 * dt;
      // stop bouncing quickly
      if (Math.abs(tr._vx) < 6 && Math.abs(tr._vy) < 20) { delete tr._vx; delete tr._vy; }
    }
  }
  /* floating damage / score */
  burstText(x, y, str, color, size) { this.texts.spawn(x, y, str, color, size); }
  /* combo */
  comboAdd(n) {
    this.comboT = CFG.COMBAT_TIMEOUT;
    this.combo += n;
    if (this.combo > 40) this.combo = 40;
    this.ui.updateCombo();
  }
  /* power-ups */
  applyPowerupStart(kind) {
    const p = this.player;
    if (kind === 'speed') p.buffs.speedMult = 1.6;
    else if (kind === 'double') p.buffs.coinMult = 2;
  }
  applyPowerupEnd(kind) {
    const p = this.player;
    if (kind === 'speed') p.buffs.speedMult = 1;
    else if (kind === 'double') p.buffs.coinMult = 1;
  }
  spawnPowerup() {
    const pos = this.randSpawn();
    this.powerups.push(new PowerUp(this, pos.x, pos.y));
  }
  spawnPortal() {
    if (this.portal) return;
    this.portal = new Portal(this);
    this.audio.portal();
    this.ui.toast('portal', '🌀 PORTAL APPEARED! GO!');
    this.camera.flash('#ab47bc', 0.3);
  }
  /* slow motion */
  setSlowMotion(scale, dur) {
    this.timeScale = scale;
    this.slowTimer = dur;
    this.slowmoQueue++;
  }

  /* ---------- input-driven actions ---------- */
  playerDash() {
    const p = this.player;
    if (p.dashCd > 0 || !p.alive) return;
    p.dashCd = 0.6;
    p.dashT = 0.18;
    const mv = this.input.moveVector();
    p.dashDx = (mv.x === 0 && mv.y === 0) ? p.facing : mv.x;
    p.dashDy = (mv.y === 0 && mv.x === 0) ? 0 : mv.y;
    const len = Math.hypot(p.dashDx, p.dashDy) || 1;
    p.dashDx /= len; p.dashDy /= len;
    p.invuln = Math.max(p.invuln, 0.25); // i-frames while dashing
    this.audio.dash();
    this.particles.burst(p.centerX(), p.centerY(), 8, '#ffd54a', 120, { gravity: 0 });
    this.dashTimes++;
    if (this.dashTimes >= 100) this.achievement('dashes');
  }
  playerAttack() { if (this.state === 'PLAYING' && this.player.attackCd <= 0) this.doAttack(this.player); }

  onKeyDown(e) {
    // ESC pause toggle
    if (e.code === 'Escape') {
      if (this.state === 'PLAYING') this.pause();
      else if (this.state === 'PAUSED') this.resume();
    }
    if (e.code === 'Space' && this.state === 'PLAYING') this.playerDash();
    if (e.code === 'F3') {
      this.debug = !this.debug;
      this.ui.toast('debug', this.debug ? '🐞 DEBUG ON' : '🐞 DEBUG OFF');
    }
    if (e.code === 'F2') this.screenshot();
    if (e.code === 'KeyM') {
      const m = this.audio.toggleMute();
      document.getElementById('btn-mute').textContent = m ? '🔇' : '🔊';
    }
    if (e.code === 'KeyR' && (this.state === 'GAMEOVER' || this.state === 'VICTORY')) this.restart();
  }
  screenshot() {
    const url = this.canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'treasure-hunter.png';
    a.click();
    this.ui.toast('shot', '📸 Screenshot saved!');
  }
  pause() {
    if (this.state !== 'PLAYING') return;
    this.state = 'PAUSED';
    this.audio.stopMusic();
    this.ui.show('pause');
  }
  resume() {
    if (this.state !== 'PAUSED') return;
    this.state = 'PLAYING';
    this.audio.startMusic();
    this.ui.hideAll();
  }

  /* ---------- level flow ---------- */
  completeLevel() {
    if (this.state !== 'PLAYING') return;
    this.audio.win();
    this.camera.flash('#ffd54a', 0.4);
    // camera zoom-in on win (animated via tween, plays during LEVELCOMPLETE state)
    this.tweens.add(this.camera, 'zoom', this.camera.zoom, 1.7, 0.6, U.easeInOut,
      () => this.tweens.add(this.camera, 'zoom', this.camera.zoom, this.camera.computeZoom(), 0.6, U.easeInOut));
    this.particles.confetti(this.player.centerX(), this.player.centerY() - 40, 60);
    const levelClear = 1 + (this.level - 1) * 100;
    const timeBonus = Math.max(0, Math.round((this.level * 40 - this.levelTimer) * 5));
    const starTime = 40 + this.level * 12;
    let stars = 1;
    if (this.levelTimer < starTime) stars++;
    if (this.levelTimer < starTime * 0.6 && this.player.hp > this.player.maxHp * 0.5) stars = 3;
    this.player.score += levelClear + timeBonus;
    // persist
    this.saveProgress();
    this.state = 'LEVELCOMPLETE';
    this._nextStars = stars;
    const m = Math.floor(this.levelTimer / 60), s = Math.floor(this.levelTimer % 60);
    this.ui.showStars(stars);
    this.$set('lc-score', this.player.score);
    this.$set('lc-coin', this.player.coin);
    this.$set('lc-time', `${m}:${s.toString().padStart(2, '0')}`);
    setTimeout(() => this.ui.show('levelcomplete'), 900);
  }
  $set(id, val) { document.getElementById(id).textContent = val; }
  nextLevel() {
    this._carryScore = this.player.score;
    this._carryCoin = this.player.coin;
    if (this.level >= CFG.LEVELS) {
      this.showVictory();
      return;
    }
    this.buildLevel(this.level + 1);
  }
  showVictory() {
    this.audio.win();
    this.$set('vic-score', this.player.score);
    this.$set('vic-coin', this.player.coin);
    this.saveProgress();
    this.state = 'VICTORY';
    this.ui.showHud(false);
    this.ui.show('victory');
  }
  showGameOver() {
    this.state = 'GAMEOVER';
    this.audio.lose();
    this.$set('go-score', this.player.score);
    this.$set('go-coin', this.player.coin);
    this.$set('go-level', this.level);
    this.saveProgress();
    this.ui.showHud(false);
    this.ui.show('gameover');
  }
  saveProgress() {
    const d = Storage;
    d.set('highScore', Math.max(d.get('highScore') || 0, this.player.score));
    d.set('level', Math.max(d.get('level') || 1, this.level));
    d.set('totalCoin', (d.get('totalCoin') || 0) + this.totalGain);
    d.set('coin', this.player.coin);
  }
  /* ---------- flow helpers ---------- */
  startGame() {
    this.audio.ensure();
    this.audio.startMusic();
    this._carryScore = 0;
    this._firstKill = false;
    this.dashTimes = Storage.get('dashCount') || 0;
    this.buildLevel(Math.min(Storage.get('level') || 1, CFG.LEVELS));
    this.ui.hideAll();
    this.ui.showHud(true);
  }
  restart() {
    this.startGame();
  }
  toMenu() {
    this.audio.stopMusic();
    this.audio.click();
    this.state = 'MENU';
    this.saveProgress();
    this.ui.showHud(false);
    this.ui.hideAll();
    this.ui.show('menu');
    this.ui.refreshHighscore();
  }
  achievement(id) { return this.achievements.unlock(id); }
  toast(kind, msg) { this.ui.toast(kind, msg); }

  /* ---------- main loop ---------- */
  loop(ts) {
    requestAnimationFrame(this.loop);
    const now = ts / 1000;
    if (this._lastTs === undefined) this._lastTs = now;
    let dt = U.clamp(now - this._lastTs, 0, 0.05);
    this._lastTs = now;
    // fps
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 0.5) {
      this.fps = this._fpsN / this._fpsAcc;
      this._fpsN = 0; this._fpsAcc = 0;
      this.ui.updateFps(this.fps);
    }
    // slow motion decay
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.timeScale = 1;
    }
    const sdt = dt * this.timeScale;
    this.time += sdt;
    if (this.state === 'PLAYING') {
      this.levelTimer += sdt;
      this.comboT -= sdt;
      if (this.comboT <= 0) { this.combo = 0; this.ui.updateCombo(); }
      this.update(sdt, dt);
    } else if (this.state === 'MENU' || this.state === 'LEVELCOMPLETE' || this.state === 'GAMEOVER' || this.state === 'VICTORY') {
      // keep ambient particles/tweens alive behind menus
      this.particles.update(sdt);
      this.texts.update(sdt);
      this.tweens.update(sdt);
    }
    this.render();
    this.input.endFrame();
  }
  update(dt, rawDt) {
    const p = this.player;
    // player
    p.update(dt);
    // enemy AI + projectiles
    this.enemiesChasing = false;
    for (const e of this.enemies) {
      if (!e.dead) {
        e.update(dt);
        if (e.isBoss) e.roar();
      }
    }
    this.enemies = this.enemies.filter(e => !e.dead);
    for (const pr of this.projectiles) pr.update(dt);
    this.projectiles = this.projectiles.filter(pr => !pr.dead && pr.life > 0);
    // treasures
    for (const t of this.treasures) {
      if (!t.collected) {
        this.onCoinDropUpdate(t, dt);
        t.update(dt);
      }
    }
    this.treasures = this.treasures.filter(t => !t.collected);
    // powerups
    for (const pu of this.powerups) pu.update(dt);
    this.powerups = this.powerups.filter(pu => !pu.dead);
    this.powerupTimer -= dt;
    if (this.powerupTimer <= 0) {
      this.spawnPowerup();
      this.powerupTimer = U.rand(CFG.POWERUP_INTERVAL[0], CFG.POWERUP_INTERVAL[1]);
    }
    // portal
    if (this.portal) this.portal.update(dt);
    // weather + random events
    this.weather.update(dt);
    this.weather.tickLightning();
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weather.randomize();
      this.maybeRandomEvent();
      this.weatherTimer = U.rand(CFG.WEATHER_CHANGE[0], CFG.WEATHER_CHANGE[1]);
    }
    // particles + text + tweens
    this.particles.update(dt);
    this.texts.update(dt);
    this.tweens.update(dt);
    // camera
    this.camera.targetZoom = this.camera.computeZoom();
    this.camera.follow(dt);
    // HUD
    this.ui.updateTimer(this.levelTimer);
    this.ui.updateHud();
    this.ui.updatePowerups();
    this.ui.drawMinimap();
    // achievements
    if ((Storage.get('totalCoin') || 0) >= 500) this.achievement('rich');
  }
  maybeRandomEvent() {
    const r = Math.random();
    if (r < 0.25) {
      // treasure rain — a few coins fall
      this.ui.toast('event', '🎉 TREASURE RAIN!');
      const drops = this.portal ? true : false;
      for (let i = 0; i < 6; i++) {
        const x = U.rand(200, this.world.w - 200);
        const y = U.rand(200, this.world.h - 200);
        const t = new Treasure(this, x, y, U.pick(['coin', 'coin', 'diamond']));
        t.isDrop = drops;
        this.treasures.push(t);
      }
      if (!this.portal) {
        this.treasureRemaining = this.treasures.filter(t => !t.isDrop).length;
        this.ui.updateHud();
      }
    } else if (r < 0.5) {
      this.ui.toast('event', '⚔ ENEMY SWARM!');
      for (let i = 0; i < 3; i++) {
        const kind = U.pick([Slime, Bat, Goblin]);
        const pos = this.randSpawn();
        this.enemies.push(new kind(this, pos.x, pos.y));
      }
    } else if (r < 0.75) {
      this.ui.toast('event', '💨 SPEED WIND!');
      this.player.powerups['speed'] = Math.max(this.player.powerups['speed'] || 0, 8);
      this.applyPowerupStart('speed');
    }
  }
  /* ---------- rendering ---------- */
  render() {
    const ctx = this.ctx;
    const dpr = this._dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // clear + letterbox background fill
    ctx.fillStyle = '#10241a';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    const cam = this.camera;
    // parallax background (screen space)
    this.world.drawBackground(ctx);
    // world space
    cam.apply(ctx);
    this.world.drawGround(ctx, cam);
    // shadow of big props drawn in decor; draw enemies below player? draw order:
    this.world.drawDecor(ctx, cam);
    // treasures
    for (const t of this.treasures) if (!t.collected) t.draw(ctx);
    // powerups
    for (const pu of this.powerups) pu.draw(ctx);
    // enemies
    for (const e of this.enemies) if (!e.dead) e.draw(ctx);
    // projectiles
    for (const pr of this.projectiles) pr.draw(ctx);
    // portal
    if (this.portal) this.portal.draw(ctx);
    // player
    this.player.draw(ctx);
    // particles (world space)
    this.particles.draw(ctx);
    // floating texts
    this.texts.draw(ctx);
    // reset to screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // lighting — player-centered glow (stronger at night)
    this.drawLighting(ctx);
    // weather overlay
    this.weather.draw(ctx);
    // boss health bar
    this.drawBossBar(ctx);
    // camera flash
    if (cam.flashA > 0) {
      ctx.globalAlpha = cam.flashA;
      ctx.fillStyle = cam.flashColor;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalAlpha = 1;
    }
    // vignette
    this.drawVignette(ctx);
    // debug overlay
    if (this.debug) this.drawDebug(ctx);
  }
  drawLighting(ctx) {
    const cam = this.camera;
    const dpr = this._dpr || 1;
    const p = this.player;
    const px = cam.screenX(p.centerX()) / dpr;
    const py = cam.screenY(p.centerY()) / dpr;
    const night = this.weather.type === 'night' || this.weather.type === 'lightning';
    const strong = night ? 0.55 : 0.22;
    const r = Math.max(window.innerWidth, window.innerHeight) * (night ? 1.1 : 1.6);
    const g = ctx.createRadialGradient(px, py, 60, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,10,${strong})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }
  drawVignette(ctx) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.45, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  }
  drawBossBar(ctx) {
    if (this.state !== 'PLAYING' || !this.boss || this.boss.dead) return;
    const b = this.boss;
    const w = Math.min(420, window.innerWidth - 40);
    const x = (window.innerWidth - w) / 2, y = 66;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 4, y - 4, w + 8, 30);
    ctx.fillStyle = '#b71c1c';
    ctx.fillRect(x, y, w, 22);
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, '#ff5252');
    grad.addColorStop(1, '#ff8a65');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w * U.clamp(b.hp / b.maxHp, 0, 1), 22);
    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, 22);
    ctx.font = '800 14px Rubik, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 4;
    ctx.strokeText(b.bossName, window.innerWidth / 2, y - 8);
    ctx.fillText(b.bossName, window.innerWidth / 2, y - 8);
    // special attack warning pulse
    if (b.specialCd < 1) {
      ctx.globalAlpha = 0.3 + Math.sin(this.time * 12) * 0.2;
      ctx.fillStyle = '#ff5252';
      ctx.fillRect(x, y, w, 22);
      ctx.globalAlpha = 1;
    }
  }
  drawDebug(ctx) {
    ctx.font = '12px monospace';
    ctx.fillStyle = '#7fffa0';
    ctx.textAlign = 'left';
    let ly = 20;
    const lines = [
      `FPS ${Math.round(this.fps)}`,
      `state ${this.state}`,
      `level ${this.level}`,
      `pos ${Math.round(this.player.x)},${Math.round(this.player.y)}`,
      `enemies ${this.enemies.length}`,
      `treasure ${this.treasures.length}`,
      `particles ${this.particles.pool.items.length}`,
      `weather ${this.weather.type}`,
      `combo ${this.combo}`,
    ];
    for (const l of lines) { ctx.fillText(l, 12, ly); ly += 16; }
  }
}

/* =========================================================================
   End of file
   ========================================================================= */