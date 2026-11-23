import type { Vec } from './pathfinding';

export type Category = 'fire' | 'ambulance' | 'police' | 'tech';
export type Ability = 'extinguish' | 'rescue' | 'treat' | 'carry' | 'arrest' | 'secure' | 'clear' | 'coordinate' | 'disperse' | 'defuse' | 'cool' | 'assist' | 'recon' | 'collect';
export type Objective = 'fire_out' | 'victims_safe' | 'suspects_arrested' | 'area_secured' | 'obstacle_cleared' | 'bystanders_dispersed' | 'device_defused' | 'scouted';
export type BuildingType = 'residential' | 'apartment' | 'commercial' | 'industrial' | 'office' | 'warehouse' | 'school' | 'shopping' | 'church' | 'station' | 'hospital';

export interface RoleDef {
  id: string;
  name: string;
  category: Category;
  abilities: Ability[];
  speed: number;
  color: string;
  power: number;
  /** Optional 3D model id (default `person/<id>`). */
  model?: string;
}
export interface VehicleDef {
  id: string;
  name: string;
  category: Category;
  maxSpeed: number;
  capacity: number;
  color: string;
  length: number;
  equipment: string[];
  crew: { role: string; count: number }[];
  patientCapacity: number;
  /** Optional 3D model id (default `vehicle/<id>`). */
  model?: string;
  /** Price (in budget) to call this vehicle as reinforcement. Default 500. */
  cost?: number;
  firePowerBonus?: number;
  /** Vehicle types this vehicle's crew can call as backup (Los Angeles mod style): the nearest free one drives to the caller. */
  callable?: string[];
  /** May drive patrol routes on its own (patrol cars, motorcycles, ambulances). */
  canPatrol?: boolean;
  /** Water tank in litres (fire vehicles); refilled at hydrants. */
  tank?: number;
  clearPowerBonus?: number;
}
export interface IncidentDef {
  id: string;
  name: string;
  category: Category;
  weight: number;
  icon?: string;
  /** Flavour texts; one is picked per incident. */
  descriptions?: string[];
  spawn: { on: 'building' | 'road'; buildingTypes?: BuildingType[] };
  severity: { min: number; max: number };
  requires: Category[];
  fire?: { start: number; growth: number; spread: number; resistance?: number };
  victims?: { min: number; max: number; pinnedChance?: number; location: 'trapped' | 'scene'; health: [number, number]; decay: number; treatTime?: number; condition?: string };
  suspects?: { min: number; max: number; arrestTime?: number };
  bystanders?: { min: number; max: number };
  obstacle?: { tiles: number; mass?: number };
  objectives: Objective[];
  escalation: { everySec: number };
  failAfterSec: number;
  /** A call that needs no response: it ends by itself at the time limit; sending a unit to check it costs money. */
  ignorable?: boolean;
  /** Seconds a bomb robot needs to render a device safe (objective device_defused). */
  defuseTime?: number;
  reward: { score: number; budget: number };
}
export interface MissionDef {
  id: string;
  name: string;
  description: string;
  /** 1 (easy) .. 3 (hard); informative */
  level: number;
  /** The mission fails when more incidents than this are lost. */
  allowedFailures: number;
  script: { at: number; def: string; severity?: number }[];
}
export interface BuildingDef {
  id: string;
  type: BuildingType;
  x: number;
  y: number;
  w: number;
  h: number;
  height: number;
  name?: string;
  /** 3D preparation: number of floors and roof shape (the 2D view only uses `height`). */
  floors?: number;
  roof?: 'gable' | 'flat' | 'hip';
}
export interface StationDef {
  id: string;
  category: Category;
  buildingId: string;
  fleet: string[];
  /** Parking bays (tile coordinates on 'P' tiles) where this station's vehicles park. */
  bays?: { x: number; y: number }[];
}
export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  rows: string[];
  buildings: BuildingDef[];
  stations: StationDef[];
}
export interface Content {
  roles: Record<string, RoleDef>;
  vehicles: Record<string, VehicleDef>;
  incidents: Record<string, IncidentDef>;
  maps: Record<string, MapDef>;
  missions: Record<string, MissionDef>;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

// ---------- runtime entities ----------
export interface Entity extends Vec {
  id: number;
  px: number;
  py: number;
}
export type VehicleState = 'idle' | 'moving';
export interface Vehicle extends Entity {
  kind: 'vehicle';
  defId: string;
  category: Category;
  stationId: string;
  path: Vec[];
  dest: Vec | null;
  /** Parking spot at the station (tile) the vehicle returns to. */
  home: Vec;
  /** True while the vehicle is on its way back to the station (set by the 'terug naar kazerne' order). */
  returning: boolean;
  /** Driving back to the station without sirens (set once the return route is planned). */
  silent: boolean;
  /** wrecks loaded on the flatbed (tow trucks), unloaded at the depot */
  cargo: number;
  /** arrested suspects sitting in the back (police vehicles) */
  prisoners: number[];
  /** until this time the vehicle is overtaking through the opposite lane */
  passUntil: number;
  /** dispatch priority: 1 = lights and sirens, 2 = normal traffic (obeys red lights, no lights) */
  prio: 1 | 2;
  /** current speed in tiles/s: vehicles accelerate from a standstill */
  speedNow: number;
  /** Patrolling the city along a route (sirens off) until given another order or called to an incident. */
  patrol: boolean;
  patrolRoute: Vec[];
  patrolIdx: number;
  /** True while heading for a hospital with patients on board. */
  toHospital: boolean;
  /** Emergency vehicle may drive against the lane direction (set after it got blocked). */
  contraflow: boolean;
  /** Seconds the vehicle has been waiting for something in its way. */
  blocked: number;
  /** Tile keys to route around (blockers met on this trip). */
  avoid: number[];
  /** While > 0 the vehicle ignores collisions (deadlock breaker). */
  ghost: number;
  pathVersion: number;
  /** Water left in the tank (litres) and whether the vehicle is hooked up to a hydrant (unlimited water). */
  water: number;
  hydrant: boolean;
  crew: number[];
  patients: number[];
  lights: boolean;
  angle: number;
  state: VehicleState;
  name: string;
}
export type Task =
  | { type: 'move' }
  | { type: 'board'; vehicleId: number; wait?: number }
  | { type: 'extinguish'; buildingId: string; deploy: number }
  | { type: 'rescue'; victimId: number; progress: number }
  | { type: 'treat'; victimId: number; progress: number }
  | { type: 'load'; victimId: number }
  | { type: 'arrest'; suspectId: number; progress: number; aim?: number; lx?: number; ly?: number }
  | { type: 'secure'; incidentId: number; progress: number }
  | { type: 'clear'; incidentId: number; progress: number }
  | { type: 'disperse'; incidentId: number; progress: number }
  | { type: 'defuse'; incidentId: number; progress: number }
  | { type: 'cool'; buildingId: string; deploy: number }
  | { type: 'assist'; victimId: number; idle: number }
  | { type: 'recon'; incidentId: number; progress: number }
  | { type: 'collect'; victimId: number; progress: number };
export interface Responder extends Entity {
  kind: 'responder';
  role: string;
  category: Category;
  vehicleId: number;
  inVehicle: boolean;
  path: Vec[];
  task: Task | null;
  angle: number;
  name: string;
  carrying: number | null;
  /** the suspect this officer is covering with a drawn pistol */
  aiming: number | null;
}
export type Transport = 'trapped' | 'scene' | 'carried' | 'inAmbulance' | 'atHospital' | 'dead' | 'collected';
export interface Victim extends Entity {
  kind: 'victim';
  incidentId: number;
  health: number;
  conscious: boolean;
  treated: boolean;
  transport: Transport;
  decay: number;
  buildingId: string | null;
  carriedBy: number | null;
  /** Seconds of treatment needed; depends on the condition and the incident severity. */
  treatTime: number;
  condition: string;
  /** 0..1 while the casualty is slid into the ambulance (the stretcher goes in over a couple of seconds) */
  loadT: number;
  /** the hearse that was sent for this body (when dead) */
  hearse: number | null;
  /** trapped in the wreck: has to be cut free with rescue tools before the stretcher can take them */
  pinned: boolean;
  name: string;
  age: number;
}
export interface Suspect extends Entity {
  kind: 'suspect';
  incidentId: number;
  arrested: boolean;
  /** Seconds needed to arrest this suspect; depends on type and severity. */
  arrestTime: number;
  angle: number;
  path: Vec[];
  /** free = standing about, flee = running from the police, surrender = hands up, escorted = cuffed and walking with an officer, boarded = inside a police vehicle */
  mode: 'idle' | 'flee' | 'surrender' | 'escorted' | 'boarded';
  /** will run when the police approach */
  runner: boolean;
  /** gives up when an officer draws a pistol and shouts (otherwise keeps running until caught) */
  obey: boolean;
  fleeT: number;
  escortedBy: number | null;
  vehicleId: number | null;
}
export interface Bystander extends Entity {
  kind: 'bystander';
  incidentId: number;
  leaving: boolean;
  path: Vec[];
  angle: number;
  color: number;
}
export interface Building extends BuildingDef {
  door: Vec;
  fire: number;
  damage: number;
  destroyed: boolean;
  flammability: number;
  incidentId: number | null;
  growth: number;
  spread: number;
  /** Fire resistance: extinguishing power is divided by this. */
  resistance: number;
  /** 0..100: how wet the facade is from cooling; slows fire spread and growth, dries out over time. */
  wet: number;
}
export type IncidentStatus = 'active' | 'resolved' | 'failed';
export interface Incident {
  id: number;
  defId: string;
  name: string;
  severity: number;
  description: string;
  x: number;
  y: number;
  buildingId: string | null;
  elapsed: number;
  nextEscalation: number;
  status: IncidentStatus;
  secured: boolean;
  obstacle: Vec[];
  victims: number[];
  suspects: number[];
  bystanders: number[];
  deaths: number;
  cleared: boolean;
  defused: boolean;
  /** Street address (or street + 'ter hoogte van') for the dispatch message. */
  address: string;
  /** The scene has been checked by a reconnaissance: only then it is known whether people are still inside. */
  scouted: boolean;
  /** P2000-style pager line, e.g. 'A1 Rendam Eikenlaan 56 Hartstilstand' */
  pager: string;
  /** vehicle types the control room recommends for this call */
  units: string[];
  /** first-aid instructions were given to the caller over the phone */
  advised: boolean;
  /** seconds after the call at which the first unit was on scene (null while nobody is there) */
  arrivedAt: number | null;
  /** the vehicle types already sent (by the dispatch button or GRIP) */
  dispatched: boolean;
}
export interface Civilian extends Entity {
  kind: 'civilian';
  path: Vec[];
  angle: number;
  color: number;
  wait: number;
  stuck: number;
  /** cruising speed (tiles/s) */
  speed: number;
  /** current speed (tiles/s): cars accelerate, brake for lights and traffic and slow down for turns */
  v: number;
  /** car, van or (slower, narrower) bicycle */
  type: 'car' | 'van' | 'bike';
  len: number;
  hw: number;
  /** braking now / turn indicator (-1 left, 1 right) for the renderer */
  braking: boolean;
  signal: number;
  /** a tile to avoid when planning (what blocked this car) until this time */
  avoidTile: number;
  avoidUntil: number;
  passUntil: number;
}
export interface Pedestrian extends Entity {
  kind: 'pedestrian';
  path: Vec[];
  angle: number;
  color: number;
  speed: number;
}

export type GameEvent =
  | { type: 'incident_started' | 'incident_escalated' | 'incident_resolved' | 'incident_failed'; incidentId: number; message: string; /** what the control room says over the radio */ speech?: string }
  | { type: 'info' | 'warn'; message: string; speech?: string }
  | { type: 'explosion'; x: number; y: number; message: string }
  | { type: 'game_over' | 'mission_complete'; message: string };
