import type { Vec } from './pathfinding';

export type Category = 'fire' | 'ambulance' | 'police' | 'tech';
export type Ability = 'extinguish' | 'rescue' | 'treat' | 'carry' | 'arrest' | 'secure' | 'clear' | 'coordinate';
export type Objective = 'fire_out' | 'victims_safe' | 'suspects_arrested' | 'area_secured' | 'obstacle_cleared';
export type BuildingType = 'residential' | 'apartment' | 'commercial' | 'industrial' | 'station' | 'hospital';

export interface RoleDef {
  id: string;
  name: string;
  category: Category;
  abilities: Ability[];
  speed: number;
  color: string;
  power: number;
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
  firePowerBonus?: number;
  clearPowerBonus?: number;
}
export interface IncidentDef {
  id: string;
  name: string;
  category: Category;
  weight: number;
  icon?: string;
  spawn: { on: 'building' | 'road'; buildingTypes?: BuildingType[] };
  severity: { min: number; max: number };
  requires: Category[];
  fire?: { start: number; growth: number; spread: number };
  victims?: { min: number; max: number; location: 'trapped' | 'scene'; health: [number, number]; decay: number };
  suspects?: { min: number; max: number };
  obstacle?: { tiles: number };
  objectives: Objective[];
  escalation: { everySec: number };
  failAfterSec: number;
  reward: { score: number; budget: number };
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
}
export interface StationDef {
  id: string;
  category: Category;
  buildingId: string;
  fleet: string[];
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
  pathVersion: number;
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
  | { type: 'clear'; incidentId: number; progress: number };
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
}
export interface Suspect extends Entity {
  kind: 'suspect';
  incidentId: number;
  arrested: boolean;
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
}
export type IncidentStatus = 'active' | 'resolved' | 'failed';
export interface Incident {
  id: number;
  defId: string;
  name: string;
  severity: number;
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
  deaths: number;
  cleared: boolean;
}
export interface Civilian extends Entity {
  kind: 'civilian';
  path: Vec[];
  angle: number;
  color: number;
  wait: number;
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
  | { type: 'game_over'; message: string };
