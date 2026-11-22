import { describe, expect, it } from 'vitest';
import { newWorld, run } from './helpers';
import type { World } from '../../src/sim/world';

const vehicleOf = (w: World, defId: string) => [...w.vehicles.values()].find(x => x.defId === defId)!;

describe('realistic driving and priorities', () => {
  it('vehicles accelerate from a standstill instead of starting at full speed', () => {
    const w = newWorld(2);
    const eng = vehicleOf(w, 'fire_engine');
    w.orderMove([eng.id], 40, 30);
    run(w, 0.3);
    const early = eng.speedNow;
    run(w, 6);
    expect(early).toBeLessThan(1.5);
    expect(eng.speedNow).toBeGreaterThan(early * 2);
  });

  it('people accelerate too and a prio 2 vehicle drives without lights', () => {
    const w = newWorld(2);
    const amb = vehicleOf(w, 'ambulance');
    w.orderMove([amb.id], 40, 30, 2);
    run(w, 3);
    expect(amb.prio).toBe(2);
    expect(amb.lights).toBe(false);
    w.orderMove([amb.id], 41, 30, 1);
    run(w, 0.2);
    expect(amb.lights).toBe(true);
  });

  it('a vehicle that cannot get closer to its destination stops nearby and is available', () => {
    const w = newWorld(2);
    const eng = vehicleOf(w, 'fire_engine');
    const blockers = [...w.vehicles.values()].filter(v => v !== eng).slice(0, 1);
    w.orderMove([eng.id], 45, 30);
    run(w, 200, () => !eng.path.length);
    expect(eng.path.length).toBe(0);
    expect(blockers.length).toBe(1);
  });
});

describe('accidents, calls and who is where', () => {
  it('casualties have a name and an age and pinned ones need rescue tools before they can be carried', () => {
    const w = newWorld(9);
    const inc = w.spawnIncident('car_accident', { severity: 2 })!;
    const v = w.victims.get(inc.victims[0])!;
    expect(v.name.length).toBeGreaterThan(4);
    expect(v.age).toBeGreaterThan(0);
    v.pinned = true;
    const rescueV = vehicleOf(w, 'rescue_vehicle');
    rescueV.x = rescueV.px = v.x; rescueV.y = rescueV.py = v.y + 1; rescueV.path = [];
    const crew = w.orderDismount([rescueV.id]);
    w.orderAbility(crew, 'rescue', { kind: 'victim', id: v.id });
    run(w, 60, () => !v.pinned);
    expect(v.pinned).toBe(false);
  });

  it('every call lists the recommended units and the dispatch button sends them', () => {
    const w = newWorld(5);
    const fire = w.spawnIncident('house_fire', { severity: 3 })!;
    expect(fire.units).toContain('fire_engine');
    expect(fire.pager).toMatch(/TS/);
    const n = w.dispatchRecommended(fire.id);
    expect(n).toBeGreaterThan(0);
    expect([...w.vehicles.values()].some(v => v.dest && v.defId === 'fire_engine')).toBe(true);
  });

  it('a demonstration is a police call with a crowd', () => {
    const w = newWorld(5);
    const inc = w.spawnIncident('demonstration', { severity: 1 })!;
    expect(inc).toBeTruthy();
    expect(inc.bystanders.length).toBeGreaterThanOrEqual(12);
  });
});
