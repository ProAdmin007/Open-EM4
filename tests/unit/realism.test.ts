import { describe, expect, it } from 'vitest';
import { newWorld, run } from './helpers';
import { World } from '../../src/sim/world';
import { content } from './helpers';

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

describe('explosion and cordons', () => {
  it('an unattended suspicious package explodes: damage, a fire incident and injured bystanders', () => {
    const w = newWorld(5);
    const inc = w.spawnIncident('suspicious_package', { severity: 1 })!;
    const b = w.buildings.get(inc.buildingId!)!;
    const events: string[] = [];
    run(w, 400, () => { events.push(...w.drainEvents().map(e => e.type)); return inc.status === 'failed'; });
    events.push(...w.drainEvents().map(e => e.type));
    expect(inc.status).toBe('failed');
    expect(events).toContain('explosion');
    expect(w.explosions.length).toBe(1);
    expect(b.damage).toBeGreaterThan(30);
    const fire = [...w.incidents.values()].find(i => i.buildingId === b.id);
    expect(fire).toBeTruthy();
    expect(b.fire).toBeGreaterThan(0);
    expect(fire!.victims.length).toBeGreaterThan(0);
  });

  it('a defused package does not explode', () => {
    const w = newWorld(5);
    const inc = w.spawnIncident('suspicious_package', { severity: 1 })!;
    inc.defused = true; inc.secured = true;
    for (const id of inc.bystanders) { const by = w.bystanders.get(id); if (by) by.leaving = true; }
    run(w, 10);
    expect(w.explosions.length).toBe(0);
    expect(inc.status).toBe('resolved');
  });

  it('securing a scene closes the road to civilian cars, which re-route', () => {
    const w = World.create(content, { seed: 21, difficulty: 'normal', freeplay: false, traffic: true });
    const inc = w.spawnIncident('car_accident', { severity: 1 })!;
    inc.secured = true;
    w.rebuildCordon();
    expect(w.cordon.size).toBeGreaterThan(4);
    run(w, 5); // cars already inside may drive out
    const entered = new Set<number>();
    const key = (x: number, y: number) => y * 4096 + x;
    const start = new Set(w.civilians.filter(c => w.cordon.has(key(Math.floor(c.x), Math.floor(c.y)))).map(c => c.id));
    for (let i = 0; i < 30 * 40; i++) {
      w.tick();
      for (const c of w.civilians) if (!start.has(c.id) && w.cordon.has(key(Math.floor(c.x), Math.floor(c.y)))) entered.add(c.id);
    }
    expect(entered.size).toBe(0);
    inc.secured = false; inc.status = 'resolved';
    w.rebuildCordon();
    expect(w.cordon.size).toBe(0);
  });
});

describe('vehicle status, sirens and crews walking up to the fire', () => {
  it('shows en-route / on-scene / returning, and returns without sirens', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('house_fire', { severity: 1 })!;
    const b = w.buildings.get(inc.buildingId!)!;
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    expect(w.vehicleStatus(v)).toMatch(/Gereed/);
    w.orderMove([v.id], b.door.x + 0.5, b.door.y + 0.5);
    run(w, 2);
    expect(v.lights).toBe(true);
    expect(w.vehicleStatus(v)).toBe(`Aanrijdend naar ${inc.name}`);
    run(w, 120, () => !v.path.length);
    run(w, 1);
    expect(w.vehicleStatus(v)).toBe(`Ter plaatse bij ${inc.name}`);
    b.fire = 0; inc.status = 'resolved'; w.incidents.delete(inc.id);
    w.orderReturn([v.id]);
    run(w, 3);
    expect(v.state).toBe('moving');
    expect(v.lights).toBe(false);
    expect(w.vehicleStatus(v)).toBe('Onderweg naar de kazerne');
    run(w, 200, () => v.state === 'idle');
    expect(w.vehicleStatus(v)).toMatch(/Gereed/);
    // a fresh order switches the lights back on
    w.orderMove([v.id], b.door.x + 0.5, b.door.y + 0.5);
    run(w, 2);
    expect(v.lights).toBe(true);
  });

  it('firefighters walk up to the burning building', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('house_fire', { severity: 1 })!;
    const b = w.buildings.get(inc.buildingId!)!;
    b.resistance = 80;
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    w.orderMove([v.id], b.door.x + 0.5, b.door.y + 0.5);
    run(w, 120, () => !v.path.length);
    const ids = w.orderDismount([v.id]);
    w.orderAbility(ids, 'extinguish', { kind: 'building', id: b.id });
    run(w, 25);
    const rd = (r: { x: number; y: number }) => Math.hypot(Math.max(b.x - r.x, 0, r.x - (b.x + b.w)), Math.max(b.y - r.y, 0, r.y - (b.y + b.h)));
    const fighters = ids.map(id => w.responders.get(id)!).filter(r => r.task?.type === 'extinguish');
    expect(fighters.length).toBeGreaterThan(0);
    for (const r of fighters) expect(rd(r)).toBeLessThanOrEqual(2.7);
  });
});
