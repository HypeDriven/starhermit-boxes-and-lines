// The lamplit graph-paper desk on starhermit:scene, ported from the browser
// build's three.js renderer (js/render.js before the port): the procedural
// wood desk and gridded paper sheet, the lacquered ink pins at the dots, the
// drawn edges in their player's colour (pre-inked ones grey and lower), the
// paper boxes that fold up out of the sheet on a claim (four flaps hinged on
// the cell edges, 0.55 s, the player's stamp popping in over the last 65 %),
// the hover / focus preview ghost and rings, the round seat tokens that
// brighten for the player to move, pencil bursts, the game-over camera rise
// and confetti, drifting dust motes, the idle camera drift, the small
// half-played menu sheet, and the look per graphics level (quality.ts).
// Board geometry: dot spacing 1, centred on the origin; dot (r, c) at
// (x = c − cols/2, z = r − rows/2); h-edge (r, c) joins (r, c)–(r, c+1),
// v-edge (r, c) joins (r, c)–(r+1, c). It reads rules snapshots and never
// mutates rules state.
//
// What changed from three.js, and why:
// - The EffectComposer chain (GTAO, UnrealBloom, the grade ShaderPass,
//   OutputPass, SMAA / FXAA / MSAA) is renderer.ao / bloom / grade /
//   antialias; the grade's GLSL is the built-in grade with the same curve,
//   tints and vignette.
// - ShapeGeometry (the triangle and diamond stamps) is CircleGeometry with
//   three and four segments.
// - Picking: the engine's raycaster hits only visible meshes, so the
//   invisible hit strips are a ray cast onto the sheet's plane, mapped to
//   the nearest edge within the strips' 0.32 width.
// - The camera frames the sheet inside the playfield rectangle the HUD and
//   the button board leave, with setViewOffset (the browser build's canvas
//   sat between them).
// - Light intensities, shadow values (the box fitted to the sheet) and the
//   PMREM RoomEnvironment(renderer) are three.js r160's as the page had them
//   (engine minor 28). Standard materials get the room as their own envMap
//   so their envMapIntensity applies as r160 did with scene.environment.
//   Canvas textures are starhermit:canvas CanvasTextures.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color,
  CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, OrthographicCamera, PCFSoftShadowMap, PMREMGenerator,
  PerspectiveCamera, PlaneGeometry, Points, PointsMaterial, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment,
  SRGBColorSpace, Vector3, pointerToNdc, renderer, scene,
} from "starhermit:scene";
import type { Material, Object3D, Texture } from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import type { Dir, Edge, GameEvent, Palette, State } from "./classic.ts";
import { MAX_DUST, MAX_PARTICLES, type Budget, type Look } from "./quality.ts";

const PI = Math.PI;
const FOV = 40;
const CAM_DRIFT_AMP = 0.12, CAM_DRIFT_PERIOD = 14, RESET_EASE = 0.8;
const FOLD_TIME = 0.55;
const PAPER_THICK = 0.012, EDGE_W = 0.055, EDGE_H = 0.03, HIT_W = 0.32, HOLE_DEPTH = 0.02;
const MAX_BURSTS = 48;
const KEY_DIR = new Vector3(-4, 7, 3).normalize();
const PREVIEW_COLORS: Record<string, number> = { ok: 0x6fd98a, risky: 0xe8a13f, claim: 0xffffff };
const ENV_INTENSITY: Record<string, number> = { dot: 0.35, neutral: 0.3, hole: 0.15, player: 0.3, box: 0.25, stamp: 0.25, desk: 0.3, paper: 0.28, wall: 0.15 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const hex = (n: number): string => "#" + (n >>> 0).toString(16).padStart(6, "0");

// ---------------------------------------------------------------- state
let palette: Palette = { desk: 0x6e4a2e, deskDark: 0x503523, paper: 0xf2ead8, grid: 0x9db4c8, dot: 0x4a4038, wall: 0x3a2e26, light: 0xffd9a8, fog: 0x2a211b };
let playerColors = [0x3f8efc, 0xef5d4e, 0xe8b23f, 0x5fbf77];
let reducedMotion = false;
let look: Look | null = null;
let BUD: Budget = { material: "standard", texture: 512, paperCell: 48, dotSegments: 12, bloomRes: 0.5, particles: 90, dust: 24 };
let built = false;
const rand = mulberry32(0xb0e5 ^ 0x51eed);

const camera = new PerspectiveCamera(FOV, 16 / 9, 0.1, 80);
const hemi = new HemisphereLight(0xfff2e0, 0x30241a, 0.55);
const key = new DirectionalLight(0xffd9a8, 2.2);
key.position.copy(KEY_DIR).multiplyScalar(12);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.015;
key.shadow.radius = 2;

const envGroup = new Group();
const boardGroup = new Group();
const edgeGroup = new Group();
const cellGroup = new Group();
const overlayGroup = new Group();
const fxGroup = new Group();
boardGroup.add(edgeGroup, cellGroup);

function setup(): void {
  built = true;
  scene.add(hemi, key, key.target, envGroup, boardGroup, overlayGroup, fxGroup);
  scene.background = new Color(0x241b12);
  renderer.camera = camera;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

// ---------------------------------------------------------------- textures
function canvas(size: number): { c: OffscreenCanvas; g: OffscreenCanvasRenderingContext2D } {
  const c = new OffscreenCanvas(size, size);
  return { c, g: c.getContext("2d") };
}

function deskTexture(size: number): Texture {
  const { c, g } = canvas(size);
  g.scale(size / 512, size / 512);
  const base = new Color(palette.desk), dark = new Color(palette.deskDark);
  const planks = 6, pw = 512 / planks;
  for (let i = 0; i < planks; i++) {
    const t = rand() * 0.5;
    g.fillStyle = hex(base.clone().lerp(dark, 0.25 + t * 0.5).getHex());
    g.fillRect(i * pw, 0, pw, 512);
    g.strokeStyle = "rgba(0,0,0,0.08)";
    g.lineWidth = 1;
    for (let s = 0; s < 14; s++) {
      const y = rand() * 512;
      g.beginPath();
      g.moveTo(i * pw, y);
      g.bezierCurveTo(i * pw + pw * 0.3, y + rand() * 6 - 3, i * pw + pw * 0.7, y + rand() * 6 - 3, i * pw + pw, y + rand() * 4 - 2);
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(i * pw, 0, 1.5, 512);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}
/** The desk's relief (bump + roughness map at "detailed"): fine grain along the planks, sunken seams. */
function deskRelief(size: number): Texture {
  const r2 = mulberry32(0xde5c);
  const { c, g } = canvas(size);
  g.scale(size / 256, size / 256);
  g.fillStyle = "#9a9a9a";
  g.fillRect(0, 0, 256, 256);
  const planks = 6, pw = 256 / planks;
  for (let i = 0; i < planks; i++) {
    for (let s = 0; s < 40; s++) {
      const y = r2() * 256, v = 110 + Math.floor(r2() * 90);
      g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
      g.lineWidth = 0.6 + r2() * 1.2;
      g.beginPath();
      g.moveTo(i * pw, y);
      g.bezierCurveTo(i * pw + pw * 0.3, y + r2() * 4 - 2, i * pw + pw * 0.7, y + r2() * 4 - 2, i * pw + pw, y + r2() * 3 - 1.5);
      g.stroke();
    }
    g.fillStyle = "#5a5a5a";
    g.fillRect(i * pw - 0.5, 0, 2.5, 256);
  }
  const rough = new CanvasTexture(c);
  rough.colorSpace = NoColorSpace;
  rough.wrapS = rough.wrapT = RepeatWrapping;
  return rough;
}
const fibre = new Map<number, Texture>();
/** Tileable paper-fibre noise, the bump map of the sheet (repeat 3) and the folded boxes (repeat 1). */
function fibreTexture(repeat: number): Texture {
  const hit = fibre.get(repeat);
  if (hit) return hit;
  const r2 = mulberry32(0xf1be), n = 128;
  const { c, g } = canvas(n);
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 118 + Math.floor(r2() * 40);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let f = 0; f < 90; f++) {
    const x = r2() * n, y = r2() * n, a = r2() * PI, l = 3 + r2() * 8;
    g.strokeStyle = r2() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)";
    g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = NoColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  fibre.set(repeat, tex);
  return tex;
}
let moteTex: Texture | null = null;
function moteTexture(): Texture {
  if (moteTex) return moteTex;
  const { c, g } = canvas(32);
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.4, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  moteTex = new CanvasTexture(c);
  return moteTex;
}
function paperTexture(rows: number, cols: number, cell: number): Texture {
  const pad = cell / 2;
  const c = new OffscreenCanvas(cols * cell + pad * 2, rows * cell + pad * 2);
  const g = c.getContext("2d");
  g.fillStyle = hex(palette.paper);
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = hex(palette.grid);
  g.globalAlpha = 0.55;
  g.lineWidth = Math.max(1, cell / 64);
  for (let r = 0; r <= rows; r++) { const y = pad + r * cell; g.beginPath(); g.moveTo(pad, y); g.lineTo(pad + cols * cell, y); g.stroke(); }
  for (let k = 0; k <= cols; k++) { const x = pad + k * cell; g.beginPath(); g.moveTo(x, pad); g.lineTo(x, pad + rows * cell); g.stroke(); }
  g.globalAlpha = 0.35;
  g.lineWidth = 2;
  g.strokeRect(1, 1, c.width - 2, c.height - 2);
  g.globalAlpha = 1;
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- materials
interface MatParams { color?: number | Color; map?: Texture | null; roughness?: number; metalness?: number; clearcoat?: number; clearcoatRoughness?: number; side?: typeof DoubleSide }
/** The material class per preset budget: Lambert on Low, Standard on Balanced, Physical (clearcoat) above. */
function litMat(p: MatParams, physical = false): Material {
  if (BUD.material === "lambert") return new MeshLambertMaterial({ color: p.color ?? 0xffffff, map: p.map ?? null, ...(p.side ? { side: p.side } : {}) });
  const base = { color: p.color ?? 0xffffff, map: p.map ?? null, roughness: p.roughness ?? 1, metalness: p.metalness ?? 0, ...(p.side ? { side: p.side } : {}) };
  if (BUD.material === "physical" && physical) return new MeshPhysicalMaterial({ ...base, clearcoat: p.clearcoat ?? 0, clearcoatRoughness: p.clearcoatRoughness ?? 0.2 });
  return new MeshStandardMaterial(base);
}
interface Mats { dot: Material; neutral: Material; hole: Material; player: Material[]; box: Material[]; stamp: Material[]; turn: MeshBasicMaterial[] }
let mats: Mats | null = null;
function disposeMats(): void {
  if (!mats) return;
  for (const m of [mats.dot, mats.neutral, mats.hole, ...mats.player, ...mats.box, ...mats.stamp, ...mats.turn]) m.dispose();
}
function buildMaterials(): void {
  disposeMats();
  const detailed = !!look?.detailed;
  mats = {
    dot: litMat({ color: palette.dot, roughness: 0.45, metalness: 0.1, clearcoat: detailed ? 0.7 : 0, clearcoatRoughness: 0.2 }, true),
    neutral: litMat({ color: 0x8a8a88, roughness: 0.85 }),
    hole: litMat({ color: new Color(palette.wall).multiplyScalar(0.4), roughness: 1 }),
    player: playerColors.map((c) => litMat({ color: c, roughness: 0.42, clearcoat: detailed ? 0.6 : 0, clearcoatRoughness: 0.18 }, true)),
    box: playerColors.map((c) => litMat({ color: c, roughness: 0.72 })),
    stamp: playerColors.map((c) => litMat({ color: new Color(c).multiplyScalar(0.55), roughness: 0.7, side: DoubleSide })),
    turn: playerColors.map((c) => new MeshBasicMaterial({ color: new Color(c).multiplyScalar(look?.bloom ? 1.35 : 1), transparent: true, opacity: 0 })),
  };
  if (detailed && BUD.material !== "lambert") {
    for (const m of mats.box) { (m as MeshStandardMaterial).bumpMap = fibreTexture(1); (m as MeshStandardMaterial).bumpScale = 0.6; }
  }
  for (const k of ["dot", "neutral", "hole"] as const) setEnv(mats[k], ENV_INTENSITY[k]!);
  for (const k of ["player", "box", "stamp"] as const) for (const m of mats[k]) setEnv(m, ENV_INTENSITY[k]!);
}
function setEnv(m: Material, k: number): void {
  if (m instanceof MeshStandardMaterial) { m.envMapIntensity = k; m.envMap = look?.reflections ? envTex : null; }
}

// ---------------------------------------------------------------- environment
function clearGroup(gr: Group): void {
  while (gr.children.length) {
    const ch = gr.children[gr.children.length - 1]!;
    gr.remove(ch);
    ch.traverse((o: Object3D) => {
      if (o.userData.ownGeo && o instanceof Mesh) o.geometry.dispose();
      if (o.userData.ownMat && o instanceof Mesh) o.material.dispose();
    });
  }
}
const envTextures: Texture[] = [];
/** Shadow frustum fitted to the sheet (plus the seat tokens), as the browser build's. */
function fitShadow(): void {
  const hx = Math.max(boardCols, 2) / 2 + 1.2, hz = Math.max(boardRows, 2) / 2 + 1.2;
  const ext = Math.sqrt(hx * hx + hz * hz) * 0.92;
  const sc = key.shadow.camera as OrthographicCamera;
  key.position.copy(KEY_DIR).multiplyScalar(12);
  key.target.position.set(0, 0, 0);
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
  sc.near = 4; sc.far = 20;
  sc.updateProjectionMatrix();
}
function buildEnv(rows: number, cols: number): void {
  clearGroup(envGroup);
  for (const t of envTextures.splice(0)) t.dispose();
  const detailed = !!look?.detailed;
  const w = Math.max(60, cols + 40), d = Math.max(40, rows + 30); // wide playfields see far to the sides
  const deskTex = deskTexture(BUD.texture);
  deskTex.repeat.set(w / 7, d / 6);
  envTextures.push(deskTex);
  const deskMat = litMat({ map: deskTex, roughness: detailed ? 0.9 : 0.8 });
  if (detailed && deskMat instanceof MeshStandardMaterial) {
    const rel = deskRelief(BUD.texture / 2);
    rel.repeat.set(w / 7, d / 6);
    envTextures.push(rel);
    deskMat.roughnessMap = rel;
    deskMat.bumpMap = rel;
    deskMat.bumpScale = 2.0;
  }
  setEnv(deskMat, ENV_INTENSITY.desk!);
  const desk = new Mesh(new PlaneGeometry(w, d), deskMat);
  desk.userData.ownGeo = desk.userData.ownMat = true;
  desk.rotation.x = -PI / 2;
  desk.position.y = -0.14;
  desk.receiveShadow = true;
  envGroup.add(desk);
  const paperTex = paperTexture(rows, cols, BUD.paperCell);
  envTextures.push(paperTex);
  const paperMat = litMat({ map: paperTex, roughness: 0.95 });
  if (detailed && paperMat instanceof MeshStandardMaterial) {
    paperMat.bumpMap = fibreTexture(3);
    paperMat.bumpScale = 0.6;
  }
  setEnv(paperMat, ENV_INTENSITY.paper!);
  const paper = new Mesh(new BoxGeometry(cols + 1.2, PAPER_THICK, rows + 1.2), paperMat);
  paper.userData.ownGeo = paper.userData.ownMat = true;
  paper.position.y = -PAPER_THICK / 2;
  paper.receiveShadow = true;
  envGroup.add(paper);
  const wallMat = litMat({ color: palette.wall, roughness: 1 });
  setEnv(wallMat, ENV_INTENSITY.wall!);
  const wall = new Mesh(new PlaneGeometry(60, 30), wallMat);
  wall.userData.ownGeo = wall.userData.ownMat = true;
  wall.position.set(0, 8, -Math.max(8, rows * 0.9 + 6));
  wall.receiveShadow = true;
  envGroup.add(wall);
  scene.fog = new Fog(palette.fog, 14, 34);
  scene.background = new Color(palette.fog);
  key.color.set(palette.light);
}

// ---------------------------------------------------------------- board
let boardRows = 0, boardCols = 0;
interface EdgeView { mesh: Mesh; value: number | null }
interface Flap { hinge: Group; axis: "x" | "z"; dir: number }
interface Fold { group: Group; flaps: Flap[]; stamp: Mesh; paper: Mesh[]; anim: { t: number; dur: number } | null; owner: number }
interface CellView { fold: Fold | null; value: number; hole: boolean; holeMesh: Mesh | null }
let heViews: EdgeView[][] = [], veViews: EdgeView[][] = [], cellViews: CellView[][] = [];
let dots: InstancedMesh | null = null;
const hEdgeGeo = new BoxGeometry(0.86, EDGE_H, EDGE_W);
const vEdgeGeo = new BoxGeometry(EDGE_W, EDGE_H, 0.86);
let dotGeo = new CylinderGeometry(0.055, 0.065, 0.09, 12);
let dotSegs = 12;
const flapGeo = new BoxGeometry(1.0, PAPER_THICK, 0.5);
const floorGeo = new BoxGeometry(1.0, PAPER_THICK, 1.0);
const S = 0.16;
const stampGeos = [
  new CircleGeometry(S, 24),
  new CircleGeometry(S * 1.15, 3, PI / 2), // triangle (ShapeGeometry in three)
  new PlaneGeometry(S * 1.6, S * 1.6),
  new CircleGeometry(S * 1.25, 4), // diamond
];
const dotX = (c: number): number => c - boardCols / 2;
const dotZ = (r: number): number => r - boardRows / 2;
function edgePos(dir: Dir, r: number, c: number, out: Vector3): Vector3 {
  return dir === "h" ? out.set(dotX(c) + 0.5, 0, dotZ(r)) : out.set(dotX(c), 0, dotZ(r) + 0.5);
}

function makeFold(r: number, c: number, owner: number): Fold {
  const g = new Group();
  g.position.set(dotX(c) + 0.5, 0.004, dotZ(r) + 0.5);
  const mat = mats!.box[owner % mats!.box.length]!;
  const floor = new Mesh(floorGeo, mat);
  floor.castShadow = floor.receiveShadow = true;
  g.add(floor);
  const flaps: Flap[] = [];
  const defs: { hx: number; hz: number; axis: "x" | "z"; dir: number; off: [number, number] }[] = [
    { hx: 0.5, hz: 0, axis: "z", dir: 1, off: [0.25, 0] },
    { hx: -0.5, hz: 0, axis: "z", dir: -1, off: [-0.25, 0] },
    { hx: 0, hz: 0.5, axis: "x", dir: -1, off: [0, 0.25] },
    { hx: 0, hz: -0.5, axis: "x", dir: 1, off: [0, -0.25] },
  ];
  const paper: Mesh[] = [floor];
  for (const d of defs) {
    const hinge = new Group();
    hinge.position.set(d.hx, PAPER_THICK / 2, d.hz);
    const flap = new Mesh(flapGeo, mat);
    if (d.axis === "z") { flap.rotation.y = PI / 2; flap.position.set(d.off[0], 0, 0); }
    else flap.position.set(0, 0, d.off[1]);
    flap.castShadow = true;
    hinge.add(flap);
    g.add(hinge);
    paper.push(flap);
    flaps.push({ hinge, axis: d.axis, dir: d.dir });
  }
  const stamp = new Mesh(stampGeos[owner % 4]!, mats!.stamp[owner % 4]!);
  stamp.rotation.x = -PI / 2;
  stamp.position.y = PAPER_THICK + 0.002;
  stamp.scale.setScalar(0.001);
  g.add(stamp);
  return { group: g, flaps, stamp, paper, anim: null, owner };
}
/** t 0..1: the flaps rotate up, the stamp scales in. */
function setFoldPose(f: Fold, t: number): void {
  const a = easeOutCubic(clamp01(t)) * (PI / 2);
  for (const fl of f.flaps) {
    if (fl.axis === "z") fl.hinge.rotation.z = fl.dir * a;
    else fl.hinge.rotation.x = fl.dir * a;
  }
  f.stamp.scale.setScalar(Math.max(0.001, easeOutCubic(clamp01((t - 0.35) / 0.65))));
}

/** A new sheet: every board mesh is rebuilt. */
export function setBoard(rows: number, cols: number, holes: Record<string, boolean>): void {
  if (!built) setup();
  if (!mats) buildMaterials();
  clearGroup(edgeGroup);
  clearGroup(cellGroup);
  clearFx();
  boardRows = rows; boardCols = cols;
  buildEnv(rows, cols);
  fitShadow();
  heViews = []; veViews = []; cellViews = [];
  if (dotSegs !== BUD.dotSegments) { dotGeo.dispose(); dotGeo = new CylinderGeometry(0.055, 0.065, 0.09, BUD.dotSegments); dotSegs = BUD.dotSegments; }
  dots = new InstancedMesh(dotGeo, mats!.dot, (rows + 1) * (cols + 1));
  dots.castShadow = true;
  const m = new Matrix4();
  let di = 0;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { m.makeTranslation(dotX(c), 0.045, dotZ(r)); dots.setMatrixAt(di++, m); }
  dots.instanceMatrix.needsUpdate = true;
  edgeGroup.add(dots);
  const edge = (geo: BoxGeometry, x: number, z: number): EdgeView => {
    const mesh = new Mesh(geo, mats!.neutral);
    mesh.position.set(x, EDGE_H / 2, z);
    mesh.castShadow = true;
    mesh.visible = false;
    edgeGroup.add(mesh);
    return { mesh, value: 0 };
  };
  for (let r = 0; r <= rows; r++) { heViews.push([]); for (let c = 0; c < cols; c++) heViews[r]!.push(edge(hEdgeGeo, dotX(c) + 0.5, dotZ(r))); }
  for (let r = 0; r < rows; r++) { veViews.push([]); for (let c = 0; c <= cols; c++) veViews[r]!.push(edge(vEdgeGeo, dotX(c), dotZ(r) + 0.5)); }
  for (let r = 0; r < rows; r++) {
    cellViews.push([]);
    for (let c = 0; c < cols; c++) {
      const v: CellView = { fold: null, value: -1, hole: !!holes[r + "," + c], holeMesh: null };
      if (v.hole) {
        const hm = new Mesh(new BoxGeometry(0.98, HOLE_DEPTH, 0.98), mats!.hole);
        hm.userData.ownGeo = true;
        hm.position.set(dotX(c) + 0.5, -HOLE_DEPTH / 2 - PAPER_THICK, dotZ(r) + 0.5);
        cellGroup.add(hm);
        v.holeMesh = hm;
      }
      cellViews[r]!.push(v);
    }
  }
  buildTurnTokens();
  fitCamera();
  placeDust();
}

function applyEdge(v: EdgeView, value: number): void {
  if (v.value === value) return;
  v.value = value;
  if (value === 0) v.mesh.visible = false;
  else if (value === -1) { v.mesh.visible = true; v.mesh.material = mats!.neutral; v.mesh.scale.y = 0.6; }
  else { v.mesh.visible = true; v.mesh.material = mats!.player[(value - 1) % mats!.player.length]!; v.mesh.scale.y = 1; }
}
function applyCell(v: CellView, r: number, c: number, value: number): void {
  if (v.value === value) return;
  v.value = value;
  if (v.fold && value < 0) { cellGroup.remove(v.fold.group); v.fold = null; } // undo
  if (value >= 0 && !v.fold) {
    const f = makeFold(r, c, value);
    cellGroup.add(f.group);
    v.fold = f;
    setFoldPose(f, 1); // a full sync settles at once; a claim's event animates it
  }
}
let lastState: State | null = null;
export function syncState(st: State): void {
  if (!built) setup();
  lastState = st;
  if (st.rows !== boardRows || st.cols !== boardCols || !heViews.length) setBoard(st.rows, st.cols, st.holes);
  for (let r = 0; r <= st.rows; r++) for (let c = 0; c < st.cols; c++) applyEdge(heViews[r]![c]!, st.he[r]![c]!);
  for (let r = 0; r < st.rows; r++) for (let c = 0; c <= st.cols; c++) applyEdge(veViews[r]![c]!, st.ve[r]![c]!);
  for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) applyCell(cellViews[r]![c]!, r, c, st.cells[r]![c]!);
  setTurn(st.current);
}

// ---------------------------------------------------------------- event animation queue
const queue: GameEvent[] = [];
let active: { ev: GameEvent; t: number; dur: number } | null = null;
const EV_TIME: Record<string, number> = { draw: 0.28, box: FOLD_TIME + 0.15, pass: 0.12, "extra-turn": 0.12, over: 1.4, resign: 1.0, timeout: 1.0 };
export function animateEvents(events: readonly GameEvent[] | undefined): void {
  if (!events) return;
  for (const e of events) {
    queue.push(e);
    // The fold starts from flat: syncState settled it at once.
    if (e.type === "box") { const f = cellViews[e.r!]?.[e.c!]?.fold; if (f) setFoldPose(f, 0); }
  }
}
export function skipAnimations(): void {
  queue.length = 0;
  active = null;
  for (const row of cellViews) for (const v of row) if (v.fold) { setFoldPose(v.fold, 1); v.fold.anim = null; }
  clearFx();
  if (camAnim) { applyPose(camAnim.toPos, camAnim.toTgt); camAnim = null; }
  driftT = 0;
}
const tmpV = new Vector3();
function startEvent(ev: GameEvent): void {
  if (ev.type === "draw") {
    edgePos(ev.dir!, ev.r!, ev.c!, tmpV);
    spawnBurst(tmpV.x, 0.06, tmpV.z, palette.dot, 6, 0.5);
  } else if (ev.type === "box") {
    const f = cellViews[ev.r!]?.[ev.c!]?.fold;
    if (f) f.anim = { t: 0, dur: reducedMotion ? 0.15 : FOLD_TIME };
    spawnBurst(dotX(ev.c!) + 0.5, 0.2, dotZ(ev.r!) + 0.5, playerColors[(ev.player ?? 0) % playerColors.length]!, 14, 1.2);
  } else if (ev.type === "over" || ev.type === "resign" || ev.type === "timeout") {
    if (!reducedMotion) { startCamRise(); spawnConfetti(ev.winner != null && ev.winner >= 0 ? ev.winner : 0); }
  }
}
function finishEvent(ev: GameEvent): void {
  if (ev.type === "box") { const f = cellViews[ev.r!]?.[ev.c!]?.fold; if (f) { setFoldPose(f, 1); f.anim = null; } }
}
function stepEvents(dt: number): void {
  if (!active && queue.length) {
    const ev = queue.shift()!;
    let dur = EV_TIME[ev.type] ?? 0.2;
    if (reducedMotion && dur > 0.3) dur = 0.3;
    active = { ev, t: 0, dur };
    startEvent(ev);
  }
  if (active) {
    active.t += dt;
    if (active.t >= active.dur) { finishEvent(active.ev); active = null; }
  }
  for (const row of cellViews) for (const v of row) {
    const f = v.fold;
    if (f && f.anim) {
      f.anim.t += dt;
      const t = f.anim.t / f.anim.dur;
      if (t >= 1) { setFoldPose(f, 1); f.anim = null; } else setFoldPose(f, t);
    }
  }
}

// ---------------------------------------------------------------- FX: bursts, confetti, dust
interface Burst { pts: Points; pos: Float32Array; vel: Float32Array; life: number; dur: number; n: number }
const burstPool: Burst[] = [];
const bursts: Burst[] = [];
const fxBudget = (): number => Math.min(look?.particles === "high" ? 300 : 80, BUD.particles);
function makeBurst(): Burst {
  const n = 14;
  const pos = new Float32Array(n * 3);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  const pts = new Points(geo, new PointsMaterial({ size: 0.05, transparent: true, opacity: 1 }));
  pts.visible = false;
  fxGroup.add(pts);
  return { pts, pos, vel: new Float32Array(n * 3), life: 0, dur: 0.5, n };
}
function spawnBurst(x: number, y: number, z: number, color: number, n: number, power: number): void {
  if (fxBudget() <= 0) return;
  const b = burstPool.pop() ?? makeBurst();
  b.pts.material.color.set(color);
  b.pts.material.opacity = 1;
  b.pts.visible = true;
  b.life = 0; b.dur = 0.5;
  const count = Math.min(b.n, n);
  for (let i = 0; i < b.n; i++) {
    b.pos[i * 3] = x; b.pos[i * 3 + 1] = y; b.pos[i * 3 + 2] = z;
    if (i < count) {
      const a = rand() * PI * 2, v = (0.4 + rand() * 0.8) * power;
      b.vel[i * 3] = Math.cos(a) * v; b.vel[i * 3 + 1] = 0.8 + rand() * 1.4 * power; b.vel[i * 3 + 2] = Math.sin(a) * v;
    } else b.vel[i * 3] = b.vel[i * 3 + 1] = b.vel[i * 3 + 2] = 0;
  }
  b.pts.geometry.getAttribute("position")!.needsUpdate = true;
  bursts.push(b);
}
interface Confetti { pts: Points; pos: Float32Array; col: Float32Array; vel: Float32Array; life: number }
let confetti: Confetti | null = null;
function spawnConfetti(winner: number): void {
  if (!confetti) {
    const n = MAX_PARTICLES;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("color", new BufferAttribute(col, 3));
    const pts = new Points(geo, new PointsMaterial({ size: 0.09, vertexColors: true, transparent: true }));
    fxGroup.add(pts);
    confetti = { pts, pos, col, vel: new Float32Array(n * 3), life: 0 };
  }
  const cf = confetti, budget = Math.min(MAX_PARTICLES, fxBudget());
  const c = new Color();
  for (let i = 0; i < MAX_PARTICLES; i++) {
    cf.pos[i * 3] = (rand() - 0.5) * (boardCols + 2);
    cf.pos[i * 3 + 1] = i < budget ? 2.5 + rand() * 2.5 : -10;
    cf.pos[i * 3 + 2] = (rand() - 0.5) * (boardRows + 2);
    cf.vel[i * 3] = (rand() - 0.5) * 0.6; cf.vel[i * 3 + 1] = -(0.5 + rand() * 0.9); cf.vel[i * 3 + 2] = (rand() - 0.5) * 0.6;
    c.set(playerColors[(winner + (i % 2)) % playerColors.length]!);
    if (rand() < 0.3) c.set(palette.paper);
    cf.col[i * 3] = c.r; cf.col[i * 3 + 1] = c.g; cf.col[i * 3 + 2] = c.b;
  }
  cf.pts.geometry.setDrawRange(0, budget);
  cf.life = 0;
  cf.pts.geometry.getAttribute("position")!.needsUpdate = true;
  cf.pts.geometry.getAttribute("color")!.needsUpdate = true;
  cf.pts.material.opacity = 1;
  cf.pts.visible = true;
}
function stepFx(dt: number): void {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]!;
    b.life += dt;
    for (let j = 0; j < b.n; j++) {
      b.vel[j * 3 + 1]! -= 4.5 * dt;
      b.pos[j * 3]! += b.vel[j * 3]! * dt; b.pos[j * 3 + 1]! += b.vel[j * 3 + 1]! * dt; b.pos[j * 3 + 2]! += b.vel[j * 3 + 2]! * dt;
    }
    b.pts.geometry.getAttribute("position")!.needsUpdate = true;
    b.pts.material.opacity = clamp01(1 - b.life / b.dur);
    if (b.life >= b.dur) { b.pts.visible = false; bursts.splice(i, 1); if (burstPool.length < MAX_BURSTS) burstPool.push(b); }
  }
  const cf = confetti;
  if (cf && cf.pts.visible) {
    cf.life += dt;
    for (let k = 0; k < MAX_PARTICLES; k++) {
      cf.pos[k * 3]! += cf.vel[k * 3]! * dt + Math.sin(cf.life * 3 + k) * 0.15 * dt;
      cf.pos[k * 3 + 1]! += cf.vel[k * 3 + 1]! * dt;
      cf.pos[k * 3 + 2]! += cf.vel[k * 3 + 2]! * dt;
    }
    cf.pts.geometry.getAttribute("position")!.needsUpdate = true;
    cf.pts.material.opacity = clamp01(1.6 - cf.life * 0.45);
    if (cf.life > 4) cf.pts.visible = false;
  }
}
function clearFx(): void {
  for (const b of bursts.splice(0)) { b.pts.visible = false; if (burstPool.length < MAX_BURSTS) burstPool.push(b); }
  if (confetti) confetti.pts.visible = false;
}
interface Dust { pts: Points; pos: Float32Array; base: Float32Array; phase: Float32Array }
let dust: Dust | null = null;
let dustT = 0;
function ensureDust(): void {
  if (dust) return;
  const pos = new Float32Array(MAX_DUST * 3);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  const pts = new Points(geo, new PointsMaterial({
    size: 0.04, map: moteTexture(), color: 0xffe2b8, transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending, fog: false,
  }));
  pts.visible = false;
  fxGroup.add(pts);
  dust = { pts, pos, base: new Float32Array(MAX_DUST * 3), phase: new Float32Array(MAX_DUST) };
  placeDust();
}
function placeDust(): void {
  if (!dust) return;
  const r2 = mulberry32(0xd057);
  const hx = Math.max(boardCols, 3) * 0.45 + 0.4, hz = Math.max(boardRows, 3) * 0.45 + 0.4;
  for (let i = 0; i < MAX_DUST; i++) {
    dust.base[i * 3] = (r2() - 0.5) * 2 * hx; dust.base[i * 3 + 1] = 0.25 + r2() * 2.2; dust.base[i * 3 + 2] = (r2() - 0.5) * 2 * hz;
    dust.phase[i] = r2() * PI * 2;
    dust.pos.set(dust.base.subarray(i * 3, i * 3 + 3), i * 3);
  }
  dust.pts.geometry.getAttribute("position")!.needsUpdate = true;
}
const ambientOn = (): boolean => !!look?.animated && !reducedMotion;
function applyAmbient(): void {
  const on = ambientOn();
  if (on) ensureDust();
  if (dust) {
    dust.pts.visible = on;
    dust.pts.geometry.setDrawRange(0, look?.particles === "high" ? BUD.dust : Math.round(BUD.dust / 3));
  }
}
function stepAmbient(dt: number): void {
  if (!ambientOn()) return;
  dustT += dt;
  if (!dust || !dust.pts.visible) return;
  for (let i = 0; i < MAX_DUST; i++) {
    const ph = dust.phase[i]!, t = dustT * 0.12 + ph;
    dust.pos[i * 3] = dust.base[i * 3]! + Math.sin(t * 1.3) * 0.35;
    dust.pos[i * 3 + 1] = dust.base[i * 3 + 1]! + ((dustT * 0.05 + ph) % 1) * 0.5 - 0.25 + Math.sin(t * 2.1) * 0.08;
    dust.pos[i * 3 + 2] = dust.base[i * 3 + 2]! + Math.cos(t) * 0.3;
  }
  dust.pts.geometry.getAttribute("position")!.needsUpdate = true;
  dust.pts.material.opacity = 0.32 + Math.sin(dustT * 0.7) * 0.06;
}

// ---------------------------------------------------------------- preview / focus
let ghost: Mesh | null = null, ghostRing: Mesh | null = null, focusRing: Mesh | null = null;
function ensureGhost(): void {
  if (ghost) return;
  ghost = new Mesh(hEdgeGeo, new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, transparent: true, opacity: 0.7, roughness: 0.4 }));
  ghost.visible = false;
  ghost.noAO = true;
  ghostRing = new Mesh(new RingGeometry(0.3, 0.38, 32), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: DoubleSide }));
  ghostRing.rotation.x = -PI / 2;
  ghostRing.position.y = 0.006;
  ghostRing.visible = false;
  ghostRing.noAO = true;
  focusRing = new Mesh(new RingGeometry(0.42, 0.48, 32), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: DoubleSide }));
  focusRing.rotation.x = -PI / 2;
  focusRing.position.y = 0.008;
  focusRing.visible = false;
  focusRing.noAO = true;
  overlayGroup.add(ghost, ghostRing, focusRing);
}
/** The ghost strip over an edge: green safe, amber risky, white claim; null hides it. */
export function setPreview(e: Edge | null, kind: "ok" | "risky" | "claim" | null): void {
  if (!built) setup();
  ensureGhost();
  if (!e || !kind) { ghost!.visible = false; ghostRing!.visible = false; return; }
  const color = PREVIEW_COLORS[kind] ?? PREVIEW_COLORS.ok!;
  edgePos(e.dir, e.r, e.c, tmpV);
  ghost!.geometry = e.dir === "h" ? hEdgeGeo : vEdgeGeo;
  ghost!.position.set(tmpV.x, EDGE_H / 2 + 0.05, tmpV.z);
  const gm = ghost!.material as MeshStandardMaterial;
  gm.color.set(color); gm.emissive.set(color);
  ghost!.visible = true;
  ghostRing!.position.x = tmpV.x; ghostRing!.position.z = tmpV.z;
  (ghostRing!.material as MeshBasicMaterial).color.set(color);
  ghostRing!.visible = true;
}
export function setFocusEdge(e: Edge | null): void {
  if (!built) setup();
  ensureGhost();
  if (!e) { focusRing!.visible = false; return; }
  edgePos(e.dir, e.r, e.c, tmpV);
  focusRing!.position.x = tmpV.x; focusRing!.position.z = tmpV.z;
  focusRing!.visible = true;
}

// ---------------------------------------------------------------- seat tokens
let tokens: Mesh[] = [];
const tokenGeo = new CircleGeometry(0.17, 24);
function buildTurnTokens(): void {
  for (const t of tokens) scene.remove(t);
  tokens = [];
  // One round seat per player on each side of the sheet: player 0 near (south), then clockwise.
  const seats = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  for (let i = 0; i < playerColors.length; i++) {
    const t = new Mesh(tokenGeo, mats!.turn[i]!);
    t.rotation.x = -PI / 2;
    const d = seats[i % 4]!;
    const rad = d[0] !== 0 ? boardCols * 0.5 + 0.85 : boardRows * 0.5 + 0.85;
    t.position.set(d[0]! * rad, 0.005, d[1]! * rad);
    t.noAO = true;
    t.visible = false;
    scene.add(t);
    tokens.push(t);
  }
}
let turnTarget = 0;
let seatCount = 2;
export function setTurn(i: number): void { turnTarget = i | 0; }
/** Seats shown: one per pencil on the sheet. */
export function setSeats(n: number): void { seatCount = n; }
function stepTurn(dt: number): void {
  tokens.forEach((t, i) => {
    const m = t.material as MeshBasicMaterial;
    const goal = i === turnTarget && i < seatCount ? (ambientOn() ? 0.82 + Math.sin(dustT * 2.4) * 0.1 : 0.85) : 0;
    let next = m.opacity + (goal - m.opacity) * Math.min(1, dt * 8);
    if (Math.abs(next - goal) < 0.01) next = goal;
    m.opacity = next;
    t.visible = next > 0.01;
  });
}

// ---------------------------------------------------------------- camera
const camTarget = new Vector3();
let camAnim: { fromPos: Vector3; fromTgt: Vector3; toPos: Vector3; toTgt: Vector3; t: number; dur: number } | null = null;
let driftT = 0;
const orbit = { x: 0, y: 0 };
const pf = { x: 0, y: 0, w: 16, h: 9, W: 16, H: 9 };
let pfKey = "";
/** The playfield (where the browser build's canvas sat) in the window W × H, logical pixels. */
export function setPlayfield(x: number, y: number, w: number, h: number, W: number, H: number): void {
  const k = [x, y, w, h, W, H].map((v) => v.toFixed(1)).join(":");
  if (k === pfKey) return;
  pfKey = k;
  Object.assign(pf, { x, y, w: Math.max(2, w), h: Math.max(2, h), W: Math.max(2, W), H: Math.max(2, H) });
  camera.aspect = pf.w / pf.h;
  camera.updateProjectionMatrix();
  camera.setViewOffset(pf.w, pf.h, -pf.x, -pf.y, pf.W, pf.H);
  if (!camAnim) fitCamera();
}
function authoredPose(pos: Vector3, tgt: Vector3): void {
  // The sheet fills most of the playfield at any aspect; steeper on narrow ones.
  const aspect = Math.max(0.5, pf.w / pf.h);
  const vSpan = Math.max(boardRows * 1.4, (boardCols * 1.3) / aspect, 2.4);
  const dist = vSpan / (2 * Math.tan((FOV * PI / 180) / 2));
  pos.set(0, dist * (aspect < 1 ? 0.95 : 0.8), dist);
  tgt.set(0, 0, Math.min(0.4, Math.max(boardRows, boardCols) * 0.04));
}
function applyPose(pos: Vector3, tgt: Vector3): void {
  camera.position.copy(pos);
  camTarget.copy(tgt);
  camera.lookAt(camTarget);
}
const _p = new Vector3(), _t = new Vector3();
function fitCamera(): void { authoredPose(_p, _t); _p.x += orbit.x; _p.z += orbit.y; applyPose(_p, _t); }
export function resetCamera(): void {
  authoredPose(_p, _t);
  orbit.x = orbit.y = 0;
  camAnim = { fromPos: camera.position.clone(), fromTgt: camTarget.clone(), toPos: _p.clone(), toTgt: _t.clone(), t: 0, dur: reducedMotion ? 0.15 : RESET_EASE };
}
function startCamRise(): void {
  camAnim = { fromPos: camera.position.clone(), fromTgt: camTarget.clone(), toPos: camera.position.clone().add(new Vector3(0, 1.6, 1.2)), toTgt: camTarget.clone(), t: 0, dur: 2.2 };
}
/** A drag on the scene orbits the camera slightly (clamped ±0.8 units). */
export function setOrbit(dx: number, dy: number): void {
  orbit.x = Math.max(-0.8, Math.min(0.8, -dx * 0.004));
  orbit.y = Math.max(-0.8, Math.min(0.8, dy * 0.004));
  if (reducedMotion && !camAnim) fitCamera();
}
function stepCamera(dt: number): void {
  if (camAnim) {
    camAnim.t += dt;
    const t = easeInOut(clamp01(camAnim.t / camAnim.dur));
    camera.position.copy(camAnim.fromPos).lerp(camAnim.toPos, t);
    camTarget.copy(camAnim.fromTgt).lerp(camAnim.toTgt, t);
    camera.position.x += orbit.x; camera.position.z += orbit.y;
    camera.lookAt(camTarget);
    if (camAnim.t >= camAnim.dur) camAnim = null;
    return;
  }
  if (reducedMotion) return;
  driftT += dt;
  authoredPose(_p, _t);
  _p.x += Math.sin(driftT * PI * 2 / CAM_DRIFT_PERIOD) * CAM_DRIFT_AMP + orbit.x;
  _p.y += Math.cos(driftT * PI * 2 / (CAM_DRIFT_PERIOD * 1.7)) * CAM_DRIFT_AMP * 0.4;
  _p.z += orbit.y;
  applyPose(_p, _t);
}

// ---------------------------------------------------------------- picking
const ray = new Raycaster();
/** The edge under a window pixel (the hit strips: 1 long, 0.32 wide), or null. */
export function pick(x: number, y: number): Edge | null {
  if (!boardRows) return null;
  ray.setFromCamera(pointerToNdc(x, y), camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  if (Math.abs(d.y) < 1e-6) return null;
  const t = (EDGE_H / 2 - o.y) / d.y;
  if (t <= 0) return null;
  const u = o.x + d.x * t + boardCols / 2, v = o.z + d.z * t + boardRows / 2;
  let best: Edge | null = null, bestD = HIT_W / 2;
  const hr = Math.round(v), hc = Math.floor(u);
  if (hr >= 0 && hr <= boardRows && hc >= 0 && hc < boardCols && Math.abs(v - hr) <= bestD) { bestD = Math.abs(v - hr); best = { dir: "h", r: hr, c: hc }; }
  const vc = Math.round(u), vr = Math.floor(v);
  if (vc >= 0 && vc <= boardCols && vr >= 0 && vr < boardRows && Math.abs(u - vc) < bestD) best = { dir: "v", r: vr, c: vc };
  return best;
}

// ---------------------------------------------------------------- the look
let envTex: Texture | null = null;
let builtKey = "";
/** The look for the frame's graphics level; cheap when nothing changed. */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  look = next;
  BUD = next.budget;
  if (!built) setup();
  const shadows = next.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  key.castShadow = shadows;
  if (shadows) key.shadow.mapSize = next.shadows;
  key.shadow.radius = next.shadows >= 4096 ? 3 : 2;
  if (next.reflections) {
    if (!envTex) {
      try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
      catch (e) { console.warn("environment:", e instanceof Error ? e.message : String(e)); }
    }
    scene.environment = envTex;
    hemi.intensity = 0.32;
  } else {
    scene.environment = null;
    hemi.intensity = 0.55;
  }
  const env = next.reflections ? envTex : null;
  scene.traverse((o) => {
    if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) o.material.envMap = env;
  });
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.35, distanceExponent: 1.4, thickness: 0.6, scale: 1.0, samples: next.ao === "high" ? 16 : 8,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only the glowing seat token, previews and bright glints bloom.
  renderer.bloom = next.bloom ? { strength: 0.5, radius: 0.4, threshold: 0.88, resolution: next.budget.bloomRes } : null;
  // The browser build's grade: a gentle S-curve (0.18), saturation 1.1,
  // cool shadows / warm highlights rising over 0.15–0.8, a 0.34 vignette.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.09, saturation: 1.1,
    shadows: [0.95, 0.98, 1.05], highlights: [1.05, 1.0, 0.94], split: [0.15, 0.8],
    vignette: { amount: 0.34, inner: 0.32, outer: 0.85, scale: [1.1, 1] },
  } : null;
  renderer.antialias = next.antialias;
  const k = [next.detailed, next.bloom, BUD.material, BUD.texture, BUD.paperCell, BUD.dotSegments].join("|");
  if (k !== builtKey) {
    builtKey = k;
    buildMaterials();
    if (boardRows) {
      const st = lastState;
      heViews = [];
      if (st) syncState(st); else setBoard(boardRows, boardCols, {});
    }
  }
  applyAmbient();
}
export function setReducedMotion(on: boolean): void {
  reducedMotion = on;
  if (on) { driftT = 0; if (!camAnim) fitCamera(); }
  applyAmbient();
}
/** Colours for a theme and the players (standard or high-visibility): the sheet is rebuilt. */
export function setPalette(p: Palette, colors: number[]): void {
  const k = JSON.stringify([p, colors]);
  if (k === JSON.stringify([palette, playerColors]) && mats) return;
  palette = p;
  playerColors = colors.slice(0, 4);
  buildMaterials();
  if (lastState) { heViews = []; syncState(lastState); }
  else if (boardRows) setBoard(boardRows, boardCols, {});
}

// ---------------------------------------------------------------- menu backdrop
/** A small sheet mid-game behind the title and menus until a real sheet is dealt. */
export function showDemo(): void {
  const rows = 3, cols = 4;
  const z = (n: number, m: number, v: number): number[][] => Array.from({ length: n }, () => Array.from({ length: m }, () => v));
  const st = { rows, cols, holes: {}, he: z(rows + 1, cols, 0), ve: z(rows, cols + 1, 0), cells: z(rows, cols, -1), current: 0 } as unknown as State;
  st.he[0]![0] = st.he[1]![0] = st.ve[0]![0] = st.ve[0]![1] = 1; st.cells[0]![0] = 0;
  st.he[1]![2] = st.he[2]![2] = st.ve[1]![2] = st.ve[1]![3] = 2; st.cells[1]![2] = 1;
  st.he[0]![3] = 2; st.he[3]![1] = 1; st.ve[2]![4] = 2; st.ve[1]![0] = 1; st.he[0]![1] = 1;
  setSeats(2);
  heViews = [];
  syncState(st);
  setPreview(null, null);
  setFocusEdge(null);
}

// ---------------------------------------------------------------- per frame
export function frame(dtRaw: number): void {
  if (!built || !look) return;
  const dt = Math.min(0.1, Math.max(0, dtRaw));
  stepEvents(dt);
  stepFx(dt);
  stepCamera(dt);
  stepAmbient(dt);
  stepTurn(dt);
}
