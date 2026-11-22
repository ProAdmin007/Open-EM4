import * as THREE from 'three';

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
function glow(color: number, intensity = 0.9): THREE.MeshStandardMaterial {
  const k = `g${color}:${intensity}`;
  let m = matCache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) { m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity }); m.userData.shared = true; matCache.set(k, m); }
  return m;
}

/** A private (non-shared) copy of a cached material, so it can be animated and disposed per vehicle. */
function own(m: THREE.Material): THREE.Material { const c = m.clone(); c.userData = {}; return c; }

const GLASS = 0x16222c, TYRE = 0x151515, RIM = 0x9aa0a6, CHROME = 0x6b7078;

function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export interface VehicleParts {
  /** wheel meshes (spin around their local Z while driving) */
  wheels: THREE.Mesh[];
  /** emergency lights: `phase` 0/1 alternate while the sirens are on */
  beacons: { mesh: THREE.Mesh; on: number; off: number; phase: 0 | 1 }[];
}

interface Spec {
  /** `truck` = cab + box body, `van` = one box with a short bonnet, `car` = low body with cabin, `bike` = motorcycle */
  shape: 'truck' | 'van' | 'car' | 'bike';
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
  'vehicle/ambulance': { shape: 'van', body: 0xf6f4ea, stripe: 0xff7a1a, stripe2: 0xffd21a, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2, extras: crossExtras },
  'vehicle/rapid_responder': { shape: 'car', body: 0xf6f4ea, stripe: 0xff7a1a, stripe2: 0xffd21a, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2 },
  'vehicle/mmt_car': { shape: 'car', body: 0xf6f4ea, stripe: 0xff7a1a, stripe2: 0xffd21a, accent: 0x2f6bff, accent2: 0x2f6bff, wheels: 2, extras: crossExtras },
  'vehicle/patrol_car': { shape: 'car', body: 0xf3f4f6, stripe: 0x1f4fb3, stripe2: 0xff8c1a, accent: 0x2f6bff, accent2: 0xff2a2a, wheels: 2 },
  'vehicle/police_van': { shape: 'van', body: 0x233f7a, stripe: 0xf3f4f6, stripe2: 0xff8c1a, accent: 0x2f6bff, accent2: 0xff2a2a, wheels: 2 },
  'vehicle/police_motorcycle': { shape: 'bike', body: 0xf3f4f6, stripe: 0x1f4fb3, accent: 0x2f6bff, accent2: 0xff2a2a, wheels: 2 },
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
  box(g, L * 0.62, 0.22, 0.12, grey, -L * 0.12, H + 0.32, 0.45);
  box(g, L * 0.62, 0.22, 0.12, grey, -L * 0.12, H + 0.32, -0.45);
  for (let i = 0; i < 12; i++) box(g, 0.06, 0.06, 0.9, grey, -L * 0.42 + i * (L * 0.052), H + 0.32, 0);
  box(g, 0.9, 0.35, W * 0.8, dark, -L * 0.36, H + 0.12, 0); // turntable
  for (const s of [-1, 1]) box(g, 0.25, 0.25, 0.9, dark, -L * 0.2, 0.3, s * (W / 2 + 0.45)); // outrigger pads
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
  const bodyMat = lambert(spec.body), cabMat = lambert(spec.cab ?? spec.body), glass = lambert(GLASS), dark = lambert(0x24262a);
  const bottom = wr * 0.85;

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

  // ---- chassis / body proportions
  let bodyH = H * 0.8, cabH = H * 0.8, bodyL = L, cabL = L * 0.3, bodyX = 0, cabX = 0;
  if (spec.shape === 'truck') {
    cabL = L * 0.3; bodyL = L * 0.68; cabH = H * 0.78; bodyH = H * 0.92;
    bodyX = -L / 2 + bodyL / 2; cabX = L / 2 - cabL / 2;
    box(g, L * 0.98, 0.3, W * 0.82, dark, 0, bottom + 0.15, 0); // chassis rail
    box(g, bodyL, bodyH - bottom - 0.2, W, bodyMat, bodyX, bottom + 0.2 + (bodyH - bottom - 0.2) / 2, 0);
    box(g, cabL, cabH - bottom - 0.2, W * 0.98, cabMat, cabX, bottom + 0.2 + (cabH - bottom - 0.2) / 2, 0);
    box(g, 0.06, cabH * 0.36, W * 0.88, glass, L / 2 - 0.04, cabH * 0.7, 0); // windscreen
    for (const s of [-1, 1]) box(g, cabL * 0.55, cabH * 0.3, 0.04, glass, cabX + 0.05, cabH * 0.7, s * (W * 0.49 + 0.01));
    box(g, 0.16, 0.34, W * 0.9, lambert(CHROME), L / 2, bottom + 0.2, 0); // bumper
  } else if (spec.shape === 'van') {
    const hood = L * 0.18;
    bodyL = L - hood; bodyH = H * 0.88; cabH = bodyH; cabL = L * 0.22;
    box(g, bodyL, bodyH - bottom, W, bodyMat, -L / 2 + bodyL / 2, bottom + (bodyH - bottom) / 2, 0);
    box(g, hood, bodyH * 0.55 - bottom, W * 0.98, bodyMat, L / 2 - hood / 2, bottom + (bodyH * 0.55 - bottom) / 2, 0);
    box(g, 0.06, bodyH * 0.34, W * 0.9, glass, L / 2 - hood - 0.02, bodyH * 0.72, 0);
    for (const s of [-1, 1]) box(g, cabL * 0.6, bodyH * 0.3, 0.04, glass, L / 2 - hood - cabL * 0.35, bodyH * 0.72, s * (W / 2 + 0.01));
    box(g, 0.14, 0.3, W * 0.92, lambert(CHROME), L / 2, bottom + 0.15, 0);
    bodyX = 0; cabX = 0;
  } else { // car
    const hoodL = L * 0.28, trunkL = L * 0.2;
    const lowH = H * 0.42;
    box(g, L, lowH - bottom, W, bodyMat, 0, bottom + (lowH - bottom) / 2, 0);
    const cabinL = L - hoodL - trunkL;
    box(g, cabinL, H * 0.34, W * 0.9, bodyMat, -L / 2 + trunkL + cabinL / 2 - 0.1, lowH + H * 0.17, 0);
    box(g, 0.05, H * 0.28, W * 0.82, glass, L / 2 - hoodL - 0.08, lowH + H * 0.17, 0);
    box(g, 0.05, H * 0.26, W * 0.82, glass, -L / 2 + trunkL - 0.1, lowH + H * 0.17, 0);
    for (const s of [-1, 1]) box(g, cabinL * 0.8, H * 0.24, 0.04, glass, -L * 0.02, lowH + H * 0.18, s * (W * 0.45 + 0.01));
    box(g, 0.12, 0.22, W * 0.96, lambert(CHROME), L / 2, bottom + 0.1, 0);
    box(g, 0.12, 0.22, W * 0.96, lambert(CHROME), -L / 2, bottom + 0.1, 0);
    bodyX = 0; cabX = 0;
  }
  void bodyX; void cabX; void cabL; void bodyL;

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

  // ---- wheels
  const axles: number[] = spec.wheels === 3 ? [L / 2 - L * 0.17, -L / 2 + L * 0.34, -L / 2 + L * 0.14] : [L / 2 - L * 0.2, -L / 2 + L * 0.2];
  for (const ax of axles) for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wheelGeo(wr, 0.32), lambert(TYRE));
    w.position.set(ax, wr, s * (W / 2 - 0.05));
    g.add(w); parts.wheels.push(w);
    const rim = new THREE.Mesh(wheelGeo(wr * 0.55, 0.34), lambert(RIM));
    w.add(rim);
  }

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

  spec.extras?.(g, L, W, H, wr);
  return { group: g, parts };
}

// ---------- civilian cars ----------
const CAR_PALETTE = [0xc23b3b, 0x2f66c9, 0x2e8b57, 0xe5c13a, 0x7e57c2, 0xf08a24, 0xe9e9e9, 0x2b2f3a, 0x8d9199, 0x7a4a2a];

/** A civilian car: sedan, hatchback or delivery van, chosen from the numeric id in the model string. */
export function buildCivilianCar(model: string, id: number): { group: THREE.Group; parts: VehicleParts } {
  const num = parseInt(model.replace(/\D+/g, ''), 10);
  const color = CAR_PALETTE[((Number.isFinite(num) ? num : 0) * 3 + id) % CAR_PALETTE.length];
  const kind = id % 5 === 0 ? 'van' : id % 3 === 0 ? 'hatch' : 'sedan';
  const g = new THREE.Group();
  const parts: VehicleParts = { wheels: [], beacons: [] };
  const body = lambert(color), glass = lambert(GLASS);
  const L = kind === 'van' ? 5.2 : kind === 'hatch' ? 3.9 : 4.4, W = 1.8, wr = 0.32;
  if (kind === 'van') {
    box(g, L, 1.25, W, body, -0.1, 0.35 + 0.62, 0);
    box(g, 1.2, 0.7, W * 0.98, body, L / 2 - 0.5, 0.35 + 0.35, 0);
    box(g, 0.05, 0.6, W * 0.86, glass, L / 2 - 1.1, 1.55, 0);
    box(g, L * 0.2, 0.04, W, lambert(0xffffff), -L * 0.3, 1.99, 0);
  } else {
    const lowH = 0.62;
    box(g, L, lowH - 0.25, W, body, 0, 0.25 + (lowH - 0.25) / 2, 0);
    const cabinL = kind === 'hatch' ? L * 0.62 : L * 0.5;
    box(g, cabinL, 0.5, W * 0.9, body, kind === 'hatch' ? -L * 0.08 : -L * 0.06, lowH + 0.25, 0);
    box(g, 0.05, 0.4, W * 0.8, glass, cabinL / 2 + (kind === 'hatch' ? -L * 0.08 : -L * 0.06) - 0.02, lowH + 0.27, 0);
    box(g, 0.05, 0.38, W * 0.8, glass, -cabinL / 2 + (kind === 'hatch' ? -L * 0.08 : -L * 0.06) + 0.02, lowH + 0.27, 0);
    for (const s of [-1, 1]) box(g, cabinL * 0.8, 0.34, 0.04, glass, (kind === 'hatch' ? -L * 0.08 : -L * 0.06), lowH + 0.27, s * (W * 0.45 + 0.01));
  }
  for (const s of [-1, 1]) {
    for (const ax of [L / 2 - 0.85, -L / 2 + 0.85]) {
      const w = new THREE.Mesh(wheelGeo(wr, 0.24), lambert(TYRE));
      w.position.set(ax, wr, s * (W / 2 - 0.04)); g.add(w); parts.wheels.push(w);
    }
    box(g, 0.05, 0.12, 0.26, glow(0xfff3c0, 0.9), L / 2 + 0.01, 0.5, s * W * 0.32);
    box(g, 0.05, 0.12, 0.26, glow(0xff2a1a, 0.7), -L / 2 - 0.01, 0.5, s * W * 0.32);
  }
  return { group: g, parts };
}

// ---------- incident props ----------
/** A crashed car: tilted, darkened, with a crumpled front. */
export function buildWreck(seed: number): THREE.Group {
  const { group } = buildCivilianCar(`vehicle/civilian_${seed % 6}`, seed);
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material instanceof THREE.MeshLambertMaterial && !m.userData.dim) {
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
