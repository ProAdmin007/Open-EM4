import * as THREE from 'three';
import type { World } from '../sim/world';
import type { RenderSnapshot, SnapCar, SnapPerson, SnapVehicle } from '../sim/snapshot';
import type { Category } from '../sim/types';
import type { GameRenderer } from './renderer';
import { TILE_METERS, tileToWorld3D, world3DToTile } from '../sim/space';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Commands, type SelectionHost } from './selection';
import { paint, buildAccidentDetail, buildBloodPool, buildMedBag, buildStretcher, buildBarrier, buildBombRobot, buildCivilianCar, buildCone, buildDebris, buildFallenTree, buildFlare, buildSuspectPackage, buildVehicle, buildWreck, lambert, type VehicleParts } from './three-models';
import { ParticlePool, setSegment } from './three-fx';
import { bakeGroundChunks, buildGroundMeshes, groundHeight } from './three-ground';
import { planarRoofUVs, roofTexture, scaleBoxUVs, wallTexture } from './three-textures';
import { Environment, buildStreetFurniture, buildVegetation, decorateBuilding, windowSlots } from './three-world';

/**
 * First 3D view for OpenRescue (docs/3d.md). Everything is procedural (no external assets, MIT three.js): a baked
 * canvas texture for the ground (roads, lane markings, grass, parking, water), boxes with a roof shape for buildings,
 * primitive vehicles/people, a particle pool for fire/smoke and a billboard per incident. Input reuses `Commands`
 * (selection.ts) so orders behave exactly like the 2D view; only the RTS camera and ray-picking are new.
 */

const CAT_COLOR: Record<Category, number> = { fire: 0xb23b2e, ambulance: 0xf1efe6, police: 0x1f3d7a, tech: 0x5a7a30 };
const BUILDING_COLORS: Record<string, { wall: number; roof: number }> = {
  station: { wall: 0x8e2b2b, roof: 0xc0392b },
  residential: { wall: 0xb08968, roof: 0x9c4a3a },
  apartment: { wall: 0x8a8d93, roof: 0xb8bcc4 },
  commercial: { wall: 0x4f6d8a, roof: 0x6f93b8 },
  industrial: { wall: 0x666a6e, roof: 0x8c9196 },
  hospital: { wall: 0xcfd8dc, roof: 0xf5f7f8 },
  office: { wall: 0x3a566e, roof: 0x5b86a6 },
  warehouse: { wall: 0x777c80, roof: 0x9aa1a6 },
  school: { wall: 0x9a5a46, roof: 0xc47a5d },
  shopping: { wall: 0x7b4f7d, roof: 0xa879aa },
  church: { wall: 0xc9bfa8, roof: 0x7a6a5a },
};
const PED_COLORS: Record<string, number> = { red: 0xc0392b, blue: 0x2e6bd6, green: 0x27ae60, yellow: 0xf1c40f, purple: 0x8e44ad, orange: 0xe67e22, white: 0xecf0f1, black: 0x2c3e50 };

const sharedBoxes = new Map<string, THREE.BufferGeometry>();
function sharedCapsule(r: number, len: number, shiftY = 0): THREE.BufferGeometry {
  const k = `c${r},${len},${shiftY}`;
  let g = sharedBoxes.get(k);
  if (!g) { g = new THREE.CapsuleGeometry(r, len, 4, 8); if (shiftY) g.translate(0, shiftY, 0); g.userData.shared = true; sharedBoxes.set(k, g); }
  return g;
}
function sharedRounded(w: number, h2: number, d: number, r: number): THREE.BufferGeometry {
  const k = `r${w},${h2},${d},${r}`;
  let g = sharedBoxes.get(k);
  if (!g) { g = new RoundedBoxGeometry(w, h2, d, 2, r); g.userData.shared = true; sharedBoxes.set(k, g); }
  return g;
}
let hairGeo: THREE.BufferGeometry | null = null;
function sharedHair(): THREE.BufferGeometry { if (!hairGeo) { hairGeo = new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55); hairGeo.userData.shared = true; } return hairGeo; }
let sphereGeo: THREE.BufferGeometry | null = null, helmetGeo: THREE.BufferGeometry | null = null;
function sharedSphere(r: number): THREE.BufferGeometry { if (!sphereGeo) { sphereGeo = new THREE.SphereGeometry(r, 10, 8); sphereGeo.userData.shared = true; } return sphereGeo; }
function sharedHelmet(): THREE.BufferGeometry { if (!helmetGeo) { helmetGeo = new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); helmetGeo.userData.shared = true; } return helmetGeo; }
const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

/**
 * Ray-pick from a camera through a normalised-device-coordinate point (x, y in [-1, 1]) to the ground plane (Y=0),
 * returned as tile coordinates. Pure three.js math (no canvas/WebGL), so it can be unit-tested headlessly. Returns
 * null when the ray is parallel to the ground (looking straight along it) or points away from it.
 */
export function pickGroundTile(camera: THREE.Camera, ndcX: number, ndcY: number): { x: number; y: number } | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
  return world3DToTile({ x: hit.x, y: hit.y, z: hit.z });
}
/** Inverse direction: a tile's ground position projected to normalised device coordinates for the given camera. */
export function projectTileToNDC(camera: THREE.Camera, tx: number, ty: number): { x: number; y: number } {
  const p = tileToWorld3D(tx, ty);
  const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
  return { x: v.x, y: v.y };
}

function roleColor(model: string): number {
  if (/fire|rescue/.test(model)) return CAT_COLOR.fire;
  if (/paramedic|doctor/.test(model)) return CAT_COLOR.ambulance;
  if (/officer/.test(model)) return CAT_COLOR.police;
  if (/tech/.test(model)) return CAT_COLOR.tech;
  return 0x9aa0a6;
}
function pedColor(model: string): number {
  for (const [name, col] of Object.entries(PED_COLORS)) if (model.includes(name)) return col;
  return 0xbdbdbd;
}

/** A triangular-prism gable roof, ridge along X, centred on the building footprint. */
export function gableRoofGeometry(w: number, d: number, rise: number): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;
  const p = (x: number, y: number, z: number) => [x, y, z];
  const v: number[] = [
    ...p(-hw, 0, -hd), ...p(hw, 0, -hd), ...p(hw, rise, 0), ...p(-hw, 0, -hd), ...p(hw, rise, 0), ...p(-hw, rise, 0), // front slope
    ...p(hw, 0, hd), ...p(-hw, 0, hd), ...p(-hw, rise, 0), ...p(hw, 0, hd), ...p(-hw, rise, 0), ...p(hw, rise, 0), // back slope
    ...p(-hw, 0, -hd), ...p(-hw, 0, hd), ...p(-hw, rise, 0), // left gable end
    ...p(hw, 0, hd), ...p(hw, 0, -hd), ...p(hw, rise, 0), // right gable end
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

export function buildRoof(type: string, w: number, d: number): THREE.Object3D {
  const rise = Math.min(w, d) * 0.28;
  if (type === 'gable') {
    // Ridge runs along the geometry's local X axis; swap w/d and rotate 90° so the
    // ridge always follows the building's longer side instead of always the X axis.
    if (d > w) {
      const mesh = new THREE.Mesh(gableRoofGeometry(d, w, rise));
      mesh.rotation.y = Math.PI / 2;
      return mesh;
    }
    return new THREE.Mesh(gableRoofGeometry(w, d, rise));
  }
  if (type === 'hip') {
    const geo = new THREE.ConeGeometry(Math.max(w, d) * 0.5 * Math.SQRT2, rise, 4, 1);
    geo.rotateY(Math.PI / 4);
    geo.scale(w / Math.max(w, d), 1, d / Math.max(w, d));
    const m = new THREE.Mesh(geo);
    return m;
  }
  const flat = new THREE.Mesh(new THREE.BoxGeometry(w, Math.max(0.3, d * 0.04), d));
  flat.position.y = Math.max(0.3, d * 0.04) / 2;
  return flat;
}

interface Tracked { obj: THREE.Object3D; frame: number; parts?: VehicleParts; lastX?: number; lastZ?: number; spin?: number }
interface BuildingObj { fw: { start: number; mats: THREE.Matrix4[]; key: string }; decor: THREE.Mesh[]; win: { start: number; count: number; dark: boolean }[]; group: THREE.Group; body: THREE.Mesh; roof: THREE.Object3D; bodyMat: THREE.MeshLambertMaterial; roofMat: THREE.MeshLambertMaterial; wall: THREE.Color; roofCol: THREE.Color; h: number; key: string }
const CHAR = new THREE.Color(0x1b1918);
const cx = (b: { x: number; w: number }, _w: number): number => (b.x + b.w / 2) * TILE_METERS;
const cz = (b: { y: number; h: number }, _d: number): number => (b.y + b.h / 2) * TILE_METERS;

export class Three3DRenderer implements GameRenderer {
  readonly kind = '3d' as const;
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3(0, 0, 0);
  private distance = 42;
  private yaw = Math.PI * 0.78;
  private readonly pitch = 0.95;
  private world: World | null = null;
  private commands: Commands;
  private groundMesh: THREE.Group | null = null;
  private groundKinds: Uint8Array | null = null;
  private outerGround: THREE.Mesh | null = null;
  private buildingsGroup = new THREE.Group();
  private furnitureGroup = new THREE.Group();
  private env!: Environment;
  private winLit: THREE.InstancedMesh | null = null;
  private winDark: THREE.InstancedMesh | null = null;
  private fireWin: THREE.InstancedMesh | null = null;
  shadows = false;
  private treesGroup = new THREE.Group();
  private lightsGroup = new THREE.Group();
  private vehicles = new Map<number, Tracked>();
  private people = new Map<number, Tracked>();
  private cars = new Map<number, Tracked>();
  private incidentMarkers = new Map<number, THREE.Sprite>();
  private selectionRings = new Map<number, THREE.Mesh>();
  private frame = 0;
  private lightPhase = -1;
  private time = 0;
  private lastDt = 0.016;
  private anyDefusing = false;
  private trafficBulbs: { pos: THREE.Vector3; ew: boolean; mesh: THREE.Mesh }[] = [];
  private dragBox: THREE.Mesh;
  private keys = new Set<string>();
  private pointer = { downTile: { x: 0, y: 0 }, downScreen: { x: 0, y: 0 }, dragging: false, shift: false, rotating: false, lastX: 0 };
  // fire / smoke / water particle pools, burning-building lights, props, hoses
  private flames = new ParticlePool(1100, THREE.AdditiveBlending, 0.8, 0.5, 'flame');
  private halo = new ParticlePool(160, THREE.AdditiveBlending, 0, 0.2);
  private smoke = new ParticlePool(700, THREE.NormalBlending, 0.35, 0.35);
  private water = new ParticlePool(500, THREE.NormalBlending, -9, 0.05);
  private fireLights: THREE.PointLight[] = [];
  private buildingObjs = new Map<string, BuildingObj>();
  private propsGroup = new THREE.Group();
  private obstacleKey = '';
  private incidentFx = new Map<number, { ring: THREE.Mesh; beam: THREE.Mesh; tape?: THREE.Group; props: THREE.Group; flares?: THREE.Vector3[]; steam?: THREE.Vector3[]; beacon?: THREE.Mesh; robot?: THREE.Group; pack?: THREE.Group }>();
  private hoseSegs: THREE.Mesh[] = [];
  private hoseMat = new THREE.MeshLambertMaterial({ color: 0xf0b21a });

  constructor(private host: SelectionHost) {
    this.commands = new Commands(host);
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', outline: 'none', touchAction: 'none' });
    this.canvas.tabIndex = 0;
    (document.getElementById('game-root') ?? document.body).appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2500);
    this.scene.background = null;
    const fog = new THREE.Fog(0xbcd8f0, 260, 900);
    this.scene.fog = fog;
    this.env = new Environment(this.scene, fog);
    { // soft image-based lighting so car paint and glass pick up reflections
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.45;
      pmrem.dispose();
    }
    const q = new URLSearchParams(location.search);
    const auto = q.has('e2e') && !q.has('fx'); // automated tests: constant daylight, no shadow pass (software GL is slow)
    this.env.enabled = !auto && localStorage.getItem('openrescue.daynight') !== '0';
    this.setShadows(!auto && localStorage.getItem('openrescue.shadows') !== '0');
    this.scene.add(this.buildingsGroup, this.treesGroup, this.lightsGroup, this.furnitureGroup);

    const dragMat = new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    this.dragBox = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dragMat);
    this.dragBox.rotation.x = -Math.PI / 2;
    this.dragBox.visible = false;
    this.scene.add(this.dragBox);

    this.scene.add(this.propsGroup, this.smoke.points, this.flames.points, this.halo.points, this.water.points);
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff7a2a, 0, 38, 1.6);
      l.visible = false;
      this.fireLights.push(l);
      this.scene.add(l);
    }

    this.updateCamera();
    this.bindInput();
  }

  // ---------- GameRenderer ----------
  load(world: World): void {
    this.world = world;
    this.buildGround(world);
    this.buildBuildings(world);
    this.buildTrees(world);
    this.buildTrafficLights(world);
    this.lightPhase = -1;
    this.obstacleKey = '';
    this.disposeGroup(this.propsGroup);
    for (const f of this.incidentFx.values()) { this.scene.remove(f.ring, f.beam); if (f.tape) this.scene.remove(f.tape); this.disposeObj(f.ring); this.disposeObj(f.beam); }
    this.incidentFx.clear();
    for (const vp of this.victimProps.values()) { this.scene.remove(vp.obj); this.disposeObj(vp.obj); }
    this.victimProps.clear();
    for (const bp of this.bagProps.values()) { this.scene.remove(bp.obj); this.disposeObj(bp.obj); }
    this.bagProps.clear();
    for (const m of [this.vehicles, this.people, this.cars]) { for (const t of m.values()) this.disposeObj(t.obj); m.clear(); }
    for (const s of this.incidentMarkers.values()) this.disposeObj(s);
    this.incidentMarkers.clear();
    for (const r of this.selectionRings.values()) this.disposeObj(r);
    this.selectionRings.clear();
  }

  render(snap: RenderSnapshot, dt: number): void {
    this.frame++;
    this.time += dt;
    this.lastDt = dt;
    this.stepCamera(dt);
    this.env.update(snap.time, this.target, this.camera.position);
    this.anyDefusing = snap.incidents.some(i => i.defusing);
    this.syncVehicles(snap.vehicles);
    this.syncPeople(snap.people);
    this.syncCars(snap.cars);
    this.syncBuildings(snap);
    this.syncIncidents(snap);
    this.syncObstacles(snap);
    this.syncSelection(snap);
    this.syncTrafficLights(snap.lightPhase);
    this.syncHoses(snap);
    this.syncExplosions(snap, dt);
    this.updateFire(snap, dt);
    this.renderer.render(this.scene, this.camera);
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = (sx / (rect.width || this.canvas.width)) * 2 - 1;
    const ndcY = -(sy / (rect.height || this.canvas.height)) * 2 + 1;
    return pickGroundTile(this.camera, ndcX, ndcY);
  }
  tileToScreen(tx: number, ty: number): { x: number; y: number } {
    const v = projectTileToNDC(this.camera, tx, ty);
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || this.canvas.width, h = rect.height || this.canvas.height;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h };
  }
  centerOn(tx: number, ty: number): void {
    const p = tileToWorld3D(tx, ty);
    this.target.set(p.x, 0, p.z);
    this.updateCamera();
  }
  /** Extra helper used by GameScene for audio panning (not part of the GameRenderer contract). */
  cameraTile(): { x: number; y: number } {
    return world3DToTile({ x: this.target.x, y: 0, z: this.target.z });
  }
  /** Extra helper used by GameScene's zoomBy delegation. */
  zoomBy(f: number): void {
    this.distance = Math.max(12, Math.min(220, this.distance / f));
    this.updateCamera();
  }
  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.updatePoolScale();
  }
  setShadows(on: boolean): void {
    this.shadows = on;
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.env.sun.castShadow = on;
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => { mm.needsUpdate = true; }); });
  }
  setDayNight(on: boolean): void { this.env.enabled = on; }
  // ---------- explosions ----------
  private seenExplosions = new Set<number>();
  private blasts: { ring: THREE.Mesh; age: number }[] = [];
  private blastLight = new THREE.PointLight(0xffaa55, 0, 110, 1.3);
  private shake = 0;
  private syncExplosions(snap: RenderSnapshot, dt: number): void {
    if (!this.blastLight.parent) this.scene.add(this.blastLight);
    for (const e of snap.explosions) {
      if (this.seenExplosions.has(e.id)) continue;
      this.seenExplosions.add(e.id);
      if (e.age > 2) continue;
      const p = tileToWorld3D(e.x, e.y);
      const r = (): number => Math.random() - 0.5;
      this.halo.emit({ x: p.x, y: 2, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.35, size0: 26, size1: 44, c0: 0xffffff, c1: 0xffc060, alpha: 1 });
      for (let i = 0; i < 70; i++) { // fireball
        const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 11;
        this.flames.emit({ x: p.x + r() * 2, y: 1 + Math.random() * 2, z: p.z + r() * 2, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 9, vz: Math.sin(a) * sp, life: 0.7 + Math.random() * 0.9, size0: 3 + Math.random() * 2, size1: 7 + Math.random() * 4, c0: Math.random() < 0.4 ? 0xfff0b0 : 0xff8a1c, c1: 0xc02a08, alpha: 1 });
      }
      for (let i = 0; i < 45; i++) this.smoke.emit({ x: p.x + r() * 4, y: 2, z: p.z + r() * 4, vx: r() * 6, vy: 4 + Math.random() * 6, vz: r() * 6, life: 5 + Math.random() * 4, size0: 3, size1: 15 + Math.random() * 8, c0: 0x151515, c1: 0x7a7a80, alpha: 0.6 });
      for (let i = 0; i < 60; i++) { // glowing debris
        const a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 12;
        this.halo.emit({ x: p.x, y: 1.5, z: p.z, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 14, vz: Math.sin(a) * sp, life: 1.8, size0: 0.4, size1: 0.12, c0: 0xffd060, c1: 0xff3000, alpha: 1 });
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 56), new THREE.MeshBasicMaterial({ color: 0xffe8c0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.4, p.z);
      this.scene.add(ring);
      this.blasts.push({ ring, age: 0 });
      this.blastLight.position.set(p.x, 8, p.z);
      this.blastLight.intensity = 2200;
      this.shake = 1;
    }
    this.blastLight.intensity *= Math.exp(-dt * 4.5);
    for (const b of this.blasts) {
      b.age += dt;
      b.ring.scale.setScalar(1 + b.age * 55);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - b.age * 1.0);
    }
    for (const b of this.blasts.filter(x => x.age > 0.9)) { this.scene.remove(b.ring); this.disposeObj(b.ring); }
    this.blasts = this.blasts.filter(x => x.age <= 0.9);
    if (this.shake > 0.01) {
      this.updateCamera();
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 1.4;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 1.0;
      this.camera.position.z += (Math.random() - 0.5) * this.shake * 1.4;
      this.shake *= Math.exp(-dt * 3.5);
    } else if (this.shake > 0) { this.shake = 0; this.updateCamera(); }
  }
  private updatePoolScale(): void {
    const h = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y || 768;
    for (const p of [this.flames, this.halo, this.smoke, this.water]) p.setScale(h, this.camera.fov);
  }
  destroy(): void {
    for (const p of [this.flames, this.halo, this.smoke, this.water]) p.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---------- camera ----------
  private updateCamera(): void {
    const ox = this.distance * Math.cos(this.pitch) * Math.sin(this.yaw);
    const oy = this.distance * Math.sin(this.pitch);
    const oz = this.distance * Math.cos(this.pitch) * Math.cos(this.yaw);
    this.camera.position.set(this.target.x + ox, this.target.y + oy, this.target.z + oz);
    this.camera.lookAt(this.target);
  }
  private stepCamera(dt: number): void {
    if (this.host.state !== 'playing' && this.host.state !== 'gameover') return;
    const sp = this.distance * 0.9 * dt;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    let moved = false;
    if (this.keys.has('w')) { this.target.addScaledVector(fwd, -sp); moved = true; }
    if (this.keys.has('s')) { this.target.addScaledVector(fwd, sp); moved = true; }
    if (this.keys.has('a')) { this.target.addScaledVector(right, -sp); moved = true; }
    if (this.keys.has('d')) { this.target.addScaledVector(right, sp); moved = true; }
    if (moved || this.pointer.rotating) this.updateCamera();
  }

  // ---------- static scenery ----------
  private buildGround(world: World): void {
    if (this.groundMesh) { this.scene.remove(this.groundMesh); this.disposeObj(this.groundMesh); this.groundMesh = null; }
    const baked = bakeGroundChunks(world);
    this.groundKinds = baked.kinds;
    this.groundMesh = buildGroundMeshes(world, baked, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.groundMesh);
    const W = world.w * TILE_METERS, H = world.h * TILE_METERS;
    if (!this.outerGround) {
      this.outerGround = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x3a5f36 }));
      this.outerGround.rotation.x = -Math.PI / 2;
      this.outerGround.position.set(W / 2, -0.08, H / 2);
      this.scene.add(this.outerGround);
    }
  }

  private buildBuildings(world: World): void {
    this.disposeGroup(this.buildingsGroup);
    for (const im of [this.winLit, this.winDark]) if (im) { this.scene.remove(im); im.dispose(); }
    this.buildingObjs.clear();
    const litAll: THREE.Matrix4[] = [], darkAll: THREE.Matrix4[] = [];
    const stationIds = new Set(world.map.stations.map(st => st.buildingId));
    const baseM = new THREE.Matrix4();
    for (const b of world.buildings.values()) {
      const w = b.w * TILE_METERS, d = b.h * TILE_METERS;
      const heightMeters = (b.floors ?? Math.max(1, Math.round(b.height / 10))) * 3.2;
      const colors = BUILDING_COLORS[b.type] ?? { wall: 0x888888, roof: 0xaaaaaa };
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: colors.wall, map: wallTexture(b.type) });
      const pitchedRoof = (b.roof ?? 'flat') !== 'flat';
      const roofMat = new THREE.MeshLambertMaterial({ color: colors.roof, map: roofTexture(pitchedRoof ? 'pitched' : 'flat') });
      const bodyGeo = new THREE.BoxGeometry(w, heightMeters, d);
      scaleBoxUVs(bodyGeo, w, heightMeters, d);
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = heightMeters / 2;
      body.castShadow = true; body.receiveShadow = true;
      group.add(body);
      const roof = buildRoof(b.roof ?? 'flat', w, d);
      (roof as THREE.Mesh).material = roofMat;
      const rg = (roof as THREE.Mesh).geometry;
      if (rg instanceof THREE.BoxGeometry) scaleBoxUVs(rg, rg.parameters.width, rg.parameters.height, rg.parameters.depth);
      else if (b.roof === 'gable') planarRoofUVs(rg, 1.6);
      roof.position.y = heightMeters;
      (roof as THREE.Mesh).castShadow = true;
      group.add(roof);
      group.position.set((b.x + b.w / 2) * TILE_METERS, 0, (b.y + b.h / 2) * TILE_METERS);
      group.name = `building:${b.id}`;
      group.userData.buildingId = b.id;
      const side = stationIds.has(b.id) ? 'north' : 'south';
      const seed = hash(b.x, b.y);
      const rise = Math.min(w, d) * 0.28;
      const decor = decorateBuilding(group, b.type, b.roof ?? 'flat', w, d, heightMeters, seed, side, rise);
      const slots = windowSlots(b.type, w, d, heightMeters, seed, side);
      const win: BuildingObj['win'] = [];
      const fwMats: THREE.Matrix4[] = [];
      for (const [list, dark, all] of [[slots.lit, false, litAll], [slots.dark, true, darkAll]] as [THREE.Matrix4[], boolean, THREE.Matrix4[]][]) {
        win.push({ start: all.length, count: list.length, dark });
        for (const m of list) { baseM.compose(new THREE.Vector3(group.position.x, 0, group.position.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); const wm = baseM.clone().multiply(m); all.push(wm); fwMats.push(wm); }
      }
      this.buildingsGroup.add(group);
      this.buildingObjs.set(b.id, { fw: { start: -1, mats: fwMats, key: '' }, decor, win, group, body, roof, bodyMat, roofMat, wall: new THREE.Color(colors.wall), roofCol: new THREE.Color(colors.roof), h: heightMeters, key: '' });
    }
    const wg = new THREE.BoxGeometry(1, 1, 0.08);
    const mk = (list: THREE.Matrix4[], mat: THREE.Material): THREE.InstancedMesh | null => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(wg, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.frustumCulled = false;
      this.scene.add(im);
      return im;
    };
    if (this.fireWin) { this.scene.remove(this.fireWin); this.fireWin.dispose(); this.fireWin = null; }
    let total = 0;
    for (const bo of this.buildingObjs.values()) { bo.fw.start = total; total += bo.fw.mats.length; }
    if (total) {
      const fw = new THREE.InstancedMesh(wg, new THREE.MeshBasicMaterial({ color: 0xffffff }), total);
      const zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < total; i++) { fw.setMatrixAt(i, zero); fw.setColorAt(i, white); }
      fw.frustumCulled = false;
      this.scene.add(fw);
      this.fireWin = fw;
    }
    this.winLit = mk(litAll, this.env.windowLit);
    this.winDark = mk(darkAll, this.env.windowDark);
  }

  /** Remove a collapsed building's windows and decorations. */
  private hideBuildingExtras(bo: BuildingObj): void {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const win of bo.win) {
      const im = win.dark ? this.winDark : this.winLit;
      if (!im) continue;
      for (let i = 0; i < win.count; i++) im.setMatrixAt(win.start + i, zero);
      im.instanceMatrix.needsUpdate = true;
    }
    for (const m of bo.decor) m.visible = false;
  }

  private buildTrees(world: World): void {
    this.disposeGroup(this.treesGroup);
    this.treesGroup.add(buildVegetation(world));
    this.disposeGroup(this.furnitureGroup);
    const f = buildStreetFurniture(world);
    this.env.attachLamps(f.lampHeads);
    this.furnitureGroup.add(f.group);
  }

  private buildTrafficLights(world: World): void {
    this.disposeGroup(this.lightsGroup);
    this.trafficBulbs = [];
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        if (!world.isIntersection(x, y) || world.isIntersection(x - 1, y) || world.isIntersection(x, y - 1)) continue;
        const pts: [number, number, boolean][] = [[x - 0.1, y - 0.1, true], [x + 2.1, y + 2.1, true], [x + 2.1, y - 0.1, false], [x - 0.1, y + 2.1, false]];
        for (const [tx, ty, ew] of pts) {
          const p = tileToWorld3D(tx, ty, 2.6);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), poleMat);
          pole.position.set(p.x, 1.3, p.z);
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff3030, emissiveIntensity: 0.9 }));
          bulb.position.set(p.x, 2.6, p.z);
          this.lightsGroup.add(pole, bulb);
          this.trafficBulbs.push({ pos: bulb.position, ew, mesh: bulb });
        }
      }
    }
  }

  // ---------- per-frame entities ----------
  private track<T extends { id: number }>(map: Map<number, Tracked>, items: Iterable<T>, make: (i: T) => THREE.Object3D, upd: (obj: THREE.Object3D, i: T) => void): void {
    for (const it of items) {
      let t = map.get(it.id);
      if (!t) { const obj = make(it); obj.traverse(o => { (o as THREE.Mesh).castShadow = true; }); this.scene.add(obj); t = { obj, frame: 0 }; map.set(it.id, t); }
      t.frame = this.frame;
      upd(t.obj, it);
    }
    for (const [id, t] of map) if (t.frame !== this.frame) { this.scene.remove(t.obj); this.disposeObj(t.obj); map.delete(id); }
  }

  private makeVehicle(v: SnapVehicle): THREE.Object3D {
    const { group, parts } = buildVehicle(v.model, v.category, v.size);
    group.userData.kind = 'vehicle';
    group.userData.id = v.id;
    group.userData.parts = parts;
    return group;
  }
  private animateParts(parts: VehicleParts | undefined, moving: boolean, lights: boolean, dt: number): void {
    if (!parts) return;
    if (moving) for (const w of parts.wheels) w.rotation.z -= 9 * dt;
    for (const b of parts.beacons) {
      const m = b.mesh.material as THREE.MeshStandardMaterial;
      const on = lights && (Math.floor(this.time * 8) + b.phase) % 2 === 0;
      m.emissiveIntensity = on ? b.on : lights ? 0.15 : b.off * 0.3;
    }
  }
  private syncVehicles(list: SnapVehicle[]): void {
    this.track(this.vehicles, list, v => this.makeVehicle(v), (obj, v) => {
      obj.position.set(v.position.x, 0, v.position.z);
      obj.rotation.y = v.yaw;
      this.animateParts(obj.userData.parts as VehicleParts, v.moving, v.lights, this.lastDt);
      const ladder = obj.getObjectByName('ladder');
      if (ladder) { // raise, turn towards the building and extend while the crew is spraying
        const up = v.aerial ? 1 : 0;
        const k = Math.min(1, this.lastDt * 1.6);
        ladder.userData.t = (ladder.userData.t ?? 0) + (up - (ladder.userData.t ?? 0)) * k;
        const t = ladder.userData.t as number;
        let yaw = 0;
        if (v.aerial) { const p = tileToWorld3D(v.aerial.x, v.aerial.y); yaw = Math.atan2(-(p.z - v.position.z), p.x - v.position.x) - v.yaw; ladder.userData.yaw = yaw; }
        ladder.rotation.y = (ladder.userData.yaw ?? 0) * t;
        ladder.rotation.z = 1.05 * t;
        ladder.scale.x = 1 + 0.9 * t;
      }
      for (const nm of ['rdoorL', 'rdoorR']) {
        const door = obj.getObjectByName(nm);
        if (!door) continue;
        const target = v.open ? 1 : 0;
        door.userData.t = (door.userData.t ?? 0) + (target - (door.userData.t ?? 0)) * Math.min(1, this.lastDt * 4);
        door.rotation.y = (nm === 'rdoorR' ? 1 : -1) * 1.75 * (door.userData.t as number);
      }
      const robot = obj.getObjectByName('robot');
      if (robot) robot.visible = !this.anyDefusing;
    });
  }
  private paleSkin = lambert(0xcdbfb4);
  private makePerson(p: SnapPerson): THREE.Object3D {
    const group = new THREE.Group();
    const rig = new THREE.Group();
    group.add(rig);
    const isFire = /fire|rescue/.test(p.model), isPolice = /officer/.test(p.model), isMed = /paramedic|doctor/.test(p.model), isTech = /tech|berger/.test(p.model), isBomb = /bomb/.test(p.model);
    const uniform = p.kind === 'responder' ? roleColor(p.model) : p.kind === 'suspect' ? 0x90a4ae : p.kind === 'victim' ? 0xffab91 : pedColor(p.model);
    const trousers = p.kind === 'responder' ? (isFire ? 0x1f2430 : isPolice ? 0x1b2236 : isTech ? 0xd96a14 : 0x2a2f38) : [0x2d3340, 0x3a3f4b, 0x4a4036, 0x25303a][p.id % 4];
    const skinTones = [0xe8c39e, 0xd2a07a, 0xb27a56, 0x8a5a3c, 0xf2d3b3];
    const skin = lambert(skinTones[p.id % skinTones.length]);
    const hairCols = [0x2b1d12, 0x4a3320, 0x8a6a3a, 0xc9a45a, 0x1a1a1a, 0x7a3a22];
    const cloth = paint(uniform);
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = rig): THREE.Mesh => { const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
    const legGeo = sharedCapsule(0.075, 0.34), armGeo = sharedCapsule(0.055, 0.28, -0.17), torsoGeo = sharedRounded(0.3, 0.52, 0.46, 0.09);
    const trouserM = lambert(trousers);
    const legA = mk(legGeo, trouserM, 0, 0.25, 0.1), legB = mk(legGeo, trouserM, 0, 0.25, -0.1);
    const boots = lambert(isFire ? 0x3a2f1c : 0x15151a);
    mk(sharedRounded(0.26, 0.1, 0.14, 0.04), boots, 0.04, 0.05, 0.1); mk(sharedRounded(0.26, 0.1, 0.14, 0.04), boots, 0.04, 0.05, -0.1);
    const torso = mk(torsoGeo, cloth, 0, 0.78, 0);
    mk(sharedRounded(0.31, 0.07, 0.47, 0.03), lambert(0x15151a), 0, 0.55, 0); // belt
    const armL = mk(armGeo, cloth, 0, 1.0, 0.29), armR = mk(armGeo, cloth, 0, 1.0, -0.29);
    mk(sharedSphere(0.045), skin, 0, 0.75, 0.29, armL); mk(sharedSphere(0.045), skin, 0, 0.75, -0.29, armR); // hands rotate with the arms
    armL.children.forEach(c => c.position.set(0, -0.3, 0)); armR.children.forEach(c => c.position.set(0, -0.3, 0));
    mk(sharedCapsule(0.045, 0.06), skin, 0, 1.06, 0); // neck
    const head = mk(sharedSphere(0.15), skin, 0, 1.2, 0);
    mk(sharedSphere(0.02), lambert(0x111111), 0.13, 1.22, 0.06); mk(sharedSphere(0.02), lambert(0x111111), 0.13, 1.22, -0.06); // eyes (the face looks along +x)
    if (p.kind === 'responder') {
      const helmetCol = isFire ? 0xf2c230 : isPolice ? 0x1b2a55 : isMed ? 0xf2f2f2 : isTech || isBomb ? 0xf08a1a : 0xdddddd;
      const hm = lambert(helmetCol);
      mk(sharedHelmet(), hm, 0, 1.25, 0);
      if (isFire) { mk(sharedRounded(0.12, 0.03, 0.36, 0.01), hm, -0.12, 1.2, 0); mk(sharedRounded(0.05, 0.12, 0.2, 0.02), lambert(0x15151a), 0.15, 1.2, 0); } // neck guard + visor
      if (isPolice) { mk(sharedRounded(0.16, 0.025, 0.3, 0.01), lambert(0x111522), 0.14, 1.26, 0); } // cap peak
      mk(sharedRounded(0.32, 0.07, 0.48, 0.02), lambert(0xe8e04a), 0, 0.64, 0); // reflective band
      mk(sharedRounded(0.32, 0.05, 0.48, 0.02), lambert(0xe8e04a), 0, 0.92, 0);
      if (isFire) { mk(sharedCapsule(0.09, 0.3), lambert(0xc9ced4), -0.26, 0.82, 0); } // air cylinder
      if (isMed) mk(sharedRounded(0.32, 0.08, 0.48, 0.02), lambert(0xff7a1a), 0, 0.8, 0);
    } else {
      mk(sharedHair(), lambert(hairCols[(p.id * 7) % hairCols.length]), -0.01, 1.24, 0);
      if (p.kind === 'pedestrian' && p.id % 4 === 0) mk(sharedRounded(0.14, 0.2, 0.28, 0.04), lambert([0x4a3a2a, 0x2a3a4a, 0x7a2a2a][p.id % 3]), -0.24, 0.82, 0); // backpack
    }
    group.userData.arms = [armL, armR];
    group.userData.rig = rig;
    group.userData.parts = { legs: [legA, legB], torso, head, skin };
    group.userData.kind = 'person';
    group.userData.id = p.id;
    return group;
  }
  private victimProps = new Map<number, { obj: THREE.Object3D; key: string; frame: number }>();
  private bagProps = new Map<number, { obj: THREE.Object3D; frame: number }>();
  private syncPeople(list: SnapPerson[]): void {
    const seenVictims = new Set<number>();
    this.track(this.people, list, p => this.makePerson(p), (obj, p) => {
      const info = p.info;
      const lying = p.kind === 'victim' && p.state !== 'carried';
      obj.visible = true;
      obj.position.set(p.position.x, 0, p.position.z);
      obj.rotation.y = lying ? 0 : -p.heading;
      obj.rotation.z = lying ? Math.PI / 2 : 0;
      const onBed = !!(info && info.treated && p.state === 'scene');
      const gy = groundHeight(this.world!, this.groundKinds, p.position.x, p.position.z);
      obj.position.y = gy + (lying ? (onBed ? 0.78 : 0.2) : 0);
      const rig = obj.userData.rig as THREE.Group;
      const parts = obj.userData.parts as { legs: THREE.Mesh[]; torso: THREE.Mesh; head: THREE.Mesh; skin: THREE.Material };
      if (info && parts) parts.head.material = info.health < 45 ? this.paleSkin : parts.skin;
      const arms = obj.userData.arms as THREE.Mesh[] | undefined;
      const t = this.time * 7 + p.id;
      const kneeling = p.state === 'treat' || p.state === 'rescue';
      rig.position.y = kneeling ? -0.26 : 0;
      rig.rotation.x = p.state === 'extinguish' ? 0.18 : 0; // lean into the hose
      if (parts) for (const l of parts.legs) { l.scale.y = kneeling ? 0.55 : 1; l.position.y = kneeling ? 0.14 : 0.25; }
      if (arms) {
        const walking = p.state === 'walking' || p.state === 'move' || p.state === 'leaving';
        const working = p.state === 'extinguish' || p.state === 'arrest' || p.state === 'clear' || p.state === 'secure' || p.state === 'defuse';
        if (p.state === 'treat') { // chest compressions
          const pump = Math.sin(this.time * 9 + p.id) * 0.3;
          arms[0].rotation.z = -1.35 + pump; arms[1].rotation.z = -1.35 + pump;
        } else {
          arms[0].rotation.z = walking ? Math.sin(t) * 0.7 : working ? -1.1 : 0;
          arms[1].rotation.z = walking ? -Math.sin(t) * 0.7 : working ? -1.1 : 0;
        }
      }
      if (p.kind === 'victim' && info) {
        seenVictims.add(p.id);
        const trauma = /accident|collision|hit|fall|armed|fight/.test(info.incidentKind);
        const key = `${p.state}|${info.treated ? 1 : 0}|${trauma && info.health < 85 ? 1 : 0}`;
        let vp = this.victimProps.get(p.id);
        if (!vp || vp.key !== key) {
          if (vp) { this.scene.remove(vp.obj); this.disposeObj(vp.obj); }
          const g = new THREE.Group();
          if (p.state === 'dead') g.add(buildStretcher(0xe0b030));
          else if (p.state === 'scene' && info.treated) g.add(buildStretcher(0xd24a2a));
          else if (p.state === 'scene' && trauma && info.health < 85) g.add(buildBloodPool(p.id));
          this.scene.add(g);
          vp = { obj: g, key, frame: 0 };
          this.victimProps.set(p.id, vp);
        }
        vp.frame = this.frame;
        vp.obj.position.set(p.position.x, 0, p.position.z);
      }
      if (p.state === 'treat') { // medical bag next to the kneeling paramedic
        let bag = this.bagProps.get(p.id);
        if (!bag) { const g = buildMedBag(); this.scene.add(g); bag = { obj: g, frame: 0 }; this.bagProps.set(p.id, bag); }
        bag.frame = this.frame;
        bag.obj.position.set(p.position.x + Math.cos(-p.heading + 1.2) * 0.8, 0, p.position.z + Math.sin(-p.heading + 1.2) * 0.8);
      }
    });
    for (const [id, vp] of this.victimProps) if (vp.frame !== this.frame || !seenVictims.has(id)) { this.scene.remove(vp.obj); this.disposeObj(vp.obj); this.victimProps.delete(id); }
    for (const [id, bp] of this.bagProps) if (bp.frame !== this.frame) { this.scene.remove(bp.obj); this.disposeObj(bp.obj); this.bagProps.delete(id); }
  }
  private syncCars(list: SnapCar[]): void {
    this.track(this.cars, list, c => {
      const { group, parts } = buildCivilianCar(c.model, c.id);
      group.userData.parts = parts;
      return group;
    }, (obj, c) => {
      const px = obj.position.x, pz = obj.position.z;
      obj.position.set(c.position.x, 0, c.position.z);
      obj.rotation.y = -c.heading;
      this.animateParts(obj.userData.parts as VehicleParts, Math.hypot(c.position.x - px, c.position.z - pz) > 0.002, false, this.lastDt);
    });
  }

  private incidentSpriteTexture(icon: string, color: string): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2); ctx.fill();
    ctx.font = '34px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(icon, 32, 34);
    return new THREE.CanvasTexture(c);
  }
  private beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  private propsFor(kind: string, seed: number): THREE.Group {
    const g = new THREE.Group();
    if (/accident|collision|hit/.test(kind)) {
      g.add(buildAccidentDetail(seed));
      const w = buildWreck(seed); w.position.set(0, 0, 0); w.rotation.y = seed * 0.9; g.add(w);
      if (kind !== 'pedestrian_hit') { const w2 = buildWreck(seed + 1); w2.position.set(3.2, 0, 2.4); w2.rotation.y = seed * 0.9 + 1.2; g.add(w2); }
      const d = buildDebris(seed); d.position.set(1.5, 0, 1); g.add(d);
    } else if (kind === 'burglary' || kind === 'armed_robbery' || kind === 'vandalism' || kind === 'fight' || kind === 'crime') {
      const d = buildDebris(seed); d.position.set(0, 0, 0); g.add(d);
    }
    return g;
  }
  private syncIncidents(snap: RenderSnapshot): void {
    const keep = new Set<number>();
    for (const inc of snap.incidents) {
      keep.add(inc.id);
      let s = this.incidentMarkers.get(inc.id);
      const col = inc.severity >= 3 ? 0xff1744 : inc.severity === 2 ? 0xffa000 : 0xffee58;
      if (!s) {
        const css = '#' + col.toString(16).padStart(6, '0');
        const mat = new THREE.SpriteMaterial({ map: this.incidentSpriteTexture('❗', css), depthTest: false });
        s = new THREE.Sprite(mat);
        s.scale.set(1.6, 1.6, 1);
        this.scene.add(s);
        this.incidentMarkers.set(inc.id, s);
      }
      let fx = this.incidentFx.get(inc.id);
      const p0 = tileToWorld3D(inc.x, inc.y);
      if (!fx) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.2, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p0.x, 0.08, p0.z);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.8, 40, 12, 1, true), this.beamMat.clone());
        (beam.material as THREE.MeshBasicMaterial).color.setHex(col);
        beam.position.set(p0.x, 20, p0.z);
        const props = this.propsFor(inc.kind, inc.id);
        props.position.set(p0.x + 3.2, 0, p0.z + 1.2);
        this.scene.add(ring, beam, props);
        let pack: THREE.Group | undefined;
        if (inc.kind === 'suspicious_package') {
          const bb = snap.buildings.find(x => Math.abs(x.x + x.w / 2 - inc.x) < 0.01 && Math.abs(x.y + x.h / 2 - inc.y) < 0.01);
          pack = buildSuspectPackage();
          pack.position.set(p0.x, 0, p0.z + ((bb ? bb.h : 3) / 2 + 0.8) * TILE_METERS);
          this.scene.add(pack);
        }
        let steam: THREE.Vector3[] | undefined;
        if (/accident|collision|hit/.test(inc.kind)) steam = [new THREE.Vector3(props.position.x, 1.0, props.position.z)];
        let beacon: THREE.Mesh | undefined;
        if (/burglary|armed_robbery/.test(inc.kind)) { // burglar alarm beacon on the front of the building
          const bb2 = snap.buildings.find(x => Math.abs(x.x + x.w / 2 - inc.x) < 0.01 && Math.abs(x.y + x.h / 2 - inc.y) < 0.01);
          beacon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 1 }));
          beacon.position.set(p0.x, 3.8, p0.z + ((bb2 ? bb2.h : 3) / 2) * TILE_METERS + 0.3);
          this.scene.add(beacon);
        }
        fx = { ring, beam, props, pack, steam, beacon };
        this.incidentFx.set(inc.id, fx);
      }
      if (fx.pack) { // the bomb robot rolls up to the package while the crew defuses it
        if (inc.defusing && !fx.robot) { fx.robot = buildBombRobot(); fx.robot.position.set(fx.pack.position.x - 1.8, 0, fx.pack.position.z + 1.2); fx.robot.rotation.y = -0.6; this.scene.add(fx.robot); }
        if (fx.robot) { fx.robot.visible = inc.defusing; fx.robot.children.forEach((c, i) => { if (i === 5) c.rotation.z = -0.25 + Math.sin(this.time * 3) * 0.2; }); }
        fx.pack.visible = !inc.defused;
      }
      if (fx.beacon) (fx.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(this.time * 10) > 0 ? 2 : 0.1;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3 + inc.id);
      (fx.ring.material as THREE.MeshBasicMaterial).opacity = 0.3 + pulse * 0.4;
      fx.ring.scale.setScalar(1 + pulse * 0.08);
      (fx.beam.material as THREE.MeshBasicMaterial).opacity = 0.03 + pulse * 0.05;
      if (inc.secured && !fx.tape) {
        const tape = new THREE.Group();
        const posts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        const a = 5.2;
        for (const [px, pz] of posts) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6), lambert(0xdddddd)); post.position.set(p0.x + px * a, 0.65, p0.z + pz * a); tape.add(post); }
        for (let i = 0; i < 4; i++) {
          const A = new THREE.Vector3(p0.x + posts[i][0] * a, 1.15, p0.z + posts[i][1] * a), B = new THREE.Vector3(p0.x + posts[(i + 1) % 4][0] * a, 1.15, p0.z + posts[(i + 1) % 4][1] * a);
          const seg = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xffffff : 0xe53935, emissive: 0x330000 }));
          setSegment(seg, A, B, 0.07);
          tape.add(seg);
        }
        const flares: THREE.Vector3[] = [];
        for (let i = 0; i < 4; i++) { // cones along every side, a flare at each corner, barriers mid-side
          const A = posts[i], B = posts[(i + 1) % 4];
          for (let k = 0; k < 5; k++) {
            const cone = buildCone();
            cone.position.set(p0.x + (A[0] + (B[0] - A[0]) * (k / 5)) * a * 0.96, 0, p0.z + (A[1] + (B[1] - A[1]) * (k / 5)) * a * 0.96);
            tape.add(cone);
          }
          const fl = buildFlare();
          fl.position.set(p0.x + A[0] * a * 0.85, 0, p0.z + A[1] * a * 0.85);
          tape.add(fl);
          flares.push(fl.position.clone().setY(0.4));
          if (i % 2 === 0) {
            const bar = buildBarrier();
            bar.position.set(p0.x + (A[0] + B[0]) / 2 * a * 1.04, 0, p0.z + (A[1] + B[1]) / 2 * a * 1.04);
            bar.rotation.y = i === 0 ? 0 : Math.PI / 2;
            tape.add(bar);
          }
        }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { // road closed to traffic at the cordon edge (the simulation re-routes civilians)
          const tx = Math.floor(inc.x + dx * 3.2), ty = Math.floor(inc.y + dz * 3.2);
          for (const k of [-1, 0, 1]) {
            const bx = tx + (dz ? k : 0), by = ty + (dx ? k : 0);
            if (!this.world?.isRoad(bx, by)) continue;
            const bp = tileToWorld3D(bx + 0.5, by + 0.5);
            const bar = buildBarrier();
            bar.position.set(bp.x, 0, bp.z);
            bar.rotation.y = dx ? Math.PI / 2 : 0;
            tape.add(bar);
          }
        }
        fx.flares = flares;
        this.scene.add(tape);
        fx.tape = tape;
      }
      const b = snap.buildings.find(bb => Math.abs(bb.x + bb.w / 2 - inc.x) < 0.01 && Math.abs(bb.y + bb.h / 2 - inc.y) < 0.01);
      s.position.set(p0.x, (b ? b.heightMeters : 1) + 3 + Math.sin(this.time * 4 + inc.id) * 0.3, p0.z);
    }
    for (const [id, s] of this.incidentMarkers) if (!keep.has(id)) { this.scene.remove(s); this.disposeObj(s); this.incidentMarkers.delete(id); }
    for (const [id, f] of this.incidentFx) if (!keep.has(id)) {
      this.scene.remove(f.ring, f.beam, f.props); this.disposeObj(f.ring); this.disposeObj(f.beam); this.disposeObj(f.props);
      for (const extra of [f.pack, f.robot, f.beacon]) if (extra) { this.scene.remove(extra); this.disposeObj(extra); }
      if (f.tape) { this.scene.remove(f.tape); this.disposeObj(f.tape); }
      this.incidentFx.delete(id);
    }
  }

  /** Blocking obstacles (fallen tree, blockade, broken-down truck) as props on their road tiles. */
  private syncObstacles(snap: RenderSnapshot): void {
    const key = snap.obstacles.map(o => `${o.kind}@${o.x},${o.y}`).join(';');
    if (key === this.obstacleKey) return;
    this.obstacleKey = key;
    this.disposeGroup(this.propsGroup);
    for (const o of snap.obstacles) {
      const p = tileToWorld3D(o.x + 0.5, o.y + 0.5);
      const g = o.kind === 'fallen_tree' ? buildFallenTree(o.x + o.y)
        : o.kind === 'broken_down_truck' ? buildWreck(o.x * 7 + o.y)
        : buildBarrier();
      if (o.kind === 'broken_down_truck') g.scale.set(1.25, 1.25, 1.25);
      g.position.set(p.x, 0, p.z);
      g.rotation.y = ((o.x * 31 + o.y * 17) % 7) * 0.45;
      this.propsGroup.add(g);
    }
  }

  /** Burn marks, collapsed buildings. */
  private syncBuildings(snap: RenderSnapshot): void {
    for (const sb of snap.buildings) {
      const bo = this.buildingObjs.get(sb.id);
      if (!bo) continue;
      const key = sb.destroyed ? 'd' : `${Math.round(sb.damage / 8)}:${sb.fire > 0 ? 1 : 0}:${Math.round(sb.wet / 12)}`;
      if (key === bo.key) continue;
      bo.key = key;
      const char = sb.destroyed ? 0.9 : Math.min(0.8, sb.damage / 100 * 0.9 + (sb.fire > 0 ? 0.08 : 0));
      const wetK = 1 - 0.22 * Math.min(1, sb.wet / 100); // wet facades look darker
      bo.bodyMat.color.copy(bo.wall).lerp(CHAR, char).multiplyScalar(wetK);
      bo.roofMat.color.copy(bo.roofCol).lerp(CHAR, Math.min(0.95, char + 0.1));
      bo.roof.visible = !sb.destroyed;
      if (sb.destroyed) this.hideBuildingExtras(bo);
      bo.body.scale.y = sb.destroyed ? 0.3 : 1;
      bo.body.position.y = (bo.h * bo.body.scale.y) / 2;
    }
  }

  // ---------- hoses and water ----------
  private syncHoses(snap: RenderSnapshot): void {
    const live = this.host.state === 'playing';
    let n = 0;
    for (const p of snap.people) {
      if (!p.hose) continue;
      const A = new THREE.Vector3(p.hose.fromX * TILE_METERS, 0.25, p.hose.fromY * TILE_METERS);
      const B = new THREE.Vector3(p.position.x, 0.25, p.position.z);
      // sag the hose a little: two segments through a midpoint close to the ground
      const M = A.clone().add(B).multiplyScalar(0.5); M.y = 0.12;
      for (const [u, v] of [[A, M], [M, B]] as [THREE.Vector3, THREE.Vector3][]) {
        let seg = this.hoseSegs[n];
        if (!seg) { seg = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.hoseMat); seg.userData.shared = true; this.hoseSegs.push(seg); this.scene.add(seg); }
        seg.visible = true;
        setSegment(seg, u, v, 0.16);
        n++;
      }
      const sp = p.hose.spray;
      if (sp && live) { // water jet: ballistic droplets from the nozzle towards the burning building
        const nozzle = new THREE.Vector3(B.x, 1.2, B.z);
        const target = new THREE.Vector3(sp.x * TILE_METERS, (this.buildingObjs.get(sp.buildingId)?.h ?? 6) * 0.55, sp.y * TILE_METERS);
        const dir = target.clone().sub(nozzle);
        const dist = Math.max(1, dir.length());
        const speed = 16, tFlight = dist / speed;
        const vy = dir.y / tFlight + 4.5 * tFlight; // gravity -9 → compensate
        for (let k = 0; k < 4; k++) {
          const j = 0.25;
          this.water.emit({ x: nozzle.x, y: nozzle.y, z: nozzle.z, vx: (dir.x / tFlight) + (Math.random() - 0.5) * j * 4, vy: vy + (Math.random() - 0.5) * j * 3, vz: (dir.z / tFlight) + (Math.random() - 0.5) * j * 4, life: tFlight * 1.15, size0: 0.35, size1: 0.18, c0: 0xcfe9ff, c1: 0x6fb4ee, alpha: 0.85 });
        }
      }
    }
    for (const v of snap.vehicles) { // supply hose from the hydrant to a hooked-up vehicle
      if (!v.hydrant || !this.world) continue;
      const nh = this.world.nearestHydrant(v.x, v.y);
      if (!nh) continue;
      const A = new THREE.Vector3((nh.h.x + 0.5) * TILE_METERS, 0.3, (nh.h.y + 0.5) * TILE_METERS), B = new THREE.Vector3(v.position.x, 0.3, v.position.z);
      const M = A.clone().add(B).multiplyScalar(0.5); M.y = 0.12;
      for (const [u, w2] of [[A, M], [M, B]] as [THREE.Vector3, THREE.Vector3][]) {
        let seg = this.hoseSegs[n];
        if (!seg) { seg = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.hoseMat); seg.userData.shared = true; this.hoseSegs.push(seg); this.scene.add(seg); }
        seg.visible = true; setSegment(seg, u, w2, 0.22); n++;
      }
    }
    for (let i = n; i < this.hoseSegs.length; i++) this.hoseSegs[i].visible = false;
  }

  private syncSelection(snap: RenderSnapshot): void {
    const keep = new Set<number>();
    const ring = (id: number, x: number, z: number, r: number): void => {
      keep.add(id);
      let m = this.selectionRings.get(id);
      if (!m) {
        m = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 24), new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        this.scene.add(m);
        this.selectionRings.set(id, m);
      }
      m.position.set(x, 0.06, z);
    };
    for (const v of snap.vehicles) if (this.host.selected.has(v.id)) ring(v.id, v.position.x, v.position.z, v.size.length * 0.65);
    for (const p of snap.people) if (p.kind === 'responder' && this.host.selected.has(p.id)) ring(p.id, p.position.x, p.position.z, 0.75);
    for (const [id, m] of this.selectionRings) if (!keep.has(id)) { this.scene.remove(m); this.disposeObj(m); this.selectionRings.delete(id); }
  }

  private syncTrafficLights(phase: 0 | 1): void {
    if (phase === this.lightPhase) return;
    this.lightPhase = phase;
    for (const b of this.trafficBulbs) {
      const green = (phase === 0) === b.ew;
      const mat = b.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(green ? 0x43e05a : 0xf44336);
      mat.emissive.set(green ? 0x43e05a : 0xf44336);
    }
  }

  // ---------- fire / smoke ----------
  /** Windows of burning buildings glow orange and flicker; more of them as the fire grows. */
  private updateFireWindows(snap: RenderSnapshot): void {
    const fw = this.fireWin;
    if (!fw) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), grow = new THREE.Matrix4().makeScale(1.12, 1.12, 2.2), tmp = new THREE.Matrix4(), col = new THREE.Color();
    let colorsDirty = false, matsDirty = false;
    for (const sb of snap.buildings) {
      const bo = this.buildingObjs.get(sb.id);
      if (!bo || bo.fw.start < 0) continue;
      const burning = sb.fire > 0 && !sb.destroyed;
      const key = burning ? String(Math.round((sb.fire / 100) * 24)) : 'off';
      if (key !== bo.fw.key) {
        bo.fw.key = key;
        const k = burning ? Math.min(1, (sb.fire / 100) * 1.25) : 0;
        bo.fw.mats.forEach((m, j) => {
          const on = burning && (((j * 2654435761) >>> 0) % 1000) / 1000 < k;
          fw.setMatrixAt(bo.fw.start + j, on ? tmp.copy(m).multiply(grow) : zero);
        });
        matsDirty = true;
      }
      if (!burning) continue;
      bo.fw.mats.forEach((_, j) => {
        const f = 0.55 + 0.45 * Math.sin(this.time * 9 + j * 1.7) * Math.sin(this.time * 5.3 + j);
        col.setRGB(1, 0.35 + 0.4 * f, 0.05 + 0.1 * f);
        fw.setColorAt(bo.fw.start + j, col);
      });
      colorsDirty = true;
    }
    if (matsDirty) fw.instanceMatrix.needsUpdate = true;
    if (colorsDirty && fw.instanceColor) fw.instanceColor.needsUpdate = true;
  }

  private updateFire(snap: RenderSnapshot, dt: number): void {
    const live = this.host.state === 'playing';
    this.updateFireWindows(snap);
    const burning: { b: typeof snap.buildings[number]; cx: number; cz: number; k: number }[] = [];
    for (const b of snap.buildings) {
      if (b.fire <= 0) continue;
      const k = Math.min(1, b.fire / 100);
      burning.push({ b, cx: (b.x + b.w / 2) * TILE_METERS, cz: (b.y + b.h / 2) * TILE_METERS, k });
      if (!live) continue;
      const w = b.w * TILE_METERS, d = b.h * TILE_METERS, top = b.destroyed ? b.heightMeters * 0.3 : b.heightMeters;
      // tongues of flame out of windows (on the walls, bending upwards) and a fire bed on the roof
      let nFlames = (2 + k * 20) * dt * 7;
      while (nFlames > 0) {
        if (Math.random() < Math.min(1, nFlames)) {
          const wall = Math.random() < 0.6 && !b.destroyed;
          let x: number, z: number, y: number, vx = (Math.random() - 0.5) * 0.7, vz = (Math.random() - 0.5) * 0.7;
          if (wall) {
            const side = Math.floor(Math.random() * 4);
            y = 1.6 + Math.random() * Math.max(1, top - 2.2);
            x = side < 2 ? (b.x + Math.random() * b.w) * TILE_METERS : (b.x + (side === 2 ? 0 : b.w)) * TILE_METERS;
            z = side < 2 ? (b.y + (side === 0 ? 0 : b.h)) * TILE_METERS : (b.y + Math.random() * b.h) * TILE_METERS;
            if (side < 2) vz += (side === 0 ? -1 : 1) * 0.9; else vx += (side === 2 ? -1 : 1) * 0.9; // flames lean out of the window
          } else { x = cx(b, w) + (Math.random() - 0.5) * w * 0.85; z = cz(b, d) + (Math.random() - 0.5) * d * 0.85; y = top; }
          const s = 2.0 + k * 2.6 + Math.random() * 1.2;
          this.flames.emit({ x, y: y + s * 0.25, z, vx, vy: 1.6 + k * 2.4 + Math.random() * 1.4, vz, life: 0.5 + Math.random() * 0.55, size0: s * 0.7, size1: s * 1.15, c0: Math.random() < 0.3 ? 0xffd860 : 0xff8a1c, c1: 0xd0300a, alpha: 0.95 });
        }
        nFlames -= 1;
      }
      // heat glow over the roof
      if (Math.random() < dt * (3 + k * 12)) this.halo.emit({ x: cx(b, w) + (Math.random() - 0.5) * w * 0.6, y: top + 1.5, z: cz(b, d) + (Math.random() - 0.5) * d * 0.6, vx: 0, vy: 0.4, vz: 0, life: 0.9, size0: 7 + k * 8, size1: 10 + k * 10, c0: 0xff6a1a, c1: 0xa02808, alpha: 0.1 + k * 0.09 });
      // smoke: reddish-black at the base, thickening with the fire, leaning with the wind
      let nSmoke = (1.5 + k * 11) * dt * 6;
      while (nSmoke > 0) {
        if (Math.random() < Math.min(1, nSmoke)) {
          const dark = 0.12 + Math.random() * 0.14;
          const c = (Math.round(dark * 255 * 1.2) << 16) | (Math.round(dark * 255) << 8) | Math.round(dark * 255);
          this.smoke.emit({ x: cx(b, w) + (Math.random() - 0.5) * w * 0.7, y: top + 0.8, z: cz(b, d) + (Math.random() - 0.5) * d * 0.7, vx: 1.4 + Math.random() * 0.8, vy: 2.8 + k * 2.8 + Math.random() * 1.2, vz: 0.5 + Math.random() * 0.5, life: 3.6 + Math.random() * 2.4 + k * 1.5, size0: 1.8 + k * 1.2, size1: 6 + k * 5, c0: c, c1: 0x9a9aa0, alpha: 0.2 + k * 0.1 });
        }
        nSmoke -= 1;
      }
      // sparks and embers
      if (Math.random() < k * dt * 14) this.halo.emit({ x: cx(b, w) + (Math.random() - 0.5) * w * 0.5, y: top, z: cz(b, d) + (Math.random() - 0.5) * d * 0.5, vx: (Math.random() - 0.3) * 3.5, vy: 4 + Math.random() * 4, vz: (Math.random() - 0.5) * 3.5, life: 1.6, size0: 0.28, size1: 0.1, c0: 0xffd060, c1: 0xff3000, alpha: 1 });
    }
    // flickering light on the (up to three) strongest fires
    burning.sort((a, c) => c.k - a.k);
    this.fireLights.forEach((l, i) => {
      const f = burning[i];
      l.visible = !!f;
      if (!f) return;
      l.position.set(f.cx, Math.min(f.b.heightMeters, 12) * 0.7, f.cz);
      l.distance = 46;
      l.intensity = (80 + 200 * f.k) * (0.85 + 0.15 * Math.sin(this.time * 17 + i * 3) + 0.1 * Math.sin(this.time * 31));
    });
    if (live) for (const f of this.incidentFx.values()) {
      for (const p of f.flares ?? []) if (Math.random() < dt * 12) this.halo.emit({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 0.6, vy: 0.8 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 0.5, size0: 0.6, size1: 0.2, c0: 0xff6a4a, c1: 0xb01010, alpha: 0.9 });
      for (const p of f.steam ?? []) if (Math.random() < dt * 5) this.smoke.emit({ x: p.x, y: p.y, z: p.z, vx: 0.3, vy: 1.3, vz: 0.2, life: 2.4, size0: 0.6, size1: 3.4, c0: 0xe4e4e4, c1: 0xffffff, alpha: 0.22 });
    }
    this.flames.update(dt); this.halo.update(dt); this.smoke.update(dt); this.water.update(dt);
  }

  // ---------- input ----------
  private bindInput(): void {
    window.addEventListener('keydown', e => { if ('wasd'.includes(e.key.toLowerCase())) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', e => { this.keys.delete(e.key.toLowerCase()); });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    this.canvas.addEventListener('pointerdown', e => {
      this.canvas.focus();
      if (this.host.state !== 'playing' || !this.world) return;
      if (e.button === 1) { this.pointer.rotating = true; this.pointer.lastX = e.clientX; this.canvas.setPointerCapture(e.pointerId); return; }
      const t = this.screenToTile(e.offsetX, e.offsetY);
      if (!t) return;
      if (e.button === 2) { this.commands.rightClick(t.x, t.y); return; }
      if (e.button === 0) {
        this.pointer.downTile = t;
        this.pointer.downScreen = { x: e.offsetX, y: e.offsetY };
        this.pointer.dragging = false;
        this.pointer.shift = e.shiftKey;
        this.canvas.setPointerCapture(e.pointerId);
      }
    });
    this.canvas.addEventListener('pointermove', e => {
      if (this.pointer.rotating) { this.yaw -= (e.clientX - this.pointer.lastX) * 0.006; this.pointer.lastX = e.clientX; this.updateCamera(); return; }
      if (!this.world || this.host.state !== 'playing') return;
      if ((e.buttons & 1) === 0) return;
      if (!this.pointer.dragging && Math.hypot(e.offsetX - this.pointer.downScreen.x, e.offsetY - this.pointer.downScreen.y) > 6) this.pointer.dragging = true;
      if (this.pointer.dragging) {
        const t = this.screenToTile(e.offsetX, e.offsetY);
        if (!t) return;
        const x0 = Math.min(this.pointer.downTile.x, t.x) * TILE_METERS, x1 = Math.max(this.pointer.downTile.x, t.x) * TILE_METERS;
        const z0 = Math.min(this.pointer.downTile.y, t.y) * TILE_METERS, z1 = Math.max(this.pointer.downTile.y, t.y) * TILE_METERS;
        this.dragBox.visible = true;
        this.dragBox.scale.set(Math.max(0.01, x1 - x0), Math.max(0.01, z1 - z0), 1);
        this.dragBox.position.set((x0 + x1) / 2, 0.05, (z0 + z1) / 2);
      }
    });
    this.canvas.addEventListener('pointerup', e => {
      if (this.pointer.rotating) { this.pointer.rotating = false; return; }
      if (e.button !== 0) return; // only the primary button completes a left-click / box-select; right/middle are handled on pointerdown
      this.dragBox.visible = false;
      if (!this.world || this.host.state !== 'playing') return;
      const t = this.screenToTile(e.offsetX, e.offsetY);
      if (!t) { this.pointer.dragging = false; return; }
      if (this.pointer.dragging) this.commands.boxSelect(this.pointer.downTile.x, this.pointer.downTile.y, t.x, t.y, this.pointer.shift);
      else this.commands.leftClick(t.x, t.y, this.pointer.shift);
      this.pointer.dragging = false;
    });
  }

  // ---------- cleanup ----------
  private disposeObj(obj: THREE.Object3D): void {
    obj.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
      const mp = (mesh.material as THREE.MeshLambertMaterial | undefined)?.map;
      if (mp && !mp.userData.shared) mp.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(m => { if (!m.userData.shared) m.dispose(); }); else if (mat && !mat.userData.shared) mat.dispose();
    });
  }
  private disposeGroup(group: THREE.Group): void {
    while (group.children.length) { const c = group.children[0]; group.remove(c); this.disposeObj(c); }
  }
}
