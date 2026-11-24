import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Procedural 3D models for vehicles, civilian cars and incident props. Everything is built from boxes and cylinders
 * (no external assets). Geometry and materials are cached and shared; they are flagged `userData.shared` so the
 * renderer's dispose helper leaves them alone. Convention: the front of every model points along +X, Y is up,
 * the model origin is on the ground in the middle of the footprint.
 */

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const k = `b${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); g.userData.shared = true; geoCache.set(k, g); }
  return g;
}
function rboxGeo(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const k = `r${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${rr.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) { g = new RoundedBoxGeometry(w, h, d, 3, Math.max(0.005, rr)); g.userData.shared = true; geoCache.set(k, g); }
  return g;
}
function wheelGeo(r: number, w: number): THREE.BufferGeometry {
  const k = `w${r.toFixed(3)},${w.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(r, r, w, 14); g.rotateX(Math.PI / 2); g.userData.shared = true; geoCache.set(k, g); }
  return g;
}
export function lambert(color: number): THREE.MeshLambertMaterial {
  const k = `l${color}`;
  let m = matCache.get(k) as THREE.MeshLambertMaterial | undefined;
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); m.userData.shared = true; matCache.set(k, m); }
  return m;
}
/** Car paint: slightly metallic so it picks up the environment reflections. */
export function paint(color: number): THREE.MeshStandardMaterial {
  const k = `p${color}`;
  let m = matCache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) { m = new THREE.MeshStandardMaterial({ color, metalness: 0.28, roughness: 0.4 }); m.userData.shared = true; matCache.set(k, m); }
  return m;
}
function glassMat(): THREE.MeshStandardMaterial {
  let m = matCache.get('glass') as THREE.MeshStandardMaterial | undefined;
  if (!m) { m = new THREE.MeshStandardMaterial({ color: 0x0d1822, metalness: 0.75, roughness: 0.1 }); m.userData.shared = true; matCache.set('glass', m); }
  return m;
}
function glow(color: number, intensity = 0.9): THREE.MeshStandardMaterial {
  const k = `g${color}:${intensity}`;
  let m = matCache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) { m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity }); m.userData.shared = true; matCache.set(k, m); }
  return m;
}

/** A private (non-shared) copy of a cached material, so it can be animated and disposed per vehicle. */
function own(m: THREE.Material): THREE.Material { const c = m.clone(); c.userData = {}; return c; }

const TYRE = 0x151515, RIM = 0x9aa0a6, CHROME = 0x6b7078;

function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Rounded box (bodywork). */
function rbox(parent: THREE.Object3D, w: number, h: number, d: number, r: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(rboxGeo(w, h, d, r), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export interface VehicleParts {
  /** wheel meshes (spin around their local Z while driving) */
  wheels: THREE.Mesh[];
  /** emergency lights: `phase` 0/1 alternate while the sirens are on */
  beacons: { mesh: THREE.Mesh; on: number; off: number; phase: 0 | 1 }[];
  /** brake lights (shared material per car) and turn indicators (left / right sets) of civilian cars */
  brake?: THREE.MeshStandardMaterial;
  blinkL?: THREE.MeshStandardMaterial;
  blinkR?: THREE.MeshStandardMaterial;
  /** helicopter rotors: [main, tail] (spin around their own axis while the engine runs) */
  rotors?: THREE.Object3D[];
}

interface Spec {
  /** `truck` = cab + box body, `van` = one box with a short bonnet, `car` = low body with cabin, `bike` = motorcycle */
  shape: 'truck' | 'van' | 'car' | 'bike' | 'heli';
  body: number;
  cab?: number;
  stripe?: number;
  stripe2?: number;
  accent: number; // lightbar main colour
  accent2: number; // second colour (alternating)
  wheels: number;
  extras?: (g: THREE.Group, L: number, W: number, H: number, wr: number) => void;
}

const SPECS: Record<string, Spec> = {
  'vehicle/fire_engine': { shape: 'truck', body: 0xb3261e, cab: 0xb3261e, stripe: 0xf2f2f2, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 3, extras: fireEngineExtras },
  'vehicle/aerial_ladder': { shape: 'truck', body: 0xb3261e, cab: 0xb3261e, stripe: 0xf2f2f2, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 3, extras: ladderExtras },
  'vehicle/rescue_vehicle': { shape: 'truck', body: 0xa82820, cab: 0xa82820, stripe: 0xffcc33, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 3 },
  'vehicle/command_vehicle': { shape: 'van', body: 0xf1f1ee, stripe: 0xc0281f, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2, extras: antennaExtras },
  'vehicle/ambulance': { shape: 'van', body: 0xf6f4ea, stripe: 0xff7a1a, stripe2: 0xffd21a, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2, extras: ambulanceExtras },
  'vehicle/rapid_responder': { shape: 'car', body: 0xf6f4ea, stripe: 0xff7a1a, stripe2: 0xffd21a, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2 },
  'vehicle/mmt_car': { shape: 'car', body: 0xf6f4ea, stripe: 0xff7a1a, stripe2: 0xffd21a, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2, extras: crossExtras },
  'vehicle/patrol_car': { shape: 'car', body: 0xf3f4f6, stripe: 0x1f4fb3, stripe2: 0xff8c1a, accent: 0x2f6bff, accent2: 0xff2a2a, wheels: 2 },
  'vehicle/police_van': { shape: 'van', body: 0x233f7a, stripe: 0xf3f4f6, stripe2: 0xff8c1a, accent: 0x2f6bff, accent2: 0xff2a2a, wheels: 2 },
  'vehicle/police_motorcycle': { shape: 'bike', body: 0xf3f4f6, stripe: 0x1f4fb3, accent: 0x2f6bff, accent2: 0xff2a2a, wheels: 2 },
  'vehicle/bomb_squad': { shape: 'truck', body: 0x37474f, cab: 0x37474f, stripe: 0xff7a1a, accent: 0x2f6bff, accent2: 0xff2a2a, wheels: 3, extras: bombSquadExtras },
  'vehicle/air_ambulance': { shape: 'heli', body: 0xf6f4ea, stripe: 0xff7a1a, stripe2: 0xffd21a, accent: 0x2f6bff, accent2: 0xff2a2a, wheels: 0 },
  'vehicle/light_unit': { shape: 'truck', body: 0xef6c00, cab: 0xef6c00, stripe: 0xf2f2f2, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2, extras: lightMastExtras },
  'vehicle/ovd_car': { shape: 'car', body: 0xf6f4ea, stripe: 0xffd21a, stripe2: 0xd32f2f, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2 },
  'vehicle/lgh_car': { shape: 'car', body: 0xf6f4ea, stripe: 0x26c6da, stripe2: 0xffd21a, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2, extras: crossExtras },
  'vehicle/copi_unit': { shape: 'van', body: 0xf3f1e6, stripe: 0xffd21a, stripe2: 0xd32f2f, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2, extras: copiExtras },
  'vehicle/hazmat_unit': { shape: 'truck', body: 0xe8591c, cab: 0xe8591c, stripe: 0xffd21a, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 3, extras: hazmatExtras },
  'vehicle/water_tanker': { shape: 'truck', body: 0xc95a0c, cab: 0xc95a0c, stripe: 0xf2f2f2, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 3, extras: tankerExtras },
  'vehicle/riot_van': { shape: 'van', body: 0x1f2a5a, stripe: 0xf3f4f6, accent: 0x2f6bff, accent2: 0xff2a2a, wheels: 2, extras: riotExtras },
  'vehicle/hearse': { shape: 'van', body: 0x20262b, stripe: 0xb8bcc4, accent: 0x20262b, accent2: 0x20262b, wheels: 2, extras: hearseExtras },
  'vehicle/tow_truck': { shape: 'truck', body: 0xf0b41a, cab: 0xf0b41a, stripe: 0x222222, accent: 0xffa000, accent2: 0xffa000, wheels: 3, extras: towExtras },
  'vehicle/service_van': { shape: 'van', body: 0x4d7a2a, stripe: 0xf0d02a, accent: 0xffa000, accent2: 0xffa000, wheels: 2, extras: rackExtras },
  'vehicle/crane_truck': { shape: 'truck', body: 0xe5a91a, cab: 0xe5a91a, stripe: 0x222222, accent: 0xffa000, accent2: 0xffa000, wheels: 3, extras: craneExtras },
};
const FALLBACK: Record<string, Spec> = {
  fire: SPECS['vehicle/fire_engine'], ambulance: SPECS['vehicle/ambulance'], police: SPECS['vehicle/patrol_car'], tech: SPECS['vehicle/service_van'],
};

function fireEngineExtras(g: THREE.Group, L: number, W: number, H: number): void {
  const grey = lambert(0xb9bec4), dark = lambert(0x2a2c30);
  // roof ladder + hose reel + compartment shutters
  box(g, L * 0.36, 0.08, 0.1, grey, -L * 0.14, H * 0.98, W * 0.18);
  box(g, L * 0.36, 0.08, 0.1, grey, -L * 0.14, H * 0.98, -W * 0.18);
  for (let i = 0; i < 6; i++) box(g, 0.05, 0.06, W * 0.4, grey, -L * 0.28 + i * (L * 0.08), H * 0.99, 0);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) box(g, L * 0.14, H * 0.34, 0.05, dark, -L * 0.26 + i * (L * 0.17), H * 0.46, s * (W / 2 + 0.01));
}
function ladderExtras(g: THREE.Group, L: number, W: number, H: number): void {
  const grey = lambert(0xc9ced4), dark = lambert(0x2a2c30);
  // the ladder hangs on a pivot at the turntable so it can be raised, turned and extended (see animateAerial)
  const pivot = new THREE.Group();
  pivot.name = 'ladder';
  pivot.position.set(-L * 0.36, H + 0.3, 0);
  g.add(pivot);
  box(pivot, L * 0.62, 0.22, 0.12, grey, L * 0.31, 0, 0.45);
  box(pivot, L * 0.62, 0.22, 0.12, grey, L * 0.31, 0, -0.45);
  for (let i = 0; i < 12; i++) box(pivot, 0.06, 0.06, 0.9, grey, i * (L * 0.052) + 0.2, 0, 0);
  box(g, 0.9, 0.35, W * 0.8, dark, -L * 0.36, H + 0.12, 0); // turntable
  for (const s of [-1, 1]) box(g, 0.25, 0.25, 0.9, dark, -L * 0.2, 0.3, s * (W / 2 + 0.45)); // outrigger pads
}
function bombSquadExtras(g: THREE.Group, L: number, W: number, H: number): void {
  const dark = lambert(0x24262a);
  box(g, L * 0.4, 0.12, W * 0.7, dark, -L * 0.22, H * 0.96, 0); // robot bay roof rails
  const robot = buildBombRobot();
  robot.name = 'robot';
  robot.scale.setScalar(0.8);
  robot.position.set(-L * 0.22, H * 0.96 + 0.25, 0);
  g.add(robot);
  box(g, 0.3, 0.1, W * 0.7, lambert(0xff7a1a), -L / 2 - 0.12, 0.7, 0); // rear ramp edge
}
/** A small tracked bomb-disposal robot with a gripper arm. */
export function buildBombRobot(): THREE.Group {
  const g = new THREE.Group();
  const body = lambert(0x2f3a40), track = lambert(0x151515), arm = lambert(0xe6a817);
  box(g, 0.9, 0.35, 0.55, body, 0, 0.32, 0);
  for (const s of [-1, 1]) box(g, 1.1, 0.26, 0.16, track, 0, 0.15, s * 0.38);
  const a1 = box(g, 0.1, 0.7, 0.1, arm, 0.25, 0.7, 0); a1.rotation.z = -0.5;
  const a2 = box(g, 0.6, 0.08, 0.08, arm, 0.55, 1.0, 0); a2.rotation.z = -0.25;
  box(g, 0.14, 0.14, 0.2, lambert(0xcccccc), 0.88, 0.95, 0);
  box(g, 0.14, 0.1, 0.14, glow(0x3fa9ff, 1), -0.3, 0.55, 0.18);
  return g;
}
/** The suspect item: a holdall with a taped box next to it. */
export function buildSuspectPackage(): THREE.Group {
  const g = new THREE.Group();
  box(g, 0.9, 0.5, 0.5, lambert(0x3a4a2f), 0, 0.25, 0);
  box(g, 0.5, 0.06, 0.06, lambert(0x222222), 0, 0.53, 0);
  box(g, 0.55, 0.4, 0.45, lambert(0xb08a5a), 0.9, 0.2, 0.3).rotation.y = 0.4;
  box(g, 0.58, 0.05, 0.1, lambert(0xd8c9a0), 0.9, 0.42, 0.3).rotation.y = 0.4;
  return g;
}
/** Ambulance trolley with mattress and (optionally) a blanket; lies along X like a victim does. */
export function buildStretcher(blanket: number | null): THREE.Group {
  const g = new THREE.Group();
  box(g, 2.0, 0.08, 0.66, lambert(0xbfc5ca), 0, 0.55, 0);
  box(g, 1.9, 0.1, 0.6, lambert(0x2f6f9f), 0, 0.62, 0);
  for (const x of [-0.8, 0.8]) for (const z of [-0.25, 0.25]) box(g, 0.05, 0.5, 0.05, lambert(0x8a9096), x, 0.27, z);
  for (const x of [-0.8, 0.8]) box(g, 0.1, 0.08, 0.6, lambert(0x222222), x, 0.05, 0);
  if (blanket !== null) box(g, 1.1, 0.13, 0.64, lambert(blanket), 0.4, 0.77, 0);
  return g;
}
/** IV drip stand with a bag of fluid. */
export function buildDripStand(): THREE.Group {
  const g = new THREE.Group();
  const metal = lambert(0xb8bec4);
  box(g, 0.04, 1.7, 0.04, metal, 0, 0.85, 0);
  box(g, 0.5, 0.04, 0.04, metal, 0, 1.7, 0);
  box(g, 0.08, 0.04, 0.5, metal, 0, 0.04, 0);
  box(g, 0.5, 0.04, 0.08, metal, 0, 0.04, 0);
  rbox(g, 0.12, 0.26, 0.05, 0.02, lambert(0xcfe9ff), 0.12, 1.5, 0);
  rbox(g, 0.12, 0.26, 0.05, 0.02, lambert(0xcfe9ff), -0.12, 1.5, 0);
  return g;
}
/** Oxygen cylinder (green) with a white valve. */
export function buildOxygenBottle(): THREE.Group {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 12), lambert(0x2f8f4a)); cyl.position.y = 0.4; g.add(cyl);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), lambert(0xf2f2f2)); cap.position.y = 0.75; g.add(cap);
  box(g, 0.04, 0.1, 0.04, lambert(0x888888), 0, 0.88, 0);
  return g;
}
/** Paramedic bag: red case with a white cross. */
export function buildMedBag(): THREE.Group {
  const g = new THREE.Group();
  box(g, 0.5, 0.3, 0.3, lambert(0xc62828), 0, 0.15, 0);
  box(g, 0.2, 0.03, 0.08, lambert(0xffffff), 0, 0.31, 0);
  box(g, 0.08, 0.03, 0.2, lambert(0xffffff), 0, 0.31, 0);
  return g;
}
export function buildBloodPool(seed: number): THREE.Group {
  const g = new THREE.Group();
  const m = lambert(0x6e0f10);
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(cylDisc(), m);
    d.scale.set(0.5 + (i + seed) % 3 * 0.18, 1, 0.35 + (i * 0.17));
    d.position.set(-0.1 + i * 0.35, 0.03 + i * 0.002, ((i + seed) % 2 - 0.5) * 0.3);
    g.add(d);
  }
  return g;
}
let discGeo: THREE.BufferGeometry | null = null;
function cylDisc(): THREE.BufferGeometry { if (!discGeo) { discGeo = new THREE.CylinderGeometry(1, 1, 0.01, 14); discGeo.userData.shared = true; } return discGeo; }
/** Tyre marks, an oil puddle, scattered glass and a warning triangle for a road accident. */
export function buildAccidentDetail(seed: number): THREE.Group {
  const g = new THREE.Group();
  const skid = lambert(0x16171a);
  for (const z of [-0.7, 0.7]) box(g, 9, 0.02, 0.22, skid, -5.5, 0.03, z + (seed % 3) * 0.1);
  const oil = new THREE.Mesh(cylDisc(), lambert(0x101215)); oil.scale.set(1.3, 1, 0.9); oil.position.set(1.8, 0.03, -1.6); g.add(oil);
  for (let i = 0; i < 16; i++) box(g, 0.08 + (i % 3) * 0.04, 0.03, 0.08 + (i % 2) * 0.05, lambert(0xcfe6ee), Math.cos(i * 2.4 + seed) * 2.2 + 1, 0.04, Math.sin(i * 1.7 + seed) * 2.0);
  const tri = new THREE.Group();
  for (const a of [0, 2.094, 4.188]) box(tri, 0.7, 0.05, 0.06, lambert(0xd8352f), Math.cos(a) * 0.18, 0.4, Math.sin(a) * 0.18).rotation.y = -a + 1.57;
  tri.position.set(-9, 0, 0.8);
  g.add(tri);
  return g;
}
/** Traffic cone with a reflective band. */
export function buildCone(): THREE.Group {
  const g = new THREE.Group();
  const o = lambert(0xff6a1a);
  box(g, 0.34, 0.04, 0.34, lambert(0x222222), 0, 0.02, 0);
  box(g, 0.2, 0.3, 0.2, o, 0, 0.2, 0);
  box(g, 0.12, 0.28, 0.12, o, 0, 0.45, 0);
  box(g, 0.15, 0.07, 0.15, lambert(0xf4f4f0), 0, 0.4, 0);
  return g;
}
/** A road flare: a short red stick that glows. */
export function buildFlare(): THREE.Group {
  const g = new THREE.Group();
  box(g, 0.05, 0.3, 0.05, glow(0xff2a1a, 1.4), 0, 0.15, 0);
  return g;
}

function antennaExtras(g: THREE.Group, L: number, _W: number, H: number): void {
  box(g, 0.05, 1.0, 0.05, lambert(0x222222), -L * 0.3, H + 0.55, 0);
  box(g, 1.1, 0.12, 0.7, lambert(0xdadada), -L * 0.05, H + 0.07, 0);
}
function crossExtras(g: THREE.Group, L: number, W: number, H: number): void {
  const red = lambert(0xd32f2f);
  for (const s of [-1, 1]) { // star-of-life substitute: red cross on both sides
    box(g, L * 0.16, 0.14, 0.03, red, -L * 0.12, H * 0.62, s * (W / 2 + 0.02));
    box(g, 0.14, L * 0.16, 0.03, red, -L * 0.12, H * 0.62, s * (W / 2 + 0.02));
  }
}
function ambulanceExtras(g: THREE.Group, L: number, W: number, H: number): void {
  crossExtras(g, L, W, H);
  const mat = lambert(0xf0efe8);
  for (const s of [-1, 1]) { // rear doors, hinged at the corners; opened by the renderer while a patient is loaded
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? 'rdoorL' : 'rdoorR';
    pivot.position.set(-L / 2 - 0.04, H * 0.46, s * (W / 2 - 0.05));
    box(pivot, 0.06, H * 0.72, W / 2 - 0.1, mat, 0, 0, -s * (W / 4 - 0.05));
    g.add(pivot);
  }
  box(g, 0.1, 0.5, W * 0.6, lambert(0x2c3138), -L / 2 - 0.02, 0.5, 0); // rear step
}
/** Telescopic mast with four floodlight heads on the load bed. */
function lightMastExtras(g: THREE.Group, L: number, _W: number, H: number): void {
  box(g, 0.14, 2.6, 0.14, lambert(0xcfcfcf), -L * 0.2, H + 1.3, 0);
  box(g, 1.1, 0.12, 0.12, lambert(0x333333), -L * 0.2, H + 2.65, 0);
  box(g, 0.12, 0.12, 1.1, lambert(0x333333), -L * 0.2, H + 2.7, 0);
  for (const [dx, dz] of [[-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]) box(g, 0.3, 0.2, 0.3, glow(0xfff6d0, 1.4), -L * 0.2 + dx, H + 2.45, dz);
}
function copiExtras(g: THREE.Group, L: number, W: number, H: number): void {
  antennaExtras(g, L, W, H);
  box(g, 1.4, 0.2, 0.6, lambert(0xdadada), L * 0.1, H + 0.12, 0.5); // roof mast base
  box(g, 0.05, 1.8, 0.05, lambert(0x222222), L * 0.1, H + 1.0, 0.5);
  box(g, 0.9, 0.5, 0.05, lambert(0x0f6fb3), -L * 0.15, H * 0.6, W / 2 + 0.03); // "CoPI" board
  box(g, 0.9, 0.5, 0.05, lambert(0x0f6fb3), -L * 0.15, H * 0.6, -(W / 2 + 0.03));
}
function hazmatExtras(g: THREE.Group, L: number, W: number, H: number): void {
  const grey = lambert(0xb9bec4), dark = lambert(0x2a2c30);
  for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.5, 12), grey); c.rotation.x = Math.PI / 2; c.position.set(-L * 0.38 + i * 1.1, H + 0.3, 0); g.add(c); }
  box(g, L * 0.5, 0.1, W * 0.9, dark, -L * 0.12, H + 0.04, 0);
  for (const s of [-1, 1]) box(g, L * 0.4, H * 0.3, 0.05, lambert(0xffd21a), -L * 0.2, H * 0.55, s * (W / 2 + 0.03)); // hazard panels
}
function tankerExtras(g: THREE.Group, L: number, W: number, H: number): void {
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.46, W * 0.46, L * 0.58, 20), lambert(0xd8dde2));
  tank.rotation.z = Math.PI / 2; tank.position.set(-L * 0.17, H + W * 0.3, 0); g.add(tank);
  for (const s of [-1, 1]) box(g, L * 0.5, 0.08, 0.06, lambert(0xc95a0c), -L * 0.17, H + W * 0.3, s * W * 0.46);
  box(g, 0.5, 0.3, 0.5, lambert(0x555a60), -L * 0.17, H + W * 0.8, 0); // manhole
}
function riotExtras(g: THREE.Group, L: number, W: number, H: number): void {
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) box(g, 0.7, 0.04, 0.03, lambert(0x0c0f1c), -L * 0.15 - i * 0.3, H * 0.62, s * (W / 2 + 0.02)); // grilles over the windows
  box(g, W * 0.7, 0.3, 0.2, lambert(0x14182c), L / 2 - 0.05, 0.8, 0); // push bar
}
function hearseExtras(g: THREE.Group, L: number, W: number, H: number): void {
  const chrome = lambert(0xcfd3d8);
  box(g, L * 0.42, H * 0.34, W + 0.03, glassMat(), -L * 0.22, H * 0.55, 0); // long rear windows
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) box(g, 0.05, 0.05, 0.05, chrome, -L * 0.1 - i * 0.7, H * 0.78, s * (W / 2 + 0.03));
  box(g, 0.08, 0.5, W * 0.7, chrome, -L / 2 - 0.02, H * 0.45, 0); // rear trim
  box(g, 0.9, 0.06, 0.5, lambert(0xe8e0d0), -L * 0.25, H * 0.35, 0); // a wreath-coloured sill
}
function towExtras(g: THREE.Group, L: number, W: number, H: number): void {
  const dark = lambert(0x2b2b2b);
  box(g, L * 0.55, 0.14, W * 0.95, dark, -L * 0.18, H * 0.34, 0); // flatbed
  box(g, 0.1, 0.9, W * 0.9, dark, -L * 0.45, H * 0.34 + 0.42, 0); // headboard
  const boom = box(g, 0.14, 1.4, 0.14, lambert(0x777777), -L * 0.08, H * 0.34 + 0.7, 0);
  boom.rotation.z = 0.5;
}
function craneExtras(g: THREE.Group, L: number, W: number, H: number): void {
  const grey = lambert(0x777777), dark = lambert(0x2b2b2b);
  box(g, 1.3, 0.7, W * 0.9, dark, -L * 0.22, H * 0.62, 0); // slewing base
  const boom = box(g, L * 0.8, 0.28, 0.32, lambert(0xe5a91a), -L * 0.28, H * 0.62 + 1.0, 0);
  boom.rotation.z = 0.2;
  box(g, 0.05, 1.4, 0.05, grey, L * 0.07, H * 0.62 + 0.2, 0).rotation.z = 0;
  for (const s of [-1, 1]) box(g, 0.3, 0.2, 1.0, dark, -L * 0.3, 0.25, s * (W / 2 + 0.5));
}
function rackExtras(g: THREE.Group, L: number, _W: number, H: number): void {
  const grey = lambert(0xbbbbbb);
  box(g, L * 0.45, 0.06, 0.1, grey, -L * 0.18, H + 0.2, 0.55);
  box(g, L * 0.45, 0.06, 0.1, grey, -L * 0.18, H + 0.2, -0.55);
  box(g, 0.06, 0.2, 1.2, grey, -L * 0.36, H + 0.1, 0);
  box(g, 0.06, 0.2, 1.2, grey, 0, H + 0.1, 0);
}

/** Builds a vehicle model of the given footprint. */
export function buildVehicle(model: string, category: string, size: { length: number; width: number; height: number }): { group: THREE.Group; parts: VehicleParts } {
  const spec = SPECS[model] ?? FALLBACK[category] ?? SPECS['vehicle/service_van'];
  const { length: L, width: W, height: H } = size;
  const g = new THREE.Group();
  const parts: VehicleParts = { wheels: [], beacons: [] };
  const wr = spec.shape === 'bike' ? 0.34 : spec.shape === 'car' ? 0.34 : 0.5;
  const bodyMat = paint(spec.body), dark = lambert(0x24262a);
  const bottom = wr * 0.85;

  if (spec.shape === 'heli') return buildHelicopter(spec, L, W, H);

  if (spec.shape === 'bike') {
    const frame = box(g, L * 0.55, 0.28, 0.28, bodyMat, 0, 0.62, 0);
    frame.rotation.z = 0.04;
    box(g, L * 0.22, 0.5, 0.34, bodyMat, L * 0.25, 0.7, 0); // fairing
    box(g, 0.06, 0.4, 0.5, dark, L * 0.3, 1.0, 0); // handlebar
    box(g, L * 0.25, 0.14, 0.34, dark, -L * 0.1, 0.84, 0); // seat
    box(g, 0.34, 0.32, 0.4, bodyMat, -L * 0.38, 0.75, 0); // pannier
    box(g, 0.12, 0.12, 0.3, glow(0xfff3c0, 1), L * 0.37, 0.8, 0);
    for (const x of [-L * 0.34, L * 0.34]) {
      const w = new THREE.Mesh(wheelGeo(wr, 0.18), lambert(TYRE));
      w.position.set(x, wr, 0); g.add(w); parts.wheels.push(w);
    }
    const bl = box(g, 0.16, 0.12, 0.2, glow(spec.accent, 0.3), -L * 0.38, 1.0, 0);
    parts.beacons.push({ mesh: bl, on: 1.6, off: 0.1, phase: 0 });
    return { group: g, parts };
  }

  // ---- chassis / body proportions (rounded bodywork, tilted windscreens, side glass)
  const glassM = glassMat(), paintBody = paint(spec.body), paintCab = paint(spec.cab ?? spec.body), chrome = lambert(CHROME);
  let bodyH = H * 0.8, cabH = H * 0.8, bodyL = L, cabL = L * 0.3;
  let doorX = 0, doorLen = 1.2, mirrorX = 0, mirrorY = 0, frontBottom = bottom;
  if (spec.shape === 'truck') {
    cabL = L * 0.3; bodyL = L * 0.68; cabH = H * 0.78; bodyH = H * 0.92;
    const bodyX = -L / 2 + bodyL / 2, cabX = L / 2 - cabL / 2;
    box(g, L * 0.98, 0.3, W * 0.82, dark, 0, bottom + 0.15, 0); // chassis rail
    rbox(g, bodyL, bodyH - bottom - 0.2, W, 0.14, paintBody, bodyX, bottom + 0.2 + (bodyH - bottom - 0.2) / 2, 0);
    rbox(g, cabL, cabH - bottom - 0.2, W * 0.98, 0.22, paintCab, cabX, bottom + 0.2 + (cabH - bottom - 0.2) / 2, 0);
    const ws = box(g, 0.05, cabH * 0.4, W * 0.86, glassM, L / 2 - 0.12, cabH * 0.7, 0); ws.rotation.z = 0.3; // raked windscreen
    for (const s2 of [-1, 1]) {
      rbox(g, cabL * 0.55, cabH * 0.3, 0.05, 0.05, glassM, cabX + 0.05, cabH * 0.7, s2 * (W * 0.49 + 0.012));
      box(g, 0.03, cabH * 0.55, 0.03, dark, cabX - cabL * 0.12, cabH * 0.5, s2 * (W * 0.49 + 0.015)); // door seam
    }
    rbox(g, 0.22, 0.36, W * 0.94, 0.08, chrome, L / 2 + 0.02, bottom + 0.22, 0); // bumper
    box(g, 0.04, 0.34, W * 0.5, dark, L / 2 - 0.02, cabH * 0.38, 0); // grille
    for (let i = 0; i < 4; i++) box(g, 0.045, 0.02, W * 0.5, chrome, L / 2 - 0.01, cabH * 0.28 + i * 0.07, 0);
    doorX = cabX; doorLen = cabL; mirrorX = L / 2 - cabL * 0.9; mirrorY = cabH * 0.62; frontBottom = bottom + 0.2;
  } else if (spec.shape === 'van') {
    const hood = L * 0.18;
    bodyL = L - hood; bodyH = H * 0.88; cabH = bodyH; cabL = L * 0.22;
    rbox(g, bodyL, bodyH - bottom, W, 0.2, paintBody, -L / 2 + bodyL / 2, bottom + (bodyH - bottom) / 2, 0);
    rbox(g, hood, bodyH * 0.55 - bottom, W * 0.98, 0.18, paintBody, L / 2 - hood / 2, bottom + (bodyH * 0.55 - bottom) / 2, 0);
    const ws = box(g, 0.05, bodyH * 0.36, W * 0.88, glassM, L / 2 - hood - 0.02, bodyH * 0.72, 0); ws.rotation.z = 0.5;
    for (const s2 of [-1, 1]) {
      rbox(g, cabL * 0.6, bodyH * 0.3, 0.05, 0.05, glassM, L / 2 - hood - cabL * 0.35, bodyH * 0.72, s2 * (W / 2 + 0.012));
      box(g, 0.03, bodyH * 0.6, 0.03, dark, L / 2 - hood - cabL * 0.8, bodyH * 0.45, s2 * (W / 2 + 0.015));
      box(g, 0.03, bodyH * 0.6, 0.03, dark, -L * 0.18, bodyH * 0.5, s2 * (W / 2 + 0.015));
    }
    rbox(g, 0.18, 0.32, W * 0.94, 0.07, chrome, L / 2 + 0.02, bottom + 0.15, 0);
    box(g, 0.04, 0.26, W * 0.5, dark, L / 2 - 0.01, bodyH * 0.28, 0);
    doorX = L / 2 - hood - cabL * 0.35; doorLen = cabL; mirrorX = L / 2 - hood - cabL * 0.7; mirrorY = bodyH * 0.62;
  } else { // car: low body, tapered cabin, raked glass
    const hoodL = L * 0.28, trunkL = L * 0.2;
    const lowH = H * 0.42;
    rbox(g, L, lowH - bottom, W, 0.2, paintBody, 0, bottom + (lowH - bottom) / 2, 0);
    const cabinL = L - hoodL - trunkL;
    const cabX = -L / 2 + trunkL + cabinL / 2 - 0.1;
    rbox(g, cabinL * 0.86, H * 0.36, W * 0.88, 0.16, paintBody, cabX, lowH + H * 0.16, 0);
    const wf = box(g, 0.05, H * 0.3, W * 0.8, glassM, cabX + cabinL * 0.43 + 0.06, lowH + H * 0.17, 0); wf.rotation.z = 0.62;
    const wr2 = box(g, 0.05, H * 0.28, W * 0.8, glassM, cabX - cabinL * 0.43 - 0.04, lowH + H * 0.17, 0); wr2.rotation.z = -0.6;
    for (const s2 of [-1, 1]) {
      rbox(g, cabinL * 0.72, H * 0.24, 0.05, 0.05, glassM, cabX, lowH + H * 0.18, s2 * (W * 0.44 + 0.012));
      box(g, 0.03, lowH * 0.9, 0.03, dark, cabX, lowH * 0.62, s2 * (W / 2 + 0.012)); // door seam
    }
    rbox(g, 0.14, 0.24, W * 0.96, 0.06, chrome, L / 2, bottom + 0.1, 0);
    rbox(g, 0.14, 0.24, W * 0.96, 0.06, chrome, -L / 2, bottom + 0.1, 0);
    box(g, 0.04, 0.16, W * 0.46, dark, L / 2 - 0.01, lowH * 0.62, 0); // grille
    doorX = cabX; doorLen = cabinL * 0.5; mirrorX = cabX + cabinL * 0.36; mirrorY = lowH + H * 0.1; frontBottom = bottom;
  }
  void cabL; void bodyL; void frontBottom;
  // wing mirrors, door handles, number plates (Dutch yellow)
  for (const s2 of [-1, 1]) {
    rbox(g, 0.14, 0.2, 0.08, 0.03, dark, mirrorX, mirrorY, s2 * (W / 2 + 0.14));
    box(g, 0.05, 0.05, 0.05, dark, mirrorX, mirrorY - 0.08, s2 * (W / 2 + 0.06));
    box(g, doorLen * 0.18, 0.04, 0.035, chrome, doorX + doorLen * 0.18, spec.shape === 'car' ? H * 0.3 : bodyH * 0.5, s2 * (W / 2 + 0.02));
  }
  box(g, 0.03, 0.14, 0.5, lambert(0xf2c21b), L / 2 + 0.12, bottom + 0.2, 0);
  box(g, 0.03, 0.14, 0.5, lambert(0xf2c21b), -L / 2 - 0.12, bottom + 0.2, 0);

  // ---- livery: stripes on both sides
  if (spec.stripe) {
    const sy = spec.shape === 'car' ? H * 0.28 : bodyH * 0.45;
    const sl = spec.shape === 'truck' ? L * 0.68 : spec.shape === 'van' ? L * 0.8 : L * 0.96;
    const sx = spec.shape === 'truck' ? -L / 2 + sl / 2 : spec.shape === 'van' ? -L * 0.1 : 0;
    for (const s of [-1, 1]) {
      box(g, sl, 0.22, 0.03, lambert(spec.stripe), sx, sy, s * (W / 2 + 0.015));
      if (spec.stripe2) box(g, sl, 0.1, 0.03, lambert(spec.stripe2), sx, sy - 0.2, s * (W / 2 + 0.015));
    }
  }

  // ---- wheels: tyre, alloy rim with spokes, dark arch behind
  const axles: number[] = spec.wheels === 3 ? [L / 2 - L * 0.17, -L / 2 + L * 0.34, -L / 2 + L * 0.14] : [L / 2 - L * 0.2, -L / 2 + L * 0.2];
  addWheels(g, parts, axles, wr, W, 0.32);

  // ---- head and tail lights
  const hl = glow(0xfff3c0, 1.1), tl = glow(0xff2a1a, 0.9);
  const lampY = spec.shape === 'car' ? H * 0.28 : H * 0.28;
  for (const s of [-1, 1]) {
    box(g, 0.06, 0.16, 0.28, hl, L / 2 + 0.01, lampY, s * W * 0.34);
    box(g, 0.06, 0.16, 0.28, tl, -L / 2 - 0.01, lampY, s * W * 0.34);
  }

  // ---- emergency light bar (two halves that alternate)
  const roofY = (spec.shape === 'car' ? H * 0.76 : spec.shape === 'van' ? H * 0.88 : (spec.shape === 'truck' ? H * 0.78 : H));
  const barX = spec.shape === 'truck' ? L / 2 - L * 0.15 : spec.shape === 'van' ? L * 0.05 : -L * 0.02;
  box(g, 0.3, 0.06, W * 0.7, dark, barX, roofY + 0.03, 0);
  const l = box(g, 0.28, 0.16, W * 0.32, glow(spec.accent, 0.3), barX, roofY + 0.14, -W * 0.18);
  const r = box(g, 0.28, 0.16, W * 0.32, glow(spec.accent2, 0.3), barX, roofY + 0.14, W * 0.18);
  l.material = own(l.material as THREE.Material); r.material = own(r.material as THREE.Material);
  parts.beacons.push({ mesh: l, on: 2.2, off: 0.15, phase: 0 }, { mesh: r, on: 2.2, off: 0.15, phase: 1 });
  if (category === 'fire' || spec.shape === 'truck') { // rear flashers
    const f1 = box(g, 0.1, 0.12, 0.2, glow(spec.accent, 0.3), -L / 2 - 0.02, H * 0.8, -W * 0.3);
    const f2 = box(g, 0.1, 0.12, 0.2, glow(spec.accent2, 0.3), -L / 2 - 0.02, H * 0.8, W * 0.3);
    f1.material = own(f1.material as THREE.Material); f2.material = own(f2.material as THREE.Material);
    parts.beacons.push({ mesh: f1, on: 2, off: 0.1, phase: 0 }, { mesh: f2, on: 2, off: 0.1, phase: 1 });
  }

  // ---- more light: grille strobes and a longer bar with extra lenses
  for (const s2 of [-1, 1]) {
    const gl = box(g, 0.05, 0.08, 0.18, glow(s2 < 0 ? spec.accent : spec.accent2, 0.3), L / 2 + 0.03, H * 0.42, s2 * W * 0.22);
    gl.material = own(gl.material as THREE.Material);
    parts.beacons.push({ mesh: gl, on: 2.4, off: 0.1, phase: s2 < 0 ? 0 : 1 });
  }
  for (const s2 of [-1, 1]) for (const k of [-1, 1]) {
    const lens = box(g, 0.1, 0.1, W * 0.12, glow(s2 < 0 ? spec.accent : spec.accent2, 0.3), barX + k * 0.1, roofY + 0.24, s2 * W * 0.3);
    lens.material = own(lens.material as THREE.Material);
    parts.beacons.push({ mesh: lens, on: 2.6, off: 0.1, phase: s2 < 0 ? 0 : 1 });
  }

  // ---- people inside: a driver (and a co-driver in vans and trucks) visible through the windows
  {
    const tone = [0xe8c39e, 0xd2a07a, 0xb27a56, 0xf2d3b3][category.length % 4];
    const unif = category === 'fire' ? 0x1f2430 : category === 'police' ? 0x1a2f6a : category === 'ambulance' ? 0x1f6fd0 : 0x2a2a2a;
    const hat = category === 'fire' ? 0xf2c230 : category === 'police' ? 0x1b2a55 : 0xf2f2f2;
    const dx = spec.shape === 'truck' ? L * 0.35 : spec.shape === 'van' ? L * 0.24 : L * 0.04;
    const seatY = spec.shape === 'car' ? H * 0.5 : H * 0.55;
    const seats = spec.shape === 'car' ? [-W * 0.22] : [-W * 0.22, W * 0.22];
    for (const z of seats) {
      const tors = new THREE.Mesh(boxGeo(0.28, 0.4, 0.4), lambert(unif)); tors.position.set(dx, seatY, z); g.add(tors);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), lambert(tone)); head.position.set(dx + 0.02, seatY + 0.32, z); g.add(head);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), lambert(hat)); cap.position.set(dx + 0.02, seatY + 0.36, z); g.add(cap);
    }
  }

  spec.extras?.(g, L, W, H, wr);
  return { group: g, parts };
}

/** Trauma helicopter: pod, tail boom, skids, spinning main and tail rotor, strobes. Nose points to +x. */
function buildHelicopter(spec: Spec, L: number, W: number, H: number): { group: THREE.Group; parts: VehicleParts } {
  const g = new THREE.Group();
  const parts: VehicleParts = { wheels: [], beacons: [], rotors: [] };
  const body = paint(spec.body), stripe = lambert(spec.stripe ?? 0xff7a1a), dark = lambert(0x24262a), glassM = glassMat();
  const ph = H * 1.05, py = 0.45 + ph / 2; // pod height / centre
  rbox(g, L * 0.34, ph, W * 0.9, 0.5, body, L * 0.12, py + 0.2, 0); // cabin pod
  rbox(g, L * 0.2, ph * 0.55, W * 0.84, 0.35, body, L * 0.33, py - 0.05, 0); // nose
  box(g, 0.06, ph * 0.55, W * 0.8, glassM, L * 0.43, py + 0.18, 0).rotation.z = 0.5; // windscreen
  for (const s2 of [-1, 1]) {
    rbox(g, L * 0.16, ph * 0.38, 0.05, 0.05, glassM, L * 0.2, py + 0.4, s2 * (W * 0.45 + 0.012));
    box(g, L * 0.34, 0.2, 0.03, stripe, L * 0.12, py - 0.2, s2 * (W * 0.45 + 0.015)); // livery band
    box(g, 0.04, 0.5, 0.04, dark, L * 0.04, 0.2, s2 * W * 0.4); // skid struts
    box(g, 0.04, 0.5, 0.04, dark, L * 0.22, 0.2, s2 * W * 0.4);
    box(g, L * 0.44, 0.09, 0.12, dark, L * 0.13, 0.08, s2 * W * 0.4); // skids
  }
  box(g, L * 0.42, 0.34, 0.34, body, -L * 0.28, py + 0.45, 0); // tail boom
  box(g, 0.1, 0.9, 0.3, body, -L * 0.48, py + 0.9, 0); // tail fin
  const hub = box(g, 0.3, 0.3, 0.3, dark, L * 0.1, py + ph / 2 + 0.55, 0);
  box(g, 0.14, 0.4, 0.14, dark, L * 0.1, py + ph / 2 + 0.3, 0); // mast
  const main = new THREE.Group(); main.position.copy(hub.position); g.add(main);
  for (let i = 0; i < 4; i++) { const b = box(main, L * 0.9, 0.04, 0.22, dark, 0, 0.18, 0); b.rotation.y = (i * Math.PI) / 2 + 0.2; b.position.set(0, 0.18, 0); b.geometry = b.geometry.clone(); b.geometry.translate(L * 0.45, 0, 0); }
  const tail = new THREE.Group(); tail.position.set(-L * 0.5, py + 0.9, W * 0.2); g.add(tail);
  for (let i = 0; i < 2; i++) { const b = box(tail, 0.05, 1.7, 0.16, dark, 0, 0, 0); b.rotation.z = (i * Math.PI) / 2; }
  parts.rotors!.push(main, tail);
  // strobes: belly + tail light, alternating blue / red
  const l = box(g, 0.24, 0.16, 0.24, glow(spec.accent, 0.3), L * 0.1, py + ph / 2 + 0.05, W * 0.3);
  const r = box(g, 0.24, 0.16, 0.24, glow(spec.accent2, 0.3), L * 0.1, py + ph / 2 + 0.05, -W * 0.3);
  l.material = own(l.material as THREE.Material); r.material = own(r.material as THREE.Material);
  parts.beacons.push({ mesh: l, on: 2.4, off: 0.15, phase: 0 }, { mesh: r, on: 2.4, off: 0.15, phase: 1 });
  box(g, 0.06, 0.14, 0.3, glow(0xfff3c0, 1.2), L * 0.46, py - 0.15, 0); // landing light
  return { group: g, parts };
}

/** Wheels (tyre + rim with spokes + hub) on both sides at the given x positions, plus a dark wheel arch each. */
function addWheels(g: THREE.Group, parts: VehicleParts, axles: number[], wr: number, W: number, width: number): void {
  const tyre = lambert(TYRE), rim = lambert(RIM), dk = lambert(0x0c0c0e);
  for (const ax of axles) for (const s2 of [-1, 1]) {
    const arch = new THREE.Mesh(wheelGeo(wr + 0.09, 0.05), dk);
    arch.position.set(ax, wr, s2 * (W / 2 + 0.005)); g.add(arch);
    const w = new THREE.Mesh(wheelGeo(wr, width), tyre);
    w.position.set(ax, wr, s2 * (W / 2 - width * 0.4));
    g.add(w); parts.wheels.push(w);
    const face = new THREE.Mesh(wheelGeo(wr * 0.62, width + 0.02), rim);
    w.add(face);
    const hub = new THREE.Mesh(wheelGeo(wr * 0.16, width + 0.06), dk);
    w.add(hub);
    for (let i = 0; i < 5; i++) { // spokes on the outer face
      const sp = box(w, wr * 0.9, 0.03, 0.03, dk, 0, 0, s2 * (width / 2 + 0.012));
      sp.rotation.z = (i / 5) * Math.PI * 2 + 0.3;
      sp.position.set(Math.cos(sp.rotation.z) * wr * 0.25, Math.sin(sp.rotation.z) * wr * 0.25, s2 * (width / 2 + 0.012));
    }
  }
}

// ---------- civilian cars ----------
const CAR_PALETTE = [0xb03030, 0x2a5cb8, 0x2a7d4f, 0xdcb830, 0x6e4cb0, 0xe07c1e, 0xe9e9e9, 0x24282f, 0x8d9199, 0x6e4426];

/** A civilian car: sedan, hatchback or delivery van, chosen from the numeric id in the model string. */
export function buildCivilianCar(model: string, id: number, type: 'car' | 'van' | 'bike' = 'car'): { group: THREE.Group; parts: VehicleParts } {
  if (type === 'bike') return buildBicycle(id);
  const num = parseInt(model.replace(/\D+/g, ''), 10);
  const color = CAR_PALETTE[((Number.isFinite(num) ? num : 0) * 3 + id) % CAR_PALETTE.length];
  const kind = type === 'van' ? 'van' : id % 3 === 0 ? 'hatch' : 'sedan';
  const g = new THREE.Group();
  const parts: VehicleParts = { wheels: [], beacons: [] };
  const body = paint(color), glass = glassMat(), dark = lambert(0x24262a), chrome = lambert(CHROME);
  const L = kind === 'van' ? 5.2 : kind === 'hatch' ? 3.9 : 4.4, W = 1.8, wr = 0.32;
  if (kind === 'van') {
    rbox(g, L - 1.2, 1.3, W, 0.16, body, -0.6, 0.35 + 0.65, 0);
    rbox(g, 1.5, 0.75, W * 0.98, 0.14, body, L / 2 - 0.75, 0.35 + 0.37, 0);
    const ws = box(g, 0.05, 0.6, W * 0.84, glass, L / 2 - 1.5, 1.45, 0); ws.rotation.z = 0.5;
    for (const s2 of [-1, 1]) {
      rbox(g, 0.9, 0.42, 0.05, 0.04, glass, L / 2 - 1.9, 1.42, s2 * (W / 2 + 0.012));
      box(g, 0.03, 1.1, 0.03, dark, L / 2 - 2.5, 0.95, s2 * (W / 2 + 0.012));
      rbox(g, 0.12, 0.18, 0.08, 0.03, dark, L / 2 - 1.55, 1.1, s2 * (W / 2 + 0.14));
    }
    box(g, 0.04, 0.2, W * 0.55, dark, L / 2 - 0.01, 0.55, 0);
  } else {
    const lowH = 0.64;
    rbox(g, L, lowH - 0.22, W, 0.18, body, 0, 0.22 + (lowH - 0.22) / 2, 0);
    const cabinL = kind === 'hatch' ? L * 0.58 : L * 0.46;
    const cx = kind === 'hatch' ? -L * 0.1 : -L * 0.07;
    rbox(g, cabinL * 0.9, 0.5, W * 0.86, 0.14, body, cx, lowH + 0.22, 0);
    const wf = box(g, 0.05, 0.42, W * 0.78, glass, cx + cabinL * 0.45 + 0.08, lowH + 0.22, 0); wf.rotation.z = 0.62;
    const wb = box(g, 0.05, 0.4, W * 0.78, glass, cx - cabinL * 0.45 - 0.06, lowH + 0.22, 0); wb.rotation.z = kind === 'hatch' ? -0.9 : -0.6;
    for (const s2 of [-1, 1]) {
      rbox(g, cabinL * 0.74, 0.32, 0.05, 0.04, glass, cx, lowH + 0.24, s2 * (W * 0.43 + 0.012));
      box(g, 0.03, 0.4, 0.03, dark, cx, 0.5, s2 * (W / 2 + 0.012));
      rbox(g, 0.12, 0.08, 0.1, 0.03, dark, cx + cabinL * 0.38, lowH + 0.08, s2 * (W / 2 + 0.12)); // mirror
    }
    box(g, 0.04, 0.14, W * 0.46, dark, L / 2 - 0.01, 0.46, 0); // grille
    rbox(g, 0.14, 0.2, W * 0.96, 0.05, chrome, L / 2, 0.28, 0);
    rbox(g, 0.14, 0.2, W * 0.96, 0.05, chrome, -L / 2, 0.28, 0);
  }
  box(g, 0.03, 0.12, 0.46, lambert(0xf2c21b), L / 2 + 0.1, 0.3, 0);
  box(g, 0.03, 0.12, 0.46, lambert(0xf2c21b), -L / 2 - 0.1, 0.3, 0);
  addWheels(g, parts, [L / 2 - 0.85, -L / 2 + 0.85], wr, W, 0.24);
  // lights: head lights, brake lights (own material, brighter when braking) and amber indicators at all four corners
  const brakeMat = own(glow(0xff2a1a, 0.5)) as THREE.MeshStandardMaterial, blinkL = own(glow(0xffa000, 0.05)) as THREE.MeshStandardMaterial, blinkR = own(glow(0xffa000, 0.05)) as THREE.MeshStandardMaterial;
  for (const s2 of [-1, 1]) {
    box(g, 0.05, 0.12, 0.26, glow(0xfff3c0, 0.9), L / 2 + 0.01, 0.5, s2 * W * 0.32);
    box(g, 0.05, 0.12, 0.26, brakeMat, -L / 2 - 0.01, 0.5, s2 * W * 0.32);
    const bm = s2 < 0 ? blinkL : blinkR;
    box(g, 0.05, 0.08, 0.14, bm, L / 2 + 0.01, 0.42, s2 * W * 0.44);
    box(g, 0.05, 0.08, 0.14, bm, -L / 2 - 0.01, 0.42, s2 * W * 0.44);
  }
  parts.brake = brakeMat; parts.blinkL = blinkL; parts.blinkR = blinkR;
  return { group: g, parts };
}

/** A bicycle with a rider (the Dutch way): frame, two spoked wheels, handlebar, rider in a jacket. */
export function buildBicycle(id: number): { group: THREE.Group; parts: VehicleParts } {
  const g = new THREE.Group();
  const parts: VehicleParts = { wheels: [], beacons: [] };
  const frameCol = [0x2a2a30, 0x8a1c1c, 0x1c4a8a, 0x2d6a3a, 0xcfcfcf][id % 5];
  const frame = lambert(frameCol), dark = lambert(0x15151a);
  const wr = 0.34;
  for (const x of [-0.62, 0.62]) {
    const w = new THREE.Mesh(wheelGeo(wr, 0.05), lambert(0x1a1a1c));
    w.position.set(x, wr, 0); g.add(w); parts.wheels.push(w);
    const hub = new THREE.Mesh(wheelGeo(wr * 0.82, 0.02), lambert(0xb8bcc2)); w.add(hub);
    hub.scale.set(1, 1, 0.5);
  }
  box(g, 1.2, 0.05, 0.05, frame, 0, 0.62, 0).rotation.z = 0.12;
  box(g, 0.05, 0.55, 0.05, frame, 0.55, 0.65, 0); // fork / steering column
  box(g, 0.05, 0.5, 0.05, frame, -0.35, 0.6, 0); // seat tube
  box(g, 0.08, 0.04, 0.55, dark, 0.58, 0.95, 0); // handlebar
  box(g, 0.28, 0.07, 0.16, dark, -0.4, 0.88, 0); // saddle
  box(g, 0.4, 0.04, 0.3, frame, -0.82, 0.62, 0); // rear carrier
  // rider
  const jacket = lambert([0x2a5a8a, 0x8a2a2a, 0x2a2a2a, 0x3a6a3a, 0xc9a02a][id % 5]);
  rbox(g, 0.28, 0.55, 0.42, 0.1, jacket, -0.28, 1.2, 0).rotation.z = -0.28; // torso leaning forward
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), lambert(0xe0b894)); head.position.set(-0.05, 1.62, 0); g.add(head);
  if (id % 3 === 0) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), lambert(0xf2f2f2)); h.position.set(-0.05, 1.66, 0); g.add(h); }
  for (const s2 of [-1, 1]) {
    box(g, 0.45, 0.1, 0.1, lambert(0x2a2f3a), 0.02, 0.8, s2 * 0.12).rotation.z = 0.5; // legs on the pedals
    box(g, 0.5, 0.08, 0.08, jacket, 0.25, 1.28, s2 * 0.26).rotation.z = -0.45; // arms to the handlebar
  }
  box(g, 0.05, 0.1, 0.1, glow(0xff2a1a, 0.9), -1.0, 0.7, 0); // rear lamp
  box(g, 0.05, 0.1, 0.12, glow(0xfff3c0, 0.9), 0.62, 0.95, 0); // front lamp
  return { group: g, parts };
}

// ---------- incident props ----------
/** A crashed car: tilted, darkened, with a crumpled front. */
export function buildWreck(seed: number): THREE.Group {
  const { group } = buildCivilianCar(`vehicle/civilian_${seed % 6}`, seed);
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material instanceof THREE.MeshLambertMaterial || m.material instanceof THREE.MeshStandardMaterial) && (m.material as THREE.MeshStandardMaterial).emissive.getHex() === 0 && !m.userData.dim) {
      const dim = m.material.clone();
      dim.userData = {};
      dim.color.multiplyScalar(0.55);
      m.material = dim; m.userData.dim = true;
    }
  });
  group.rotation.z = 0.12 + (seed % 3) * 0.06;
  group.rotation.x = ((seed % 2) - 0.5) * 0.14;
  return group;
}
/**
 * Crash details on a wreck: amber hazard lights that blink, a deployed airbag behind the windscreen and short-circuit sparks.
 * The renderer animates everything tagged in userData.blink / userData.spark.
 */
export function addCrashFx(wreck: THREE.Group, seed: number): void {
  const fx = new THREE.Group();
  fx.name = 'crashfx';
  for (const [x, z] of [[2.0, 0.8], [2.0, -0.8], [-2.0, 0.8], [-2.0, -0.8]]) {
    const lamp = box(fx, 0.12, 0.14, 0.2, own(glow(0xffa000, 0.2)), x, 0.62, z);
    lamp.userData.blink = true;
  }
  if (seed % 3 !== 0) { // airbag
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), lambert(0xf2f2ee));
    bag.scale.set(0.8, 0.9, 1.2); bag.position.set(0.55, 0.95, seed % 2 ? 0.35 : -0.35); fx.add(bag);
  }
  for (let i = 0; i < 4; i++) {
    const sp = box(fx, 0.06, 0.06, 0.06, own(glow(0xffd070, 2.2)), -0.4 + i * 0.5, 0.18, (i % 2 ? 1 : -1) * 0.55);
    sp.userData.spark = i;
  }
  wreck.add(fx);
}
/** A lorry lying on its side across the carriageway, wheels in the air. */
export function buildOverturnedTruck(seed: number): THREE.Group {
  const { group } = buildVehicle('vehicle/service_van', 'tech', { length: 7.5, width: 2.5, height: 3.1 });
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material instanceof THREE.MeshStandardMaterial && m.material.emissive.getHex() === 0) {
      const dim = m.material.clone(); dim.userData = {}; dim.color.multiplyScalar(0.6); m.material = dim;
    }
  });
  const g = new THREE.Group();
  group.rotation.x = Math.PI / 2 + 0.05; // on its side
  group.position.y = 1.3;
  g.add(group);
  g.rotation.y = seed * 0.7;
  return g;
}
/** Picket signs and a banner for a demonstration: placed amongst the crowd. */
const SLOGANS = ['NIET IN ONZE BUURT', 'GENOEG GEPRAAT', 'WIJ BLIJVEN', 'HOREN AAN ONS', 'STOP HET PLAN', 'SAMEN STERK'];
export function buildDemonstration(seed: number): THREE.Group {
  const g = new THREE.Group();
  const wood = lambert(0x8a6a44);
  const board = (text: string, color: string): THREE.Material => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#111'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const words = text.split(' ');
      words.forEach((w, i) => ctx.fillText(w, 128, 64 + (i - (words.length - 1) / 2) * 34));
    }
    return new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) });
  };
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + seed, r = 1.6 + (i % 3) * 0.9;
    const sign = new THREE.Group();
    box(sign, 0.05, 2.0, 0.05, wood, 0, 1.0, 0);
    const b = box(sign, 0.04, 0.55, 0.85, board(SLOGANS[(i + seed) % SLOGANS.length], ['#f2f0e6', '#ffe14a', '#f7b6b6', '#bfe3ff'][i % 4]), 0, 2.05, 0);
    b.rotation.x = ((i % 3) - 1) * 0.06;
    sign.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    sign.rotation.y = a + Math.PI / 2 + ((i % 3) - 1) * 0.5;
    g.add(sign);
  }
  box(g, 0.06, 2.3, 0.06, wood, -2.6, 1.15, -3.4); box(g, 0.06, 2.3, 0.06, wood, 2.6, 1.15, -3.4);
  box(g, 5.0, 0.9, 0.03, board('WIJ ZIJN ER KLAAR MEE', '#f2f2f2'), 0, 1.9, -3.4);
  return g;
}
/** A drifting cloud of toxic or flammable gas over a building (translucent puffs that slowly pulse). */
export function buildGasCloud(seed: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
    const s = 2.2 + ((i + seed) % 3) * 0.8;
    m.scale.set(s, s * 0.7, s);
    m.position.set(Math.cos(i * 2.3 + seed) * 3.2, 4 + (i % 3) * 0.8, Math.sin(i * 2.3 + seed) * 3.2);
    m.userData.puff = i;
    g.add(m);
  }
  return g;
}
/** A flat pool on the road: water (flooding) or oil. */
export function buildPuddle(kind: 'water' | 'oil', seed: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial(kind === 'water' ? { color: 0x3a78c8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.62 } : { color: 0x0b0b0e, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.88 });
  const n = kind === 'water' ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), mat);
    m.rotation.x = -Math.PI / 2;
    const r = kind === 'water' ? 3 + (i % 3) * 1.2 : 1.8 + (i % 2) * 0.8;
    m.scale.set(r, r * (0.7 + 0.1 * ((seed + i) % 3)), 1);
    m.position.set(Math.cos(i * 2.1 + seed) * (kind === 'water' ? 2.2 : 1.2), 0.05 + i * 0.003, Math.sin(i * 2.1 + seed) * (kind === 'water' ? 1.2 : 0.8));
    g.add(m);
  }
  return g;
}
/** Rubble where a building has partly come down: slabs, bricks, rebar and a cloud of dust. */
export function buildRubble(seed: number): THREE.Group {
  const g = new THREE.Group();
  const cols = [0x8a8a86, 0x6e6a64, 0x9a8f80, 0x55524e];
  for (let i = 0; i < 26; i++) {
    const s = 0.4 + ((i * 7 + seed) % 5) * 0.35;
    const m = box(g, s, s * 0.6, s * (0.7 + (i % 3) * 0.3), lambert(cols[i % 4]), Math.cos(i * 1.9 + seed) * (1 + i * 0.16), s * 0.3 + (i % 4) * 0.2, Math.sin(i * 1.9 + seed) * (1 + i * 0.12));
    m.rotation.set((i % 3) * 0.3, i * 1.1, (i % 4) * 0.25);
  }
  for (let i = 0; i < 6; i++) { const r = box(g, 0.04, 2.2, 0.04, lambert(0x6a3a22), Math.cos(i * 2.6) * 2.4, 1.2, Math.sin(i * 2.6) * 2.4); r.rotation.z = 0.5 - (i % 3) * 0.4; }
  const dust = new THREE.MeshBasicMaterial({ color: 0xbdb5a8, transparent: true, opacity: 0.25, depthWrite: false });
  for (let i = 0; i < 5; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), dust); d.scale.set(2.5, 1.6, 2.5); d.position.set(Math.cos(i * 2.4) * 2, 2 + (i % 2), Math.sin(i * 2.4) * 2); d.userData.puff = i; g.add(d); }
  return g;
}
export function buildFallenTree(seed: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(boxGeo(7, 0.7, 0.7), lambert(0x4e3a28));
  trunk.position.y = 0.4; g.add(trunk);
  for (let i = 0; i < 5; i++) {
    const crown = new THREE.Mesh(boxGeo(1.6, 1.2, 1.6), lambert(i % 2 ? 0x2f6b34 : 0x3a7a3c));
    crown.position.set(2.2 + (i % 3) * 0.6, 0.8 + (i % 2) * 0.35, (i - 2) * 0.55);
    crown.rotation.y = i + seed; g.add(crown);
  }
  return g;
}
export function buildBarrier(): THREE.Group {
  const g = new THREE.Group();
  const red = lambert(0xd8452f), white = lambert(0xf2f2f2), orange = lambert(0xff7a1a);
  for (let i = 0; i < 4; i++) box(g, 0.8, 0.22, 0.08, i % 2 ? red : white, (i - 1.5) * 0.8, 0.9, 0);
  for (const s of [-1.6, 1.6]) box(g, 0.08, 0.95, 0.08, white, s, 0.48, 0);
  for (const s of [-2.1, -0.7, 0.7, 2.1]) { const c = box(g, 0.28, 0.5, 0.28, orange, s, 0.25, 0.9); c.scale.set(1, 1, 1); box(g, 0.3, 0.1, 0.3, white, s, 0.38, 0.9); }
  return g;
}
export function buildDebris(seed: number): THREE.Group {
  const g = new THREE.Group();
  const cols = [0x555555, 0x777777, 0x333333, 0x8a6b4a];
  for (let i = 0; i < 7; i++) {
    const m = box(g, 0.2 + (i % 3) * 0.15, 0.08, 0.2 + ((i + seed) % 3) * 0.12, lambert(cols[i % cols.length]), Math.cos(i * 2.1 + seed) * 1.6, 0.05, Math.sin(i * 2.1 + seed) * 1.6);
    m.rotation.y = i * 1.3;
  }
  return g;
}

let beamTex: THREE.Texture | null = null;
function beamTexture(): THREE.Texture {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 128, 0, 0); // bright at the lamp (bottom), fading away
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128);
  ctx.globalCompositeOperation = 'destination-in'; // soft sides
  const s = ctx.createLinearGradient(0, 0, 64, 0);
  s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(0.5, 'rgba(0,0,0,1)'); s.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = s; ctx.fillRect(0, 0, 64, 128);
  beamTex = new THREE.CanvasTexture(c); beamTex.userData.shared = true; beamTex.colorSpace = THREE.SRGBColorSpace;
  return beamTex;
}
let beamMats: Record<string, THREE.MeshBasicMaterial> = {};
function beamMat(color: number, radial: boolean): THREE.MeshBasicMaterial {
  const k = color + (radial ? 'r' : 'b');
  if (!beamMats[k]) { const m = new THREE.MeshBasicMaterial({ map: radial ? softSpriteTexture() : beamTexture(), color, transparent: true, opacity: radial ? 0.5 : 0.8, depthWrite: false, blending: THREE.AdditiveBlending }); m.userData.shared = true; beamMats[k] = m; }
  return beamMats[k];
}
let beamGeoCache: THREE.PlaneGeometry | null = null;
/** Night effects of a vehicle: two headlight pools on the road ahead and (emergency vehicles) a flashing coloured glow around it. Hidden by day. */
export function buildNightFx(length: number, width: number, emergency: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = 'nightfx';
  if (!beamGeoCache) { beamGeoCache = new THREE.PlaneGeometry(1, 1); beamGeoCache.rotateX(-Math.PI / 2); beamGeoCache.rotateY(-Math.PI / 2); beamGeoCache.userData.shared = true; } // lies flat, texture runs away from the lamp along +x
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(beamGeoCache, beamMat(0xfff2c8, false));
    m.scale.set(8, 1, width * 0.8);
    m.position.set(length / 2 + 3.4, 0.07, s * width * 0.3);
    g.add(m);
  }
  if (emergency) for (const [i, col] of [0xff2a1a, 0x2a6aff].entries()) {
    const m = new THREE.Mesh(beamGeoCache, beamMat(col, true));
    m.scale.set(length * 2.8, 1, length * 2.8);
    m.position.set(i ? -length * 0.15 : length * 0.15, 0.08 + i * 0.002, 0);
    m.userData.flash = i;
    g.add(m);
  }
  g.visible = false;
  return g;
}

let floodGeo: THREE.CircleGeometry | null = null;
/** The big white pool of light a floodlight mast throws on the ground around the vehicle. */
export function buildFloodPool(): THREE.Mesh {
  if (!floodGeo) { floodGeo = new THREE.CircleGeometry(1, 24); floodGeo.rotateX(-Math.PI / 2); floodGeo.userData.shared = true; }
  const m = new THREE.Mesh(floodGeo, beamMat(0xfff4d6, true));
  m.scale.set(20, 1, 20);
  m.position.set(0, 0.09, 0);
  return m;
}

/** A soft round sprite texture for flames and smoke. */
export function softSpriteTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
