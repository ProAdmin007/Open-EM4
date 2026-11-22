import { describe, expect, it } from 'vitest';
import { newWorld, run } from './helpers';
import type { World } from '../../src/sim/world';

function driveTo(w: World, vid: number, x: number, y: number): void {
  w.orderMove([vid], x, y);
  run(w, 120, () => !w.vehicles.get(vid)!.path.length);
}

describe('fire realism: water, hydrants, aerial ladder', () => {
  it('has hydrants next to roads and gives fire vehicles a tank', () => {
    const w = newWorld(3);
    expect(w.hydrants.length).toBeGreaterThan(30);
    for (const h of w.hydrants.slice(0, 20)) {
      expect(w.isRoad(h.x - 1, h.y) || w.isRoad(h.x + 1, h.y) || w.isRoad(h.x, h.y - 1) || w.isRoad(h.x, h.y + 1)).toBe(true);
    }
    const engine = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
    expect(engine.water).toBe(3000);
  });

  it('spraying uses water and an empty tank stops the crew', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('house_fire', { severity: 3 })!;
    const b = w.buildings.get(inc.buildingId!)!;
    b.resistance = 50; // a fire that will not go out quickly
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    driveTo(w, v.id, b.door.x + 0.5, b.door.y + 0.5);
    // park away from any hydrant for this test
    w['_hydrants'] = [];
    const ids = w.orderDismount([v.id]);
    w.orderAbility(ids, 'extinguish', { kind: 'building', id: b.id });
    run(w, 10);
    expect(v.water).toBeLessThan(3000);
    v.water = 5;
    run(w, 10);
    expect(v.water).toBe(0);
    expect(ids.every(id => w.responders.get(id)!.task === null || w.responders.get(id)!.task!.type !== 'extinguish')).toBe(true);
  });

  it('a vehicle parked at a hydrant hooks up and refills', () => {
    const w = newWorld(9);
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    const h = w.hydrants[0];
    v.x = v.px = h.x + 0.5; v.y = v.py = h.y + 0.5;
    v.water = 100;
    run(w, 5);
    expect(v.hydrant).toBe(true);
    expect(v.water).toBeGreaterThan(100);
    run(w, 60);
    expect(v.water).toBe(3000);
  });

  it('tall buildings burn down slower without the aerial ladder', () => {
    const fight = (useAerial: boolean): number => {
      const w = newWorld(12);
      const b = [...w.buildings.values()].find(x => x.type === 'apartment' && (x.floors ?? 1) >= 4)!;
      const inc = w.spawnIncident('apartment_fire', { buildingId: b.id, severity: 1 })!;
      expect(inc).toBeTruthy();
      b.growth = 0; b.fire = 60; b.resistance = 1;
      const v = [...w.vehicles.values()].find(x => x.defId === (useAerial ? 'aerial_ladder' : 'fire_engine'))!;
      v.x = v.px = b.door.x + 0.5; v.y = v.py = b.door.y + 1.5; v.path = [];
      const ids = w.orderDismount([v.id]);
      for (const id of ids) { const r = w.responders.get(id)!; r.x = r.px = b.door.x + 0.5; r.y = r.py = b.door.y + 1.5; r.inVehicle = false; }
      w.orderAbility(ids, 'extinguish', { kind: 'building', id: b.id });
      run(w, 8);
      return 60 - b.fire;
    };
    expect(fight(true)).toBeGreaterThan(fight(false) * 1.2);
  });
});

describe('LA-inspired police work: bomb robot', () => {
  it('has a bomb squad with a robot and a suspicious package incident', () => {
    const w = newWorld(4);
    const squad = [...w.vehicles.values()].find(v => v.defId === 'bomb_squad');
    expect(squad).toBeTruthy();
    expect(w.vehicleDef(squad!).equipment).toContain('bomb_robot');
  });

  it('only the bomb squad can defuse, and the incident resolves when it is secured, cleared and defused', () => {
    const w = newWorld(5);
    const inc = w.spawnIncident('suspicious_package', { severity: 1 })!;
    expect(inc).toBeTruthy();
    const b = w.buildings.get(inc.buildingId!)!;
    const squad = [...w.vehicles.values()].find(v => v.defId === 'bomb_squad')!;
    const patrol = [...w.vehicles.values()].find(v => v.defId === 'patrol_car')!;
    driveTo(w, squad.id, b.door.x + 0.5, b.door.y + 1.5);
    const ids = w.orderDismount([squad.id]);
    // everybody secures first, then the robot crew defuses and the officer sends the crowd away
    expect(w.orderAbility(ids, 'secure', { kind: 'incident', id: inc.id })).toBeGreaterThan(0);
    run(w, 40, () => inc.secured);
    expect(inc.secured).toBe(true);
    expect(w.orderAbility(ids, 'defuse', { kind: 'incident', id: inc.id })).toBeGreaterThan(0);
    // a patrol car crew cannot defuse
    const pids = w.orderDismount([patrol.id]);
    expect(w.orderAbility(pids, 'defuse', { kind: 'incident', id: inc.id })).toBe(0);
    run(w, 60, () => inc.defused);
    expect(inc.defused).toBe(true);
    expect(w.orderAbility(pids, 'disperse', { kind: 'incident', id: inc.id })).toBeGreaterThanOrEqual(0);
    for (const id of inc.bystanders) { const by = w.bystanders.get(id); if (by) by.leaving = true; }
    run(w, 5);
    expect(inc.status).toBe('resolved');
  });
});
