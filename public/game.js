// senet — bright cheery cozy 3D. Zaha Hadid flows + Frank Gehry crumples.
// three.js via CDN (the one pragmatic dependency: sculptural architecture
// wants a real renderer); everything else — server, rules, audio — is zero-dep.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  newGame, castSticks, legalMoves, applyMove, nextTurn, aiChooseMove,
  squareXZ, borneOff, EXTRA_TURNS,
} from "./rules.js";

const STEP = 1.14;
const TILE_TOP = 0;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- tiny synth audio ----------
const Audio8 = {
  ctx: null, on: true,
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
  },
  tone(freq, dur = 0.12, type = "sine", vol = 0.16, slide = 0) {
    if (!this.on) return; this.ensure();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur = 0.08, vol = 0.2, freq = 1800) {
    if (!this.on) return; this.ensure();
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.ctx.destination); src.start(t);
  },
  clack() { this.noise(0.07, 0.25, 2400); },
  hop(n) { this.tone(420 + n * 40, 0.09, "sine", 0.12); },
  swap() { this.tone(520, 0.1, "triangle", 0.14); setTimeout(() => this.tone(660, 0.12, "triangle", 0.14), 90); },
  splash() { this.tone(600, 0.35, "sine", 0.16, -450); this.noise(0.25, 0.1, 900); },
  bearoff() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, "triangle", 0.15), i * 110)); },
  win() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, "triangle", 0.16), i * 140)); },
  bad() { this.tone(220, 0.18, "sine", 0.1, -60); },
};

// ---------- renderer / scene ----------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd8f3ff, 30, 80);
// image-based lighting so the Gehry metals read as metal, not black
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

// gradient sky dome
{
  const c = document.createElement("canvas"); c.width = 4; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#8fd4ff"); grad.addColorStop(0.55, "#cdeaff"); grad.addColorStop(1, "#fff3d9");
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
  );
  scene.add(dome);
}

const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 14.5, 16.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.4, 0);
controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.minDistance = 8; controls.maxDistance = 42;
controls.maxPolarAngle = 1.38;
controls.autoRotate = !REDUCED; controls.autoRotateSpeed = 0.45;
let idleTimer = null;
controls.addEventListener("start", () => {
  controls.autoRotate = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!REDUCED) controls.autoRotate = true; }, 9000);
});

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0xcfeaff, 0xf7e0b8, 0.95));
const sun = new THREE.DirectionalLight(0xfff1cf, 2.0);
sun.position.set(12, 20, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
sun.shadow.camera.far = 60; sun.shadow.bias = -0.0004;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffe3ee, 0.5);
fill.position.set(-10, 8, -12); scene.add(fill);

// ---------- ground ----------
{
  const g = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshStandardMaterial({ color: 0xf6e3bd, roughness: 1 })
  );
  g.rotation.x = -Math.PI / 2; g.position.y = -2.6; g.receiveShadow = true;
  scene.add(g);
}

// ---------- HADID: flowing white dune + ribbons ----------
const hadidMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.05 });
{
  const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), hadidMat);
  dune.scale.set(11.5, 1.5, 6.4); dune.position.y = -2.2;
  dune.castShadow = dune.receiveShadow = true; scene.add(dune);

  const ribbon = (pts, r) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, r, 12, false), hadidMat);
    m.castShadow = m.receiveShadow = true; scene.add(m);
  };
  // sweeping shells arcing over the board's flanks, Heydar-Aliyev style
  ribbon([[-13, -1.4, -5], [-8, 1.6, -4.4], [-2, 2.6, -4.8], [5, 1.8, -4.2], [11, -0.6, -5.5]], 0.55);
  ribbon([[-12, -1.8, 5.2], [-6, 0.4, 5.6], [1, 1.4, 5.2], [8, 0.2, 5.8], [12.5, -1.6, 4.6]], 0.45);
  ribbon([[13.2, -1.2, -1], [14.2, 2.2, 0.5], [13.4, 4.6, 2.2]], 0.35);
}

// ---------- GEHRY: crumpled metallic sculptures ----------
function crumple(geo, amt, seed) {
  const pos = geo.attributes.position;
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const n = 1 + (rnd() - 0.5) * amt;
    v.multiplyScalar(n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
function gehryPiece(geo, color, x, z, ry = 0, sy = 1) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, metalness: 1.0, roughness: 0.3, flatShading: true,
  }));
  m.position.set(x, -0.6, z); m.rotation.y = ry; m.scale.y = sy;
  m.castShadow = m.receiveShadow = true; scene.add(m);
  return m;
}
gehryPiece(crumple(new THREE.IcosahedronGeometry(1.35, 2), 0.55, 12345), 0xe8b64c, -9.6, -3.4, 0.7); // gold fish-blob
gehryPiece(crumple(new THREE.IcosahedronGeometry(0.9, 2), 0.6, 777), 0xe8909c, 9.8, 4.6, 2.1);      // rose knot
{
  // tilted titanium tower on a plinth
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 2.2), hadidMat);
  plinth.position.set(10.6, -1.5, -4.2); plinth.castShadow = plinth.receiveShadow = true; scene.add(plinth);
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 4.6, 1.15),
    new THREE.MeshStandardMaterial({ color: 0xdfe5ea, metalness: 1, roughness: 0.32, flatShading: true })
  );
  tower.position.set(10.6, 0.9, -4.2); tower.rotation.z = 0.16; tower.rotation.y = 0.5;
  tower.castShadow = tower.receiveShadow = true; scene.add(tower);
}

// ---------- clouds ----------
const clouds = [];
{
  const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 });
  const spots = [[-18, 12, -14], [14, 14, -18], [-8, 15, 12], [20, 11, 10], [0, 16, -8]];
  for (const [cx, cy, cz] of spots) {
    const grp = new THREE.Group();
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1 + Math.random() * 1.2, 14, 12), cm);
      s.position.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 2.5);
      s.scale.y = 0.62; grp.add(s);
    }
    grp.position.set(cx, cy, cz);
    grp.userData.speed = 0.14 + Math.random() * 0.2;
    scene.add(grp); clouds.push(grp);
  }
}

// ---------- senet tiles ----------
function glyphTile(bg, draw) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(120,70,20,0.55)"; g.lineWidth = 10;
  g.strokeRect(14, 14, 228, 228);
  g.strokeStyle = "rgba(120,70,20,0.9)"; g.fillStyle = "rgba(120,70,20,0.9)"; g.lineWidth = 9;
  draw(g);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const SPECIAL = {
  15: { name: "House of Rebirth", bg: "#cfe8b8", draw(g) { // ankh
    g.beginPath(); g.arc(128, 88, 30, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(128, 118); g.lineTo(128, 210); g.moveTo(88, 150); g.lineTo(168, 150); g.stroke(); } },
  26: { name: "House of Beauty", bg: "#ffe9a8", draw(g) { // lotus
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.ellipse(128 + i * 26, 150, 16, 52, i * 0.28, 0, 7); g.stroke(); }
    g.beginPath(); g.moveTo(60, 200); g.lineTo(196, 200); g.stroke(); } },
  27: { name: "House of Water", bg: "#a8dcff", draw(g) { // waves
    for (let r = 0; r < 3; r++) { g.beginPath();
      for (let x = 56; x <= 200; x += 8) { const y = 100 + r * 44 + Math.sin(x / 18) * 12; x === 56 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke(); } } },
  28: { name: "House of Isis", bg: "#e3d4ff", draw(g) { // star
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 26 : 58;
      const x = 128 + Math.cos(a) * r, y = 150 + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.stroke(); } },
  29: { name: "House of Nephthys", bg: "#e3d4ff", draw(g) { // twin feathers
    for (const dx of [-30, 30]) { g.beginPath(); g.ellipse(128 + dx, 145, 20, 62, dx > 0 ? 0.2 : -0.2, 0, 7); g.stroke(); } } },
  30: { name: "House of Horus", bg: "#ffc46b", draw(g) { // sun disc
    g.beginPath(); g.arc(128, 148, 44, 0, 7); g.stroke();
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6;
      g.beginPath(); g.moveTo(128 + Math.cos(a) * 58, 148 + Math.sin(a) * 58);
      g.lineTo(128 + Math.cos(a) * 78, 148 + Math.sin(a) * 78); g.stroke(); } } },
};
const tileMeshes = {};
{
  const geo = new THREE.BoxGeometry(1, 0.35, 1);
  for (let s = 1; s <= 30; s++) {
    const { x, z } = squareXZ(s, STEP);
    let mat;
    if (SPECIAL[s]) {
      const tex = glyphTile(SPECIAL[s].bg, SPECIAL[s].draw);
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: s % 2 ? 0xfff6e2 : 0xffdfae, roughness: 0.6 });
    }
    const t = new THREE.Mesh(geo, mat);
    t.position.set(x, -0.175, z);
    t.castShadow = t.receiveShadow = true;
    t.userData.square = s;
    scene.add(t); tileMeshes[s] = t;
    // square number, etched small in the corner
    const nc = document.createElement("canvas"); nc.width = nc.height = 64;
    const ng = nc.getContext("2d");
    ng.fillStyle = "rgba(120,70,20,0.6)"; ng.font = "bold 30px sans-serif"; ng.textAlign = "center";
    ng.fillText(String(s), 32, 40);
    const nt = new THREE.CanvasTexture(nc);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ map: nt, transparent: true }));
    num.rotation.x = -Math.PI / 2; num.position.set(x - 0.32, 0.006, z - 0.32);
    scene.add(num);
  }
}

// ---------- pawns ----------
function pawnGeometry() {
  const pts = [
    [0.001, 0], [0.30, 0], [0.30, 0.06], [0.17, 0.12], [0.15, 0.34],
    [0.21, 0.48], [0.15, 0.60], [0.09, 0.70], [0.12, 0.80], [0.001, 0.94],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 26);
}
const pawnGeo = pawnGeometry();
const pawnMats = {
  gold: new THREE.MeshStandardMaterial({ color: 0xf5b301, roughness: 0.28, metalness: 0.45 }),
  coral: new THREE.MeshStandardMaterial({ color: 0xff6f61, roughness: 0.28, metalness: 0.45 }),
};
const ringGeo = new THREE.TorusGeometry(0.44, 0.055, 10, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });

// ---------- casting sticks ----------
const stickGeo = new THREE.BoxGeometry(1.0, 0.14, 0.2);
const stickSide = new THREE.MeshStandardMaterial({ color: 0xb98a4e, roughness: 0.7 });
const stickLight = new THREE.MeshStandardMaterial({ color: 0xfff3d6, roughness: 0.5 });
const stickDark = new THREE.MeshStandardMaterial({ color: 0x4a2f18, roughness: 0.5 });
const stickMats = [stickSide, stickSide, stickLight, stickDark, stickSide, stickSide];
const sticks = [];
const matY = 0.62; // casting mat top
{
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.5, 28),
    new THREE.MeshStandardMaterial({ color: 0xd98e4a, roughness: 0.8 }));
  mat.position.set(8.6, matY - 0.25, 3.4); mat.castShadow = mat.receiveShadow = true; scene.add(mat);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.12, 10, 40),
    new THREE.MeshStandardMaterial({ color: 0xfff6e2, roughness: 0.5 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(8.6, matY, 3.4); rim.castShadow = true; scene.add(rim);
  for (let i = 0; i < 4; i++) {
    const st = new THREE.Mesh(stickGeo, stickMats);
    st.position.set(8.6 + (Math.random() - 0.5), matY + 0.1, 3.4 + (Math.random() - 0.5));
    st.rotation.y = Math.random() * Math.PI;
    st.castShadow = true; scene.add(st); sticks.push(st);
  }
}

// ---------- UI refs ----------
const $ = (id) => document.getElementById(id);
const banner = $("turn-banner"), castBtn = $("btn-cast"), tray = $("sticks-tray"), hint = $("hint");
const toastEl = $("toast");
let toastTimer = null;
function toast(msg, ms = 2400) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}
function setBanner(t) { banner.textContent = t; }
function updateScores() {
  $("score-gold").textContent = `You · ${borneOff(game, "gold")} off`;
  $("score-coral").textContent = `Rival · ${borneOff(game, "coral")} off`;
}

// ---------- game state ----------
let game = newGame();
let phase = "idle"; // idle | casting | choose | animating | over
let pawnMeshes = []; // index-aligned with game.pawns
let rings = [];
let currentMoves = [];
let tweens = [];

function pawnHome(idx) {
  const sq = game.pawns[idx].square;
  const { x, z } = squareXZ(sq, STEP);
  return new THREE.Vector3(x, TILE_TOP, z);
}
function buildPawns() {
  for (const m of pawnMeshes) scene.remove(m);
  for (const r of rings) scene.remove(r);
  pawnMeshes = []; rings = [];
  game.pawns.forEach((p, i) => {
    const m = new THREE.Mesh(pawnGeo, pawnMats[p.player].clone());
    m.position.copy(pawnHome(i)); m.castShadow = true;
    m.userData.pawnIndex = i;
    scene.add(m); pawnMeshes.push(m);
    const ring = new THREE.Mesh(ringGeo, ringMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pawnHome(i)); ring.position.y = 0.03;
    ring.visible = false; scene.add(ring); rings.push(ring);
  });
}
buildPawns();

// ---------- tween engine ----------
function tween(obj, to, dur, opts = {}) {
  return new Promise((res) => {
    tweens.push({
      obj, from: obj.position.clone(), to: to.clone(), t: 0, dur,
      arc: opts.arc || 0, onDone: () => { obj.position.copy(to); res(); },
    });
  });
}
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
    tw.obj.position.lerpVectors(tw.from, tw.to, e);
    if (tw.arc) tw.obj.position.y += Math.sin(k * Math.PI) * tw.arc;
    if (k >= 1) { tweens.splice(i, 1); tw.onDone(); }
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, REDUCED ? Math.min(ms, 60) : ms));

// ---------- confetti ----------
let confetti = null;
function burstConfetti() {
  if (REDUCED) return;
  const N = 160;
  const geo = new THREE.PlaneGeometry(0.22, 0.32);
  const colors = [0xf5b301, 0xff6f61, 0x2ec4b6, 0xffffff, 0xff9f1c];
  const mat = new THREE.MeshBasicMaterial({ vertexColors: false, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(geo, mat, N);
  const parts = [];
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    parts.push({
      p: new THREE.Vector3((Math.random() - 0.5) * 10, 4 + Math.random() * 4, (Math.random() - 0.5) * 8),
      v: new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6),
      rx: Math.random() * 6, rz: Math.random() * 6,
    });
    dummy.position.copy(parts[i].p); dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.setColorAt(i, col.setHex(colors[i % colors.length]));
  }
  scene.add(inst);
  confetti = { inst, parts, dummy, t: 0 };
}
function stepConfetti(dt) {
  if (!confetti) return;
  confetti.t += dt;
  const { inst, parts, dummy } = confetti;
  let alive = false;
  for (let i = 0; i < parts.length; i++) {
    const pt = parts[i];
    pt.v.y -= 9 * dt; pt.p.addScaledVector(pt.v, dt);
    pt.rx += dt * 5; pt.rz += dt * 4;
    if (pt.p.y > -2.4) alive = true;
    dummy.position.copy(pt.p); dummy.rotation.set(pt.rx, 0, pt.rz); dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (!alive || confetti.t > 6) { scene.remove(inst); confetti = null; }
}

// ---------- turn flow ----------
function renderTray(faces, value) {
  tray.innerHTML = "";
  faces.forEach((light) => {
    const s = document.createElement("span");
    s.className = "lot " + (light ? "light" : "dark");
    tray.appendChild(s);
  });
  const eq = document.createElement("b");
  eq.textContent = "= " + value;
  eq.style.marginLeft = "6px";
  tray.appendChild(eq);
}
// lot styles injected once
{
  const st = document.createElement("style");
  st.textContent = `.lot{width:20px;height:20px;border-radius:999px;display:inline-block;box-shadow:inset 0 -2px 4px rgba(0,0,0,.25)}.lot.light{background:#fff3d6;border:2px solid #e8b64c}.lot.dark{background:#4a2f18;border:2px solid #2c1c0e}`;
  document.head.appendChild(st);
}

function highlightMoves(moves) {
  currentMoves = moves;
  const idxs = new Set(moves.map((m) => m.pawn));
  pawnMeshes.forEach((m, i) => {
    const on = idxs.has(i) && game.pawns[i].square !== 0;
    rings[i].visible = on;
    m.material.emissive = new THREE.Color(on ? 0x664d00 : 0x000000);
    m.material.emissiveIntensity = on ? 0.9 : 0;
  });
}
function clearHighlight() {
  currentMoves = [];
  rings.forEach((r) => (r.visible = false));
  pawnMeshes.forEach((m) => { m.material.emissive = new THREE.Color(0x000000); });
}

async function animateStickCast(faces) {
  if (REDUCED) { Audio8.clack(); return; }
  const anims = sticks.map((st, i) => {
    const targetX = faces[i] ? Math.round(st.rotation.x / (Math.PI * 2)) * Math.PI * 2
                             : Math.round((st.rotation.x - Math.PI) / (Math.PI * 2)) * Math.PI * 2 + Math.PI;
    return { st, i, t: 0, dur: 0.9 + i * 0.12,
      spin: 8 + Math.random() * 10, targetX,
      y0: matY + 0.1, peak: 2.2 + Math.random() * 1.6,
      x0: st.position.x, z0: st.position.z,
      dx: (Math.random() - 0.5) * 1.6, dz: (Math.random() - 0.5) * 1.6 };
  });
  Audio8.noise(0.3, 0.12, 3000);
  await new Promise((res) => {
    const start = performance.now();
    (function frame(now) {
      const done = anims.every((a) => {
        a.t = Math.min(1, (now - start) / 1000 / a.dur);
        const k = a.t;
        a.st.position.y = a.y0 + Math.sin(k * Math.PI) * a.peak;
        a.st.position.x = a.x0 + a.dx * k;
        a.st.position.z = a.z0 + a.dz * k;
        a.st.rotation.x += a.spin * 0.016 * (1 - k * 0.7);
        a.st.rotation.y += a.spin * 0.011 * (1 - k * 0.7);
        if (k >= 1) {
          a.st.rotation.x += (a.targetX - a.st.rotation.x) * 0.35;
          a.st.position.y = a.y0;
          return Math.abs(a.targetX - a.st.rotation.x) < 0.05;
        }
        return false;
      });
      if (done) { anims.forEach((a) => { a.st.rotation.x = a.targetX; a.st.position.y = a.y0; }); Audio8.clack(); res(); }
      else requestAnimationFrame(frame);
    })(start);
  });
}

async function doCast() {
  if (phase !== "idle") return;
  phase = "casting";
  castBtn.disabled = true;
  Audio8.ensure();
  const { faces, value } = castSticks();
  game.lastThrow = value;
  setBanner(`${game.turn === "gold" ? "You cast" : "Rival casts"}…`);
  await animateStickCast(faces);
  renderTray(faces, value);
  if (EXTRA_TURNS.has(value)) toast(value === 5 ? "Five! The gods grant another throw ✨" : `A ${value}! Throw again ✨`);
  await wait(650);
  const moves = legalMoves(game, game.turn, value);
  if (!moves.length) {
    setBanner("No path forward — the turn passes");
    toast("No legal move. The turn passes.");
    Audio8.bad();
    await wait(1400);
    return endTurn(value);
  }
  if (game.turn === "gold") {
    phase = "choose";
    setBanner(`You threw ${value} — choose a glowing pawn`);
    hint.textContent = "Tap a glowing pawn to move it";
    highlightMoves(moves);
  } else {
    phase = "animating";
    setBanner(`Rival threw ${value}`);
    await wait(700);
    const m = aiChooseMove(game, "coral", value);
    await resolveMove(m, value);
  }
}

async function hopPawn(idx, from, to) {
  const mesh = pawnMeshes[idx];
  for (let s = from + 1; s <= to; s++) {
    const { x, z } = squareXZ(s, STEP);
    Audio8.hop(s - from);
    await tween(mesh, new THREE.Vector3(x, TILE_TOP, z), REDUCED ? 0.05 : 0.17, { arc: 0.55 });
  }
}

async function resolveMove(move, value) {
  phase = "animating";
  clearHighlight();
  const events = applyMove(game, move);
  const mover = pawnMeshes[move.pawn];

  for (const ev of events) {
    if (ev.t === "move") {
      if (move.to === WATER) {
        // dramatic flight to the water, then rebirth
        await hopPawn(move.pawn, move.from, WATER);
        Audio8.splash();
        toast("Splash! The House of Water claims a pawn 🌊");
        const { x, z } = squareXZ(15, STEP);
        await tween(mover, new THREE.Vector3(x, TILE_TOP, z), REDUCED ? 0.05 : 0.7, { arc: 3.2 });
      } else if (move.bearsOff) {
        await hopPawn(move.pawn, move.from, LAST);
        Audio8.bearoff();
        toast(`${ev.player === "gold" ? "Your" : "Rival's"} pawn ascends! ☀️`);
        // rise into the light
        const up = mover.position.clone(); up.y += 4;
        const sc = { s: 1 };
        await new Promise((res) => {
          const start = performance.now();
          (function f(now) {
            const k = Math.min(1, (now - start) / 800);
            mover.position.lerpVectors(mover.position.clone(), up, 0.06);
            mover.position.y += 0.06;
            const ns = 1 - k * 0.9; mover.scale.setScalar(Math.max(0.05, ns));
            mover.rotation.y += 0.1;
            k >= 1 ? res() : requestAnimationFrame(f);
          })(start);
        });
        mover.visible = false;
      } else {
        await hopPawn(move.pawn, move.from, move.to);
      }
    } else if (ev.t === "swap") {
      Audio8.swap();
      const other = pawnMeshes[ev.pawn];
      const { x, z } = squareXZ(ev.to, STEP);
      await tween(other, new THREE.Vector3(x, TILE_TOP, z), REDUCED ? 0.05 : 0.4, { arc: 1.2 });
      if (move.to !== WATER) toast("Swap! Places traded 🔄");
    }
  }
  updateScores();
  const winEv = events.find((e) => e.t === "win");
  if (winEv) return gameOver(winEv.player);
  await wait(500);
  return endTurn(value);
}

function endTurn(value) {
  const n = nextTurn(game, value);
  updateScores();
  if (n === "gold") {
    phase = "idle";
    castBtn.disabled = false;
    setBanner(game.extraTurn ? "Another throw is yours ✨" : "Your turn — cast the sticks");
    hint.textContent = "Drag to orbit · scroll to zoom";
  } else {
    phase = "idle"; // doCast re-arms via timeout
    castBtn.disabled = true;
    setBanner("Rival's turn…");
    setTimeout(() => { if (phase === "idle" && game.turn === "coral" && !game.winner) doCast(); }, 900);
  }
}

function gameOver(winner) {
  phase = "over";
  clearHighlight();
  castBtn.disabled = true;
  if (winner === "gold") { Audio8.win(); burstConfetti(); }
  else Audio8.bad();
  setBanner(winner === "gold" ? "Victory!" : "Rival prevails");
  setTimeout(() => {
    $("win-title").textContent = winner === "gold" ? "You win! 🎉" : "Rival wins 🏺";
    $("win-sub").textContent = winner === "gold"
      ? "All five pawns crossed the Duat. The gods applaud your journey."
      : "The rival's pawns reached the Field of Reeds first. A rematch awaits.";
    $("win-modal").hidden = false;
  }, REDUCED ? 200 : 1400);
}

function resetGame() {
  game = newGame();
  phase = "idle";
  tray.innerHTML = "";
  buildPawns();
  updateScores();
  castBtn.disabled = false;
  $("win-modal").hidden = true;
  setBanner("Cast the sticks to begin");
}

// ---------- picking ----------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let downAt = 0;
renderer.domElement.addEventListener("pointerdown", () => { downAt = performance.now(); });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (performance.now() - downAt > 350) return; // it was a drag, not a tap
  if (phase !== "choose") return;
  ptr.x = (e.clientX / innerWidth) * 2 - 1;
  ptr.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects(pawnMeshes.filter((m) => m.visible));
  if (!hits.length) return;
  const idx = hits[0].object.userData.pawnIndex;
  const m = currentMoves.find((mv) => mv.pawn === idx);
  if (!m) { toast("That pawn can't move the " + game.lastThrow + "."); Audio8.bad(); return; }
  Audio8.ensure();
  resolveMove(m, game.lastThrow);
});

// ---------- UI wiring ----------
castBtn.addEventListener("click", () => { Audio8.ensure(); doCast(); });
$("btn-new").addEventListener("click", () => { resetGame(); toast("A fresh journey begins 🌅"); });
$("btn-again").addEventListener("click", resetGame);
$("btn-rules").addEventListener("click", () => { $("rules-modal").hidden = false; });
$("btn-close-rules").addEventListener("click", () => { $("rules-modal").hidden = true; });
$("rules-modal").addEventListener("click", (e) => { if (e.target.id === "rules-modal") $("rules-modal").hidden = true; });
$("btn-sound").addEventListener("click", (e) => {
  Audio8.on = !Audio8.on;
  e.currentTarget.textContent = Audio8.on ? "🔊" : "🔇";
});

// ---------- main loop ----------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  stepTweens(dt);
  stepConfetti(dt);
  if (!REDUCED) {
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 34) c.position.x = -34;
    }
    // breathing glow on selectable rings
    const s = 1 + Math.sin(t * 5) * 0.08;
    for (const r of rings) if (r.visible) r.scale.setScalar(s);
  }
  controls.update();
  renderer.render(scene, camera);
}
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
updateScores();
loop();
