import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../sim/world';
import { TILE_METERS } from '../sim/space';
import { lambert } from './three-models';

/**
 * World dressing for the 3D view: a detailed baked ground (asphalt, pavements, kerbs, lane markings, zebra crossings,
 * bay lines), street furniture (lamps, hydrants, benches, bins, bus shelters), varied vegetation (broadleaf, conifer,
 * palm, bushes), per-type building details, and a day/night environment with sun, sky and shadows.
 * Inspired by the look of Emergency 4 city maps and the Los Angeles mod (palm trees, signs, cones/barriers).
 */

export const hash2 = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const rnd = (x: number, y: number, k = 0): number => (hash2(x + k * 131, y + k * 977) % 10000) / 10000;

// ---------------------------------------------------------------- batching helper
/** Collects geometry with a transform and colour, then emits one merged mesh per colour. */
export class Batch {
  private parts = new Map<number, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  add(geo: THREE.BufferGeometry, x: number, y: number, z: number, opts: { color: number; ry?: number; rz?: number; rx?: number; sx?: number; sy?: number; sz?: number } ): void {
    const g = geo.clone();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0, 'YXZ'));
    this.m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1));
    g.applyMatrix4(this.m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    let l = this.parts.get(opts.color);
    if (!l) { l = []; this.parts.set(opts.color, l); }
    l.push(g);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, ry = 0): void {
    this.add(unitBox, x, y, z, { color, ry, sx: w, sy: h, sz: d });
  }
  cyl(r: number, h: number, x: number, y: number, z: number, color: number, seg = 8): void {
    this.add(cylGeo(seg), x, y, z, { color, sx: r, sy: h, sz: r });
  }
  /** one merged mesh per colour, added to `target` */
  flush(target: THREE.Object3D, cast = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [color, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, lambert(color));
      mesh.castShadow = cast;
      target.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const cylCache = new Map<number, THREE.BufferGeometry>();
function cylGeo(seg: number): THREE.BufferGeometry {
  let g = cylCache.get(seg);
  if (!g) { g = new THREE.CylinderGeometry(1, 1, 1, seg); cylCache.set(seg, g); }
  return g;
}

// ---------------------------------------------------------------- street furniture
export interface FurnitureResult { group: THREE.Group; lampHeads: THREE.MeshBasicMaterial }

export function buildStreetFurniture(world: World): FurnitureResult {
  const group = new THREE.Group();
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xaaa890 });
  const road = (x: number, y: number) => world.isRoad(x, y);
  const poles: THREE.Matrix4[] = [], heads: THREE.Matrix4[] = [], hydrants: THREE.Matrix4[] = [];
  const batch = new Batch();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (road(x, y) || world.isWater(x, y) || world.isParking(x, y)) continue;
      let dx = 0, dz = 0;
      if (road(x - 1, y)) dx = -1; else if (road(x + 1, y)) dx = 1; else if (road(x, y - 1)) dz = -1; else if (road(x, y + 1)) dz = 1;
      if (!dx && !dz) continue;
      if (road(x - 1, y - 1) && road(x + 1, y + 1) && road(x - 1, y + 1)) continue; // corner of a junction: keep it clear
      const cx = (x + 0.5) * TILE_METERS + dx * 1.85, cz = (y + 0.5) * TILE_METERS + dz * 1.85;
      const yaw = Math.atan2(-dz, dx); // arm points to the road
      const along = dx ? 1 : 0; // lateral shift axis
      const r = hash2(x, y);
      if ((x + y) % 5 === 0 && r % 3 !== 0) { // street lamp
        m.compose(new THREE.Vector3(cx, 3.2, cz), q.identity(), new THREE.Vector3(0.09, 6.4, 0.09)); poles.push(m.clone());
        q.setFromAxisAngle(up, yaw);
        m.compose(new THREE.Vector3(cx + dx * 0.9, 6.35, cz + dz * 0.9), q, new THREE.Vector3(1.4, 0.14, 0.5)); heads.push(m.clone());
        batch.box(0.3, 0.3, 0.3, cx, 0.15, cz, 0x2a2c30);
      } else if (r % 23 === 1) { // bench facing the road
        const bx = cx - dx * 0.5, bz = cz - dz * 0.5;
        batch.box(dx ? 0.5 : 1.7, 0.1, dx ? 1.7 : 0.5, bx, 0.5, bz, 0x7a5a3a);
        batch.box(dx ? 0.1 : 1.7, 0.5, dx ? 1.7 : 0.1, bx - dx * 0.22, 0.8, bz - dz * 0.22, 0x7a5a3a);
        batch.box(0.1, 0.5, 0.1, bx + (dx ? 0 : 0.7), 0.25, bz + (dx ? 0.7 : 0), 0x333333);
        batch.box(0.1, 0.5, 0.1, bx - (dx ? 0 : 0.7), 0.25, bz - (dx ? 0.7 : 0), 0x333333);
      } else if (r % 29 === 2) { // litter bin
        batch.cyl(0.24, 0.9, cx - dx * 0.3 + (along ? 0 : -1), 0.45, cz - dz * 0.3 + (along ? -1 : 0), 0x2f5d3a, 10);
      } else if (r % 211 === 3) { // bus shelter
        const sx = cx - dx * 0.4, sz = cz - dz * 0.4;
        batch.box(dx ? 1.3 : 3.2, 0.12, dx ? 3.2 : 1.3, sx, 2.5, sz, 0x2c3138);
        batch.box(dx ? 0.06 : 3, 2.1, dx ? 3 : 0.06, sx - dx * 0.6, 1.25, sz - dz * 0.6, 0x7fa9c4);
        for (const s of [-1, 1]) batch.box(0.1, 2.5, 0.1, sx + (dx ? 0 : s * 1.5), 1.25, sz + (dx ? s * 1.5 : 0), 0x2c3138);
        batch.box(0.1, 2.4, 0.1, sx + dx * 1.1 + (dx ? 0 : 1.4), 1.2, sz + dz * 1.1 + (dx ? 1.4 : 0), 0x1f6fb3); // stop sign pole
        batch.box(0.5, 0.5, 0.06, sx + dx * 1.1 + (dx ? 0 : 1.4), 2.5, sz + dz * 1.1 + (dx ? 1.4 : 0), 0xffd21a);
      }
    }
  }
  for (const h of world.hydrants) { // the simulation decides where the hydrants are (fire vehicles hook up to them)
    let hx = 0, hz = 0;
    if (road(h.x - 1, h.y)) hx = -1; else if (road(h.x + 1, h.y)) hx = 1; else if (road(h.x, h.y - 1)) hz = -1; else hz = 1;
    m.compose(new THREE.Vector3((h.x + 0.5) * TILE_METERS + hx * 1.7, 0.38, (h.y + 0.5) * TILE_METERS + hz * 1.7), q.identity(), new THREE.Vector3(1, 1, 1));
    hydrants.push(m.clone());
  }
  const mkInst = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cast: boolean): void => {
    if (!mats.length) return;
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = cast;
    group.add(im);
  };
  mkInst(new THREE.CylinderGeometry(1, 1, 1, 6), lambert(0x34373d), poles, true);
  mkInst(new THREE.BoxGeometry(1, 1, 1), lampHeadMat, heads, false);
  // hydrants: body + cap as two instance sets
  const hBody = new THREE.CylinderGeometry(0.17, 0.2, 0.76, 8), hCap = new THREE.SphereGeometry(0.2, 8, 6);
  mkInst(hBody, lambert(0xc62828), hydrants, true);
  mkInst(hCap, lambert(0xc62828), hydrants.map(hm => hm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.4, 0))), false);
  batch.flush(group);
  return { group, lampHeads: lampHeadMat };
}

// ---------------------------------------------------------------- vegetation
export function buildVegetation(world: World): THREE.Group {
  const group = new THREE.Group();
  const spots: { x: number; y: number; kind: number }[] = [];
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) if (world.isTree(x, y)) {
    const k = hash2(x, y) % 10;
    spots.push({ x, y, kind: k < 4 ? 0 : k < 6 ? 1 : k < 8 ? 2 : 3 });
  }
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const make = (parts: { geo: THREE.BufferGeometry; color: number; y: number; scale?: [number, number, number]; vary?: number }[], list: typeof spots): void => {
    if (!list.length) return;
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length);
      list.forEach((s, i) => {
        const sc = 0.8 + rnd(s.x, s.y, 5) * 0.55;
        const cx = (s.x + 0.5) * TILE_METERS + (rnd(s.x, s.y, 6) - 0.5) * 1.4, cz = (s.y + 0.5) * TILE_METERS + (rnd(s.x, s.y, 7) - 0.5) * 1.4;
        const ss = p.scale ?? [1, 1, 1];
        m.compose(new THREE.Vector3(cx, p.y * sc, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(s.x, s.y, 8) * 6.28), new THREE.Vector3(sc * ss[0], sc * ss[1], sc * ss[2]));
        im.setMatrixAt(i, m);
        col.setHex(p.color);
        if (p.vary) col.offsetHSL((rnd(s.x, s.y, 9) - 0.5) * p.vary, 0, (rnd(s.x, s.y, 10) - 0.5) * 0.08);
        im.setColorAt(i, col);
      });
      im.castShadow = true;
      group.add(im);
    }
  };
  const trunk = new THREE.CylinderGeometry(0.2, 0.3, 2.6, 6);
  const crown = new THREE.IcosahedronGeometry(1.9, 1);
  const cone1 = new THREE.ConeGeometry(1.7, 3.2, 8), cone2 = new THREE.ConeGeometry(1.25, 2.6, 8);
  const palmTrunk = new THREE.CylinderGeometry(0.16, 0.28, 7, 7);
  const frondGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const f = new THREE.BoxGeometry(3, 0.06, 0.7);
    f.translate(1.5, 0, 0);
    f.rotateZ(-0.55);
    f.rotateY((i / 8) * Math.PI * 2);
    frondGeos.push(f);
  }
  const fronds = mergeGeometries(frondGeos, false)!;
  const bush = new THREE.IcosahedronGeometry(0.9, 1);
  make([{ geo: trunk, color: 0x5a4430, y: 1.3 }, { geo: crown, color: 0x3d7a3a, y: 4.1, scale: [1, 0.85, 1], vary: 0.1 }], spots.filter(s => s.kind === 0));
  make([{ geo: trunk, color: 0x4e3a28, y: 1.3, scale: [0.8, 0.8, 0.8] }, { geo: cone1, color: 0x24602f, y: 3.6, vary: 0.05 }, { geo: cone2, color: 0x2b6e36, y: 5.4, vary: 0.05 }], spots.filter(s => s.kind === 1));
  make([{ geo: palmTrunk, color: 0x8a7352, y: 3.5 }, { geo: fronds, color: 0x3f8a3a, y: 7.1, vary: 0.08 }], spots.filter(s => s.kind === 2));
  make([{ geo: bush, color: 0x3a7a34, y: 0.6, scale: [1.4, 0.8, 1.4], vary: 0.12 }], spots.filter(s => s.kind === 3));
  return group;
}

// ---------------------------------------------------------------- buildings
export interface WindowSlot { lit: boolean; matrix: THREE.Matrix4 }
export interface BuildingDecor { details: THREE.Mesh[]; windows: number[] }

/** Window grid + door matrices for one building; the caller turns them into two InstancedMeshes. */
export function windowSlots(type: string, w: number, d: number, h: number, seed: number, doorSide: 'south' | 'north'): { lit: THREE.Matrix4[]; dark: THREE.Matrix4[] } {
  const lit: THREE.Matrix4[] = [], dark: THREE.Matrix4[] = [];
  if (type === 'church' || type === 'warehouse') return { lit, dark };
  const floors = Math.max(1, Math.round(h / 3.2));
  const sides = [
    { len: w, rot: 0, off: d / 2 + 0.03 }, { len: w, rot: Math.PI, off: d / 2 + 0.03 },
    { len: d, rot: Math.PI / 2, off: w / 2 + 0.03 }, { len: d, rot: -Math.PI / 2, off: w / 2 + 0.03 },
  ];
  const glassy = type === 'office' || type === 'hospital';
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4();
  for (const [si, sd] of sides.entries()) {
    const cols = Math.max(1, Math.floor((sd.len - (glassy ? 0.6 : 1)) / (glassy ? 2.2 : 3)));
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const isDoorSide = (doorSide === 'south' && si === 0) || (doorSide === 'north' && si === 1);
      if (f === 0 && isDoorSide && (type === 'station' || c === Math.floor(cols / 2))) continue; // door / garage space
      const lx = (c + 0.5) * (sd.len / cols) - sd.len / 2;
      const local = new THREE.Vector3(lx, f * 3.2 + 1.9 + (type === 'shopping' && f === 0 ? -0.4 : 0), sd.off);
      local.applyAxisAngle(up, sd.rot);
      q.setFromAxisAngle(up, sd.rot);
      const sx = glassy ? 1.7 : 1.1, sy = glassy ? 1.7 : 1.2;
      m.compose(local, q, new THREE.Vector3(sx, sy, 1));
      (hash2(seed + si * 7 + f * 13, c + 3) % 3 === 0 ? lit : dark).push(m.clone());
    }
  }
  return { lit, dark };
}

/** Roof furniture, doors, awnings, balconies, chimneys... per building type, merged into few meshes. */
export function decorateBuilding(group: THREE.Group, type: string, roofKind: string, w: number, d: number, h: number, seed: number, doorSide: 'south' | 'north', roofRise: number): THREE.Mesh[] {
  const b = new Batch();
  const r = (k: number) => ((seed * 2654435761 + k * 40503) >>> 0) / 4294967296;
  const front = doorSide === 'south' ? 1 : -1; // z direction of the street side
  const pitched = roofKind === 'gable' || roofKind === 'hip';
  const flatTop = h + 0.3;
  const door = (x: number, wd: number, ht: number, color: number): void => { b.box(wd, ht, 0.12, x, ht / 2, front * (d / 2 + 0.07), color); };
  // every building: a darker plinth, and for pitched roofs an eave overhang with a gutter
  if (type !== 'warehouse') b.box(w + 0.3, 0.5, d + 0.3, 0, 0.25, 0, 0x6f6a64);
  if (pitched) { b.box(w + 0.7, 0.14, d + 0.7, 0, h + 0.05, 0, 0x4a3a34); b.box(w + 0.8, 0.1, 0.1, 0, h - 0.1, front * (d / 2 + 0.38), 0x8a8f94); b.box(w + 0.8, 0.1, 0.1, 0, h - 0.1, -front * (d / 2 + 0.38), 0x8a8f94); }
  // entrance steps and a door lamp bracket
  b.box(2.0, 0.18, 0.7, 0, 0.09, front * (d / 2 + 0.45), 0xaaa8a0);
  switch (type) {
    case 'residential': {
      // front garden: low fence with a gate, a path to the door, a driveway with a bin, a TV aerial and sometimes a satellite dish
      const fz = front * (d / 2 + 2.6);
      b.box(w + 1.6, 0.9, 0.06, 0, 0.45, fz, 0xf2f0ea);
      for (const s of [-1, 1]) b.box(0.06, 0.9, 2.6, s * (w / 2 + 0.8), 0.45, front * (d / 2 + 1.3), 0xf2f0ea);
      b.box(1.2, 0.04, 2.6, 0, 0.03, front * (d / 2 + 1.3), 0xa9a69d); // path
      if (r(7) > 0.45) b.box(2.4, 0.03, 3.0, -w * 0.32, 0.02, front * (d / 2 + 1.5), 0x8d8f94); // driveway
      b.box(0.5, 0.9, 0.5, w / 2 - 0.2, 0.45, front * (d / 2 + 0.9), r(8) > 0.5 ? 0x2f6b34 : 0x3a5a8a); // wheelie bin
      b.cyl(0.03, 1.6, w * 0.2, h + (pitched ? roofRise : 0) + 0.8, -front * d * 0.15, 0x555555, 5); b.box(0.9, 0.05, 0.05, w * 0.2, h + (pitched ? roofRise : 0) + 1.5, -front * d * 0.15, 0x555555);
      if (r(9) > 0.6) b.add(new THREE.SphereGeometry(0.4, 8, 5), -w * 0.25, h + (pitched ? roofRise * 0.5 : 0) + 0.3, front * d * 0.2, { color: 0xd8d8d8, rx: 0.8, sy: 0.4 });
      door(0, 1.2, 2.1, 0x4a3523);
      b.box(2.2, 0.12, 1.4, 0, 2.5, front * (d / 2 + 0.7), 0x6b4a3a); // porch roof
      b.box(0.1, 2.4, 0.1, -1, 1.2, front * (d / 2 + 1.35), 0xf0efe8); b.box(0.1, 2.4, 0.1, 1, 1.2, front * (d / 2 + 1.35), 0xf0efe8);
      if (pitched) { b.box(0.8, roofRise * 0.9 + 0.4, 0.8, w * 0.22, h + roofRise * 0.55, -front * d * 0.12, 0x7a3b2e); b.box(1, 0.12, 1, w * 0.22, h + roofRise * 1.05 + 0.4, -front * d * 0.12, 0x333333); }
      if (r(1) > 0.5) b.box(w * 0.3, 2.2, 0.1, -w * 0.3, 1.1, front * (d / 2 + 0.07), 0xb8bcc2); // garage door
      b.box(0.5, 0.9, 0.4, w / 2 - 0.4, 0.45, front * (d / 2 + 0.6), 0x3f4a4f); // meter box / bins
      // low hedge along the garden front
      b.box(w + 1.8, 0.6, 0.6, 0, 0.3, front * (d / 2 + 2.0), 0x2f6b34);
      break;
    }
    case 'apartment': {
      for (let i = 0; i < 3; i++) b.box(1.2, 0.04, 2.4, -w * 0.3 + i * w * 0.3, h + 0.5, -front * d * 0.25, 0x1f3b6b); // solar panels on the flat roof
      const floors = Math.max(2, Math.round(h / 3.2));
      door(0, 1.8, 2.2, 0x2d3640);
      b.box(2.6, 0.12, 1.6, 0, 2.6, front * (d / 2 + 0.8), 0x4a525c);
      for (let f = 1; f < floors; f++) for (const s of [-1, 1]) if (r(f * 3 + (s + 1)) > 0.35) {
        b.box(1.8, 0.14, 1.2, s * w * 0.28, f * 3.2 + 0.9, front * (d / 2 + 0.6), 0xb9bbc0);
        b.box(1.8, 0.8, 0.05, s * w * 0.28, f * 3.2 + 1.4, front * (d / 2 + 1.18), 0x5b6068);
      }
      b.box(1.4, 1.1, 1.4, w * 0.2, flatTop + 0.55, d * 0.15, 0xb0b4ba); b.box(1.1, 0.7, 1.1, -w * 0.25, flatTop + 0.35, -d * 0.2, 0x9aa0a6); // AC units / stair head
      b.cyl(0.04, 3, w * 0.35, flatTop + 1.5, 0, 0x444444, 5);
      break;
    }
    case 'commercial': case 'shopping': {
      b.box(w * 0.8, 2.4, 0.1, 0, 1.45, front * (d / 2 + 0.06), 0x16222c); // shop-front glass
      for (let i = 1; i < 4; i++) b.box(0.06, 2.4, 0.12, -w * 0.4 + i * (w * 0.8 / 4), 1.45, front * (d / 2 + 0.08), 0xd8d8d0);
      b.box(w * 0.82, 0.08, 0.14, 0, 2.7, front * (d / 2 + 0.08), 0xd8d8d0);
      const sign = [0xd32f2f, 0x1565c0, 0x2e7d32, 0xf9a825, 0x6a1b9a][seed % 5];
      b.box(w * 0.82, 0.14, 1.6, 0, 3.3, front * (d / 2 + 0.8), sign); // awning
      b.box(w * 0.82, 0.6, 0.1, 0, 3.0, front * (d / 2 + 1.6), 0xf5f5f0);
      b.box(w * 0.5, 0.9, 0.2, 0, 4.2, front * (d / 2 + 0.12), sign); // sign board
      door(-w * 0.15, 1.8, 2.3, 0x335c78); door(w * 0.15, 1.8, 2.3, 0x335c78);
      b.box(1.8, 1.2, 1.6, w * 0.25, flatTop + 0.6, 0, 0xb0b4ba); b.box(1.2, 0.9, 1.2, -w * 0.3, flatTop + 0.45, d * 0.2, 0xb0b4ba);
      if (type === 'shopping') { b.box(w * 0.5, 1.4, 0.25, 0, h - 0.9, front * (d / 2 + 0.15), 0xffd21a); b.cyl(0.2, 6, w * 0.45, 3, front * (d / 2 + 1.2), 0xdddddd, 6); }
      break;
    }
    case 'office': {
      door(0, 2.8, 2.6, 0x1c2a36);
      b.box(w * 0.4, 0.14, 2.2, 0, 3.0, front * (d / 2 + 1.1), 0x2c3a46);
      b.box(w * 0.5, 2.2, d * 0.5, 0, flatTop + 1.1, 0, 0x8d949b); // plant room
      b.cyl(0.06, 9, w * 0.3, flatTop + 4.5, d * 0.2, 0x555555, 5); b.box(0.25, 0.25, 0.25, w * 0.3, flatTop + 9.1, d * 0.2, 0xff3030);
      break;
    }
    case 'industrial': {
      b.box(3, 3.4, 0.15, -w * 0.25, 1.7, front * (d / 2 + 0.08), 0x4c5560); b.box(3, 3.4, 0.15, w * 0.25, 1.7, front * (d / 2 + 0.08), 0x4c5560);
      b.cyl(0.5, 9, w * 0.38, flatTop + 4.5, -d * 0.25, 0x9c4a3a, 10); b.cyl(0.55, 0.9, w * 0.38, flatTop + 8.6, -d * 0.25, 0xe8e8e8, 10);
      b.cyl(0.4, 7, -w * 0.38, flatTop + 3.5, -d * 0.2, 0x9c4a3a, 10);
      b.box(2.4, 1.2, 2.4, 0, flatTop + 0.6, d * 0.2, 0xaab0b6);
      break;
    }
    case 'warehouse': {
      const n = Math.max(2, Math.floor(w / 6));
      for (let i = 0; i < n; i++) { const x = (i + 0.5) * (w / n) - w / 2; b.box(3.2, 3.6, 0.14, x, 1.8, front * (d / 2 + 0.08), 0x6b7a86); b.box(3.6, 0.3, 0.2, x, 3.7, front * (d / 2 + 0.1), 0xf0b41a); }
      for (let i = 0; i < 3; i++) b.box(3, 0.4, 2, (i - 1) * w * 0.28, flatTop + 0.2, 0, 0xcfe0ea); // roof lights
      b.box(2, 0.12, 5, w * 0.2, 1.1, front * (d / 2 + 2.5), 0x555a60); // loading ramp
      break;
    }
    case 'hospital': {
      door(0, 3, 2.6, 0x7fb3d5);
      b.box(6, 0.16, 3.4, 0, 3.4, front * (d / 2 + 1.7), 0xe8eef2); // ambulance canopy
      for (const s of [-1, 1]) b.box(0.2, 3.4, 0.2, s * 2.8, 1.7, front * (d / 2 + 3.3), 0xe8eef2);
      b.box(4.5, 0.15, 4.5, 0, flatTop + 0.1, 0, 0x2d6cb0); // helipad
      b.box(0.6, 0.18, 3, -0.9, flatTop + 0.2, 0, 0xffffff); b.box(0.6, 0.18, 3, 0.9, flatTop + 0.2, 0, 0xffffff); b.box(1.6, 0.18, 0.6, 0, flatTop + 0.2, 0, 0xffffff);
      b.box(w * 0.35, 1.4, 0.25, 0, h - 1.2, front * (d / 2 + 0.15), 0xffffff); b.box(1.0, 0.3, 0.3, 0, h - 1.2, front * (d / 2 + 0.3), 0xd32f2f); b.box(0.3, 1.0, 0.3, 0, h - 1.2, front * (d / 2 + 0.3), 0xd32f2f);
      break;
    }
    case 'school': {
      door(0, 2.4, 2.3, 0x335c78);
      b.cyl(0.07, 8, w * 0.4, flatTop + 4, d * 0.3, 0xdddddd, 5); b.box(1.3, 0.8, 0.05, w * 0.4 + 0.7, flatTop + 7.4, d * 0.3, 0xd32f2f);
      b.box(w * 0.5, 0.9, 0.2, 0, h - 1, front * (d / 2 + 0.15), 0xf5c518);
      break;
    }
    case 'church': {
      door(0, 1.8, 3, 0x4a3523);
      const tz = front * d * 0.28; // bell tower at the street end
      b.box(3, 12, 3, 0, 6, tz, 0xc9bfa8);
      b.add(new THREE.ConeGeometry(2.4, 6, 4), 0, 15, tz, { color: 0x6a5a4a, ry: Math.PI / 4 });
      b.box(0.2, 2, 0.2, 0, 19, tz, 0xd9d2c0); b.box(1.2, 0.2, 0.2, 0, 19.3, tz, 0xd9d2c0);
      for (const s of [-1, 1]) b.box(0.12, 1.6, 0.8, s * 1.55, 9, tz, 0x7fa9c4);
      break;
    }
    case 'station': {
      const doors = Math.max(2, Math.floor(w / 3.4));
      const north = -front; // vehicles leave through the north lot
      void north;
      for (let i = 0; i < doors; i++) {
        const x = (i + 0.5) * (w / doors) - w / 2;
        b.box(w / doors - 0.6, 3.6, 0.14, x, 1.8, -(d / 2 + 0.1), 0x2d3640);
        b.box(w / doors - 0.3, 0.3, 0.2, x, 3.7, -(d / 2 + 0.1), 0xf0efe8);
      }
      b.box(w, 0.5, 0.22, 0, 5.2, -(d / 2 + 0.12), 0x9c2a22);
      b.box(2.2, 0.9, 0.2, w * 0.3, 6.3, -(d / 2 + 0.12), 0x1f4fb3);
      if (r(2) > 0.4) b.box(2.4, 12, 2.4, w * 0.38, h + 6, d * 0.3, 0x8e2b2b); // hose tower
      b.box(1.6, 1.0, 1.6, -w * 0.25, flatTop + 0.5, d * 0.1, 0xb0b4ba);
      break;
    }
    default:
      b.box(1.6, 1, 1.6, 0, flatTop + 0.5, 0, 0xb0b4ba);
  }
  return b.flush(group);
}

// ---------------------------------------------------------------- sky + day/night
export class Environment {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** lit-window colour and lamp-head colour, driven by the time of day */
  readonly windowLit = new THREE.MeshBasicMaterial({ color: 0x8396a8 });
  readonly windowDark = new THREE.MeshLambertMaterial({ color: 0x1c2733 });
  private skyMat: THREE.ShaderMaterial;
  private lampHeads: THREE.MeshBasicMaterial | null = null;
  /** 1440 s of game time = one day; starts at about 08:30 */
  static readonly DAY = 1440;
  daylight = 1;
  night = false;
  enabled = true;

  constructor(scene: THREE.Scene, private fog: THREE.Fog) {
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a4a30, 0.9);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 1.1);
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.4;
    const sc = this.sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 600;
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x4f8fd8) }, horizon: { value: new THREE.Color(0xbcd8f0) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float t = clamp(vP.y * 1.6 + 0.08, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(t, 0.7)), 1.0); }',
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky, this.hemi, this.sun, this.sun.target);
  }

  attachLamps(m: THREE.MeshBasicMaterial): void { this.lampHeads = m; }

  /** `time` = world time in seconds, `target` = camera focus (the shadow frustum follows it). */
  update(time: number, target: THREE.Vector3, camPos: THREE.Vector3): void {
    const p = this.enabled ? (0.35 + time / Environment.DAY) % 1 : 0.5;
    const elev = -Math.cos(p * Math.PI * 2); // 1 at noon, -1 at midnight
    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.32);
    const dusk = Math.exp(-Math.pow(elev / 0.22, 2));
    this.daylight = day;
    this.night = day < 0.35;
    const topDay = new THREE.Color(0x4a88d4), topNight = new THREE.Color(0x070b1c), topDusk = new THREE.Color(0x3a4f92);
    const horDay = new THREE.Color(0xbcd8f0), horNight = new THREE.Color(0x141c36), horDusk = new THREE.Color(0xf0a070);
    const top = topNight.clone().lerp(topDay, day).lerp(topDusk, dusk * 0.6);
    const hor = horNight.clone().lerp(horDay, day).lerp(horDusk, dusk * 0.75);
    (this.skyMat.uniforms.top.value as THREE.Color).copy(top);
    (this.skyMat.uniforms.horizon.value as THREE.Color).copy(hor);
    this.fog.color.copy(hor);
    this.sky.position.copy(camPos);
    this.hemi.intensity = 0.5 + 0.5 * day;
    this.hemi.color.set(0x8fa4d8).lerp(new THREE.Color(0xcfe8ff), day);
    this.sun.intensity = 0.15 + 1.0 * day;
    this.sun.color.set(0xff9a5a).lerp(new THREE.Color(0xfff0d8), Math.min(1, day * 1.6));
    const ang = p * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(ang) * 0.9, Math.max(0.25, elev), -0.55 + Math.cos(ang) * 0.2).normalize();
    this.sun.position.copy(target).addScaledVector(dir, 220);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    // night colours for windows and lamps
    const nightK = 1 - day;
    this.windowLit.color.set(0x8396a8).lerp(new THREE.Color(0xffd98a), nightK);
    this.windowDark.color.set(0x1c2733).lerp(new THREE.Color(0x0e141c), nightK);
    this.lampHeads?.color.set(0x9a9884).lerp(new THREE.Color(0xfff2b8), nightK);
  }
}
