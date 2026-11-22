import * as THREE from 'three';
import type { World } from '../sim/world';
import type { RenderSnapshot, SnapCar, SnapPerson, SnapVehicle } from '../sim/snapshot';
import type { Category } from '../sim/types';
import type { GameRenderer } from './renderer';
import { TILE_METERS, tileToWorld3D, world3DToTile } from '../sim/space';
import { Commands, type SelectionHost } from './selection';

/**
 * First 3D view for OpenRescue (docs/3d.md). Everything is procedural (no external assets, MIT three.js): a baked
 * canvas texture for the ground (roads, lane markings, grass, parking, water), boxes with a roof shape for buildings,
 * primitive vehicles/people, a particle pool for fire/smoke and a billboard per incident. Input reuses `Commands`
 * (selection.ts) so orders behave exactly like the 2D view; only the RTS camera and ray-picking are new.
 */

const CAT_COLOR: Record<Category, number> = { fire: 0xb23b2e, ambulance: 0xf1efe6, police: 0x1f3d7a, tech: 0x5a7a30 };
const CAT_ACCENT: Record<Category, number> = { fire: 0xffcc33, ambulance: 0xff6f3c, police: 0x3f7bff, tech: 0xd8e05a };
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

const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

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
function gableRoofGeometry(w: number, d: number, rise: number): THREE.BufferGeometry {
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

function buildRoof(type: string, w: number, d: number): THREE.Object3D {
  const rise = Math.min(w, d) * 0.28;
  if (type === 'gable') return new THREE.Mesh(gableRoofGeometry(w, d, rise));
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

interface Tracked { obj: THREE.Object3D; frame: number; blink?: THREE.Mesh }

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
  private groundMesh: THREE.Mesh | null = null;
  private buildingsGroup = new THREE.Group();
  private treesGroup = new THREE.Group();
  private lightsGroup = new THREE.Group();
  private vehicles = new Map<number, Tracked>();
  private people = new Map<number, Tracked>();
  private cars = new Map<number, Tracked>();
  private incidentMarkers = new Map<number, THREE.Sprite>();
  private selectionRings = new Map<number, THREE.Mesh>();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private frame = 0;
  private lightPhase = -1;
  private time = 0;
  private trafficBulbs: { pos: THREE.Vector3; ew: boolean; mesh: THREE.Mesh }[] = [];
  private dragBox: THREE.Mesh;
  private keys = new Set<string>();
  private pointer = { downTile: { x: 0, y: 0 }, downScreen: { x: 0, y: 0 }, dragging: false, shift: false, rotating: false, lastX: 0 };
  // fire/smoke particle pool
  private readonly MAX_PARTICLES = 500;
  private particles: THREE.Points;
  private pPos: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pMax: Float32Array;
  private pKind: Uint8Array; // 0 = flame, 1 = smoke
  private pCursor = 0;

  constructor(private host: SelectionHost) {
    this.commands = new Commands(host);
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', outline: 'none', touchAction: 'none' });
    this.canvas.tabIndex = 0;
    (document.getElementById('game-root') ?? document.body).appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2500);
    this.scene.background = new THREE.Color(0x1d2a1d);
    this.scene.fog = new THREE.Fog(0x1d2a1d, 220, 820);
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x33402a, 0.95));
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.05);
    sun.position.set(140, 220, 90);
    this.scene.add(sun);
    this.scene.add(this.buildingsGroup, this.treesGroup, this.lightsGroup);

    const dragMat = new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    this.dragBox = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dragMat);
    this.dragBox.rotation.x = -Math.PI / 2;
    this.dragBox.visible = false;
    this.scene.add(this.dragBox);

    this.pPos = new Float32Array(this.MAX_PARTICLES * 3);
    for (let i = 0; i < this.MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -1000;
    this.pVel = new Float32Array(this.MAX_PARTICLES * 3);
    this.pLife = new Float32Array(this.MAX_PARTICLES);
    this.pMax = new Float32Array(this.MAX_PARTICLES);
    this.pKind = new Uint8Array(this.MAX_PARTICLES);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    const colors = new Float32Array(this.MAX_PARTICLES * 3);
    pGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const pMat = new THREE.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true });
    this.particles = new THREE.Points(pGeo, pMat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

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
    for (const m of [this.vehicles, this.people, this.cars]) { for (const t of m.values()) this.disposeObj(t.obj); m.clear(); }
    for (const s of this.incidentMarkers.values()) this.disposeObj(s);
    this.incidentMarkers.clear();
    for (const r of this.selectionRings.values()) this.disposeObj(r);
    this.selectionRings.clear();
  }

  render(snap: RenderSnapshot, dt: number): void {
    this.frame++;
    this.time += dt;
    this.stepCamera(dt);
    this.syncVehicles(snap.vehicles);
    this.syncPeople(snap.people);
    this.syncCars(snap.cars);
    this.syncIncidents(snap);
    this.syncSelection(snap);
    this.syncTrafficLights(snap.lightPhase);
    this.updateFire(snap, dt);
    this.renderer.render(this.scene, this.camera);
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = (sx / (rect.width || this.canvas.width)) * 2 - 1;
    const ndcY = -(sy / (rect.height || this.canvas.height)) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return world3DToTile({ x: hit.x, y: hit.y, z: hit.z });
  }
  tileToScreen(tx: number, ty: number): { x: number; y: number } {
    const p = tileToWorld3D(tx, ty);
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
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
  }
  destroy(): void {
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
    const texel = 10, w = world.w, h = world.h;
    const canvas = document.createElement('canvas');
    canvas.width = w * texel; canvas.height = h * texel;
    const ctx = canvas.getContext('2d')!;
    const bays = new Set(world.map.stations.flatMap(st => (st.bays ?? []).map(b => b.y * w + b.x)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x * texel, py = y * texel;
        if (world.isRoad(x, y)) {
          ctx.fillStyle = '#3b3f46'; ctx.fillRect(px, py, texel, texel);
          ctx.fillStyle = '#a9a79f';
          if (!world.isRoad(x, y - 1)) ctx.fillRect(px, py, texel, 1);
          if (!world.isRoad(x, y + 1)) ctx.fillRect(px, py + texel - 1, texel, 1);
          if (!world.isRoad(x - 1, y)) ctx.fillRect(px, py, 1, texel);
          if (!world.isRoad(x + 1, y)) ctx.fillRect(px + texel - 1, py, 1, texel);
          if (!world.isIntersection(x, y) && (hash(x, y) % 3 === 0)) { ctx.fillStyle = '#e8e0a0'; ctx.fillRect(px + texel / 2 - 1, py + 2, 2, texel - 4); }
        } else if (world.isWater(x, y)) {
          ctx.fillStyle = '#2d6fa6'; ctx.fillRect(px, py, texel, texel);
          ctx.fillStyle = 'rgba(79,147,200,0.5)'; ctx.fillRect(px + 2, py + ((hash(x, y) % 4) * 2), texel - 4, 1);
        } else if (world.isParking(x, y)) {
          ctx.fillStyle = '#4b505b'; ctx.fillRect(px, py, texel, texel);
          if (bays.has(y * w + x)) { ctx.fillStyle = 'rgba(242,242,242,0.85)'; ctx.fillRect(px, py, 1, texel); ctx.fillRect(px + texel - 1, py, 1, texel); }
        } else {
          const v = hash(x, y) % 4;
          ctx.fillStyle = v === 0 ? '#34522f' : v === 1 ? '#2c4529' : '#315030';
          ctx.fillRect(px, py, texel, texel);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const W = w * TILE_METERS, H = h * TILE_METERS;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, W, 0, 0, W, 0, H, 0, 0, H], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.groundMesh);
  }

  private buildBuildings(world: World): void {
    this.disposeGroup(this.buildingsGroup);
    for (const b of world.buildings.values()) {
      const w = b.w * TILE_METERS, d = b.h * TILE_METERS;
      const heightMeters = (b.floors ?? Math.max(1, Math.round(b.height / 10))) * 3.2;
      const colors = BUILDING_COLORS[b.type] ?? { wall: 0x888888, roof: 0xaaaaaa };
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, heightMeters, d), new THREE.MeshLambertMaterial({ color: colors.wall }));
      body.position.y = heightMeters / 2;
      group.add(body);
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })).translateY(heightMeters / 2));
      const roof = buildRoof(b.roof ?? 'flat', w, d);
      (roof as THREE.Mesh).material = new THREE.MeshLambertMaterial({ color: colors.roof });
      roof.position.y = heightMeters;
      group.add(roof);
      group.position.set((b.x + b.w / 2) * TILE_METERS, 0, (b.y + b.h / 2) * TILE_METERS);
      group.name = `building:${b.id}`;
      group.userData.buildingId = b.id;
      this.buildingsGroup.add(group);
    }
  }

  private buildTrees(world: World): void {
    this.disposeGroup(this.treesGroup);
    const spots: { x: number; y: number }[] = [];
    for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) if (world.isTree(x, y)) spots.push({ x, y });
    if (!spots.length) return;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.28, 1.6, 6);
    const leafGeo = new THREE.ConeGeometry(1.6, 3.2, 7);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4e3a28 }), spots.length);
    const leaf = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x2f6b34 }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      const scale = 0.8 + (hash(s.x, s.y) % 5) / 10;
      const cx = (s.x + 0.5) * TILE_METERS + ((hash(s.x, s.y) >> 3) % 5) / 10, cz = (s.y + 0.5) * TILE_METERS;
      m.compose(new THREE.Vector3(cx, 0.8 * scale, cz), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      trunk.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(cx, 1.8 * scale, cz), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      leaf.setMatrixAt(i, m);
    });
    this.treesGroup.add(trunk, leaf);
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
      if (!t) { const obj = make(it); this.scene.add(obj); t = { obj, frame: 0 }; map.set(it.id, t); }
      t.frame = this.frame;
      upd(t.obj, it);
    }
    for (const [id, t] of map) if (t.frame !== this.frame) { this.scene.remove(t.obj); this.disposeObj(t.obj); map.delete(id); }
  }

  private makeVehicle(v: SnapVehicle): THREE.Object3D {
    const base = CAT_COLOR[v.category] ?? 0x888888;
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(v.size.length, v.size.height * 0.62, v.size.width), new THREE.MeshLambertMaterial({ color: base }));
    body.position.y = v.size.height * 0.31;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(v.size.length * 0.32, v.size.height * 0.4, v.size.width * 0.92), new THREE.MeshLambertMaterial({ color: 0xeef1f5 }));
    cab.position.set(v.size.length * 0.26, v.size.height * 0.62 + v.size.height * 0.2, 0);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(v.size.length * 0.5, 0.12, v.size.width * 0.8), new THREE.MeshStandardMaterial({ color: CAT_ACCENT[v.category], emissive: CAT_ACCENT[v.category], emissiveIntensity: 0.6 }));
    bar.position.set(-v.size.length * 0.05, v.size.height * 0.64, 0);
    bar.name = 'lightbar';
    group.add(body, cab, bar);
    group.userData.kind = 'vehicle';
    group.userData.id = v.id;
    return group;
  }
  private syncVehicles(list: SnapVehicle[]): void {
    this.track(this.vehicles, list, v => this.makeVehicle(v), (obj, v) => {
      obj.position.set(v.position.x, 0, v.position.z);
      obj.rotation.y = v.yaw;
      const bar = (obj as THREE.Group).getObjectByName('lightbar') as THREE.Mesh | undefined;
      if (bar) {
        const mat = bar.material as THREE.MeshStandardMaterial;
        const blink = v.lights && Math.floor(this.time * 7) % 2 === 0;
        mat.emissiveIntensity = blink ? 1.4 : v.lights ? 0.25 : 0.05;
      }
    });
  }
  private makePerson(p: SnapPerson): THREE.Object3D {
    const color = p.kind === 'responder' ? roleColor(p.model) : p.kind === 'suspect' ? 0x90a4ae : p.kind === 'victim' ? 0xffab91 : pedColor(p.model);
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.75, 4, 8), new THREE.MeshLambertMaterial({ color }));
    body.position.y = 0.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshLambertMaterial({ color: 0xe8c39e }));
    head.position.y = 1.1;
    group.add(body, head);
    group.userData.kind = 'person';
    group.userData.id = p.id;
    return group;
  }
  private syncPeople(list: SnapPerson[]): void {
    this.track(this.people, list, p => this.makePerson(p), (obj, p) => {
      const lying = p.kind === 'victim' && p.state !== 'carried';
      obj.visible = true;
      obj.position.set(p.position.x, 0, p.position.z);
      obj.rotation.y = lying ? 0 : -p.heading;
      obj.rotation.z = lying ? Math.PI / 2 : 0;
      obj.position.y = lying ? 0.2 : 0;
    });
  }
  private makeCar(): THREE.Object3D {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.2, 1.7), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
    body.position.y = 0.6;
    group.add(body);
    group.userData.kind = 'car';
    return group;
  }
  private syncCars(list: SnapCar[]): void {
    this.track(this.cars, list, c => {
      const obj = this.makeCar();
      ((obj as THREE.Group).children[0] as THREE.Mesh).material = new THREE.MeshLambertMaterial({ color: pedColor(c.model) });
      return obj;
    }, (obj, c) => {
      obj.position.set(c.position.x, 0, c.position.z);
      obj.rotation.y = -c.heading;
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
  private syncIncidents(snap: RenderSnapshot): void {
    const keep = new Set<number>();
    for (const inc of snap.incidents) {
      keep.add(inc.id);
      let s = this.incidentMarkers.get(inc.id);
      if (!s) {
        const col = inc.severity >= 3 ? '#ff1744' : inc.severity === 2 ? '#ffa000' : '#ffee58';
        const mat = new THREE.SpriteMaterial({ map: this.incidentSpriteTexture('❗', col), depthTest: false });
        s = new THREE.Sprite(mat);
        s.scale.set(2.2, 2.2, 1);
        this.scene.add(s);
        this.incidentMarkers.set(inc.id, s);
      }
      const b = snap.buildings.find(bb => Math.abs(bb.x + bb.w / 2 - inc.x) < 0.01 && Math.abs(bb.y + bb.h / 2 - inc.y) < 0.01);
      const p = tileToWorld3D(inc.x, inc.y, (b ? b.heightMeters : 1) + 2 + Math.sin(this.time * 4 + inc.id) * 0.3);
      s.position.set(p.x, p.y, p.z);
    }
    for (const [id, s] of this.incidentMarkers) if (!keep.has(id)) { this.scene.remove(s); this.disposeObj(s); this.incidentMarkers.delete(id); }
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
  private emit(x: number, y: number, z: number, kind: 0 | 1): void {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % this.MAX_PARTICLES;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    if (kind === 0) { this.pVel[i * 3] = (Math.random() - 0.5) * 1.5; this.pVel[i * 3 + 1] = 3.5 + Math.random() * 2; this.pVel[i * 3 + 2] = (Math.random() - 0.5) * 1.5; this.pMax[i] = 0.5 + Math.random() * 0.4; }
    else { this.pVel[i * 3] = (Math.random() - 0.5) * 1; this.pVel[i * 3 + 1] = 2 + Math.random() * 1.5; this.pVel[i * 3 + 2] = (Math.random() - 0.5) * 1; this.pMax[i] = 1.6 + Math.random(); }
    this.pLife[i] = 0;
    this.pKind[i] = kind;
    const colors = this.particles.geometry.getAttribute('color') as THREE.BufferAttribute;
    if (kind === 0) colors.setXYZ(i, 1, 0.45, 0.05); else colors.setXYZ(i, 0.45, 0.45, 0.48);
    colors.needsUpdate = true;
  }
  private updateFire(snap: RenderSnapshot, dt: number): void {
    const live = this.host.state === 'playing';
    for (const b of snap.buildings) {
      if (b.fire <= 0) continue;
      const n = (b.fire / 100) * 10 * dt;
      if (live) {
        let r = n * 2; while (r > 0) { if (Math.random() < Math.min(1, r)) this.emit((b.x + Math.random() * b.w) * TILE_METERS, b.heightMeters * (b.destroyed ? 0.3 : 1), (b.y + Math.random() * b.h) * TILE_METERS, 0); r -= 1; }
        let s = n; while (s > 0) { if (Math.random() < Math.min(1, s)) this.emit((b.x + Math.random() * b.w) * TILE_METERS, b.heightMeters, (b.y + Math.random() * b.h) * TILE_METERS, 1); s -= 1; }
      }
    }
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.particles.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      if (this.pLife[i] >= this.pMax[i] && this.pMax[i] === 0) continue;
      this.pLife[i] += dt;
      if (this.pLife[i] >= this.pMax[i]) { colors.setXYZ(i, 0, 0, 0); pos.setY(i, -1000); continue; }
      pos.setX(i, pos.getX(i) + this.pVel[i * 3] * dt);
      pos.setY(i, pos.getY(i) + this.pVel[i * 3 + 1] * dt);
      pos.setZ(i, pos.getZ(i) + this.pVel[i * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
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
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose()); else mat?.dispose();
    });
  }
  private disposeGroup(group: THREE.Group): void {
    while (group.children.length) { const c = group.children[0]; group.remove(c); this.disposeObj(c); }
  }
}
