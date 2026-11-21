import type { Content, IncidentDef, MapDef, RoleDef, VehicleDef } from './types';

const CATEGORIES = ['fire', 'ambulance', 'police', 'tech'];
const ABILITIES = ['extinguish', 'rescue', 'treat', 'carry', 'arrest', 'secure', 'clear', 'coordinate'];
const OBJECTIVES = ['fire_out', 'victims_safe', 'suspects_arrested', 'area_secured', 'obstacle_cleared'];
const BUILDING_TYPES = ['residential', 'apartment', 'commercial', 'industrial', 'station', 'hospital'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

class Checker {
  errors: string[] = [];
  constructor(private where: string) {}
  err(path: string, msg: string): void {
    this.errors.push(`${this.where}${path ? '.' + path : ''}: ${msg}`);
  }
  str(o: Obj, k: string): string | null {
    if (typeof o[k] !== 'string' || !(o[k] as string).length) { this.err(k, 'moet een niet-lege tekst zijn'); return null; }
    return o[k] as string;
  }
  num(o: Obj, k: string, min = -Infinity, max = Infinity): number | null {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) { this.err(k, 'moet een getal zijn'); return null; }
    if (v < min || v > max) { this.err(k, `moet tussen ${min} en ${max} liggen`); return null; }
    return v;
  }
  oneOf(o: Obj, k: string, allowed: string[]): void {
    if (typeof o[k] !== 'string' || !allowed.includes(o[k] as string)) this.err(k, `moet een van [${allowed.join(', ')}] zijn`);
  }
  strArr(o: Obj, k: string, allowed?: string[]): void {
    const v = o[k];
    if (!Array.isArray(v)) { this.err(k, 'moet een lijst zijn'); return; }
    v.forEach((s, i) => {
      if (typeof s !== 'string') this.err(`${k}[${i}]`, 'moet tekst zijn');
      else if (allowed && !allowed.includes(s)) this.err(`${k}[${i}]`, `onbekende waarde "${s}" (toegestaan: ${allowed.join(', ')})`);
    });
  }
}

export function validateRole(v: unknown, where = 'role'): string[] {
  const c = new Checker(where);
  if (!isObj(v)) return [`${where}: moet een object zijn`];
  c.str(v, 'id'); c.str(v, 'name'); c.oneOf(v, 'category', CATEGORIES); c.strArr(v, 'abilities', ABILITIES);
  c.num(v, 'speed', 0.1, 20); c.str(v, 'color'); c.num(v, 'power', 0, 100);
  return c.errors;
}

export function validateVehicle(v: unknown, roles: Record<string, RoleDef>, where = 'vehicle'): string[] {
  const c = new Checker(where);
  if (!isObj(v)) return [`${where}: moet een object zijn`];
  c.str(v, 'id'); c.str(v, 'name'); c.oneOf(v, 'category', CATEGORIES);
  c.num(v, 'maxSpeed', 5, 300); c.num(v, 'capacity', 1, 20); c.str(v, 'color'); c.num(v, 'length', 0.5, 4);
  c.strArr(v, 'equipment'); c.num(v, 'patientCapacity', 0, 10);
  if (!Array.isArray(v.crew)) c.err('crew', 'moet een lijst zijn');
  else {
    let total = 0;
    v.crew.forEach((m, i) => {
      if (!isObj(m)) return c.err(`crew[${i}]`, 'moet een object zijn');
      const role = c.str(m, 'role');
      if (role && !roles[role]) c.err(`crew[${i}].role`, `onbekende rol "${role}"`);
      total += c.num(m, 'count', 1, 20) ?? 0;
    });
    if (typeof v.capacity === 'number' && total > v.capacity) c.err('crew', `bemanning (${total}) is groter dan capacity (${v.capacity})`);
  }
  return c.errors;
}

export function validateIncident(v: unknown, where = 'incident'): string[] {
  const c = new Checker(where);
  if (!isObj(v)) return [`${where}: moet een object zijn`];
  c.str(v, 'id'); c.str(v, 'name'); c.oneOf(v, 'category', CATEGORIES); c.num(v, 'weight', 0, 1000);
  if (v.icon !== undefined && typeof v.icon !== 'string') c.err('icon', 'moet tekst zijn');
  if (!isObj(v.spawn)) c.err('spawn', 'ontbreekt');
  else {
    c.oneOf(v.spawn, 'on', ['building', 'road']);
    if (v.spawn.on === 'building') c.strArr(v.spawn, 'buildingTypes', BUILDING_TYPES);
  }
  if (!isObj(v.severity)) c.err('severity', 'ontbreekt');
  else { c.num(v.severity, 'min', 1, 3); c.num(v.severity, 'max', 1, 3); }
  c.strArr(v, 'requires', CATEGORIES); c.strArr(v, 'objectives', OBJECTIVES);
  if (Array.isArray(v.objectives) && v.objectives.length === 0) c.err('objectives', 'minstens één doel nodig');
  const objs = (v.objectives as string[]) ?? [];
  if (objs.includes('fire_out') && !isObj(v.fire)) c.err('fire', 'doel fire_out vereist een "fire" blok');
  if (objs.includes('victims_safe') && !isObj(v.victims)) c.err('victims', 'doel victims_safe vereist een "victims" blok');
  if (objs.includes('suspects_arrested') && !isObj(v.suspects)) c.err('suspects', 'doel suspects_arrested vereist een "suspects" blok');
  if (objs.includes('obstacle_cleared') && !isObj(v.obstacle)) c.err('obstacle', 'doel obstacle_cleared vereist een "obstacle" blok');
  if (isObj(v.fire)) { c.num(v.fire, 'start', 1, 100); c.num(v.fire, 'growth', 0, 20); c.num(v.fire, 'spread', 0, 20); }
  if (isObj(v.victims)) {
    c.num(v.victims, 'min', 0, 20); c.num(v.victims, 'max', 0, 20); c.oneOf(v.victims, 'location', ['trapped', 'scene']);
    c.num(v.victims, 'decay', 0, 10);
    if (!Array.isArray(v.victims.health) || v.victims.health.length !== 2) c.err('victims.health', 'moet [min, max] zijn');
  }
  if (isObj(v.suspects)) { c.num(v.suspects, 'min', 0, 20); c.num(v.suspects, 'max', 0, 20); }
  if (isObj(v.obstacle)) c.num(v.obstacle, 'tiles', 1, 2);
  if (!isObj(v.escalation)) c.err('escalation', 'ontbreekt'); else c.num(v.escalation, 'everySec', 5, 3600);
  c.num(v, 'failAfterSec', 10, 7200);
  if (!isObj(v.reward)) c.err('reward', 'ontbreekt'); else { c.num(v.reward, 'score', 0); c.num(v.reward, 'budget', 0); }
  return c.errors;
}

export function validateMap(v: unknown, where = 'map'): string[] {
  const c = new Checker(where);
  if (!isObj(v)) return [`${where}: moet een object zijn`];
  c.str(v, 'id'); c.str(v, 'name');
  const w = c.num(v, 'width', 8, 512), h = c.num(v, 'height', 8, 512);
  if (!Array.isArray(v.rows) || (h !== null && v.rows.length !== h)) c.err('rows', 'aantal rijen komt niet overeen met height');
  else v.rows.forEach((r, i) => { if (typeof r !== 'string' || (w !== null && r.length !== w)) c.err(`rows[${i}]`, 'lengte komt niet overeen met width'); else if (/[^R.TB]/.test(r)) c.err(`rows[${i}]`, 'bevat onbekende tekens (toegestaan: R . T B)'); });
  const ids = new Set<string>();
  if (!Array.isArray(v.buildings)) c.err('buildings', 'moet een lijst zijn');
  else v.buildings.forEach((b, i) => {
    if (!isObj(b)) return c.err(`buildings[${i}]`, 'moet een object zijn');
    const id = c.str(b, 'id'); if (id) { if (ids.has(id)) c.err(`buildings[${i}].id`, `dubbele id "${id}"`); ids.add(id); }
    c.oneOf(b, 'type', BUILDING_TYPES); c.num(b, 'x', 0, 511); c.num(b, 'y', 0, 511); c.num(b, 'w', 1, 64); c.num(b, 'h', 1, 64); c.num(b, 'height', 0, 100);
  });
  if (!Array.isArray(v.stations)) c.err('stations', 'moet een lijst zijn');
  else v.stations.forEach((s, i) => {
    if (!isObj(s)) return c.err(`stations[${i}]`, 'moet een object zijn');
    c.str(s, 'id'); c.oneOf(s, 'category', CATEGORIES); c.strArr(s, 'fleet');
    if (typeof s.buildingId !== 'string' || !ids.has(s.buildingId)) c.err(`stations[${i}].buildingId`, 'verwijst naar een onbekend gebouw');
  });
  if (Array.isArray(v.buildings) && !v.buildings.some(b => isObj(b) && b.type === 'hospital')) c.err('buildings', 'minstens één gebouw van type "hospital" nodig');
  return c.errors;
}

export interface ModPack {
  roles?: unknown[];
  vehicles?: unknown[];
  incidents?: unknown[];
  maps?: unknown[];
}

export function emptyContent(): Content {
  return { roles: {}, vehicles: {}, incidents: {}, maps: {} };
}

/** Merge a content pack into `base`. Returns a new Content plus a list of (Dutch) error messages; invalid items are skipped. */
export function mergeContent(base: Content, pack: ModPack, packName = 'mod'): { content: Content; errors: string[] } {
  const content: Content = { roles: { ...base.roles }, vehicles: { ...base.vehicles }, incidents: { ...base.incidents }, maps: { ...base.maps } };
  const errors: string[] = [];
  if (!isObj(pack)) return { content, errors: [`${packName}: bestand moet een JSON-object zijn`] };
  const list = (k: keyof ModPack): unknown[] => {
    const v = pack[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { errors.push(`${packName}.${k}: moet een lijst zijn`); return []; }
    return v;
  };
  list('roles').forEach((r, i) => { const e = validateRole(r, `${packName}.roles[${i}]`); if (e.length) errors.push(...e); else content.roles[(r as RoleDef).id] = r as RoleDef; });
  list('vehicles').forEach((r, i) => { const e = validateVehicle(r, content.roles, `${packName}.vehicles[${i}]`); if (e.length) errors.push(...e); else content.vehicles[(r as VehicleDef).id] = r as VehicleDef; });
  list('incidents').forEach((r, i) => { const e = validateIncident(r, `${packName}.incidents[${i}]`); if (e.length) errors.push(...e); else content.incidents[(r as IncidentDef).id] = r as IncidentDef; });
  list('maps').forEach((r, i) => {
    const e = validateMap(r, `${packName}.maps[${i}]`);
    if (!e.length) for (const s of (r as MapDef).stations) for (const f of s.fleet) if (!content.vehicles[f]) e.push(`${packName}.maps[${i}].stations.${s.id}: onbekend voertuig "${f}"`);
    if (e.length) errors.push(...e); else content.maps[(r as MapDef).id] = r as MapDef;
  });
  return { content, errors };
}
