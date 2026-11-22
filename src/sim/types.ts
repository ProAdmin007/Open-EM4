import type { Vec } from './pathfinding';

export type Category = 'fire' | 'ambulance' | 'police' | 'tech';
export type Ability = 'extinguish' | 'rescue' | 'treat' | 'carry' | 'arrest' | 'secure' | 'clear' | 'coordinate' | 'disperse' | 'defuse';
export type Objective = 'fire_out' | 'victims_safe' | 'suspects_arrested' | 'area_secured' | 'obstacle_cleared' | 'bystanders_dispersed' | 'device_defused';
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
  victims?: { min: number; max: number; location: 'trapped' | 'scene'; health: [number, number]; decay: number; treatTime?: number; condition?: string };
  suspects?: { min: number; max: number; arrestTime?: number };
  bystanders?: { min: number; max: number };
  obstacle?: { tiles: number; mass?: number };
  objectives: Objective[];
  escalation: { everySec: number };
  failAfterSec: number;
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
  | { type: 'board'; vehicleId: number }
  | { type: 'extinguish'; buildingId: string; deploy: number }
  | { type: 'rescue'; victimId: number; progress: number }
  | { type: 'treat'; victimId: number; progress: number }
  | { type: 'load'; victimId: number }
  | { type: 'arrest'; suspectId: number; progress: number }
  | { type: 'secure'; incidentId: number; progress: number }
  | { type: 'clear'; incidentId: number; progress: number }
  | { type: 'disperse'; incidentId: number; progress: number }
  | { type: 'defuse'; incidentId: number; progress: number };
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
}
export type Transport = 'trapped' | 'scene' | 'carried' | 'inAmbulance' | 'atHospital' | 'dead';
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
}
export interface Suspect extends Entity {
  kind: 'suspect';
  incidentId: number;
  arrested: boolean;
  /** Seconds needed to arrest this suspect; depends on type and severity. */
  arrestTime: number;
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
}
export interface Civilian extends Entity {
  kind: 'civilian';
  path: Vec[];
  angle: number;
  color: number;
  wait: number;
  stuck: number;
  speed: number;
}
export interface Pedestrian extends Entity {
  kind: 'pedestrian';
  path: Vec[];
  angle: number;
  color: number;
  speed: number;
}

export type GameEvent =
  | { type: 'incident_started' | 'incident_escalated' | 'incident_resolved' | 'incident_failed'; incidentId: number; message: string }
  | { type: 'info' | 'warn'; message: string }
  | { type: 'explosion'; x: number; y: number; message: string }
  | { type: 'game_over' | 'mission_complete'; message: string };
