import type { World } from './world';
import { buildingHeightMeters, headingToYaw, modelId, tileToWorld3D, vehicleDimensions } from './space';
import type { Category } from './types';

/**
 * A renderer-agnostic, read-only view of the world for one frame, with positions interpolated between simulation ticks.
 * The 2D Phaser scene reads the world directly today; a 3D renderer (or a replay / network client) can consume this
 * instead, without knowing anything about the simulation internals. See docs/3d.md.
 */
export interface SnapVehicle {
  id: number;
  model: string;
  category: Category;
  /** tile units (interpolated) */
  x: number;
  y: number;
  /** metres, Y up */
  position: { x: number; y: number; z: number };
  heading: number;
  yaw: number;
  size: { length: number; width: number; height: number };
  lights: boolean;
  moving: boolean;
}
export interface SnapPerson {
  id: number;
  kind: 'responder' | 'victim' | 'suspect' | 'bystander' | 'pedestrian';
  model: string;
  x: number;
  y: number;
  position: { x: number; y: number; z: number };
  heading: number;
  /** only for people that are visible in the world (not inside a vehicle, building or hospital) */
  state: string;
  /** a firefighter whose hose is connected: the vehicle the hose comes from, and (once deployed) the point being sprayed */
  hose?: { fromX: number; fromY: number; spray?: { x: number; y: number; buildingId: string } };
}
export interface SnapCar {
  id: number;
  model: string;
  x: number;
  y: number;
  position: { x: number; y: number; z: number };
  heading: number;
}
export interface SnapBuilding {
  id: string;
  model: string;
  x: number;
  y: number;
  w: number;
  h: number;
  heightMeters: number;
  floors: number;
  roof: string;
  fire: number;
  damage: number;
  destroyed: boolean;
}
export interface SnapIncident {
  id: number;
  kind: string;
  severity: number;
  x: number;
  y: number;
  secured: boolean;
}
export interface RenderSnapshot {
  time: number;
  /** 0 = east-west traffic has green, 1 = north-south */
  lightPhase: 0 | 1;
  vehicles: SnapVehicle[];
  people: SnapPerson[];
  cars: SnapCar[];
  buildings: SnapBuilding[];
  incidents: SnapIncident[];
  obstacles: { x: number; y: number; kind: string }[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Build a snapshot. `alpha` (0..1) is the fraction between the previous and the current simulation tick. */
export function createSnapshot(world: World, alpha = 1): RenderSnapshot {
  const ix = (e: { px: number; x: number }) => lerp(e.px, e.x, alpha);
  const iy = (e: { py: number; y: number }) => lerp(e.py, e.y, alpha);
  const snap: RenderSnapshot = { time: world.time, lightPhase: world.lightPhase, vehicles: [], people: [], cars: [], buildings: [], incidents: [], obstacles: [] };

  for (const v of world.vehicles.values()) {
    const def = world.vehicleDef(v), x = ix(v), y = iy(v);
    snap.vehicles.push({
      id: v.id, model: modelId('vehicle', v.defId, def.model), category: v.category, x, y, position: tileToWorld3D(x, y), heading: v.angle, yaw: headingToYaw(v.angle),
      size: vehicleDimensions(def), lights: v.lights, moving: v.path.length > 0,
    });
  }
  for (const r of world.responders.values()) {
    if (r.inVehicle) continue;
    const x = ix(r), y = iy(r);
    const person: SnapPerson = { id: r.id, kind: 'responder', model: modelId('person', r.role, world.roleDef(r).model), x, y, position: tileToWorld3D(x, y), heading: r.angle, state: r.task?.type ?? 'idle' };
    if (r.task?.type === 'extinguish') {
      const veh = world.vehicles.get(r.vehicleId);
      const b = world.buildings.get(r.task.buildingId);
      if (veh) {
        person.hose = { fromX: ix(veh), fromY: iy(veh) };
        if (b && r.task.deploy >= 2.5) person.hose.spray = { x: Math.max(b.x, Math.min(b.x + b.w, r.x)), y: Math.max(b.y, Math.min(b.y + b.h, r.y)), buildingId: b.id };
      }
    }
    snap.people.push(person);
  }
  for (const v of world.victims.values()) {
    if (v.transport !== 'scene' && v.transport !== 'carried' && v.transport !== 'dead') continue;
    const x = ix(v), y = iy(v);
    snap.people.push({ id: v.id, kind: 'victim', model: modelId('person', v.transport === 'dead' ? 'victim_dead' : 'victim'), x, y, position: tileToWorld3D(x, y), heading: 0, state: v.transport });
  }
  for (const s of world.suspects.values()) snap.people.push({ id: s.id, kind: 'suspect', model: modelId('person', 'suspect'), x: s.x, y: s.y, position: tileToWorld3D(s.x, s.y), heading: 0, state: s.arrested ? 'arrested' : 'free' });
  for (const b of world.bystanders.values()) {
    const x = ix(b), y = iy(b);
    snap.people.push({ id: b.id, kind: 'bystander', model: modelId('person', `pedestrian_${b.color}`), x, y, position: tileToWorld3D(x, y), heading: b.angle, state: b.leaving ? 'leaving' : 'watching' });
  }
  for (const p of world.pedestrians) {
    const x = ix(p), y = iy(p);
    snap.people.push({ id: p.id, kind: 'pedestrian', model: modelId('person', `pedestrian_${p.color}`), x, y, position: tileToWorld3D(x, y), heading: p.angle, state: p.path.length ? 'walking' : 'idle' });
  }
  for (const c of world.civilians) {
    const x = ix(c), y = iy(c);
    snap.cars.push({ id: c.id, model: modelId('vehicle', `civilian_${c.color}`), x, y, position: tileToWorld3D(x, y), heading: c.angle });
  }
  for (const b of world.buildings.values()) {
    const heightMeters = buildingHeightMeters(b);
    snap.buildings.push({
      id: b.id, model: modelId('building', `${b.type}_${b.roof ?? 'flat'}`), x: b.x, y: b.y, w: b.w, h: b.h, heightMeters, floors: b.floors ?? Math.max(1, Math.round(heightMeters / 3.2)),
      roof: b.roof ?? 'flat', fire: b.fire, damage: b.damage, destroyed: b.destroyed,
    });
  }
  for (const i of world.incidents.values()) snap.incidents.push({ id: i.id, kind: i.defId, severity: i.severity, x: i.x, y: i.y, secured: i.secured });
  for (const i of world.incidents.values()) for (const o of i.obstacle) snap.obstacles.push({ x: o.x, y: o.y, kind: i.defId });
  return snap;
}
