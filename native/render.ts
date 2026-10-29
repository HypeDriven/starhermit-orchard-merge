// The 3D market stall on starhermit:scene, as the browser build drew it with
// three.js r182 (src/main.js section 4 and src/render-gfx.js): the grass,
// the market table, the stall's posts, back cloth and striped awning (with a
// scalloped valance on detailed looks), the glass crate with its wooden
// frame, the glowing warning line, the fruit (a coloured sphere per tier with
// a stem, as many leaves as its tier and an emissive ring; glossy skins with
// micro-relief on High and Ultra, pumpkin ribs), the translucent drop preview
// with its guide line, the hint marker, the distant orchard and hills, the
// drifting clouds and pollen motes, the merge bursts (juice droplets and a
// ring flash that blooms), the fruit pop-in and the camera shake.
//
// From three.js r182 (engine.minor 26+): light intensities, normalBias and
// the orthographic shadow box fitted around the stall as the page set them;
// RoomEnvironment(renderer) + PMREM give the reflections at the old
// environmentIntensity 0.22; the post chain (GTAO, UnrealBloom 0.35 / 0.35 /
// 0.92, the GradeShader before the output, FXAA / SMAA / MSAA) is
// renderer.ao / bloom / grade / antialias. The procedural canvas
// textures are baked into assets/textures (tools/bake-textures.mjs). The
// camera keeps the authored 3/4 direction and backs off until the crate,
// the drop preview and the warning line fit the window, as fitCamera did.
// Rendering reads rules state and never writes it.
import {
  ACESFilmicToneMapping, BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  NoColorSpace, Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Points, PointsMaterial, Quaternion,
  RepeatWrapping, RingGeometry, RoomEnvironment, SRGBColorSpace, Shape, ShapeGeometry, SphereGeometry, TextureLoader,
  TorusGeometry, Vector3, mergeGeometries, renderer, scene,
  type Material, type Texture,
} from "starhermit:scene";
import { frame } from "starhermit:engine";
import { R, type State } from "./rules.ts";
import type { Look } from "./quality.ts";

const PI = Math.PI;
const { WORLD_W, WORLD_H, WARN_Y, TIER_R } = R;
const GROUND_Y = -9;           // the stall table stands on the grass
const CRATE_D = 5.8;           // crate half-depth: holds the largest fruit

renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new PerspectiveCamera(38, 1, 0.5, 600);
renderer.camera = camera;

// ------------------------------------------------------------------ textures
type TexName = "wood" | "awning" | "valance" | "cloth" | "grass" | "skin" | "sky" | "dot";
const REPEAT: Partial<Record<TexName, [number, number]>> = { wood: [1, 1], awning: [3, 1], valance: [3, 1], cloth: [6, 6], grass: [40, 40] };
const loader = new TextureLoader();
const texCache = new Map<string, Texture>();
/** A baked texture (tools/bake-textures.mjs) at the look's scale, as render-gfx.js tex() set it up. */
function tex(name: TexName, k: 1 | 2): Texture {
  const kk = name === "skin" || name === "dot" ? 1 : k;
  const key = `${name}-${kk}`;
  let t = texCache.get(key);
  if (t) return t;
  t = loader.load(`assets/textures/${key}.png`, undefined, undefined, (e: unknown) => console.warn(`texture ${key}: ${e instanceof Error ? e.message : String(e)}`));
  t.colorSpace = name === "skin" ? NoColorSpace : SRGBColorSpace;
  const rep = REPEAT[name];
  if (rep) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  if (name === "sky") t.wrapS = RepeatWrapping;
  if (name === "skin") { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(3, 2); }
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------ state
let look: Look | null = null;
let palette: (string | null)[] = [];
let world: Group | null = null;
let hemi: HemisphereLight | null = null;
let dirLight: DirectionalLight | null = null;
let warnLine: Mesh | null = null;
let guideLine: Mesh | null = null;
let hintMarker: Mesh | null = null;
let ghostFruit: Group | null = null;
let ghostTier = 0;
let bursts: Bursts | null = null;
let motes: Motes | null = null;
let sky: Texture | null = null;
let envTex: Texture | null = null;
let reducedMotion = false;
let shakeAmp = 0;
let hintUntil = 0;
let lastStateRef: State | null = null;
let freshSync = true;
const fruitMeshes = new Map<number, Group>();
const tmpV = new Vector3();

export function setReducedMotion(on: boolean): void { reducedMotion = on; }
const motionOK = (): boolean => !reducedMotion;
const detailed = (): boolean => !!look?.detailed;

// ------------------------------------------------------------------ camera framing
// Keep the authored 3/4 direction, but derive the distance from the window so the whole crate — including the
// drop preview above the rim and the warning line — stays on screen at any aspect ratio.
const CAM_DIR = new Vector3(26, 26, 42).sub(new Vector3(10, 12, 0)).normalize();
const CAM_TARGET = new Vector3(WORLD_W / 2, (WORLD_H + 2) / 2, 0);
const CAM_HALF_H = (WORLD_H + 4) / 2;   // -1 .. WORLD_H + 3 (rim + ghost fruit)
const CAM_HALF_W = (WORLD_W + 6) / 2;   // crate plus a little stall margin
const camBase = new Vector3();
let camDist = 60;
function fitCamera(): void {
  const t = Math.tan((camera.fov * PI) / 360);
  camDist = Math.max(CAM_HALF_H / t, CAM_HALF_W / (t * Math.max(0.2, camera.aspect))) * 1.15;
  camBase.copy(CAM_DIR).multiplyScalar(camDist).add(CAM_TARGET);
  camera.position.copy(camBase);
  camera.lookAt(CAM_TARGET);
}

// ------------------------------------------------------------------ the scene
function disposeWorld(): void {
  if (!world) return;
  scene.remove(world);
  const geos = new Set<BufferGeometry>(), mats = new Set<Material>();
  world.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) for (const x of ([] as Material[]).concat(m.material as Material | Material[])) mats.add(x);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  world = null;
  fruitRes = null;
  bursts = null;
  motes = null;
  ghostFruit = null;
  ghostTier = 0;
  fruitMeshes.clear();
}

/** fitShadowFrustum: the sun's orthographic shadow camera fitted tightly around the stall (table, crate, cloth). */
function fitShadowFrustum(light: DirectionalLight): void {
  const probe = new Object3D();
  probe.position.copy(light.position);
  probe.lookAt(light.target.position);
  probe.updateMatrixWorld();
  const inv = probe.matrixWorld.clone().invert();
  const v = new Vector3();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const x of [-9, WORLD_W + 9]) for (const y of [GROUND_Y, 39]) for (const z of [-10, 12]) {
    v.set(x, y, z).applyMatrix4(inv);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  // Object3D.lookAt on a non-camera points +z at the target; the shadow camera looks down -z.
  const cam = light.shadow.camera as OrthographicCamera;
  Object.assign(cam, { left: -maxX, right: -minX, top: maxY, bottom: minY, near: Math.max(0.5, minZ - 5), far: maxZ + 5 });
  cam.updateProjectionMatrix();
}

/** buildScene: the stall, crate, warning line, preview and markers, the orchard and the effects for a look and palette. */
function buildScene(): void {
  const q = look!;
  const det = q.detailed;
  const k = q.budget.texture;
  disposeWorld();
  freshSync = true;
  const w = new Group();
  world = w;
  scene.add(w);
  if (det) {
    sky = tex("sky", k);
    scene.background = sky;
    scene.fog = new Fog(0xe4efe2, 150, 380);
  } else {
    sky = null;
    scene.background = new Color(0xbfe3ff);
    scene.fog = new Fog(0xbfe3ff, 150, 320);
  }
  if (q.reflections && !envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  scene.environment = q.reflections ? envTex : null;
  scene.environmentIntensity = 0.22;

  // Warm sun (key) with PCF shadows over the stall, plus a sky/grass hemisphere fill.
  hemi = new HemisphereLight(0xfff3dc, 0x5f7d4c, q.reflections ? 0.75 : 0.95);
  w.add(hemi);
  dirLight = new DirectionalLight(0xffe4bd, 2.0);
  dirLight.position.copy(CAM_TARGET).add(new Vector3(15, 29, 30).normalize().multiplyScalar(70));
  dirLight.target.position.copy(CAM_TARGET);
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.04;
  w.add(dirLight, dirLight.target);
  fitShadowFrustum(dirLight);
  const shadows = q.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  dirLight.castShadow = shadows;
  if (shadows) dirLight.shadow.mapSize = q.shadows;

  // Stall shading per the preset's budget: Lambert on Low (roughness/env settings dropped), Standard above.
  const std = (o: Record<string, unknown>): Material => {
    if (q.budget.material !== "lambert") return new MeshStandardMaterial(o);
    const { roughness: _r, metalness: _m, envMapIntensity: _e, ...rest } = o;
    void _r; void _m; void _e;
    return new MeshLambertMaterial(rest);
  };
  const woodMat = det ? std({ color: 0xffffff, map: tex("wood", k), roughness: 0.75 }) : std({ color: 0x8a5a33, roughness: 0.8 });
  const darkWood = det ? std({ color: 0x9a8070, map: tex("wood", k), roughness: 0.8 }) : std({ color: 0x6e4526, roughness: 0.85 });
  const box = (bw: number, bh: number, bd: number, mat: Material, x: number, y: number, z: number, { cast = true, receive = true } = {}): Mesh => {
    const m = new Mesh(new BoxGeometry(bw, bh, bd), mat);
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = receive;
    w.add(m);
    return m;
  };

  // grass
  const ground = new Mesh(new CircleGeometry(420, 64), det ? std({ color: 0xffffff, map: tex("grass", k), roughness: 1 }) : std({ color: 0x7aa05c, roughness: 1 }));
  ground.rotation.x = -PI / 2; ground.position.y = GROUND_Y; ground.receiveShadow = true;
  w.add(ground);

  // market table: plank top on four legs
  const tableW = WORLD_W + 14, tableD = CRATE_D * 2 + 6;
  box(tableW, 1.2, tableD, woodMat, WORLD_W / 2, -0.9, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(1.1, -1.5 - GROUND_Y, 1.1, darkWood, WORLD_W / 2 + sx * (tableW / 2 - 1.2), (GROUND_Y - 1.5) / 2, sz * (tableD / 2 - 1.2));
  }

  // stall: four posts, cream back cloth, striped awning with a scalloped valance
  for (const x of [-7.5, WORLD_W + 7.5]) for (const z of [-9.2, 9]) box(1.1, 37 - GROUND_Y, 1.1, darkWood, x, (37 + GROUND_Y) / 2, z);
  const cloth = new Mesh(new PlaneGeometry(tableW + 1, 38),
    det ? std({ color: 0xe6dcc6, map: tex("cloth", k), roughness: 0.95, envMapIntensity: 0.4 }) : std({ color: 0xe6dcc4, roughness: 0.95 }));
  cloth.position.set(WORLD_W / 2, 17.5, -8.9); cloth.receiveShadow = true;
  w.add(cloth);
  const awningMat = det ? std({ color: 0xffffff, map: tex("awning", k), roughness: 0.9 }) : std({ color: 0xd66a4a, roughness: 0.9 });
  // the awning casts no shadow, so the playfield stays evenly lit under it
  const awning = box(tableW + 4, 0.4, 22, awningMat, WORLD_W / 2, 38, 0.5, { cast: false });
  awning.rotation.x = 0.1;
  if (det) {
    const valance = new Mesh(new PlaneGeometry(tableW + 4, 2.4),
      std({ color: 0xffffff, map: tex("valance", k), alphaTest: 0.5, side: DoubleSide, roughness: 0.9 }));
    valance.position.set(WORLD_W / 2, 36.4, 11.5);
    w.add(valance);
  }

  // the crate: wooden floor and corner frame, clear glass panes (no front pane)
  box(WORLD_W + 0.8, 0.3, CRATE_D * 2, woodMat, WORLD_W / 2, -0.15, 0, { cast: false });
  const frameH = WORLD_H + 2;
  for (const x of [-0.45, WORLD_W + 0.45]) for (const z of [-CRATE_D, CRATE_D]) box(0.4, frameH, 0.4, darkWood, x, frameH / 2, z);
  for (const z of [-CRATE_D, CRATE_D]) box(WORLD_W + 1.3, 0.4, 0.4, darkWood, WORLD_W / 2, frameH, z);
  for (const x of [-0.45, WORLD_W + 0.45]) box(0.4, 0.4, CRATE_D * 2, darkWood, x, frameH, 0);
  // faint tinted glass: reads as a surface without veiling the fruit behind or through it
  const glass = (opacity: number): Material => new MeshPhysicalMaterial({
    color: 0xc4dbe6, transparent: true, opacity, roughness: 0.1, metalness: 0,
    envMapIntensity: 0.6, side: DoubleSide, depthWrite: false,
  });
  const pane = (pw: number, ph: number, pd: number, mat: Material, x: number, y: number, z: number): void => {
    const m = new Mesh(new BoxGeometry(pw, ph, pd), mat);
    m.position.set(x, y, z); m.renderOrder = 1; w.add(m);
  };
  pane(WORLD_W + 0.5, frameH, 0.12, glass(0.07), WORLD_W / 2, frameH / 2, -CRATE_D);
  const sideGlass = glass(0.05);
  pane(0.12, frameH, CRATE_D * 2, sideGlass, -0.3, frameH / 2, 0);
  pane(0.12, frameH, CRATE_D * 2, sideGlass, WORLD_W + 0.3, frameH / 2, 0);

  // warning line (glows past the bloom threshold when fruit is above it)
  warnLine = new Mesh(new BoxGeometry(WORLD_W, 0.12, 1.5), new MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.5 }));
  warnLine.position.set(WORLD_W / 2, WARN_Y, 0);
  w.add(warnLine);

  // ghost preview (rebuilt per tier in sync) + guide line + hint marker
  guideLine = new Mesh(new BoxGeometry(0.08, 6, 0.08), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  guideLine.visible = false; w.add(guideLine);
  hintMarker = new Mesh(new ConeGeometry(0.5, 1.2, 6), new MeshBasicMaterial({ color: 0xffe08a }));
  hintMarker.rotation.x = PI; hintMarker.visible = false; w.add(hintMarker);

  if (det) w.add(buildOrchard(q));
  if (q.sparks > 0) bursts = new Bursts(w, tex("dot", 1), q.sparks);
  if (q.animated) motes = new Motes(w, tex("dot", 1), q.budget.motes, [-6, WORLD_W + 6, 0, 34, -8, 9]);
  aspectFit = -1;
}

// ------------------------------------------------------------------ fruit
// Per-fruit look (detailed): glossy or velvety skins with micro-relief. Colours stay the palette's, so tiers read
// the same at every quality.
// (The peach's velvet sheen, `sheen: 1`, is left out: the engine draws no sheen.)
interface Skin { rough: number; cc: number; bump: number; sheen?: number; ribs?: number }
const SKIN: (Skin | null)[] = [null,
  { rough: 0.28, cc: 0.9, bump: 0.25 }, { rough: 0.4, cc: 0.5, bump: 1.0 }, { rough: 0.35, cc: 0.6, bump: 0.3 },
  { rough: 0.5, cc: 0.35, bump: 1.4 }, { rough: 0.3, cc: 0.8, bump: 0.3 }, { rough: 0.45, cc: 0.45, bump: 0.5 },
  { rough: 0.7, cc: 0, bump: 0.4, sheen: 1 }, { rough: 0.45, cc: 0.4, bump: 1.1 }, { rough: 0.6, cc: 0.2, bump: 0.9 },
  { rough: 0.55, cc: 0.3, bump: 0.7, ribs: 8 }];
interface TierRes { bodyGeo: BufferGeometry; bodyMat: Material; stemGeo: BufferGeometry; ringGeo: BufferGeometry; ringMat: Material; leavesGeo: BufferGeometry }
interface FruitRes { tiers: TierRes[]; stemMat: Material; leafMat: Material }
let fruitRes: FruitRes | null = null;

function fruitResources(): FruitRes {
  if (fruitRes) return fruitRes;
  const det = detailed();
  const b = look!.budget, lambert = b.material === "lambert";
  const leafShape = new Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.5, 0.42, 1, 0);
  leafShape.quadraticCurveTo(0.5, -0.42, 0, 0);
  const leafGeo = det ? new ShapeGeometry(leafShape, 5) : new CircleGeometry(1, 6);
  const res: FruitRes = {
    tiers: [],
    stemMat: lambert ? new MeshLambertMaterial({ color: 0x5a3a22 }) : new MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 }),
    leafMat: lambert ? new MeshLambertMaterial({ color: 0x3f7d2c, side: DoubleSide })
      : new MeshStandardMaterial({ color: 0x3f7d2c, roughness: det ? 0.6 : 0.8, side: DoubleSide }),
  };
  const skin = det ? tex("skin", 1) : null;
  for (let tier = 1; tier <= 10; tier++) {
    const r = TIER_R[tier]!, sk = SKIN[tier]!;
    const col = palette[tier]!;
    const bodyGeo = new SphereGeometry(r, b.sphere[0], b.sphere[1]);
    if (det && sk.ribs) {
      // shallow pumpkin ribs (±3% of the radius) — silhouette cue only
      const p = bodyGeo.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        tmpV.fromBufferAttribute(p, i);
        const kk = 1 + 0.03 * Math.cos(Math.atan2(tmpV.z, tmpV.x) * sk.ribs);
        p.setXYZ(i, tmpV.x * kk, tmpV.y, tmpV.z * kk);
      }
      p.needsUpdate = true;
      bodyGeo.computeVertexNormals();
    }
    const relief = b.skinBump && skin ? { bumpMap: skin, bumpScale: sk.bump, roughnessMap: skin } : {};
    const bodyMat = lambert ? new MeshLambertMaterial({ color: col })
      : det && b.material === "physical"
        ? new MeshPhysicalMaterial({
          color: col, roughness: sk.rough, metalness: 0, clearcoat: sk.cc, clearcoatRoughness: 0.25, ...relief,
        })
        : det
          ? new MeshStandardMaterial({ color: col, roughness: sk.rough, metalness: 0, ...relief })
          : new MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.05 });
    res.tiers[tier] = {
      bodyGeo, bodyMat,
      stemGeo: new CylinderGeometry(r * 0.08, r * 0.12, r * 0.5, 6),
      ringGeo: new TorusGeometry(r * 0.7, r * 0.05, 6, 24, PI * 2),
      ringMat: lambert ? new MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 })
        : new MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 }),
      leavesGeo: leafCluster(leafGeo, tier, r, det),
    };
  }
  leafGeo.dispose();
  fruitRes = res;
  return res;
}

/** The tier's leaf ring as one geometry (one draw call per fruit instead of one per leaf; same placement). */
function leafCluster(leafGeo: BufferGeometry, tier: number, r: number, det: boolean): BufferGeometry {
  const ls = Math.max(0.14, r * 0.22);
  const o = new Object3D();
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < tier; i++) {
    const a = (i / tier) * PI * 2;
    if (det) {
      // pointed leaf radiating from the stem, tilted up a little
      o.scale.setScalar(ls * 2.2);
      o.position.set(0, r * 1.0, 0);
      o.rotation.set(-PI / 2, a, 0.35, "YZX");
    } else {
      o.scale.setScalar(ls);
      o.position.set(Math.cos(a) * r * 0.5, r * 1.02, Math.sin(a) * r * 0.5);
      o.rotation.set(-PI / 2 + 0.4, 0, a);
    }
    o.updateMatrix();
    parts.push(leafGeo.clone().applyMatrix4(o.matrix));
  }
  const merged = mergeGeometries(parts) ?? parts[0]!;
  for (const g of parts) if (g !== merged) g.dispose();
  return merged;
}

/** A fruit: coloured sphere + stem + a leaf-count marker per tier (colour-blind cue) + an emissive ring. Geometry
 * and materials are shared per tier; a ghost gets its own translucent copies. */
function makeFruitMesh(tier: number, ghost = false): Group {
  const res = fruitResources(), t = res.tiers[tier]!;
  const own = (m: Material): Material => {
    if (!ghost) return m;
    const c = m.clone();
    c.transparent = true; c.opacity = 0.4; c.depthWrite = false;
    return c;
  };
  const g = new Group();
  g.userData.ghost = ghost;
  const r = TIER_R[tier]!;
  const body = new Mesh(t.bodyGeo, own(t.bodyMat));
  body.castShadow = !ghost; body.receiveShadow = !ghost;
  g.add(body);
  const stem = new Mesh(t.stemGeo, own(res.stemMat));
  stem.position.y = r * 0.95; g.add(stem);
  g.add(new Mesh(t.leavesGeo, own(res.leafMat)));
  const ring = new Mesh(t.ringGeo, own(t.ringMat));
  ring.rotation.x = PI / 2;
  g.add(ring);
  return g;
}
function disposeFruitMesh(m: Group): void {
  // shared geometry/materials belong to the scene; only a ghost owns its material copies
  if (m.userData.ghost) m.traverse((o) => { const mat = (o as Mesh).material as Material | undefined; mat?.dispose(); });
}

// ------------------------------------------------------------------ orchard backdrop
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Distant orchard (instanced trees with fruit), rolling hills. One draw call per part. */
function buildOrchard(q: Look): Group {
  const budget = q.budget;
  const group = new Group();
  const r = rng(97);
  const spots: [number, number, number][] = [];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 16; i++) {
      const x = -150 + i * 20 + (row % 2) * 10 + (r() - 0.5) * 6;
      const z = -45 - row * 26 + (r() - 0.5) * 6;
      if (z > -60 && x > -30 && x < 50) continue; // keep the view behind the stall open
      const k = 0.8 + r() * 0.5;
      // Lower budgets thin the grove evenly (the front row always stays).
      if (row > 0 && budget.trees < 1 && (i + row) % Math.round(1 / budget.trees) !== 0) continue;
      spots.push([x, z, k]);
    }
  }
  const trunkGeo = new CylinderGeometry(0.7, 1.0, 8, 6);
  trunkGeo.translate(0, 4, 0);
  const crownGeo = new IcosahedronGeometry(6, 1);
  crownGeo.translate(0, 12, 0);
  const trunks = new InstancedMesh(trunkGeo, new MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 }), spots.length);
  const crowns = new InstancedMesh(crownGeo, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), spots.length);
  const fruitGeo = new SphereGeometry(0.75, 8, 6);
  const perTree = budget.fruitPerTree;
  const fruits = new InstancedMesh(fruitGeo, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), spots.length * perTree);
  const m = new Matrix4(), qt = new Quaternion(), s = new Vector3(), p = new Vector3();
  const col = new Color();
  const fruitCols = [0xff7a2e, 0xe8432f, 0xffc933, 0xff9a3c];
  const up = new Vector3(0, 1, 0);
  spots.forEach(([x, z, k], i) => {
    s.set(k, k, k); p.set(x, GROUND_Y, z);
    qt.setFromAxisAngle(up, r() * PI * 2);
    m.compose(p, qt, s); trunks.setMatrixAt(i, m);
    s.set(k * (0.95 + r() * 0.15), k * (0.85 + r() * 0.2), k * (0.95 + r() * 0.15));
    m.compose(p, qt, s); crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, col.setHSL(0.26 + r() * 0.06, 0.45 + r() * 0.15, 0.3 + r() * 0.08));
    for (let j = 0; j < perTree; j++) {
      const a = r() * PI * 2, e = (r() - 0.3) * 1.2;
      const fx = x + Math.cos(a) * Math.cos(e) * 6 * k;
      const fz = z + Math.sin(a) * Math.cos(e) * 6 * k;
      const fy = GROUND_Y + (12 + Math.sin(e) * 6) * k;
      m.compose(p.set(fx, fy, fz), qt.identity(), s.set(k, k, k));
      fruits.setMatrixAt(i * perTree + j, m);
      fruits.setColorAt(i * perTree + j, col.setHex(fruitCols[(i + j) % fruitCols.length]!));
    }
  });
  for (const im of [trunks, crowns, fruits]) { im.castShadow = false; im.receiveShadow = false; group.add(im); }
  // Rolling hills far behind the orchard.
  const hillMat = new MeshStandardMaterial({ color: 0x86ad62, roughness: 1 });
  for (const [x, z, rad, h] of [[-160, -260, 150, 0.22], [60, -300, 190, 0.2], [240, -250, 140, 0.25]] as const) {
    const hill = new Mesh(new SphereGeometry(rad, 24, 12, 0, PI * 2, 0, PI / 2), hillMat);
    hill.scale.y = h; hill.position.set(x, GROUND_Y, z);
    group.add(hill);
  }
  return group;
}

// ------------------------------------------------------------------ ambient pollen motes
class Motes {
  readonly points: Points;
  private readonly seed: Float32Array;
  private t = 0;
  constructor(parent: Group, dotTex: Texture, private readonly count: number, private readonly b: number[]) {
    const r = rng(131);
    this.seed = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) this.seed[i] = r();
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
    this.points = new Points(geo, new PointsMaterial({ color: 0xfff1c4, size: 0.32, map: dotTex, transparent: true, opacity: 0.55, depthWrite: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.update(0);
    parent.add(this.points);
  }
  update(dt: number): void {
    this.t += dt;
    const [x0, x1, y0, y1, z0, z1] = this.b as [number, number, number, number, number, number];
    const pos = this.points.geometry.getAttribute("position") as BufferAttribute;
    const sd = this.seed;
    for (let i = 0; i < this.count; i++) {
      const a = sd[i * 4]!, b = sd[i * 4 + 1]!, c = sd[i * 4 + 2]!, d = sd[i * 4 + 3]!;
      const t = this.t * (0.02 + d * 0.03);
      const x = x0 + ((((a + t) % 1) + 1) % 1) * (x1 - x0);
      const y = y0 + (b + Math.sin(this.t * 0.4 + d * 20) * 0.02) * (y1 - y0);
      const z = z0 + (c + Math.cos(this.t * 0.3 + a * 20) * 0.02) * (z1 - z0);
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ merge bursts
/** Pooled juice droplets (tier-coloured) plus a short ring flash that blooms. */
class Bursts {
  private readonly points: Points;
  private readonly data: { vx: number; vy: number; vz: number; life: number }[] = [];
  private readonly rings: Mesh[] = [];
  private readonly ringLife: { life: number; r: number }[] = [];
  private readonly col = new Color();
  private next = 0;
  constructor(parent: Group, dotTex: Texture, private readonly count: number) {
    for (let i = 0; i < count; i++) this.data.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("color", new BufferAttribute(new Float32Array(count * 3), 3));
    this.points = new Points(geo, new PointsMaterial({ size: 0.55, map: dotTex, vertexColors: true, transparent: true, opacity: 0, depthWrite: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    parent.add(this.points);
    const ringGeo = new RingGeometry(0.9, 1, 40);
    for (let i = 0; i < 4; i++) {
      const ring = new Mesh(ringGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
      ring.visible = false; ring.renderOrder = 3;
      parent.add(ring);
      this.rings.push(ring);
      this.ringLife.push({ life: 0, r: 1 });
    }
  }
  fire(x: number, y: number, tier: number, radius: number, hex: string): void {
    const pos = this.points.geometry.getAttribute("position") as BufferAttribute;
    const colA = this.points.geometry.getAttribute("color") as BufferAttribute;
    // The old CanvasTexture-era colours: three's Color.set(hex) gives linear values (sRGB decoded).
    const c = this.col.set(hex);
    const n = Math.min(8 + tier * 2, this.count);
    let used = 0;
    for (let i = 0; i < this.count && used < n; i++) {
      const d = this.data[i]!;
      if (d.life > 0) continue;
      const a = Math.random() * PI * 2, sp = 4 + Math.random() * 6;
      d.vx = Math.cos(a) * sp; d.vy = Math.random() * 8 + 2; d.vz = Math.sin(a) * sp * 0.4;
      d.life = 0.8;
      pos.setXYZ(i, x, y, 0);
      const k = 0.85 + Math.random() * 0.3;
      colA.setXYZ(i, Math.min(1, c.r * k + 0.1), Math.min(1, c.g * k + 0.1), Math.min(1, c.b * k + 0.1));
      used++;
    }
    pos.needsUpdate = true; colA.needsUpdate = true;
    (this.points.material as PointsMaterial).opacity = 0.95;
    const idx = this.next++ % this.rings.length;
    const ring = this.rings[idx]!;
    ring.visible = true;
    ring.position.set(x, y, 0.2);
    this.ringLife[idx] = { life: 0.35, r: radius };
    // Above 1.0 so it passes the bloom threshold; tone mapping keeps it tasteful.
    (ring.material as MeshBasicMaterial).color.copy(c).multiplyScalar(2.2).addScalar(0.15);
  }
  update(dt: number): void {
    const pos = this.points.geometry.getAttribute("position") as BufferAttribute;
    let any = false;
    for (let i = 0; i < this.count; i++) {
      const d = this.data[i]!;
      if (d.life <= 0) continue;
      d.life -= dt; any = true;
      d.vy -= 20 * dt;
      pos.setXYZ(i, pos.getX(i) + d.vx * dt, pos.getY(i) + d.vy * dt, pos.getZ(i) + d.vz * dt);
    }
    if (any) pos.needsUpdate = true;
    const pm = this.points.material as PointsMaterial;
    pm.opacity = Math.max(0, pm.opacity - dt * 1.2);
    this.rings.forEach((ring, i) => {
      if (!ring.visible) return;
      const u = this.ringLife[i]!;
      u.life -= dt;
      if (u.life <= 0) { ring.visible = false; return; }
      const k = 1 - u.life / 0.35;
      ring.scale.setScalar(u.r * (1 + k * 1.2));
      (ring.material as MeshBasicMaterial).opacity = (1 - k) * 0.9;
    });
  }
}

// ------------------------------------------------------------------ the graphics level and palette
let sceneKey = "";
/** The graphics level's look (quality.ts) with the palette's tier colours; rebuilds the scene when either changed. */
export function applyLook(next: Look, colors: (string | null)[]): void {
  const key = JSON.stringify([next, colors]);
  if (key === sceneKey) return;
  sceneKey = key;
  look = next;
  palette = colors;
  const b = next.budget;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.7, radius: 1.2, distanceExponent: 1.4, thickness: 1.5, scale: 1.0, samples: next.ao === "high" ? 16 : 8, resolution: b.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only emissive accents (warning line, merge flashes) and hot highlights.
  renderer.bloom = next.bloom ? { strength: 0.35, radius: 0.35, threshold: 0.92, resolution: b.bloomRes } : null;
  // render-gfx.js GradeShader (linear light before the output): a gentle S-curve, a touch more saturation, warm
  // highlights / cool shadows, the 0.2 vignette.
  renderer.grade = next.grade ? {
    space: "linear", contrast: 0.18, saturation: 1.1, shadows: [0.97, 0.99, 1.04], highlights: [1.04, 1.01, 0.95], split: [0.2, 0.8],
    vignette: { amount: 0.2, inner: 0.4, outer: 0.9 },
  } : null;
  renderer.antialias = next.antialias;
  buildScene();
}

// ------------------------------------------------------------------ per frame
let aspectFit = -1;
/** The drop preview's x and whether it shows (the run is live and a drop is allowed). */
export interface View { state: State | null; aimX: number; preview: boolean; hot: boolean }

/** syncMeshes: the fruit (with the pop-in), the drop preview, the warning line's glow and the hint's bob. */
function sync(v: View): void {
  const s = v.state;
  const t = frame().time;
  if (!s) {
    for (const [, m] of fruitMeshes) m.visible = false;
    if (ghostFruit) ghostFruit.visible = false;
    if (guideLine) guideLine.visible = false;
    return;
  }
  // a new/restored/undone state or a rebuilt scene syncs without pop-in
  if (s !== lastStateRef) { lastStateRef = s; freshSync = true; }
  const pop = motionOK() && !freshSync;
  const seen = new Set<number>();
  for (const f of s.fruits) {
    seen.add(f.id);
    let m = fruitMeshes.get(f.id);
    if (!m) {
      m = makeFruitMesh(f.tier); fruitMeshes.set(f.id, m); world!.add(m);
      m.userData.born = pop ? t : 0;
    }
    m.visible = true;
    m.position.set(f.x, f.y, 0);
    m.rotation.z = -f.x * 0.05;
    const born = m.userData.born as number;
    if (born) {
      // short ease-out-back pop for fruit that just appeared (cosmetic; physics is unchanged)
      const k = Math.min(1, (t - born) / 0.18);
      const c = 1.70158, e = 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
      m.scale.setScalar(0.6 + 0.4 * e);
      if (k >= 1) { m.userData.born = 0; m.scale.setScalar(1); }
    }
  }
  freshSync = false;
  for (const [id, m] of fruitMeshes) {
    if (!seen.has(id)) { world!.remove(m); disposeFruitMesh(m); fruitMeshes.delete(id); }
  }
  // ghost preview: the fruit that will actually drop (colour, leaves, size)
  if (v.preview) {
    const tier = s.currentTier;
    if (tier !== ghostTier || !ghostFruit) {
      if (ghostFruit) { world!.remove(ghostFruit); disposeFruitMesh(ghostFruit); }
      ghostFruit = makeFruitMesh(tier, true);
      ghostTier = tier;
      world!.add(ghostFruit);
    }
    ghostFruit.visible = guideLine!.visible = true;
    ghostFruit.position.set(v.aimX, WORLD_H - TIER_R[tier]! - 0.5, 0);
    guideLine!.position.set(v.aimX, WORLD_H - 4, 0);
  } else {
    if (ghostFruit) ghostFruit.visible = false;
    guideLine!.visible = false;
  }
  // warning line glow (above 1.0 when hot, so bloom picks it up)
  const mat = warnLine!.material as MeshBasicMaterial;
  mat.opacity = v.hot ? 0.5 + 0.4 * Math.sin(t * 1000 / 120) : 0.35;
  mat.color.setHex(v.hot ? 0xff2211 : 0xff5544);
  if (v.hot) mat.color.multiplyScalar(2.2);
}

/** Each frame: the camera fitted to the window, the effects advanced, the meshes synced, the shake decayed. */
export function update(dtIn: number, v: View): void {
  if (!world) return;
  const f = frame();
  const dt = Math.min(0.1, Math.max(0, dtIn));
  if (f.width > 0 && f.height > 0) {
    const aspect = Math.max(1, f.width) / Math.max(1, f.height);
    if (aspect !== aspectFit) {
      aspectFit = aspect;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      fitCamera();
      // keep the painted sky's clouds round at any aspect
      if (sky) sky.repeat.set(aspect / 2, 1);
    }
  }
  bursts?.update(dt);
  if (motionOK()) {
    motes?.update(dt);
    if (look?.animated && sky) sky.offset.x += dt * 0.004;
  }
  if (motes) motes.points.visible = motionOK();
  sync(v);
  if (hintMarker!.visible) {
    if (f.time >= hintUntil) hintMarker!.visible = false;
    else if (motionOK()) hintMarker!.position.y = WORLD_H + 0.8 + Math.sin(f.time * 1000 / 200) * 0.25;
  }
  if (shakeAmp > 0.001) {
    camera.position.set(camBase.x + (Math.random() - 0.5) * shakeAmp, camBase.y + (Math.random() - 0.5) * shakeAmp, camBase.z);
    camera.lookAt(CAM_TARGET);
    shakeAmp *= 0.85;
  } else if (shakeAmp) {
    shakeAmp = 0;
    camera.position.copy(camBase);
    camera.lookAt(CAM_TARGET);
  }
}

/** A merge: the burst (with motion) and a little camera shake. */
export function merged(x: number, y: number, tier: number): void {
  if (!motionOK()) return;
  shakeAmp = Math.min(0.5, 0.1 + tier * 0.03);
  bursts?.fire(x, y, tier, TIER_R[tier]!, palette[tier] ?? "#ffffff");
}
/** showHint: the marker over the hinted column for 2.5 s. */
export function showHint(x: number): void {
  if (!hintMarker) return;
  hintMarker.position.set(x, WORLD_H + 0.8, 0);
  hintMarker.visible = true;
  hintUntil = frame().time + 2.5;
}
export function clearHint(): void { if (hintMarker) hintMarker.visible = false; }

/** aimFromClientX: the fruit plane's x (z = 0) under a window point, or null before the camera is fitted. */
export function aimAt(wx: number, wy: number): number | null {
  const f = frame();
  if (f.width <= 0 || f.height <= 0) return null;
  const nx = (wx / f.width) * 2 - 1;
  const ny = -((wy / f.height) * 2 - 1);
  camera.updateMatrixWorld();
  tmpV.set(nx, ny, 0.5).unproject(camera);
  const dir = tmpV.sub(camera.position).normalize();
  if (Math.abs(dir.z) > 1e-4) {
    const t = (0 - camera.position.z) / dir.z;
    return camera.position.x + dir.x * t;
  }
  return camera.position.x;
}
/** The window point of a world position (for tests and the a11y crate target). */
export function project(x: number, y: number): { x: number; y: number } {
  const f = frame();
  camera.updateMatrixWorld();
  tmpV.set(x, y, 0).project(camera);
  return { x: (tmpV.x + 1) / 2 * f.width, y: (1 - tmpV.y) / 2 * f.height };
}
