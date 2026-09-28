// Orchard Merge — graphics helpers: procedural textures, the market-stall backdrop, ambient
// motes, merge bursts and the post-processing chain. Quality decisions live in gfx.js; this
// module only builds what the resolved settings ask for.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------------------------------------------------------------- seeded noise
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- procedural textures
/** All textures for the detailed stall. Deterministic (fixed seeds); dispose via disposeTextures. */
export function makeTextures() {
  const T = {};
  // Wood planks with grain streaks (table, posts, crate frame).
  {
    const [c, g] = canvas2d(256, 256);
    const r = rng(11);
    g.fillStyle = '#a06c40'; g.fillRect(0, 0, 256, 256);
    const planks = 4;
    for (let p = 0; p < planks; p++) {
      const y0 = (p * 256) / planks;
      const tint = 0.9 + r() * 0.2;
      g.fillStyle = `rgba(${Math.round(150 * tint)},${Math.round(100 * tint)},${Math.round(58 * tint)},0.55)`;
      g.fillRect(0, y0, 256, 256 / planks);
      for (let i = 0; i < 26; i++) {
        const y = y0 + r() * (256 / planks);
        g.strokeStyle = `rgba(70,40,20,${0.08 + r() * 0.18})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 1.6 + (r() - 0.5));
        g.stroke();
      }
      g.fillStyle = 'rgba(40,22,10,0.55)';
      g.fillRect(0, y0, 256, 2);
    }
    T.wood = tex(c, { repeat: [1, 1] });
  }
  // Striped awning cloth and a scalloped valance (alpha-tested edge).
  {
    const [c, g] = canvas2d(256, 64);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f4e8cc' : '#cf4a3c';
      g.fillRect(i * 32, 0, 32, 64);
    }
    T.awning = tex(c, { repeat: [3, 1] });
    const [c2, g2] = canvas2d(256, 64);
    g2.drawImage(c, 0, 0);
    g2.globalCompositeOperation = 'destination-in';
    g2.beginPath();
    g2.moveTo(0, 0); g2.lineTo(256, 0); g2.lineTo(256, 40);
    for (let i = 7; i >= 0; i--) g2.arc(i * 32 + 16, 40, 16, 0, Math.PI, false);
    g2.closePath(); g2.fill();
    T.valance = tex(c2, { repeat: [3, 1] });
  }
  // Cream canvas back cloth with a soft weave.
  {
    const [c, g] = canvas2d(128, 128);
    const r = rng(23);
    g.fillStyle = '#ece2c8'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 128; i += 2) {
      g.fillStyle = `rgba(120,100,70,${0.03 + r() * 0.04})`; g.fillRect(0, i, 128, 1);
      g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.04})`; g.fillRect(i, 0, 1, 128);
    }
    T.cloth = tex(c, { repeat: [6, 6] });
  }
  // Grass: speckled greens.
  {
    const [c, g] = canvas2d(128, 128);
    const r = rng(37);
    g.fillStyle = '#76a257'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) {
      const v = r();
      g.fillStyle = v < 0.5 ? `rgba(60,110,40,${0.25 + r() * 0.3})` : `rgba(170,200,110,${0.15 + r() * 0.25})`;
      g.fillRect(r() * 128, r() * 128, 1 + r() * 2, 1 + r() * 3);
    }
    T.grass = tex(c, { repeat: [40, 40] });
  }
  // Fruit skin micro-relief (bump + roughness), grayscale, linear.
  {
    const [c, g] = canvas2d(128, 64);
    const r = rng(53);
    g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 900; i++) {
      const v = Math.round(90 + r() * 90);
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.beginPath(); g.arc(r() * 128, r() * 64, 0.6 + r() * 1.2, 0, Math.PI * 2); g.fill();
    }
    T.skin = tex(c, { srgb: false });
  }
  // Sky gradient with painted soft clouds (screen-space background; scrolls when animated).
  {
    const [c, g] = canvas2d(512, 256);
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#5ea8e6');
    grad.addColorStop(0.55, '#a9d6f7');
    grad.addColorStop(1, '#e9f1e4');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
    const r = rng(71);
    for (let k = 0; k < 7; k++) {
      const cx = r() * 512, cy = 30 + r() * 110, w = 40 + r() * 60;
      for (let j = 0; j < 7; j++) {
        const x = cx + (r() - 0.5) * w * 1.6, y = cy + (r() - 0.5) * w * 0.25, rad = w * (0.25 + r() * 0.3);
        for (const dx of [-512, 0, 512]) {
          const rg = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
          rg.addColorStop(0, 'rgba(255,255,255,0.55)');
          rg.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = rg;
          g.beginPath(); g.ellipse(x + dx, y, rad, rad * 0.45, 0, 0, Math.PI * 2); g.fill();
        }
      }
    }
    T.sky = tex(c);
    T.sky.wrapS = THREE.RepeatWrapping;
  }
  // Soft round sprite for particles and motes.
  {
    const [c, g] = canvas2d(64, 64);
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    T.dot = tex(c);
  }
  return T;
}

export function disposeTextures(T) {
  if (T) for (const t of Object.values(T)) t.dispose?.();
}

/** Image-based lighting from three's RoomEnvironment, prefiltered once per renderer. */
export function makeEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const rt = pmrem.fromScene(room, 0.04);
  room.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  pmrem.dispose();
  return rt;
}

// ---------------------------------------------------------------- orchard backdrop
/**
 * Distant orchard (instanced trees with fruit), rolling hills. One draw call per part.
 * Everything sits far behind the stall and never intersects the playfield.
 */
export function buildOrchard(groundY) {
  const group = new THREE.Group();
  const r = rng(97);
  const spots = [];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 16; i++) {
      const x = -150 + i * 20 + (row % 2) * 10 + (r() - 0.5) * 6;
      const z = -45 - row * 26 + (r() - 0.5) * 6;
      if (z > -60 && x > -30 && x < 50) continue; // keep the view behind the stall open
      spots.push([x, z, 0.8 + r() * 0.5]);
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.7, 1.0, 8, 6);
  trunkGeo.translate(0, 4, 0);
  const crownGeo = new THREE.IcosahedronGeometry(6, 1);
  crownGeo.translate(0, 12, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 }), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), spots.length);
  const fruitGeo = new THREE.SphereGeometry(0.75, 8, 6);
  const perTree = 6;
  const fruits = new THREE.InstancedMesh(fruitGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), spots.length * perTree);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const fruitCols = [0xff7a2e, 0xe8432f, 0xffc933, 0xff9a3c];
  spots.forEach(([x, z, k], i) => {
    s.set(k, k, k); p.set(x, groundY, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    m.compose(p, q, s); trunks.setMatrixAt(i, m);
    s.set(k * (0.95 + r() * 0.15), k * (0.85 + r() * 0.2), k * (0.95 + r() * 0.15));
    m.compose(p, q, s); crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, col.setHSL(0.26 + r() * 0.06, 0.45 + r() * 0.15, 0.3 + r() * 0.08));
    for (let j = 0; j < perTree; j++) {
      const a = r() * Math.PI * 2, e = (r() - 0.3) * 1.2;
      const fx = x + Math.cos(a) * Math.cos(e) * 6 * k;
      const fz = z + Math.sin(a) * Math.cos(e) * 6 * k;
      const fy = groundY + (12 + Math.sin(e) * 6) * k;
      m.compose(p.set(fx, fy, fz), q.identity(), s.set(k, k, k));
      fruits.setMatrixAt(i * perTree + j, m);
      fruits.setColorAt(i * perTree + j, col.setHex(fruitCols[(i + j) % fruitCols.length]));
    }
  });
  for (const im of [trunks, crowns, fruits]) { im.castShadow = false; im.receiveShadow = false; group.add(im); }
  // Rolling hills far behind the orchard.
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x86ad62, roughness: 1 });
  for (const [x, z, rad, h] of [[-160, -260, 150, 0.22], [60, -300, 190, 0.2], [240, -250, 140, 0.25]]) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(rad, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
    hill.scale.y = h; hill.position.set(x, groundY, z);
    group.add(hill);
  }
  return group;
}

// ---------------------------------------------------------------- ambient pollen motes
export class Motes {
  constructor(scene, dotTex, count, bounds) {
    this.count = count;
    this.b = bounds; // [x0, x1, y0, y1, z0, z1]
    const r = rng(131);
    this.seed = new Float32Array(count * 4);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.seed[i * 4] = r(); this.seed[i * 4 + 1] = r(); this.seed[i * 4 + 2] = r(); this.seed[i * 4 + 3] = r();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xfff1c4, size: 0.32, map: dotTex, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.t = 0;
    this.update(0);
    scene.add(this.points);
  }
  update(dt) {
    this.t += dt;
    const [x0, x1, y0, y1, z0, z1] = this.b;
    const pos = this.points.geometry.attributes.position;
    for (let i = 0; i < this.count; i++) {
      const a = this.seed[i * 4], b = this.seed[i * 4 + 1], c = this.seed[i * 4 + 2], d = this.seed[i * 4 + 3];
      const t = this.t * (0.02 + d * 0.03);
      const x = x0 + (((a + t) % 1) + 1) % 1 * (x1 - x0);
      const y = y0 + (b + Math.sin(this.t * 0.4 + d * 20) * 0.02) * (y1 - y0);
      const z = z0 + (c + Math.cos(this.t * 0.3 + a * 20) * 0.02) * (z1 - z0);
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- merge bursts
/** Pooled juice droplets (tier-coloured) plus a short ring flash that blooms. */
export class Bursts {
  constructor(scene, dotTex, count) {
    this.count = count;
    this.data = [];
    for (let i = 0; i < count; i++) this.data.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.55, map: dotTex, vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.9, 1, 40);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      }));
      ring.visible = false; ring.renderOrder = 3;
      ring.userData = { life: 0, r: 1 };
      scene.add(ring);
      this.rings.push(ring);
    }
    this._col = new THREE.Color();
    this._next = 0;
  }
  fire(x, y, tier, radius, hex) {
    const pos = this.points.geometry.attributes.position;
    const colA = this.points.geometry.attributes.color;
    const c = this._col.set(hex);
    const n = Math.min(8 + tier * 2, this.count);
    let used = 0;
    for (let i = 0; i < this.count && used < n; i++) {
      const d = this.data[i];
      if (d.life > 0) continue;
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 6;
      d.vx = Math.cos(a) * sp; d.vy = Math.random() * 8 + 2; d.vz = Math.sin(a) * sp * 0.4;
      d.life = 0.8;
      pos.setXYZ(i, x, y, 0);
      const k = 0.85 + Math.random() * 0.3;
      colA.setXYZ(i, Math.min(1, c.r * k + 0.1), Math.min(1, c.g * k + 0.1), Math.min(1, c.b * k + 0.1));
      used++;
    }
    pos.needsUpdate = true; colA.needsUpdate = true;
    this.points.material.opacity = 0.95;
    const ring = this.rings[this._next++ % this.rings.length];
    ring.visible = true;
    ring.position.set(x, y, 0.2);
    ring.userData.life = 0.35; ring.userData.r = radius;
    // Above 1.0 so it passes the bloom threshold; tone mapping keeps it tasteful.
    ring.material.color.copy(c).multiplyScalar(2.2).addScalar(0.15);
  }
  update(dt) {
    const pos = this.points.geometry.attributes.position;
    let any = false;
    for (let i = 0; i < this.count; i++) {
      const d = this.data[i];
      if (d.life <= 0) continue;
      d.life -= dt; any = true;
      d.vy -= 20 * dt;
      pos.setXYZ(i, pos.getX(i) + d.vx * dt, pos.getY(i) + d.vy * dt, pos.getZ(i) + d.vz * dt);
    }
    if (any) pos.needsUpdate = true;
    this.points.material.opacity = Math.max(0, this.points.material.opacity - dt * 1.2);
    for (const ring of this.rings) {
      if (!ring.visible) continue;
      const u = ring.userData;
      u.life -= dt;
      if (u.life <= 0) { ring.visible = false; continue; }
      const k = 1 - u.life / 0.35;
      ring.scale.setScalar(u.r * (1 + k * 1.2));
      ring.material.opacity = (1 - k) * 0.9;
    }
  }
}

// ---------------------------------------------------------------- post-processing
// Colour grade + vignette (display-referred values in, same out; HDR headroom preserved).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.2 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      vec3 lc = clamp(c, 0.0, 1.0);
      // Gentle S-curve, a touch more saturation, warm highlights / cool shadows (sunny market).
      vec3 s = mix(lc, lc * lc * (3.0 - 2.0 * lc), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.97, 0.99, 1.04), vec3(1.04, 1.01, 0.95), smoothstep(0.2, 0.8, l));
      s = s * 0.98 + 0.015;
      c = mix(c, s + max(c - 1.0, 0.0), uAmount);
      float d = length(vUv - 0.5);
      c *= 1.0 - uVignette * smoothstep(0.4, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

/**
 * RenderPass → GTAO → UnrealBloom → grade → OutputPass → SMAA/FXAA, rebuilt when its key
 * changes. MSAA uses a multisampled composer target. Never throws: on failure `failed` is set
 * and the caller renders directly.
 */
export class PostChain {
  constructor(renderer) {
    this.renderer = renderer;
    this.composer = null;
    this.key = null;
    this.failed = false;
  }
  invalidate() { this.key = null; }
  keyFor(q, w, h, pr) {
    return q.post ? [q.ao, q.bloom, q.grade, q.antialias, w, h, pr].join('|') : 'none';
  }
  sync(q, scene, camera, w, h, pr) {
    const key = this.keyFor(q, w, h, pr);
    if (key === this.key && this.scene === scene && this.camera === camera) return;
    this.key = key;
    this.scene = scene;
    this.camera = camera;
    this.build(q, scene, camera, w, h, pr);
  }
  dispose() {
    if (this.composer) {
      for (const p of this.composer.passes) p.dispose?.();
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    this.composer = null;
  }
  build(q, scene, camera, w, h, pr) {
    this.dispose();
    this.failed = false;
    if (!q.post || w < 2 || h < 2) return;
    try {
      const W = Math.max(1, Math.round(w * pr)), H = Math.max(1, Math.round(h * pr));
      const target = new THREE.WebGLRenderTarget(W, H, {
        type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(scene, camera));
      if (q.ao !== 'off') {
        const ao = new GTAOPass(scene, camera, W, H);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.7;
        ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.4, thickness: 1.5, scale: 1.0, samples: q.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: q.ao === 'high' ? 6 : 4, rings: 2, samples: q.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (q.bloom === 'on') {
        // High threshold: only emissive accents (warning line, merge flashes) and hot highlights.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.35, 0.92));
      }
      if (q.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      composer.addPass(new OutputPass());
      if (q.antialias === 'smaa') composer.addPass(new SMAAPass(W, H));
      if (q.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / W, 1 / H);
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly if the chain cannot be built.
      this.failed = true;
      this.dispose();
    }
  }
  /** Returns false when the caller should render directly. */
  render(dt) {
    if (!this.composer) return false;
    try {
      this.composer.render(dt);
      return true;
    } catch {
      this.failed = true;
      this.dispose();
      return false;
    }
  }
}
