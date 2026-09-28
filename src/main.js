// Orchard Merge — browser front-end. Sections:
// 1. Config & palettes  2. Persistence  3. Audio  4. Three.js scene
// 5. Game session (modes, journey, replay)  6. Input  7. Screens/UI  8. Main loop
import * as THREE from 'three';
import { zipStore, unzipFirstEntry, bytesToBase64 } from './zip.js';
import { PRESETS, CATEGORIES, SHADOW_MAP, PARTICLE_COUNT, detectPreset, resolve, presetTier, describe, choosePreset } from './gfx.js';
import { pickLocale, translator } from './gfx-i18n.js';
import { makeTextures, disposeTextures, makeEnvironment, buildOrchard, Motes, Bursts, PostChain } from './render-gfx.js';

const R = globalThis.OrchardRules;
const { STEP_MS, WORLD_W, WORLD_H, WARN_Y, TIER_R } = R;

// ---------------- 1. Config & palettes ----------------
const CONFIG = {
  camPos: [26, 26, 42], camTarget: [10, 12, 0], fov: 38,
  dailyEpoch: '2025-01-01',
};
// distinct color per tier; marker = number of little leaves (colorblind-safe cue)
const PALETTES = {
  default:      [null,'#ff5a5a','#ff9440','#ffd23f','#a3e048','#37c871','#34c6c9','#4d8dff','#8a6fe8','#d96bd0','#ff7ab0'],
  citrus:       [null,'#e8483f','#f27038','#f79d2f','#ffb627','#ffd23f','#f4e04d','#a8c256','#6a9c59','#3e7c4f','#2f5d3a'],
  pastel:       [null,'#f4a9b8','#f6bd97','#f9e29c','#c8e6a0','#9dd8b0','#a0d8d8','#a3c4f3','#b8a9e8','#d8b4e2','#efb9d4'],
  'night-orchard': [null,'#b33951','#c2543a','#d07a2e','#d69f2d','#b8b52e','#7fb069','#3d9971','#2f7f8f','#3a5fa8','#5a3d8f'],
  deuteranopia: [null,'#d55e00','#e69f00','#f0e442','#009e73','#56b4e9','#0072b2','#332288','#cc79a7','#88ccee','#ffffff'],
};
const TIER_NAMES = [null,'Cherry','Strawberry','Plum','Orange','Apple','Pear','Peach','Grapefruit','Melon','Pumpkin'];

// Small static achievement set (spec §6): first completion, mechanic mastery,
// a sustained streak, a difficult content milestone, and a long-term goal.
// Keys are stable lowercase identifiers; unlocks are idempotent.
const ACHIEVEMENTS = {
  'first-completion': 'First harvest — complete any run',
  'merge-master': 'Mechanic mastery — merge up to tier 8',
  'daily-streak-3': 'Regular picker — play the daily on 3 different days',
  'journey-complete': 'Milestone — clear journey stage 40',
  'orchard-keeper': 'Long game — 25,000 lifetime points',
};

// ---------------- 2. Persistence ----------------
const SAVE_KEY = 'orchard-merge-save-v1';
const SAVE_VERSION = 1;
function checksum(obj) {
  const s = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
function defaultSave() {
  return {
    version: SAVE_VERSION, sum: 0,
    settings: { music: 0.5, sfx: 0.8, amb: 0.4, mute: false, haptics: true,
      gfx: { preset: 'auto' }, palette: 'default', reducedMotion: false, highContrast: false,
      largerText: false, tutorialDone: false },
    journey: { unlocked: 1, cleared: {} },
    daily: {},            // 'YYYY-MM-DD' -> {score, hash}
    leaderboard: [],      // {mode, score, seed, difficulty, hash, replay, date}
    resume: null,         // {snap, commands, mode, modeOpts, savedAt}
  };
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw);
    if (d.version !== SAVE_VERSION || d.sum !== checksum({ ...d, sum: 0 })) return defaultSave();
    return d;
  } catch { return defaultSave(); }
}
// Graphics settings moved from a single low/med/high `quality` to the gfx.js model.
function migrateSettings(st) {
  if (!st.gfx || typeof st.gfx !== 'object') {
    st.gfx = { preset: st.quality === 'low' ? 'low' : st.quality === 'high' ? 'high' : 'auto' };
  }
  delete st.quality;
}
let save = loadSave();
migrateSettings(save.settings);
save.achievements = save.achievements || {};   // added after v1 saves shipped; checksum tolerates it
save.lifetime = save.lifetime || 0;
function unlock(key) {
  if (!ACHIEVEMENTS[key] || save.achievements[key]) return false;
  save.achievements[key] = new Date(now()).toISOString();
  announce(`Achievement unlocked: ${ACHIEVEMENTS[key]}.`);
  run.newAchievements.push(key);
  return true;
}
function persist() {
  try {
    const d = { ...save, sum: 0 };
    d.sum = checksum(d);
    save.sum = d.sum;
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
  } catch { /* storage full/blocked — play on without persistence */ }
  platform.scheduleCloudPush();
}

// ---------------- 2b. StarHermit platform adapter ----------------
// Token-aware same-origin API client with graceful offline fallback. Hosted
// mode activates iff a launch token was read from the URL fragment.
const SYNC_LABELS = {
  saving: 'cloud save: saving…',
  synced: 'cloud save: synced',
  error: 'cloud save unreachable — progress is safe on this device',
  offline: 'connecting…',
};

// Launch token: `#game_token=<jwt>` (optional `&session_id=`), read once and
// stripped. Query-param fallbacks exist for local dev only.
function readLaunchToken() {
  let token = null;
  if (window.location.hash.length > 1) {
    const params = new URLSearchParams(window.location.hash.slice(1));
    token = params.get('game_token');
    if (token) {
      params.delete('game_token');
      const rest = params.toString();
      history.replaceState(null, '', window.location.pathname + window.location.search + (rest ? '#' + rest : ''));
    }
  }
  if (!token) {
    const q = new URLSearchParams(window.location.search);
    token = q.get('game_token') || q.get('token') || q.get('launch') || q.get('launch_token');
  }
  return token;
}

// JWT payload decode (no verify): sub = user id, game_scope = this game's slug.
function decodeLaunchToken(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return { sub: json.sub, slug: json.game_scope };
  } catch { return {}; }
}

const launchToken = readLaunchToken();
const claims = launchToken ? decodeLaunchToken(launchToken) : {};

const platform = {
  timeOffsetMs: 0,            // server - client, ms
  online: false,
  token: launchToken,
  sub: claims.sub || null,
  slug: claims.slug || null,
  hosted: !!(launchToken && claims.sub && claims.slug),
  nickname: null,
  syncState: 'offline',       // offline | saving | synced | error
  _pushTimer: null, _pushing: false, _adopting: false,
  _lastSig: null, _refreshTimer: null,
  _profileCache: new Map(),

  authHeaders() {
    return this.token ? { Authorization: 'Bearer ' + this.token } : {};
  },
  setSync(state) {
    this.syncState = state;
    updateProfileLine();
  },
  now() { return Date.now() + this.timeOffsetMs; },

  // Round-trip-adjusted server clock for dailies and timestamps.
  async fetchTime() {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { headers: this.authHeaders() });
      const t1 = Date.now();
      if (!res.ok) return;
      const j = await res.json();
      const serverMs = typeof j === 'number' ? j : (j.now ?? j.time ?? j.ms);
      if (typeof serverMs === 'number') this.timeOffsetMs = serverMs - (t0 + t1) / 2;
      this.online = true;
    } catch { this.online = false; }
  },
  async get(path) {
    const res = await fetch(path, { headers: this.authHeaders() });
    if (res.status === 429) throw new Error('rate-limited');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'request-failed');
    return data;
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 429) throw new Error('rate-limited');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'request-failed');
    return data;
  },

  // Nickname from the user profile; NEVER /api/v1/me, never usernames.
  async fetchNickname(userId) {
    if (this._profileCache.has(userId)) return this._profileCache.get(userId);
    let name = 'Player ' + String(userId).slice(0, 8);
    try {
      const data = await this.get('/api/v1/users/' + userId + '/profile');
      if (data && typeof data.nickname === 'string' && data.nickname) name = data.nickname;
    } catch { /* keep fallback */ }
    this._profileCache.set(userId, name);
    return name;
  },
  async fetchProfile() {
    this.nickname = await this.fetchNickname(this.sub);
    updateProfileLine();
  },

  // Token lifetime is 60 min; re-mint scoped tokens every 45 min, retry ~60 s.
  async refreshToken() {
    clearTimeout(this._refreshTimer);
    if (!this.hosted) return;
    try {
      const data = await this.post('/api/v1/games/' + this.slug + '/launch-token', {});
      if (data && typeof data.token === 'string' && data.token) this.token = data.token;
      this._refreshTimer = setTimeout(() => this.refreshToken(), 45 * 60 * 1000);
    } catch {
      this._refreshTimer = setTimeout(() => this.refreshToken(), 60 * 1000);
    }
  },

  // ---- cloud save: ONE slot, zip+base64. localStorage stays the offline
  // cache; the cloud slot is a mirror and wins on load conflict. ----
  buildSaveDoc() {
    const { sum, ...rest } = save;
    return { version: SAVE_VERSION, savedAt: new Date().toISOString(), save: rest };
  },
  saveSignature(doc) { return JSON.stringify(doc.save); },
  scheduleCloudPush() {
    if (!this.hosted || this._adopting) return;
    clearTimeout(this._pushTimer);
    this.setSync('saving');
    this._pushTimer = setTimeout(() => this.flushCloud(), 2000);
  },
  async flushCloud() {
    if (!this.hosted || this._pushing) return;
    clearTimeout(this._pushTimer);
    const doc = this.buildSaveDoc();
    const sig = this.saveSignature(doc);
    if (sig === this._lastSig && this.syncState === 'synced') return;
    this._pushing = true;
    try {
      const bytes = zipStore('save.json', new TextEncoder().encode(JSON.stringify(doc)));
      const res = await fetch('/api/v1/me/cloud-saves/' + this.slug, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ dataBase64: bytesToBase64(bytes) }),
        keepalive: true,
      });
      if (!res.ok) throw new Error('cloud-save-failed');
      this._lastSig = sig;
      this.setSync('synced');
    } catch {
      this.setSync('error');
    } finally {
      this._pushing = false;
    }
  },
  async loadCloud() {
    if (!this.hosted) return;
    try {
      const res = await fetch('/api/v1/me/cloud-saves/' + this.slug, { headers: this.authHeaders() });
      if (res.status === 404) {   // no remote save yet: push the local doc
        this._lastSig = null;
        await this.flushCloud();
        return;
      }
      if (!res.ok) throw new Error('cloud-load-failed');
      const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(new Uint8Array(await res.arrayBuffer()))));
      if (!doc || typeof doc !== 'object' || !doc.save || typeof doc.save !== 'object' || !doc.save.settings) {
        throw new Error('bad-cloud-doc');
      }
      this.adoptRemote(doc);
      this.setSync('synced');
    } catch {
      this.setSync('error');
    }
  },
  adoptRemote(doc) {
    this._adopting = true;
    try {
      for (const k of Object.keys(save)) delete save[k];
      Object.assign(save, JSON.parse(JSON.stringify(doc.save)));
      save.achievements = save.achievements || {};
      save.lifetime = save.lifetime || 0;
      save.version = SAVE_VERSION;
      migrateSettings(save.settings);
      persist();               // rewrites the local cache; push skipped while adopting
      this._lastSig = this.saveSignature(this.buildSaveDoc());
      applySettingsOnlyLooks();
      audio.applyVolumes();
      applyGraphics();   // rebuilds the scene only if palette/scene-level tiers changed
      gotoTitle();
    } finally {
      this._adopting = false;
    }
  },

  // Read-only platform leaderboard; null when none exists or unreachable.
  // Clients can never submit to it (script/elo-owned per the wiki).
  async fetchLeaderboard(pageSize = 50) {
    if (!this.hosted) return null;
    try {
      const game = await this.get('/api/v1/games/' + this.slug);
      if (!game || !game.leaderboardId) return null;
      const data = await this.get('/api/v1/leaderboards/' + game.leaderboardId +
        '/entries?friendsOnly=&page=1&pageSize=' + pageSize);
      const entries = data.entries || data.items || [];
      const rows = [];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const id = e.userId || e.user_id || null;
        rows.push({
          rank: e.rank != null ? e.rank : i + 1,
          name: id ? await this.fetchNickname(id) : (e.name || 'Player'),
          score: e.score,
        });
      }
      return rows;
    } catch { return null; }
  },
};

// Host time offset comes from the platform clock (see §6 of the spec).
async function syncServerTime() { await platform.fetchTime(); }
const now = () => platform.now();
const utcDateStr = () => new Date(now()).toISOString().slice(0, 10);

// ---------------- 3. Audio (sampled one-shots + synthesized fallbacks) ----------------
const audio = (() => {
  let ctx = null, master, musicG, sfxG, ambG, ambNodes = null;
  // Authored one-shot samples (sfx/<name>.opus, see sfx/manifest.json), lazily
  // fetched + decoded after the user-gesture unlock in ensure(). Each event
  // prefers its mapped sample; synthesis below runs only while a sample is
  // still loading or failed to load.
  const sampleBufs = new Map();     // name -> AudioBuffer
  const samplePending = new Set();  // names with a fetch/decode in flight
  const sampleFailed = new Set();   // names that failed (fall back to synth)
  function loadSample(name) {
    if (!ctx || sampleBufs.has(name) || samplePending.has(name) || sampleFailed.has(name)) return;
    samplePending.add(name);
    fetch('./sfx/' + name + '.opus')
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
      .then(ab => ctx.decodeAudioData(ab))
      .then(buf => sampleBufs.set(name, buf))
      .catch(() => sampleFailed.add(name))
      .finally(() => samplePending.delete(name));
  }
  function sample(name) { // true = sample played; false = caller should synthesize
    if (!ctx) return false;
    const buf = sampleBufs.get(name);
    if (!buf) { loadSample(name); return false; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(sfxG);
    src.start();
    return true;
  }
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.connect(ctx.destination);
      musicG = ctx.createGain(); sfxG = ctx.createGain(); ambG = ctx.createGain();
      musicG.connect(master); sfxG.connect(master); ambG.connect(master);
      applyVolumes();
      startAmbience();
      return true;
    } catch { return false; }
  }
  function applyVolumes() {
    if (!ctx) return;
    const s = save.settings, m = s.mute ? 0 : 1;
    musicG.gain.value = s.music * m; sfxG.gain.value = s.sfx * m; ambG.gain.value = s.amb * m;
  }
  function env(g, t, a, d, peak = 1) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.001, t + a + d);
  }
  function blip(dest, freq, dur, type = 'sine', peak = 0.3, t = null) {
    if (!ctx) return;
    t = t ?? ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(dest); env(g, t, 0.005, dur, peak);
    o.start(t); o.stop(t + dur + 0.1);
  }
  function thud(tier) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(180 + tier * 18, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    o.connect(g); g.connect(sfxG); env(g, t, 0.004, 0.16, 0.4);
    o.start(t); o.stop(t + 0.3);
  }
  function startAmbience() {
    if (ambNodes || !ctx) return;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.06;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(ambG);
    src.start(); lfo.start();
    ambNodes = { src, lfo };
  }
  return {
    ensure, applyVolumes,
    click() { if (sample('ui-click')) return; blip(sfxG, 900, 0.05, 'square', 0.12); },
    drop() { if (sample('fruit-drop')) return; blip(sfxG, 300, 0.08, 'triangle', 0.2); },
    thud(tier) { if (sample('fruit-thud')) return; thud(tier); },
    merge(tier) {
      if (!ctx) return;
      const name = tier <= 3 ? 'merge-small' : tier <= 6 ? 'merge-medium' : 'merge-large';
      if (sample(name)) return;
      const base = 300 * Math.pow(1.13, tier);
      const t = ctx.currentTime;
      blip(sfxG, base, 0.25, 'sine', 0.3, t);
      blip(sfxG, base * 1.5, 0.3, 'sine', 0.2, t + 0.06);
      thud(tier);
    },
    warn() { if (sample('warn-alert')) return; blip(sfxG, 220, 0.4, 'sawtooth', 0.15); },
    invalid() { if (sample('invalid-action')) return; blip(sfxG, 140, 0.15, 'square', 0.15); },
    fanfare(win) {
      if (!ctx) return;
      if (sample(win ? 'fanfare-win' : 'fanfare-lose')) return;
      const t = ctx.currentTime;
      const notes = win ? [523, 659, 784, 1047] : [392, 330, 262, 196];
      notes.forEach((f, i) => blip(musicG, f, 0.35, 'triangle', 0.28, t + i * 0.14));
    },
    countdown(n) {
      if (sample(n === 0 ? 'countdown-go' : 'countdown-tick')) return;
      blip(sfxG, n === 0 ? 880 : 440, 0.12, 'sine', 0.25);
    },
  };
})();
function vibrate(pattern) {
  if (save.settings.haptics && navigator.vibrate) try { navigator.vibrate(pattern); } catch {}
}

// ---------------- 4. Three.js scene ----------------
const canvas = document.getElementById('gl');
const stageEl = document.getElementById('stage');
let renderer, scene, camera, hemi, dirLight, warnLine, ghostFruit, guideLine, hintMarker;
let fruitMeshes = new Map();   // fruit id -> THREE.Group
let fruitRes = null;           // shared per-tier geometry/materials for the current scene
let textures = null, envRT = null, post = null, bursts = null, motes = null;
let ghostTier = 0, lastStateRef = null, freshSync = true;
let shakeAmp = 0;
const tmpV = new THREE.Vector3();
const GROUND_Y = -9;           // the stall table stands on the grass
const CRATE_D = 5.8;           // crate half-depth: holds the largest fruit
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const motionOK = () => !save.settings.reducedMotion && !reducedMotionQuery.matches;

// Graphics state: resolved quality (gfx.js), GPU, adaptive resolution and frame timing.
const gfx = {
  gpu: '', detected: 'balanced', q: null, sceneKey: null,
  adaptiveScale: 1, frames: [], fps: 0, pixelRatio: 1, size: [0, 0],
};

// Camera framing: keep the authored 3/4 direction, but derive the distance
// from the viewport so the whole crate — including the drop preview above the
// rim and the warning line — stays on screen at any aspect ratio.
const CAM_DIR = new THREE.Vector3(...CONFIG.camPos).sub(new THREE.Vector3(...CONFIG.camTarget)).normalize();
const CAM_TARGET = new THREE.Vector3(WORLD_W / 2, (WORLD_H + 2) / 2, 0);
const CAM_HALF_H = (WORLD_H + 4) / 2;   // -1 .. WORLD_H + 3 (rim + ghost fruit)
const CAM_HALF_W = (WORLD_W + 6) / 2;   // crate plus a little stall margin
const camBase = new THREE.Vector3();
function fitCamera() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const dist = Math.max(CAM_HALF_H / t, CAM_HALF_W / (t * Math.max(0.2, camera.aspect))) * 1.15;
  camBase.copy(CAM_DIR).multiplyScalar(dist).add(CAM_TARGET);
  camera.position.copy(camBase);
  camera.lookAt(CAM_TARGET);
}

function initRenderer() {
  // One context for the page's lifetime; MSAA (when chosen) runs on the composer target.
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  post = new PostChain(renderer);
  try {
    const gl = renderer.getContext();
    // Firefox exposes the real name on RENDERER (and warns about the debug extension).
    const ext = /firefox/i.test(navigator.userAgent) ? null : gl.getExtension('WEBGL_debug_renderer_info');
    gfx.gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
  } catch { gfx.gpu = ''; }
  const touchFirst = (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) ||
    /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  gfx.detected = detectPreset(gfx.gpu, { mobile: touchFirst });
}

function disposeScene() {
  if (!scene) return;
  const geos = new Set(), mats = new Set();
  scene.traverse(o => {
    if (o.geometry) geos.add(o.geometry);
    if (o.material) for (const m of [].concat(o.material)) mats.add(m);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  disposeTextures(textures);
  textures = null; fruitRes = null; bursts = null; motes = null; ghostTier = 0;
  fruitMeshes.clear();
  scene = null;
}

function buildScene() {
  const q = gfx.q;
  const detailed = q.detail === 'detailed';
  disposeScene();
  freshSync = true;
  textures = makeTextures();
  scene = new THREE.Scene();
  if (detailed) {
    scene.background = textures.sky;
    scene.fog = new THREE.Fog(0xe4efe2, 150, 380);
  } else {
    scene.background = new THREE.Color(0xbfe3ff);
    scene.fog = new THREE.Fog(0xbfe3ff, 150, 320);
  }
  if (q.reflections === 'on') {
    envRT = envRT || makeEnvironment(renderer);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.22;
  }

  camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, 0.5, 600);

  // Warm sun (key) with PCF shadows fitted to the stall, plus a sky/grass hemisphere fill.
  hemi = new THREE.HemisphereLight(0xfff3dc, 0x5f7d4c, q.reflections === 'on' ? 0.75 : 0.95);
  scene.add(hemi);
  dirLight = new THREE.DirectionalLight(0xffe4bd, 2.0);
  dirLight.position.copy(CAM_TARGET).add(new THREE.Vector3(15, 29, 30).normalize().multiplyScalar(70));
  dirLight.target.position.copy(CAM_TARGET);
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.04;
  scene.add(dirLight, dirLight.target);
  fitShadowFrustum();

  const T = textures;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const woodMat = detailed ? std({ color: 0xffffff, map: T.wood, roughness: 0.75 }) : std({ color: 0x8a5a33, roughness: 0.8 });
  const darkWood = detailed ? std({ color: 0x9a8070, map: T.wood, roughness: 0.8 }) : std({ color: 0x6e4526, roughness: 0.85 });
  const box = (w, h, d, mat, x, y, z, { cast = true, receive = true } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = receive;
    scene.add(m);
    return m;
  };

  // grass
  const ground = new THREE.Mesh(new THREE.CircleGeometry(420, 64),
    detailed ? std({ color: 0xffffff, map: T.grass, roughness: 1 }) : std({ color: 0x7aa05c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND_Y; ground.receiveShadow = true;
  scene.add(ground);

  // market table: plank top on four legs
  const tableW = WORLD_W + 14, tableD = CRATE_D * 2 + 6;
  box(tableW, 1.2, tableD, woodMat, WORLD_W / 2, -0.9, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(1.1, -1.5 - GROUND_Y, 1.1, darkWood, WORLD_W / 2 + sx * (tableW / 2 - 1.2), (GROUND_Y - 1.5) / 2, sz * (tableD / 2 - 1.2));
  }

  // stall: four posts, cream back cloth, striped awning with a scalloped valance
  const postX = [-7.5, WORLD_W + 7.5], postZ = [-9.2, 9];
  for (const x of postX) for (const z of postZ) box(1.1, 37 - GROUND_Y, 1.1, darkWood, x, (37 + GROUND_Y) / 2, z);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(tableW + 1, 38),
    detailed ? std({ color: 0xe6dcc6, map: T.cloth, roughness: 0.95, envMapIntensity: 0.4 }) : std({ color: 0xe6dcc4, roughness: 0.95 }));
  cloth.position.set(WORLD_W / 2, 17.5, -8.9); cloth.receiveShadow = true;
  scene.add(cloth);
  const awningMat = detailed ? std({ color: 0xffffff, map: T.awning, roughness: 0.9 }) : std({ color: 0xd66a4a, roughness: 0.9 });
  // the awning casts no shadow, so the playfield stays evenly lit under it
  const awning = box(tableW + 4, 0.4, 22, awningMat, WORLD_W / 2, 38, 0.5, { cast: false });
  awning.rotation.x = 0.1;
  if (detailed) {
    const valance = new THREE.Mesh(new THREE.PlaneGeometry(tableW + 4, 2.4),
      std({ color: 0xffffff, map: T.valance, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }));
    valance.position.set(WORLD_W / 2, 36.4, 11.5);
    scene.add(valance);
  }

  // the crate: wooden floor and corner frame, clear glass panes (no front pane)
  box(WORLD_W + 0.8, 0.3, CRATE_D * 2, woodMat, WORLD_W / 2, -0.15, 0, { cast: false });
  const frameH = WORLD_H + 2;
  for (const x of [-0.45, WORLD_W + 0.45]) for (const z of [-CRATE_D, CRATE_D]) {
    box(0.4, frameH, 0.4, darkWood, x, frameH / 2, z);
  }
  for (const z of [-CRATE_D, CRATE_D]) box(WORLD_W + 1.3, 0.4, 0.4, darkWood, WORLD_W / 2, frameH, z);
  for (const x of [-0.45, WORLD_W + 0.45]) box(0.4, 0.4, CRATE_D * 2, darkWood, x, frameH, 0);
  // faint tinted glass: reads as a surface without veiling the fruit behind or through it
  const glass = (opacity) => new THREE.MeshPhysicalMaterial({
    color: 0xc4dbe6, transparent: true, opacity, roughness: 0.1, metalness: 0,
    envMapIntensity: 0.6, side: THREE.DoubleSide, depthWrite: false,
  });
  const pane = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.renderOrder = 1; scene.add(m);
  };
  pane(WORLD_W + 0.5, frameH, 0.12, glass(0.07), WORLD_W / 2, frameH / 2, -CRATE_D);
  const sideGlass = glass(0.05);
  pane(0.12, frameH, CRATE_D * 2, sideGlass, -0.3, frameH / 2, 0);
  pane(0.12, frameH, CRATE_D * 2, sideGlass, WORLD_W + 0.3, frameH / 2, 0);

  // warning line (glows past the bloom threshold when fruit is above it)
  warnLine = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD_W, 0.12, 1.5),
    new THREE.MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.5 }));
  warnLine.position.set(WORLD_W / 2, WARN_Y, 0);
  scene.add(warnLine);

  // ghost preview (rebuilt per tier in syncMeshes) + guide line + hint marker
  ghostFruit = null;
  guideLine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  guideLine.visible = false; scene.add(guideLine);
  hintMarker = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  hintMarker.rotation.x = Math.PI; hintMarker.visible = false; scene.add(hintMarker);

  if (detailed) scene.add(buildOrchard(GROUND_Y));
  const nBurst = PARTICLE_COUNT[q.particles];
  if (nBurst) bursts = new Bursts(scene, T.dot, nBurst);
  if (q.background === 'animated') motes = new Motes(scene, T.dot, 90, [-6, WORLD_W + 6, 0, 34, -8, 9]);

  applyShadows();
  resize();
}

// Fit the sun's orthographic shadow camera tightly around the stall (table, crate, cloth).
function fitShadowFrustum() {
  const probe = new THREE.Object3D();
  probe.position.copy(dirLight.position);
  probe.lookAt(dirLight.target.position);
  probe.updateMatrixWorld();
  const inv = probe.matrixWorld.clone().invert();
  const xs = [-9, WORLD_W + 9], ys = [GROUND_Y, 39], zs = [-10, 12];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const x of xs) for (const y of ys) for (const z of zs) {
    tmpV.set(x, y, z).applyMatrix4(inv);
    minX = Math.min(minX, tmpV.x); maxX = Math.max(maxX, tmpV.x);
    minY = Math.min(minY, tmpV.y); maxY = Math.max(maxY, tmpV.y);
    minZ = Math.min(minZ, tmpV.z); maxZ = Math.max(maxZ, tmpV.z);
  }
  // Object3D.lookAt on a non-camera points +z at the target; the shadow camera looks down -z.
  const cam = dirLight.shadow.camera;
  cam.left = -maxX; cam.right = -minX; cam.top = maxY; cam.bottom = minY;
  cam.near = Math.max(0.5, minZ - 5); cam.far = maxZ + 5;
  cam.updateProjectionMatrix();
}

function applyShadows() {
  const size = SHADOW_MAP[gfx.q.shadows];
  renderer.shadowMap.enabled = size > 0;
  dirLight.castShadow = size > 0;
  if (size > 0 && dirLight.shadow.mapSize.x !== size) {
    dirLight.shadow.mapSize.set(size, size);
    dirLight.shadow.map?.dispose();
    dirLight.shadow.map = null;
  }
  // Lit materials recompile with/without shadow sampling.
  scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
}

// Per-fruit look (detailed tier): glossy or velvety skins with micro-relief. Colours stay the
// palette's, so tiers read the same at every quality.
const SKIN = [null,
  { rough: 0.28, cc: 0.9, bump: 0.25 }, { rough: 0.4, cc: 0.5, bump: 1.0 }, { rough: 0.35, cc: 0.6, bump: 0.3 },
  { rough: 0.5, cc: 0.35, bump: 1.4 }, { rough: 0.3, cc: 0.8, bump: 0.3 }, { rough: 0.45, cc: 0.45, bump: 0.5 },
  { rough: 0.7, cc: 0, bump: 0.4, sheen: 1 }, { rough: 0.45, cc: 0.4, bump: 1.1 }, { rough: 0.6, cc: 0.2, bump: 0.9 },
  { rough: 0.55, cc: 0.3, bump: 0.7, ribs: 8 }];

function fruitResources() {
  if (fruitRes) return fruitRes;
  const detailed = gfx.q.detail === 'detailed';
  const colors = PALETTES[save.settings.palette] || PALETTES.default;
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.5, 0.42, 1, 0);
  leafShape.quadraticCurveTo(0.5, -0.42, 0, 0);
  const res = {
    tiers: [],
    leafGeo: detailed ? new THREE.ShapeGeometry(leafShape, 5) : new THREE.CircleGeometry(1, 6),
    stemMat: new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 }),
    leafMat: new THREE.MeshStandardMaterial({ color: 0x3f7d2c, roughness: detailed ? 0.6 : 0.8, side: THREE.DoubleSide }),
  };
  if (detailed) {
    textures.skin.wrapS = textures.skin.wrapT = THREE.RepeatWrapping;
    textures.skin.repeat.set(3, 2);
  }
  for (let tier = 1; tier <= 10; tier++) {
    const r = TIER_R[tier], sk = SKIN[tier];
    const bodyGeo = detailed ? new THREE.SphereGeometry(r, 40, 28) : new THREE.SphereGeometry(r, 28, 20);
    if (detailed && sk.ribs) {
      // shallow pumpkin ribs (±3% of the radius) — silhouette cue only
      const p = bodyGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        tmpV.fromBufferAttribute(p, i);
        const k = 1 + 0.03 * Math.cos(Math.atan2(tmpV.z, tmpV.x) * sk.ribs);
        p.setXYZ(i, tmpV.x * k, tmpV.y, tmpV.z * k);
      }
      bodyGeo.computeVertexNormals();
    }
    const bodyMat = detailed
      ? new THREE.MeshPhysicalMaterial({
        color: colors[tier], roughness: sk.rough, metalness: 0,
        clearcoat: sk.cc, clearcoatRoughness: 0.25,
        bumpMap: textures.skin, bumpScale: sk.bump, roughnessMap: textures.skin,
        sheen: sk.sheen || 0, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xfff0e0),
      })
      : new THREE.MeshStandardMaterial({ color: colors[tier], roughness: 0.55, metalness: 0.05 });
    res.tiers[tier] = {
      bodyGeo, bodyMat,
      stemGeo: new THREE.CylinderGeometry(r * 0.08, r * 0.12, r * 0.5, 6),
      ringGeo: new THREE.TorusGeometry(r * 0.7, r * 0.05, 6, 24, Math.PI * 2),
      ringMat: new THREE.MeshStandardMaterial({ color: colors[tier], emissive: colors[tier], emissiveIntensity: 0.5 }),
      color: colors[tier],
    };
  }
  fruitRes = res;
  return res;
}

// fruit mesh: coloured sphere + distinct leaf-count marker per tier (colour-blind cue).
// Geometry and materials are shared per tier; a ghost gets its own translucent copies.
function makeFruitMesh(tier, ghost = false) {
  const res = fruitResources(), t = res.tiers[tier];
  const own = m => { if (!ghost) return m; const c = m.clone(); c.transparent = true; c.opacity = 0.4; c.depthWrite = false; return c; };
  const g = new THREE.Group();
  g.userData.ghost = ghost;
  const r = TIER_R[tier];
  const body = new THREE.Mesh(t.bodyGeo, own(t.bodyMat));
  body.castShadow = !ghost; body.receiveShadow = !ghost;
  g.add(body);
  const stem = new THREE.Mesh(t.stemGeo, own(res.stemMat));
  stem.position.y = r * 0.95; g.add(stem);
  // leaves: count = tier (visual marker distinct from colour)
  const leafMat = own(res.leafMat);
  const detailed = gfx.q.detail === 'detailed';
  const ls = Math.max(0.14, r * 0.22);
  for (let i = 0; i < tier; i++) {
    const leaf = new THREE.Mesh(res.leafGeo, leafMat);
    const a = (i / tier) * Math.PI * 2;
    if (detailed) {
      // pointed leaf radiating from the stem, tilted up a little
      leaf.scale.setScalar(ls * 2.2);
      leaf.position.set(0, r * 1.0, 0);
      leaf.rotation.set(-Math.PI / 2, a, 0.35, 'YZX');
    } else {
      leaf.scale.setScalar(ls);
      leaf.position.set(Math.cos(a) * r * 0.5, r * 1.02, Math.sin(a) * r * 0.5);
      leaf.rotation.set(-Math.PI / 2 + 0.4, 0, a);
    }
    g.add(leaf);
  }
  // emissive ring (extra cue)
  const ring = new THREE.Mesh(t.ringGeo, own(t.ringMat));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  return g;
}

function disposeFruitMesh(m) {
  // shared geometry/materials belong to the scene; only a ghost owns its material copies
  if (m.userData.ghost) m.traverse(o => { o.material?.dispose?.(); });
}

function burst(x, y, tier) {
  if (!motionOK() || !bursts) return;
  bursts.fire(x, y, tier, TIER_R[tier], (PALETTES[save.settings.palette] || PALETTES.default)[tier]);
}

function resize() {
  if (!renderer || !camera) return;
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  const q = gfx.q;
  const pr = Math.min(devicePixelRatio || 1, q.dprCap) * q.scale * gfx.adaptiveScale;
  gfx.size = [w, h];
  gfx.pixelRatio = pr;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = Math.max(1, w) / Math.max(1, h);
  camera.updateProjectionMatrix();
  fitCamera();
  // keep the painted sky's clouds round at any aspect
  if (textures && scene.background === textures.sky) textures.sky.repeat.set(camera.aspect / 2, 1);
}
window.addEventListener('resize', resize);

// Resolve saved graphics settings and apply them live (no reload).
function applyGraphics() {
  gfx.q = resolve(save.settings.gfx, gfx.detected);
  const q = gfx.q;
  canvas.dataset.gfxPreset = q.preset;
  document.body.dataset.gfxPreset = q.preset;
  gfx.adaptiveScale = 1;
  gfx.frames = [];
  const key = [q.detail, q.reflections, q.particles, q.background, save.settings.palette].join('|');
  if (!scene || key !== gfx.sceneKey) {
    gfx.sceneKey = key;
    buildScene();
  } else {
    applyShadows();
    resize();
  }
  post.invalidate();
  const fps = document.getElementById('fps-meter');
  if (fps) fps.hidden = !q.showFps;
  updateGfxPanel();
}

// Adaptive resolution: average ~90 frames, step the scale down when slow, back up when fast.
function adaptResolution(dtMs) {
  const f = gfx.frames;
  f.push(dtMs);
  if (f.length < 90) return;
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  f.length = 0;
  gfx.fps = 1000 / avg;
  const el = document.getElementById('fps-meter');
  if (el && !el.hidden) el.textContent = `${Math.round(gfx.fps)} ${gt('fpsUnit')} · ${Math.round(gfx.pixelRatio * 100) / 100}×`;
  if (!$('scr-settings').classList.contains('hidden')) updateGfxSummary();
  if (!gfx.q.adaptive) return;
  const before = gfx.adaptiveScale;
  if (avg > 26) gfx.adaptiveScale = Math.max(0.6, gfx.adaptiveScale - 0.1);
  else if (avg < 14 && gfx.adaptiveScale < 1) gfx.adaptiveScale = Math.min(1, gfx.adaptiveScale + 0.05);
  if (before !== gfx.adaptiveScale) resize();
}

function renderFrame(dtMs) {
  adaptResolution(dtMs);
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  const q = gfx.q;
  const pr = Math.min(devicePixelRatio || 1, q.dprCap) * q.scale * gfx.adaptiveScale;
  if (w !== gfx.size[0] || h !== gfx.size[1] || pr !== gfx.pixelRatio) resize();
  const failedBefore = post.failed;
  post.sync(q, scene, camera, w, h, gfx.pixelRatio);
  if (!post.render(dtMs / 1000)) renderer.render(scene, camera);
  if (post.failed !== failedBefore) updateGfxPanel();
}

canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  document.getElementById('ctxlost').classList.remove('hidden');
});
canvas.addEventListener('webglcontextrestored', () => {
  document.getElementById('ctxlost-msg').textContent = 'Context restored — rebuilding…';
  envRT = null;               // the prefiltered environment lived in the lost context
  gfx.sceneKey = null;
  applyGraphics();            // rebuilds the scene; fruit meshes follow on the next sync
  document.getElementById('ctxlost').classList.add('hidden');
});

// ---------------- 5. Game session ----------------
const $ = id => document.getElementById(id);
const announce = msg => { $('aria-live').textContent = msg; };

// Journey: 40 authored stages, deterministic from index.
function journeyStage(i) {
  const seed = R.hashStr('journey-' + i);
  const targetScore = 200 + i * 160;
  const requireTier = Math.min(3 + Math.floor(i / 6), 8);
  const maxDrops = 40 + Math.floor(i * 1.5);
  return { i, seed, goals: { targetScore, requireTier, maxDrops },
    difficulty: i < 12 ? 'easy' : i < 28 ? 'normal' : 'hard' };
}
const CHALLENGES = [
  { id: 'move-limit', name: 'Move limit', desc: 'Reach 1200 points in at most 25 drops.',
    goals: { targetScore: 1200, maxDrops: 25 }, difficulty: 'normal' },
  { id: 'time-limit', name: 'Time limit', desc: 'Reach 1500 points within 60 seconds of sim time.',
    goals: { targetScore: 1500, timeLimitTicks: 3600 }, difficulty: 'normal' },
  { id: 'high-line', name: 'High warning line', desc: 'Hard pool, no mercy: reach tier 7 with ≤ 35 drops.',
    goals: { requireTier: 7, maxDrops: 35 }, difficulty: 'hard' },
];

// Live run state
const run = {
  state: null, mode: null, modeOpts: null, phase: 'title', // title|setup|countdown|active|paused|resolving|results
  commands: [],             // {kind:'drop',x,tick}
  undoStack: [],            // snapshots (practice)
  aimX: WORLD_W / 2,
  tutorial: { step: 0 },    // learn-mode gating
  ranked: false,
  pauseAt: 0, pausedMs: 0,
  startedAt: 0,
  lastHash: 0,
};
let pendingNext = null; // journey "next stage" after win

function newRun(mode, modeOpts) {
  run.mode = mode; run.modeOpts = modeOpts;
  run.state = R.newGame(modeOpts.seed, { difficulty: modeOpts.difficulty, goals: modeOpts.goals || null });
  run.commands = []; run.undoStack = []; setAim(WORLD_W / 2);
  run.ranked = !!modeOpts.ranked; run.pausedMs = 0; run.startedAt = now();
  run.tutorial.step = mode === 'learn' ? 0 : -1;
  run.newAchievements = [];
  run.phase = 'countdown';
  save.resume = null; persist();
  showScreen(null);
  $('hud').classList.remove('hidden');
  updateObjective(); updateHUD(true);
  runCountdown(() => { run.phase = 'active'; });
}

function runCountdown(done) {
  const el = $('countdown');
  el.classList.remove('hidden');
  let n = 3;
  const tickFn = () => {
    if (n > 0) { el.textContent = n; audio.countdown(n); n--; setTimeout(tickFn, 700); }
    else { el.textContent = 'Go!'; audio.countdown(0); setTimeout(() => { el.classList.add('hidden'); done(); }, 400); }
  };
  tickFn();
}

function serializeResume() {
  if (!run.state || run.state.status !== 'active') return;
  save.resume = { snap: R.snapshot(run.state), commands: run.commands, mode: run.mode,
    modeOpts: run.modeOpts, savedAt: now(), pausedMs: run.pausedMs };
  persist();
}

function resumeRun() {
  const r = save.resume;
  if (!r) return;
  run.mode = r.mode; run.modeOpts = r.modeOpts; run.commands = r.commands || [];
  run.undoStack = []; run.state = R.restore(r.snap);
  run.ranked = !!r.modeOpts.ranked; run.pausedMs = r.pausedMs || 0;
  setAim(WORLD_W / 2); run.startedAt = now();
  run.tutorial.step = run.mode === 'learn' ? Math.min(r.commands.length > 0 ? 1 : 0, 2) : -1;
  run.newAchievements = [];
  run.phase = 'active';
  showScreen(null); $('hud').classList.remove('hidden');
  const away = Math.max(0, now() - r.savedAt);
  const mins = Math.floor(away / 60000);
  announce(`Resumed. You were away ${mins} minute${mins === 1 ? '' : 's'}.`);
  updateObjective(); updateHUD(true);
}

function tryDrop(x) {
  if (run.phase !== 'active' || !run.state) return;
  const legal = R.legalActions(run.state);
  if (!legal.drop) { audio.invalid(); return; }
  // learn-mode gating: step 0 = must drop
  const qx = R.quantizeX(x);
  const before = run.mode === 'practice' ? R.snapshot(run.state) : null;
  const ok = R.applyCommand(run.state, { kind: 'drop', x: qx });
  if (ok) {
    // only snapshot accepted drops, or undo would pop a command it does not own
    if (before) {
      run.undoStack.push(before);
      if (run.undoStack.length > 20) run.undoStack.shift();
    }
    run.commands.push({ kind: 'drop', x: qx, tick: run.state.tick });
    audio.drop();
    if (run.mode === 'learn' && run.tutorial.step === 0) { run.tutorial.step = 1; updateObjective(); }
    serializeResume();
  }
  updateHUD();
}

function undo() {
  if (run.mode !== 'practice' || run.phase !== 'active' || !run.undoStack.length) { audio.invalid(); return; }
  const snap = run.undoStack.pop();
  run.state = R.restore(snap);
  run.commands.pop();
  announce('Undid last drop.');
  serializeResume();
  updateHUD(true);
}

function skipSettle() {
  if (!run.state || run.phase !== 'active') return;
  drainEvents(); // capture pending merge fx
  R.settle(run.state);
  drainEvents();
  afterStep();
}

let hintTimer = 0;
function showHint() {
  if (!run.state || !R.legalActions(run.state).hint) { audio.invalid(); return; }
  const x = R.hint(run.state);
  hintMarker.position.set(x, WORLD_H + 0.8, 0);
  hintMarker.visible = true;
  clearTimeout(hintTimer);
  const marker = hintMarker; // buildScene may swap it out before the timer fires
  hintTimer = setTimeout(() => { marker.visible = false; }, 2500);
  announce(`Hint: drop near position ${x.toFixed(1)}.`);
}

// events -> fx, speech, mode logic
function drainEvents() {
  const s = run.state;
  if (!s || !s.events.length) return;
  for (const ev of s.events) {
    if (ev.kind === 'merge') {
      burst(ev.x, ev.y, ev.tier);
      audio.merge(ev.tier);
      vibrate(30);
      shakeAmp = save.settings.reducedMotion ? 0 : Math.min(0.5, 0.1 + ev.tier * 0.03);
      announce(`Merged into ${TIER_NAMES[ev.tier]}, plus ${ev.points} points. Score ${s.score}.`);
      if (ev.tier >= 8) unlock('merge-master');
      if (run.mode === 'learn' && run.tutorial.step === 1) {
        run.tutorial.step = 2; updateObjective();
        save.settings.tutorialDone = true; persist();
      }
    } else if (ev.kind === 'warn') {
      audio.warn(); $('warn-banner').classList.remove('hidden');
      announce('Warning: fruit is above the line!');
    } else if (ev.kind === 'warn-clear') {
      $('warn-banner').classList.add('hidden');
    } else if (ev.kind === 'invalid') {
      audio.invalid();
      announce(`Invalid action: ${ev.reason}.`);
    } else if (ev.kind === 'gameover') {
      onGameOver(ev.reason);
    }
  }
  s.events.length = 0;
}

function onGameOver(reason) {
  run.phase = 'resolving';
  $('warn-banner').classList.add('hidden');
  const win = reason === 'goal-complete';
  audio.fanfare(win);
  vibrate(win ? [40, 60, 40] : [120]);
  const bd = R.scoreBreakdown(run.state);
  const hash = R.stateHash(run.state);
  run.lastHash = hash;
  save.resume = null;

  // mode-specific bookkeeping
  if (run.mode === 'journey' && win) {
    const i = run.modeOpts.stageI;
    save.journey.cleared[i] = Math.max(save.journey.cleared[i] || 0, bd.total);
    save.journey.unlocked = Math.max(save.journey.unlocked, Math.min(i + 2, 40));
    pendingNext = i + 1 < 40 ? i + 1 : null;
    if (i === 39) unlock('journey-complete');
  }
  if (run.mode === 'daily') {
    const d = utcDateStr();
    const prev = save.daily[d]?.score || 0;
    if (bd.total > prev) save.daily[d] = { score: bd.total, hash };
    if (Object.keys(save.daily).length >= 3) unlock('daily-streak-3');
  }
  save.lifetime += bd.total;
  unlock('first-completion');
  if (save.lifetime >= 25000) unlock('orchard-keeper');
  if (run.ranked) {
    const entry = { mode: run.mode, score: bd.total, seed: run.state.seed,
      difficulty: run.state.difficulty, hash,
      replay: { seed: run.state.seed, difficulty: run.state.difficulty,
        goals: run.state.goals || null, commands: run.commands, finalTick: run.state.tick },
      date: new Date(now()).toISOString() };
    save.leaderboard.push(entry);
    save.leaderboard.sort((a, b) => b.score - a.score);
    save.leaderboard = save.leaderboard.slice(0, 50);
    submitScore(entry);
  }
  persist();
  setTimeout(() => { run.phase = 'results'; showResults(reason, bd); }, 900);
}

async function submitScore(entry) {
  // Its-backend replay-validated board (live only when the platform hosts
  // server.js behind /api); otherwise fall back to the local leaderboard.
  try {
    const resp = await platform.post('/api/v1/scores', {
      name: platform.nickname || 'guest',
      scope: entry.mode === 'daily' ? 'daily' : 'score-chase',
      seed: entry.seed, difficulty: entry.difficulty, goals: entry.replay.goals,
      commands: entry.replay.commands, finalTick: entry.replay.finalTick,
      finalHash: entry.hash, score: entry.score });
    if (resp && resp.rank) {
      $('res-submit').textContent =
        `Submitted — rank #${resp.rank} on the ${entry.mode === 'daily' ? 'daily' : 'score-chase'} board.`;
    }
  } catch {
    $('res-submit').textContent = 'Leaderboard unavailable — score kept locally.';
  }
}

// ---------------- 7. Screens / UI ----------------
const SCREENS = ['scr-title', 'scr-setup', 'scr-pause', 'scr-results', 'scr-settings', 'scr-help'];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  if (id) $(id).querySelector('button:not([disabled])')?.focus({ preventScroll: true });
}

function updateObjective() {
  let text = '';
  if (run.mode === 'learn') {
    const steps = [
      'Step 1/3: drop a fruit (aim, then Drop / Space).',
      'Step 2/3: make a merge — drop a matching tier onto its twin.',
      'Step 3/3: keep fruit below the glowing warning line. Free play!',
    ];
    text = steps[Math.min(run.tutorial.step, 2)];
  } else if (run.mode === 'journey') {
    const g = run.modeOpts.goals;
    text = `Stage ${run.modeOpts.stageI + 1}: score ${g.targetScore}, reach ${TIER_NAMES[g.requireTier]}, within ${g.maxDrops} drops.`;
  } else if (run.mode === 'daily') {
    text = `Daily ${utcDateStr()} — one ranked run.`;
  } else if (run.mode === 'challenge') {
    text = run.modeOpts.desc;
  } else {
    text = 'Practice — relaxed play, undo enabled, not ranked.';
  }
  $('objective').textContent = text;
  $('objective-top').textContent = text;
}

let lastBoardSig = '';
function updateHUD(force) {
  const s = run.state;
  if (!s) return;
  $('score-big').textContent = s.score;
  $('score-top').textContent = s.score;
  const nowTxt = `${TIER_NAMES[s.currentTier]} (${s.currentTier})`;
  const nextTxt = `${TIER_NAMES[s.nextTier]} (${s.nextTier})`;
  $('now-fruit').textContent = nowTxt;
  $('now-top').textContent = `Now: ${nowTxt}`;
  $('next-fruit').textContent = nextTxt;
  $('next-top').textContent = `Next: ${nextTxt}`;
  // board list (navigable text equivalent)
  const sig = s.fruits.map(f => f.id + ':' + f.tier).join(',');
  if (force || sig !== lastBoardSig) {
    lastBoardSig = sig;
    const sorted = s.fruits.slice().sort((a, b) => b.tier - a.tier || a.id - b.id);
    $('board-list').innerHTML = sorted.map(f =>
      `<li>${TIER_NAMES[f.tier]} (tier ${f.tier}) at x ${f.x.toFixed(1)}, y ${f.y.toFixed(1)}</li>`).join('') || '<li>Empty</li>';
  }
  const legal = R.legalActions(s);
  $('btn-drop').disabled = $('tt-drop').disabled = !legal.drop || run.phase !== 'active';
  $('btn-undo').disabled = $('tt-undo').disabled = !(run.mode === 'practice' && run.undoStack.length);
}

// ---- setup screen builders ----
function openSetup(mode) {
  run.mode = mode;
  $('setup-start').textContent = 'Start';
  const body = $('setup-body');
  body.innerHTML = '';
  const h = $('setup-h');
  const add = el => body.appendChild(el);
  const p = (html) => { const d = document.createElement('p'); d.innerHTML = html; return d; };
  let starter = null;

  if (mode === 'learn') {
    h.textContent = 'Learn';
    add(p('A 3-step interactive tutorial. About 2 minutes. Not ranked.'));
    starter = () => newRun('learn', { seed: R.hashStr('learn'), difficulty: 'easy' });
  } else if (mode === 'journey') {
    h.textContent = 'Journey';
    add(p('40 staged goals. ~3–5 minutes each. Ranked per stage.'));
    const grid = document.createElement('div');
    grid.className = 'grid'; grid.setAttribute('role', 'list');
    for (let i = 0; i < 40; i++) {
      const st = journeyStage(i);
      const unlocked = i + 1 <= save.journey.unlocked;
      const b = document.createElement('button');
      b.textContent = (i + 1) + (save.journey.cleared[i] != null ? ' ★' : '');
      b.className = unlocked ? '' : 'locked';
      b.disabled = !unlocked;
      b.title = `Stage ${i + 1}: score ${st.goals.targetScore}, tier ${st.goals.requireTier}, ${st.goals.maxDrops} drops`;
      b.onclick = () => newRun('journey', { seed: st.seed, difficulty: st.difficulty, goals: st.goals, stageI: i, ranked: true });
      grid.appendChild(b);
    }
    add(grid);
    $('setup-start').classList.add('hidden');
  } else if (mode === 'daily') {
    h.textContent = 'Daily';
    const d = utcDateStr();
    const done = save.daily[d];
    add(p(`Seed from UTC date <strong>${d}</strong>. One ranked run per day; ~4 minutes.`));
    add(p(done ? `Best today: <strong>${done.score}</strong>` : 'Not attempted yet today.'));
    // one ranked run per day: a repeat attempt is a replay, and must not submit
    starter = () => newRun('daily', { seed: R.hashStr('orchard-daily-' + d), difficulty: 'normal', ranked: !done });
    $('setup-start').textContent = done ? 'Replay (unranked)' : 'Start';
  } else if (mode === 'practice') {
    h.textContent = 'Practice';
    add(p('Free play with undo. Not ranked. Restart anytime.'));
    const sel = document.createElement('select');
    sel.id = 'practice-diff'; sel.setAttribute('aria-label', 'Difficulty');
    sel.innerHTML = '<option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option>';
    add(sel);
    starter = () => newRun('practice', { seed: (Math.random() * 2 ** 32) >>> 0, difficulty: sel.value });
  } else if (mode === 'challenge') {
    h.textContent = 'Challenge';
    add(p('Preset rule variants. Ranked locally.'));
    for (const c of CHALLENGES) {
      const b = document.createElement('button');
      b.innerHTML = `<strong>${c.name}</strong> — ${c.desc}`;
      b.style.textAlign = 'left';
      b.onclick = () => newRun('challenge', { seed: R.hashStr('challenge-' + c.id), difficulty: c.difficulty, goals: c.goals, desc: c.desc, ranked: true });
      body.appendChild(b);
    }
    $('setup-start').classList.add('hidden');
  } else if (mode === 'scores') {
    h.textContent = 'Score chase';
    renderLeaderboard(body);
    $('setup-start').classList.add('hidden');
  }
  if (starter) {
    $('setup-start').classList.remove('hidden');
    $('setup-start').onclick = starter;
  }
  run.phase = 'setup';
  showScreen('scr-setup');
}

function addBoard(body, title, headers, rows) {
  const h = document.createElement('h3');
  h.textContent = title;
  body.appendChild(h);
  const t = document.createElement('table');
  const hr = document.createElement('tr');
  for (const col of headers) { const th = document.createElement('th'); th.textContent = col; hr.appendChild(th); }
  const thead = document.createElement('thead');
  thead.appendChild(hr);
  const tb = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const v of row) { const td = document.createElement('td'); td.textContent = String(v); tr.appendChild(td); }
    tb.appendChild(tr);
  }
  t.append(thead, tb);
  body.appendChild(t);
}

async function renderRemoteBoards(body) {
  // Hosted: the platform leaderboard is read-only per the wiki.
  if (platform.hosted) {
    const rows = await platform.fetchLeaderboard();
    if (rows && rows.length) {
      addBoard(body, 'Global board (read-only)', ['#', 'Player', 'Score'],
        rows.map(r => [r.rank, r.name, r.score]));
    }
  }
  // Its-backend replay-validated boards (shared server clock); they exist
  // only when server.js is hosted behind /api, so failures stay silent.
  if (platform.online || !platform.hosted) {
    try {
      const data = await platform.get('/api/v1/scores?scope=score-chase');
      const entries = (data.entries || []).slice(0, 20);
      if (entries.length) {
        addBoard(body, 'Server board — score chase (validated)', ['#', 'Player', 'Score', 'Date'],
          entries.map((e, i) => [i + 1, e.name, e.score, (e.at ? new Date(e.at).toISOString().slice(0, 10) : '—')]));
      }
      const dd = await platform.get('/api/v1/scores?scope=daily');
      const daily = (dd.entries || []).slice(0, 20);
      if (daily.length) {
        addBoard(body, 'Server board — today’s daily (validated)', ['#', 'Player', 'Score'],
          daily.map((e, i) => [i + 1, e.name, e.score]));
      }
    } catch { /* its-backend not hosted here — local board above is it */ }
  }
}

function renderLeaderboard(body) {
  const p = document.createElement('p');
  p.textContent = 'Local best runs (top 50 across modes). Replay data stored with each entry.';
  body.appendChild(p);
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>#</th><th>Mode</th><th>Score</th><th>Difficulty</th><th>Hash</th><th>Date</th></tr></thead>';
  const tb = document.createElement('tbody');
  save.leaderboard.slice(0, 20).forEach((e, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${e.mode}</td><td>${e.score}</td><td>${e.difficulty}</td>
      <td><code>${e.hash.toString(16)}</code></td><td>${e.date.slice(0, 10)}</td>`;
    tb.appendChild(tr);
  });
  if (!save.leaderboard.length) tb.innerHTML = '<tr><td colspan="6" class="muted">No ranked runs yet.</td></tr>';
  t.appendChild(tb);
  body.appendChild(t);
  renderRemoteBoards(body);
}

function showResults(reason, bd) {
  const heads = { overflow: 'Crate overflowed!', 'goal-complete': 'Goal complete! 🎉',
    'move-limit': 'Out of moves!', resigned: 'Run resigned' };
  $('res-h').textContent = heads[reason] || 'Run over';
  $('res-breakdown').innerHTML = `<table>
    <tr><td>Merge score</td><td>${bd.mergeScore}</td></tr>
    <tr><td>Max tier bonus</td><td>${bd.maxTierBonus}</td></tr>
    <tr><td><strong>Total</strong></td><td><strong>${bd.total}</strong></td></tr>
    <tr><td>Drops</td><td>${bd.drops}</td></tr>
    <tr><td>Merges</td><td>${bd.merges}</td></tr>
    <tr><td>Max tier</td><td>${bd.maxTier} (${TIER_NAMES[bd.maxTier] || '—'})</td></tr>
    <tr><td>Invalid actions</td><td>${bd.invalidActions}</td></tr>
    <tr><td>Ticks</td><td>${bd.ticks}</td></tr>
    <tr><td>Final hash</td><td><code>${run.lastHash.toString(16)}</code></td></tr>
  </table>`;
  const totalAch = Object.keys(ACHIEVEMENTS).length;
  const got = Object.keys(save.achievements).length;
  const fresh = (run.newAchievements || []).map(k => `<li>🏅 ${ACHIEVEMENTS[k]}</li>`).join('');
  $('res-achievements').innerHTML =
    `<p class="small muted">Achievements: ${got}/${totalAch} unlocked.</p>` +
    (fresh ? `<ul class="small">${fresh}</ul>` : '');
  $('res-submit').textContent = '';
  $('br-next').classList.toggle('hidden', !pendingNext);
  announce(`${$('res-h').textContent} Final score ${bd.total}.`);
  showScreen('scr-results');
  $('hud').classList.add('hidden');
}

// ---- settings ----
function openSettings() {
  const s = save.settings;
  $('set-music').value = s.music; $('set-sfx').value = s.sfx; $('set-amb').value = s.amb;
  $('set-mute').checked = s.mute; $('set-haptics').checked = s.haptics;
  $('set-palette').value = s.palette;
  $('set-rm').checked = s.reducedMotion; $('set-hc').checked = s.highContrast; $('set-lt').checked = s.largerText;
  updateGfxPanel();
  showScreen('scr-settings');
}
function applySettings() {
  const s = save.settings;
  const prevPalette = s.palette;
  s.music = +$('set-music').value; s.sfx = +$('set-sfx').value; s.amb = +$('set-amb').value;
  s.mute = $('set-mute').checked; s.haptics = $('set-haptics').checked;
  s.palette = $('set-palette').value;
  s.reducedMotion = $('set-rm').checked; s.highContrast = $('set-hc').checked; s.largerText = $('set-lt').checked;
  document.body.classList.toggle('high-contrast', s.highContrast);
  document.body.classList.toggle('larger-text', s.largerText);
  audio.applyVolumes(); persist();
  // only the palette changes the scene graph; rebuilding on every volume tweak
  // would drop the in-flight run's meshes
  if (s.palette !== prevPalette) applyGraphics();
}

// ---- settings: Graphics section (localized; see gfx.js / gfx-i18n.js) ----
const gfxLocale = pickLocale(navigator.language);
const gt = translator(gfxLocale);
const GFX_CATS = Object.keys(CATEGORIES);
const gfxOpt = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };

function commitGfx() {
  applyGraphics();
  persist();
}

function buildGfxPanel() {
  const sec = $('gfx-section');
  sec.lang = gfxLocale;
  $('gfx-h').textContent = gt('graphics');
  $('gfx-quality-label').textContent = gt('quality');
  $('gfx-scale-label').textContent = gt('scale');
  $('gfx-adaptive-label').textContent = gt('adaptive');
  $('gfx-fps-label').textContent = gt('fps');
  $('gfx-postfail').textContent = gt('postFailed');
  const sel = $('set-quality');
  sel.innerHTML = '';
  for (const v of ['auto', ...PRESETS]) sel.appendChild(gfxOpt(v, v));
  sel.addEventListener('change', () => {
    save.settings.gfx = choosePreset(save.settings.gfx, sel.value);   // clears overrides
    commitGfx();
  });
  const grid = $('gfx-cats');
  grid.innerHTML = '';
  for (const cat of GFX_CATS) {
    const lab = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = gt('cat_' + cat);
    const s = document.createElement('select');
    s.id = 'gfx-' + cat;
    s.dataset.gfxCat = cat;
    s.appendChild(gfxOpt('preset', ''));
    for (const t of CATEGORIES[cat]) s.appendChild(gfxOpt(t, gt('t_' + t)));
    s.addEventListener('change', () => {
      const g = { ...save.settings.gfx };
      if (s.value === 'preset') delete g[cat]; else g[cat] = s.value;
      save.settings.gfx = g;
      commitGfx();
    });
    lab.append(span, s);
    grid.appendChild(lab);
  }
  const scale = $('gfx-scale');
  scale.addEventListener('input', () => {
    save.settings.gfx = { ...save.settings.gfx, render_scale: +scale.value / 100 };
    applyGraphics();
  });
  scale.addEventListener('change', () => persist());
  $('gfx-adaptive').addEventListener('change', e => {
    save.settings.gfx = { ...save.settings.gfx, adaptive: e.target.checked };
    commitGfx();
  });
  $('gfx-fps').addEventListener('change', e => {
    save.settings.gfx = { ...save.settings.gfx, show_fps: e.target.checked };
    commitGfx();
  });
}

function updateGfxPanel() {
  const q = gfx.q, g = save.settings.gfx || {};
  if (!q || !$('gfx-section')) return;
  const sel = $('set-quality');
  for (const o of sel.options) {
    o.textContent = o.value === 'auto' ? gt('auto', { tier: gt('tier_' + gfx.detected) }) : gt('tier_' + o.value);
  }
  sel.value = PRESETS.includes(g.preset) ? g.preset : 'auto';
  for (const cat of GFX_CATS) {
    const s = $('gfx-' + cat);
    s.options[0].textContent = gt('fromPreset', { tier: gt('t_' + presetTier(q.preset, cat)) });
    s.value = CATEGORIES[cat].includes(g[cat]) ? g[cat] : 'preset';
  }
  const pct = Math.round(q.userScale * 100);
  $('gfx-scale').value = pct;
  $('gfx-scale-val').textContent = pct + '%';
  $('gfx-adaptive').checked = q.adaptive;
  $('gfx-fps').checked = q.showFps;
  $('gfx-postfail').classList.toggle('hidden', !post?.failed);
  updateGfxSummary();
}

function updateGfxSummary() {
  const q = gfx.q;
  const px = [Math.round(gfx.size[0] * gfx.pixelRatio), Math.round(gfx.size[1] * gfx.pixelRatio)];
  const words = {};
  for (const k of ['noShadows', 'shadows', 'ao', 'aoHigh', 'bloom', 'reflections', 'noAA', 'particles']) words[k] = gt('sum_' + k);
  $('gfx-summary').textContent = `${gfx.gpu || gt('gpuUnknown')} · ${describe(q, px, words)}`;
}

// ---- pause ----
function pauseGame() {
  if (run.phase !== 'active') return;
  run.phase = 'paused'; run.pauseAt = now();
  serializeResume();
  showScreen('scr-pause');
}
function resumeGame() {
  run.pausedMs += now() - run.pauseAt;
  run.phase = 'active';
  showScreen(null);
}
function leaveRun() {
  run.state = null; run.phase = 'title';
  $('hud').classList.add('hidden');
  gotoTitle();
}
function gotoTitle() {
  pendingNext = null;
  const r = save.resume;
  $('bt-resume').classList.toggle('hidden', !r);
  if (r) {
    const mins = Math.floor(Math.max(0, now() - r.savedAt) / 60000);
    $('away-line').textContent = `While you were away: ${mins} minute${mins === 1 ? '' : 's'} since your last run.`;
    $('away-line').classList.remove('hidden');
  } else $('away-line').classList.add('hidden');
  updateProfileLine();
  run.phase = 'title';
  showScreen('scr-title');
}

// Name/sync status slot on the title screen. Nickname comes from the platform
// profile; guest play is unchanged.
function updateProfileLine() {
  const el = $('profile-line');
  if (!el) return;
  if (platform.hosted) {
    el.textContent = 'Playing as ' + (platform.nickname || '…') + ' — ' +
      (SYNC_LABELS[platform.syncState] || 'Signed in.');
  } else {
    el.textContent = 'Guest — progress is stored on this device.';
  }
}

// ---------------- 6. Input ----------------
// One aim value, two visible sliders (desktop rail + mobile thumb tray).
function setAim(x) {
  run.aimX = R.quantizeX(Math.max(TIER_R[1], Math.min(WORLD_W - TIER_R[1], x)));
  $('aim-slider').value = run.aimX;
  $('tt-aim').value = run.aimX;
}

function aimFromClientX(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  // Use the real pointer position and intersect the fruit plane (z = 0), so
  // the drop lands under the pointer regardless of camera tilt or aspect.
  const ny = clientY == null ? 0.5 : -(((clientY - rect.top) / rect.height) * 2 - 1);
  tmpV.set(nx, ny, 0.5).unproject(camera);
  const dir = tmpV.sub(camera.position).normalize();
  let x;
  if (Math.abs(dir.z) > 1e-4) {
    const t = (0 - camera.position.z) / dir.z;
    x = camera.position.x + dir.x * t;
  } else {
    x = camera.position.x;
  }
  setAim(x);
}

let dragging = false, dragMoved = false;
canvas.addEventListener('pointerdown', e => {
  if (run.phase !== 'active') return;
  audio.ensure();
  dragging = true; dragMoved = false;
  canvas.setPointerCapture(e.pointerId);
  aimFromClientX(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', e => {
  if (dragging && run.phase === 'active') { dragMoved = true; aimFromClientX(e.clientX, e.clientY); }
});
canvas.addEventListener('pointerup', e => {
  if (!dragging) return;
  dragging = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  if (run.phase === 'active') { aimFromClientX(e.clientX, e.clientY); tryDrop(run.aimX); }
});
canvas.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('lostpointercapture', () => { dragging = false; });

for (const id of ['aim-slider', 'tt-aim'])
  $(id).addEventListener('input', e => setAim(+e.target.value));

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  const k = e.key;
  if (k === 'p' || k === 'P' || k === 'Escape') {
    if (run.phase === 'active') pauseGame();
    else if (run.phase === 'paused') resumeGame();
    e.preventDefault();
  } else if (run.phase === 'active') {
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { setAim(run.aimX - 0.5); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { setAim(run.aimX + 0.5); e.preventDefault(); }
    else if (k === ' ' || k === 'Enter') { tryDrop(run.aimX); e.preventDefault(); }
    else if (k === 'u' || k === 'U') undo();
    else if (k === 'h' || k === 'H') showHint();
    else if (k === 'r' || k === 'R') newRun(run.mode, run.modeOpts);
  }
});

// buttons (HUD + thumb tray)
for (const id of ['btn-drop', 'tt-drop']) $(id).addEventListener('click', () => { audio.ensure(); tryDrop(run.aimX); });
for (const id of ['btn-undo', 'tt-undo']) $(id).addEventListener('click', undo);
for (const id of ['btn-hint', 'tt-hint']) $(id).addEventListener('click', showHint);
for (const id of ['btn-skip', 'tt-skip']) $(id).addEventListener('click', skipSettle);
for (const id of ['btn-pause', 'tt-pause']) $(id).addEventListener('click', pauseGame);

// title screen
// Play is the dominant action: first-timers get the tutorial, returning
// players land straight on the journey stage picker.
$('bt-play').addEventListener('click', () => {
  audio.ensure(); audio.click();
  openSetup(save.settings.tutorialDone ? 'journey' : 'learn');
});
$('bt-learn').addEventListener('click', () => openSetup('learn'));
$('bt-daily').addEventListener('click', () => openSetup('daily'));
$('bt-journey').addEventListener('click', () => openSetup('journey'));
$('bt-practice').addEventListener('click', () => openSetup('practice'));
$('bt-challenge').addEventListener('click', () => openSetup('challenge'));
$('bt-scores').addEventListener('click', () => openSetup('scores'));
$('bt-settings').addEventListener('click', openSettings);
$('bt-help').addEventListener('click', () => showScreen('scr-help'));
$('bt-resume').addEventListener('click', () => { audio.ensure(); resumeRun(); });

// setup / pause / results / settings / help
$('setup-back').addEventListener('click', gotoTitle);
$('bp-resume').addEventListener('click', resumeGame);
$('bp-restart').addEventListener('click', () => newRun(run.mode, run.modeOpts));
$('bp-settings').addEventListener('click', openSettings);
$('bp-help').addEventListener('click', () => showScreen('scr-help'));
$('bp-leave').addEventListener('click', leaveRun);
$('br-retry').addEventListener('click', () => newRun(run.mode, run.modeOpts));
$('br-title').addEventListener('click', gotoTitle);
$('br-next').addEventListener('click', () => {
  if (pendingNext == null) return;
  const st = journeyStage(pendingNext);
  newRun('journey', { seed: st.seed, difficulty: st.difficulty, goals: st.goals, stageI: pendingNext, ranked: true });
});
for (const id of ['set-music','set-sfx','set-amb','set-mute','set-haptics','set-palette','set-rm','set-hc','set-lt'])
  $(id).addEventListener('change', applySettings);
$('set-close').addEventListener('click', () => { audio.click(); run.phase === 'paused' ? showScreen('scr-pause') : gotoTitle(); });
$('help-close').addEventListener('click', () => {
  if (run.phase === 'paused') showScreen('scr-pause');
  else if (run.phase === 'title') showScreen('scr-title');
  else gotoTitle();
});

// first-gesture audio unlock
document.addEventListener('pointerdown', () => audio.ensure(), { once: true });
document.addEventListener('keydown', () => audio.ensure(), { once: true });

// ---------------- 8. Main loop ----------------
let acc = 0, lastT = performance.now();
function syncMeshes(alpha) {
  const s = run.state;
  if (!s) {
    for (const [, m] of fruitMeshes) m.visible = false;
    if (ghostFruit) ghostFruit.visible = false;
    guideLine.visible = false;
    return;
  }
  // a new/restored/undone state or a rebuilt scene syncs without pop-in
  if (s !== lastStateRef) { lastStateRef = s; freshSync = true; }
  const nowMs = performance.now();
  const pop = motionOK() && !freshSync;
  const seen = new Set();
  for (const f of s.fruits) {
    seen.add(f.id);
    let m = fruitMeshes.get(f.id);
    if (!m) {
      m = makeFruitMesh(f.tier); fruitMeshes.set(f.id, m); scene.add(m);
      m.userData.born = pop ? nowMs : 0;
    }
    m.visible = true;
    m.position.set(f.x, f.y, 0);
    m.rotation.z = -f.x * 0.05;
    if (m.userData.born) {
      // short ease-out-back pop for fruit that just appeared (cosmetic; physics is unchanged)
      const k = Math.min(1, (nowMs - m.userData.born) / 180);
      const c = 1.70158, e = 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
      m.scale.setScalar(0.6 + 0.4 * e);
      if (k >= 1) { m.userData.born = 0; m.scale.setScalar(1); }
    }
  }
  freshSync = false;
  for (const [id, m] of fruitMeshes) {
    if (!seen.has(id)) { scene.remove(m); disposeFruitMesh(m); fruitMeshes.delete(id); }
  }
  // ghost preview
  if (run.phase === 'active' && R.legalActions(s).drop) {
    const tier = s.currentTier;
    if (tier !== ghostTier || !ghostFruit) {
      // the preview shows the fruit that will actually drop (colour, leaves, size)
      if (ghostFruit) { scene.remove(ghostFruit); disposeFruitMesh(ghostFruit); }
      ghostFruit = makeFruitMesh(tier, true);
      ghostTier = tier;
      scene.add(ghostFruit);
    }
    ghostFruit.visible = guideLine.visible = true;
    ghostFruit.position.set(run.aimX, WORLD_H - TIER_R[tier] - 0.5, 0);
    guideLine.position.set(run.aimX, WORLD_H - 4, 0);
  } else {
    if (ghostFruit) ghostFruit.visible = false;
    guideLine.visible = false;
  }
  // warning line glow (above 1.0 when hot, so bloom picks it up)
  const hot = s.aboveLineTicks > 0;
  warnLine.material.opacity = hot ? 0.5 + 0.4 * Math.sin(nowMs / 120) : 0.35;
  warnLine.material.color.setHex(hot ? 0xff2211 : 0xff5544);
  if (hot) warnLine.material.color.multiplyScalar(2.2);
  if (hintMarker.visible && motionOK()) hintMarker.position.y = WORLD_H + 0.8 + Math.sin(nowMs / 200) * 0.25;
}

function frame(t) {
  requestAnimationFrame(frame);
  const rawMs = t - lastT;
  const dt = Math.min(0.1, rawMs / 1000);
  lastT = t;
  if (run.state && run.phase === 'active' && !document.hidden) {
    acc += dt * 1000;
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      R.step(run.state);
      drainEvents();
      if (!run.state || run.phase === 'resolving') break;
    }
    afterStep();
  }
  if (renderer && scene && !document.hidden) {
    bursts?.update(dt);
    if (motionOK()) {
      motes?.update(dt);
      if (gfx.q.background === 'animated' && scene.background === textures?.sky) textures.sky.offset.x += dt * 0.004;
    }
    if (motes) motes.points.visible = motionOK();
    syncMeshes();
    if (shakeAmp > 0.001) {
      camera.position.set(
        camBase.x + (Math.random() - 0.5) * shakeAmp,
        camBase.y + (Math.random() - 0.5) * shakeAmp,
        camBase.z);
      camera.lookAt(CAM_TARGET);
      shakeAmp *= 0.85;
    } else if (shakeAmp) {
      shakeAmp = 0;
      camera.position.copy(camBase);
      camera.lookAt(CAM_TARGET);
    }
    renderFrame(Math.min(250, rawMs));
  }
}
let hudTimer = 0;
function afterStep() {
  const n = performance.now();
  if (n - hudTimer > 150) { hudTimer = n; updateHUD(); }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && run.phase === 'active') serializeResume();
  if (document.hidden) platform.flushCloud();   // debounced cloud mirror, if hosted
  lastT = performance.now();
});

// ---------------- boot ----------------
applySettingsOnlyLooks();
function applySettingsOnlyLooks() {
  document.body.classList.toggle('high-contrast', save.settings.highContrast);
  document.body.classList.toggle('larger-text', save.settings.largerText);
}
syncServerTime();
if (platform.hosted) {
  platform.fetchProfile();
  platform.loadCloud();
  platform.refreshToken();
  window.addEventListener('pagehide', () => platform.flushCloud());
}
initRenderer();
buildGfxPanel();
applyGraphics();   // resolves the quality model and builds the scene
gotoTitle();
requestAnimationFrame(t => { lastT = t; requestAnimationFrame(frame); });
