/* Délice — V3 « La maquette du réseau »
   Maquette 3D de la vallée de la Durance : on la survole en faisant défiler,
   un clic sur une boutique fait plonger la caméra sur sa façade. */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { HorizontalTiltShiftShader } from "three/addons/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/addons/shaders/VerticalTiltShiftShader.js";

const survol = document.querySelector("[data-survol]");
const DATA = JSON.parse(document.getElementById("donnees").textContent);
const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = matchMedia("(max-width: 760px)").matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeIO = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---- Géographie : projection simple (1 unité ≈ 1 km) ---------------------- */
const geo = (lat, lon) => [(lon - 6.0) * 80, -(lat - 44.2) * 111];

const VILLES = {
  manosque: { r: 4.2, h: .55 }, digne: { r: 3.6, h: .85 }, gap: { r: 5.2, h: 1.25 },
};
for (const k in VILLES) { const v = DATA.villes[k]; [VILLES[k].x, VILLES[k].z] = geo(v.lat, v.lon); VILLES[k].nom = v.nom; }
const SISTERON = { x: -4.4, z: .55, r: 1.6, h: .7 };
const LIEUX = [...Object.values(VILLES), SISTERON];

const DURANCE = [[21, -31], [12, -30], [4, -28.5], [0.5, -20], [-3, -10], [-4.4, .5], [-.8, 12.2], [-1.6, 18.9],
  [-6, 28], [-9.5, 35], [-11.2, 41.5], [-14, 50], [-18.5, 60], [-22, 72]];
const BLEONE = [[18.9, 12], [12, 13], [5, 12.5], [-.8, 12.2]];
const A51 = [[-17.1, 40.7], [-14.5, 33], [-9, 25], [-4.5, 17], [-3.2, 13], [-6.2, 4], [-4.4, .55], [-2.5, -12], [1, -22], [4.5, -29], [6.3, -39.8]];
const RN85 = [[-3.2, 13], [4, 10.4], [12, 10.6], [18.9, 12]];
const LAC = { x: 27, z: -35, rx: 7.5, rz: 2.2, a: -.12, niveau: 1.15 };
const VALENSOLE = { x: 1, z: 38, rx: 9, rz: 6.5 };

/* ---- Bruit (déterministe) -------------------------------------------------- */
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) { let s = 0, amp = .5, f = 1; for (let i = 0; i < 5; i++) { s += amp * vnoise(x * f, z * f); f *= 2.03; amp *= .5; } return s; }
function ridged(x, z) { let s = 0, amp = .5, f = 1; for (let i = 0; i < 4; i++) { const n = 1 - Math.abs(vnoise(x * f + 9, z * f + 4) * 2 - 1); s += amp * n * n; f *= 2.1; amp *= .5; } return s; }
let graine = 7;
const rnd = () => { graine = (graine * 16807) % 2147483647; return (graine - 1) / 2147483646; };

/* ---- Distance aux rivières (champ précalculé) ----------------------------- */
function echantillons(pts, pas = .5) {
  const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  return c.getSpacedPoints(Math.ceil(c.getLength() / pas)).map((p) => [p.x, p.z]);
}
const RIV = [...echantillons(DURANCE), ...echantillons(BLEONE)];
const CH = { x0: -52, z0: -68, pas: 1, nx: 116, nz: 150 };
const champ = new Float32Array(CH.nx * CH.nz);
for (let j = 0; j < CH.nz; j++) for (let i = 0; i < CH.nx; i++) {
  const x = CH.x0 + i * CH.pas, z = CH.z0 + j * CH.pas; let m = 1e9;
  for (const [rx, rz] of RIV) { const d = (x - rx) ** 2 + (z - rz) ** 2; if (d < m) m = d; }
  champ[j * CH.nx + i] = Math.sqrt(m);
}
function distRiviere(x, z) {
  const fx = clamp((x - CH.x0) / CH.pas, 0, CH.nx - 1.001), fz = clamp((z - CH.z0) / CH.pas, 0, CH.nz - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * CH.nx + i;
  return mix(mix(champ[k], champ[k + 1], u), mix(champ[k + CH.nx], champ[k + CH.nx + 1], u), v);
}
function dansLac(x, z) {
  const c = Math.cos(LAC.a), s = Math.sin(LAC.a), dx = x - LAC.x, dz = z - LAC.z;
  return Math.hypot((dx * c - dz * s) / LAC.rx, (dx * s + dz * c) / LAC.rz);
}

/* ---- Relief ------------------------------------------------------------------ */
function hauteur(x, z) {
  const n = fbm(x * .035 + 3.1, z * .035 + 7.7);
  const nord = smooth(28, -62, z), est = smooth(-25, 48, x);
  const m = clamp(.12 + .95 * nord * (.5 + .5 * est) + .45 * est * smooth(42, -5, z));
  let h = .45 + Math.pow(n, 1.6) * (2.4 + 12 * m) + ridged(x * .055, z * .055) * 9 * m * m;
  const lit = .22 + Math.max(0, -z) * .011;                 // le lit remonte vers le nord
  h = lit + (h - lit) * smooth(.7, 7.5, distRiviere(x, z));
  const dv = Math.hypot((x - VALENSOLE.x) / VALENSOLE.rx, (z - VALENSOLE.z) / VALENSOLE.rz);
  h = mix(h, 1.45 + n * .3, smooth(1.25, .85, dv));          // plateau de Valensole
  const dl = dansLac(x, z);
  h = mix(h, Math.min(h, LAC.niveau - .35), smooth(1.25, .95, dl));
  for (const v of LIEUX) {
    h = mix(h, v.h, smooth(v.r + 4.5, v.r, Math.hypot(x - v.x, z - v.z)));
  }
  return h;
}

/* ---- Rendu -------------------------------------------------------------------- */
const canvas = survol.querySelector("[data-canvas]");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch (err) {
  document.documentElement.classList.add("sans-3d");
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, .1, 900);
const chargeur = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(chargeur);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

/* Ambiance selon l'heure réelle (jour, soir, nuit), comme le ciel de la V2 */
const heure = new Date().getHours();
const MOMENT = heure >= 7 && heure < 17 ? "jour" : heure >= 17 && heure < 20 ? "soir" : "nuit";
const AMB = {
  jour: { zen: "#5c9bdb", hor: "#d7e8f3", soleil: "#fff1dc", is: 2.7, ciel: "#d8ecff", sol: "#8d7b5c", ih: 1.05, dir: [-.55, 1, .8], expo: 1.05, vitrine: 0 },
  soir: { zen: "#3f4f8a", hor: "#f3b383", soleil: "#ffb36e", is: 2.4, ciel: "#ffd8b8", sol: "#6a5440", ih: .85, dir: [-1, .5, .55], expo: 1.1, vitrine: .35 },
  nuit: { zen: "#0a1430", hor: "#3b4d7c", soleil: "#a9bcff", is: .9, ciel: "#5b6ea8", sol: "#22202c", ih: .75, dir: [.4, 1, .7], expo: 1.25, vitrine: .95 },
}[MOMENT];
renderer.toneMappingExposure = AMB.expo;

function degrade(zen, hor) {
  const c = document.createElement("canvas"); c.width = 2; c.height = 256;
  const g = c.getContext("2d"), lg = g.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0, zen); lg.addColorStop(.62, hor); lg.addColorStop(1, hor);
  g.fillStyle = lg; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
scene.background = degrade(AMB.zen, AMB.hor);
scene.fog = new THREE.Fog(AMB.hor, 60, 300);

const hemi = new THREE.HemisphereLight(AMB.ciel, AMB.sol, AMB.ih);
scene.add(hemi);
const soleil = new THREE.DirectionalLight(AMB.soleil, AMB.is);
const DIR_SOLEIL = new THREE.Vector3(...AMB.dir).normalize();
soleil.castShadow = true;
soleil.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
soleil.shadow.bias = -.0004;
soleil.shadow.normalBias = .02;
scene.add(soleil, soleil.target);

/* ---- Terrain -------------------------------------------------------------------- */
const T = { x: 4, z: 3, w: 112, d: 146 };
{
  const geom = new THREE.PlaneGeometry(T.w, T.d, mobile ? 150 : 230, mobile ? 196 : 300);
  geom.rotateX(-Math.PI / 2);
  geom.translate(T.x, 0, T.z);
  const pos = geom.attributes.position, col = new Float32Array(pos.count * 3);
  const C = {
    pre: new THREE.Color("#b6b77a"), champ: new THREE.Color("#d2bf82"), foret: new THREE.Color("#5f7d48"),
    foret2: new THREE.Color("#4b6a3c"), roche: new THREE.Color("#9a9184"), neige: new THREE.Color("#f2f3f4"),
    ville: new THREE.Color("#cfc6b5"), lavande: new THREE.Color("#a98fc4"), berge: new THREE.Color("#c9c19f"),
  };
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = hauteur(x, z);
    pos.setY(i, h);
    const n2 = fbm(x * .18 + 40, z * .18 - 12);
    c.copy(C.pre).lerp(C.champ, smooth(.5, .65, n2) * .8);
    c.lerp(n2 > .5 ? C.foret : C.foret2, smooth(1.3, 3.2, h) * (.55 + .45 * fbm(x * .3, z * .3)));
    c.lerp(C.roche, smooth(6.5, 9.5, h));
    c.lerp(C.neige, smooth(10.5, 12.5, h + fbm(x * .4, z * .4) * 1.5));
    c.lerp(C.berge, smooth(1.6, .7, distRiviere(x, z)) * .7);
    for (const v of LIEUX) c.lerp(C.ville, smooth(v.r + 1, v.r - .6, Math.hypot(x - v.x, z - v.z)) * .85);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geom.computeVertexNormals();
  const terrain = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0 }));
  terrain.receiveShadow = true; terrain.castShadow = true;
  scene.add(terrain);
  // Socle de la maquette (tranche du terrain)
  const socle = new THREE.Mesh(new THREE.BoxGeometry(T.w, 3, T.d), new THREE.MeshStandardMaterial({ color: "#6b5a46", roughness: 1 }));
  socle.position.set(T.x, -1.48, T.z);
  scene.add(socle);
}

/* ---- Rubans : rivières et routes ------------------------------------------------- */
function ruban(pts, largeur, elev, mat, pas = .35) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const n = Math.ceil(curve.getLength() / pas), P = curve.getSpacedPoints(n);
  const v = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
    for (const s of [-1, 1]) {
      const x = P[i].x + nx * s * largeur / 2, z = P[i].z + nz * s * largeur / 2;
      v.push(x, hauteur(x, z) + elev, z);
    }
    if (i < n) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
  return curve;
}
const eau = new THREE.MeshStandardMaterial({ color: "#4f98c4", roughness: .18, metalness: .15, emissive: "#0e2a40", emissiveIntensity: MOMENT === "nuit" ? .6 : .15 });
ruban(DURANCE, .85, .05, eau);
ruban(BLEONE, .45, .05, eau);
const goudron = new THREE.MeshStandardMaterial({ color: "#8e8a83", roughness: .9 });
const routeA51 = ruban(A51, .34, .09, goudron, .3);
const routeRN85 = ruban(RN85, .26, .09, goudron, .3);
{ // Lac de Serre-Ponçon
  const forme = new THREE.Shape(), N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N * Math.PI * 2, wob = 1 + .12 * Math.sin(t * 3) + .08 * Math.sin(t * 7 + 1);
    const lx = Math.cos(t) * LAC.rx * 1.02 * wob, lz = Math.sin(t) * LAC.rz * 1.05 * wob;
    const c = Math.cos(-LAC.a), s = Math.sin(-LAC.a);
    const x = LAC.x + lx * c - lz * s, z = LAC.z + lx * s + lz * c;
    i ? forme.lineTo(x, -z) : forme.moveTo(x, -z);
  }
  const g = new THREE.ShapeGeometry(forme); g.rotateX(-Math.PI / 2);
  const lac = new THREE.Mesh(g, eau); lac.position.y = LAC.niveau - .12; lac.receiveShadow = true;
  scene.add(lac);
}

/* ---- Champs de lavande du plateau de Valensole ----------------------------------- */
{
  const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, .5, 0);
  const rangs = [], blé = [];
  for (let f = 0; f < 14; f++) {
    const fx = VALENSOLE.x + (rnd() - .5) * VALENSOLE.rx * 1.3, fz = VALENSOLE.z + (rnd() - .5) * VALENSOLE.rz * 1.2;
    const ang = (rnd() - .5) * .6, lav = rnd() > .35, L = 2 + rnd() * 1.6, nb = 7 + Math.floor(rnd() * 5);
    for (let r = 0; r < nb; r++) {
      const off = (r - nb / 2) * .2;
      const x = fx + Math.cos(ang) * off, z = fz - Math.sin(ang) * off;
      (lav ? rangs : blé).push([x, z, ang + Math.PI / 2, L]);
    }
  }
  const poser = (liste, couleur, haut) => {
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: couleur, roughness: 1 }), liste.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    liste.forEach(([x, z, a, L], i) => {
      q.setFromAxisAngle(up, a);
      m4.compose(new THREE.Vector3(x, hauteur(x, z) - .01, z), q, new THREE.Vector3(.11, haut, L));
      im.setMatrixAt(i, m4);
    });
    im.receiveShadow = true; scene.add(im);
  };
  poser(rangs, "#8e6fc0", .09);
  poser(blé, "#d9bf6a", .05);
}

/* ---- Textures dessinées ------------------------------------------------------------- */
function toile(w, h, dessin) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  dessin(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; return t;
}
/* ---- Villes : maisons provençales ------------------------------------------------- */
const ZONES_LIBRES = [];  // emprises des boutiques (pour ne pas y poser de maison)
const PLAN = {
  "delice-market-manosque": { dx: 2.7, dz: 1.3, w: 2.6, d: 1.9, etage: 0, parking: true },
  "delice-primeur-manosque": { dx: -.4, dz: 2.3, w: 1.5, d: 1.0, etage: 1 },
  "boucherie-delice-manosque": { dx: -2.8, dz: .9, w: 1.5, d: 1.0, etage: 1 },
  "delice-boucherie-digne": { dx: .3, dz: 1.5, w: 1.5, d: 1.0, etage: 1 },
  "delice-market-gap": { dx: .6, dz: 1.4, w: 3.2, d: 2.3, etage: 0, parking: true },
};
for (const b of DATA.boutiques) {
  const p = PLAN[b.slug], v = VILLES[b.ville];
  p.x = v.x + p.dx; p.z = v.z + p.dz;
  ZONES_LIBRES.push([p.x, p.z, p.w / 2 + .45, p.d / 2 + (p.parking ? 2.2 : .6)]);
}
// Devant les boutiques : une rue dégagée, pour que rien ne cache les façades depuis la caméra
const RUES = {};
for (const k of Object.keys(VILLES)) {
  const l = DATA.boutiques.filter((b) => b.ville === k).map((b) => PLAN[b.slug]);
  RUES[k] = {
    x0: Math.min(...l.map((p) => p.x - p.w / 2)) - 1.3, x1: Math.max(...l.map((p) => p.x + p.w / 2)) + 1.3,
    zDos: Math.min(...l.map((p) => p.z - p.d / 2)) - .25,
    zRue: Math.max(...l.map((p) => p.z + p.d / 2 + (p.parking ? 1.95 : .5))) + .3,
  };
}
const libre = (x, z) => ZONES_LIBRES.every(([cx, cz, hw, hd]) => Math.abs(x - cx) > hw || Math.abs(z - (cz + (hd > 1.5 ? .9 : 0))) > hd)
  && Object.values(RUES).every((r) => x < r.x0 || x > r.x1 || z < r.zDos || z > r.zRue + 2.2);
{
  const corps = [], toits = [];
  const MURS = ["#efe4d0", "#e8cfa4", "#f1ece2", "#e6c7b0", "#e9dcc0", "#dcc9a6"];
  const TUILES = ["#c4683f", "#b85b36", "#cf7a4c", "#a9532f"];
  const semer = (v, nb, rayon) => {
    let essais = 0;
    for (let k = 0; k < nb && essais < nb * 12; essais++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), .7) * rayon;
      const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
      if (!libre(x, z) || distRiviere(x, z) < 1) continue;
      const w = .32 + rnd() * .3, dd = .3 + rnd() * .28, hh = .26 + rnd() * .3 * (1 - d / rayon * .5);
      corps.push([x, z, w, dd, hh, (rnd() - .5) * .5 + (rnd() > .5 ? Math.PI / 2 : 0)]);
      k++;
    }
  };
  semer(VILLES.manosque, 110, VILLES.manosque.r + .6);
  semer(VILLES.digne, 70, VILLES.digne.r + .4);
  semer(VILLES.gap, 95, VILLES.gap.r + .6);
  semer(SISTERON, 26, SISTERON.r);
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, .5, 0);
  const cone = new THREE.ConeGeometry(.7071, 1, 4); cone.rotateY(Math.PI / 4); cone.translate(0, .5, 0);
  const texMaison = toile(128, 128, (g, w, h) => {
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    for (const [fx, fy] of [[.22, .22], [.62, .22], [.22, .6], [.62, .6]]) {
      g.fillStyle = "#8a9aa5"; g.fillRect(fx * w - 9, fy * h, 9, 26); g.fillRect(fx * w + 18, fy * h, 9, 26);
      g.fillStyle = "#3c4148"; g.fillRect(fx * w, fy * h, 18, 26);
    }
  });
  const imC = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: texMaison, roughness: .9 }), corps.length);
  const imT = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ roughness: .8 }), corps.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  corps.forEach(([x, z, w, d, hh, a], i) => {
    const y = hauteur(x, z);
    q.setFromAxisAngle(up, a);
    m4.compose(new THREE.Vector3(x, y - .02, z), q, new THREE.Vector3(w, hh, d)); imC.setMatrixAt(i, m4);
    imC.setColorAt(i, col.set(MURS[Math.floor(rnd() * MURS.length)]));
    m4.compose(new THREE.Vector3(x, y - .02 + hh, z), q, new THREE.Vector3(w * 1.12, .16 + w * .18, d * 1.12)); imT.setMatrixAt(i, m4);
    imT.setColorAt(i, col.set(TUILES[Math.floor(rnd() * TUILES.length)]));
  });
  imC.castShadow = imT.castShadow = true; imC.receiveShadow = imT.receiveShadow = true;
  scene.add(imC, imT);
}

{ // Sol pavé des centres-villes
  const pave = toile(512, 512, (g, w, h) => {
    g.fillStyle = "#d8cfbf"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 22) {
      const t = 200 + Math.floor(Math.random() * 30);
      g.fillStyle = `rgb(${t},${t - 8},${t - 22})`; g.fillRect(x + 1, y + 1, 20, 14);
    }
  });
  pave.wrapS = pave.wrapT = THREE.RepeatWrapping; pave.repeat.set(5, 5);
  const mat = new THREE.MeshStandardMaterial({ map: pave, roughness: 1 });
  for (const v of LIEUX) {
    const sol = new THREE.Mesh(new THREE.CircleGeometry(v.r + .3, 64).rotateX(-Math.PI / 2), mat);
    sol.position.set(v.x, v.h + .022, v.z); sol.receiveShadow = true; scene.add(sol);
  }
}
{ // Platanes le long des rues commerçantes (de l'autre côté de la rue)
  const tronc = new THREE.CylinderGeometry(.03, .04, .3, 6); tronc.translate(0, .15, 0);
  const houppe = new THREE.IcosahedronGeometry(.24, 1); houppe.translate(0, .42, 0);
  const pts = [];
  for (const [k, r] of Object.entries(RUES)) for (let x = r.x0 - .6; x <= r.x1 + .6; x += 1.15) pts.push([x, VILLES[k].h, r.zRue + .75]);
  const imT = new THREE.InstancedMesh(tronc, new THREE.MeshStandardMaterial({ color: "#8b7a63", roughness: 1 }), pts.length);
  const imH = new THREE.InstancedMesh(houppe, new THREE.MeshStandardMaterial({ color: "#6f8f45", roughness: .9, flatShading: true }), pts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  pts.forEach(([x, y, z], i) => {
    const s = .85 + rnd() * .3;
    m4.compose(new THREE.Vector3(x, y + .02, z), q, new THREE.Vector3(s, s, s)); imT.setMatrixAt(i, m4); imH.setMatrixAt(i, m4);
    imH.setColorAt(i, c.set(["#6f8f45", "#7c9a4c", "#66853f"][i % 3]));
  });
  imT.castShadow = imH.castShadow = true; imH.receiveShadow = true;
  scene.add(imT, imH);
}
{ // Les rues commerçantes
  const mat = new THREE.MeshStandardMaterial({ color: "#77746e", roughness: .95 });
  const trottoir = new THREE.MeshStandardMaterial({ color: "#d6d1c6", roughness: 1 });
  for (const [k, r] of Object.entries(RUES)) {
    const v = VILLES[k], L = (r.x1 - r.x0) + 3;
    const rue = new THREE.Mesh(new THREE.PlaneGeometry(L, .5).rotateX(-Math.PI / 2), mat);
    rue.position.set((r.x0 + r.x1) / 2, v.h + .045, r.zRue + .25); rue.receiveShadow = true; scene.add(rue);
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(L, .9).rotateX(-Math.PI / 2), trottoir);
    tr.position.set((r.x0 + r.x1) / 2, v.h + .035, r.zRue - .45); tr.receiveShadow = true; scene.add(tr);
  }
}

/* ---- Arbres ---------------------------------------------------------------------------- */
{
  const pins = [], feuillus = [];
  for (let k = 0; k < (mobile ? 1600 : 3200); k++) {
    const x = T.x + (rnd() - .5) * T.w * .96, z = T.z + (rnd() - .5) * T.d * .96, h = hauteur(x, z);
    if (h > 8.8 || distRiviere(x, z) < 1.1 || dansLac(x, z) < 1.15) continue;
    if (LIEUX.some((v) => Math.hypot(x - v.x, z - v.z) < v.r + 2.6)) continue;
    if (Math.hypot((x - VALENSOLE.x) / VALENSOLE.rx, (z - VALENSOLE.z) / VALENSOLE.rz) < 1) continue;
    const densite = fbm(x * .12 + 5, z * .12 + 2);
    if (rnd() > smooth(.38, .62, densite) * (h < 1 ? .45 : 1)) continue;
    (h > 3.5 || rnd() > .55 ? pins : feuillus).push([x, h, z, .55 + rnd() * .5]);
  }
  const g1 = new THREE.ConeGeometry(.2, .75, 6); g1.translate(0, .45, 0);
  const g2 = new THREE.IcosahedronGeometry(.27, 0); g2.translate(0, .36, 0);
  const planter = (liste, geom, couleurs) => {
    const im = new THREE.InstancedMesh(geom, new THREE.MeshStandardMaterial({ roughness: .9, flatShading: true }), liste.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    liste.forEach(([x, y, z, s], i) => {
      m4.compose(new THREE.Vector3(x, y - .05, z), q, new THREE.Vector3(s, s * (.85 + rnd() * .4), s));
      im.setMatrixAt(i, m4); im.setColorAt(i, c.set(couleurs[Math.floor(rnd() * couleurs.length)]));
    });
    im.castShadow = !mobile; im.receiveShadow = true; scene.add(im);
  };
  planter(pins, g1, ["#3f5e36", "#4a6b3c", "#365430", "#56763f"]);
  planter(feuillus, g2, ["#6f8a4a", "#7f9a52", "#8a9d5c", "#64804a"]);
}

const texBardage = toile(256, 128, (g, w, h) => {
  g.fillStyle = "#2c2e33"; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) { g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x, 0, 2, h); g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(x + 2, 0, 1, h); }
});
const etageTex = (mur, volet) => toile(512, 192, (g, w, h) => {
  g.fillStyle = mur; g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(0,0,0,.06)"; for (let i = 0; i < 400; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  for (let k = 0; k < 3; k++) {
    const cx = w * (k + .5) / 3, fw = 58, fh = 92, y = 46;
    g.fillStyle = volet; g.fillRect(cx - fw - 24, y, 24, fh); g.fillRect(cx + fw, y, 24, fh);
    g.fillStyle = "rgba(0,0,0,.18)"; for (let s = 0; s < fh; s += 9) { g.fillRect(cx - fw - 24, y + s, 24, 2); g.fillRect(cx + fw, y + s, 24, 2); }
    g.fillStyle = "#3b4651"; g.fillRect(cx - fw, y, fw * 2, fh);
    g.fillStyle = "rgba(255,255,255,.22)"; g.fillRect(cx - fw + 6, y + 6, fw - 10, fh - 12);
    g.fillStyle = "#ece5d8"; g.fillRect(cx - 3, y, 6, fh); g.fillRect(cx - fw, y + fh * .45, fw * 2, 5);
    g.fillStyle = "#d8cfbf"; g.fillRect(cx - fw - 6, y + fh, fw * 2 + 12, 9);
  }
});
const texParking = toile(512, 256, (g, w, h) => {
  g.fillStyle = "#55575b"; g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,.04)"; for (let i = 0; i < 900; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  g.fillStyle = "#f2f2ee";
  for (let x = 16; x < w; x += 44) { g.fillRect(x, 8, 4, 84); g.fillRect(x, h - 92, 4, 84); }
  g.fillRect(8, 92, w - 16, 4); g.fillRect(8, h - 96, w - 16, 4);
});

/* ---- Les 5 boutiques ------------------------------------------------------------------ */
const COULEUR = { market: "#e43a3a", boucherie: "#8a1f33", primeur: "#0b8a43" };
const BOUTIQUES = {};
const hitboxes = [];
const toitPlat = new THREE.MeshStandardMaterial({ color: "#6f6e6a", roughness: 1 });
const tuiles = new THREE.MeshStandardMaterial({ color: "#bf6a43", roughness: .85, flatShading: true });
const dalle = new THREE.MeshStandardMaterial({ color: "#cbc6bc", roughness: 1 });
for (const b of DATA.boutiques) {
  const p = PLAN[b.slug], y0 = hauteur(p.x, p.z), h = p.w / 2.162;
  const grp = new THREE.Group(); grp.position.set(p.x, y0, p.z);
  const tex = texLoader.load(b.facade); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = MAX_ANISO;
  const facade = new THREE.MeshStandardMaterial({ map: tex, roughness: .7, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: AMB.vitrine * .55 });
  const cote = b.type === "market"
    ? new THREE.MeshStandardMaterial({ map: texBardage, roughness: .8 })
    : new THREE.MeshStandardMaterial({ color: "#e6dac6", roughness: .95 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(p.w + .5, .06, p.d + .5), dalle);
  base.position.set(0, .01, .15); base.receiveShadow = true; grp.add(base);
  const corps = new THREE.Mesh(new THREE.BoxGeometry(p.w, h, p.d), [cote, cote, toitPlat, cote, facade, cote]);
  corps.position.y = h / 2 + .04; corps.castShadow = corps.receiveShadow = true;
  corps.userData.slug = b.slug; hitboxes.push(corps); grp.add(corps);
  let haut = h + .04;
  if (p.etage) {
    const et = etageTex(b.type === "primeur" ? "#efe4cf" : "#e9dcc4", b.type === "primeur" ? "#7d9a86" : "#8197a6");
    const mat = new THREE.MeshStandardMaterial({ map: et, roughness: .95 });
    const eh = .5;
    const etage = new THREE.Mesh(new THREE.BoxGeometry(p.w, eh, p.d), [mat, mat, toitPlat, mat, mat, mat]);
    etage.position.y = haut + eh / 2; etage.castShadow = etage.receiveShadow = true;
    etage.userData.slug = b.slug; hitboxes.push(etage); grp.add(etage);
    haut += eh;
    const toit = new THREE.Mesh(new THREE.ConeGeometry(.7071, 1, 4).rotateY(Math.PI / 4).translate(0, .5, 0), tuiles);
    toit.scale.set(p.w * 1.1, .38, p.d * 1.14); toit.position.y = haut; toit.castShadow = true; grp.add(toit);
    haut += .38;
  } else {
    for (const [cx, cz] of [[-.5, -.3], [.35, -.2], [.6, .3]]) {
      const clim = new THREE.Mesh(new THREE.BoxGeometry(.26, .14, .2), new THREE.MeshStandardMaterial({ color: "#c9cbcd", roughness: .6 }));
      clim.position.set(cx * p.w * .5, haut + .07, cz * p.d * .5); clim.castShadow = true; grp.add(clim);
    }
  }
  if (p.parking) {
    const pk = new THREE.Mesh(new THREE.PlaneGeometry(p.w * 1.05, 1.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: texParking, roughness: .95 }));
    pk.position.set(0, .05, p.d / 2 + 1.05); pk.receiveShadow = true; grp.add(pk);
    const voit = new THREE.BoxGeometry(.13, .08, .22); voit.translate(0, .04, 0);
    const COUL = ["#d9d9d9", "#2d2f33", "#9aa3ad", "#b33a32", "#f2f2f2", "#3b5873", "#575a5e"];
    for (let k = 0; k < 9; k++) {
      if (rnd() < .35) continue;
      const v = new THREE.Mesh(voit, new THREE.MeshStandardMaterial({ color: COUL[k % COUL.length], roughness: .35, metalness: .3 }));
      const rang = k % 2, col = Math.floor(k / 2) - 2;
      v.position.set(col * .26 + (rnd() - .5) * .04, .05, p.d / 2 + 1.05 + (rang ? .45 : -.45));
      v.castShadow = true; grp.add(v);
    }
  }
  const couleur = b.type === "boucherie" && b.rouge ? "#b3122c" : COULEUR[b.type];
  const anneau = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: .6, depthWrite: false }));
  const R = Math.max(p.w, p.d) * .82;
  anneau.scale.set(R, 1, R); anneau.position.y = .07; grp.add(anneau);
  scene.add(grp);
  BOUTIQUES[b.slug] = { b, p, grp, anneau, R, haut, h, y0, facade };
}

/* ---- Petits camions de livraison sur les routes ---------------------------------- */
const camions = [];
{
  const corpsG = new THREE.BoxGeometry(.16, .16, .36); corpsG.translate(0, .1, -.04);
  const cabG = new THREE.BoxGeometry(.15, .12, .12); cabG.translate(0, .08, .18);
  const blanc = new THREE.MeshStandardMaterial({ color: "#f4f2ee", roughness: .5 });
  const rouge = new THREE.MeshStandardMaterial({ color: "#e43a3a", roughness: .5 });
  for (const [route, u, vit] of [[routeA51, .1, .011], [routeA51, .55, -.009], [routeA51, .8, .01], [routeRN85, .3, .02]]) {
    const g = new THREE.Group();
    const c1 = new THREE.Mesh(corpsG, blanc), c2 = new THREE.Mesh(cabG, rouge);
    c1.castShadow = c2.castShadow = true; g.add(c1, c2); scene.add(g);
    camions.push({ g, route, u, vit });
  }
}

/* ---- Nuages ---------------------------------------------------------------------------- */
const nuages = [];
{
  const geo1 = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true, transparent: true, opacity: .93 });
  for (let k = 0; k < 9; k++) {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo1, mat);
      const s = .9 + rnd() * 1.6; m.scale.set(s * 1.4, s * .7, s);
      m.position.set((rnd() - .5) * 5, (rnd() - .5) * .8, (rnd() - .5) * 2.4);
      g.add(m);
    }
    g.position.set(T.x + (rnd() - .5) * T.w, 17 + rnd() * 6, T.z + (rnd() - .5) * T.d * .9);
    scene.add(g); nuages.push(g);
  }
}

/* ---- Étiquettes (HTML) projetées --------------------------------------------------------- */
const calque = survol.querySelector("[data-labels]");
const etiquettes = [];
function etiquette(el, pos, regle) { calque.appendChild(el); etiquettes.push({ el, pos, regle }); return el; }
for (const [k, v] of Object.entries(VILLES)) {
  const n = DATA.boutiques.filter((b) => b.ville === k).length;
  const el = document.createElement("div"); el.className = "lbl lbl--ville";
  el.innerHTML = `${v.nom}<small>${n} boutique${n > 1 ? "s" : ""}</small>`;
  etiquette(el, new THREE.Vector3(v.x, v.h + 2.2, v.z), "ville");
}
for (const [txt, x, z, cls] of [["la Durance", -8.3, 31.5, "lbl--riviere"], ["Lac de Serre-Ponçon", 27, -35, "lbl--riviere"],
  ["Plateau de Valensole", 2.5, 36.5, ""], ["Sisteron", -4.4, .55, ""]]) {
  const el = document.createElement("div"); el.className = "lbl lbl--lieu " + cls; el.textContent = txt;
  etiquette(el, new THREE.Vector3(x, hauteur(x, z) + .9, z), "lieu");
}
const pinsParSlug = {};
for (const [slug, o] of Object.entries(BOUTIQUES)) {
  const b = o.b, el = document.createElement("button");
  el.type = "button"; el.tabIndex = -1;
  el.className = `lbl repere t-${b.type}${b.rouge ? " v-red" : ""}`;
  el.innerHTML = `<span class="repere__bulle"><img src="${b.logo}" alt=""></span>${b.nouveau ? '<span class="repere__new">Nouveau</span>' : ""}<span class="repere__nom">${b.nom}</span><span class="repere__tige"></span>`;
  el.addEventListener("click", () => entrer(slug));
  el.addEventListener("mouseenter", () => surligner(slug));
  el.addEventListener("mouseleave", () => surligner(null));
  pinsParSlug[slug] = etiquette(el, new THREE.Vector3(o.p.x, o.y0 + o.haut + .25, o.p.z), "boutique:" + b.ville);
}

/* ---- Les étapes du survol (caméra) ------------------------------------------------------ */
function centre(ville) {
  const l = Object.values(BOUTIQUES).filter((o) => o.b.ville === ville);
  const x = l.reduce((s, o) => s + o.p.x, 0) / l.length, z = l.reduce((s, o) => s + o.p.z, 0) / l.length;
  return new THREE.Vector3(x, VILLES[ville].h + .55, z + .4);
}
const ETAPES = [
  { cible: new THREE.Vector3(3, 1, 2), pos: new THREE.Vector3(-6, 78, 122), flou: 3.2 },
  { cible: centre("manosque"), off: new THREE.Vector3(-2.8, 6.2, 13.4), flou: 1.6 },
  { cible: centre("digne"), off: new THREE.Vector3(-1.4, 3.1, 7.2), flou: 1.6 },
  { cible: centre("gap"), off: new THREE.Vector3(-1.8, 4.2, 9.4), flou: 1.6 },
  { cible: new THREE.Vector3(2, 1, 0), pos: new THREE.Vector3(-84, 56, 74), flou: 3 },
];
let aspect = 1;
function posEtape(e) {
  if (e.pos) return e.pos.clone().sub(e.cible).multiplyScalar(aspect < 1 ? 1.35 : 1).add(e.cible);
  const k = aspect < 1 ? clamp(1.25 / aspect, 1, 2.4) : 1;
  return e.cible.clone().add(e.off.clone().multiplyScalar(k));
}

/* ---- Post-traitement : effet maquette (tilt-shift) ------------------------------------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const tsH = new ShaderPass(HorizontalTiltShiftShader), tsV = new ShaderPass(VerticalTiltShiftShader);
composer.addPass(tsH); composer.addPass(tsV);
composer.addPass(new OutputPass());

/* ---- Mise en page ------------------------------------------------------------------------ */
const stage = survol.querySelector(".survol__stage");
let W = 1, H = 1, decal = { x: 0, y: 0 }, decalCible = { x: 0, y: 0 };
function taille() {
  W = stage.clientWidth; H = stage.clientHeight; aspect = W / H;
  renderer.setSize(W, H, false); composer.setSize(W, H);
  camera.aspect = aspect; camera.fov = aspect < 1 ? 44 : 30; camera.updateProjectionMatrix();
  // Le panneau occupe la gauche (ordinateur) ou le bas (téléphone) : on décale le centre de la vue
  decalCible = W > 760 ? { x: Math.min(250, (430 + 40) / 2), y: 0 } : { x: 0, y: H * .2 };
}
window.addEventListener("resize", taille);
taille();

/* ---- Défilement → progression --------------------------------------------------------- */
const N = ETAPES.length;
let r = 0, rCible = 0, plongee = null, survolSlug = null;
function lire() {
  const rect = survol.getBoundingClientRect(), course = rect.height - innerHeight;
  rCible = clamp(-rect.top / (course || 1)) * (N - 1);
}
addEventListener("scroll", lire, { passive: true });
lire(); r = rCible;

function allerA(k) {
  const course = survol.offsetHeight - innerHeight;
  const cible = k === 0 ? 0 : k === N - 1 ? 1 : (k + .04) / (N - 1);
  scrollTo({ top: survol.offsetTop + course * cible, behavior: reduit ? "auto" : "smooth" });
}
document.querySelectorAll("[data-aller]").forEach((bt) => bt.addEventListener("click", () => allerA(+bt.dataset.aller)));

const panneaux = [...survol.querySelectorAll("[data-etape]")];
const itiBtns = [...survol.querySelectorAll(".itineraire button")];
const itiProg = survol.querySelector("[data-iti-progres]");
const aide = survol.querySelector("[data-aide]");
let etapeActive = -1;
function majPanneaux() {
  const i = Math.floor(r + 1e-6), t = r - i;
  const active = r >= N - 1 - 1e-3 ? N - 1 : t < .3 ? i : t > .86 ? i + 1 : -1;
  if (active !== etapeActive) {
    etapeActive = active;
    panneaux.forEach((p) => p.classList.toggle("is-active", +p.dataset.etape === active));
  }
  const ici = Math.round(r);
  itiBtns.forEach((bt, k) => { bt.classList.toggle("is-ici", k === ici); bt.classList.toggle("is-passe", k < r - .5); });
  itiProg.style.width = (r / (N - 1) * 100).toFixed(2) + "%";
  aide && aide.classList.toggle("is-on", active >= 1 && active <= 3 && !mobile);
}

/* ---- Survol de la souris : boutique sous le curseur ------------------------------------ */
const ray = new THREE.Raycaster(), souris = new THREE.Vector2(9, 9), para = { x: 0, y: 0 };
canvas.addEventListener("pointermove", (ev) => {
  const rc = canvas.getBoundingClientRect();
  souris.set((ev.clientX - rc.left) / rc.width * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
  para.x = souris.x; para.y = souris.y;
});
canvas.addEventListener("pointerleave", () => { souris.set(9, 9); surligner(null); });
canvas.addEventListener("click", () => { if (survolSlug) entrer(survolSlug); });
function surligner(slug) {
  survolSlug = slug;
  canvas.classList.toggle("is-survol", !!slug);
  for (const [s, el] of Object.entries(pinsParSlug)) el.classList.toggle("is-on", s === slug);
  document.querySelectorAll("[data-escale]").forEach((a) => a.classList.toggle("is-on", a.dataset.escale === slug));
}
document.querySelectorAll("[data-escale]").forEach((a) => {
  a.addEventListener("mouseenter", () => surligner(a.dataset.escale));
  a.addEventListener("mouseleave", () => surligner(null));
  a.addEventListener("focus", () => surligner(a.dataset.escale));
  a.addEventListener("click", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault(); entrer(a.dataset.escale);
  });
});

/* ---- La plongée : la caméra fonce sur la façade, puis la page de la boutique s'ouvre ---- */
const fondu = survol.querySelector("[data-fondu]");
function entrer(slug) {
  const o = BOUTIQUES[slug];
  if (!o || plongee) return;
  if (reduit) { location.href = o.b.url; return; }
  const yF = o.y0 + .04 + o.h / 2, zF = o.p.z + o.p.d / 2;
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * aspect);
  const dist = (o.p.w * .5) / Math.tan(hfov / 2) * 1.02;
  plongee = {
    t0: performance.now(), D: 1700 * (window.__lent || 1),   // __lent : captures d'écran au ralenti
    p0: camera.position.clone(), c0: cibleCam.clone(),
    p1: new THREE.Vector3(o.p.x, yF + dist * .04, zF + dist), c1: new THREE.Vector3(o.p.x, yF, zF),
    url: o.b.url, fini: false,
  };
  survol.classList.add("is-plongee");
  surligner(slug);
}
// Pendant la plongée, on ignore la molette et le glisser (sans toucher à la mise en page)
const bloquer = (ev) => { if (plongee) ev.preventDefault(); };
addEventListener("wheel", bloquer, { passive: false });
addEventListener("touchmove", bloquer, { passive: false });
addEventListener("keydown", (ev) => { if (plongee && ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Space", " ", "Home", "End"].includes(ev.key)) ev.preventDefault(); });
addEventListener("pageshow", (ev) => {
  if (ev.persisted) { if (arret) { arret = false; requestAnimationFrame(boucle); } plongee = null; survol.classList.remove("is-plongee"); fondu.classList.remove("is-on"); lire(); r = rCible; }
});

/* ---- Boucle ----------------------------------------------------------------------------- */
const cibleCam = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Vector3(), v3 = new THREE.Vector3();
let visible = true, tPrec = performance.now(), flou = 3;
new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(survol);

function camEtape(rr) {
  const i = Math.min(N - 2, Math.floor(rr)), t = rr - i;
  let e = reduit ? (t > .6 ? 1 : 0) : easeIO(clamp((t - .3) / .56));
  const A = ETAPES[i], B = ETAPES[i + 1];
  const pA = posEtape(A), pB = posEtape(B);
  tmpP.lerpVectors(pA, pB, e);
  tmpP.y += Math.sin(e * Math.PI) * pA.distanceTo(pB) * .22;   // on prend de la hauteur entre deux villes
  tmpC.lerpVectors(A.cible, B.cible, e);
  flou = mix(A.flou, B.flou, e) + Math.sin(e * Math.PI) * .8;
}

let arret = false;
canvas.addEventListener("webglcontextlost", (ev) => {
  // Contexte 3D perdu (carte graphique saturée) : on va directement à la boutique, sinon on passe à la liste
  ev.preventDefault();
  if (plongee) { arret = true; location.assign(plongee.url); }
  else { arret = true; document.documentElement.classList.add("sans-3d"); }
});
function boucle(now) {
  if (arret) return;
  requestAnimationFrame(boucle);
  if (!visible || document.hidden) { tPrec = now; return; }
  const dt = Math.min(.05, (now - tPrec) / 1000); tPrec = now;
  const temps = now / 1000;

  if (!plongee) {
    r += (rCible - r) * (reduit ? 1 : 1 - Math.pow(.0016, dt));
    if (Math.abs(rCible - r) < 1e-4) r = rCible;
    camEtape(r);
    const dCam = tmpP.distanceTo(tmpC), s = dCam * .012;
    if (!reduit) {
      tmpP.x += Math.sin(temps * .13) * .55 * s * 4 + para.x * s * 3;
      tmpP.y += para.y * s * 1.5;
    }
    camera.position.copy(tmpP); cibleCam.copy(tmpC);
    decal.x += (decalCible.x - decal.x) * .1; decal.y += (decalCible.y - decal.y) * .1;
    majPanneaux();
  } else {
    const k = clamp((now - plongee.t0) / plongee.D), e = easeIO(k);
    camera.position.lerpVectors(plongee.p0, plongee.p1, e);
    camera.position.y += Math.sin(e * Math.PI) * plongee.p0.distanceTo(plongee.p1) * .06;
    cibleCam.lerpVectors(plongee.c0, plongee.c1, e);
    decal.x = mix(decal.x, 0, .12); decal.y = mix(decal.y, 0, .12);
    flou = mix(flou, 0, .1);
    if (k > .86 && !plongee.fini) {
      plongee.fini = true; fondu.classList.add("is-on");
      const url = plongee.url;
      setTimeout(() => { arret = true; location.assign(url); }, 380);   // on coupe le rendu avant de partir
    }
  }
  camera.setViewOffset(W, H, -decal.x, decal.y, W, H);
  camera.lookAt(cibleCam);
  camera.updateMatrixWorld();

  // Ombres nettes autour de ce que l'on regarde
  const dC = camera.position.distanceTo(cibleCam);
  const sh = clamp(dC * .55, 7, 85);
  soleil.position.copy(cibleCam).addScaledVector(DIR_SOLEIL, 120);
  soleil.target.position.copy(cibleCam);
  const sc = soleil.shadow.camera;
  if (Math.abs(sc.right - sh) > .01) { sc.left = -sh; sc.right = sh; sc.top = sh; sc.bottom = -sh; sc.near = 1; sc.far = 300; sc.updateProjectionMatrix(); }
  scene.fog.near = dC * 1.15; scene.fog.far = dC * 3.2 + 70;

  // Effet maquette
  tsH.uniforms.h.value = flou / W; tsV.uniforms.v.value = flou / H;
  tsH.uniforms.r.value = tsV.uniforms.r.value = .5 + decal.y / H;

  // Animations de la maquette
  if (!reduit) {
    for (const c of camions) {
      c.u = (c.u + c.vit * dt * 1.6 + 1) % 1;
      const p = c.route.getPointAt(c.u), p2 = c.route.getPointAt((c.u + Math.sign(c.vit) * .004 + 1) % 1);
      c.g.position.set(p.x, hauteur(p.x, p.z) + .09, p.z);
      c.g.lookAt(p2.x, c.g.position.y, p2.z);
    }
    for (const n of nuages) { n.position.x += dt * .5; if (n.position.x > T.x + T.w / 2 + 8) n.position.x = T.x - T.w / 2 - 8; }
  }
  for (const o of Object.values(BOUTIQUES)) {
    const ph = (temps * .6 + o.p.x * .1) % 1, on = survolSlug === o.b.slug;
    const s = o.R * (1 + ph * (on ? .55 : .35));
    o.anneau.scale.set(s, 1, s);
    o.anneau.material.opacity = (1 - ph) * (on ? .9 : .55);
  }

  // Boutique sous le curseur
  if (!plongee && souris.x < 5) {
    ray.setFromCamera(souris, camera);
    const hit = ray.intersectObjects(hitboxes, false)[0];
    const s = hit ? hit.object.userData.slug : null;
    if (s !== survolSlug && !document.querySelector(".escale:hover, .repere:hover")) surligner(s);
  }

  // Étiquettes
  const villeProche = Object.entries(VILLES).reduce((m, [k, v]) => {
    const d = Math.hypot(cibleCam.x - v.x, cibleCam.z - v.z); return d < m[1] ? [k, d] : m;
  }, ["", 1e9])[0];
  for (const l of etiquettes) {
    v3.copy(l.pos).project(camera);
    let op;
    if (l.regle === "ville") op = smooth(30, 46, dC);
    else if (l.regle === "lieu") op = mobile ? 0 : smooth(45, 80, dC);
    else op = l.regle === "boutique:" + villeProche ? 1 - smooth(30, 42, dC) : 0;
    if (plongee) op = 0;
    if (v3.z > 1 || op < .02) { l.el.style.opacity = "0"; l.el.style.visibility = "hidden"; continue; }
    const x = (v3.x * .5 + .5) * W, y = (-v3.y * .5 + .5) * H;
    l.el.style.visibility = "visible";
    l.el.style.opacity = op.toFixed(2);
    l.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%)`;
  }

  composer.render();
}

chargeur.onLoad = () => survol.querySelector("[data-chargement]").classList.add("is-fini");
setTimeout(() => survol.querySelector("[data-chargement]").classList.add("is-fini"), 6000);
requestAnimationFrame(boucle);
