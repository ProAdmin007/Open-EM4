import { tileHash } from './space';
import { Rng } from './rng';
import { findPath, type Vec } from './pathfinding';
import type {
  Ability, Building, Bystander, Category, Civilian, Content, Difficulty, GameEvent, Incident, IncidentDef, MapDef,
  MissionDef, Pedestrian, Responder, RoleDef, Suspect, Task, Vehicle, VehicleDef, Victim,
} from './types';

export const SIM_DT = 1 / 30;
/** Vehicle speed conversion: km/h in the data files -> tiles per second. */
export const KMH_TO_TILES = 1 / 12;
const FIRE_POWER_SCALE = 0.12;
const HOSE_LENGTH = 16;
const DEPLOY_TIME = 2.5;
/** Litres per second a working nozzle uses; a vehicle hooked up to a hydrant has unlimited water. */
export const WATER_PER_SEC = 6;
export const HYDRANT_RANGE = 4.5;
export const HYDRANT_REFILL = 90;
/** Buildings from this many floors up need an aerial ladder to fight the fire at full strength. */
export const TALL_FLOORS = 4;
export const TALL_FACTOR = 0.4;
/** A dismounted responder with the `coordinate` ability (bevelvoerder) within this range makes others 25% more effective. */
export const COMMANDER_RANGE = 10;
export const COMMANDER_BONUS = 1.25;

export const DIFFICULTY: Record<Difficulty, { maxConcurrent: number; interval: [number, number]; timeScale: number; repLoss: number }> = {
  easy: { maxConcurrent: 2, interval: [45, 75], timeScale: 1.35, repLoss: 8 },
  normal: { maxConcurrent: 3, interval: [30, 55], timeScale: 1, repLoss: 12 },
  hard: { maxConcurrent: 5, interval: [18, 35], timeScale: 0.65, repLoss: 16 },
};

/** Equipment each ability needs on the responder's vehicle (any one of the listed items). */
export const ABILITY_EQUIPMENT: Partial<Record<Ability, string[]>> = {
  extinguish: ['fire_hose'],
  rescue: ['breathing_apparatus', 'rescue_tools'],
  treat: ['medical_kit'],
  carry: ['stretcher'],
  arrest: ['handcuffs'],
  secure: ['barrier_tape'],
  clear: ['tow_gear', 'rescue_tools'],
  defuse: ['bomb_robot'],
};

export interface WorldOptions {
  seed: number;
  difficulty: Difficulty;
  freeplay: boolean;
  mapId?: string;
  traffic?: boolean;
  /** Play a predefined mission (see missions.json); the freeplay generator is off. */
  missionId?: string;
  /** 'Nieuw spel': start with a scripted sequence (fire, accident, crime) before the generator takes over. */
  scripted?: boolean;
}

export type Entity = Vehicle | Responder | Victim | Suspect;
interface Blocker {
  /** True when the thing in the way is standing still. */
  halted: boolean;
  id?: number;
  kind: 'veh' | 'civ' | 'person';
  x: number;
  y: number;
  civ?: Civilian;
  /** Set when the thing in the way is a crew member standing around. */
  responder?: Responder;
}

export type OrderTarget =
  | { kind: 'building'; id: string }
  | { kind: 'victim'; id: number }
  | { kind: 'suspect'; id: number }
  | { kind: 'incident'; id: number };

const TILE_GRASS = 0, TILE_ROAD = 1, TILE_BUILDING = 2, TILE_TREE = 3, TILE_PARKING = 4, TILE_WATER = 5;
/** Harder incidents take longer to resolve: 1 at severity 1, growing by `k` per severity level. */
export const sevFactor = (severity: number, k = 0.3) => 1 + k * (severity - 1);
const LANES: (Vec | null)[] = [null, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const PRIO_EMERGENCY = 2, PRIO_CIVILIAN = 1;
const key = (x: number, y: number) => y * 4096 + x;

interface Obb { x: number; y: number; ux: number; uy: number; hl: number; hw: number }
/** Separating-axis test for two oriented rectangles. */
function obbOverlap(a: Obb, b: Obb): boolean {
  const axes: [number, number][] = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [ax, ay] of axes) {
    const ra = a.hl * Math.abs(a.ux * ax + a.uy * ay) + a.hw * Math.abs(-a.uy * ax + a.ux * ay);
    const rb = b.hl * Math.abs(b.ux * ax + b.uy * ay) + b.hw * Math.abs(-b.uy * ax + b.ux * ay);
    if (Math.abs(dx * ax + dy * ay) > ra + rb) return false;
  }
  return true;
}
const halfWidth = (length: number) => (length < 1.2 ? 0.22 : 0.36);
const CAR_LEN = 1.4, CAR_HW = 0.36;
const rectDist = (b: Building, x: number, y: number) =>
  Math.hypot(Math.max(b.x - x, 0, x - (b.x + b.w)), Math.max(b.y - y, 0, y - (b.y + b.h)));
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export interface SaveGame {
  version: 2;
  opts: WorldOptions;
  time: number; score: number; budget: number; reputation: number; solved: number; failed: number; deaths: number;
  over: boolean; nextId: number; rng: number; spawnTimer: number;
  buildings: { id: string; fire: number; damage: number; destroyed: boolean; incidentId: number | null; growth: number; spread: number; resistance?: number }[];
  vehicles: Vehicle[]; responders: Responder[]; victims: Victim[]; suspects: Suspect[]; bystanders?: Bystander[]; incidents: Incident[];
  obstacles: number[];
  won?: boolean;
  script?: { at: number; def: string; severity?: number }[];
}

export class World {
  readonly content: Content;
  readonly opts: WorldOptions;
  readonly map: MapDef;
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly intersection: Uint8Array;
  /** One-way lane per road tile (right-hand traffic): 0 none/intersection, 1 east, 2 west, 3 south, 4 north. */
  readonly lane: Uint8Array;
  private readonly bayTile: Uint8Array;
  private vehBlockCache: Set<number> | null = null;
  readonly buildings = new Map<string, Building>();
  private readonly buildingAt: (Building | null)[];
  vehicles = new Map<number, Vehicle>();
  responders = new Map<number, Responder>();
  victims = new Map<number, Victim>();
  suspects = new Map<number, Suspect>();
  bystanders = new Map<number, Bystander>();
  incidents = new Map<number, Incident>();
  civilians: Civilian[] = [];
  pedestrians: Pedestrian[] = [];
  obstacles = new Set<number>();
  roadVersion = 0;
  rng: Rng;
  time = 0;
  score = 0;
  budget = 1000;
  reputation = 100;
  solved = 0;
  failed = 0;
  deaths = 0;
  over = false;
  nextId = 1;
  spawnTimer = 6;
  private script: { at: number; def: string; severity?: number }[] = [];
  mission: MissionDef | null = null;
  won = false;
  events: GameEvent[] = [];
  private roadList: Vec[] = [];

  private constructor(content: Content, opts: WorldOptions) {
    this.content = content;
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    const map = content.maps[opts.mapId ?? 'default_city'] ?? Object.values(content.maps)[0];
    if (!map) throw new Error('Geen kaart beschikbaar');
    this.map = map;
    this.mission = opts.missionId ? content.missions[opts.missionId] ?? null : null;
    this.w = map.width;
    this.h = map.height;
    this.tiles = new Uint8Array(this.w * this.h);
    this.intersection = new Uint8Array(this.w * this.h);
    this.lane = new Uint8Array(this.w * this.h);
    this.bayTile = new Uint8Array(this.w * this.h);
    for (const st of map.stations) for (const b of st.bays ?? []) this.bayTile[b.y * this.w + b.x] = 1;
    this.buildingAt = new Array(this.w * this.h).fill(null);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = map.rows[y][x];
        this.tiles[y * this.w + x] = c === 'R' ? TILE_ROAD : c === 'B' ? TILE_BUILDING : c === 'T' ? TILE_TREE : c === 'P' ? TILE_PARKING : c === 'W' ? TILE_WATER : TILE_GRASS;
        if (c === 'R') this.roadList.push({ x, y });
      }
    }
    for (const bd of map.buildings) {
      const flam = { residential: 1, apartment: 0.9, commercial: 0.8, industrial: 1.2, office: 0.8, warehouse: 1.3, school: 0.8, shopping: 0.9, church: 0.7, station: 0.4, hospital: 0.4 }[bd.type];
      const b: Building = { ...bd, door: { x: bd.x, y: bd.y }, fire: 0, damage: 0, destroyed: false, flammability: flam, incidentId: null, growth: 0, spread: 0, resistance: 1 };
      this.buildings.set(b.id, b);
      for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) this.buildingAt[j * this.w + i] = b;
    }
    for (const b of this.buildings.values()) b.door = this.findDoor(b);
    for (const r of this.roadList) {
      const hz = this.isRoad(r.x - 1, r.y) && this.isRoad(r.x + 1, r.y);
      const vt = this.isRoad(r.x, r.y - 1) && this.isRoad(r.x, r.y + 1);
      if (hz && vt) this.intersection[r.y * this.w + r.x] = 1;
      else if (hz) {
        const below = this.isRoad(r.x, r.y + 1), above = this.isRoad(r.x, r.y - 1);
        if (below && !above) this.lane[r.y * this.w + r.x] = 2; // north row: westbound
        else if (above && !below) this.lane[r.y * this.w + r.x] = 1; // south row: eastbound
      } else if (vt) {
        const right = this.isRoad(r.x + 1, r.y), left = this.isRoad(r.x - 1, r.y);
        if (right && !left) this.lane[r.y * this.w + r.x] = 3; // west column: southbound
        else if (left && !right) this.lane[r.y * this.w + r.x] = 4; // east column: northbound
      }
    }
  }

  static create(content: Content, opts: WorldOptions): World {
    const w = new World(content, opts);
    w.spawnFleets();
    if (w.mission) w.script = w.mission.script.map(e => ({ ...e }));
    else if (opts.scripted) w.script = [{ at: 3, def: 'house_fire' }, { at: 30, def: 'car_accident' }, { at: 55, def: 'crime' }];
    if (opts.traffic !== false) w.spawnTraffic();
    return w;
  }

  // ---------- terrain queries ----------
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  isRoad(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y * this.w + x] === TILE_ROAD;
  }
  isBuilding(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y * this.w + x] === TILE_BUILDING;
  }
  isTree(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y * this.w + x] === TILE_TREE;
  }
  isIntersection(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.intersection[y * this.w + x] === 1;
  }
  isParking(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y * this.w + x] === TILE_PARKING;
  }
  /** Tiles emergency vehicles may use: roads and station parking lots. */
  isDrivable = (x: number, y: number): boolean => (this.isRoad(x, y) || this.isParking(x, y)) && !this.obstacles.has(key(x, y));
  /** Tiles civilians may use: public roads only. */
  isCivDrivable = (x: number, y: number): boolean => this.isRoad(x, y) && !this.obstacles.has(key(x, y));
  laneAt(x: number, y: number): Vec | null {
    return this.inBounds(x, y) ? LANES[this.lane[y * this.w + x]] : null;
  }
  /**
   * Like `laneEdgeOk`, but also allows turning around in place: stepping sideways from a lane into the opposite lane of the
   * same road (a U-turn). Used when the lane-compliant route is much longer or does not exist (blocked road, dead end).
   */
  laneUturnOk = (ax: number, ay: number, bx: number, by: number): boolean => {
    if (this.laneEdgeOk(ax, ay, bx, by)) return true;
    const la = this.laneAt(ax, ay), lb = this.laneAt(bx, by);
    if (!la || !lb) return false;
    const dx = bx - ax, dy = by - ay;
    return dx * la.x + dy * la.y === 0 && lb.x === -la.x && lb.y === -la.y;
  };
  /** One-way lane rule: roads are two lanes wide; you may only drive with the lane, except when entering/leaving a parking lot. */
  /** Parking lots are single-file columns: vehicles drive straight in and out of their bay, never sideways. */
  bayEdgeOk = (ax: number, ay: number, bx: number, by: number): boolean => {
    if (ax === bx) return true;
    return !(this.isParking(ax, ay) || this.isParking(bx, by));
  };
  laneEdgeOk = (ax: number, ay: number, bx: number, by: number): boolean => {
    if (!this.bayEdgeOk(ax, ay, bx, by)) return false;
    const dx = bx - ax, dy = by - ay;
    const la = this.laneAt(ax, ay), lb = this.laneAt(bx, by);
    if (la && (la.x !== dx || la.y !== dy) && !this.isParking(bx, by)) return false;
    if (lb && (lb.x !== dx || lb.y !== dy) && !this.isParking(ax, ay)) return false;
    return true;
  };
  isWater(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y * this.w + x] === TILE_WATER;
  }
  isWalkable = (x: number, y: number): boolean => this.inBounds(x, y) && this.tiles[y * this.w + x] !== TILE_BUILDING && this.tiles[y * this.w + x] !== TILE_WATER;
  buildingOn(x: number, y: number): Building | null {
    return this.inBounds(x, y) ? this.buildingAt[y * this.w + x] : null;
  }
  private findDoor(b: Building): Vec {
    const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
    const cands: Vec[] = [{ x: cx, y: b.y + b.h }, { x: cx, y: b.y - 1 }, { x: b.x + b.w, y: cy }, { x: b.x - 1, y: cy }];
    return cands.find(c => this.isParking(c.x, c.y)) ?? cands.find(c => this.isRoad(c.x, c.y)) ?? cands.find(c => this.isWalkable(c.x, c.y)) ?? cands[0];
  }
  nearestRoad(x: number, y: number, maxR = 14, drivable = true): Vec | null {
    let best: Vec | null = null, bd = Infinity;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    for (let j = y0 - maxR; j <= y0 + maxR; j++) {
      for (let i = x0 - maxR; i <= x0 + maxR; i++) {
        if (!(drivable ? this.isDrivable(i, j) : this.isRoad(i, j))) continue;
        const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
        if (d < bd) { bd = d; best = { x: i, y: j }; }
      }
    }
    return best;
  }

  emit(e: GameEvent): void {
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
  }
  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- creation helpers ----------
  private newId(): number {
    return this.nextId++;
  }
  private addEntityBase(x: number, y: number) {
    return { id: this.newId(), x, y, px: x, py: y };
  }

  private spawnFleets(): void {
    const placed: Vec[] = [];
    for (const st of this.map.stations) {
      st.fleet.forEach((defId, i) => {
        const def = this.content.vehicles[defId];
        if (!def) return;
        const bay = st.bays?.[i];
        if (bay) {
          const v = this.createVehicle(def, st.id, bay.x + 0.5, bay.y + 0.5);
          v.angle = -Math.PI / 2; // parked nose-out, facing the exit
          return;
        }
        const spot = this.findSpot(st.buildingId, placed);
        if (!spot) return;
        placed.push(spot);
        this.createVehicle(def, st.id, spot.x + 0.5, spot.y + 0.5);
      });
    }
  }

  /** Fallback for maps without parking bays: a free road tile near the station door. */
  private findSpot(buildingId: string, taken: Vec[]): Vec | null {
    const b = this.buildings.get(buildingId)!;
    const spots = this.roadList
      .filter(r => !this.isIntersection(r.x, r.y) && this.isDrivable(r.x, r.y))
      .map(r => ({ r, d: Math.hypot(r.x - b.door.x, r.y - b.door.y) }))
      .sort((a, c) => a.d - c.d);
    return spots.find(s => !taken.some(p => Math.hypot(p.x - s.r.x, p.y - s.r.y) < 2.3))?.r ?? null;
  }

  static readonly MAX_VEHICLES_PER_CATEGORY = 14;

  reinforcementCost(defId: string): number {
    return this.content.vehicles[defId]?.cost ?? 500;
  }

  /** Buy an extra vehicle for the matching station with budget. Returns the new vehicle or null (a warning is emitted). */
  callReinforcement(defId: string): Vehicle | null {
    const def = this.content.vehicles[defId];
    if (!def || this.over) return null;
    const stations = this.map.stations.filter(s => s.category === def.category);
    if (!stations.length) { this.emit({ type: 'warn', message: `Geen post beschikbaar voor ${def.name}` }); return null; }
    const cost = this.reinforcementCost(defId);
    if (this.budget < cost) { this.emit({ type: 'warn', message: `Onvoldoende middelen voor ${def.name} (€${cost})` }); return null; }
    if (this.vehiclesOf(def.category).length >= World.MAX_VEHICLES_PER_CATEGORY) { this.emit({ type: 'warn', message: 'Maximaal aantal voertuigen bereikt voor deze dienst' }); return null; }
    // the first station of that service with a free parking bay
    let st = stations[0], bay: { x: number; y: number } | undefined;
    for (const cand of stations) {
      const homes = new Set([...this.vehicles.values()].filter(v => v.stationId === cand.id).map(v => key(v.home.x, v.home.y)));
      const free = cand.bays?.find(bb => !homes.has(key(bb.x, bb.y)) && ![...this.vehicles.values()].some(v => Math.hypot(v.x - (bb.x + 0.5), v.y - (bb.y + 0.5)) < 1.2));
      if (free) { st = cand; bay = free; break; }
    }
    let pos: Vec | null = bay ? { x: bay.x, y: bay.y } : null;
    if (!pos) pos = this.findSpot(st.buildingId, [...this.vehicles.values()].map(v => ({ x: Math.floor(v.x), y: Math.floor(v.y) })));
    if (!pos) { this.emit({ type: 'warn', message: 'Geen vrije parkeerplaats bij de post' }); return null; }
    this.budget -= cost;
    const v = this.createVehicle(def, st.id, pos.x + 0.5, pos.y + 0.5);
    if (bay) v.angle = -Math.PI / 2;
    this.emit({ type: 'info', message: `Versterking: ${v.name} staat klaar bij de post (€${cost})` });
    return v;
  }

  createVehicle(def: VehicleDef, stationId: string, x: number, y: number): Vehicle {
    const v: Vehicle = {
      kind: 'vehicle', ...this.addEntityBase(x, y), defId: def.id, category: def.category, stationId, path: [], dest: null, home: { x: Math.floor(x), y: Math.floor(y) }, returning: false, toHospital: false, contraflow: false, blocked: 0, avoid: [], ghost: 0,
      pathVersion: this.roadVersion, water: def.tank ?? 0, hydrant: false, crew: [], patients: [], lights: false, angle: 0, state: 'idle',
      name: `${def.name} ${[...this.vehicles.values()].filter(o => o.defId === def.id).length + 1}`,
    };
    this.vehicles.set(v.id, v);
    for (const slot of def.crew) {
      const role = this.content.roles[slot.role];
      for (let i = 0; i < slot.count; i++) {
        const r: Responder = {
          kind: 'responder', ...this.addEntityBase(x, y), role: role.id, category: role.category, vehicleId: v.id, inVehicle: true,
          path: [], task: null, angle: 0, name: `${role.name} ${v.crew.length + 1}`, carrying: null,
        };
        this.responders.set(r.id, r);
        v.crew.push(r.id);
      }
    }
    return v;
  }

  vehicleDef(v: Vehicle): VehicleDef {
    return this.content.vehicles[v.defId];
  }
  roleDef(r: Responder): RoleDef {
    return this.content.roles[r.role];
  }

  // ---------- main tick ----------
  tick(dt: number = SIM_DT): void {
    if (this.over) return;
    this.time += dt;
    this.vehBlockCache = null;
    for (const e of this.allMovers()) { e.px = e.x; e.py = e.y; }
    while (this.script.length && this.time >= this.script[0].at) {
      const s = this.script.shift()!;
      if (this.content.incidents[s.def]) this.spawnIncident(s.def, { severity: s.severity ?? 1 });
    }
    if (this.opts.freeplay && !this.script.length) this.updateSpawner(dt);
    for (const v of this.vehicles.values()) this.updateVehicle(v, dt);
    for (const r of this.responders.values()) this.updateResponder(r, dt);
    this.updateWater(dt);
    this.updateHospital();
    this.updateFire(dt);
    for (const v of this.victims.values()) this.updateVictim(v, dt);
    for (const inc of [...this.incidents.values()]) this.updateIncident(inc, dt);
    if (this.mission && !this.script.length && this.incidents.size === 0 && !this.over) {
      this.won = true;
      this.over = true;
      this.emit({ type: 'mission_complete', message: `Missie "${this.mission.name}" geslaagd!` });
    }
    for (const c of this.civilians) this.updateCivilian(c, dt);
    for (const p of this.pedestrians) this.updatePedestrian(p, dt);
    for (const b of this.bystanders.values()) this.updateBystander(b, dt);
  }

  private updateBystander(b: Bystander, dt: number): void {
    if (!b.leaving) return;
    this.stepAlong(b, b.path, 1.9, dt);
    if (!b.path.length) this.bystanders.delete(b.id);
  }

  private *allMovers(): Iterable<{ x: number; y: number; px: number; py: number }> {
    yield* this.vehicles.values(); yield* this.responders.values(); yield* this.victims.values();
    yield* this.civilians; yield* this.pedestrians; yield* this.bystanders.values();
  }

  /** 0 = east-west traffic has green, 1 = north-south. */
  get lightPhase(): 0 | 1 {
    return (Math.floor(this.time / 9) % 2) as 0 | 1;
  }

  // ---------- movement helpers ----------
  private stepAlong(e: { x: number; y: number; angle: number }, path: Vec[], speed: number, dt: number): void {
    let budget = speed * dt;
    while (budget > 1e-6 && path.length) {
      const tx = path[0].x + 0.5, ty = path[0].y + 0.5;
      const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
      if (d > 1e-4) e.angle = Math.atan2(dy, dx);
      if (d <= budget) { e.x = tx; e.y = ty; budget -= d; path.shift(); }
      else { e.x += (dx / d) * budget; e.y += (dy / d) * budget; budget = 0; }
    }
  }

  /** Tiles currently occupied by parked (path-less) vehicles; they are obstacles for routing. */
  private idleTiles(except: Vehicle): Set<number> {
    const set = new Set<number>();
    for (const o of this.vehicles.values()) if (o !== except && !o.path.length) set.add(key(Math.floor(o.x), Math.floor(o.y)));
    return set;
  }

  routeVehicle(v: Vehicle, dest: Vec, avoid: number[] = v.avoid): boolean {
    const idle = this.idleTiles(v);
    const skip = new Set(avoid);
    const passable = (x: number, y: number) => this.isDrivable(x, y) && !idle.has(key(x, y)) && !skip.has(key(x, y));
    const start = { x: Math.floor(v.x), y: Math.floor(v.y) };
    const plain = findPath(this.w, this.h, start, dest, passable, { edge: v.contraflow ? this.bayEdgeOk : this.laneEdgeOk });
    // emergency vehicles may turn around on the spot when that saves a long detour (or when there is no other way)
    const turning = v.contraflow ? null : findPath(this.w, this.h, start, dest, passable, { edge: this.laneUturnOk });
    const path = !plain ? turning : turning && plain.length > turning.length + 4 ? turning : plain;
    if (!path) return false;
    v.path = path;
    v.dest = { x: dest.x, y: dest.y };
    v.pathVersion = this.roadVersion;
    return true;
  }

  /** Nearest drivable tiles to a point that are not blocked by an obstacle or a parked vehicle, best first. */
  candidateTiles(x: number, y: number, self: Vehicle | null, count = 8, maxR = 14): Vec[] {
    const idle = self ? this.idleTiles(self) : new Set<number>();
    const out: { t: Vec; d: number }[] = [];
    const x0 = Math.floor(x), y0 = Math.floor(y);
    for (let j = y0 - maxR; j <= y0 + maxR; j++) {
      for (let i = x0 - maxR; i <= x0 + maxR; i++) {
        if (!this.isDrivable(i, j) || idle.has(key(i, j))) continue;
        out.push({ t: { x: i, y: j }, d: Math.hypot(i + 0.5 - x, j + 0.5 - y) });
      }
    }
    return out.sort((a, b) => a.d - b.d).slice(0, count).map(o => o.t);
  }

  /** Drive to the best reachable tile near a point. */
  private driveNear(v: Vehicle, x: number, y: number): boolean {
    v.contraflow = false;
    v.avoid = [];
    for (const c of this.candidateTiles(x, y, v)) if (this.routeVehicle(v, c)) return true;
    return false;
  }

  private nearestHospital(x: number, y: number): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.buildings.values()) if (b.type === 'hospital' && !b.destroyed) { const d = rectDist(b, x, y); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  private updateVehicle(v: Vehicle, dt: number): void {
    if (v.ghost > 0) v.ghost -= dt;
    if (v.dest && v.pathVersion !== this.roadVersion) {
      // roads changed (blockade): recompute the route
      if (!this.routeVehicle(v, v.dest)) { v.path = []; v.dest = null; this.emit({ type: 'warn', message: `${v.name}: geen route meer naar de bestemming` }); }
    }
    if (v.toHospital && !v.path.length && this.groundVehicle(v)) {
      v.toHospital = false;
      const h = this.nearestHospital(v.x, v.y);
      if (!h || !this.driveNear(v, h.door.x + 0.5, h.door.y + 0.5)) this.emit({ type: 'warn', message: `${v.name}: geen route naar het ziekenhuis` });
    }
    if (v.returning && !v.path.length && this.groundVehicle(v)) {
      v.returning = false;
      if (Math.hypot(v.x - (v.home.x + 0.5), v.y - (v.home.y + 0.5)) > 0.6) {
        v.contraflow = false;
        v.avoid = [];
        if (!this.routeVehicle(v, v.home)) this.emit({ type: 'warn', message: `${v.name}: geen route naar de kazerne` });
      }
    }
    if (!v.path.length) {
      if (v.state === 'moving') {
        v.state = 'idle'; v.lights = false; v.dest = null; v.contraflow = false; v.avoid = []; v.blocked = 0;
        if (Math.hypot(v.x - (v.home.x + 0.5), v.y - (v.home.y + 0.5)) < 0.1 && this.isParking(v.home.x, v.home.y)) v.angle = -Math.PI / 2; // parked nose-out
      }
    } else {
      v.state = 'moving';
      v.lights = true;
      this.driveVehicle(v, dt);
    }
    for (const rid of v.crew) {
      const r = this.responders.get(rid);
      if (r?.inVehicle) { r.x = v.x; r.y = v.y; r.px = v.px; r.py = v.py; }
    }
    for (const pid of v.patients) {
      const p = this.victims.get(pid);
      if (p) { p.x = v.x; p.y = v.y; }
    }
  }

  private driveVehicle(v: Vehicle, dt: number): void {
    const def = this.vehicleDef(v);
    let budget = def.maxSpeed * KMH_TO_TILES * dt;
    while (budget > 1e-6 && v.path.length) {
      const tx = v.path[0].x + 0.5, ty = v.path[0].y + 0.5;
      const dx = tx - v.x, dy = ty - v.y, d = Math.hypot(dx, dy);
      if (d < 1e-4) { v.path.shift(); continue; }
      const ux = dx / d, uy = dy / d, step = Math.min(budget, d);
      const blocker = v.ghost > 0 ? null : this.gate(v, def.length) ?? this.findBlocker(v, v.x, v.y, ux, uy, step, def.length, halfWidth(def.length), PRIO_EMERGENCY);
      if (blocker) { this.onBlocked(v, blocker, dt); return; }
      v.blocked = 0;
      // U-turn: sliding into the opposite lane while rotating through 180 degrees
      const la = this.laneAt(Math.floor(v.x), Math.floor(v.y)), lb = this.laneAt(v.path[0].x, v.path[0].y);
      if (la && lb && la.x === -lb.x && la.y === -lb.y && Math.abs(ux * la.x + uy * la.y) < 1e-6) {
        const sign = Math.sign(la.x * uy - la.y * ux) || 1;
        v.angle = Math.atan2(la.y, la.x) + sign * Math.PI * Math.min(1, Math.max(0, 1 - (d - step)));
      } else v.angle = Math.atan2(uy, ux);
      v.x += ux * step; v.y += uy * step;
      budget -= step;
      if (step >= d - 1e-6) { v.x = tx; v.y = ty; v.path.shift(); }
    }
  }

  /**
   * Gate at the parking-lot exit: a vehicle only pulls onto the road when there is room to turn, so neighbours
   * leaving at the same time cannot jam each other. The lower id goes first.
   */
  private gate(v: Vehicle, len: number): Blocker | null {
    if (!this.isParking(Math.floor(v.x), Math.floor(v.y))) return null;
    const road = v.path.slice(0, 3).find(t => this.isRoad(t.x, t.y)); // the road tile we are about to pull onto (looking 3 tiles ahead)
    if (!road) return null;
    const tx = road.x + 0.5, ty = road.y + 0.5;
    const lane = this.laneAt(road.x, road.y) ?? { x: 1, y: 0 };
    // merge window: anything in the same lane close enough to be in the way when we pull out
    const inWindow = (ox: number, oy: number, lo: number) => {
      const rx = ox - tx, ry = oy - ty, along = rx * lane.x + ry * lane.y, lat = Math.abs(rx * lane.y - ry * lane.x);
      const half = (len + lo) / 2;
      return lat < 0.9 && along > -(half + 1.2) && along < half + 0.3;
    };
    for (const o of this.vehicles.values()) {
      if (o === v) continue;
      const lo = this.vehicleDef(o).length;
      if (this.isRoad(Math.floor(o.x), Math.floor(o.y)) && inWindow(o.x, o.y, lo)) return { kind: 'veh', id: o.id, x: o.x, y: o.y, halted: false };
      // another vehicle about to pull onto (nearly) the same stretch of road: the lower id goes first, so nobody ends up with their nose in the lane
      if (o.path.length > 0 && o.id < v.id && this.isParking(Math.floor(o.x), Math.floor(o.y))) {
        const ro = o.path.slice(0, 3).find(t => this.isRoad(t.x, t.y));
        if (ro && inWindow(ro.x + 0.5, ro.y + 0.5, lo)) return { kind: 'veh', id: o.id, x: o.x, y: o.y, halted: false };
      }
    }
    for (const c of this.civilians) if (inWindow(c.x, c.y, CAR_LEN)) return { kind: 'civ', id: c.id, x: c.x, y: c.y, halted: false, civ: c };
    return null;
  }

  private onBlocked(v: Vehicle, b: Blocker, dt: number): void {
    const before = v.blocked;
    v.blocked += dt;
    // a civilian car standing in the way of an emergency vehicle pulls away
    if (b.kind === 'civ' && b.halted && v.blocked > 1.2) this.respawnCivilian(b.civ!);
    // a parked vehicle in the way: plan a different route around it (still obeying the lane rules)
    if (b.kind === 'veh' && b.halted && v.dest && v.blocked > 1.5 && Math.floor(v.blocked / 2) !== Math.floor(before / 2)) {
      const k = key(Math.floor(b.x), Math.floor(b.y));
      if (!v.avoid.includes(k)) v.avoid = [...v.avoid.slice(-5), k];
      const dest = v.dest;
      if (!this.routeVehicle(v, dest, v.avoid)) v.dest = dest;
    }
    if (b.kind === 'person' && v.blocked > 1) {
      if (b.responder && !b.responder.task && !b.responder.path.length) {
        // idle crew standing in the road steps onto the pavement
        b.responder.task = { type: 'move' };
        if (!this.walkTo(b.responder, (x, y) => !this.isRoad(x, y) && !this.isParking(x, y))) { b.responder.task = null; b.responder.path = []; }
      } else if (v.dest && Math.floor(v.blocked / 2) !== Math.floor(before / 2)) {
        // somebody working in the way (or a casualty): plan around them
        const k = key(Math.floor(b.x), Math.floor(b.y));
        if (!v.avoid.includes(k)) v.avoid = [...v.avoid.slice(-5), k];
        const dest = v.dest;
        if (!this.routeVehicle(v, dest, v.avoid)) v.dest = dest;
      }
    }
    if (v.blocked > 12) { // never drive through anything: give up and let the player re-order
      v.path = [];
      v.dest = null;
      v.blocked = 0;
      this.emit({ type: 'warn', message: `${v.name} komt er niet door en blijft staan` });
    }
  }

  /**
   * Something (vehicle, car, person) in front of `self` that it would run into after moving `step` along (ux, uy).
   * Uses oriented footprints: a "near" box (the vehicle itself) can never overlap anything, a "far" box (a short
   * look-ahead) keeps a following distance and, for crossing traffic, lets the lower priority wait.
   */
  private findBlocker(self: { id: number }, sx: number, sy: number, ux: number, uy: number, step: number, len: number, hw: number, prio: number): Blocker | null {
    const cx = sx + ux * step, cy = sy + uy * step, LOOK = 0.9;
    const near: Obb = { x: cx, y: cy, ux, uy, hl: len / 2 + 0.04, hw: hw + 0.04 };
    const far: Obb = { x: cx + ux * LOOK / 2, y: cy + uy * LOOK / 2, ux, uy, hl: len / 2 + LOOK / 2, hw: hw + 0.04 };
    const check = (o: { id: number; x: number; y: number; px: number; py: number; angle: number }, lo: number, ho: number, po: number, kind: Blocker['kind'], civ?: Civilian): Blocker | null => {
      const hx = Math.cos(o.angle), hy = Math.sin(o.angle);
      const ob: Obb = { x: o.x, y: o.y, ux: hx, uy: hy, hl: lo / 2, hw: ho };
      if (!obbOverlap(far, ob)) return null;
      const res: Blocker = { kind, id: o.id, x: o.x, y: o.y, civ, halted: Math.hypot(o.x - o.px, o.y - o.py) <= 1e-4 };
      if (obbOverlap(near, ob)) return res; // never drive into an overlap
      if (Math.hypot(o.x - o.px, o.y - o.py) <= 1e-4) return res; // halted: obstacle
      const dot = hx * ux + hy * uy;
      if (Math.abs(dot) > 0.3) return res; // leader or head-on
      return po > prio || (po === prio && o.id < self.id) ? res : null; // crossing: lower priority yields
    };
    for (const o of this.vehicles.values()) {
      if (o.id === self.id) continue;
      const od = this.vehicleDef(o);
      const r = check(o, od.length, halfWidth(od.length), PRIO_EMERGENCY, 'veh');
      if (r) return r;
    }
    for (const o of this.civilians) {
      if (o.id === self.id) continue;
      const r = check(o, CAR_LEN, CAR_HW, PRIO_CIVILIAN, 'civ', o);
      if (r) return r;
    }
    const lookP: Obb = { x: cx + ux * 0.12, y: cy + uy * 0.12, ux, uy, hl: len / 2 + 0.17, hw: hw + 0.04 };
    // people on the pavement are not in the way of traffic; only people on the road or in a parking lot block
    const person = (o: { x: number; y: number }, responder?: Responder): Blocker | null =>
      !this.isRoad(Math.floor(o.x), Math.floor(o.y)) && !this.isParking(Math.floor(o.x), Math.floor(o.y)) ? null : obbOverlap(lookP, { x: o.x, y: o.y, ux: 1, uy: 0, hl: 0.26, hw: 0.26 }) ? { kind: 'person', x: o.x, y: o.y, halted: true, responder } : null;
    for (const o of this.responders.values()) { if (!o.inVehicle) { const r = person(o, o); if (r) return r; } }
    for (const o of this.victims.values()) { if (o.transport === 'scene' || o.transport === 'dead') { const r = person(o); if (r) return r; } }
    for (const o of this.suspects.values()) { const r = person(o); if (r) return r; }
    for (const o of this.bystanders.values()) { const r = person(o); if (r) return r; }
    return null;
  }

  // ---- vehicle footprints (people never stand on or walk through vehicles) ----
  private vehicleBoxes(): { x: number; y: number; ux: number; uy: number; hl: number; hw: number }[] {
    return [...this.vehicles.values()].map(v => {
      const d = this.vehicleDef(v);
      return { x: v.x, y: v.y, ux: Math.cos(v.angle), uy: Math.sin(v.angle), hl: d.length / 2, hw: halfWidth(d.length) };
    });
  }
  private inBox(b: { x: number; y: number; ux: number; uy: number; hl: number; hw: number }, px: number, py: number, margin: number): boolean {
    const rx = px - b.x, ry = py - b.y;
    return Math.abs(rx * b.ux + ry * b.uy) <= b.hl + margin && Math.abs(-rx * b.uy + ry * b.ux) <= b.hw + margin;
  }
  insideAnyVehicle(px: number, py: number, margin = 0.25): boolean {
    return this.vehicleBoxes().some(b => this.inBox(b, px, py, margin));
  }
  /** Tile keys whose centre lies in (or next to) a vehicle: pedestrians route around them. */
  private vehicleBlockedTiles(): Set<number> {
    if (this.vehBlockCache) return this.vehBlockCache;
    const set = new Set<number>();
    for (const b of this.vehicleBoxes()) {
      for (let j = Math.floor(b.y - 3); j <= Math.ceil(b.y + 3); j++) for (let i = Math.floor(b.x - 3); i <= Math.ceil(b.x + 3); i++) if (this.inBox(b, i + 0.5, j + 0.5, 0.3)) set.add(key(i, j));
    }
    return (this.vehBlockCache = set);
  }

  /** Positions around a vehicle where people can step out without overlapping any vehicle. */
  private exitPositions(v: Vehicle, n: number): Vec[] {
    const d = this.vehicleDef(v), ux = Math.cos(v.angle), uy = Math.sin(v.angle), lx = -uy, ly = ux;
    const hw = halfWidth(d.length), hl = d.length / 2;
    const cand: Vec[] = [];
    for (let k = 0; k < 12; k++) {
      const side = k % 2 ? 1 : -1, along = ((k >> 1) - 2) * 0.55;
      cand.push({ x: v.x + lx * side * (hw + 0.55) + ux * along, y: v.y + ly * side * (hw + 0.55) + uy * along });
    }
    for (const e of [1, -1]) for (let k = 0; k < 3; k++) cand.push({ x: v.x + ux * e * (hl + 0.7) + lx * (k - 1) * 0.55, y: v.y + uy * e * (hl + 0.7) + ly * (k - 1) * 0.55 });
    for (let a = 0; a < 16; a++) cand.push({ x: v.x + Math.cos((a / 16) * 6.283) * 2.4, y: v.y + Math.sin((a / 16) * 6.283) * 2.4 });
    const out: Vec[] = [];
    const boxes = this.vehicleBoxes();
    for (const c of cand) {
      if (out.length >= n) break;
      if (!this.isWalkable(Math.floor(c.x), Math.floor(c.y)) || boxes.some(b => this.inBox(b, c.x, c.y, 0.25)) || out.some(o => dist(o, c) < 0.55)) continue;
      out.push(c);
    }
    while (out.length < n) out.push({ x: v.x + ux * (hl + 1.2), y: v.y + uy * (hl + 1.2) });
    return out;
  }

  private walkTo(r: Responder, goal: Vec | ((x: number, y: number) => boolean)): boolean {
    const blocked = this.vehicleBlockedTiles();
    const g = typeof goal === 'function' ? (x: number, y: number) => goal(x, y) && !blocked.has(key(x, y)) : goal;
    const path = findPath(this.w, this.h, { x: Math.floor(r.x), y: Math.floor(r.y) }, g, (x, y) => this.isWalkable(x, y) && !blocked.has(key(x, y)), { diagonal: true });
    if (!path) return false;
    r.path = path;
    return true;
  }

  /** Walk until within `range` of a target point. Returns true once in range. */
  private approach(r: Responder, tx: number, ty: number, range: number, cancel: () => void): boolean {
    if (Math.hypot(r.x - tx, r.y - ty) <= range) { r.path = []; return true; }
    if (!r.path.length) {
      const ok = this.walkTo(r, (x, y) => this.isWalkable(x, y) && Math.hypot(x + 0.5 - tx, y + 0.5 - ty) <= Math.max(range - 0.25, 0.4));
      if (!ok) { this.emit({ type: 'warn', message: `${r.name}: geen looproute naar doel` }); cancel(); return false; }
    }
    this.stepAlong(r, r.path, this.roleDef(r).speed, SIM_DT);
    return false;
  }

  private updateResponder(r: Responder, dt: number): void {
    if (r.inVehicle) return;
    const t = r.task;
    const done = () => { r.task = null; r.path = []; };
    if (!t || t.type === 'move') {
      if (r.path.length) this.stepAlong(r, r.path, this.roleDef(r).speed, dt);
      else if (t) r.task = null;
      return;
    }
    const veh = this.vehicles.get(r.vehicleId);
    const role = this.roleDef(r);
    switch (t.type) {
      case 'board': {
        const v = this.vehicles.get(t.vehicleId);
        if (!v) return done();
        if (this.approach(r, v.x, v.y, 1.9, done)) { r.inVehicle = true; r.x = v.x; r.y = v.y; done(); }
        break;
      }
      case 'extinguish': {
        const b = this.buildings.get(t.buildingId);
        if (!b || b.fire <= 0 || b.destroyed) return done();
        const inRange = rectDist(b, r.x, r.y) <= 4 && (!veh || dist(r, veh) <= HOSE_LENGTH);
        if (!inRange) {
          if (!r.path.length) {
            const ok = this.walkTo(r, (x, y) => this.isWalkable(x, y) && rectDist(b, x + 0.5, y + 0.5) <= 3.2 && (!veh || Math.hypot(x - veh.x, y - veh.y) <= HOSE_LENGTH - 1));
            if (!ok) { this.emit({ type: 'warn', message: `${r.name}: geen positie binnen slanglengte` }); return done(); }
          }
          this.stepAlong(r, r.path, role.speed, dt);
          t.deploy = 0;
          return;
        }
        r.path = [];
        if (veh && dist(r, veh) > HOSE_LENGTH) { this.emit({ type: 'warn', message: `${r.name}: slang te kort, voertuig staat te ver weg` }); return done(); }
        t.deploy += dt;
        if (t.deploy >= DEPLOY_TIME) {
          const bonus = (veh && this.vehicleDef(veh).firePowerBonus) || 1;
          const tanked = !!(veh && this.vehicleDef(veh).tank);
          if (veh && tanked && !veh.hydrant && veh.water <= 0) {
            this.emit({ type: 'warn', message: `${veh.name}: tank leeg! Rijd naar een brandkraan` });
            return done();
          }
          let eff = 1;
          if ((b.floors ?? 1) >= TALL_FLOORS && !this.aerialActive(b.id)) {
            eff = TALL_FACTOR;
            if (!this.tallWarned.has(b.id)) { this.tallWarned.add(b.id); this.emit({ type: 'warn', message: `${b.name ?? 'Hoogbouw'}: de brand zit te hoog, zet de hoogwerker in` }); }
          }
          if (veh && tanked && !veh.hydrant) veh.water = Math.max(0, veh.water - WATER_PER_SEC * dt);
          b.fire = Math.max(0, b.fire - (role.power * bonus * eff * (this.commanderNear(r) ? COMMANDER_BONUS : 1) * FIRE_POWER_SCALE * dt) / b.resistance);
        }
        break;
      }
      case 'rescue': {
        const v = this.victims.get(t.victimId);
        const b = v?.buildingId ? this.buildings.get(v.buildingId) : null;
        if (!v || !b || v.transport !== 'trapped') return done();
        if (this.approach(r, b.door.x + 0.5, b.door.y + 0.5, 2.0, done)) {
          t.progress += dt;
          if (t.progress >= 5) {
            v.transport = 'scene'; v.x = b.door.x + 0.5; v.y = b.door.y + 0.5; v.px = v.x; v.py = v.y; v.buildingId = null;
            this.emit({ type: 'info', message: `${r.name} heeft een slachtoffer uit het pand gered` });
            done();
          }
        }
        break;
      }
      case 'treat': {
        const v = this.victims.get(t.victimId);
        if (!v || v.transport !== 'scene') return done();
        if (this.approach(r, v.x, v.y, 1.3, done)) {
          t.progress += dt * (role.power >= 2 ? 2 : 1);
          if (t.progress >= v.treatTime) {
            v.treated = true; v.conscious = true; v.health = Math.min(100, v.health + 10);
            this.emit({ type: 'info', message: `${r.name} heeft een slachtoffer gestabiliseerd` });
            done();
          }
        }
        break;
      }
      case 'load': {
        const v = this.victims.get(t.victimId);
        if (!v || (v.transport !== 'scene' && v.transport !== 'carried') || (v.transport === 'carried' && v.carriedBy !== r.id)) {
          if (r.carrying === t.victimId) r.carrying = null;
          return done();
        }
        if (r.carrying === null) {
          if (this.approach(r, v.x, v.y, 1.3, done)) { v.transport = 'carried'; v.carriedBy = r.id; r.carrying = v.id; r.path = []; }
        } else if (veh) {
          v.x = r.x; v.y = r.y;
          if (this.approach(r, veh.x, veh.y, 2.1, () => { v.transport = 'scene'; v.carriedBy = null; r.carrying = null; done(); })) {
            if (veh.patients.length < this.vehicleDef(veh).patientCapacity) {
              v.transport = 'inAmbulance'; v.carriedBy = null; veh.patients.push(v.id); r.carrying = null;
              this.emit({ type: 'info', message: `Slachtoffer geladen in ${veh.name}` });
            } else {
              this.emit({ type: 'warn', message: `${veh.name} zit vol` });
              v.transport = 'scene'; v.carriedBy = null; r.carrying = null;
            }
            done();
          }
        }
        break;
      }
      case 'arrest': {
        const s = this.suspects.get(t.suspectId);
        if (!s || s.arrested) return done();
        if (this.approach(r, s.x, s.y, 1.2, done)) {
          t.progress += dt;
          if (t.progress >= s.arrestTime) { s.arrested = true; this.emit({ type: 'info', message: `${r.name} heeft een verdachte gearresteerd` }); done(); }
        }
        break;
      }
      case 'secure': {
        const inc = this.incidents.get(t.incidentId);
        if (!inc || inc.secured) return done();
        if (this.approach(r, inc.x, inc.y, 3, done)) {
          t.progress += dt;
          if (t.progress >= 5 * sevFactor(inc.severity, 0.25)) { inc.secured = true; this.emit({ type: 'info', message: `Locatie afgezet: ${inc.name}` }); done(); }
        }
        break;
      }
      case 'defuse': {
        const inc = this.incidents.get(t.incidentId);
        if (!inc || inc.defused) return done();
        if (this.approach(r, inc.x, inc.y, 4.5, done)) {
          t.progress += dt;
          const need = (this.content.incidents[inc.defId].defuseTime ?? 15) * sevFactor(inc.severity, 0.4);
          if (t.progress >= need) { inc.defused = true; this.emit({ type: 'info', message: `${r.name} heeft het verdachte object onschadelijk gemaakt` }); done(); }
        }
        break;
      }
      case 'disperse': {
        const inc = this.incidents.get(t.incidentId);
        if (!inc || !inc.bystanders.some(id => this.bystanders.get(id)?.leaving === false)) return done();
        if (this.approach(r, inc.x, inc.y, 3, done)) {
          t.progress += dt;
          if (t.progress >= 3 * sevFactor(inc.severity, 0.2) * (1 + inc.bystanders.length / 8)) { this.disperse(inc); this.emit({ type: 'info', message: `${r.name} heeft omstanders weggestuurd` }); done(); }
        }
        break;
      }
      case 'clear': {
        const inc = this.incidents.get(t.incidentId);
        if (!inc || inc.cleared || !inc.obstacle.length) return done();
        const o = inc.obstacle[0];
        if (this.approach(r, o.x + 0.5, o.y + 0.5, 2.5, done)) {
          t.progress += (dt * ((veh && this.vehicleDef(veh).clearPowerBonus) || 1)) / (8 * sevFactor(inc.severity) * (this.content.incidents[inc.defId].obstacle?.mass ?? 1));
          if (t.progress >= 1) {
            this.clearObstacle(inc);
            this.emit({ type: 'info', message: `Obstakel geruimd door ${r.name}` });
            done();
          }
        }
        break;
      }
    }
  }

  commanderNear(r: Responder): boolean {
    for (const o of this.responders.values()) {
      if (o !== r && !o.inVehicle && this.roleDef(o).abilities.includes('coordinate') && dist(o, r) <= COMMANDER_RANGE) return true;
    }
    return false;
  }

  private disperse(inc: Incident): void {
    for (const id of inc.bystanders) {
      const b = this.bystanders.get(id);
      if (!b || b.leaving) continue;
      for (let i = 0; i < 20; i++) {
        const tx = Math.floor(b.x + this.rng.range(-14, 14)), ty = Math.floor(b.y + this.rng.range(-14, 14));
        if (!this.isWalkable(tx, ty) || Math.hypot(tx + 0.5 - inc.x, ty + 0.5 - inc.y) < 9) continue;
        const p = findPath(this.w, this.h, { x: Math.floor(b.x), y: Math.floor(b.y) }, { x: tx, y: ty }, this.isWalkable, { diagonal: true, maxNodes: 2000 });
        if (p) { b.path = p; break; }
      }
      b.leaving = true; // without a path they simply vanish on the next tick
    }
  }

  private clearObstacle(inc: Incident): void {
    for (const o of inc.obstacle) this.obstacles.delete(key(o.x, o.y));
    inc.obstacle = [];
    inc.cleared = true;
    this.roadVersion++;
  }

  private updateHospital(): void {
    const hospitals = [...this.buildings.values()].filter(b => b.type === 'hospital');
    for (const v of this.vehicles.values()) {
      if (!v.patients.length || v.path.length) continue;
      if (!hospitals.some(h => rectDist(h, v.x, v.y) <= 3.5)) continue;
      for (const pid of v.patients) {
        const p = this.victims.get(pid);
        if (p) { p.transport = 'atHospital'; this.emit({ type: 'info', message: `Slachtoffer afgeleverd bij het ziekenhuis (${Math.round(p.health)}% gezondheid)` }); }
      }
      v.patients = [];
    }
  }

  // ---------- fire ----------
  private updateFire(dt: number): void {
    for (const b of this.buildings.values()) {
      if (b.destroyed) { b.fire = Math.max(0, b.fire - 2 * dt); continue; }
      if (b.fire <= 0) continue;
      const inc = b.incidentId ? this.incidents.get(b.incidentId) : null;
      const sev = inc ? inc.severity : 1;
      b.fire = Math.min(100, b.fire + b.growth * (0.8 + 0.2 * sev) * dt);
      b.damage += (b.fire / 100) * 2.2 * b.flammability * dt;
      if (b.damage >= 100) { b.damage = 100; b.destroyed = true; continue; }
      if (b.fire < 35) continue;
      for (const nb of this.buildings.values()) {
        if (nb === b || nb.destroyed || nb.fire > 0) continue;
        const gap = Math.hypot(Math.max(nb.x - (b.x + b.w), b.x - (nb.x + nb.w), 0), Math.max(nb.y - (b.y + b.h), b.y - (nb.y + nb.h), 0));
        if (gap > 2.5) continue;
        if (this.rng.chance(dt * 0.012 * b.spread * (b.fire / 100) * nb.flammability)) this.igniteNeighbour(nb);
      }
    }
  }

  private tallWarned = new Set<string>();
  private _hydrants: Vec[] | null = null;

  /** Fire hydrants on the pavements next to the roads; placed deterministically from the map. */
  get hydrants(): Vec[] {
    if (this._hydrants) return this._hydrants;
    const out: Vec[] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const ch = this.map.rows[y]?.[x];
      if (ch !== '.' && ch !== 'T') continue;
      if (!(this.isRoad(x - 1, y) || this.isRoad(x + 1, y) || this.isRoad(x, y - 1) || this.isRoad(x, y + 1))) continue;
      if (tileHash(x, y) % 14 === 0) out.push({ x, y });
    }
    return (this._hydrants = out);
  }

  nearestHydrant(x: number, y: number): { h: Vec; d: number } | null {
    let best: { h: Vec; d: number } | null = null;
    for (const h of this.hydrants) { const d = Math.hypot(h.x + 0.5 - x, h.y + 0.5 - y); if (!best || d < best.d) best = { h, d }; }
    return best;
  }

  /** Is an aerial-ladder crew spraying this building? */
  aerialActive(buildingId: string): boolean {
    for (const r of this.responders.values()) {
      const t = r.task;
      if (t?.type !== 'extinguish' || t.buildingId !== buildingId || t.deploy < DEPLOY_TIME) continue;
      const v = this.vehicles.get(r.vehicleId);
      if (v && this.vehicleDef(v).equipment.includes('aerial_ladder')) return true;
    }
    return false;
  }

  /** Parked fire vehicles next to a hydrant hook up (unlimited water) and refill their tank. */
  private updateWater(dt: number): void {
    for (const v of this.vehicles.values()) {
      const def = this.vehicleDef(v);
      if (!def.tank) continue;
      const near = v.path.length === 0 && (() => { const n = this.nearestHydrant(v.x, v.y); return !!n && n.d <= HYDRANT_RANGE; })();
      if (near !== v.hydrant) {
        v.hydrant = near;
        if (near && v.water < def.tank) this.emit({ type: 'info', message: `${v.name} is aangesloten op een brandkraan` });
      }
      if (near && v.water < def.tank) v.water = Math.min(def.tank, v.water + HYDRANT_REFILL * dt);
    }
  }

  private igniteNeighbour(nb: Building): void {
    nb.fire = 8;
    const def = Object.values(this.content.incidents).find(d => d.fire && d.spawn.on === 'building' && d.spawn.buildingTypes?.includes(nb.type))
      ?? Object.values(this.content.incidents).find(d => d.fire);
    this.emit({ type: 'warn', message: `De brand slaat over naar een naastgelegen pand!` });
    if (def && !nb.incidentId) {
      nb.fire = 0;
      this.spawnIncident(def.id, { buildingId: nb.id, severity: 1, startFire: 8 });
    }
  }

  // ---------- victims ----------
  private updateVictim(v: Victim, dt: number): void {
    if (v.transport === 'dead' || v.transport === 'atHospital') return;
    if (v.transport === 'carried' && v.carriedBy !== null) {
      const c = this.responders.get(v.carriedBy);
      if (c) { v.x = c.x; v.y = c.y; }
    }
    let rate = 0;
    if (v.transport === 'trapped') {
      const b = v.buildingId ? this.buildings.get(v.buildingId) : null;
      rate = v.decay * (b && b.fire > 0 ? 1 + b.fire / 40 : 0.3);
    } else if (v.transport === 'inAmbulance') rate = 0;
    else rate = v.treated ? v.decay * 0.08 : v.decay;
    v.health -= rate * dt;
    if (v.health < 35) v.conscious = false;
    if (v.health <= 0) {
      v.health = 0; v.transport = 'dead'; this.deaths++;
      const inc = this.incidents.get(v.incidentId);
      if (inc) inc.deaths++;
      if (v.carriedBy !== null) { const c = this.responders.get(v.carriedBy); if (c) { c.carrying = null; c.task = null; } v.carriedBy = null; }
      this.score -= 80;
      this.emit({ type: 'warn', message: 'Een slachtoffer is overleden' });
    }
  }

  // ---------- incidents ----------
  private updateSpawner(dt: number): void {
    const d = DIFFICULTY[this.opts.difficulty];
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = this.rng.range(d.interval[0], d.interval[1]);
    if (this.incidents.size >= d.maxConcurrent) return;
    const defs = Object.values(this.content.incidents);
    const total = defs.reduce((s, x) => s + x.weight, 0);
    if (total <= 0) return;
    let roll = this.rng.next() * total;
    for (const def of defs) {
      roll -= def.weight;
      if (roll <= 0) { this.spawnIncident(def.id); return; }
    }
  }

  /** Create an incident. Returns null when no suitable location exists. */
  spawnIncident(defId: string, o: { buildingId?: string; severity?: number; at?: Vec; startFire?: number } = {}): Incident | null {
    const def = this.content.incidents[defId];
    if (!def) throw new Error(`Onbekende incidentdefinitie: ${defId}`);
    const sev = Math.max(1, Math.min(3, o.severity ?? this.rng.int(def.severity.min, def.severity.max)));
    const scale = DIFFICULTY[this.opts.difficulty].timeScale;
    const inc: Incident = {
      id: this.newId(), defId, name: def.name, severity: sev, description: def.descriptions?.length ? this.rng.pick(def.descriptions) : '', x: 0, y: 0, buildingId: null, elapsed: 0,
      nextEscalation: def.escalation.everySec * scale, status: 'active', secured: false, obstacle: [], victims: [], suspects: [], bystanders: [], deaths: 0, cleared: false, defused: false,
    };
    let anchor: Vec;
    let b: Building | null = null;
    if (def.spawn.on === 'building') {
      if (o.buildingId) b = this.buildings.get(o.buildingId) ?? null;
      else {
        const cands = [...this.buildings.values()].filter(x => !x.destroyed && !x.incidentId && x.fire <= 0 && def.spawn.buildingTypes?.includes(x.type));
        b = cands.length ? this.rng.pick(cands) : null;
      }
      if (!b) return null;
      b.incidentId = inc.id;
      inc.buildingId = b.id;
      anchor = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    } else {
      const tiles = o.at ? [o.at] : this.roadList.filter(r => this.isDrivable(r.x, r.y) && !this.isIntersection(r.x, r.y));
      const free = tiles.filter(r => ![...this.incidents.values()].some(i => Math.hypot(i.x - r.x, i.y - r.y) < 8));
      const t = free.length ? this.rng.pick(free) : null;
      if (!t) return null;
      const tilesNeeded = def.obstacle?.tiles ?? 1;
      inc.obstacle = [{ x: t.x, y: t.y }];
      if (tilesNeeded > 1) {
        const nx = (this.isRoad(t.x - 1, t.y) ? 1 : 0) + (this.isRoad(t.x + 1, t.y) ? 1 : 0);
        const partner = nx === 1 ? (this.isRoad(t.x - 1, t.y) ? { x: t.x - 1, y: t.y } : { x: t.x + 1, y: t.y }) : (this.isRoad(t.x, t.y - 1) ? { x: t.x, y: t.y - 1 } : { x: t.x, y: t.y + 1 });
        if (this.isRoad(partner.x, partner.y)) inc.obstacle.push(partner);
      }
      for (const ob of inc.obstacle) this.obstacles.add(key(ob.x, ob.y));
      this.roadVersion++;
      anchor = { x: t.x + 0.5, y: t.y + 0.5 };
    }
    inc.x = anchor.x; inc.y = anchor.y;
    if (b && def.fire) {
      b.fire = o.startFire ?? def.fire.start * (0.7 + 0.3 * sev);
      b.growth = def.fire.growth; b.spread = def.fire.spread;
      b.resistance = (def.fire.resistance ?? 1) * sevFactor(sev, 0.12);
    }
    if (def.victims) {
      const n = this.rng.int(def.victims.min, def.victims.max);
      for (let i = 0; i < n; i++) {
        const trapped = def.victims.location === 'trapped' && b;
        const pos = trapped ? { x: b!.x + b!.w / 2, y: b!.y + b!.h / 2 } : this.scenePosition(inc, b);
        const v: Victim = {
          kind: 'victim', ...this.addEntityBase(pos.x, pos.y), incidentId: inc.id, health: this.rng.range(def.victims.health[0], def.victims.health[1]),
          conscious: true, treated: false, transport: trapped ? 'trapped' : 'scene', decay: def.victims.decay * (1 + 0.2 * (sev - 1)),
          buildingId: trapped ? b!.id : null, carriedBy: null,
          treatTime: (def.victims.treatTime ?? 6) * sevFactor(sev), condition: def.victims.condition ?? 'Gewond',
        };
        this.victims.set(v.id, v);
        inc.victims.push(v.id);
      }
    }
    if (def.suspects) this.addSuspects(inc, this.rng.int(def.suspects.min, def.suspects.max), b, (def.suspects.arrestTime ?? 4) * sevFactor(sev, 0.4));
    if (def.bystanders) {
      const n = this.rng.int(def.bystanders.min, def.bystanders.max);
      for (let i = 0; i < n; i++) {
        const pos = this.scenePosition(inc, b, true);
        const by: Bystander = { kind: 'bystander', ...this.addEntityBase(pos.x, pos.y), incidentId: inc.id, leaving: false, path: [], angle: 0, color: this.rng.int(0, 5) };
        this.bystanders.set(by.id, by);
        inc.bystanders.push(by.id);
      }
    }
    this.incidents.set(inc.id, inc);
    this.emit({ type: 'incident_started', incidentId: inc.id, message: `Nieuwe melding: ${inc.name}` });
    return inc;
  }

  /** A free spot near the incident. `offRoad`: bystanders and suspects stand on the pavement, not in the traffic lanes. */
  private scenePosition(inc: Incident, b: Building | null, offRoad = false): Vec {
    const base = b ? { x: b.door.x + 0.5, y: b.door.y + 0.5 } : { x: inc.x, y: inc.y };
    const others = [...this.victims.values(), ...this.suspects.values(), ...this.bystanders.values()];
    for (let i = 0; i < 40; i++) {
      const r = offRoad ? 1.2 + i * 0.08 : 1.2;
      const p = { x: base.x + this.rng.range(-r, r), y: base.y + this.rng.range(-r, r) };
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      if (!this.isWalkable(tx, ty) || this.obstacles.has(key(tx, ty)) || this.insideAnyVehicle(p.x, p.y, 0.5)) continue;
      if (offRoad && (this.isRoad(tx, ty) || this.isParking(tx, ty))) continue;
      if (others.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 0.7)) continue;
      return p;
    }
    return base;
  }

  private addSuspects(inc: Incident, n: number, b: Building | null, arrestTime = 4): void {
    for (let i = 0; i < n; i++) {
      const pos = this.scenePosition(inc, b, true);
      const s: Suspect = { kind: 'suspect', ...this.addEntityBase(pos.x, pos.y), incidentId: inc.id, arrested: false, arrestTime };
      this.suspects.set(s.id, s);
      inc.suspects.push(s.id);
    }
  }

  private objectivesMet(inc: Incident, def: IncidentDef): boolean {
    return def.objectives.every(o => {
      switch (o) {
        case 'fire_out': { const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null; return !!b && b.fire <= 0 && !b.destroyed; }
        case 'victims_safe': return inc.victims.every(id => { const v = this.victims.get(id); return !v || v.transport === 'atHospital' || v.transport === 'dead'; });
        case 'suspects_arrested': return inc.suspects.every(id => this.suspects.get(id)?.arrested ?? true);
        case 'area_secured': return inc.secured;
        case 'obstacle_cleared': return inc.cleared;
        case 'bystanders_dispersed': return inc.bystanders.every(id => this.bystanders.get(id)?.leaving !== false);
        case 'device_defused': return inc.defused;
      }
    });
  }

  private updateIncident(inc: Incident, dt: number): void {
    const def = this.content.incidents[inc.defId];
    const scale = DIFFICULTY[this.opts.difficulty].timeScale;
    inc.elapsed += dt;
    const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null;
    if (inc.elapsed >= inc.nextEscalation && inc.severity < 3) {
      inc.severity++;
      inc.nextEscalation += def.escalation.everySec * scale;
      if (b && b.fire > 0) b.fire = Math.min(100, b.fire + 15);
      if (def.suspects && inc.suspects.length < 3) this.addSuspects(inc, 1, b ?? null, (def.suspects.arrestTime ?? 4) * sevFactor(inc.severity, 0.4));
      for (const id of inc.victims) { const v = this.victims.get(id); if (v && v.decay > 0) { v.decay *= 1.2; if (!v.treated) v.treatTime *= 1.15; } }
      for (const id of inc.suspects) { const x = this.suspects.get(id); if (x && !x.arrested) x.arrestTime *= 1.15; }
      if (b && b.fire > 0) b.resistance *= 1.06;
      this.emit({ type: 'incident_escalated', incidentId: inc.id, message: `${inc.name} escaleert (ernst ${inc.severity})` });
    }
    if (b?.destroyed && def.fire) return this.endIncident(inc, 'failed', 'Het pand is verloren gegaan');
    if (inc.elapsed >= def.failAfterSec * scale) return this.endIncident(inc, 'failed', 'Te laat gereageerd');
    if (this.objectivesMet(inc, def)) this.endIncident(inc, 'resolved', 'Afgerond');
  }

  private endIncident(inc: Incident, status: 'resolved' | 'failed', why: string): void {
    const def = this.content.incidents[inc.defId];
    inc.status = status;
    if (status === 'resolved') {
      const t = Math.max(0, 1 - inc.elapsed / (def.failAfterSec * DIFFICULTY[this.opts.difficulty].timeScale));
      const pts = Math.round(def.reward.score * (0.6 + 0.4 * t) * (1 + (inc.severity - 1) * 0.25));
      this.score += pts;
      this.budget += def.reward.budget;
      this.solved++;
      this.reputation = Math.min(100, this.reputation + 2);
      this.emit({ type: 'incident_resolved', incidentId: inc.id, message: `${inc.name} afgerond (+${pts} punten)` });
    } else {
      this.failed++;
      this.score -= 100;
      this.reputation -= DIFFICULTY[this.opts.difficulty].repLoss;
      this.emit({ type: 'incident_failed', incidentId: inc.id, message: `${inc.name} mislukt: ${why}` });
    }
    // clean up
    if (inc.obstacle.length) this.clearObstacle(inc);
    for (const id of inc.victims) {
      const v = this.victims.get(id);
      if (!v) continue;
      if (v.transport !== 'atHospital' && v.transport !== 'dead' && status === 'failed') { this.deaths++; this.score -= 80; }
      for (const veh of this.vehicles.values()) veh.patients = veh.patients.filter(p => p !== id);
      for (const r of this.responders.values()) { if (r.carrying === id) { r.carrying = null; r.task = null; } }
      this.victims.delete(id);
    }
    for (const id of inc.suspects) this.suspects.delete(id);
    for (const id of inc.bystanders) this.bystanders.delete(id);
    const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null;
    if (b) { b.incidentId = null; if (status === 'failed' && !b.destroyed) { b.fire = Math.max(b.fire, 0); } }
    for (const r of this.responders.values()) {
      const t = r.task;
      if (t && 'incidentId' in t && t.incidentId === inc.id) { r.task = null; r.path = []; }
    }
    this.incidents.delete(inc.id);
    if (this.mission && this.failed > this.mission.allowedFailures && !this.over) {
      this.over = true;
      this.emit({ type: 'game_over', message: `Missie "${this.mission.name}" mislukt: te veel meldingen verloren.` });
    }
    if (this.reputation <= 0 && !this.over) {
      this.reputation = 0;
      this.over = true;
      this.emit({ type: 'game_over', message: 'Je reputatie is verdwenen. De gemeente heeft het vertrouwen opgezegd.' });
    }
  }

  // ---------- player orders ----------
  private groundVehicle(v: Vehicle): boolean {
    return v.crew.every(id => this.responders.get(id)?.inVehicle !== false);
  }

  orderMove(ids: number[], x: number, y: number): void {
    for (const id of ids) {
      const v = this.vehicles.get(id);
      if (v) {
        if (!this.groundVehicle(v)) { this.emit({ type: 'warn', message: `${v.name}: bemanning staat nog buiten het voertuig` }); continue; }
        v.returning = false;
        v.toHospital = false;
        if (!this.driveNear(v, x, y)) this.emit({ type: 'warn', message: `${v.name}: geen route beschikbaar` });
        continue;
      }
      const r = this.responders.get(id);
      if (r && !r.inVehicle) {
        r.task = { type: 'move' };
        const tx = Math.floor(x), ty = Math.floor(y);
        if (!this.isWalkable(tx, ty) || !this.walkTo(r, { x: tx, y: ty })) { r.task = null; r.path = []; }
      }
    }
  }

  orderStop(ids: number[]): void {
    for (const id of ids) {
      const v = this.vehicles.get(id);
      if (v) { v.path = []; v.dest = null; v.returning = false; v.toHospital = false; }
      const r = this.responders.get(id);
      if (r && !r.inVehicle) { r.task = null; r.path = []; }
    }
  }

  orderDismount(vehicleIds: number[]): number[] {
    const out: number[] = [];
    for (const id of vehicleIds) {
      const v = this.vehicles.get(id);
      if (!v) continue;
      if (v.path.length) { this.emit({ type: 'warn', message: `${v.name} rijdt nog` }); continue; }
      v.returning = false;
      v.toHospital = false;
      const leaving = v.crew.filter(rid => this.responders.get(rid)?.inVehicle);
      const spots = this.exitPositions(v, leaving.length);
      leaving.forEach((rid, i) => {
        const r = this.responders.get(rid)!;
        r.inVehicle = false; r.task = null; r.path = [];
        r.x = spots[i].x; r.y = spots[i].y; r.px = r.x; r.py = r.y;
        out.push(rid);
      });
    }
    return out;
  }

  private vehicleOf(id: number): Vehicle | undefined {
    const v = this.vehicles.get(id);
    if (v) return v;
    const r = this.responders.get(id);
    return r ? this.vehicles.get(r.vehicleId) : undefined;
  }

  /** "Naar ziekenhuis": a vehicle with patients drives to the nearest hospital (crew boards first when needed). */
  orderToHospital(ids: number[]): number {
    const done = new Set<number>();
    for (const id of ids) {
      const v = this.vehicleOf(id);
      if (!v || done.has(v.id) || this.vehicleDef(v).patientCapacity <= 0) continue;
      done.add(v.id);
      if (!v.patients.length) { this.emit({ type: 'warn', message: `${v.name}: geen patiënt aan boord` }); done.delete(v.id); continue; }
      v.returning = false;
      v.toHospital = true;
      v.path = [];
      v.dest = null;
      if (!this.groundVehicle(v)) this.orderBoard([v.id]);
      this.emit({ type: 'info', message: `${v.name} rijdt met patiënt naar het ziekenhuis` });
    }
    return done.size;
  }

  /** "Terug naar kazerne": the crew boards (if needed) and the vehicle drives back to its parking spot. */
  orderReturn(ids: number[]): number {
    const done = new Set<number>();
    for (const id of ids) {
      const v = this.vehicleOf(id);
      if (!v || done.has(v.id)) continue;
      done.add(v.id);
      v.returning = true;
      v.toHospital = false;
      v.path = [];
      v.dest = null;
      if (!this.groundVehicle(v)) this.orderBoard([v.id]);
      this.emit({ type: 'info', message: `${v.name} keert terug naar de kazerne` });
    }
    return done.size;
  }

  /**
   * "Slangen uitrollen en blussen": crew of vehicles with a fire hose gets out and immediately starts
   * fighting the nearest fire. Returns the ids of the crew that is now outside.
   */
  orderDeployFire(ids: number[]): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const id of ids) {
      const v = this.vehicleOf(id);
      if (!v || seen.has(v.id)) continue;
      seen.add(v.id);
      if (!this.vehicleDef(v).equipment.includes('fire_hose')) continue;
      v.returning = false;
      this.orderDismount([v.id]);
      const outside = v.crew.filter(rid => this.responders.get(rid)?.inVehicle === false);
      if (!outside.length) continue;
      out.push(...outside);
      if (this.orderAbility(outside, 'extinguish') === 0) this.emit({ type: 'warn', message: `${v.name}: geen brand om te blussen` });
    }
    return out;
  }

  orderBoard(ids: number[]): void {
    for (const id of ids) {
      const v = this.vehicles.get(id);
      const list = v ? v.crew : [id];
      for (const rid of list) {
        const r = this.responders.get(rid);
        if (!r || r.inVehicle) continue;
        if (r.carrying !== null) { this.emit({ type: 'warn', message: `${r.name} draagt nog een slachtoffer` }); continue; }
        r.task = { type: 'board', vehicleId: r.vehicleId }; r.path = [];
      }
    }
  }

  private equipmentMissing(r: Responder, ability: Ability): string | null {
    const need = ABILITY_EQUIPMENT[ability];
    if (!need) return null;
    const v = this.vehicles.get(r.vehicleId);
    const have = v ? this.vehicleDef(v).equipment : [];
    return need.some(e => have.includes(e)) ? null : need.join(' / ');
  }

  canDo(r: Responder, ability: Ability): boolean {
    if (r.inVehicle || !this.roleDef(r).abilities.includes(ability) || this.equipmentMissing(r, ability) !== null) return false;
    return ability !== 'carry' || this.vehicleDef(this.vehicles.get(r.vehicleId)!).patientCapacity > 0;
  }

  /** Nearest valid target for an ability (used by the toolbar buttons). */
  findTarget(r: Responder, ability: Ability): OrderTarget | null {
    let best: OrderTarget | null = null, bd = Infinity;
    const consider = (t: OrderTarget, d: number) => { if (d < bd) { bd = d; best = t; } };
    switch (ability) {
      case 'extinguish': for (const b of this.buildings.values()) if (b.fire > 0 && !b.destroyed) consider({ kind: 'building', id: b.id }, rectDist(b, r.x, r.y)); break;
      case 'rescue': for (const v of this.victims.values()) if (v.transport === 'trapped') consider({ kind: 'victim', id: v.id }, dist(r, v)); break;
      case 'treat': for (const v of this.victims.values()) if (v.transport === 'scene' && !v.treated) consider({ kind: 'victim', id: v.id }, dist(r, v)); break;
      case 'carry': for (const v of this.victims.values()) if (v.transport === 'scene') consider({ kind: 'victim', id: v.id }, dist(r, v) - (v.treated ? 100 : 0)); break;
      case 'arrest': for (const s of this.suspects.values()) if (!s.arrested) consider({ kind: 'suspect', id: s.id }, dist(r, s)); break;
      case 'secure': for (const i of this.incidents.values()) if (this.content.incidents[i.defId].objectives.includes('area_secured') && !i.secured) consider({ kind: 'incident', id: i.id }, dist(r, i)); break;
      case 'clear': for (const i of this.incidents.values()) if (i.obstacle.length && !i.cleared) consider({ kind: 'incident', id: i.id }, dist(r, i)); break;
      case 'defuse': for (const i of this.incidents.values()) if (this.content.incidents[i.defId].objectives.includes('device_defused') && !i.defused) consider({ kind: 'incident', id: i.id }, dist(r, i)); break;
      case 'disperse': for (const i of this.incidents.values()) if (i.bystanders.some(id => this.bystanders.get(id)?.leaving === false)) consider({ kind: 'incident', id: i.id }, dist(r, i)); break;
    }
    return best;
  }

  /** Give an ability order to responders; when `target` is omitted the nearest valid target is used. */
  orderAbility(ids: number[], ability: Ability, target?: OrderTarget): number {
    let n = 0;
    for (const id of ids) {
      const r = this.responders.get(id);
      if (!r || r.inVehicle) continue;
      if (!this.roleDef(r).abilities.includes(ability)) continue;
      const missing = this.equipmentMissing(r, ability);
      if (missing) { this.emit({ type: 'warn', message: `${r.name} mist uitrusting: ${missing}` }); continue; }
      if (ability === 'carry' && this.vehicleDef(this.vehicles.get(r.vehicleId)!).patientCapacity <= 0) { this.emit({ type: 'warn', message: `${r.name}: voertuig kan geen patiënten vervoeren` }); continue; }
      const t = target ?? this.findTarget(r, ability);
      if (!t) continue;
      const task = this.makeTask(ability, t);
      if (!task) continue;
      if (r.carrying !== null && task.type !== 'load') continue;
      r.task = task; r.path = [];
      n++;
    }
    return n;
  }

  private makeTask(ability: Ability, t: OrderTarget): Task | null {
    switch (ability) {
      case 'extinguish': return t.kind === 'building' ? { type: 'extinguish', buildingId: t.id, deploy: 0 } : null;
      case 'rescue': return t.kind === 'victim' ? { type: 'rescue', victimId: t.id, progress: 0 } : null;
      case 'treat': return t.kind === 'victim' ? { type: 'treat', victimId: t.id, progress: 0 } : null;
      case 'carry': return t.kind === 'victim' ? { type: 'load', victimId: t.id } : null;
      case 'arrest': return t.kind === 'suspect' ? { type: 'arrest', suspectId: t.id, progress: 0 } : null;
      case 'secure': return t.kind === 'incident' ? { type: 'secure', incidentId: t.id, progress: 0 } : null;
      case 'clear': return t.kind === 'incident' ? { type: 'clear', incidentId: t.id, progress: 0 } : null;
      case 'disperse': return t.kind === 'incident' ? { type: 'disperse', incidentId: t.id, progress: 0 } : null;
      case 'defuse': return t.kind === 'incident' ? { type: 'defuse', incidentId: t.id, progress: 0 } : null;
      default: return null;
    }
  }

  /** What is under a world position (in tile units)? */
  pick(x: number, y: number): OrderTarget | null {
    for (const v of this.victims.values()) if (v.transport === 'trapped' ? false : (v.transport === 'scene' && Math.hypot(v.x - x, v.y - y) < 0.9)) return { kind: 'victim', id: v.id };
    for (const s of this.suspects.values()) if (!s.arrested && Math.hypot(s.x - x, s.y - y) < 0.9) return { kind: 'suspect', id: s.id };
    for (const by of this.bystanders.values()) if (!by.leaving && Math.hypot(by.x - x, by.y - y) < 0.9) return { kind: 'incident', id: by.incidentId };
    const tx = Math.floor(x), ty = Math.floor(y);
    for (const i of this.incidents.values()) if (i.obstacle.some(o => o.x === tx && o.y === ty)) return { kind: 'incident', id: i.id };
    const b = this.buildingOn(tx, ty);
    if (b) {
      const trapped = [...this.victims.values()].find(v => v.buildingId === b.id && v.transport === 'trapped');
      if (b.fire > 0 && !b.destroyed) return { kind: 'building', id: b.id };
      if (trapped) return { kind: 'victim', id: trapped.id };
      return { kind: 'building', id: b.id };
    }
    for (const i of this.incidents.values()) if (!i.buildingId && Math.hypot(i.x - x, i.y - y) < 1.6) return { kind: 'incident', id: i.id };
    return null;
  }

  /** Right-click order: decide what each selected unit does with the thing at (x, y). */
  contextOrder(ids: number[], x: number, y: number): void {
    const target = this.pick(x, y);
    const vehicleIds = ids.filter(id => this.vehicles.has(id));
    const respIds = ids.filter(id => this.responders.has(id));
    if (vehicleIds.length) {
      const tgt = this.targetPoint(target, x, y);
      this.orderMove(vehicleIds, tgt.x, tgt.y);
    }
    for (const id of respIds) {
      const r = this.responders.get(id)!;
      if (r.inVehicle) continue;
      let ability: Ability | null = null;
      if (target?.kind === 'building') ability = 'extinguish';
      else if (target?.kind === 'suspect') ability = 'arrest';
      else if (target?.kind === 'incident') {
        const inc = this.incidents.get(target.id)!;
        const abil = this.roleDef(r).abilities;
        const crowd = inc.bystanders.some(id => this.bystanders.get(id)?.leaving === false);
        const bomb = this.content.incidents[inc.defId].objectives.includes('device_defused') && !inc.defused;
        ability = bomb && abil.includes('defuse') ? 'defuse' : inc.obstacle.length && !inc.cleared && abil.includes('clear') ? 'clear' : abil.includes('secure') && !inc.secured ? 'secure' : crowd && abil.includes('disperse') ? 'disperse' : abil.includes('secure') ? 'secure' : null;
      } else if (target?.kind === 'victim') {
        const v = this.victims.get(target.id)!;
        const abil = this.roleDef(r).abilities;
        if (v.transport === 'trapped') ability = 'rescue';
        else if (v.treated && abil.includes('carry')) ability = 'carry';
        else if (abil.includes('treat')) ability = 'treat';
        else if (abil.includes('carry')) ability = 'carry';
      }
      if (ability && this.roleDef(r).abilities.includes(ability) && this.orderAbility([id], ability, target!)) continue;
      const p = this.targetPoint(target, x, y);
      this.orderMove([id], p.x, p.y);
    }
  }

  private targetPoint(t: OrderTarget | null, x: number, y: number): Vec {
    if (!t) return { x, y };
    if (t.kind === 'building') { const b = this.buildings.get(t.id)!; return { x: b.door.x + 0.5, y: b.door.y + 0.5 }; }
    if (t.kind === 'victim') { const v = this.victims.get(t.id)!; const b = v.buildingId ? this.buildings.get(v.buildingId) : null; return b ? { x: b.door.x + 0.5, y: b.door.y + 0.5 } : { x: v.x, y: v.y }; }
    if (t.kind === 'suspect') { const s = this.suspects.get(t.id)!; return { x: s.x, y: s.y }; }
    const i = this.incidents.get(t.id)!;
    return { x: i.x, y: i.y };
  }

  // ---------- civilian traffic ----------
  private spawnTraffic(): void {
    const roads = this.roadList;
    const cars = Math.max(20, Math.round(roads.length / 55));
    for (let i = 0; i < cars; i++) {
      let r = this.rng.pick(roads);
      for (let k = 0; k < 20 && this.civilians.some(o => Math.hypot(o.x - r.x - 0.5, o.y - r.y - 0.5) < 2.5); k++) r = this.rng.pick(roads);
      this.civilians.push({ kind: 'civilian', ...this.addEntityBase(r.x + 0.5, r.y + 0.5), path: [], angle: 0, color: this.rng.int(0, 5), wait: this.rng.range(0, 3), stuck: 0, speed: this.rng.range(3.2, 4.2) });
    }
    const walk: Vec[] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.tiles[y * this.w + x] === TILE_GRASS) walk.push({ x, y });
    for (let i = 0; i < Math.round(cars * 0.9) && walk.length; i++) {
      const t = this.rng.pick(walk);
      this.pedestrians.push({ kind: 'pedestrian', ...this.addEntityBase(t.x + 0.5, t.y + 0.5), path: [], angle: 0, color: this.rng.int(0, 5), speed: this.rng.range(0.9, 1.5) });
    }
  }

  /** Cars that got in the way of an emergency vehicle pull away: put them on a quiet road tile far from the action. */
  respawnCivilian(c: Civilian): void {
    for (let k = 0; k < 40; k++) {
      const r = this.rng.pick(this.roadList);
      if (this.isIntersection(r.x, r.y)) continue;
      const cx = r.x + 0.5, cy = r.y + 0.5;
      if ([...this.vehicles.values()].some(v => Math.hypot(v.x - cx, v.y - cy) < 6) || this.civilians.some(o => o !== c && Math.hypot(o.x - cx, o.y - cy) < 3)) continue;
      c.x = c.px = cx; c.y = c.py = cy; c.path = []; c.wait = 1; c.stuck = 0;
      return;
    }
  }

  private updateCivilian(c: Civilian, dt: number): void {
    if (c.wait > 0) { c.wait -= dt; return; }
    if (!c.path.length) {
      const dest = this.rng.pick(this.roadList);
      const idle = new Set<number>();
      for (const v of this.vehicles.values()) if (!v.path.length) idle.add(key(Math.floor(v.x), Math.floor(v.y)));
      const from = { x: Math.floor(c.x), y: Math.floor(c.y) };
      const ok = (x: number, y: number) => this.isCivDrivable(x, y) && !idle.has(key(x, y));
      // cars turn around when they are facing a closed road or a dead end
      const p = findPath(this.w, this.h, from, dest, ok, { edge: this.laneEdgeOk }) ?? findPath(this.w, this.h, from, dest, ok, { edge: this.laneUturnOk });
      if (!p || p.length < 8) { c.wait = 1; return; }
      c.path = p;
    }
    const next = c.path[0];
    if (!this.isCivDrivable(next.x, next.y)) { c.path = []; c.wait = 0.5; return; }
    const dx = next.x + 0.5 - c.x, dy = next.y + 0.5 - c.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    // red light? only checked when about to enter an intersection
    if (this.isIntersection(next.x, next.y) && !this.isIntersection(Math.floor(c.x), Math.floor(c.y)) && d < 0.9) {
      const horizontal = Math.abs(ux) > Math.abs(uy);
      if ((this.lightPhase === 0) !== horizontal) return;
    }
    const step = Math.min(c.speed * dt, d);
    const blocker = this.findBlocker(c, c.x, c.y, ux, uy, step, CAR_LEN, CAR_HW, PRIO_CIVILIAN);
    if (blocker) {
      c.stuck += dt;
      if (c.stuck > 3 && blocker.kind === 'veh') { c.path = []; c.wait = 0.3; } // re-plan around a parked emergency vehicle
      if (c.stuck > 8) this.respawnCivilian(c); // deadlock breaker: this car drives off somewhere else
      return;
    }
    c.stuck = Math.max(0, c.stuck - dt);
    c.angle = Math.atan2(dy, dx);
    c.x += ux * step; c.y += uy * step;
    if (d - step < 1e-3) { c.x = next.x + 0.5; c.y = next.y + 0.5; c.path.shift(); }
  }

  private updatePedestrian(p: Pedestrian, dt: number): void {
    if (!p.path.length) {
      const tx = Math.max(0, Math.min(this.w - 1, Math.floor(p.x + this.rng.range(-12, 12))));
      const ty = Math.max(0, Math.min(this.h - 1, Math.floor(p.y + this.rng.range(-12, 12))));
      if (!this.isWalkable(tx, ty)) return;
      p.path = findPath(this.w, this.h, { x: Math.floor(p.x), y: Math.floor(p.y) }, { x: tx, y: ty }, this.isWalkable, { diagonal: true, maxNodes: 600 }) ?? [];
      return;
    }
    this.stepAlong(p, p.path, p.speed, dt);
  }

  // ---------- save / load ----------
  serialize(): SaveGame {
    return {
      version: 2, opts: { ...this.opts }, time: this.time, score: this.score, budget: this.budget, reputation: this.reputation,
      solved: this.solved, failed: this.failed, deaths: this.deaths, over: this.over, nextId: this.nextId, rng: this.rng.state, spawnTimer: this.spawnTimer,
      buildings: [...this.buildings.values()].map(b => ({ id: b.id, fire: b.fire, damage: b.damage, destroyed: b.destroyed, incidentId: b.incidentId, growth: b.growth, spread: b.spread, resistance: b.resistance })),
      vehicles: structuredClone([...this.vehicles.values()]), responders: structuredClone([...this.responders.values()]),
      victims: structuredClone([...this.victims.values()]), suspects: structuredClone([...this.suspects.values()]), bystanders: structuredClone([...this.bystanders.values()]),
      incidents: structuredClone([...this.incidents.values()]), obstacles: [...this.obstacles], won: this.won, script: this.script.map(e => ({ ...e })),
    };
  }

  static fromSave(content: Content, s: SaveGame): World {
    if (!s || s.version !== 2) throw new Error('Onbekend of verouderd savegame-formaat');
    const w = new World(content, s.opts);
    w.time = s.time; w.score = s.score; w.budget = s.budget; w.reputation = s.reputation; w.solved = s.solved; w.failed = s.failed; w.deaths = s.deaths;
    w.over = s.over; w.nextId = s.nextId; w.rng.state = s.rng; w.spawnTimer = s.spawnTimer;
    for (const sb of s.buildings) { const b = w.buildings.get(sb.id); if (b) Object.assign(b, { ...sb, resistance: sb.resistance ?? 1 }); }
    for (const v of s.vehicles) { v.home ??= { x: Math.floor(v.x), y: Math.floor(v.y) }; v.returning ??= false; v.toHospital ??= false; v.contraflow ??= false; v.blocked ??= 0; v.avoid ??= []; v.ghost ??= 0; v.water ??= content.vehicles[v.defId]?.tank ?? 0; v.hydrant ??= false; w.vehicles.set(v.id, v); }
    for (const r of s.responders) w.responders.set(r.id, r);
    for (const v of s.victims) w.victims.set(v.id, v);
    for (const x of s.suspects) w.suspects.set(x.id, x);
    for (const b of s.bystanders ?? []) w.bystanders.set(b.id, b);
    for (const i of s.incidents) { i.bystanders ??= []; i.defused ??= false; w.incidents.set(i.id, i); }
    w.obstacles = new Set(s.obstacles);
    w.script = s.script ?? [];
    w.won = s.won ?? false;
    w.roadVersion++;
    if (s.opts.traffic !== false) w.spawnTraffic();
    return w;
  }

  // ---------- queries for UI ----------
  activeIncidents(): Incident[] {
    return [...this.incidents.values()];
  }
  vehiclesOf(cat: Category): Vehicle[] {
    return [...this.vehicles.values()].filter(v => v.category === cat);
  }
}
