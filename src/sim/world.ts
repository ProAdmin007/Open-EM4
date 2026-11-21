import { Rng } from './rng';
import { findPath, type Vec } from './pathfinding';
import type {
  Ability, Building, Category, Civilian, Content, Difficulty, GameEvent, Incident, IncidentDef, MapDef,
  Pedestrian, Responder, RoleDef, Suspect, Task, Vehicle, VehicleDef, Victim,
} from './types';

export const SIM_DT = 1 / 30;
/** Vehicle speed conversion: km/h in the data files -> tiles per second. */
export const KMH_TO_TILES = 1 / 12;
const FIRE_POWER_SCALE = 0.12;
const HOSE_LENGTH = 16;
const DEPLOY_TIME = 2.5;

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
};

export interface WorldOptions {
  seed: number;
  difficulty: Difficulty;
  freeplay: boolean;
  mapId?: string;
  traffic?: boolean;
  /** 'Nieuw spel': start with a scripted sequence (fire, accident, crime) before the generator takes over. */
  scripted?: boolean;
}

export type Entity = Vehicle | Responder | Victim | Suspect;
export type OrderTarget =
  | { kind: 'building'; id: string }
  | { kind: 'victim'; id: number }
  | { kind: 'suspect'; id: number }
  | { kind: 'incident'; id: number };

const TILE_GRASS = 0, TILE_ROAD = 1, TILE_BUILDING = 2, TILE_TREE = 3;
const key = (x: number, y: number) => y * 4096 + x;
const rectDist = (b: Building, x: number, y: number) =>
  Math.hypot(Math.max(b.x - x, 0, x - (b.x + b.w)), Math.max(b.y - y, 0, y - (b.y + b.h)));
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export interface SaveGame {
  version: 1;
  opts: WorldOptions;
  time: number; score: number; budget: number; reputation: number; solved: number; failed: number; deaths: number;
  over: boolean; nextId: number; rng: number; spawnTimer: number;
  buildings: { id: string; fire: number; damage: number; destroyed: boolean; incidentId: number | null; growth: number; spread: number }[];
  vehicles: Vehicle[]; responders: Responder[]; victims: Victim[]; suspects: Suspect[]; incidents: Incident[];
  obstacles: number[];
  script?: { at: number; def: string }[];
}

export class World {
  readonly content: Content;
  readonly opts: WorldOptions;
  readonly map: MapDef;
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly intersection: Uint8Array;
  readonly buildings = new Map<string, Building>();
  private readonly buildingAt: (Building | null)[];
  vehicles = new Map<number, Vehicle>();
  responders = new Map<number, Responder>();
  victims = new Map<number, Victim>();
  suspects = new Map<number, Suspect>();
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
  private script: { at: number; def: string }[] = [];
  events: GameEvent[] = [];
  private roadList: Vec[] = [];

  private constructor(content: Content, opts: WorldOptions) {
    this.content = content;
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    const map = content.maps[opts.mapId ?? 'default_city'] ?? Object.values(content.maps)[0];
    if (!map) throw new Error('Geen kaart beschikbaar');
    this.map = map;
    this.w = map.width;
    this.h = map.height;
    this.tiles = new Uint8Array(this.w * this.h);
    this.intersection = new Uint8Array(this.w * this.h);
    this.buildingAt = new Array(this.w * this.h).fill(null);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = map.rows[y][x];
        this.tiles[y * this.w + x] = c === 'R' ? TILE_ROAD : c === 'B' ? TILE_BUILDING : c === 'T' ? TILE_TREE : TILE_GRASS;
        if (c === 'R') this.roadList.push({ x, y });
      }
    }
    for (const bd of map.buildings) {
      const flam = { residential: 1, apartment: 0.9, commercial: 0.8, industrial: 1.2, station: 0.4, hospital: 0.4 }[bd.type];
      const b: Building = { ...bd, door: { x: bd.x, y: bd.y }, fire: 0, damage: 0, destroyed: false, flammability: flam, incidentId: null, growth: 0, spread: 0 };
      this.buildings.set(b.id, b);
      for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) this.buildingAt[j * this.w + i] = b;
    }
    for (const b of this.buildings.values()) b.door = this.findDoor(b);
    for (const r of this.roadList) {
      const hz = this.isRoad(r.x - 1, r.y) && this.isRoad(r.x + 1, r.y);
      const vt = this.isRoad(r.x, r.y - 1) && this.isRoad(r.x, r.y + 1);
      if (hz && vt) this.intersection[r.y * this.w + r.x] = 1;
    }
  }

  static create(content: Content, opts: WorldOptions): World {
    const w = new World(content, opts);
    w.spawnFleets();
    if (opts.scripted) w.script = [{ at: 3, def: 'house_fire' }, { at: 30, def: 'car_accident' }, { at: 55, def: 'crime' }];
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
  isDrivable = (x: number, y: number): boolean => this.isRoad(x, y) && !this.obstacles.has(key(x, y));
  isWalkable = (x: number, y: number): boolean => this.inBounds(x, y) && this.tiles[y * this.w + x] !== TILE_BUILDING;
  buildingOn(x: number, y: number): Building | null {
    return this.inBounds(x, y) ? this.buildingAt[y * this.w + x] : null;
  }
  private findDoor(b: Building): Vec {
    const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
    const cands: Vec[] = [{ x: cx, y: b.y + b.h }, { x: cx, y: b.y - 1 }, { x: b.x + b.w, y: cy }, { x: b.x - 1, y: cy }];
    return cands.find(c => this.isRoad(c.x, c.y)) ?? cands.find(c => this.isWalkable(c.x, c.y)) ?? cands[0];
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
      const b = this.buildings.get(st.buildingId)!;
      const spots = this.roadList
        .filter(r => this.isIntersection(r.x, r.y) === false)
        .map(r => ({ r, d: Math.hypot(r.x - b.door.x, r.y - b.door.y) }))
        .sort((a, c) => a.d - c.d);
      for (const defId of st.fleet) {
        const def = this.content.vehicles[defId];
        if (!def) continue;
        const spot = spots.find(s => !placed.some(p => Math.hypot(p.x - s.r.x, p.y - s.r.y) < 2.3))!;
        placed.push(spot.r);
        this.createVehicle(def, st.id, spot.r.x + 0.5, spot.r.y + 0.5);
      }
    }
  }

  createVehicle(def: VehicleDef, stationId: string, x: number, y: number): Vehicle {
    const v: Vehicle = {
      kind: 'vehicle', ...this.addEntityBase(x, y), defId: def.id, category: def.category, stationId, path: [], dest: null,
      pathVersion: this.roadVersion, crew: [], patients: [], lights: false, angle: 0, state: 'idle',
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
    for (const e of this.allMovers()) { e.px = e.x; e.py = e.y; }
    while (this.script.length && this.time >= this.script[0].at) {
      const s = this.script.shift()!;
      if (this.content.incidents[s.def]) this.spawnIncident(s.def, { severity: 1 });
    }
    if (this.opts.freeplay && !this.script.length) this.updateSpawner(dt);
    for (const v of this.vehicles.values()) this.updateVehicle(v, dt);
    for (const r of this.responders.values()) this.updateResponder(r, dt);
    this.updateHospital();
    this.updateFire(dt);
    for (const v of this.victims.values()) this.updateVictim(v, dt);
    for (const inc of [...this.incidents.values()]) this.updateIncident(inc, dt);
    for (const c of this.civilians) this.updateCivilian(c, dt);
    for (const p of this.pedestrians) this.updatePedestrian(p, dt);
  }

  private *allMovers(): Iterable<{ x: number; y: number; px: number; py: number }> {
    yield* this.vehicles.values(); yield* this.responders.values(); yield* this.victims.values();
    yield* this.civilians; yield* this.pedestrians;
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

  routeVehicle(v: Vehicle, dest: Vec): boolean {
    const path = findPath(this.w, this.h, { x: Math.floor(v.x), y: Math.floor(v.y) }, dest, this.isDrivable);
    if (!path) return false;
    v.path = path;
    v.dest = { x: dest.x, y: dest.y };
    v.pathVersion = this.roadVersion;
    return true;
  }

  private updateVehicle(v: Vehicle, dt: number): void {
    if (v.dest && v.pathVersion !== this.roadVersion) {
      // roads changed (blockade): recompute the route
      if (!this.routeVehicle(v, v.dest)) { v.path = []; v.dest = null; this.emit({ type: 'warn', message: `${v.name}: geen route meer naar de bestemming` }); }
    }
    if (!v.path.length) {
      if (v.state === 'moving') { v.state = 'idle'; v.lights = false; v.dest = null; }
    } else {
      v.state = 'moving';
      v.lights = true;
      this.stepAlong(v, v.path, this.vehicleDef(v).maxSpeed * KMH_TO_TILES, dt);
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

  private walkTo(r: Responder, goal: Vec | ((x: number, y: number) => boolean)): boolean {
    const path = findPath(this.w, this.h, { x: Math.floor(r.x), y: Math.floor(r.y) }, goal, this.isWalkable, { diagonal: true });
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
        if (this.approach(r, v.x, v.y, 1.2, done)) { r.inVehicle = true; r.x = v.x; r.y = v.y; done(); }
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
          b.fire = Math.max(0, b.fire - role.power * bonus * FIRE_POWER_SCALE * dt);
        }
        break;
      }
      case 'rescue': {
        const v = this.victims.get(t.victimId);
        const b = v?.buildingId ? this.buildings.get(v.buildingId) : null;
        if (!v || !b || v.transport !== 'trapped') return done();
        if (this.approach(r, b.door.x + 0.5, b.door.y + 0.5, 1.3, done)) {
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
          if (t.progress >= 6) {
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
          if (this.approach(r, veh.x, veh.y, 1.7, () => { v.transport = 'scene'; v.carriedBy = null; r.carrying = null; done(); })) {
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
          if (t.progress >= 4) { s.arrested = true; this.emit({ type: 'info', message: `${r.name} heeft een verdachte gearresteerd` }); done(); }
        }
        break;
      }
      case 'secure': {
        const inc = this.incidents.get(t.incidentId);
        if (!inc || inc.secured) return done();
        if (this.approach(r, inc.x, inc.y, 3, done)) {
          t.progress += dt;
          if (t.progress >= 5) { inc.secured = true; this.emit({ type: 'info', message: `Locatie afgezet: ${inc.name}` }); done(); }
        }
        break;
      }
      case 'clear': {
        const inc = this.incidents.get(t.incidentId);
        if (!inc || inc.cleared || !inc.obstacle.length) return done();
        const o = inc.obstacle[0];
        if (this.approach(r, o.x + 0.5, o.y + 0.5, 2.5, done)) {
          t.progress += (dt * ((veh && this.vehicleDef(veh).clearPowerBonus) || 1)) / 8;
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
      id: this.newId(), defId, name: def.name, severity: sev, x: 0, y: 0, buildingId: null, elapsed: 0,
      nextEscalation: def.escalation.everySec * scale, status: 'active', secured: false, obstacle: [], victims: [], suspects: [], deaths: 0, cleared: false,
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
        };
        this.victims.set(v.id, v);
        inc.victims.push(v.id);
      }
    }
    if (def.suspects) this.addSuspects(inc, this.rng.int(def.suspects.min, def.suspects.max), b);
    this.incidents.set(inc.id, inc);
    this.emit({ type: 'incident_started', incidentId: inc.id, message: `Nieuwe melding: ${inc.name}` });
    return inc;
  }

  private scenePosition(inc: Incident, b: Building | null): Vec {
    const base = b ? { x: b.door.x + 0.5, y: b.door.y + 0.5 } : { x: inc.x, y: inc.y };
    for (let i = 0; i < 12; i++) {
      const p = { x: base.x + this.rng.range(-1.2, 1.2), y: base.y + this.rng.range(-1.2, 1.2) };
      if (this.isWalkable(Math.floor(p.x), Math.floor(p.y)) && !this.obstacles.has(key(Math.floor(p.x), Math.floor(p.y)))) return p;
    }
    return base;
  }

  private addSuspects(inc: Incident, n: number, b: Building | null): void {
    for (let i = 0; i < n; i++) {
      const pos = this.scenePosition(inc, b);
      const s: Suspect = { kind: 'suspect', ...this.addEntityBase(pos.x, pos.y), incidentId: inc.id, arrested: false };
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
      if (def.suspects && inc.suspects.length < 3) this.addSuspects(inc, 1, b ?? null);
      for (const id of inc.victims) { const v = this.victims.get(id); if (v && v.decay > 0) v.decay *= 1.2; }
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
    const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null;
    if (b) { b.incidentId = null; if (status === 'failed' && !b.destroyed) { b.fire = Math.max(b.fire, 0); } }
    for (const r of this.responders.values()) {
      const t = r.task;
      if (t && 'incidentId' in t && t.incidentId === inc.id) { r.task = null; r.path = []; }
    }
    this.incidents.delete(inc.id);
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
        const dest = this.nearestRoad(x, y);
        if (!dest || !this.routeVehicle(v, dest)) this.emit({ type: 'warn', message: `${v.name}: geen route beschikbaar` });
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
      if (v) { v.path = []; v.dest = null; }
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
      v.crew.forEach((rid, i) => {
        const r = this.responders.get(rid);
        if (!r || !r.inVehicle) return;
        r.inVehicle = false; r.task = null; r.path = [];
        const a = (i / Math.max(1, v.crew.length)) * Math.PI * 2;
        r.x = v.x + Math.cos(a) * 0.9; r.y = v.y + Math.sin(a) * 0.9;
        if (!this.isWalkable(Math.floor(r.x), Math.floor(r.y))) { r.x = v.x; r.y = v.y; }
        r.px = r.x; r.py = r.y;
        out.push(rid);
      });
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
      default: return null;
    }
  }

  /** What is under a world position (in tile units)? */
  pick(x: number, y: number): OrderTarget | null {
    for (const v of this.victims.values()) if (v.transport === 'trapped' ? false : (v.transport === 'scene' && Math.hypot(v.x - x, v.y - y) < 0.9)) return { kind: 'victim', id: v.id };
    for (const s of this.suspects.values()) if (!s.arrested && Math.hypot(s.x - x, s.y - y) < 0.9) return { kind: 'suspect', id: s.id };
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
        ability = inc.obstacle.length && abil.includes('clear') ? 'clear' : abil.includes('secure') ? 'secure' : null;
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
    for (let i = 0; i < 26; i++) {
      const r = this.rng.pick(roads);
      this.civilians.push({ kind: 'civilian', ...this.addEntityBase(r.x + 0.5, r.y + 0.5), path: [], angle: 0, color: this.rng.int(0, 5), wait: this.rng.range(0, 3), speed: this.rng.range(3.2, 4.2) });
    }
    const walk: Vec[] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.tiles[y * this.w + x] === TILE_GRASS) walk.push({ x, y });
    for (let i = 0; i < 24 && walk.length; i++) {
      const t = this.rng.pick(walk);
      this.pedestrians.push({ kind: 'pedestrian', ...this.addEntityBase(t.x + 0.5, t.y + 0.5), path: [], angle: 0, color: this.rng.int(0, 5), speed: this.rng.range(0.9, 1.5) });
    }
  }

  private updateCivilian(c: Civilian, dt: number): void {
    if (c.wait > 0) { c.wait -= dt; return; }
    if (!c.path.length) {
      const dest = this.rng.pick(this.roadList);
      const p = findPath(this.w, this.h, { x: Math.floor(c.x), y: Math.floor(c.y) }, dest, this.isDrivable);
      if (!p || p.length < 8) { c.wait = 1; return; }
      c.path = p;
    }
    const next = c.path[0];
    if (!this.isDrivable(next.x, next.y)) { c.path = []; c.wait = 0.5; return; }
    const dx = next.x + 0.5 - c.x, dy = next.y + 0.5 - c.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    // red light? only checked when about to enter an intersection
    if (this.isIntersection(next.x, next.y) && !this.isIntersection(Math.floor(c.x), Math.floor(c.y)) && d < 0.9) {
      const horizontal = Math.abs(ux) > Math.abs(uy);
      if ((this.lightPhase === 0) !== horizontal) return;
    }
    // emergency vehicles with lights get priority; others block cars ahead
    for (const v of this.vehicles.values()) {
      const vx = v.x - c.x, vy = v.y - c.y, vd = Math.hypot(vx, vy);
      if (v.lights && vd < 4.5) return;
      if (v.state === 'idle' && vd < 1.2 && vx * ux + vy * uy > 0.4 && this.isRoad(Math.floor(v.x), Math.floor(v.y))) { c.wait = 1.5; c.path = []; return; }
    }
    for (const o of this.civilians) {
      if (o === c) continue;
      const ox = o.x - c.x, oy = o.y - c.y, od = Math.hypot(ox, oy);
      if (od < 1.1 && ox * ux + oy * uy > 0.5 && o.id < c.id) return;
    }
    c.angle = Math.atan2(dy, dx);
    const step = Math.min(c.speed * dt, d);
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
      version: 1, opts: { ...this.opts }, time: this.time, score: this.score, budget: this.budget, reputation: this.reputation,
      solved: this.solved, failed: this.failed, deaths: this.deaths, over: this.over, nextId: this.nextId, rng: this.rng.state, spawnTimer: this.spawnTimer,
      buildings: [...this.buildings.values()].map(b => ({ id: b.id, fire: b.fire, damage: b.damage, destroyed: b.destroyed, incidentId: b.incidentId, growth: b.growth, spread: b.spread })),
      vehicles: structuredClone([...this.vehicles.values()]), responders: structuredClone([...this.responders.values()]),
      victims: structuredClone([...this.victims.values()]), suspects: structuredClone([...this.suspects.values()]),
      incidents: structuredClone([...this.incidents.values()]), obstacles: [...this.obstacles], script: [...this.script],
    };
  }

  static fromSave(content: Content, s: SaveGame): World {
    if (!s || s.version !== 1) throw new Error('Onbekend savegame-formaat');
    const w = new World(content, s.opts);
    w.time = s.time; w.score = s.score; w.budget = s.budget; w.reputation = s.reputation; w.solved = s.solved; w.failed = s.failed; w.deaths = s.deaths;
    w.over = s.over; w.nextId = s.nextId; w.rng.state = s.rng; w.spawnTimer = s.spawnTimer;
    for (const sb of s.buildings) { const b = w.buildings.get(sb.id); if (b) Object.assign(b, sb); }
    for (const v of s.vehicles) w.vehicles.set(v.id, v);
    for (const r of s.responders) w.responders.set(r.id, r);
    for (const v of s.victims) w.victims.set(v.id, v);
    for (const x of s.suspects) w.suspects.set(x.id, x);
    for (const i of s.incidents) w.incidents.set(i.id, i);
    w.obstacles = new Set(s.obstacles);
    w.script = s.script ?? [];
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
