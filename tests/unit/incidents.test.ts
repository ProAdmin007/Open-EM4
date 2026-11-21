import { describe, expect, it } from 'vitest';
import { newWorld, run } from './helpers';
import type { World } from '../../src/sim/world';

const crewOf = (w: World, defId: string) => {
  const v = [...w.vehicles.values()].find(x => x.defId === defId)!;
  return { v, crew: v.crew };
};
const driveTo = (w: World, vid: number, x: number, y: number) => {
  w.orderMove([vid], x, y);
  run(w, 120, () => w.vehicles.get(vid)!.path.length === 0);
};

describe('incident generation', () => {
  it('is reproducible for a given seed', () => {
    const a = newWorld(42, true), b = newWorld(42, true);
    run(a, 200);
    run(b, 200);
    const sig = (w: World) => [...w.incidents.values()].map(i => [i.defId, i.x, i.y]);
    expect(sig(a)).toEqual(sig(b));
    expect(a.incidents.size + a.solved + a.failed).toBeGreaterThan(0);
  });
  it('respects difficulty limits on concurrent incidents', () => {
    const w = newWorld(3, true, 'easy');
    let max = 0;
    for (let i = 0; i < 30 * 900 && !w.over; i++) {
      w.tick();
      max = Math.max(max, w.incidents.size);
    }
    expect(max).toBeLessThanOrEqual(2 + 2); // spreading fires may add linked incidents
    expect(max).toBeGreaterThan(0);
  });
  it('spawns each built-in incident type with the right ingredients', () => {
    const w = newWorld();
    const fire = w.spawnIncident('house_fire', { severity: 1 })!;
    expect(w.buildings.get(fire.buildingId!)!.fire).toBeGreaterThan(0);
    const acc = w.spawnIncident('car_accident')!;
    expect(acc.victims.length).toBeGreaterThan(0);
    expect(acc.obstacle.length).toBe(1);
    expect(w.spawnIncident('crime')!.suspects.length).toBeGreaterThan(0);
    expect(w.spawnIncident('road_blockage')!.obstacle.length).toBe(2);
    expect(w.spawnIncident('medical_emergency')!.victims.length).toBe(1);
    expect(w.spawnIncident('industrial_fire')).not.toBeNull();
  });
});

describe('incident resolution', () => {
  it('a fire is only resolved after units arrive, dismount and extinguish it', () => {
    const w = newWorld(5);
    const inc = w.spawnIncident('house_fire', { severity: 1 })!;
    const b = w.buildings.get(inc.buildingId!)!;
    for (const id of inc.victims) w.victims.delete(id);
    inc.victims = [];
    run(w, 5);
    expect(w.incidents.has(inc.id)).toBe(true);
    const { v, crew } = crewOf(w, 'fire_engine');
    driveTo(w, v.id, b.door.x + 0.5, b.door.y + 0.5);
    expect(Math.hypot(v.x - b.door.x, v.y - b.door.y)).toBeLessThan(8);
    expect(w.incidents.has(inc.id)).toBe(true);
    w.orderDismount([v.id]);
    expect(crew.every(id => !w.responders.get(id)!.inVehicle)).toBe(true);
    w.contextOrder(crew, b.x + b.w / 2, b.y + b.h / 2);
    run(w, 120, () => !w.incidents.has(inc.id));
    expect(w.incidents.has(inc.id)).toBe(false);
    expect(w.solved).toBe(1);
    expect(w.score).toBeGreaterThan(0);
    expect(b.destroyed).toBe(false);
  });
  it('an accident needs treatment, hospital transport and a secured area', () => {
    const w = newWorld(9);
    const inc = w.spawnIncident('car_accident', { severity: 1 })!;
    for (const id of inc.victims.slice(1)) w.victims.delete(id);
    inc.victims = inc.victims.slice(0, 1);
    const victim = w.victims.get(inc.victims[0])!;
    const { v: amb, crew: medics } = crewOf(w, 'ambulance');
    const { v: car, crew: cops } = crewOf(w, 'patrol_car');
    driveTo(w, amb.id, victim.x, victim.y);
    driveTo(w, car.id, victim.x, victim.y);
    w.orderDismount([amb.id, car.id]);
    w.orderAbility(medics, 'treat', { kind: 'victim', id: victim.id });
    w.orderAbility(cops, 'secure', { kind: 'incident', id: inc.id });
    run(w, 40, () => victim.treated && inc.secured);
    expect(victim.treated).toBe(true);
    expect(inc.secured).toBe(true);
    expect(w.incidents.has(inc.id)).toBe(true);
    w.orderAbility(medics, 'carry', { kind: 'victim', id: victim.id });
    run(w, 30, () => victim.transport === 'inAmbulance');
    expect(victim.transport).toBe('inAmbulance');
    w.orderBoard([amb.id]);
    run(w, 20, () => medics.every(id => w.responders.get(id)!.inVehicle));
    const hospital = [...w.buildings.values()].find(b => b.type === 'hospital')!;
    driveTo(w, amb.id, hospital.door.x + 0.5, hospital.door.y + 0.5);
    run(w, 2);
    expect(w.incidents.has(inc.id)).toBe(false);
    expect(w.solved).toBe(1);
  });
  it('police can arrest suspects to close a crime incident', () => {
    const w = newWorld(11);
    const inc = w.spawnIncident('crime', { severity: 1 })!;
    const s = w.suspects.get(inc.suspects[0])!;
    const { v, crew } = crewOf(w, 'patrol_car');
    driveTo(w, v.id, s.x, s.y);
    w.orderDismount([v.id]);
    inc.suspects.forEach((id, i) => w.orderAbility([crew[i % crew.length]], 'arrest', { kind: 'suspect', id }));
    run(w, 60, () => !w.incidents.has(inc.id));
    expect(w.solved).toBe(1);
  });
  it('a tow truck clears a blockade and the road network is recomputed', () => {
    const w = newWorld(13);
    const inc = w.spawnIncident('road_blockage', { severity: 1 })!;
    const before = w.roadVersion;
    const { v, crew } = crewOf(w, 'tow_truck');
    driveTo(w, v.id, inc.x, inc.y);
    w.orderDismount([v.id]);
    w.orderAbility(crew, 'clear', { kind: 'incident', id: inc.id });
    run(w, 40, () => !w.incidents.has(inc.id));
    expect(w.incidents.has(inc.id)).toBe(false);
    expect(w.roadVersion).toBeGreaterThan(before);
    expect(w.obstacles.size).toBe(0);
  });
  it('unhandled incidents escalate and eventually fail', () => {
    const w = newWorld(2);
    const inc = w.spawnIncident('crime', { severity: 1 })!;
    run(w, 400);
    expect(w.incidents.has(inc.id)).toBe(false);
    expect(w.failed).toBe(1);
    expect(w.reputation).toBeLessThan(100);
  });
});
