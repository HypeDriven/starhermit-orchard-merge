// Orchard Merge — browser front-end. Sections:
// 1. Config & palettes  2. Persistence  3. Audio  4. Three.js scene
// 5. Game session (modes, journey, replay)  6. Input  7. Screens/UI  8. Main loop
import * as THREE from 'three';

const R = globalThis.OrchardRules;
const { STEP_MS, WORLD_W, WORLD_H, WARN_Y, TIER_R } = R;

// ---------------- 1. Config & palettes ----------------
const CONFIG = {
  camPos: [26, 26, 42], camTarget: [10, 12, 0], fov: 38,
  dprCap: 2, particles: { low: 0, med: 60, high: 160 },
  shadowSize: { low: 0, med: 1024, high: 2048 },
  renderScale: { low: 0.75, med: 1, high: 1 },
  dailyEpoch: '2025-01-01',
};
// distinct color per tier; marker = number of little leaves (colorblind-safe cue)
const PALETTES = {
  default:      [null,'#ff5a5a','#ff9440','#ffd23f','#a3e048','#37c871','#34c6c9','#4d8dff','#8a6fe8','#d96bd0','#ff7ab0'],
  deuteranopia: [null,'#d55e00','#e69f00','#f0e442','#009e73','#56b4e9','#0072b2','#332288','#cc79a7','#88ccee','#ffffff'],
};
const TIER_NAMES = [null,'Cherry','Strawberry','Plum','Orange','Apple','Pear','Peach','Grapefruit','Melon','Pumpkin'];

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
      quality: 'med', palette: 'default', reducedMotion: false, highContrast: false,
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
let save = loadSave();
function persist() {
  try {
    const d = { ...save, sum: 0 };
    d.sum = checksum(d);
    save.sum = d.sum;
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
  } catch { /* storage full/blocked — play on without persistence */ }
}

// Host time offset (optional): GET /api/v1/time, adjusted for round trip.
let timeOffsetMs = 0;
async function syncServerTime() {
  try {
    const t0 = Date.now();
    const res = await fetch('/api/v1/time');
    const t1 = Date.now();
    if (!res.ok) return;
    const j = await res.json();
    const serverMs = typeof j === 'number' ? j : (j.now ?? j.time ?? j.ms);
    if (typeof serverMs === 'number') timeOffsetMs = serverMs - (t0 + t1) / 2;
  } catch { /* offline — use local clock silently */ }
}
const now = () => Date.now() + timeOffsetMs;
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
let particlePool = [], particleData = [];
let shakeAmp = 0;
const tmpV = new THREE.Vector3();

function buildScene() {
  const q = save.settings.quality;
  renderer?.dispose?.();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: q !== 'low', alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, CONFIG.dprCap) * CONFIG.renderScale[q]);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = CONFIG.shadowSize[q] > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe3ff);
  scene.fog = new THREE.Fog(0xbfe3ff, 90, 220);

  camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, 0.1, 400);
  camera.position.set(...CONFIG.camPos);
  camera.lookAt(...CONFIG.camTarget);

  hemi = new THREE.HemisphereLight(0xfff5e0, 0x5a7a4a, 0.9);
  scene.add(hemi);
  dirLight = new THREE.DirectionalLight(0xffe8c0, 1.6);
  dirLight.position.set(25, 45, 30);
  dirLight.castShadow = renderer.shadowMap.enabled;
  if (renderer.shadowMap.enabled) {
    const s = CONFIG.shadowSize[q];
    dirLight.shadow.mapSize.set(s, s);
    dirLight.shadow.camera.left = -20; dirLight.shadow.camera.right = 40;
    dirLight.shadow.camera.top = 40; dirLight.shadow.camera.bottom = -10;
  }
  scene.add(dirLight);

  // ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(120, 48),
    new THREE.MeshStandardMaterial({ color: 0x7aa05c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  // wooden stall frame
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.8 });
  const post = (x, z) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 36, 1.2), wood);
    p.position.set(x, 18, z); p.castShadow = true; scene.add(p);
  };
  post(-1.6, -2); post(WORLD_W + 1.6, -2); post(-1.6, 2); post(WORLD_W + 1.6, 2);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(WORLD_W + 8, 0.6, 12),
    new THREE.MeshStandardMaterial({ color: 0xd66a4a, roughness: 0.9 }));
  canopy.position.set(WORLD_W / 2, 37, 0); canopy.castShadow = true; scene.add(canopy);
  const table = new THREE.Mesh(new THREE.BoxGeometry(WORLD_W + 6, 1.4, 8), wood);
  table.position.set(WORLD_W / 2, -0.7, 0); table.receiveShadow = true; scene.add(table);

  // transparent crate walls (floor + 2 sides, thin slabs)
  const wallMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfe8ff, transparent: true, opacity: 0.18, roughness: 0.1,
    transmission: 0.6, side: THREE.DoubleSide, depthWrite: false,
  });
  const mkWall = (w, h, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.25), wallMat);
    m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
  };
  mkWall(WORLD_W, 0.3, WORLD_W / 2, -0.15, 0);             // floor slab visual
  mkWall(0.3, WORLD_H + 2, -0.15, (WORLD_H + 2) / 2, 0);   // left
  mkWall(0.3, WORLD_H + 2, WORLD_W + 0.15, (WORLD_H + 2) / 2, 0); // right

  // warning line
  warnLine = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD_W, 0.12, 1.5),
    new THREE.MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.5 }));
  warnLine.position.set(WORLD_W / 2, WARN_Y, 0);
  scene.add(warnLine);

  // ghost preview + guide line + hint marker
  ghostFruit = makeFruitMesh(1);
  ghostFruit.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = 0.4; } });
  ghostFruit.visible = false; scene.add(ghostFruit);
  guideLine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  guideLine.visible = false; scene.add(guideLine);
  hintMarker = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  hintMarker.rotation.x = Math.PI; hintMarker.visible = false; scene.add(hintMarker);

  // particle pool (merge bursts)
  initParticles();
  resize();
}

// fruit mesh: colored sphere + distinct leaf-count marker per tier (colorblind cue)
function makeFruitMesh(tier) {
  const colors = PALETTES[save.settings.palette] || PALETTES.default;
  const g = new THREE.Group();
  const r = TIER_R[tier];
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(r, 28, 20),
    new THREE.MeshStandardMaterial({ color: colors[tier], roughness: 0.55, metalness: 0.05 }));
  body.castShadow = true;
  g.add(body);
  // stem
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.12, r * 0.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 }));
  stem.position.y = r * 0.95; g.add(stem);
  // leaves: count = tier (visual marker distinct from color)
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7d2c, roughness: 0.8, side: THREE.DoubleSide });
  const n = tier;
  for (let i = 0; i < n; i++) {
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.14, r * 0.22), 6), leafMat);
    const a = (i / n) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * r * 0.5, r * 1.02, Math.sin(a) * r * 0.5);
    leaf.rotation.set(-Math.PI / 2 + 0.4, 0, a);
    g.add(leaf);
  }
  // emissive ring whose count of bands = tier parity (extra cue)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, r * 0.05, 6, 24, Math.PI * 2),
    new THREE.MeshStandardMaterial({ color: colors[tier], emissive: colors[tier], emissiveIntensity: 0.5 }));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  return g;
}

function initParticles() {
  for (const p of particlePool) scene.remove(p);
  particlePool = []; particleData = [];
  const count = CONFIG.particles[save.settings.quality];
  if (!count) return;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffe08a, size: 0.5, transparent: true, opacity: 0, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);
  particlePool.push(pts);
  for (let i = 0; i < count; i++) particleData.push({ vx: 0, vy: 0, vz: 0, life: 0 });
}
function burst(x, y, tier) {
  if (save.settings.reducedMotion || !particlePool.length) return;
  const pts = particlePool[0];
  const pos = pts.geometry.attributes.position;
  const n = Math.min(8 + tier * 2, particleData.length);
  let used = 0;
  for (let i = 0; i < particleData.length && used < n; i++) {
    const d = particleData[i];
    if (d.life > 0) continue;
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 6;
    d.vx = Math.cos(a) * sp; d.vy = Math.random() * 8 + 2; d.vz = Math.sin(a) * sp * 0.4;
    d.life = 0.8;
    pos.setXYZ(i, x, y, 0);
    used++;
  }
  pos.needsUpdate = true;
  pts.material.opacity = 0.95;
}
function tickParticles(dt) {
  if (!particlePool.length) return;
  const pts = particlePool[0];
  const pos = pts.geometry.attributes.position;
  let any = false;
  for (let i = 0; i < particleData.length; i++) {
    const d = particleData[i];
    if (d.life <= 0) continue;
    d.life -= dt; any = true;
    d.vy -= 20 * dt;
    pos.setXYZ(i, pos.getX(i) + d.vx * dt, pos.getY(i) + d.vy * dt, pos.getZ(i) + d.vz * dt);
  }
  if (any) pos.needsUpdate = true;
  pts.material.opacity = Math.max(0, pts.material.opacity - dt * 1.2);
}

function resize() {
  if (!renderer) return;
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  document.getElementById('ctxlost').classList.remove('hidden');
});
canvas.addEventListener('webglcontextrestored', () => {
  document.getElementById('ctxlost-msg').textContent = 'Context restored — rebuilding…';
  buildScene();
  for (const [id] of fruitMeshes) fruitMeshes.delete(id); // rebuilt next sync
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
  run.commands = []; run.undoStack = []; run.aimX = WORLD_W / 2;
  run.ranked = !!modeOpts.ranked; run.pausedMs = 0; run.startedAt = now();
  run.tutorial.step = mode === 'learn' ? 0 : -1;
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
  run.aimX = WORLD_W / 2; run.startedAt = now();
  run.tutorial.step = run.mode === 'learn' ? Math.min(r.commands.length > 0 ? 1 : 0, 2) : -1;
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
  if (run.mode === 'practice') run.undoStack.push(R.snapshot(run.state));
  if (run.undoStack.length > 20) run.undoStack.shift();
  const ok = R.applyCommand(run.state, { kind: 'drop', x: qx });
  if (ok) {
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
  updateHUD(true);
}

function skipSettle() {
  if (!run.state || run.phase !== 'active') return;
  drainEvents(); // capture pending merge fx
  R.settle(run.state);
  drainEvents();
  afterStep();
}

function showHint() {
  if (!run.state || !R.legalActions(run.state).hint) { audio.invalid(); return; }
  const x = R.hint(run.state);
  hintMarker.position.set(x, WORLD_H + 0.8, 0);
  hintMarker.visible = true;
  setTimeout(() => { hintMarker.visible = false; }, 2500);
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
      if (run.mode === 'learn' && run.tutorial.step === 1) { run.tutorial.step = 2; updateObjective(); }
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
  audio.fanfare(win || reason === 'overflow');
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
  }
  if (run.mode === 'daily') {
    const d = utcDateStr();
    const prev = save.daily[d]?.score || 0;
    if (bd.total > prev) save.daily[d] = { score: bd.total, hash };
  }
  if (run.ranked) {
    const entry = { mode: run.mode, score: bd.total, seed: run.state.seed,
      difficulty: run.state.difficulty, hash,
      replay: { seed: run.state.seed, difficulty: run.state.difficulty, commands: run.commands },
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
  try {
    await fetch('/api/v1/scores', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'guest', scope: entry.mode === 'daily' ? 'daily' : 'score-chase',
        seed: entry.seed, difficulty: entry.difficulty,
        commands: entry.replay.commands, finalHash: entry.hash, score: entry.score }) });
  } catch { /* 404/offline — local leaderboard only */ }
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
  const nextTxt = `${TIER_NAMES[s.nextTier]} (${s.nextTier})`;
  $('next-fruit').textContent = nextTxt;
  $('next-top').textContent = nextTxt;
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
    starter = () => newRun('daily', { seed: R.hashStr('orchard-daily-' + d), difficulty: 'normal', ranked: true });
    if (done) $('setup-start').textContent = 'Replay (unranked)'; else $('setup-start').textContent = 'Start';
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
  $('set-quality').value = s.quality; $('set-palette').value = s.palette;
  $('set-rm').checked = s.reducedMotion; $('set-hc').checked = s.highContrast; $('set-lt').checked = s.largerText;
  showScreen('scr-settings');
}
function applySettings() {
  const s = save.settings;
  s.music = +$('set-music').value; s.sfx = +$('set-sfx').value; s.amb = +$('set-amb').value;
  s.mute = $('set-mute').checked; s.haptics = $('set-haptics').checked;
  s.quality = $('set-quality').value; s.palette = $('set-palette').value;
  s.reducedMotion = $('set-rm').checked; s.highContrast = $('set-hc').checked; s.largerText = $('set-lt').checked;
  document.body.classList.toggle('high-contrast', s.highContrast);
  document.body.classList.toggle('larger-text', s.largerText);
  audio.applyVolumes(); persist(); buildScene(); // quality/palette take effect immediately
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
  run.phase = 'title';
  showScreen('scr-title');
}

// ---------------- 6. Input ----------------
function aimFromClientX(clientX) {
  const rect = canvas.getBoundingClientRect();
  const ndc = ((clientX - rect.left) / rect.width) * 2 - 1;
  // unproject a ray to the top plane (y = WORLD_H)
  tmpV.set(ndc, 0.5, 0.5).unproject(camera);
  const dir = tmpV.sub(camera.position).normalize();
  const t = (WORLD_H - camera.position.y) / dir.y;
  const x = camera.position.x + dir.x * t;
  run.aimX = R.quantizeX(Math.max(TIER_R[1], Math.min(WORLD_W - TIER_R[1], x)));
  $('aim-slider').value = run.aimX;
}

let dragging = false, dragMoved = false;
canvas.addEventListener('pointerdown', e => {
  if (run.phase !== 'active') return;
  audio.ensure();
  dragging = true; dragMoved = false;
  canvas.setPointerCapture(e.pointerId);
  aimFromClientX(e.clientX);
});
canvas.addEventListener('pointermove', e => {
  if (dragging && run.phase === 'active') { dragMoved = true; aimFromClientX(e.clientX); }
});
canvas.addEventListener('pointerup', e => {
  if (!dragging) return;
  dragging = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  if (run.phase === 'active') { aimFromClientX(e.clientX); tryDrop(run.aimX); }
});
canvas.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('lostpointercapture', () => { dragging = false; });

$('aim-slider').addEventListener('input', e => { run.aimX = +e.target.value; });

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  const k = e.key;
  if (k === 'p' || k === 'P' || k === 'Escape') {
    if (run.phase === 'active') pauseGame();
    else if (run.phase === 'paused') resumeGame();
    e.preventDefault();
  } else if (run.phase === 'active') {
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { run.aimX = R.quantizeX(Math.max(TIER_R[1], run.aimX - 0.5)); $('aim-slider').value = run.aimX; e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { run.aimX = R.quantizeX(Math.min(WORLD_W - TIER_R[1], run.aimX + 0.5)); $('aim-slider').value = run.aimX; e.preventDefault(); }
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
$('bt-play').addEventListener('click', () => { audio.ensure(); audio.click(); openSetup('learn'); });
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
for (const id of ['set-music','set-sfx','set-amb','set-mute','set-haptics','set-quality','set-palette','set-rm','set-hc','set-lt'])
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
  if (!s) { for (const [, m] of fruitMeshes) m.visible = false; return; }
  const seen = new Set();
  for (const f of s.fruits) {
    seen.add(f.id);
    let m = fruitMeshes.get(f.id);
    if (!m) { m = makeFruitMesh(f.tier); fruitMeshes.set(f.id, m); scene.add(m); }
    m.visible = true;
    m.position.set(f.x, f.y, 0);
    m.rotation.z = -f.x * 0.05;
  }
  for (const [id, m] of fruitMeshes) {
    if (!seen.has(id)) { scene.remove(m); fruitMeshes.delete(id); }
  }
  // ghost preview
  if (run.phase === 'active' && R.legalActions(s).drop) {
    const tier = s.currentTier;
    ghostFruit.visible = guideLine.visible = true;
    ghostFruit.position.set(run.aimX, WORLD_H - TIER_R[tier] - 0.5, 0);
    ghostFruit.scale.setScalar(TIER_R[tier] / TIER_R[1]);
    guideLine.position.set(run.aimX, WORLD_H - 4, 0);
  } else {
    ghostFruit.visible = guideLine.visible = false;
  }
  // warning line glow
  const hot = s.aboveLineTicks > 0;
  warnLine.material.opacity = hot ? 0.5 + 0.4 * Math.sin(performance.now() / 120) : 0.35;
  warnLine.material.color.setHex(hot ? 0xff2211 : 0xff5544);
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - lastT) / 1000);
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
  if (renderer) {
    tickParticles(dt);
    syncMeshes();
    if (shakeAmp > 0.001) {
      camera.position.set(
        CONFIG.camPos[0] + (Math.random() - 0.5) * shakeAmp,
        CONFIG.camPos[1] + (Math.random() - 0.5) * shakeAmp,
        CONFIG.camPos[2]);
      camera.lookAt(...CONFIG.camTarget);
      shakeAmp *= 0.85;
    }
    renderer.render(scene, camera);
  }
}
let hudTimer = 0;
function afterStep() {
  const n = performance.now();
  if (n - hudTimer > 150) { hudTimer = n; updateHUD(); }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && run.phase === 'active') serializeResume();
  lastT = performance.now();
});

// ---------------- boot ----------------
applySettingsOnlyLooks();
function applySettingsOnlyLooks() {
  document.body.classList.toggle('high-contrast', save.settings.highContrast);
  document.body.classList.toggle('larger-text', save.settings.largerText);
}
syncServerTime();
buildScene();
gotoTitle();
requestAnimationFrame(t => { lastT = t; requestAnimationFrame(frame); });
