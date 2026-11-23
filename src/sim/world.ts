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
/** How many arrested suspects a police vehicle can take along. */
const PRISONER_CAP: Record<string, number> = { patrol_car: 2, police_van: 4, riot_van: 8 };
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
/** Fire can jump to buildings up to this many tiles away (over a street) when it is fully developed. */
export const SPREAD_RANGE = 7;
/** Road tiles within this many tiles of a secured incident are closed to civilian traffic. */
export const CORDON_RADIUS = 3.2;
/** Cooling: wetness added per second per working nozzle, how fast it dries, and how strongly it slows fire spread. */
export const COOL_RATE = 3;
export const WET_DECAY = 0.8;
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
  cool: ['fire_hose'],
  collect: ['body_bag'],
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

const STREET_NAMES = ['Dorpsstraat', 'Kerkstraat', 'Molenweg', 'Stationsweg', 'Industrieweg', 'Parklaan', 'Beatrixlaan', 'Wilhelminastraat', 'Julianalaan', 'Havenstraat', 'Schoolstraat', 'Raadhuisplein', 'Lindelaan', 'Eikenlaan', 'Burgemeester Wiersmastraat', 'Nieuwstraat', 'Bloemenweg', 'Marktstraat', 'Koningin Emmalaan', 'Sportlaan', 'Haverkamp', 'Veldweg', 'Oranjestraat', 'Zandpad', 'Beukenlaan', 'Singel'];
const TILE_GRASS = 0, TILE_ROAD = 1, TILE_BUILDING = 2, TILE_TREE = 3, TILE_PARKING = 4, TILE_WATER = 5;
/** Harder incidents take longer to resolve: 1 at severity 1, growing by `k` per severity level. */
export const sevFactor = (severity: number, k = 0.3) => 1 + k * (severity - 1);
const LANES: (Vec | null)[] = [null, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const PRIO_EMERGENCY = 2, PRIO_CIVILIAN = 1;
const key = (x: number, y: number) => y * 4096 + x;
/** Number of changes of direction along a path (every turn slows a vehicle down). */
const turnCount = (p: Vec[]): number => { let n = 0; for (let i = 2; i < p.length; i++) if (p[i].x - p[i - 1].x !== p[i - 1].x - p[i - 2].x || p[i].y - p[i - 1].y !== p[i - 1].y - p[i - 2].y) n++; return n; };

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
  buildings: { id: string; fire: number; damage: number; destroyed: boolean; incidentId: number | null; growth: number; spread: number; resistance?: number; wet?: number }[];
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
  /** junctions with traffic lights: crossings and T-junctions (bends and the like need none) */
  readonly signal: Uint8Array;
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
  readonly roadList: Vec[] = [];

  private constructor(content: Content, opts: WorldOptions) {
    this.content = content;
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    { const a = (((opts.seed * 2654435761) >>> 0) % 100000) / 100000 * Math.PI * 2; this.wind = { x: Math.cos(a), y: Math.sin(a), strength: 0.5 + (((opts.seed * 40503) >>> 0) % 100) / 200 }; }
    const map = content.maps[opts.mapId ?? 'default_city'] ?? Object.values(content.maps)[0];
    if (!map) throw new Error('Geen kaart beschikbaar');
    this.map = map;
    this.mission = opts.missionId ? content.missions[opts.missionId] ?? null : null;
    this.w = map.width;
    this.h = map.height;
    this.tiles = new Uint8Array(this.w * this.h);
    this.intersection = new Uint8Array(this.w * this.h);
    this.signal = new Uint8Array(this.w * this.h);
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
      const b: Building = { ...bd, door: { x: bd.x, y: bd.y }, fire: 0, damage: 0, destroyed: false, flammability: flam, incidentId: null, growth: 0, spread: 0, resistance: 1, wet: 0 };
      this.buildings.set(b.id, b);
      for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) this.buildingAt[j * this.w + i] = b;
    }
    for (const b of this.buildings.values()) b.door = this.findDoor(b);
    // junctions: a 2x2 road square with roads leaving it on perpendicular sides (crossing, T-junction or bend)
    const crossings: Vec[] = [];
    for (const r of this.roadList) {
      const { x, y } = r;
      if (!(this.isRoad(x + 1, y) && this.isRoad(x, y + 1) && this.isRoad(x + 1, y + 1))) continue;
      const L = this.isRoad(x - 1, y) && this.isRoad(x - 1, y + 1), R = this.isRoad(x + 2, y) && this.isRoad(x + 2, y + 1);
      const U = this.isRoad(x, y - 1) && this.isRoad(x + 1, y - 1), D = this.isRoad(x, y + 2) && this.isRoad(x + 1, y + 2);
      if ((L || R) && (U || D)) {
        const arms = (L ? 1 : 0) + (R ? 1 : 0) + (U ? 1 : 0) + (D ? 1 : 0);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) this.intersection[(y + dy) * this.w + x + dx] = 1;
        if (arms === 4) crossings.push({ x, y });
      }
    }
    // traffic lights only on the big crossings, never closer than 14 tiles to each other; everywhere else the east-west road has priority
    const lit: Vec[] = [];
    for (const c of crossings) {
      if (lit.some(o => Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) < 14)) continue;
      lit.push(c);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) this.signal[(c.y + dy) * this.w + c.x + dx] = 1;
    }
    for (const r of this.roadList) {
      if (this.intersection[r.y * this.w + r.x] === 1) continue;
      const hz = this.isRoad(r.x - 1, r.y) && this.isRoad(r.x + 1, r.y);
      const vt = this.isRoad(r.x, r.y - 1) && this.isRoad(r.x, r.y + 1);
      if (hz && vt) continue;
      if (hz) {
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
    else if (opts.scripted) { // 'Nieuw spel': a random fire, a random ambulance call and a random police call
      const of = (cat: string) => Object.values(content.incidents).filter(d => d.category === cat);
      w.script = (['fire', 'ambulance', 'police'] as const).map((cat, i) => ({ at: [3, 30, 55][i], def: w.rng.pick(of(cat)).id }));
    }
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
  isSignalised(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.signal[y * this.w + x] === 1;
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

  static readonly MAX_VEHICLES_PER_CATEGORY = 20;

  reinforcementCost(defId: string): number {
    return this.content.vehicles[defId]?.cost ?? 500;
  }

  /** Buy an extra vehicle for the matching station with budget. Returns the new vehicle or null (a warning is emitted). */
  callReinforcement(defId: string, free = false): Vehicle | null {
    const def = this.content.vehicles[defId];
    if (!def || this.over) return null;
    const stations = this.map.stations.filter(s => s.category === def.category);
    if (!stations.length) { this.emit({ type: 'warn', message: `Geen post beschikbaar voor ${def.name}` }); return null; }
    const cost = free ? 0 : this.reinforcementCost(defId);
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
    this.emit({ type: 'info', message: free ? `Opschaling: ${v.name} staat klaar bij de post` : `Versterking: ${v.name} staat klaar bij de post (€${cost})` });
    return v;
  }

  createVehicle(def: VehicleDef, stationId: string, x: number, y: number): Vehicle {
    const v: Vehicle = {
      kind: 'vehicle', ...this.addEntityBase(x, y), defId: def.id, category: def.category, stationId, path: [], dest: null, home: { x: Math.floor(x), y: Math.floor(y) }, returning: false, silent: false, cargo: 0, passUntil: 0, prio: 1, speedNow: 0, patrol: false, patrolRoute: [], patrolIdx: 0, toHospital: false, contraflow: false, blocked: 0, avoid: [], ghost: 0,
      pathVersion: this.roadVersion, water: def.tank ?? 0, hydrant: false, crew: [], patients: [], prisoners: [], lights: false, angle: 0, state: 'idle',
      name: `${def.name} ${[...this.vehicles.values()].filter(o => o.defId === def.id).length + 1}`,
    };
    this.vehicles.set(v.id, v);
    for (const slot of def.crew) {
      const role = this.content.roles[slot.role];
      for (let i = 0; i < slot.count; i++) {
        const r: Responder = {
          kind: 'responder', ...this.addEntityBase(x, y), role: role.id, category: role.category, vehicleId: v.id, inVehicle: true,
          path: [], task: null, angle: 0, name: `${role.name} ${v.crew.length + 1}`, carrying: null, aiming: null,
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
    this.separateResponders(dt);
    this.updateSuspects(dt);
    if (this.pendingSends.length) { const due = this.pendingSends.filter(p => p.at <= this.time); if (due.length) { this.pendingSends = this.pendingSends.filter(p => p.at > this.time); for (const p of due) this.sendToScene(p.defId, p.tx, p.ty); } }
    this.updateWater(dt);
    this.updateGrip(dt);
    this.updateHearses(dt);
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
    if (!b.leaving) { // onlookers watch what is going on
      const inc = this.incidents.get(b.incidentId);
      if (inc) { const want = Math.atan2(inc.y - b.y, inc.x - b.x), d = Math.atan2(Math.sin(want - b.angle), Math.cos(want - b.angle)); b.angle += Math.max(-2 * dt, Math.min(2 * dt, d)); }
      return;
    }
    this.stepAlong(b, b.path, 1.9, dt);
    if (!b.path.length) this.bystanders.delete(b.id);
  }

  private *allMovers(): Iterable<{ x: number; y: number; px: number; py: number }> {
    yield* this.vehicles.values(); yield* this.responders.values(); yield* this.victims.values();
    yield* this.civilians; yield* this.pedestrians; yield* this.bystanders.values();
  }

  /** 0 = east-west traffic has green, 1 = north-south. */
  get lightPhase(): 0 | 1 {
    return (Math.floor(this.time / 12) % 2) as 0 | 1;
  }
  /** the last 1.4 s of every phase everything is red, so the junction clears before the cross traffic starts */
  get lightsRed(): boolean {
    return this.time % 12 > 10.6;
  }
  /** May traffic travelling horizontally / vertically enter this junction tile right now? */
  canGo(x: number, y: number, horizontal: boolean): boolean {
    if (this.isSignalised(x, y)) return !this.lightsRed && (this.lightPhase === 0) === horizontal;
    if (!horizontal && this.isIntersection(x, y)) return !this.crossTraffic(x, y); // minor road: give way to the east-west traffic
    return true;
  }
  /** Is east-west traffic in, or about to enter, the junction at this tile? */
  private crossTraffic(x: number, y: number): boolean {
    const cx = x + 0.5, cy = y + 0.5;
    const near = (ox: number, oy: number, ang: number, v: number): boolean => Math.abs(oy - cy) < 1.7 && Math.abs(ox - cx) < 3.6 && Math.abs(Math.cos(ang)) > 0.6 && (v > 0.3 || Math.abs(ox - cx) < 1.6);
    for (const o of this.civilians) if (near(o.x, o.y, o.angle, o.v)) return true;
    for (const o of this.vehicles.values()) if (near(o.x, o.y, o.angle, o.speedNow)) return true;
    return false;
  }
  /** Is the first stretch of road behind the junction occupied by a (nearly) stationary vehicle? Then do not enter: never block the box. */
  private exitBlocked(path: Vec[], selfId: number): boolean {
    let ex: Vec | null = null;
    for (let i = 0; i < Math.min(path.length, 5); i++) if (!this.isIntersection(path[i].x, path[i].y)) { ex = path[i]; break; }
    if (!ex) return false;
    const cx = ex.x + 0.5, cy = ex.y + 0.5;
    const lane = this.laneAt(ex.x, ex.y);
    if (!lane) return false;
    const inLane = (ox: number, oy: number): boolean => { const rx = ox - cx, ry = oy - cy, along = rx * lane.x + ry * lane.y, lat = Math.abs(rx * lane.y - ry * lane.x); return lat < 0.5 && along > -0.9 && along < 1.1; };
    for (const o of this.civilians) if (o.id !== selfId && o.v < 0.4 && inLane(o.x, o.y)) return true;
    for (const o of this.vehicles.values()) if (o.id !== selfId && o.speedNow < 0.4 && inLane(o.x, o.y)) return true;
    return false;
  }

  // ---------- movement helpers ----------
  private stepAlong(e: { x: number; y: number; angle: number }, path: Vec[], speed: number, dt: number): void {
    // people (and anything else that walks) accelerate from a standstill instead of moving at full speed at once
    const m = e as { x: number; y: number; angle: number; v?: number; vt?: number };
    if (this.time - (m.vt ?? -9) > 0.25) m.v = 0;
    m.vt = this.time;
    m.v = Math.min(speed, (m.v ?? 0) + 3.2 * dt);
    let budget = Math.max(0.15, m.v) * dt;
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
    // tiles taken by a parked vehicle or promised to one that is on its way, including the neighbouring tiles of the same lane that its length covers
    const set = new Set<number>();
    const mine = this.vehicleDef(except).length;
    for (const o of this.vehicles.values()) {
      if (o === except) continue;
      const parked = !o.path.length;
      if (!parked && !o.dest) continue;
      const px = parked ? o.x : o.dest!.x + 0.5, py = parked ? o.y : o.dest!.y + 0.5;
      const tx = Math.floor(px), ty = Math.floor(py);
      set.add(key(tx, ty));
      if (parked && this.isParking(tx, ty)) continue;
      const lane = this.laneAt(tx, ty);
      if (!lane) continue;
      const reach = (this.vehicleDef(o).length + mine) / 2 + 0.1;
      for (let k = 1; k <= Math.ceil(reach); k++) for (const sgn of [-1, 1]) {
        if (k > reach) continue;
        set.add(key(tx + lane.x * k * sgn, ty + lane.y * k * sgn));
      }
    }
    return set;
  }

  routeVehicle(v: Vehicle, dest: Vec, avoid: number[] = v.avoid): boolean {
    const path = this.planRoute(v, dest, avoid);
    if (!path) return false;
    v.path = path;
    v.dest = { x: dest.x, y: dest.y };
    v.pathVersion = this.roadVersion;
    return true;
  }

  /** The route a vehicle would take to `dest` (not assigned): lane-compliant, with a U-turn when that saves a long detour. */
  planRoute(v: Vehicle, dest: Vec, avoid: number[] = v.avoid): Vec[] | null {
    const idle = this.idleTiles(v);
    const skip = new Set(avoid);
    // a stopped vehicle in a lane can be overtaken through the opposite lane, so lane tiles stay routable (parking spots and junctions do not)
    const passable = (x: number, y: number) => this.isDrivable(x, y) && (!idle.has(key(x, y)) || (this.laneAt(x, y) !== null && !this.isIntersection(x, y))) && !skip.has(key(x, y)) && !(x === dest.x && y === dest.y && idle.has(key(x, y)));
    const start = { x: Math.floor(v.x), y: Math.floor(v.y) };
    // every vehicle may turn around anywhere on the street (a U-turn into the opposite lane), so routes are the shortest ones
    // ...but not into a spot where another vehicle stands (or its length reaches): turning around there would be physically impossible
    const uturnEdge = (ax: number, ay: number, bx: number, by: number): boolean => this.laneUturnOk(ax, ay, bx, by) && (this.laneEdgeOk(ax, ay, bx, by) || !idle.has(key(bx, by)));
    const turning = findPath(this.w, this.h, start, dest, passable, { edge: v.contraflow ? this.bayEdgeOk : uturnEdge });
    return turning ?? findPath(this.w, this.h, start, dest, passable, { edge: this.laneEdgeOk });
  }

  /** Nearest drivable tiles to a point that are not blocked by an obstacle or a parked vehicle, best first. */
  candidateTiles(x: number, y: number, self: Vehicle | null, count = 8, maxR = 14): Vec[] {
    const idle = self ? this.idleTiles(self) : new Set<number>();
    const out: { t: Vec; d: number }[] = [];
    const x0 = Math.floor(x), y0 = Math.floor(y);
    for (let j = y0 - maxR; j <= y0 + maxR; j++) {
      for (let i = x0 - maxR; i <= x0 + maxR; i++) {
        if (!this.isDrivable(i, j) || idle.has(key(i, j))) continue;
        out.push({ t: { x: i, y: j }, d: Math.hypot(i + 0.5 - x, j + 0.5 - y) + (this.clearStopTile(i, j) ? 0 : 6) });
      }
    }
    return out.sort((a, b) => a.d - b.d).slice(0, count).map(o => o.t);
  }

  /** A good place to stop: not in a junction and not on a zebra crossing next to one. */
  private clearStopTile(x: number, y: number): boolean {
    if (!this.isRoad(x, y)) return true;
    return !this.isIntersection(x, y) && !this.isIntersection(x - 1, y) && !this.isIntersection(x + 1, y) && !this.isIntersection(x, y - 1) && !this.isIntersection(x, y + 1);
  }

  /**
   * A stopped vehicle on the road lines up with its lane (never across the road) and settles in the middle of its
   * lane tile; this also happens after a stop order halfway a turn or a U-turn.
   */
  private settleVehicle(v: Vehicle, dt: number): void {
    const tx = Math.floor(v.x), ty = Math.floor(v.y);
    if (!this.isRoad(tx, ty)) return;
    const lane = this.laneAt(tx, ty);
    let axis: number;
    if (lane) axis = Math.atan2(lane.y, lane.x);
    else axis = this.isRoad(tx - 1, ty) || this.isRoad(tx + 1, ty) ? 0 : Math.PI / 2;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const d1 = wrap(axis - v.angle), d2 = wrap(axis + Math.PI - v.angle);
    const diff = Math.abs(d1) <= Math.abs(d2) ? d1 : d2;
    if (Math.abs(diff) > 1e-3) {
      const len0 = this.vehicleDef(v).length;
      // turning in place swings the whole length through the neighbouring space: only when nobody is there
      const goal = v.angle + diff; // the orientation it is turning to must be free (and the swing not wider than a little more than that)
      if (!this.findBlocker(v, v.x, v.y, Math.cos(goal), Math.sin(goal), 0.01, len0, len0 * 0.5, PRIO_EMERGENCY)) v.angle += Math.max(-4 * dt, Math.min(4 * dt, diff));
    }
    // glide to the middle of the lane
    // a parked vehicle pulls over to the kerb (right-hand side) so the lane stays passable
    let cx = tx + 0.5, cy = ty + 0.5;
    if (lane && !this.isIntersection(tx, ty) && !v.path.length) {
      const rx = -lane.y, ry = lane.x; // right of the direction of travel
      if (!this.isRoad(tx + rx, ty + ry) && Math.abs(Math.cos(v.angle) * lane.x + Math.sin(v.angle) * lane.y) > 0.9) { cx += rx * 0.2; cy += ry * 0.2; }
    }
    const dx = cx - v.x, dy = cy - v.y, dd = Math.hypot(dx, dy);
    if (dd > 1e-3 && Math.abs(diff) < 0.6) {
      const st = Math.min(dd, 1.6 * dt);
      const len = this.vehicleDef(v).length;
      if (this.findBlocker(v, v.x, v.y, dx / dd, dy / dd, st + 0.05, len, halfWidth(len), PRIO_EMERGENCY)) return; // never glide into somebody
      v.x += (dx / dd) * st; v.y += (dy / dd) * st;
    }
  }

  /** Drive to the best reachable tile near a point. */
  private driveNear(v: Vehicle, x: number, y: number): boolean {
    v.contraflow = false;
    v.avoid = [];
    // compare the real routes to the best few stopping places: the cheapest one wins, not just the nearest tile
    let best: { c: Vec; cost: number } | null = null;
    for (const c of this.candidateTiles(x, y, v, 18, 14)) {
      const p = this.planRoute(v, c);
      if (!p) continue;
      const cost = p.length + Math.hypot(c.x + 0.5 - x, c.y + 0.5 - y) * 1.5 + (this.clearStopTile(c.x, c.y) ? 0 : 60) + turnCount(p) * 0.6; // never park in a junction when there is any other way
      if (!best || cost < best.cost) best = { c, cost };
    }
    return best ? this.routeVehicle(v, best.c) : false;
  }

  /** Hospital beds: every admitted patient occupies a bed for a while (release times per hospital id). */
  readonly hospitalBeds = new Map<string, number[]>();
  static readonly BEDS = 4;
  static readonly BED_SECONDS = 150;
  bedsFree(h: Building): number {
    const t = this.time;
    const list = (this.hospitalBeds.get(h.id) ?? []).filter(r => r > t);
    this.hospitalBeds.set(h.id, list);
    return World.BEDS - list.length;
  }
  /** The nearest hospital; one with a free bed is preferred, a full one is the fallback so the ambulance still goes somewhere. */
  private nearestHospital(x: number, y: number): Building | null {
    let best: Building | null = null, bd = Infinity, free: Building | null = null, fd = Infinity;
    for (const b of this.buildings.values()) if (b.type === 'hospital' && !b.destroyed) {
      const d = rectDist(b, x, y);
      if (d < bd) { bd = d; best = b; }
      if (d < fd && this.bedsFree(b) > 0) { fd = d; free = b; }
    }
    return free ?? best;
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
      v.silent = true; // back to the station: no sirens
      if (Math.hypot(v.x - (v.home.x + 0.5), v.y - (v.home.y + 0.5)) > 0.6) {
        v.contraflow = false;
        v.avoid = [];
        if (!this.routeVehicle(v, v.home)) this.emit({ type: 'warn', message: `${v.name}: geen route naar de kazerne` });
      }
    }
    if (v.patrol && !v.path.length && this.groundVehicle(v) && v.patrolRoute.length) {
      for (let tries = 0; tries < v.patrolRoute.length && !v.path.length; tries++) {
        const wp = v.patrolRoute[v.patrolIdx % v.patrolRoute.length];
        v.patrolIdx = (v.patrolIdx + 1) % v.patrolRoute.length;
        if (Math.hypot(wp.x + 0.5 - v.x, wp.y + 0.5 - v.y) < 3) continue;
        this.driveNear(v, wp.x + 0.5, wp.y + 0.5);
      }
      v.silent = true;
    }
    if (!v.path.length) {
      if (v.state === 'moving') {
        v.state = 'idle'; v.lights = false; v.silent = false; v.dest = null; v.contraflow = false; v.avoid = []; v.blocked = 0;
        if (Math.hypot(v.x - (v.home.x + 0.5), v.y - (v.home.y + 0.5)) < 0.1 && this.isParking(v.home.x, v.home.y)) {
        v.angle = -Math.PI / 2; // parked nose-out
        if (v.cargo) v.cargo = 0; // the tow truck unloads the wreck at the depot
        if (v.prisoners.length) { for (const id of v.prisoners) this.suspects.delete(id); this.emit({ type: 'info', message: `${v.prisoners.length} verdachte(n) overgedragen op het bureau` }); v.prisoners = []; }
        if (this.vehicleDef(v).id === 'hearse' && v.patients.length) { for (const id of v.patients) this.victims.delete(id); v.patients = []; this.emit({ type: 'info', message: 'De overledenen zijn overgedragen aan het uitvaartcentrum' }); }
      }
      }
    } else {
      v.state = 'moving';
      v.lights = !v.silent;
      this.driveVehicle(v, dt);
    }
    if (!v.path.length && v.state === 'idle') {
      // a vehicle that comes to a halt in a junction drives on to a clear spot instead of blocking all four directions
      if (this.isIntersection(Math.floor(v.x), Math.floor(v.y)) && this.groundVehicle(v) && !v.returning) {
        const t = (this.junctionTimer.get(v.id) ?? 0) + dt;
        this.junctionTimer.set(v.id, t);
        if (t > 1.2) { this.junctionTimer.set(v.id, -3); this.driveNear(v, v.x, v.y); }
      } else this.junctionTimer.delete(v.id);
      this.settleVehicle(v, dt);
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
    // speed: prio 1 drives hard, prio 2 calmly; accelerate from a standstill, brake for the next corner
    let vmax = def.maxSpeed * KMH_TO_TILES * (v.prio === 2 ? 0.85 : 1.15) * (this.raining ? 0.9 : 1);
    const cd = this.cornerDistance(v);
    if (cd < 8) vmax = Math.min(vmax, Math.sqrt((v.prio === 2 ? 2.6 : 3.4) ** 2 + 2 * 7 * Math.max(0, cd - 0.2)));
    const accel = 2.8 + 3 / Math.max(1, def.length);
    v.speedNow = Math.max(0, Math.min(vmax, v.speedNow + (v.speedNow < vmax ? accel : -8) * dt));
    if (v.speedNow < 0.15 && vmax > 0.2) v.speedNow = 0.15; // the first moment of pulling away
    let budget = v.speedNow * dt;
    while (budget > 1e-6 && v.path.length) {
      const tx = v.path[0].x + 0.5, ty = v.path[0].y + 0.5;
      const dx = tx - v.x, dy = ty - v.y, d = Math.hypot(dx, dy);
      if (d < 1e-4) { v.path.shift(); continue; }
      const ux = dx / d, uy = dy / d, step = Math.min(budget, d);
      // a U-turn swings the whole length of the vehicle through the neighbouring lane: reserve that space
      const la0 = this.laneAt(Math.floor(v.x), Math.floor(v.y)), lb0 = this.laneAt(v.path[0].x, v.path[0].y);
      const uturn = !!(la0 && lb0 && la0.x === -lb0.x && la0.y === -lb0.y && Math.abs(ux * la0.x + uy * la0.y) < 1e-6);
      // a siren vehicle does not trail slow traffic: it pulls out to pass as soon as a car is just ahead in the lane
      if (v.lights && this.time > v.passUntil && v.path.length >= 5 && !uturn) {
        const dl = this.laneAt(Math.floor(v.x), Math.floor(v.y));
        if (dl && this.slowAhead(v, dl)) {
          const np = this.overtakePath(v.x, v.y, v.path, v.id, 4);
          if (np) { v.path = np; v.passUntil = this.time + 8; continue; }
        }
      }
      const blocker = v.ghost > 0 ? null : this.gate(v, def.length) ?? this.findBlocker(v, v.x, v.y, ux, uy, step, def.length, uturn ? def.length * 0.64 : halfWidth(def.length), PRIO_EMERGENCY);
      if (blocker) { v.speedNow = 0; this.onBlocked(v, blocker, dt); return; }
      v.blocked = 0;
      // prio 2 obeys the traffic lights like everybody else
      if (v.prio === 2 && this.isIntersection(v.path[0].x, v.path[0].y) && !this.isIntersection(Math.floor(v.x), Math.floor(v.y)) && d < 0.95) {
        if (!this.canGo(v.path[0].x, v.path[0].y, Math.abs(ux) > Math.abs(uy))) { v.speedNow = 0; return; }
      }
      // U-turn: sliding into the opposite lane while rotating through 180 degrees
      const la = this.laneAt(Math.floor(v.x), Math.floor(v.y)), lb = this.laneAt(v.path[0].x, v.path[0].y);
      const sideStep = !!(la && lb && la.x === -lb.x && la.y === -lb.y && Math.abs(ux * la.x + uy * la.y) < 1e-6);
      if (sideStep && this.time < v.passUntil) { // overtaking: keep facing the way of travel, a slight angle into the side-step
        const dirX = Math.abs(la!.x) > 0 ? la!.x * (v.angle > Math.PI / 2 || v.angle < -Math.PI / 2 ? 1 : 1) : 0;
        void dirX;
        const along = Math.atan2(la!.y, la!.x);
        const sgn = Math.sign(la!.x * uy - la!.y * ux) || 1;
        v.angle = along + sgn * 0.35;
      } else if (sideStep) {
        const sign = Math.sign(la!.x * uy - la!.y * ux) || 1;
        v.angle = Math.atan2(la!.y, la!.x) + sign * Math.PI * Math.min(1, Math.max(0, 1 - (d - step)));
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

  /** Distance along the path to the first real turn (Infinity when straight for the next few tiles). */
  private cornerDistance(v: Vehicle): number {
    const p = v.path;
    if (!p.length) return Infinity;
    let dist = Math.hypot(p[0].x + 0.5 - v.x, p[0].y + 0.5 - v.y);
    let hx = Math.cos(v.angle), hy = Math.sin(v.angle);
    if (dist > 0.05) { hx = (p[0].x + 0.5 - v.x) / dist; hy = (p[0].y + 0.5 - v.y) / dist; }
    for (let i = 1; i < Math.min(p.length, 8); i++) {
      const dx = p[i].x - p[i - 1].x, dy = p[i].y - p[i - 1].y;
      if (dx * hx + dy * hy < 0.7) return dist;
      dist += 1;
    }
    return Infinity;
  }

  /** Is there a slower car (or a stopped vehicle) within a few tiles ahead in this lane? */
  private slowAhead(v: Vehicle, lane: Vec): boolean {
    const mine = v.speedNow;
    const ahead = (x: number, y: number) => { const rx = x - v.x, ry = y - v.y; const along = rx * lane.x + ry * lane.y, lat = Math.abs(rx * lane.y - ry * lane.x); return along > 0.6 && along < 3.2 && lat < 0.65; };
    for (const c of this.civilians) if (ahead(c.x, c.y) && c.v < Math.max(1.2, mine * 0.8)) return true;
    return false;
  }

  /**
   * Overtaking: when something slow or stopped is ahead in the lane, a vehicle may use the opposite lane for a few tiles. Returns the new path
   * (side-step into the opposite lane, drive past, side-step back into the original route) or null when it is not safe or possible:
   * a straight stretch of at least 6 tiles, no junction, and the opposite lane free of everybody including oncoming traffic.
   */
  private overtakePath(x: number, y: number, path: Vec[], selfId: number, K = 6): Vec[] | null {
    const cur = { x: Math.floor(x), y: Math.floor(y) };
    const d = this.laneAt(cur.x, cur.y);
    if (path.length && path[0].x === cur.x && path[0].y === cur.y) path = path.slice(1); // not yet at the middle of its own tile
    if (!d || path.length < K + 1) return null;
    for (let i = 1; i <= K; i++) {
      const t = { x: cur.x + d.x * i, y: cur.y + d.y * i };
      if (path[i - 1].x !== t.x || path[i - 1].y !== t.y || this.isIntersection(t.x, t.y) || !this.isRoad(t.x, t.y)) return null;
      const l = this.laneAt(t.x, t.y);
      if (!l || l.x !== d.x || l.y !== d.y) return null;
    }
    const sides = [{ x: -d.y, y: d.x }, { x: d.y, y: -d.x }];
    for (const n of sides) {
      const o: Vec[] = [];
      let ok = true;
      for (let i = 0; i < K && ok; i++) {
        const t = { x: cur.x + d.x * i + n.x, y: cur.y + d.y * i + n.y };
        const l = this.laneAt(t.x, t.y);
        if (!this.isRoad(t.x, t.y) || this.isIntersection(t.x, t.y) || this.obstacles.has(key(t.x, t.y)) || this.cordon.has(key(t.x, t.y)) || !l || l.x !== -d.x || l.y !== -d.y) ok = false;
        o.push(t);
      }
      if (!ok) continue;
      // everybody within reach of the opposite lane strip (and oncoming traffic further ahead) blocks the manoeuvre
      const zone: { x: number; y: number; r: number }[] = o.map(t => ({ x: t.x + 0.5, y: t.y + 0.5, r: 1.25 }));
      const last = o[o.length - 1];
      for (let j = 1; j <= 7; j++) zone.push({ x: last.x + 0.5 + d.x * j, y: last.y + 0.5 + d.y * j, r: 1.0 });
      const hit = (px: number, py: number) => zone.some(z => Math.hypot(px - z.x, py - z.y) < z.r);
      // whatever stands in our own lane is what we are passing: only traffic in the opposite strip counts
      const ownLane = (px: number, py: number) => d.x !== 0 ? Math.abs(py - (cur.y + 0.5)) < 0.55 : Math.abs(px - (cur.x + 0.5)) < 0.55;
      if ([...this.vehicles.values()].some(v => v.id !== selfId && !ownLane(v.x, v.y) && hit(v.x, v.y))) continue;
      if (this.civilians.some(c => c.id !== selfId && !ownLane(c.x, c.y) && hit(c.x, c.y))) continue;
      if ([...this.responders.values()].some(r => !r.inVehicle && hit(r.x, r.y)) || [...this.victims.values()].some(v => (v.transport === 'scene' || v.transport === 'dead') && hit(v.x, v.y)) || [...this.bystanders.values()].some(b => hit(b.x, b.y))) continue;
      const back = { x: cur.x + d.x * (K - 1), y: cur.y + d.y * (K - 1) };
      return [...o, back, ...path.slice(K - 1)];
    }
    return null;
  }

  /** Tile keys around a blocker (its footprint, and the rest of the junction when it stands in one): routes avoid them all. */
  private blockerTiles(b: Blocker): number[] {
    const out: number[] = [];
    const bx = Math.floor(b.x), by = Math.floor(b.y);
    for (let j = by - 2; j <= by + 2; j++) for (let i = bx - 2; i <= bx + 2; i++) {
      if (!this.isRoad(i, j)) continue;
      const near = Math.hypot(i + 0.5 - b.x, j + 0.5 - b.y) <= 1.5;
      const sameJunction = this.isIntersection(bx, by) && this.isIntersection(i, j);
      if (near || sameJunction) out.push(key(i, j));
    }
    return out;
  }

  /** `other` is in the way of `by`: when it is idle with everybody aboard it moves to a free tile 3-8 tiles away and parks there. */
  private makeWay(otherId: number, by: Vehicle): void {
    const o = this.vehicles.get(otherId);
    if (!o || o.path.length || o.dest || !this.groundVehicle(o)) return;
    if (o.crew.some(id => !this.responders.get(id)!.inVehicle) || o.patrol) return;
    const here = this.isParking(Math.floor(o.x), Math.floor(o.y));
    if (here) return; // parked in its own bay: not in anybody's way
    const taken = new Set<number>(by.path.slice(0, 12).map(t => key(t.x, t.y)));
    for (const c of this.candidateTiles(o.x, o.y, o, 40, 9)) {
      const dd = Math.hypot(c.x + 0.5 - o.x, c.y + 0.5 - o.y);
      if (dd < 3 || taken.has(key(c.x, c.y)) || !this.clearStopTile(c.x, c.y)) continue;
      if (this.routeVehicle(o, c)) { o.silent = true; o.prio = 2; return; }
    }
  }

  private onBlocked(v: Vehicle, b: Blocker, dt: number): void {
    const before = v.blocked;
    v.blocked += dt;
    // close enough to where it was going but it cannot get any closer: stop right here and be available (a vehicle should not hang about)
    if (v.dest && !v.returning && !v.silent) {
      const near = Math.hypot(v.x - (v.dest.x + 0.5), v.y - (v.dest.y + 0.5));
      if ((v.blocked > 1.0 && near < 4.5) || (v.blocked > 2.5 && near < 8)) {
        v.path = []; v.dest = null; v.blocked = 0; v.speedNow = 0;
        return;
      }
    }
    const movingVeh = b.kind === 'veh' && !b.halted;
    // an idle, fully crewed vehicle standing in the way makes room: it rolls on to a free spot a few tiles further (no siren) so the rest can pass
    if (b.kind === 'veh' && b.halted && v.blocked > 2.2 && Math.floor(v.blocked / 2.2) !== Math.floor(before / 2.2)) this.makeWay(b.id ?? -1, v);
    // slow or stopped traffic ahead: overtake through the opposite lane when that is safe
    if (v.blocked > 0.7 && this.time > v.passUntil && (b.kind === 'civ' || (b.kind === 'veh' && b.halted))) {
      const np = this.overtakePath(v.x, v.y, v.path, v.id);
      if (np) { v.path = np; v.passUntil = this.time + 9; v.blocked = 0; return; }
    }
    // head-on or crossing standoff between two moving vehicles: the one with the higher id turns around and takes another way
    if (movingVeh && v.dest && v.blocked > 1.2 && (b.id ?? 0) < v.id && Math.floor(v.blocked / 2) !== Math.floor(before / 2)) {
      v.contraflow = false;
      v.avoid = [...v.avoid.slice(-8), ...this.blockerTiles(b)];
      const dest = v.dest;
      if (!this.routeVehicle(v, dest, v.avoid)) v.dest = dest;
    }
    // a civilian car standing in the way of an emergency vehicle pulls away
    if (b.kind === 'civ' && (b.halted || v.blocked > 3) && v.blocked > 1.2) this.respawnCivilian(b.civ!);
    // a parked vehicle in the way: plan a different route around it (still obeying the lane rules)
    if (((b.kind === 'veh' && b.halted) || (b.kind === 'civ' && v.blocked > 3.5)) && v.dest && v.blocked > 1.5 && Math.floor(v.blocked / 2) !== Math.floor(before / 2)) {
      v.avoid = [...v.avoid.slice(-8), ...this.blockerTiles(b)];
      const dest = v.dest;
      if (!this.routeVehicle(v, dest, v.avoid)) {
        v.dest = dest;
        // no legal way around (everything is one-way and blocked): as a last resort drive against the lane direction around it
        v.contraflow = true;
        if (!this.routeVehicle(v, dest, v.avoid)) {
          v.contraflow = false;
          v.dest = dest;
          // the destination itself is taken by a stopped vehicle: stop at the nearest free spot instead
          if (v.blocked > 3) this.driveNear(v, dest.x + 0.5, dest.y + 0.5);
        }
      }
    }
    if (b.kind === 'person' && v.blocked > 1) {
      if (b.responder && !b.responder.task && !b.responder.path.length) {
        // idle crew standing in the road steps onto the pavement
        b.responder.task = { type: 'move' };
        if (!this.walkTo(b.responder, (x, y) => !this.isRoad(x, y) && !this.isParking(x, y))) { b.responder.task = null; b.responder.path = []; }
      } else if (v.dest && Math.floor(v.blocked / 2) !== Math.floor(before / 2)) {
        // somebody working in the way (or a casualty): plan around them
        v.avoid = [...v.avoid.slice(-8), ...this.blockerTiles(b)];
        const dest = v.dest;
        if (!this.routeVehicle(v, dest, v.avoid)) v.dest = dest;
      }
    }
    if (v.blocked > 8 && v.blocked < 8.2 && movingVeh && (b.id ?? 0) < v.id && (this.vehicles.get(b.id ?? -1)?.speedNow ?? 0) < 0.3) v.ghost = 2.5; // last resort for a deadlock between moving vehicles: slip past
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
      const rr = len / 2 + LOOK + 0.2 + lo / 2 + ho; // cheap rejection before any trigonometry
      if (Math.abs(o.x - cx) > rr || Math.abs(o.y - cy) > rr) return null;
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
      const r = check(o, o.len, o.hw, PRIO_CIVILIAN, 'civ', o);
      if (r) return r;
    }
    const lookP: Obb = { x: cx + ux * 0.12, y: cy + uy * 0.12, ux, uy, hl: len / 2 + 0.17, hw: hw + 0.04 };
    // people on the pavement are not in the way of traffic; only people on the road or in a parking lot block
    const reachP = len / 2 + 0.7;
    const person = (o: { x: number; y: number }, responder?: Responder): Blocker | null =>
      Math.abs(o.x - cx) > reachP || Math.abs(o.y - cy) > reachP ? null : !this.isRoad(Math.floor(o.x), Math.floor(o.y)) && !this.isParking(Math.floor(o.x), Math.floor(o.y)) ? null : obbOverlap(lookP, { x: o.x, y: o.y, ux: 1, uy: 0, hl: 0.26, hw: 0.26 }) ? { kind: 'person', x: o.x, y: o.y, halted: true, responder } : null;
    for (const o of this.responders.values()) { if (!o.inVehicle) { const r = person(o, o); if (r) return r; } }
    for (const o of this.victims.values()) { if (o.transport === 'scene' || o.transport === 'dead') { const r = person(o); if (r) return r; } }
    for (const o of this.suspects.values()) { if (o.mode === 'boarded') continue; const r = person(o); if (r) return r; }
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
  /** Walk up close to a casualty: everybody takes their own side (spread by golden-angle slots) at about half a metre. */
  private approachSlot(r: Responder, vx: number, vy: number, cancel: () => void): boolean {
    const a = (r.id * 2.399963) % (Math.PI * 2);
    const tx = vx + Math.cos(a) * 0.55, ty = vy + Math.sin(a) * 0.55;
    let failed = false;
    const ok = this.approach(r, tx, ty, 1.0, () => { failed = true; });
    if (failed) return this.approach(r, vx, vy, 1.4, cancel); // no tile on that side (wreck, kerb): stand wherever there is room
    if (ok) r.angle = Math.atan2(vy - r.y, vx - r.x); // look at the casualty
    return ok;
  }

  private approach(r: Responder, tx: number, ty: number, range: number, cancel: () => void): boolean {
    if (Math.hypot(r.x - tx, r.y - ty) <= range) { r.path = []; return true; }
    if (!r.path.length) {
      const ok = this.walkTo(r, (x, y) => this.isWalkable(x, y) && Math.hypot(x + 0.5 - tx, y + 0.5 - ty) <= Math.max(range - 0.25, 0.4));
      if (!ok) { this.emit({ type: 'warn', message: `${r.name}: geen looproute naar doel` }); cancel(); return false; }
      if (!r.path.length) r.path = [{ x: Math.floor(r.x), y: Math.floor(r.y) }]; // already on the right tile: walk to its middle
    }
    this.stepAlong(r, r.path, this.roleDef(r).speed, SIM_DT);
    return false;
  }

  /** Can this vehicle take arrested suspects along? */
  prisonerCapacity(defId: string): number { return PRISONER_CAP[defId] ?? 0; }

  /** Suspects: runners flee from approaching police (until they are out of breath), cuffed ones walk with their officer. */
  private updateSuspects(dt: number): void {
    for (const s of this.suspects.values()) {
      if (s.mode === 'boarded') {
        const v = s.vehicleId !== null ? this.vehicles.get(s.vehicleId) : null;
        if (v) { s.x = v.x; s.y = v.y; } else { s.mode = 'idle'; }
        continue;
      }
      if (s.arrested) {
        if (s.mode === 'escorted') {
          const r = s.escortedBy !== null ? this.responders.get(s.escortedBy) : null;
          if (!r || r.task?.type !== 'arrest') { s.mode = 'idle'; s.escortedBy = null; continue; }
          const tx = r.x - Math.cos(r.angle) * 0.8, ty = r.y - Math.sin(r.angle) * 0.8;
          const d = Math.hypot(tx - s.x, ty - s.y);
          if (d > 0.25) { const st = Math.min(d, 2.9 * dt); const nx = s.x + ((tx - s.x) / d) * st, ny = s.y + ((ty - s.y) / d) * st; if (this.isWalkable(Math.floor(nx), Math.floor(ny))) { s.x = nx; s.y = ny; } s.angle = Math.atan2(ty - s.y, tx - s.x); }
        }
        continue;
      }
      if (s.mode === 'surrender') continue;
      let police: Responder | null = null, pd = 1e9;
      for (const r of this.responders.values()) {
        if (r.inVehicle || r.category !== 'police' || !this.roleDef(r).abilities.includes('arrest')) continue;
        const d = Math.hypot(r.x - s.x, r.y - s.y);
        if (d < pd) { pd = d; police = r; }
      }
      if (s.mode === 'idle' && s.runner && police && pd < 8) { s.mode = 'flee'; s.fleeT = this.rng.range(14, 24); s.path = []; }
      if (s.mode === 'flee') {
        s.fleeT -= dt;
        if (s.fleeT <= 0 || !police) { s.mode = 'idle'; s.runner = false; s.path = []; continue; } // out of breath
        if (!s.path.length && police) {
          const away = Math.atan2(s.y - police.y, s.x - police.x);
          for (let k = 0; k < 14 && !s.path.length; k++) {
            const a = away + this.rng.range(-1.0, 1.0), len = this.rng.range(8, 13);
            const tx = Math.floor(s.x + Math.cos(a) * len), ty = Math.floor(s.y + Math.sin(a) * len);
            if (!this.isWalkable(tx, ty)) continue;
            s.path = findPath(this.w, this.h, { x: Math.floor(s.x), y: Math.floor(s.y) }, { x: tx, y: ty }, this.isWalkable, { diagonal: true, maxNodes: 900 }) ?? [];
          }
        }
        this.stepAlong(s, s.path, 2.45, dt);
      }
    }
  }

  /** People do not stand inside each other: anybody closer than ~0.45 tile is eased apart (never onto a building or water tile). */
  private separateResponders(dt: number): void {
    const list: Responder[] = [];
    for (const r of this.responders.values()) if (!r.inVehicle) list.push(r);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > 0.45 || Math.abs(dy) > 0.45) continue;
      let d = Math.hypot(dx, dy);
      let ux: number, uy: number;
      if (d < 1e-3) { const ang = (a.id * 2.399963 + b.id) % (Math.PI * 2); ux = Math.cos(ang); uy = Math.sin(ang); d = 0; } else { ux = dx / d; uy = dy / d; }
      if (d >= 0.45) continue;
      const push = Math.min((0.45 - d) / 2, 1.5 * dt);
      for (const [r, sgn] of [[a, -1], [b, 1]] as [Responder, number][]) {
        if (r.carrying !== null) continue;
        const nx = r.x + ux * push * sgn, ny = r.y + uy * push * sgn;
        if (this.isWalkable(Math.floor(nx), Math.floor(ny))) { r.x = nx; r.y = ny; }
      }
    }
  }

  private updateResponder(r: Responder, dt: number): void {
    if (r.inVehicle) return;
    const t = r.task;
    const done = () => { r.task = null; r.path = []; r.aiming = null; };
    if (r.aiming !== null && r.task?.type !== 'arrest') r.aiming = null;
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
        const boardNow = () => { r.inVehicle = true; r.x = v.x; r.y = v.y; r.carrying = null; done(); };
        if (Math.hypot(r.x - v.x, r.y - v.y) <= 1.9) { boardNow(); break; }
        t.wait = (t.wait ?? 0) + dt;
        if (!r.path.length) {
          const ok = this.walkTo(r, (x, y) => this.isWalkable(x, y) && Math.hypot(x + 0.5 - v.x, y + 0.5 - v.y) <= 1.65);
          if (!ok) { if (t.wait > 1.5) boardNow(); break; } // no walking route (boxed in): hop in anyway rather than stay behind
        }
        this.stepAlong(r, r.path, role.speed, dt);
        if (t.wait > 12) boardNow(); // never leave anybody behind
        break;
      }
      case 'extinguish': case 'cool': {
        const b = this.buildings.get(t.buildingId);
        if (!b || b.destroyed || (t.type === 'extinguish' && b.fire <= 0) || (t.type === 'cool' && b.wet >= 100)) {
          if (b && t.type === 'cool' && !b.destroyed) this.emit({ type: 'info', message: `${b.name ?? 'Pand'} is gekoeld` });
          return done();
        }
        const inRange = rectDist(b, r.x, r.y) <= 2.6 && (!veh || dist(r, veh) <= HOSE_LENGTH);
        if (!inRange) {
          if (!r.path.length) {
            const ok = this.walkTo(r, (x, y) => this.isWalkable(x, y) && rectDist(b, x + 0.5, y + 0.5) <= 2.2 && (!veh || Math.hypot(x - veh.x, y - veh.y) <= HOSE_LENGTH - 1));
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
          if (t.type === 'cool') { b.wet = Math.min(100, b.wet + COOL_RATE * eff * bonus * dt); break; }
          b.fire = Math.max(0, b.fire - (role.power * bonus * eff * (this.commanderNear(r) ? COMMANDER_BONUS : 1) * FIRE_POWER_SCALE * dt) / b.resistance);
        }
        break;
      }
      case 'rescue': {
        const pv = this.victims.get(t.victimId);
        if (pv && pv.pinned && pv.transport === 'scene') { // cut free with the hydraulic rescue tools
          if (!veh || !this.vehicleDef(veh).equipment.includes('rescue_tools')) { this.emit({ type: 'warn', message: `${r.name}: hydraulisch gereedschap nodig – stuur de hulpverleningswagen` }); return done(); }
          if (this.approachSlot(r, pv.x, pv.y, done)) {
            t.progress += dt * (role.power >= 3 ? 1.4 : 1);
            if (t.progress >= 12 * sevFactor(this.incidents.get(pv.incidentId)?.severity ?? 1, 0.2)) { pv.pinned = false; this.emit({ type: 'info', message: `${pv.name} is bevrijd uit het voertuig` }); done(); }
          }
          break;
        }
        const v = pv;
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
        if (this.approachSlot(r, v.x, v.y, done)) {
          t.progress += dt * (role.power >= 2 ? 2 : 1) * (1 + 0.6 * this.helpers(v)) * (this.commanderNear(r) ? 1.2 : 1);
          if (t.progress >= v.treatTime) {
            v.treated = true; v.conscious = true; v.health = Math.min(100, v.health + 10);
            this.emit({ type: 'info', message: `${r.name} heeft een slachtoffer gestabiliseerd` });
            done();
          }
        }
        break;
      }
      case 'assist': {
        const v = this.victims.get(t.victimId);
        if (!v || (v.transport !== 'scene' && v.transport !== 'carried')) return done();
        // stay with the casualty: next to the one who is treating, or alongside the trolley while it is carried
        const carrier = v.transport === 'carried' && v.carriedBy !== null ? this.responders.get(v.carriedBy) : null;
        // alongside the trolley (foot end) while carried; otherwise right next to the casualty on a slot of their own
        const sa = (r.id * 2.399963) % (Math.PI * 2);
        const tx = carrier ? carrier.x + Math.cos(carrier.angle) * 2.3 : v.x + Math.cos(sa) * 0.6, ty = carrier ? carrier.y + Math.sin(carrier.angle) * 2.3 : v.y + Math.sin(sa) * 0.6;
        if (Math.hypot(r.x - tx, r.y - ty) > 0.9) { if (!r.path.length || carrier) this.walkTo(r, (x, y) => this.isWalkable(x, y) && Math.hypot(x + 0.5 - tx, y + 0.5 - ty) <= 0.9); this.stepAlong(r, r.path, role.speed * 1.15, dt); }
        else { r.path = []; r.angle = Math.atan2(v.y - r.y, v.x - r.x); }
        const busy = [...this.responders.values()].some(o => o !== r && (o.task?.type === 'treat' || o.task?.type === 'load') && (o.task as { victimId: number }).victimId === v.id);
        t.idle = busy ? 0 : t.idle + dt;
        if (t.idle > 10) { this.emit({ type: 'info', message: `${r.name} heeft niemand meer om te helpen` }); done(); }
        break;
      }
      case 'load': {
        const v = this.victims.get(t.victimId);
        if (v && v.transport === 'carried' && v.carriedBy !== r.id && v.carriedBy !== null && r.carrying === null) { // two paramedics: the second carries the foot end
          r.task = { type: 'assist', victimId: v.id, idle: 0 };
          break;
        }
        if (!v || (v.transport !== 'scene' && v.transport !== 'carried') || (v.transport === 'carried' && v.carriedBy !== r.id)) {
          if (r.carrying === t.victimId) r.carrying = null;
          return done();
        }
        if (v.pinned) { this.emit({ type: 'warn', message: `${v.name} zit nog bekneld: eerst bevrijden` }); return done(); }
        if (r.carrying === null) {
          if (this.approachSlot(r, v.x, v.y, done)) { v.transport = 'carried'; v.carriedBy = r.id; r.carrying = v.id; r.path = []; }
        } else if (veh) {
          v.x = r.x; v.y = r.y;
          if (this.approach(r, veh.x, veh.y, 2.6, () => { v.transport = 'scene'; v.carriedBy = null; r.carrying = null; v.loadT = 0; done(); })) {
            if (veh.patients.length >= this.vehicleDef(veh).patientCapacity) {
              this.emit({ type: 'warn', message: `${veh.name} zit vol` });
              v.transport = 'scene'; v.carriedBy = null; r.carrying = null; v.loadT = 0;
              done();
            } else {
              // the trolley is pushed to the rear doors and slid in over a couple of seconds
              r.angle = Math.atan2(veh.y - r.y, veh.x - r.x);
              v.loadT = Math.min(1, v.loadT + dt / 2.6);
              if (v.loadT >= 1) {
                v.transport = 'inAmbulance'; v.carriedBy = null; v.loadT = 0; veh.patients.push(v.id); r.carrying = null;
                this.emit({ type: 'info', message: `Slachtoffer geladen in ${veh.name}` });
                done();
              }
            }
          }
        }
        break;
      }
      case 'arrest': {
        const s = this.suspects.get(t.suspectId);
        if (!s || s.mode === 'boarded') return done();
        const sd = Math.hypot(r.x - s.x, r.y - s.y);
        if (s.arrested) { // escort the cuffed suspect to the police vehicle and put them in the back
          const veh = this.vehicles.get(r.vehicleId);
          if (!veh || (PRISONER_CAP[veh.defId] ?? 0) - veh.prisoners.length <= 0) { s.mode = 'idle'; s.escortedBy = null; return done(); }
          if (s.mode !== 'escorted') { if (this.approach(r, s.x, s.y, 1.3, done)) { s.mode = 'escorted'; s.escortedBy = r.id; } break; }
          if (this.approach(r, veh.x, veh.y, this.vehicleDef(veh).length / 2 + 0.9, done)) {
            veh.prisoners.push(s.id); s.mode = 'boarded'; s.vehicleId = veh.id; s.escortedBy = null;
            this.emit({ type: 'info', message: `Verdachte zit achterin ${veh.name} – stuur de wagen naar het bureau (Z)` });
            done();
          }
          break;
        }
        if (s.mode === 'flee') { // a runner: pistol up and shout, or chase
          r.angle = Math.atan2(s.y - r.y, s.x - r.x);
          if (sd <= 6.5) {
            if (r.aiming !== s.id) this.emit({ type: 'info', message: `${r.name}: "Politie! Blijf staan!"`, speech: 'Politie! Blijf staan!' });
            r.aiming = s.id; t.aim = (t.aim ?? 0) + dt;
            if (t.aim >= 1.6 && s.obey) { s.mode = 'surrender'; s.path = []; this.emit({ type: 'info', message: 'De verdachte geeft zich over' }); }
          } else r.aiming = null;
          if (!r.path.length || Math.hypot((t.lx ?? -99) - s.x, (t.ly ?? -99) - s.y) > 1.6) { r.path = []; t.lx = s.x; t.ly = s.y; }
          if (this.approach(r, s.x, s.y, 1.2, done)) { s.mode = 'surrender'; s.path = []; r.aiming = null; } // caught up and tackled
          break;
        }
        r.aiming = null;
        if (this.approach(r, s.x, s.y, 1.2, done)) {
          r.angle = Math.atan2(s.y - r.y, s.x - r.x);
          s.angle = r.angle + Math.PI;
          t.progress += dt;
          if (t.progress >= s.arrestTime) {
            s.arrested = true; s.mode = 'idle'; s.runner = false;
            this.emit({ type: 'info', message: `${r.name} heeft een verdachte gearresteerd` });
            t.progress = 0; r.path = []; // stays on the job: the suspect is walked to the vehicle
            const veh = this.vehicles.get(r.vehicleId);
            if (!veh || (PRISONER_CAP[veh.defId] ?? 0) - veh.prisoners.length <= 0) done();
          }
        }
        break;
      }
      case 'secure': {
        const inc = this.incidents.get(t.incidentId);
        if (!inc || inc.secured) return done();
        if (this.approach(r, inc.x, inc.y, 3, done)) {
          t.progress += dt;
          if (t.progress >= 5 * sevFactor(inc.severity, 0.25)) { inc.secured = true; this.rebuildCordon(); this.emit({ type: 'info', message: `Locatie afgezet: ${inc.name}; verkeer wordt omgeleid` }); done(); }
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
      case 'recon': {
        const inc = this.incidents.get(t.incidentId);
        const b = inc?.buildingId ? this.buildings.get(inc.buildingId) : null;
        if (!inc || !b || inc.scouted) return done();
        if (this.approach(r, b.door.x + 0.5, b.door.y + 0.5, 1.8, done)) {
          t.progress += dt;
          if (t.progress >= 6 * sevFactor(inc.severity, 0.2)) {
            inc.scouted = true;
            const inside = inc.victims.filter(id => this.victims.get(id)?.transport === 'trapped').length;
            const nothing = this.content.incidents[inc.defId].objectives.includes('scouted') && !this.content.incidents[inc.defId].victims && !this.content.incidents[inc.defId].fire;
            this.emit({ type: 'info', message: inside ? `Verkenning ${b.name ?? 'pand'}: nog ${inside} ${inside === 1 ? 'persoon' : 'personen'} binnen!` : nothing ? `Verkenning ${b.name ?? 'pand'}: situatie in kaart gebracht` : `Verkenning ${b.name ?? 'pand'}: niemand meer binnen`, speech: inside ? `Verkenning afgerond. Er zijn nog ${inside} ${inside === 1 ? 'persoon' : 'personen'} in het pand.` : nothing ? 'Verkenning afgerond. De situatie is in kaart gebracht.' : 'Verkenning afgerond. Er is niemand meer in het pand.' });
            done();
          }
        }
        break;
      }
      case 'collect': {
        const v = this.victims.get(t.victimId);
        if (!v || v.transport !== 'dead') return done();
        if (this.approach(r, v.x, v.y, 2.6, done)) {
          t.progress += dt;
          if (t.progress >= 5) {
            const hv = this.vehicles.get(r.vehicleId);
            if (hv && hv.patients.length < this.vehicleDef(hv).patientCapacity) { v.transport = 'collected'; hv.patients.push(v.id); this.emit({ type: 'info', message: `${r.name} heeft een overledene meegenomen` }); }
            done();
          }
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
            if (veh && this.vehicleDef(veh).id === 'tow_truck') veh.cargo = Math.min(2, veh.cargo + 1); // the wreck is on the flatbed
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
      if (o !== r && !o.inVehicle && this.roleDef(o).abilities.includes('coordinate') && dist(o, r) <= COMMANDER_RANGE + (this.grip > 0 ? 6 : 0)) return true; // a CoPI (GRIP) extends the command range
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

  /** The undertaker: a hearse is sent for every body, the crew collects it and takes it to the funeral home. */
  /** The GRIP structure is dissolved again a little while after the last incident has been handled. */
  private updateGrip(dt: number): void {
    if (this.grip === 0) return;
    if (this.mainIncident()) { this.gripIdle = 0; return; }
    this.gripIdle += dt;
    if (this.gripIdle > 25) { this.grip = 0; this.gripIdle = 0; this.emit({ type: 'info', message: 'Alle incidenten afgehandeld: GRIP-structuur opgeheven' }); }
  }

  private updateHearses(dt: number): void {
    void dt;
    for (const body of this.victims.values()) {
      if (body.transport !== 'dead' || body.hearse !== null) continue;
      const hearse = [...this.vehicles.values()].filter(v => this.vehicleDef(v).id === 'hearse' && !v.path.length && this.groundVehicle(v) && v.patients.length + [...this.victims.values()].filter(o => o.hearse === v.id && o.transport === 'dead').length < this.vehicleDef(v).patientCapacity)
        .sort((a, b) => Math.hypot(a.x - body.x, a.y - body.y) - Math.hypot(b.x - body.x, b.y - body.y))[0];
      if (!hearse) continue;
      body.hearse = hearse.id;
      hearse.returning = false; hearse.silent = true; hearse.prio = 1;
      this.driveNear(hearse, body.x, body.y);
      hearse.silent = true;
      this.emit({ type: 'info', message: `${hearse.name} rijdt naar de overledene (uitvaartdienst)` });
    }
    for (const v of this.vehicles.values()) {
      if (this.vehicleDef(v).id !== 'hearse') continue;
      const mine = [...this.victims.values()].filter(o => o.transport === 'dead' && o.hearse === v.id);
      if (mine.length && !v.path.length && this.groundVehicle(v) && v.state === 'idle') {
        const body = mine[0];
        if (Math.hypot(v.x - body.x, v.y - body.y) < 9) { // arrived: the undertakers get out and collect the body
          this.orderDismount([v.id]);
          let k = 0; // each undertaker takes a different body (also the crew that is already outside)
          for (const id of v.crew) { const r = this.responders.get(id)!; if (!r.inVehicle && !r.task) r.task = { type: 'collect', victimId: mine[k++ % mine.length].id, progress: 0 }; }
        } else if (v.crew.every(id => { const r = this.responders.get(id)!; return r.inVehicle || !r.task; })) {
          // the next body is further away than the hearse stands: get everybody back in and drive over
          if (!this.groundVehicle(v)) this.orderBoard([v.id]); else { v.silent = true; this.driveNear(v, body.x, body.y); v.silent = true; }
        }
      }
      const outside = v.crew.filter(id => this.responders.get(id)?.inVehicle === false);
      if (outside.length && !mine.length && outside.every(id => !this.responders.get(id)!.task)) { // done: back in and drive home
        this.orderBoard([v.id]);
        v.returning = true;
      }
    }
  }

  private updateHospital(): void {
    const hospitals = [...this.buildings.values()].filter(b => b.type === 'hospital');
    for (const v of this.vehicles.values()) {
      if (!v.patients.length || v.path.length) continue;
      const here = hospitals.find(h => rectDist(h, v.x, v.y) <= 6);
      if (!here) continue;
      if (this.bedsFree(here) < v.patients.length) { // full: wait for a bed, or drive on to a hospital with room
        const other = this.nearestHospital(v.x, v.y);
        if (other && other !== here && this.bedsFree(other) >= v.patients.length) this.routeVehicle(v, { x: other.door.x, y: other.door.y });
        continue;
      }
      const beds = this.hospitalBeds.get(here.id) ?? [];
      for (let i = 0; i < v.patients.length; i++) beds.push(this.time + World.BED_SECONDS);
      this.hospitalBeds.set(here.id, beds);
      for (const pid of v.patients) {
        const p = this.victims.get(pid);
        if (p) { p.transport = 'atHospital'; this.emit({ type: 'info', message: `Slachtoffer afgeleverd bij het ziekenhuis (${Math.round(p.health)}% gezondheid)` }); }
      }
      v.patients = [];
      if (v.category === 'ambulance') this.orderReturn([v.id]); // back to the station after handing over the patient
    }
  }

  // ---------- fire ----------
  private updateFire(dt: number): void {
    for (const b of this.buildings.values()) if (b.wet > 0) b.wet = Math.max(0, b.wet - (WET_DECAY + (b.fire / 100) * 4) * dt);
    for (const b of this.buildings.values()) {
      if (b.destroyed) { b.fire = Math.max(0, b.fire - 2 * dt); continue; }
      if (b.fire <= 0) continue;
      const inc = b.incidentId ? this.incidents.get(b.incidentId) : null;
      const sev = inc ? inc.severity : 1;
      b.fire = Math.min(100, b.fire + b.growth * (0.8 + 0.2 * sev) * (1 - 0.5 * b.wet / 100) * dt);
      b.damage += (b.fire / 100) * 0.85 * b.flammability * dt; // an unattended house takes minutes to burn down, not seconds
      if (b.damage >= 100) { b.damage = 100; b.destroyed = true; continue; }
      if (b.fire < 35) continue;
      for (const nb of this.buildings.values()) {
        if (nb === b || nb.destroyed || nb.fire > 0) continue;
        const gap = Math.hypot(Math.max(nb.x - (b.x + b.w), b.x - (nb.x + nb.w), 0), Math.max(nb.y - (b.y + b.h), b.y - (nb.y + nb.h), 0));
        if (gap > SPREAD_RANGE) continue;
        if (this.rng.chance(dt * 0.012 * b.spread * this.spreadFactor(b, nb, gap) * nb.flammability * (1 - 0.92 * nb.wet / 100))) this.igniteNeighbour(nb);
      }
    }
  }

  private tallWarned = new Set<string>();

  /** Weather: a deterministic rain shower now and then (everybody drives a little slower in it). */
  get raining(): boolean {
    const t = this.time / 160 + this.opts.seed * 0.37;
    return Math.sin(t) + 0.6 * Math.sin(t * 0.43 + 2) > 1.15;
  }

  /** A made-up casualty: Dutch first and last name and an age fitting the call. */
  randomPerson(): { name: string; age: number } {
    const first = ['Jan', 'Piet', 'Kees', 'Henk', 'Willem', 'Johan', 'Mohamed', 'Daan', 'Sem', 'Thomas', 'Maria', 'Anna', 'Sophie', 'Emma', 'Fatima', 'Lisa', 'Els', 'Ineke', 'Yara', 'Noor', 'Bram', 'Lars', 'Ruud', 'Sanne', 'Femke'];
    const last = ['de Vries', 'Jansen', 'van den Berg', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Dijk', 'Dekker', 'Brouwer', 'el Amrani', 'Yilmaz', 'Kuijpers'];
    return { name: `${this.rng.pick(first)} ${this.rng.pick(last)}`, age: this.rng.int(4, 88) };
  }

  /** The vehicle types the control room recommends for a call (also shown in the P2000 line). */
  recommendedUnits(inc: Incident): string[] {
    const def = this.content.incidents[inc.defId];
    const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null;
    const need = new Map<string, number>();
    const add = (id: string, n = 1) => { if (this.content.vehicles[id]) need.set(id, Math.max(need.get(id) ?? 0, n)); };
    const victims = inc.victims.length;
    const big = /high_rise|explosion|collapse|bus_crash|truck_collision/.test(inc.defId);
    for (const cat of def.requires) {
      if (cat === 'fire') {
        add('fire_engine', big ? 3 : inc.severity >= 3 && def.fire ? 2 : 1);
        if (b && (b.floors ?? 1) >= 4 && def.fire) add('aerial_ladder');
        if (def.victims?.location === 'trapped' || inc.victims.some(id => this.victims.get(id)?.pinned)) add('rescue_vehicle');
      }
      else if (cat === 'ambulance') add('ambulance', Math.min(6, Math.max(1, Math.ceil(victims / Math.max(1, this.content.vehicles.ambulance?.patientCapacity ?? 1)))));
      else if (cat === 'police') add('patrol_car', big ? 2 : 1);
      else if (cat === 'tech') add('tow_truck', /bus_crash|truck_collision/.test(inc.defId) ? 2 : 1);
    }
    if (inc.victims.some(id => this.victims.get(id)?.pinned)) { add('fire_engine'); add('rescue_vehicle'); }
    if (/hazmat|explosion|chemical/.test(inc.defId)) add('hazmat_unit');
    if (/high_rise|explosion|collapse/.test(inc.defId)) { add('ovd_car'); add('water_tanker'); }
    if (victims >= 4) add('lgh_car');
    if (inc.suspects.length >= 3 || /riot|demonstration/.test(inc.defId)) add('riot_van');
    if (/suspicious_package/.test(inc.defId)) add('bomb_squad');
    if ((def.obstacle?.mass ?? 0) >= 1.6) add('crane_truck');
    const out: string[] = [];
    for (const [id, n] of need) for (let k = 0; k < n; k++) out.push(id);
    return out;
  }

  /** First-aid instructions over the phone (as in the dispatcher games): the casualties of this call lose health more slowly until help arrives. */
  adviseCaller(incidentId: number): boolean {
    const inc = this.incidents.get(incidentId);
    if (!inc || inc.advised || !inc.victims.some(id => { const v = this.victims.get(id); return v && !v.treated && v.transport !== 'dead'; })) return false;
    inc.advised = true;
    for (const id of inc.victims) { const v = this.victims.get(id); if (v && !v.treated) v.decay *= 0.6; }
    this.emit({ type: 'info', message: `Instructies gegeven aan de melder (${inc.name}): reanimatie en stabiele zijligging`, speech: 'Blijf aan de lijn. Ik geef u instructies tot de hulpdiensten er zijn.' });
    return true;
  }

  /** Average time (s) between a call and the first unit on scene. */
  get averageResponse(): number { return this.responseTimes.length ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length : 0; }

  /** Send the recommended units (the nearest free vehicle of each type) to the call, with the priority of the pager line. */
  dispatchRecommended(incidentId: number): number {
    const inc = this.incidents.get(incidentId);
    if (!inc) return 0;
    const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null;
    const tx = b ? b.door.x + 0.5 : inc.x, ty = b ? b.door.y + 0.5 : inc.y;
    const prio: 1 | 2 = inc.severity >= 2 ? 1 : 2;
    let n = 0;
    const wanted = new Map<string, number>();
    for (const defId of inc.units) wanted.set(defId, (wanted.get(defId) ?? 0) + 1);
    for (const [defId, count] of wanted) {
      const have = [...this.vehicles.values()].filter(v => v.defId === defId && ((v.dest && Math.hypot(v.dest.x - tx, v.dest.y - ty) < 8) || (!v.path.length && !this.isParking(Math.floor(v.x), Math.floor(v.y)) && Math.hypot(v.x - tx, v.y - ty) < 9))).length;
      for (let k = have; k < count; k++) if (this.sendToScene(defId, tx, ty, prio, false)) n++;
    }
    inc.dispatched = true;
    this.emit({ type: n ? 'info' : 'warn', message: n ? `Uitgerukt voor ${inc.name}: ${n} eenheden (prio ${prio})` : 'Geen vrije eenheden beschikbaar' });
    return n;
  }

  /** GRIP (Gecoördineerde Regionale Incidentbestrijdings Procedure) level, 0 = none: 1 = CoPI, 2 = CoPI + ROT, 3 = + gemeentelijk beleidsteam, 4 = + regionaal beleidsteam. */
  grip = 0;
  private gripIdle = 0;
  static readonly GRIP_INFO = [
    'Geen opschaling',
    'GRIP 1: Commandoplaats Incident (CoPI) in het brongebied',
    'GRIP 2: CoPI en Regionaal Operationeel Team (bron- en effectgebied)',
    'GRIP 3: bestuurlijke betrokkenheid, gemeentelijk beleidsteam erbij',
    'GRIP 4: gemeentegrensoverschrijdend, regionaal beleidsteam erbij',
  ];
  private static readonly GRIP_UNITS: string[][] = [
    [],
    ['ovd_car', 'copi_unit', 'fire_engine', 'ambulance', 'patrol_car'],
    ['lgh_car', 'hazmat_unit', 'aerial_ladder', 'water_tanker', 'ambulance', 'fire_engine', 'riot_van', 'tow_truck'],
    ['mmt_car', 'rescue_vehicle', 'ambulance', 'patrol_car', 'patrol_car', 'hearse', 'police_van'],
    ['fire_engine', 'fire_engine', 'ambulance', 'ambulance', 'water_tanker', 'crane_truck', 'riot_van'],
  ];

  /** The incident the response is centred on: the most severe one (oldest first). */
  mainIncident(): Incident | null {
    let best: Incident | null = null;
    for (const i of this.incidents.values()) if (i.status === 'active' && (!best || i.severity > best.severity || (i.severity === best.severity && i.elapsed > best.elapsed))) best = i;
    return best;
  }

  /** Scale up (or down) to a GRIP level: each new level sends its associated units (command post, officers, specialists, extra engines and ambulances) to the main scene. */
  setGrip(level: number): boolean {
    level = Math.max(0, Math.min(4, Math.round(level)));
    if (level === this.grip) return false;
    const old = this.grip;
    if (level < old) {
      this.grip = level;
      // the units that came with the levels we drop are released: whoever is idle and not working on a casualty drives back to the station
      const release: number[] = [];
      for (let l = old; l > level; l--) for (const defId of World.GRIP_UNITS[l]) {
        const v = [...this.vehicles.values()].find(x => x.defId === defId && !release.includes(x.id) && !x.patrol && !x.returning && x.patients.length === 0 && !x.toHospital && Math.hypot(x.x - (x.home.x + 0.5), x.y - (x.home.y + 0.5)) > 3 && x.crew.every(id => { const r = this.responders.get(id)!; return r.inVehicle || !r.task; }));
        if (v) release.push(v.id);
      }
      if (release.length) this.orderReturn(release);
      this.emit({ type: 'info', message: (level ? `Afgeschaald naar ${World.GRIP_INFO[level]}` : 'Afgeschaald: GRIP-structuur opgeheven') + (release.length ? ` – ${release.length} eenheden keren terug naar de kazerne` : '') });
      return true;
    }
    const main = this.mainIncident();
    if (!main) { this.emit({ type: 'warn', message: 'Opschalen kan alleen bij een lopend incident' }); return false; }
    const cost = 300 * (level - old);
    if (this.budget < cost) { this.emit({ type: 'warn', message: `Onvoldoende middelen om op te schalen (€${cost})` }); return false; }
    this.budget -= cost;
    this.grip = level;
    this.gripIdle = 0;
    const b = main.buildingId ? this.buildings.get(main.buildingId) : null;
    const tx = b ? b.door.x + 0.5 : main.x, ty = b ? b.door.y + 0.5 : main.y;
    let sent = 0, k = 0;
    // the units leave one after the other (every ~2 s) so they do not all arrive and jam the scene at the same moment
    for (let l = old + 1; l <= level; l++) for (const defId of World.GRIP_UNITS[l]) {
      if (k === 0) { if (this.sendToScene(defId, tx, ty)) sent++; }
      else { this.pendingSends.push({ at: this.time + k * 2, defId, tx, ty }); sent++; }
      k++;
    }
    this.emit({ type: 'info', message: `Opgeschaald naar ${World.GRIP_INFO[level]} – ${sent} eenheden onderweg`, speech: `Opschaling. ${World.GRIP_INFO[level]}. ${sent} extra eenheden zijn onderweg naar ${main.address || 'de plaats van het incident'}.` });
    return true;
  }

  /** The nearest free vehicle of a type drives to a point (or one is called up at no charge). */
  private sendToScene(defId: string, tx: number, ty: number, prio: 1 | 2 = 1, buy = true): boolean {
    const busy = new Set<number>();
    for (const v of this.vehicles.values()) if (v.path.length && !v.patrol) busy.add(v.id);
    const free = [...this.vehicles.values()].filter(v => v.defId === defId && !busy.has(v.id) && this.groundVehicle(v) && v.crew.every(id => !this.responders.get(id)!.task) && !this.incidentNear(v.x, v.y, 5))
      .sort((a, c) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(c.x - tx, c.y - ty))[0];
    const v = free ?? (buy ? this.callReinforcement(defId, true) : null);
    if (!v) return false;
    v.patrol = false; v.returning = false; v.silent = false; v.prio = prio;
    return this.driveNear(v, tx, ty);
  }
  private junctionTimer = new Map<number, number>();
  private pendingSends: { at: number; defId: string; tx: number; ty: number }[] = [];

  /** How many responders (chosen by the player) are assisting next to this casualty: they speed up treatment (max 2). */
  helpers(v: { id: number; x: number; y: number }): number {
    let n = 0;
    for (const o of this.responders.values()) if (o.task?.type === 'assist' && o.task.victimId === v.id && Math.hypot(o.x - v.x, o.y - v.y) < 2.2) n++;
    return Math.min(2, n);
  }

  /** Is a burning building close enough to this one that it could catch fire? */
  threatened(b: Building): boolean {
    for (const o of this.buildings.values()) {
      if (o === b || o.fire <= 0 || o.destroyed) continue;
      const gap = Math.hypot(Math.max(b.x - (o.x + o.w), o.x - (b.x + b.w), 0), Math.max(b.y - (o.y + o.h), o.y - (b.y + b.h), 0));
      if (gap <= SPREAD_RANGE && this.spreadFactor(o, b, gap) > 0.05) return true;
    }
    return false;
  }

  /** Fire crews hose down the buildings that are threatened by a fire next door. */
  orderCoolFire(ids: number[]): number[] {
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
      if (this.orderAbility(outside, 'cool') === 0) this.emit({ type: 'warn', message: `${v.name}: geen pand dat gekoeld hoeft te worden` });
    }
    return out;
  }

  /** Backup (like the LA mod): the commander or an officer calls the nearest free vehicle of a type to the scene; it only costs money when none is free. */
  callBackup(callerId: number, defId: string): Vehicle | null {
    const caller = this.vehicleOf(callerId);
    if (!caller || !this.vehicleDef(caller).callable?.includes(defId)) return null;
    const free = [...this.vehicles.values()].filter(v => v.defId === defId && v.id !== caller.id && !v.path.length && this.groundVehicle(v) && v.crew.every(id => !this.responders.get(id)!.task) && ![...this.victims.values()].some(o => o.hearse === v.id))
      .filter(v => !this.incidentNear(v.x, v.y, 6) || v.patrol)
      .sort((a, b) => Math.hypot(a.x - caller.x, a.y - caller.y) - Math.hypot(b.x - caller.x, b.y - caller.y))[0];
    let v: Vehicle | null = free ?? null;
    if (!v) { v = this.callReinforcement(defId); if (!v) return null; }
    v.patrol = false; v.returning = false; v.silent = false;
    if (this.driveNear(v, caller.x, caller.y)) this.emit({ type: 'info', message: `${caller.name} roept ${v.name} op als versterking` });
    return v;
  }

  // ---------- patrols ----------
  private _patrolRoutes: Vec[][] | null = null;
  /** Three fixed city loops through the junctions (outer ring, inner ring, a snake through the middle rows). */
  get patrolRoutes(): Vec[][] {
    if (this._patrolRoutes) return this._patrolRoutes;
    const nodes: Vec[] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.isIntersection(x, y) && !this.isIntersection(x - 1, y) && !this.isIntersection(x, y - 1)) nodes.push({ x, y });
    const cx = this.w / 2, cy = this.h / 2;
    const norm = (n: Vec) => Math.max(Math.abs(n.x - cx) / cx, Math.abs(n.y - cy) / cy);
    const ang = (n: Vec) => Math.atan2(n.y - cy, n.x - cx);
    const ring = (lo: number, hi: number) => nodes.filter(n => norm(n) >= lo && norm(n) < hi).sort((a, b) => ang(a) - ang(b));
    const rows = [...new Set(nodes.map(n => n.y))].sort((a, b) => a - b);
    const mid = rows.slice(Math.floor(rows.length / 3), Math.ceil((rows.length * 2) / 3));
    const snake: Vec[] = [];
    mid.forEach((ry, i) => { const row = nodes.filter(n => n.y === ry).sort((a, b) => (i % 2 ? b.x - a.x : a.x - b.x)); snake.push(...row.filter((_, k) => k % 2 === 0)); });
    this._patrolRoutes = [ring(0.78, 2), ring(0.3, 0.78), snake].filter(r => r.length >= 3);
    return this._patrolRoutes;
  }

  /** Send vehicles on patrol: they drive a route through the city without sirens until given another order or called out. */
  orderPatrol(ids: number[]): number {
    const done = new Set<number>();
    for (const id of ids) {
      const v = this.vehicleOf(id);
      if (!v || done.has(v.id) || !this.vehicleDef(v).canPatrol) continue;
      const routes = this.patrolRoutes;
      if (!routes.length) continue;
      done.add(v.id);
      const near = (r: Vec[]) => Math.min(...r.map(n => Math.hypot(n.x - v.x, n.y - v.y)));
      let route = routes.reduce((a, b) => (near(a) <= near(b) ? a : b));
      if (this.rng.chance(0.5)) route = [...route].reverse();
      v.patrolRoute = route;
      v.patrolIdx = route.reduce((best, n, i) => (Math.hypot(n.x - v.x, n.y - v.y) < Math.hypot(route[best].x - v.x, route[best].y - v.y) ? i : best), 0);
      v.patrol = true; v.silent = true; v.returning = false; v.toHospital = false; v.path = []; v.dest = null;
      if (!this.groundVehicle(v)) this.orderBoard([v.id]);
      this.emit({ type: 'info', message: `${v.name} gaat op patrouille` });
    }
    return done.size;
  }

  /** The nearest patrolling vehicle of a service rushes to a new incident. */
  private dispatchPatrols(inc: Incident, def: IncidentDef, b: Building | null): void {
    const tx = b ? b.door.x + 0.5 : inc.x, ty = b ? b.door.y + 0.5 : inc.y;
    for (const cat of def.requires) {
      let best: Vehicle | null = null, bd = Infinity;
      for (const v of this.vehicles.values()) {
        if (!v.patrol || v.category !== cat || !this.groundVehicle(v)) continue;
        const d = Math.hypot(v.x - tx, v.y - ty);
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) continue;
      best.patrol = false; best.silent = false; best.returning = false;
      if (this.driveNear(best, tx, ty)) this.emit({ type: 'info', message: `Patrouille ${best.name} rukt uit naar ${inc.name}` });
    }
  }

  /** The incident (if any) whose scene a point is at: within `radius` tiles of the building or the incident spot. */
  incidentNear(x: number, y: number, radius: number): Incident | null {
    let best: Incident | null = null, bd = Infinity;
    for (const inc of this.incidents.values()) {
      const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null;
      const d = b ? rectDist(b, x, y) : Math.hypot(inc.x - x, inc.y - y);
      if (d <= radius && d < bd) { bd = d; best = inc; }
    }
    return best;
  }

  /** What a vehicle is doing, in words: 'Ter plaatse bij ...', 'Aanrijdend naar ...', 'Onderweg naar kazerne', ... */
  vehicleStatus(v: Vehicle): string {
    const homeD = (x: number, y: number) => Math.hypot(v.home.x + 0.5 - x, v.home.y + 0.5 - y);
    if (v.patrol) return 'Patrouilleert';
    if (v.state === 'moving') {
      const d = v.dest ?? v.path[v.path.length - 1] ?? null;
      const dx = d ? d.x + 0.5 : v.x, dy = d ? d.y + 0.5 : v.y;
      if (v.silent || (d && homeD(dx, dy) < 2.2)) return 'Onderweg naar de kazerne';
      if (v.patients.length || this.nearestHospital(dx, dy) && this.hospitalDistance(dx, dy) < 6) return 'Rijdt naar het ziekenhuis';
      const inc = this.incidentNear(dx, dy, 6);
      if (inc) return `Aanrijdend naar ${inc.name}`;
      return 'Onderweg';
    }
    const inc = this.incidentNear(v.x, v.y, 6);
    if (inc) return `Ter plaatse bij ${inc.name}`;
    if (homeD(v.x, v.y) < 1.5) return 'Gereed in de kazerne';
    return 'Staat stil';
  }

  private hospitalDistance(x: number, y: number): number {
    const h = this.nearestHospital(x, y);
    return h ? Math.hypot(h.door.x + 0.5 - x, h.door.y + 0.5 - y) : Infinity;
  }
  /** Road tiles closed to civilian cars around secured incidents (emergency vehicles may still pass). */
  cordon = new Set<number>();
  /** Explosions that happened (for the renderer): id, position, time in game seconds. */
  explosions: { id: number; x: number; y: number; time: number }[] = [];

  /** Recompute the closed road tiles; civilians re-route on their own when their path is blocked. */
  rebuildCordon(): void {
    const next = new Set<number>();
    for (const inc of this.incidents.values()) {
      if (!inc.secured || inc.status !== 'active') continue;
      const r = Math.ceil(CORDON_RADIUS);
      for (let y = Math.floor(inc.y) - r; y <= Math.floor(inc.y) + r; y++) for (let x = Math.floor(inc.x) - r; x <= Math.floor(inc.x) + r; x++) {
        if (this.isRoad(x, y) && Math.hypot(x + 0.5 - inc.x, y + 0.5 - inc.y) <= CORDON_RADIUS) next.add(key(x, y));
      }
    }
    this.cordon = next;
  }

  /** May this civilian car enter the tile? Cars that are already inside a cordon may leave through it. */
  private civCanEnter(c: Civilian, x: number, y: number): boolean {
    if (!this.isCivDrivable(x, y)) return false;
    return !this.cordon.has(key(x, y)) || this.cordon.has(key(Math.floor(c.x), Math.floor(c.y)));
  }

  /** The device went off: damage, a fire, and the people who were still standing around are hurt. */
  private explode(inc: Incident, b: Building | null, crowd: { x: number; y: number }[]): void {
    this.explosions.push({ id: this.newId(), x: inc.x, y: inc.y, time: this.time });
    this.emit({ type: 'explosion', x: inc.x, y: inc.y, message: `Explosie bij ${b?.name ?? 'de melding'}! De lading is afgegaan` });
    if (!b || b.destroyed) return;
    b.damage = Math.min(99, b.damage + 35);
    const def = Object.values(this.content.incidents).find(d => d.fire && d.spawn.on === 'building' && d.spawn.buildingTypes?.includes(b.type)) ?? Object.values(this.content.incidents).find(d => d.fire);
    const fire = def && !b.incidentId ? this.spawnIncident(def.id, { buildingId: b.id, severity: 2, startFire: 35 }) : null;
    if (!fire) return;
    for (const p of crowd.slice(0, 4)) {
      const v: Victim = {
        kind: 'victim', ...this.addEntityBase(p.x, p.y), incidentId: fire.id, health: this.rng.range(25, 55), conscious: true, treated: false, transport: 'scene',
        decay: 0.6, buildingId: null, carriedBy: null, treatTime: 10, condition: 'Gewond door de explosie', loadT: 0, hearse: null, pinned: false, ...this.randomPerson(),
      };
      this.victims.set(v.id, v);
      fire.victims.push(v.id);
    }
    for (const r of this.responders.values()) if (!r.inVehicle && Math.hypot(r.x - inc.x, r.y - inc.y) < 4) { r.task = null; r.path = []; } // shaken crews stop what they were doing
  }
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
      if ((t?.type !== 'extinguish' && t?.type !== 'cool') || t.buildingId !== buildingId || t.deploy < DEPLOY_TIME) continue;
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
      if (!near && v.water < def.tank && def.id !== 'water_tanker' && !v.path.length) { // a water tanker nearby supplies the tank
        const src = [...this.vehicles.values()].find(o => o !== v && this.vehicleDef(o).id === 'water_tanker' && !o.path.length && o.water > 0 && Math.hypot(o.x - v.x, o.y - v.y) < 5);
        if (src) { const take = Math.min(src.water, 160 * dt, def.tank - v.water); src.water -= take; v.water += take; v.hydrant = false; }
      }
    }
  }

  /**
   * How easily the fire of `b` reaches `nb` over a gap of `gap` tiles: nearly full strength next door, weaker over a street,
   * stronger downwind, and across a street only from a fully developed fire (heat radiation and flying sparks).
   */
  spreadFactor(b: Building, nb: Building, gap: number): number {
    const k = b.fire / 100;
    if (gap > 2.5 && b.fire < 55) return 0;
    const reach = Math.max(0, 1 - gap / SPREAD_RANGE);
    const dx = nb.x + nb.w / 2 - (b.x + b.w / 2), dy = nb.y + nb.h / 2 - (b.y + b.h / 2), len = Math.hypot(dx, dy) || 1;
    const down = (dx / len) * this.wind.x + (dy / len) * this.wind.y; // -1 upwind .. 1 downwind
    return k * (gap <= 2.5 ? 1 : reach * reach * 1.4) * (1 + 0.7 * down);
  }

  /** Wind direction (unit vector) and strength 0.5..1, fixed per game from the seed; smoke and sparks lean this way. */
  wind!: { x: number; y: number; strength: number };

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
    if (v.transport === 'dead' || v.transport === 'atHospital' || v.transport === 'collected') return;
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
    // anti-repeat: recently seen kinds and the category of the previous call are less likely, so the calls keep varying
    const last = this.recentDefs[this.recentDefs.length - 1];
    const lastCat = last ? this.content.incidents[last]?.category : null;
    const rain = this.raining; // weather-driven calls: slippery roads and storm damage come with the rain, and are rare otherwise
    const wt = (x: IncidentDef) => x.weight * (this.recentDefs.includes(x.id) ? 0.12 : 1) * (x.category === lastCat ? 0.6 : 1) * (/^(ice_pileup_collision|storm_debris)$/.test(x.id) ? (rain ? 4 : 0.15) : 1);
    const total = defs.reduce((s, x) => s + wt(x), 0);
    if (total <= 0) return;
    let roll = this.rng.next() * total;
    for (const def of defs) {
      roll -= wt(def);
      if (roll <= 0) { if (this.spawnIncident(def.id)) { this.recentDefs.push(def.id); if (this.recentDefs.length > 6) this.recentDefs.shift(); } return; }
    }
  }
  private recentDefs: string[] = [];

  /** A street address for a point: the nearest street (stable per street line) and a house number by position and side. */
  addressOf(x: number, y: number, onRoad = false): string {
    let rx = -1, ry = -1, bd = Infinity;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    for (let j = y0 - 8; j <= y0 + 8; j++) for (let i = x0 - 8; i <= x0 + 8; i++) {
      if (!this.isRoad(i, j)) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
      if (d < bd) { bd = d; rx = i; ry = j; }
    }
    if (rx < 0) return 'Rendam';
    const hz = this.isRoad(rx - 1, ry) && this.isRoad(rx + 1, ry), vt = this.isRoad(rx, ry - 1) && this.isRoad(rx, ry + 1);
    const horizontal = hz && (!vt || Math.abs(x - rx) >= Math.abs(y - ry));
    const line = horizontal ? (this.isRoad(rx, ry - 1) ? ry - 1 : ry) : (this.isRoad(rx - 1, ry) ? rx - 1 : rx);
    const name = STREET_NAMES[tileHash(line, horizontal ? 11 : 23) % STREET_NAMES.length];
    const along = horizontal ? x : y;
    const sideOdd = horizontal ? y < line + 1 : x < line + 1;
    const num = Math.floor(along / 2) * 2 + (sideOdd ? 1 : 2);
    return onRoad ? `${name}, ter hoogte van ${num}` : `${name} ${num}`;
  }

  /** Create an incident. Returns null when no suitable location exists. */
  spawnIncident(defId: string, o: { buildingId?: string; severity?: number; at?: Vec; startFire?: number } = {}): Incident | null {
    const def = this.content.incidents[defId];
    if (!def) throw new Error(`Onbekende incidentdefinitie: ${defId}`);
    const sev = Math.max(1, Math.min(3, o.severity ?? this.rng.int(def.severity.min, def.severity.max)));
    const scale = DIFFICULTY[this.opts.difficulty].timeScale;
    const inc: Incident = {
      id: this.newId(), defId, name: def.name, severity: sev, description: def.descriptions?.length ? this.rng.pick(def.descriptions) : '', x: 0, y: 0, buildingId: null, elapsed: 0,
      nextEscalation: def.escalation.everySec * scale, status: 'active', secured: false, obstacle: [], victims: [], suspects: [], bystanders: [], deaths: 0, cleared: false, defused: false, address: '', scouted: false, pager: '', units: [], dispatched: false, advised: false, arrivedAt: null,
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
          treatTime: (def.victims.treatTime ?? 6) * sevFactor(sev), condition: def.victims.condition ?? 'Gewond', loadT: 0, hearse: null,
          pinned: !trapped && !!def.victims.pinnedChance && this.rng.chance(def.victims.pinnedChance * (0.4 + 0.3 * sev)), ...this.randomPerson(),
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
    this.dispatchPatrols(inc, def, b);
    inc.address = this.addressOf(b ? b.door.x + 0.5 : inc.x, b ? b.door.y + 0.5 : inc.y, !b);
    const prio = inc.severity >= 3 ? 'Prioriteit 1, spoed' : inc.severity === 2 ? 'Prioriteit 2' : 'Prioriteit 3';
    // P2000 pager line: ambulance A1 (urgent) / A2, fire and police with a priority (1 = lights and sirens)
    inc.units = this.recommendedUnits(inc);
    const abbr: Record<string, string> = { fire_engine: 'TS', aerial_ladder: 'HV', rescue_vehicle: 'HW', ambulance: 'AMB', patrol_car: 'PAT', tow_truck: 'BER', police_van: 'BUS', riot_van: 'ME', hazmat_unit: 'OGS', water_tanker: 'WTW', ovd_car: 'OvD', lgh_car: 'LGH', crane_truck: 'KRAAN', bomb_squad: 'EOD', mmt_car: 'MMT' };
    const urgent = inc.severity >= 2;
    inc.pager = def.category === 'ambulance' ? `${urgent ? 'A1' : 'A2'} Rendam ${inc.address} ${inc.name}`
      : def.category === 'fire' ? `Prio ${urgent ? 1 : 2} BRW Rendam ${inc.address} ${inc.name}`
      : def.category === 'police' ? `Prio ${urgent ? 1 : 2} POL Rendam ${inc.address} ${inc.name}`
      : `Prio ${urgent ? 1 : 2} TECH Rendam ${inc.address} ${inc.name}`;
    inc.pager += ` ${inc.units.map(u => abbr[u] ?? u).join(' ')}`;
    this.emit({ type: 'incident_started', incidentId: inc.id, message: `📟 ${inc.pager}`, speech: `Meldkamer. ${inc.name}. ${inc.description ? inc.description + '. ' : ''}Adres: ${inc.address}. ${prio}.` });
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
      const s: Suspect = { kind: 'suspect', ...this.addEntityBase(pos.x, pos.y), incidentId: inc.id, arrested: false, arrestTime, angle: 0, path: [], mode: 'idle', runner: this.rng.chance(0.55), obey: this.rng.chance(0.65), fleeT: 0, escortedBy: null, vehicleId: null };
      this.suspects.set(s.id, s);
      inc.suspects.push(s.id);
    }
  }

  private objectivesMet(inc: Incident, def: IncidentDef): boolean {
    return def.objectives.every(o => {
      switch (o) {
        case 'fire_out': { const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null; return !!b && b.fire <= 0 && !b.destroyed; }
        case 'victims_safe': return inc.victims.every(id => { const v = this.victims.get(id); return !v || v.transport === 'atHospital' || v.transport === 'collected' || (v.transport === 'dead' && v.hearse !== null); }); // the dead are safe once the undertaker is on the way (he collects them even after the call is closed)
        case 'suspects_arrested': return inc.suspects.every(id => this.suspects.get(id)?.arrested ?? true);
        case 'area_secured': return inc.secured;
        case 'obstacle_cleared': return inc.cleared;
        case 'bystanders_dispersed': return inc.bystanders.every(id => this.bystanders.get(id)?.leaving !== false);
        case 'device_defused': return inc.defused;
        case 'scouted': return inc.scouted;
      }
    });
  }

  /** Response times of every call that got a unit on scene (for the duty report). */
  responseTimes: number[] = [];
  falseAlarms = 0;

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
    if (inc.arrivedAt === null && !def.ignorable) {
      const door = inc.buildingId ? this.buildings.get(inc.buildingId)?.door : null;
      const px = door ? door.x + 0.5 : inc.x, py = door ? door.y + 0.5 : inc.y;
      for (const v of this.vehicles.values()) if (!this.isParking(Math.floor(v.x), Math.floor(v.y)) && Math.hypot(v.x - px, v.y - py) < 10) { inc.arrivedAt = inc.elapsed; this.responseTimes.push(inc.elapsed); break; }
    }
    if (def.ignorable) { // a prank or false alarm: it ends by itself, but sending somebody to look costs money
      const visited = [...this.vehicles.values()].some(v => v.state === 'idle' && !this.isParking(Math.floor(v.x), Math.floor(v.y)) && Math.hypot(v.x - inc.x, v.y - inc.y) < 9);
      if (visited || inc.elapsed >= def.failAfterSec * scale) {
        this.falseAlarms++;
        if (visited) { this.budget -= 120; this.emit({ type: 'info', message: `${inc.name}: valse melding, onnodige uitruk (-€120)` }); }
        return this.endIncident(inc, 'resolved', visited ? 'Valse melding gecontroleerd' : 'Valse melding genegeerd');
      }
      return;
    }
    if (b?.destroyed && def.fire) return this.endIncident(inc, 'failed', 'Het pand is verloren gegaan');
    if (inc.elapsed >= def.failAfterSec * scale) {
      if (def.objectives.includes('device_defused') && !inc.defused) {
        const crowd = inc.bystanders.map(id => this.bystanders.get(id)).filter((x): x is Bystander => !!x && !x.leaving).map(x => ({ x: x.x, y: x.y }));
        this.endIncident(inc, 'failed', 'de explosieve lading is afgegaan');
        this.explode(inc, b ?? null, crowd);
        return;
      }
      return this.endIncident(inc, 'failed', 'Te laat gereageerd');
    }
    if (this.objectivesMet(inc, def)) this.endIncident(inc, 'resolved', 'Afgerond');
  }

  private endIncident(inc: Incident, status: 'resolved' | 'failed', why: string): void {
    const def = this.content.incidents[inc.defId];
    inc.status = status;
    if (status === 'resolved') {
      const t = Math.max(0, 1 - inc.elapsed / (def.failAfterSec * DIFFICULTY[this.opts.difficulty].timeScale));
      const pts = Math.round(def.reward.score * (0.6 + 0.4 * t) * (1 + (inc.severity - 1) * 0.25) * (1 + 0.08 * this.grip));
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
    this.rebuildCordon();
    for (const id of inc.victims) {
      const v = this.victims.get(id);
      if (!v) continue;
      if (v.transport !== 'atHospital' && v.transport !== 'dead' && v.transport !== 'collected' && status === 'failed') { this.deaths++; this.score -= 80; }
      for (const veh of this.vehicles.values()) veh.patients = veh.patients.filter(p => p !== id);
      for (const r of this.responders.values()) { if (r.carrying === id) { r.carrying = null; r.task = null; } }
      if (v.transport === 'dead' && this.vehicles.size && [...this.vehicles.values()].some(x => x.defId === 'hearse')) continue; // the undertaker still comes for the deceased after the call is closed
      this.victims.delete(id);
    }
    for (const id of inc.suspects) if (this.suspects.get(id)?.mode !== 'boarded') this.suspects.delete(id); // the ones in a police vehicle are still on their way to the station
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

  orderMove(ids: number[], x: number, y: number, prio: 1 | 2 = 1): void {
    for (const id of ids) {
      const v = this.vehicles.get(id);
      if (v) {
        v.prio = prio;
        if (!this.groundVehicle(v)) { this.emit({ type: 'warn', message: `${v.name}: bemanning staat nog buiten het voertuig` }); continue; }
        v.returning = false;
        v.silent = false;
        v.patrol = false;
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
      if (v) { v.path = []; v.dest = null; v.returning = false; v.toHospital = false; v.patrol = false; v.silent = false; }
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
      if (v && (PRISONER_CAP[v.defId] ?? 0) > 0 && v.prisoners.length && !done.has(v.id)) { done.add(v.id); this.orderReturn([v.id]); this.emit({ type: 'info', message: `${v.name} rijdt met ${v.prisoners.length} aangehouden verdachte(n) naar het bureau` }); continue; }
      if (!v || done.has(v.id) || this.vehicleDef(v).patientCapacity <= 0) continue;
      done.add(v.id);
      if (!v.patients.length) { this.emit({ type: 'warn', message: `${v.name}: geen patiënt aan boord` }); done.delete(v.id); continue; }
      v.returning = false;
      v.patrol = false;
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
      v.patrol = false;
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
  findTarget(r: Responder, ability: Ability, taken: Map<string, number> = new Map()): OrderTarget | null {
    let best: OrderTarget | null = null, bd = Infinity;
    // personnel spreads over the targets: every colleague already on a target adds a penalty
    const consider = (t: OrderTarget, d: number) => { const dd = d + 7 * (taken.get(`${t.kind}:${t.id}`) ?? 0); if (dd < bd) { bd = dd; best = t; } };
    switch (ability) {
      case 'extinguish': for (const b of this.buildings.values()) if (b.fire > 0 && !b.destroyed) consider({ kind: 'building', id: b.id }, rectDist(b, r.x, r.y)); break;
      case 'cool': for (const b of this.buildings.values()) if (b.fire <= 0 && !b.destroyed && b.wet < 60 && this.threatened(b)) consider({ kind: 'building', id: b.id }, rectDist(b, r.x, r.y)); break;
      case 'rescue': for (const v of this.victims.values()) if ((v.transport === 'trapped' && this.incidents.get(v.incidentId)?.scouted) || (v.pinned && v.transport === 'scene')) consider({ kind: 'victim', id: v.id }, dist(r, v)); break;
      case 'recon': for (const i of this.incidents.values()) { const d0 = this.content.incidents[i.defId]; if (i.buildingId && !i.scouted && (d0.victims?.location === 'trapped' || d0.objectives.includes('scouted'))) consider({ kind: 'incident', id: i.id }, dist(r, i)); } break;
      case 'collect': for (const v of this.victims.values()) if (v.transport === 'dead') consider({ kind: 'victim', id: v.id }, dist(r, v)); break;
      case 'treat': for (const v of this.victims.values()) if (v.transport === 'scene' && !v.treated) consider({ kind: 'victim', id: v.id }, dist(r, v)); break;
      case 'assist': for (const v of this.victims.values()) if (v.transport === 'scene' || v.transport === 'carried') consider({ kind: 'victim', id: v.id }, dist(r, v) - (v.treated ? 0 : 3)); break;
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
  /** Who is already working on what (keys like 'victim:12'), so a button press spreads the crew instead of sending everybody to one person. */
  private assignments(ability: Ability): Map<string, number> {
    const m = new Map<string, number>();
    const add = (k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const r of this.responders.values()) {
      const t = r.task;
      if (!t) continue;
      if (ability === 'treat' && t.type === 'treat') add(`victim:${t.victimId}`);
      else if (ability === 'carry' && t.type === 'load') add(`victim:${t.victimId}`);
      else if (ability === 'rescue' && t.type === 'rescue') add(`victim:${t.victimId}`);
      else if (ability === 'collect' && t.type === 'collect') add(`victim:${t.victimId}`);
      else if (ability === 'arrest' && t.type === 'arrest') add(`suspect:${t.suspectId}`);
      else if (ability === 'extinguish' && t.type === 'extinguish') add(`building:${t.buildingId}`);
      else if (ability === 'cool' && t.type === 'cool') add(`building:${t.buildingId}`);
      else if (ability === 'recon' && t.type === 'recon') add(`incident:${t.incidentId}`);
    }
    return m;
  }

  orderAbility(ids: number[], ability: Ability, target?: OrderTarget): number {
    let n = 0;
    const taken = target ? new Map<string, number>() : this.assignments(ability);
    for (const id of ids) {
      const r = this.responders.get(id);
      if (!r || r.inVehicle) continue;
      if (!this.roleDef(r).abilities.includes(ability)) continue;
      const missing = this.equipmentMissing(r, ability);
      if (missing) { this.emit({ type: 'warn', message: `${r.name} mist uitrusting: ${missing}` }); continue; }
      if (ability === 'carry' && this.vehicleDef(this.vehicles.get(r.vehicleId)!).patientCapacity <= 0) { this.emit({ type: 'warn', message: `${r.name}: voertuig kan geen patiënten vervoeren` }); continue; }
      const t = target ?? this.findTarget(r, ability, taken);
      if (!t) continue;
      const task = this.makeTask(ability, t);
      if (!task) continue;
      if (r.carrying !== null && task.type !== 'load') continue;
      r.task = task; r.path = [];
      if (!target) taken.set(`${t.kind}:${t.id}`, (taken.get(`${t.kind}:${t.id}`) ?? 0) + 1);
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
      case 'cool': return t.kind === 'building' ? { type: 'cool', buildingId: t.id, deploy: 0 } : null;
      case 'assist': return t.kind === 'victim' ? { type: 'assist', victimId: t.id, idle: 0 } : null;
      case 'recon': return t.kind === 'incident' ? { type: 'recon', incidentId: t.id, progress: 0 } : null;
      case 'collect': return t.kind === 'victim' ? { type: 'collect', victimId: t.id, progress: 0 } : null;
      case 'defuse': return t.kind === 'incident' ? { type: 'defuse', incidentId: t.id, progress: 0 } : null;
      default: return null;
    }
  }

  /** What is under a world position (in tile units)? */
  pick(x: number, y: number): OrderTarget | null {
    for (const v of this.victims.values()) if (v.transport === 'trapped' ? false : (v.transport === 'scene' && Math.hypot(v.x - x, v.y - y) < 0.9)) return { kind: 'victim', id: v.id };
    for (const s of this.suspects.values()) if (s.mode !== 'boarded' && Math.hypot(s.x - x, s.y - y) < 0.9) return { kind: 'suspect', id: s.id };
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
  contextOrder(ids: number[], x: number, y: number, prio: 1 | 2 = 1): void {
    const target = this.pick(x, y);
    const vehicleIds = ids.filter(id => this.vehicles.has(id));
    const respIds = ids.filter(id => this.responders.has(id));
    if (vehicleIds.length) {
      const tgt = this.targetPoint(target, x, y);
      this.orderMove(vehicleIds, tgt.x, tgt.y, prio);
    }
    for (const id of respIds) {
      const r = this.responders.get(id)!;
      if (r.inVehicle) continue;
      let ability: Ability | null = null;
      if (target?.kind === 'building') ability = (this.buildings.get(target.id)?.fire ?? 0) > 0 ? 'extinguish' : this.roleDef(r).abilities.includes('cool') ? 'cool' : 'extinguish';
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
        if (v.transport === 'trapped' || v.pinned) ability = 'rescue';
        else if (v.treated && abil.includes('carry')) ability = 'carry';
        else if (abil.includes('treat')) ability = 'treat';
        else if (abil.includes('carry')) ability = 'carry';
        else ability = 'assist'; // anyone else: help the paramedic (the player chooses who)
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
      const roll = this.rng.next(), type: Civilian['type'] = roll < 0.16 ? 'bike' : roll < 0.26 ? 'van' : 'car';
      this.civilians.push({
        kind: 'civilian', ...this.addEntityBase(r.x + 0.5, r.y + 0.5), path: [], angle: this.laneAngle(r.x, r.y), color: this.rng.int(0, 5), wait: this.rng.range(0, 3), stuck: 0,
        speed: type === 'bike' ? this.rng.range(1.5, 2.1) : type === 'van' ? this.rng.range(2.9, 3.7) : this.rng.range(3.2, 4.2),
        v: 0, type, len: type === 'bike' ? 0.55 : type === 'van' ? 1.7 : CAR_LEN, hw: type === 'bike' ? 0.17 : CAR_HW, braking: false, signal: 0, avoidTile: -1, avoidUntil: 0, passUntil: 0,
      });
    }
    const walk: Vec[] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.tiles[y * this.w + x] === TILE_GRASS) walk.push({ x, y });
    for (let i = 0; i < Math.round(cars * 0.9) && walk.length; i++) {
      const t = this.rng.pick(walk);
      this.pedestrians.push({ kind: 'pedestrian', ...this.addEntityBase(t.x + 0.5, t.y + 0.5), path: [], angle: 0, color: this.rng.int(0, 5), speed: this.rng.range(0.9, 1.5) });
    }
  }

  /** Cars that got in the way of an emergency vehicle pull away: put them on a quiet road tile far from the action. */
  /** The direction of travel of a lane tile (0 for a junction). */
  laneAngle(x: number, y: number): number {
    const l = this.laneAt(x, y);
    return l ? Math.atan2(l.y, l.x) : 0;
  }

  /** A stationary car straightens up along its lane (nobody stands across the road). */
  private alignCivilian(c: Civilian, dt: number): void {
    const tx = Math.floor(c.x), ty = Math.floor(c.y);
    const l = this.laneAt(tx, ty);
    if (!l) return;
    const axis = Math.atan2(l.y, l.x), wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const d1 = wrap(axis - c.angle), d2 = wrap(axis + Math.PI - c.angle);
    const diff = Math.abs(d1) <= Math.abs(d2) ? d1 : d2;
    if (Math.abs(diff) > 1e-3) c.angle += Math.max(-3 * dt, Math.min(3 * dt, diff));
  }

  respawnCivilian(c: Civilian): void {
    for (let k = 0; k < 40; k++) {
      const r = this.rng.pick(this.roadList);
      if (this.isIntersection(r.x, r.y)) continue;
      const cx = r.x + 0.5, cy = r.y + 0.5;
      if ([...this.vehicles.values()].some(v => Math.hypot(v.x - cx, v.y - cy) < 6) || this.civilians.some(o => o !== c && Math.hypot(o.x - cx, o.y - cy) < 3)) continue;
      c.x = c.px = cx; c.y = c.py = cy; c.path = []; c.wait = 1; c.stuck = 0; c.v = 0; c.angle = this.laneAngle(r.x, r.y);
      return;
    }
  }

  private updateCivilian(c: Civilian, dt: number): void {
    if (c.wait > 0) { c.wait -= dt; this.alignCivilian(c, dt); return; }
    if (c.v < 0.05 && !c.path.length) this.alignCivilian(c, dt);
    if (!c.path.length) {
      const dest = this.rng.pick(this.roadList);
      const idle = new Set<number>();
      for (const v of this.vehicles.values()) if (!v.path.length) idle.add(key(Math.floor(v.x), Math.floor(v.y)));
      const from = { x: Math.floor(c.x), y: Math.floor(c.y) };
      const avoidK = c.avoidUntil > this.time ? c.avoidTile : -1;
      const ok = (x: number, y: number) => this.civCanEnter(c, x, y) && !idle.has(key(x, y)) && key(x, y) !== avoidK;
      // cars turn around when they are facing a closed road or a dead end
      const turn = findPath(this.w, this.h, from, dest, ok, { edge: this.laneUturnOk });
      const lane = turn ? findPath(this.w, this.h, from, dest, ok, { edge: this.laneEdgeOk }) : null;
      const p = turn && lane && lane.length <= turn.length + 6 ? lane : turn; // a U-turn when it saves more than a few tiles (or the only way)
      if (!p || p.length < 8) { c.wait = 1; return; }
      c.path = p;
    }
    const next = c.path[0];
    if (!this.civCanEnter(c, next.x, next.y)) { c.path = []; c.wait = 0.5; return; }
    const dx = next.x + 0.5 - c.x, dy = next.y + 0.5 - c.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    // target speed: cruising speed, slower for a turn ahead, zero for a red light or a car in front (smooth acceleration and braking)
    let target = c.speed;
    const after = c.path[1];
    const turning = !!after && (after.x - next.x !== next.x - Math.floor(c.x) || after.y - next.y !== next.y - Math.floor(c.y)) && d < 1.2;
    if (turning) target = Math.min(target, 1.3);
    c.signal = 0;
    for (let k = 0; k < Math.min(3, c.path.length - 1); k++) { // indicator on for a turn within the next tiles
      const a = c.path[k], b = c.path[k + 1], cx0 = k === 0 ? Math.floor(c.x) : c.path[k - 1].x, cy0 = k === 0 ? Math.floor(c.y) : c.path[k - 1].y;
      const cross = (a.x - cx0) * (b.y - a.y) - (a.y - cy0) * (b.x - a.x);
      if (cross !== 0) { c.signal = cross > 0 ? 1 : -1; break; }
    }
    const enteringIx = this.isIntersection(next.x, next.y) && !this.isIntersection(Math.floor(c.x), Math.floor(c.y));
    if (enteringIx && d < 1.7) {
      const horizontal = Math.abs(ux) > Math.abs(uy);
      if (!this.canGo(next.x, next.y, horizontal) || (this.isSignalised(next.x, next.y) && this.exitBlocked(c.path, c.id))) { // red (or no room behind the junction): stop in front of it
        target = d < 0.95 ? 0 : Math.min(target, Math.max(0, (d - 0.9) * 2.5));
        if (d < 0.9) { c.v = Math.max(0, c.v - 10 * dt); c.braking = true; return; }
      }
    }
    const look = this.findBlocker(c, c.x, c.y, ux, uy, Math.min(2.4, d + 1.0), c.len, c.hw, PRIO_CIVILIAN);
    if (look) {
      if (look.kind === 'civ' && look.civ) { // follow: match the speed of the car in front, keeping a gap that grows with the speed
        const gap = Math.hypot(look.x - c.x, look.y - c.y) - (c.len + look.civ.len) / 2;
        target = Math.min(target, Math.max(0, look.civ.v + (gap - 0.25 - c.v * 0.18) * 1.6));
      } else target = 0;
    }
    const before = c.v;
    c.v += Math.max(-7 * dt, Math.min(3.4 * dt, target - c.v));
    c.braking = c.v < before - 1e-3 || (target === 0 && c.v < 0.3);
    const step = Math.min(c.v * dt, d);
    const la1 = this.laneAt(Math.floor(c.x), Math.floor(c.y)), lb1 = this.laneAt(next.x, next.y);
    const cUturn = !!(la1 && lb1 && la1.x === -lb1.x && la1.y === -lb1.y && Math.abs(ux * la1.x + uy * la1.y) < 1e-6);
    const blocker = this.findBlocker(c, c.x, c.y, ux, uy, Math.max(step, 0.02), c.len, cUturn ? c.len * 0.64 : c.hw, PRIO_CIVILIAN);
    if (blocker) {
      c.v = Math.max(0, c.v - 10 * dt); c.braking = true;
      c.stuck += dt;
      if (c.stuck > 0.9 && this.time > c.passUntil && (blocker.kind === 'civ' || (blocker.kind === 'veh' && blocker.halted))) {
        const np = this.overtakePath(c.x, c.y, c.path, c.id);
        if (np) { c.path = np; c.passUntil = this.time + 9; c.stuck = 0; return; }
      }
      if (c.stuck > 2 && c.path.length) { // stuck: turn around and take another way (the blocking tile is avoided for a while)
        const k = key(Math.floor(blocker.x), Math.floor(blocker.y));
        c.avoidTile = k; c.avoidUntil = this.time + 8;
        c.path = []; c.wait = 0.2;
      }
      if (c.stuck > 6) this.respawnCivilian(c); // deadlock breaker: this car drives off somewhere else
      return;
    }
    c.stuck = Math.max(0, c.stuck - dt);
    const la = this.laneAt(Math.floor(c.x), Math.floor(c.y)), lb = this.laneAt(next.x, next.y);
    if (la && lb && la.x === -lb.x && la.y === -lb.y && Math.abs(ux * la.x + uy * la.y) < 1e-6 && this.time < c.passUntil) { // overtaking: keep facing the way of travel
      c.angle = Math.atan2(la.y, la.x) + (Math.sign(la.x * uy - la.y * ux) || 1) * 0.35;
    } else if (la && lb && la.x === -lb.x && la.y === -lb.y && Math.abs(ux * la.x + uy * la.y) < 1e-6) { // U-turn: slide into the opposite lane while turning through 180 degrees
      const sign = Math.sign(la.x * uy - la.y * ux) || 1;
      c.angle = Math.atan2(la.y, la.x) + sign * Math.PI * Math.min(1, Math.max(0, 1 - (d - step)));
    } else c.angle = Math.atan2(dy, dx);
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
      buildings: [...this.buildings.values()].map(b => ({ id: b.id, fire: b.fire, damage: b.damage, destroyed: b.destroyed, incidentId: b.incidentId, growth: b.growth, spread: b.spread, resistance: b.resistance, wet: b.wet })),
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
    for (const sb of s.buildings) { const b = w.buildings.get(sb.id); if (b) Object.assign(b, { ...sb, resistance: sb.resistance ?? 1, wet: sb.wet ?? 0 }); }
    for (const v of s.vehicles) { v.home ??= { x: Math.floor(v.x), y: Math.floor(v.y) }; v.returning ??= false; v.silent ??= false; v.cargo ??= 0; v.passUntil ??= 0; v.prio ??= 1; v.speedNow ??= 0; v.prisoners ??= []; v.patrol ??= false; v.patrolRoute ??= []; v.patrolIdx ??= 0; v.toHospital ??= false; v.contraflow ??= false; v.blocked ??= 0; v.avoid ??= []; v.ghost ??= 0; v.water ??= content.vehicles[v.defId]?.tank ?? 0; v.hydrant ??= false; w.vehicles.set(v.id, v); }
    for (const r of s.responders) w.responders.set(r.id, r);
    for (const v of s.victims) w.victims.set(v.id, v);
    for (const x of s.suspects) { x.angle ??= 0; x.path ??= []; x.mode ??= 'idle'; x.runner ??= false; x.obey ??= true; x.fleeT ??= 0; x.escortedBy ??= null; x.vehicleId ??= null; w.suspects.set(x.id, x); }
    for (const b of s.bystanders ?? []) w.bystanders.set(b.id, b);
    for (const i of s.incidents) { i.bystanders ??= []; i.defused ??= false; i.address ??= ''; i.scouted ??= false; i.pager ??= ''; i.units ??= []; i.advised ??= false; i.arrivedAt ??= null; w.incidents.set(i.id, i); }
    w.obstacles = new Set(s.obstacles);
    w.rebuildCordon();
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
