/* Boxes & Lines — Three.js renderer.
 * Dimensional graph-paper desk: procedural desk/paper textures, folding
 * paper boxes on claims, seeded cosmetic randomness, no post-processing.
 * ES module; depends only on the vendored three (r160).
 *
 * Board geometry (shared with main.js): dot spacing 1.0, centered at
 * origin. dot(r,c) at (x = c - cols/2, y = 0, z = r - rows/2).
 * h-edge (r,c) joins dots (r,c)-(r,c+1); v-edge (r,c) joins (r,c)-(r+1,c).
 */
import * as THREE from '../vendor/three.module.min.js';

// ---------- authored framing constants ----------
var FOV = 40;                 // low-distortion perspective
var CAM_DRIFT_AMP = 0.12;     // idle drift amplitude (world units)
var CAM_DRIFT_PERIOD = 14;    // seconds
var RESET_EASE = 0.8;         // seconds for resetCamera()
var FOLD_TIME = 0.55;         // seconds for a box claim fold
var PAPER_THICK = 0.012;
var EDGE_W = 0.055;           // visible strip width
var EDGE_H = 0.03;            // visible strip height
var HIT_W = 0.32;             // invisible hit-mesh fatness
var HOLE_DEPTH = 0.02;
var MAX_BURSTS = 48;          // pooled paper bursts
var MAX_CONFETTI = 260;       // pooled paper chips (bounded)
var TAP_DIST = 6;             // px: movement above this = drag, not a tap

var LAYER_HIT = 7;            // dedicated interaction layer (never rendered)

var QUALITY = {
  low:    { dpr: 1.0, shadow: false, shadowMap: 0,    particles: 80,  env: false },
  medium: { dpr: 1.5, shadow: true,  shadowMap: 1024, particles: 160, env: true },
  high:   { dpr: 2.0, shadow: true,  shadowMap: 2048, particles: 300, env: true }
};

var PREVIEW_COLORS = { ok: 0x6fd98a, risky: 0xe8a13f, claim: 0xffffff };

// ---------- seeded PRNG (mulberry32) ----------
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function webglAvailable() {
  try {
    var c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

// ---------- procedural textures ----------
function makeDeskTexture(palette, rand) {
  var cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  var g = cv.getContext('2d');
  var base = new THREE.Color(palette.desk);
  var dark = new THREE.Color(palette.deskDark);
  var planks = 6, pw = 512 / planks;
  for (var i = 0; i < planks; i++) {
    var t = rand() * 0.5;
    var col = base.clone().lerp(dark, 0.25 + t * 0.5);
    g.fillStyle = '#' + col.getHexString();
    g.fillRect(i * pw, 0, pw, 512);
    // grain streaks
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    g.lineWidth = 1;
    for (var s = 0; s < 14; s++) {
      var y = rand() * 512;
      g.beginPath();
      g.moveTo(i * pw, y);
      g.bezierCurveTo(i * pw + pw * 0.3, y + rand() * 6 - 3,
        i * pw + pw * 0.7, y + rand() * 6 - 3, i * pw + pw, y + rand() * 4 - 2);
      g.stroke();
    }
    // plank seam
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(i * pw, 0, 1.5, 512);
  }
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makePaperTexture(palette, rows, cols) {
  // Grid texture covering the sheet; cell = 64px per world unit.
  var cell = 64, pad = 32;
  var cv = document.createElement('canvas');
  cv.width = cols * cell + pad * 2;
  cv.height = rows * cell + pad * 2;
  var g = cv.getContext('2d');
  var paper = new THREE.Color(palette.paper);
  var grid = new THREE.Color(palette.grid);
  g.fillStyle = '#' + paper.getHexString();
  g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = '#' + grid.getHexString();
  g.globalAlpha = 0.55;
  g.lineWidth = 1;
  for (var r = 0; r <= rows; r++) {
    var y = pad + r * cell;
    g.beginPath(); g.moveTo(pad, y); g.lineTo(pad + cols * cell, y); g.stroke();
  }
  for (var c = 0; c <= cols; c++) {
    var x = pad + c * cell;
    g.beginPath(); g.moveTo(x, pad); g.lineTo(x, pad + rows * cell); g.stroke();
  }
  // slightly darker frame edge
  g.globalAlpha = 0.35;
  g.lineWidth = 2;
  g.strokeRect(1, 1, cv.width - 2, cv.height - 2);
  g.globalAlpha = 1;
  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Per-player flat stamp geometry (shape reinforces color).
function makeStampGeometry(idx) {
  var s = 0.16, shape;
  if (idx % 4 === 0) {
    return new THREE.CircleGeometry(s, 24);
  } else if (idx % 4 === 1) {
    shape = new THREE.Shape();
    shape.moveTo(0, s * 1.2);
    shape.lineTo(-s, -s * 0.7);
    shape.lineTo(s, -s * 0.7);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  } else if (idx % 4 === 2) {
    return new THREE.PlaneGeometry(s * 1.6, s * 1.6);
  }
  shape = new THREE.Shape();
  shape.moveTo(0, s * 1.25); shape.lineTo(s * 1.25, 0);
  shape.lineTo(0, -s * 1.25); shape.lineTo(-s * 1.25, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

// ---------- easing ----------
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// ================================================================
export function createRenderer(host, opts) {
  opts = opts || {};
  var palette = opts.palette || {};
  var playerColors = (opts.playerColors || [0x3f8efc, 0xef5d4e, 0xe8b23f, 0x5fbf77]).slice(0, 4);
  var reducedMotion = !!opts.reducedMotion;
  var qualityTier = QUALITY[opts.quality] ? opts.quality : 'medium';
  var onPick = typeof opts.onPick === 'function' ? opts.onPick : function () {};
  var onHover = typeof opts.onHover === 'function' ? opts.onHover : function () {};

  var rand = mulberry32(0xB0E5 ^ 0x51EED);
  var boardSeed = 0xB0E5;

  // ---------- renderer / scene ----------
  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[qualityTier].dpr));
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);

  // Environment (rebuilt on palette/board change)
  var envGroup = new THREE.Group();
  scene.add(envGroup);

  var hemi = new THREE.HemisphereLight(0xfff2e0, 0x30241a, 0.55);
  scene.add(hemi);
  var key = new THREE.DirectionalLight(palette.light != null ? palette.light : 0xffd9a8, 2.2);
  key.position.set(-4, 7, 3);
  key.castShadow = false;
  scene.add(key);
  key.target.position.set(0, 0, 0);
  scene.add(key.target);

  // ---------- board groups ----------
  var boardGroup = new THREE.Group();   // everything rebuilt by setBoard
  scene.add(boardGroup);
  var edgeGroup = new THREE.Group();
  var cellGroup = new THREE.Group();
  var hitGroup = new THREE.Group();
  boardGroup.add(edgeGroup, cellGroup, hitGroup);

  var overlayGroup = new THREE.Group(); // ghost/focus/preview (kept across boards)
  scene.add(overlayGroup);
  var fxGroup = new THREE.Group();
  scene.add(fxGroup);

  // ---------- shared materials (disposed on palette change/dispose) ----------
  var mats = {};
  function buildMaterials() {
    Object.keys(mats).forEach(function (k) { mats[k].dispose(); });
    var ink = new THREE.Color(palette.dot != null ? palette.dot : 0x4a4038);
    mats = {
      dot: new THREE.MeshStandardMaterial({ color: ink, roughness: 0.6, metalness: 0.1 }),
      neutral: new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.85 }),
      hole: new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.wall || 0x3a2e26).multiplyScalar(0.4), roughness: 1 }),
      player: playerColors.map(function (c) {
        return new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.05 });
      }),
      stamp: playerColors.map(function (c) {
        return new THREE.MeshStandardMaterial({
          color: new THREE.Color(c).multiplyScalar(0.55), roughness: 0.7, side: THREE.DoubleSide
        });
      }),
      turn: playerColors.map(function (c) {
        return new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0 });
      })
    };
  }
  buildMaterials();

  // ---------- environment ----------
  var envDisposables = [];
  function trackEnv(res) { envDisposables.push(res); return res; }
  function clearEnv() {
    while (envGroup.children.length) {
      var ch = envGroup.children.pop();
      envGroup.remove(ch);
    }
    envDisposables.forEach(function (d) { if (d && d.dispose) d.dispose(); });
    envDisposables = [];
  }
  function buildEnv(rows, cols) {
    clearEnv();
    var w = Math.max(14, cols + 8), d = Math.max(12, rows + 7);
    // desk
    var deskTex = trackEnv(makeDeskTexture(palette, rand));
    deskTex.repeat.set(2, 2);
    var deskMat = trackEnv(new THREE.MeshStandardMaterial({ map: deskTex, roughness: 0.8 }));
    var deskGeo = trackEnv(new THREE.PlaneGeometry(w, d));
    var desk = new THREE.Mesh(deskGeo, deskMat);
    desk.rotation.x = -Math.PI / 2;
    desk.position.y = -0.14;
    desk.receiveShadow = true;
    envGroup.add(desk);
    // paper sheet
    var paperTex = trackEnv(makePaperTexture(palette, rows, cols));
    var paperMat = trackEnv(new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.95 }));
    var paperGeo = trackEnv(new THREE.BoxGeometry(cols + 1.2, PAPER_THICK, rows + 1.2));
    var paper = new THREE.Mesh(paperGeo, paperMat);
    paper.position.y = -PAPER_THICK / 2;
    paper.receiveShadow = true;
    envGroup.add(paper);
    // backdrop wall + fog
    var wallGeo = trackEnv(new THREE.PlaneGeometry(60, 30));
    var wallMat = trackEnv(new THREE.MeshStandardMaterial({ color: palette.wall || 0x3a2e26, roughness: 1 }));
    var wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 8, -Math.max(8, rows * 0.9 + 6));
    envGroup.add(wall);
    scene.fog = new THREE.Fog(palette.fog != null ? palette.fog : 0x2a211b, 14, 34);
    key.color.set(palette.light != null ? palette.light : 0xffd9a8);
  }

  // ---------- board state mirrors ----------
  var boardRows = 0, boardCols = 0;
  var heMeshes = [];   // [r][c] -> {mesh, value} for h edges
  var veMeshes = [];
  var cellViews = [];  // [r][c] -> {fold: Group|null, flaps, stamp, value, hole}
  var hitMeshes = [];  // flat list, userData = {dir,r,c}
  var holes = {};

  // edge geometry: unit box along X (length 1) reused with rotation for v edges
  var hEdgeGeo = new THREE.BoxGeometry(0.86, EDGE_H, EDGE_W);
  var vEdgeGeo = new THREE.BoxGeometry(EDGE_W, EDGE_H, 0.86);
  var hHitGeo = new THREE.BoxGeometry(1.0, 0.25, HIT_W);
  var vHitGeo = new THREE.BoxGeometry(HIT_W, 0.25, 1.0);
  var dotGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.09, 12);
  var flapGeo = new THREE.BoxGeometry(1.0, PAPER_THICK, 0.5); // one flap, hinged later
  var floorGeo = new THREE.BoxGeometry(1.0, PAPER_THICK, 1.0);
  var stampGeos = [0, 1, 2, 3].map(makeStampGeometry);

  function dotX(c) { return c - boardCols / 2; }
  function dotZ(r) { return r - boardRows / 2; }
  function edgePos(dir, r, c, out) {
    if (dir === 'h') out.set(dotX(c) + 0.5, 0, dotZ(r));
    else out.set(dotX(c), 0, dotZ(r) + 0.5);
    return out;
  }

  function disposeObject(root) {
    root.traverse(function (o) {
      if (o.userData && o.userData.ownGeo && o.geometry) o.geometry.dispose();
      if (o.userData && o.userData.ownMat && o.material) o.material.dispose();
    });
  }

  function clearBoardMeshes() {
    disposeObject(edgeGroup); disposeObject(cellGroup); disposeObject(hitGroup);
    edgeGroup.clear(); cellGroup.clear(); hitGroup.clear();
    heMeshes = []; veMeshes = []; cellViews = []; hitMeshes = [];
  }

  function makeFoldBox(r, c, owner) {
    // Cell floor + 4 flaps hinged at cell edges; flaps start flat (angle 0)
    // and rotate up to vertical during the claim animation.
    var g = new THREE.Group();
    g.position.set(dotX(c) + 0.5, 0.004, dotZ(r) + 0.5);
    var mat = mats.player[owner % mats.player.length];
    var floor = new THREE.Mesh(floorGeo, mat);
    floor.castShadow = floor.receiveShadow = true;
    g.add(floor);
    var flaps = [];
    // hinge groups at the four edges; flap meshes offset so their far edge
    // lies over the cell centre when folded. Hinges: +x, -x, +z, -z.
    var defs = [
      { hx: 0.5, hz: 0, axis: 'z', dir: 1, off: [0.25, 0], rot0: 0 },
      { hx: -0.5, hz: 0, axis: 'z', dir: -1, off: [-0.25, 0], rot0: 0 },
      { hx: 0, hz: 0.5, axis: 'x', dir: -1, off: [0, 0.25], rot0: 0 },
      { hx: 0, hz: -0.5, axis: 'x', dir: 1, off: [0, -0.25], rot0: 0 }
    ];
    defs.forEach(function (d) {
      var hinge = new THREE.Group();
      hinge.position.set(d.hx, PAPER_THICK / 2, d.hz);
      var flap = new THREE.Mesh(flapGeo, mat);
      if (d.axis === 'z') {
        // flap plane runs along z; box geometry is (x len, y, z len)
        flap.geometry = flapGeo; // 1.0 x 0.5 — reuse; oriented by rotation
        flap.rotation.y = Math.PI / 2;
        flap.position.set(d.off[0], 0, 0);
      } else {
        flap.position.set(0, 0, d.off[1]);
      }
      flap.castShadow = true;
      hinge.add(flap);
      g.add(hinge);
      flaps.push({ hinge: hinge, axis: d.axis, dir: d.dir, t: 0 });
    });
    // player shape stamp, face-up just above the floor
    var stamp = new THREE.Mesh(stampGeos[owner % 4], mats.stamp[owner % 4]);
    stamp.rotation.x = -Math.PI / 2;
    stamp.position.y = PAPER_THICK + 0.002;
    stamp.scale.setScalar(0.001); // pops in with the fold
    g.add(stamp);
    return { group: g, flaps: flaps, stamp: stamp, anim: null, done: false };
  }

  function setFoldPose(view, t) {
    // t 0..1 — flaps rotate up (deterministic), stamp scales in
    var a = easeOutCubic(clamp01(t)) * (Math.PI / 2);
    view.flaps.forEach(function (f) {
      if (f.axis === 'z') f.hinge.rotation.z = f.dir * a;
      else f.hinge.rotation.x = f.dir * a;
    });
    var s = easeOutCubic(clamp01((t - 0.35) / 0.65));
    view.stamp.scale.setScalar(Math.max(0.001, s));
  }

  function setBoard(rows, cols, holesObj) {
    clearBoardMeshes();
    clearFx();
    boardRows = rows; boardCols = cols;
    holes = holesObj || {};
    buildEnv(rows, cols);
    var r, c;
    // dots
    var dotCount = (rows + 1) * (cols + 1);
    var dots = new THREE.InstancedMesh(dotGeo, mats.dot, dotCount);
    dots.castShadow = true;
    var m = new THREE.Matrix4();
    var di = 0;
    for (r = 0; r <= rows; r++) {
      for (c = 0; c <= cols; c++) {
        m.setPosition(dotX(c), 0.045, dotZ(r));
        dots.setMatrixAt(di++, m);
      }
    }
    dots.instanceMatrix.needsUpdate = true;
    edgeGroup.add(dots);
    // edges (hidden until drawn) + hit meshes
    var hide = function (mesh) { mesh.visible = false; return mesh; };
    for (r = 0; r <= rows; r++) {
      heMeshes.push([]);
      for (c = 0; c < cols; c++) {
        var mesh = hide(new THREE.Mesh(hEdgeGeo, mats.neutral));
        mesh.position.set(dotX(c) + 0.5, EDGE_H / 2, dotZ(r));
        mesh.castShadow = true;
        edgeGroup.add(mesh);
        heMeshes[r].push({ mesh: mesh, value: 0 });
        var hit = new THREE.Mesh(hHitGeo, invisibleHitMat);
        hit.position.copy(mesh.position);
        hit.layers.set(LAYER_HIT);
        hit.userData.edge = { dir: 'h', r: r, c: c };
        hitGroup.add(hit);
        hitMeshes.push(hit);
      }
    }
    for (r = 0; r < rows; r++) {
      veMeshes.push([]);
      for (c = 0; c <= cols; c++) {
        var vmesh = hide(new THREE.Mesh(vEdgeGeo, mats.neutral));
        vmesh.position.set(dotX(c), EDGE_H / 2, dotZ(r) + 0.5);
        vmesh.castShadow = true;
        edgeGroup.add(vmesh);
        veMeshes[r].push({ mesh: vmesh, value: 0 });
        var vhit = new THREE.Mesh(vHitGeo, invisibleHitMat);
        vhit.position.copy(vmesh.position);
        vhit.layers.set(LAYER_HIT);
        vhit.userData.edge = { dir: 'v', r: r, c: c };
        hitGroup.add(vhit);
        hitMeshes.push(vhit);
      }
    }
    // cells
    for (r = 0; r < rows; r++) {
      cellViews.push([]);
      for (c = 0; c < cols; c++) {
        var view = { fold: null, value: -1, hole: !!holes[r + ',' + c], holeMesh: null };
        if (view.hole) {
          var hm = new THREE.Mesh(new THREE.BoxGeometry(0.98, HOLE_DEPTH, 0.98), mats.hole);
          hm.userData.ownGeo = true;
          hm.position.set(dotX(c) + 0.5, -HOLE_DEPTH / 2 - PAPER_THICK, dotZ(r) + 0.5);
          cellGroup.add(hm);
          view.holeMesh = hm;
        }
        cellViews[r].push(view);
      }
    }
    fitCamera();
  }

  var invisibleHitMat = new THREE.MeshBasicMaterial({ visible: false });

  // ---------- syncState ----------
  function applyEdge(view, value) {
    if (view.value === value) return;
    view.value = value;
    var mesh = view.mesh;
    if (value === 0) {
      mesh.visible = false;
    } else if (value === -1) {
      mesh.visible = true;
      mesh.material = mats.neutral;
      mesh.scale.y = 0.6;
    } else {
      mesh.visible = true;
      mesh.material = mats.player[(value - 1) % mats.player.length];
      mesh.scale.y = 1;
    }
  }

  function applyCell(view, r, c, value) {
    if (view.value === value) return;
    view.value = value;
    if (value >= 0 && !view.fold) {
      var fold = makeFoldBox(r, c, value);
      cellGroup.add(fold.group);
      view.fold = fold;
      // No animation queued (full sync): settle immediately.
      setFoldPose(fold, 1);
      fold.done = true;
    }
  }

  function syncState(state) {
    if (!state || state.rows !== boardRows || state.cols !== boardCols) {
      if (state) setBoard(state.rows, state.cols, state.holes);
      else return;
    }
    var r, c;
    for (r = 0; r <= state.rows; r++)
      for (c = 0; c < state.cols; c++)
        applyEdge(heMeshes[r][c], state.he[r][c]);
    for (r = 0; r < state.rows; r++)
      for (c = 0; c <= state.cols; c++)
        applyEdge(veMeshes[r][c], state.ve[r][c]);
    for (r = 0; r < state.rows; r++)
      for (c = 0; c < state.cols; c++)
        applyCell(cellViews[r][c], r, c, state.cells[r][c]);
    setTurn(state.current);
  }

  // ---------- animation queue ----------
  var animating = false;
  var queue = [];
  var active = null; // {ev, t}

  function animateEvents(events) {
    if (!events || !events.length) return;
    for (var i = 0; i < events.length; i++) queue.push(events[i]);
    animating = true;
  }

  function isAnimating() {
    return animating || camAnim !== null;
  }

  function skipAnimations() {
    queue.length = 0;
    if (active) { finishEvent(active.ev, 1); active = null; }
    animating = false;
    // settle all folds + particles + camera
    for (var r = 0; r < boardRows; r++) {
      for (var c = 0; c < boardCols; c++) {
        var f = cellViews[r] && cellViews[r][c] && cellViews[r][c].fold;
        if (f) { setFoldPose(f, 1); f.done = true; f.anim = null; }
      }
    }
    clearFx();
    if (camAnim) { applyCamPose(camAnim.to); camAnim = null; }
    driftT = 0;
  }

  // per-event durations (seconds)
  var EV_TIME = { draw: 0.28, box: FOLD_TIME + 0.15, pass: 0.12, 'extra-turn': 0.12, over: 1.4, resign: 1.0, timeout: 1.0 };

  function startEvent(ev) {
    var p = tmpV;
    if (ev.type === 'draw') {
      edgePos(ev.dir, ev.r, ev.c, p);
      spawnBurst(p.x, 0.06, p.z, palette.dot != null ? palette.dot : 0x4a4038, 6, 0.5);
    } else if (ev.type === 'box') {
      var view = cellViews[ev.r] && cellViews[ev.r][ev.c];
      if (view && view.fold) {
        view.fold.anim = { t: 0, dur: reducedMotion ? 0.15 : FOLD_TIME };
      }
      spawnBurst(dotX(ev.c) + 0.5, 0.2, dotZ(ev.r) + 0.5, playerColors[(ev.player || 0) % playerColors.length], 14, 1.2);
    } else if (ev.type === 'over' || ev.type === 'resign' || ev.type === 'timeout') {
      if (!reducedMotion) {
        startCamRise();
        spawnConfetti(ev.winner >= 0 ? ev.winner : 0);
      }
    }
  }

  function finishEvent(ev, tFinal) {
    // deterministic end state per event type
    if (ev.type === 'box') {
      var view = cellViews[ev.r] && cellViews[ev.r][ev.c];
      if (view && view.fold) { setFoldPose(view.fold, 1); view.fold.done = true; view.fold.anim = null; }
    }
  }

  function stepEvents(dt) {
    if (!active && queue.length) {
      active = { ev: queue.shift(), t: 0 };
      startEvent(active.ev);
      if (reducedMotion && EV_TIME[active.ev.type] > 0.3) active.dur = 0.3;
    }
    if (active) {
      active.t += dt;
      var dur = active.dur || EV_TIME[active.ev.type] || 0.2;
      if (active.t >= dur) {
        finishEvent(active.ev, 1);
        active = null;
        if (!queue.length) animating = false;
      }
    }
    // fold animations run on their own clock (multiple boxes can fold at once)
    for (var r = 0; r < boardRows; r++) {
      var row = cellViews[r];
      if (!row) continue;
      for (var c = 0; c < boardCols; c++) {
        var f = row[c] && row[c].fold;
        if (f && f.anim) {
          f.anim.t += dt;
          var t = f.anim.t / f.anim.dur;
          if (t >= 1) { setFoldPose(f, 1); f.anim = null; f.done = true; }
          else setFoldPose(f, t);
        }
      }
    }
  }

  // ---------- FX: pooled paper bursts & confetti ----------
  var burstPool = [];
  var confetti = null;
  var fxBudget = function () { return QUALITY[qualityTier].particles; };

  function makeBurst() {
    var n = 14;
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({ size: 0.05, transparent: true, opacity: 1 });
    var pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.userData = { vel: new Float32Array(n * 3), life: 0, dur: 1, n: n };
    fxGroup.add(pts);
    return pts;
  }
  function spawnBurst(x, y, z, color, n, power) {
    if (fxBudget() <= 0) return;
    var pts = burstPool.length ? burstPool.pop() : makeBurst();
    var u = pts.userData;
    pts.material.color.set(color);
    pts.material.size = 0.05;
    pts.visible = true;
    u.life = 0; u.dur = 0.5;
    var p = pts.geometry.attributes.position.array;
    var count = Math.min(u.n, n);
    for (var i = 0; i < u.n; i++) {
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
      if (i < count) {
        var a = rand() * Math.PI * 2, v = (0.4 + rand() * 0.8) * power;
        u.vel[i * 3] = Math.cos(a) * v;
        u.vel[i * 3 + 1] = 0.8 + rand() * 1.4 * power;
        u.vel[i * 3 + 2] = Math.sin(a) * v;
      } else {
        u.vel[i * 3] = u.vel[i * 3 + 1] = u.vel[i * 3 + 2] = 0;
      }
    }
    pts.geometry.attributes.position.needsUpdate = true;
    activeBursts.push(pts);
  }
  var activeBursts = [];

  function makeConfetti() {
    var n = MAX_CONFETTI;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    var mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true });
    var pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.userData = { vel: new Float32Array(n * 3), life: 0, n: n };
    fxGroup.add(pts);
    return pts;
  }
  function spawnConfetti(winnerIdx) {
    if (!confetti) confetti = makeConfetti();
    var u = confetti.userData;
    var p = confetti.geometry.attributes.position.array;
    var col = confetti.geometry.attributes.color.array;
    var budget = Math.min(u.n, fxBudget());
    var c = new THREE.Color();
    for (var i = 0; i < u.n; i++) {
      var on = i < budget;
      p[i * 3] = (rand() - 0.5) * (boardCols + 2);
      p[i * 3 + 1] = on ? 2.5 + rand() * 2.5 : -10;
      p[i * 3 + 2] = (rand() - 0.5) * (boardRows + 2);
      u.vel[i * 3] = (rand() - 0.5) * 0.6;
      u.vel[i * 3 + 1] = -(0.5 + rand() * 0.9);
      u.vel[i * 3 + 2] = (rand() - 0.5) * 0.6;
      c.set(playerColors[(winnerIdx + (i % 2)) % playerColors.length]);
      if (rand() < 0.3) c.set(palette.paper || 0xf2ead8);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    u.life = 0;
    confetti.geometry.attributes.position.needsUpdate = true;
    confetti.geometry.attributes.color.needsUpdate = true;
    confetti.material.opacity = 1;
    confetti.visible = true;
  }

  function stepFx(dt) {
    for (var i = activeBursts.length - 1; i >= 0; i--) {
      var pts = activeBursts[i], u = pts.userData;
      u.life += dt;
      var p = pts.geometry.attributes.position.array;
      for (var j = 0; j < u.n; j++) {
        u.vel[j * 3 + 1] -= 4.5 * dt;
        p[j * 3] += u.vel[j * 3] * dt;
        p[j * 3 + 1] += u.vel[j * 3 + 1] * dt;
        p[j * 3 + 2] += u.vel[j * 3 + 2] * dt;
      }
      pts.geometry.attributes.position.needsUpdate = true;
      pts.material.opacity = clamp01(1 - u.life / u.dur);
      if (u.life >= u.dur) {
        pts.visible = false;
        activeBursts.splice(i, 1);
        if (burstPool.length < MAX_BURSTS) burstPool.push(pts);
      }
    }
    if (confetti && confetti.visible) {
      var cu = confetti.userData;
      cu.life += dt;
      var cp = confetti.geometry.attributes.position.array;
      for (var k = 0; k < cu.n; k++) {
        cp[k * 3] += cu.vel[k * 3] * dt + Math.sin(cu.life * 3 + k) * 0.15 * dt;
        cp[k * 3 + 1] += cu.vel[k * 3 + 1] * dt;
        cp[k * 3 + 2] += cu.vel[k * 3 + 2] * dt;
      }
      confetti.geometry.attributes.position.needsUpdate = true;
      confetti.material.opacity = clamp01(1.6 - cu.life * 0.45);
      if (cu.life > 4) confetti.visible = false;
    }
  }
  function clearFx() {
    for (var i = 0; i < activeBursts.length; i++) activeBursts[i].visible = false;
    activeBursts.length = 0;
    if (confetti) confetti.visible = false;
  }

  // ---------- preview / focus overlays ----------
  var ghost = null, ghostRing = null, focusRing = null;
  function ensureGhost() {
    if (ghost) return;
    var gmat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35,
      transparent: true, opacity: 0.7, roughness: 0.4
    });
    ghost = new THREE.Mesh(hEdgeGeo, gmat);
    ghost.visible = false;
    overlayGroup.add(ghost);
    var rmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    ghostRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 32), rmat);
    ghostRing.rotation.x = -Math.PI / 2;
    ghostRing.position.y = 0.006;
    ghostRing.visible = false;
    overlayGroup.add(ghostRing);
    var fmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    focusRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 32), fmat);
    focusRing.rotation.x = -Math.PI / 2;
    focusRing.position.y = 0.008;
    focusRing.visible = false;
    overlayGroup.add(focusRing);
  }

  function setPreview(dir, r, c, kind) {
    ensureGhost();
    if (dir === null || kind === null || kind === undefined) {
      ghost.visible = false;
      ghostRing.visible = false;
      return;
    }
    var color = PREVIEW_COLORS[kind] || PREVIEW_COLORS.ok;
    edgePos(dir, r, c, tmpV);
    ghost.geometry = dir === 'h' ? hEdgeGeo : vEdgeGeo;
    ghost.position.set(tmpV.x, EDGE_H / 2 + 0.05, tmpV.z);
    ghost.material.color.set(color);
    ghost.material.emissive.set(color);
    ghost.visible = true;
    ghostRing.position.x = tmpV.x;
    ghostRing.position.z = tmpV.z;
    ghostRing.material.color.set(color);
    ghostRing.visible = true;
  }

  function setFocusEdge(dir, r, c) {
    ensureGhost();
    if (dir === null) { focusRing.visible = false; return; }
    edgePos(dir, r, c, tmpV);
    focusRing.position.x = tmpV.x;
    focusRing.position.z = tmpV.z;
    focusRing.visible = true;
  }

  // ---------- turn indicator (desk-side strip) ----------
  var turnStrips = [];
  function ensureTurnStrips() {
    if (turnStrips.length === playerColors.length) return;
    turnStrips.forEach(function (s) { scene.remove(s); s.geometry.dispose(); });
    turnStrips = [];
    // One round "seat" token per player, centered on each side of the sheet:
    // player 0 near (south), then clockwise: west, north, east.
    var seats = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    for (var i = 0; i < playerColors.length; i++) {
      var strip = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), mats.turn[i]);
      strip.rotation.x = -Math.PI / 2;
      var dir = seats[i % seats.length];
      var rad = dir[0] !== 0 ? boardCols * 0.5 + 0.85 : boardRows * 0.5 + 0.85;
      strip.position.set(dir[0] * rad, 0.005, dir[1] * rad);
      scene.add(strip);
      turnStrips.push(strip);
    }
  }
  var turnTarget = 0, turnCurrent = -1;
  function setTurn(playerIdx) {
    ensureTurnStrips();
    turnTarget = playerIdx | 0;
  }
  function stepTurn(dt) {
    for (var i = 0; i < turnStrips.length; i++) {
      var mat = turnStrips[i].material;
      var goal = i === turnTarget ? 0.85 : 0;
      var next = mat.opacity + (goal - mat.opacity) * Math.min(1, dt * 8);
      if (Math.abs(next - goal) < 0.01) next = goal;
      mat.opacity = next;
    }
  }

  // ---------- camera ----------
  var camTarget = new THREE.Vector3(0, 0, 0);
  var camAnim = null; // {from:{pos,tgt}, to:{...}, t, dur}
  var driftT = 0;
  var userOrbit = { x: 0, y: 0 }; // slight drag orbit offset

  function authoredPose(out) {
    // Frame the sheet so it fills most of the viewport at any aspect:
    // required vertical span covers board depth, or board width/aspect.
    var aspect = Math.max(0.5, camera.aspect || 1);
    var vSpan = Math.max(boardRows * 1.4, (boardCols * 1.3) / aspect, 2.4);
    var dist = vSpan / (2 * Math.tan((FOV * Math.PI / 180) / 2));
    // Steep enough that far-row edges stay easy targets; steeper still on narrow viewports.
    var h = dist * (aspect < 1 ? 0.95 : 0.8);
    out.pos.set(0, h, dist);
    out.tgt.set(0, 0, Math.min(0.4, Math.max(boardRows, boardCols) * 0.04));
    return out;
  }
  var poseA = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  var poseB = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  function applyCamPose(pose) {
    camera.position.copy(pose.pos).add(tmpV.set(userOrbit.x, 0, userOrbit.y));
    camTarget.copy(pose.tgt);
    camera.lookAt(camTarget);
  }
  function fitCamera() {
    authoredPose(poseA);
    applyCamPose(poseA);
  }
  function resetCamera() {
    authoredPose(poseB);
    camAnim = {
      from: { pos: camera.position.clone(), tgt: camTarget.clone() },
      to: { pos: poseB.pos.clone(), tgt: poseB.tgt.clone() },
      t: 0, dur: reducedMotion ? 0.15 : RESET_EASE
    };
    userOrbit.x = 0; userOrbit.y = 0;
  }
  function startCamRise() {
    camAnim = {
      from: { pos: camera.position.clone(), tgt: camTarget.clone() },
      to: { pos: camera.position.clone().add(new THREE.Vector3(0, 1.6, 1.2)), tgt: camTarget.clone() },
      t: 0, dur: 2.2
    };
  }
  function stepCamera(dt) {
    if (camAnim) {
      camAnim.t += dt;
      var t = easeInOut(clamp01(camAnim.t / camAnim.dur));
      camera.position.lerpVectors(camAnim.from.pos, camAnim.to.pos, t);
      camTarget.lerpVectors(camAnim.from.tgt, camAnim.to.tgt, t);
      camera.position.add(tmpV.set(userOrbit.x, 0, userOrbit.y));
      camera.lookAt(camTarget);
      if (camAnim.t >= camAnim.dur) camAnim = null;
      return;
    }
    if (!reducedMotion && !document.hidden) {
      driftT += dt;
      var dx = Math.sin(driftT * Math.PI * 2 / CAM_DRIFT_PERIOD) * CAM_DRIFT_AMP;
      var dy = Math.cos(driftT * Math.PI * 2 / (CAM_DRIFT_PERIOD * 1.7)) * CAM_DRIFT_AMP * 0.4;
      authoredPose(poseA);
      poseA.pos.x += dx + userOrbit.x;
      poseA.pos.y += dy;
      poseA.pos.z += userOrbit.y;
      applyCamPoseNoOrbit(poseA);
    }
  }
  function applyCamPoseNoOrbit(pose) {
    camera.position.copy(pose.pos);
    camTarget.copy(pose.tgt);
    camera.lookAt(camTarget);
  }

  // ---------- picking ----------
  var raycaster = new THREE.Raycaster();
  raycaster.layers.set(LAYER_HIT);
  var ndc = new THREE.Vector2();
  var tmpV = new THREE.Vector3();
  var hoverEdge = null;
  var pointer = null; // {id, x0, y0, moved}

  function pickEdge(clientX, clientY) {
    var rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObjects(hitMeshes, false);
    return hits.length ? hits[0].object.userData.edge : null;
  }

  function onPointerDown(e) {
    if (disposed) return;
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    pointer = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
  }
  function onPointerMove(e) {
    if (disposed) return;
    if (pointer && e.pointerId === pointer.id) {
      var dx = e.clientX - pointer.x0, dy = e.clientY - pointer.y0;
      if (!pointer.moved && Math.sqrt(dx * dx + dy * dy) > TAP_DIST) pointer.moved = true;
      if (pointer.moved) {
        // slight drag orbit (clamped); not a pick
        userOrbit.x = THREE.MathUtils.clamp(-dx * 0.004, -0.8, 0.8);
        userOrbit.y = THREE.MathUtils.clamp(dy * 0.004, -0.8, 0.8);
        if (hoverEdge) { hoverEdge = null; onHover(null, -1, -1); }
        return;
      }
    }
    var edge = pickEdge(e.clientX, e.clientY);
    var changed = (edge === null) !== (hoverEdge === null) ||
      (edge && hoverEdge && (edge.dir !== hoverEdge.dir || edge.r !== hoverEdge.r || edge.c !== hoverEdge.c));
    if (changed) {
      hoverEdge = edge;
      if (edge) onHover(edge.dir, edge.r, edge.c);
      else onHover(null, -1, -1);
    }
  }
  function onPointerUp(e) {
    if (disposed) return;
    if (pointer && e.pointerId === pointer.id) {
      var wasTap = !pointer.moved;
      pointer = null;
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ }
      if (wasTap) {
        var edge = pickEdge(e.clientX, e.clientY);
        if (edge) onPick(edge.dir, edge.r, edge.c);
      }
    }
  }
  function onPointerCancel(e) {
    if (pointer && e.pointerId === pointer.id) pointer = null;
  }
  var el = renderer.domElement;
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerCancel);
  el.addEventListener('lostpointercapture', onPointerCancel);
  el.addEventListener('pointerleave', function () {
    if (!pointer && hoverEdge) { hoverEdge = null; onHover(null, -1, -1); }
  });

  // ---------- context loss ----------
  var contextLost = false;
  function onContextLost(e) { e.preventDefault(); contextLost = true; }
  function onContextRestored() {
    contextLost = false;
    // three re-creates GL state on next render; rebuild canvas textures
    buildEnv(boardRows, boardCols);
    applyQuality(qualityTier);
    resize();
  }
  el.addEventListener('webglcontextlost', onContextLost, false);
  el.addEventListener('webglcontextrestored', onContextRestored, false);

  // ---------- quality ----------
  function applyQuality(tier) {
    var q = QUALITY[tier] || QUALITY.medium;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    renderer.shadowMap.enabled = q.shadow;
    key.castShadow = q.shadow;
    if (q.shadow) {
      key.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      var ext = Math.max(boardRows, boardCols, 4) + 3;
      key.shadow.camera.left = -ext; key.shadow.camera.right = ext;
      key.shadow.camera.top = ext; key.shadow.camera.bottom = -ext;
      key.shadow.camera.far = 30;
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    }
    renderer.shadowMap.needsUpdate = true;
    resize();
  }

  function resize() {
    var w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!camAnim) fitCamera(); // re-frame for the new aspect
  }
  applyQuality(qualityTier);
  fitCamera();

  // ---------- main loop ----------
  var disposed = false;
  var rafId = 0;
  var lastT = 0;
  var running = false;

  function frame(t) {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);
    var dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0.016;
    lastT = t;
    if (document.hidden || contextLost) return;
    stepEvents(dt);
    stepFx(dt);
    stepCamera(dt);
    stepTurn(dt);
    renderer.render(scene, camera);
  }
  function startLoop() {
    if (running) return;
    running = true;
    lastT = 0;
    rafId = requestAnimationFrame(frame);
  }
  function onVisibility() {
    if (document.hidden) { lastT = 0; }
  }
  document.addEventListener('visibilitychange', onVisibility);
  startLoop();

  // ---------- dispose ----------
  function dispose() {
    disposed = true;
    cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', onVisibility);
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerCancel);
    el.removeEventListener('lostpointercapture', onPointerCancel);
    el.removeEventListener('webglcontextlost', onContextLost);
    el.removeEventListener('webglcontextrestored', onContextRestored);
    clearBoardMeshes();
    clearEnv();
    clearFx();
    [hEdgeGeo, vEdgeGeo, hHitGeo, vHitGeo, dotGeo, flapGeo, floorGeo].forEach(function (g) { g.dispose(); });
    stampGeos.forEach(function (g) { g.dispose(); });
    stampGeos = [];
    if (ghost) { ghost.material.dispose(); ghostRing.material.dispose(); ghostRing.geometry.dispose(); focusRing.material.dispose(); focusRing.geometry.dispose(); }
    turnStrips.forEach(function (s) { s.geometry.dispose(); });
    turnStrips = [];
    burstPool.forEach(function (p) { p.geometry.dispose(); p.material.dispose(); });
    burstPool = [];
    if (confetti) { confetti.geometry.dispose(); confetti.material.dispose(); confetti = null; }
    invisibleHitMat.dispose();
    Object.keys(mats).forEach(function (k) {
      var m = mats[k];
      if (Array.isArray(m)) m.forEach(function (x) { x.dispose(); });
      else m.dispose();
    });
    renderer.dispose();
    if (el.parentNode === host) host.removeChild(el);
  }

  // ---------- public API ----------
  return {
    canvas: el,
    setBoard: setBoard,
    syncState: syncState,
    animateEvents: animateEvents,
    skipAnimations: skipAnimations,
    isAnimating: isAnimating,
    setPreview: setPreview,
    setFocusEdge: setFocusEdge,
    setTurn: setTurn,
    setPalette: function (p, pc) {
      palette = p || palette;
      if (pc && pc.length) playerColors = pc.slice(0, 4);
      buildMaterials();
      buildEnv(boardRows, boardCols);
      ensureTurnStrips();
    },
    setQuality: function (tier) {
      if (!QUALITY[tier]) return;
      qualityTier = tier;
      applyQuality(tier);
    },
    setReducedMotion: function (b) {
      reducedMotion = !!b;
      if (reducedMotion) { driftT = 0; }
    },
    resetCamera: resetCamera,
    resize: resize,
    dispose: dispose
  };
}
