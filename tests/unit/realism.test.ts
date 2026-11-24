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
    const inc = w.spawnIncident('house_fire', { severity: 1, buildingId: [...w.buildings.values()].find(x => x.type === 'residential' && x.w <= 3 && x.h <= 3)?.id })!;
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


/** A burning building and a non-burning neighbour a street or less away (map independent). */
function burningPair(w: ReturnType<typeof newWorld>) {
  const bs = [...w.buildings.values()].filter(b => b.type !== 'station' && b.type !== 'hospital');
  for (const a of bs) for (const b of bs) {
    if (a === b) continue;
    const gap = Math.hypot(Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0), Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0));
    if (gap >= 2 && gap <= 4.5) {
      const inc = w.spawnIncident('industrial_fire', { buildingId: a.id, severity: 2 });
      if (!inc) continue;
      a.fire = 90; a.growth = 0;
      return { burning: a, neighbour: b, inc };
    }
  }
  throw new Error('no building pair');
}

describe('cooling buildings and police patrols (LA-mod inspired)', () => {
  it('crews cool a threatened neighbour: it gets wet, slows the spread, and dries out again', () => {
    const w = newWorld(4);
    const { neighbour: nb0 } = burningPair(w);
    const neighbour = nb0;
    expect(w.threatened(neighbour)).toBe(true);
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    w.orderMove([v.id], neighbour!.door.x + 0.5, neighbour!.door.y + 0.5);
    run(w, 150, () => !v.path.length);
    const ids = w.orderDismount([v.id]);
    expect(w.orderAbility(ids, 'cool', { kind: 'building', id: neighbour!.id })).toBeGreaterThan(0);
    run(w, 30);
    expect(neighbour!.wet).toBeGreaterThan(40);
    // a wet building is much harder to ignite: compare with the spread model's multiplier
    expect(1 - 0.92 * neighbour!.wet / 100).toBeLessThan(0.6);
    w.orderStop(ids);
    const wet = neighbour!.wet;
    run(w, 20);
    expect(neighbour!.wet).toBeLessThan(wet);
  });

  it('a right-click on a building that is not burning means cooling, on a burning one extinguishing', () => {
    const w = newWorld(4);
    const { burning, neighbour } = burningPair(w);
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    const ids = w.orderDismount([v.id]);
    w.contextOrder(ids, neighbour.x, neighbour.y);
    expect(w.responders.get(ids[1])!.task?.type).toBe('cool');
    w.contextOrder(ids, burning.x, burning.y);
    expect(w.responders.get(ids[1])!.task?.type).toBe('extinguish');
  });

  it('police cars patrol without sirens and the nearest one rushes to a new incident', () => {
    const w = newWorld(6);
    const car = [...w.vehicles.values()].find(v => v.defId === 'patrol_car')!;
    expect(w.orderPatrol([car.id])).toBe(1);
    run(w, 40);
    expect(car.patrol).toBe(true);
    expect(car.state).toBe('moving');
    expect(car.lights).toBe(false);
    expect(w.vehicleStatus(car)).toBe('Patrouilleert');
    const start = { x: car.x, y: car.y };
    run(w, 60);
    expect(Math.hypot(car.x - start.x, car.y - start.y)).toBeGreaterThan(5);
    const inc = w.spawnIncident('burglary', { severity: 1 })!;
    expect(inc).toBeTruthy();
    expect(car.patrol).toBe(false);
    run(w, 0.3);
    expect(car.lights).toBe(true);
    // patrols stop on any other order
    w.orderPatrol([car.id]);
    w.orderMove([car.id], car.x + 10, car.y);
    expect(car.patrol).toBe(false);
  });

  it('only vehicles that can patrol are sent', () => {
    const w = newWorld(6);
    const engine = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
    expect(w.orderPatrol([engine.id])).toBe(0);
  });
});

describe('parked vehicles line up with the road', () => {
  const aligned = (a: number) => { const m = Math.abs(((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)); return Math.min(m, Math.PI / 2 - m) < 0.05; };
  it('vehicles arriving anywhere stop along the lane, centred and out of junctions', () => {
    const w = World.create(content, { seed: 31, difficulty: 'normal', freeplay: false, traffic: false });
    const vs = [...w.vehicles.values()].slice(0, 6);
    const targets = [[40.5, 10.5], [50.5, 21.5], [30.5, 41.5], [61.5, 30.5], [20.5, 60.5], [80.5, 50.5]];
    vs.forEach((v, i) => w.orderMove([v.id], targets[i][0], targets[i][1]));
    run(w, 300, () => vs.every(v => !v.path.length));
    run(w, 3);
    for (const v of vs) {
      const tx = Math.floor(v.x), ty = Math.floor(v.y);
      if (!w.isRoad(tx, ty)) continue;
      expect(aligned(v.angle)).toBe(true);
      expect(Math.abs(v.x - (tx + 0.5))).toBeLessThan(0.21);
      expect(Math.abs(v.y - (ty + 0.5))).toBeLessThan(0.21);
      expect(w.isIntersection(tx, ty)).toBe(false);
    }
  });

  it('a vehicle halted halfway a manoeuvre straightens up and centres itself', () => {
    const w = World.create(content, { seed: 32, difficulty: 'normal', freeplay: false, traffic: false });
    const v = [...w.vehicles.values()][0];
    w.orderMove([v.id], 40.5, 10.5);
    run(w, 6);
    v.angle += 0.9; // pretend it was caught halfway a turn
    v.x += 0.3; v.y += 0.25;
    w.orderStop([v.id]);
    run(w, 3);
    const tx = Math.floor(v.x), ty = Math.floor(v.y);
    if (w.isRoad(tx, ty)) { expect(aligned(v.angle)).toBe(true); expect(Math.abs(v.x - (tx + 0.5))).toBeLessThan(0.21); expect(Math.abs(v.y - (ty + 0.5))).toBeLessThan(0.21); }
  });
});

describe('control room, random calls, ambulance return', () => {
  it('every new call carries an address and a spoken dispatch message', () => {
    const w = newWorld(11);
    const inc = w.spawnIncident('house_fire', { severity: 3 })!;
    expect(inc.address).toMatch(/\S+ \d+$/);
    const ev = w.drainEvents().find(e => e.type === 'incident_started') as { speech?: string; message: string };
    expect(ev.speech).toContain(inc.address);
    expect(ev.speech).not.toContain(inc.name); // at first the caller only gives confused first words
    for (let i = 0; i < 30 * 12; i++) w.tick();
    const next = w.drainEvents().find(e => /📟/.test(e.message)) as { speech?: string };
    expect(next.speech).toContain(inc.name);
    expect(next.speech).toContain('Prioriteit 1');
    const road = w.spawnIncident('car_accident', { severity: 1 })!;
    expect(road.address).toContain('ter hoogte van');
  });

  it('the same street keeps the same name and numbers differ along it', () => {
    const w = newWorld(11);
    const names = new Set<string>();
    for (const b of [...w.buildings.values()].slice(0, 80)) names.add(w.addressOf(b.door.x + 0.5, b.door.y + 0.5).replace(/ \d+$/, ''));
    expect(names.size).toBeGreaterThan(5);
    expect(names.size).toBeLessThan(40);
  });

  it('a new game starts with random calls and the generator does not repeat the same kinds', () => {
    const starts = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const w = World.create(content, { seed, difficulty: 'normal', freeplay: true, traffic: false, scripted: true });
      starts.add([...(w as unknown as { script: { def: string }[] }).script.map(s => s.def)].join(','));
    }
    expect(starts.size).toBeGreaterThanOrEqual(8);
    const w = World.create(content, { seed: 5, difficulty: 'hard', freeplay: true, traffic: false });
    w.reputation = 1e9;
    const seen: string[] = [];
    for (let i = 0; i < 30 * 1500; i++) { w.tick(); if (i % 150 === 0) for (const b of w.buildings.values()) b.fire = 0; /* nobody lets a fire spread unchecked: only count the generator's calls */ for (const e of w.drainEvents()) if (e.type === 'incident_started') seen.push(w.incidents.get(e.incidentId)?.defId ?? ''); }
    expect(seen.length).toBeGreaterThan(12);
    let repeats = 0;
    for (let i = 1; i < seen.length; i++) if (seen[i] === seen[i - 1]) repeats++;
    expect(repeats).toBeLessThanOrEqual(Math.ceil(seen.length * 0.12));
    expect(new Set(seen).size).toBeGreaterThanOrEqual(10);
  }, 40000);

  it('an ambulance drives back to its station after delivering a patient to the hospital', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('car_accident', { severity: 1 })!;
    const amb = [...w.vehicles.values()].find(v => v.defId === 'ambulance')!;
    const victim = [...w.victims.values()].find(x => x.incidentId === inc.id)!;
    w.orderMove([amb.id], inc.x, inc.y + 1);
    run(w, 200, () => !amb.path.length);
    const ids = w.orderDismount([amb.id]);
    w.orderAbility(ids, 'treat', { kind: 'victim', id: victim.id });
    run(w, 60, () => victim.treated);
    w.orderAbility(ids, 'carry', { kind: 'victim', id: victim.id });
    run(w, 60, () => amb.patients.length > 0);
    expect(amb.patients.length).toBe(1);
    w.orderBoard([amb.id]);
    run(w, 30, () => w.vehicles.get(amb.id)!.crew.every(id => w.responders.get(id)!.inVehicle));
    w.orderToHospital([amb.id]);
    run(w, 300, () => amb.patients.length === 0 && victim.transport === 'atHospital');
    expect(victim.transport).toBe('atHospital');
    run(w, 5);
    expect(w.vehicleStatus(amb)).toBe('Onderweg naar de kazerne');
    expect(amb.lights).toBe(false);
    run(w, 400, () => w.vehicleStatus(amb).startsWith('Gereed'));
    expect(w.vehicleStatus(amb)).toMatch(/Gereed/);
  });
});

describe('player-chosen assistants and realistic traffic', () => {
  it('a firefighter chosen by the player helps the paramedic: treatment is faster', () => {
    const treatTime = (withHelp: boolean): number => {
      const w = newWorld(9);
      const inc = w.spawnIncident('car_accident', { severity: 1 })!;
      const amb = [...w.vehicles.values()].find(v => v.defId === 'ambulance')!;
      const eng = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
      const victim = [...w.victims.values()].find(x => x.incidentId === inc.id)!;
      // put both crews next to the casualty
      const medics = w.orderDismount([amb.id]);
      const fighters = w.orderDismount([eng.id]);
      for (const id of [...medics, ...fighters]) { const r = w.responders.get(id)!; r.x = r.px = victim.x + 0.7; r.y = r.py = victim.y + 0.4; r.inVehicle = false; r.path = []; }
      expect(w.orderAbility([medics[0]], 'treat', { kind: 'victim', id: victim.id })).toBe(1);
      if (withHelp) {
        expect(w.orderAbility([fighters[0], fighters[1]], 'assist', { kind: 'victim', id: victim.id })).toBe(2);
        expect(w.responders.get(fighters[0])!.task?.type).toBe('assist');
      }
      let t = 0;
      while (!victim.treated && t < 120) { w.tick(); t += 1 / 30; }
      return t;
    };
    expect(treatTime(true)).toBeLessThan(treatTime(false) * 0.7);
  });

  it('a right-click on a casualty with a non-medic means assist, with a paramedic it means treat', () => {
    const w = newWorld(9);
    const inc = w.spawnIncident('car_accident', { severity: 1 })!;
    const victim = [...w.victims.values()].find(x => x.incidentId === inc.id)!;
    victim.pinned = false;
    const eng = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
    const amb = [...w.vehicles.values()].find(v => v.defId === 'ambulance')!;
    const f = w.orderDismount([eng.id])[1], m = w.orderDismount([amb.id])[0];
    w.contextOrder([f, m], victim.x, victim.y);
    expect(w.responders.get(f)!.task?.type).toBe('assist');
    expect(w.responders.get(m)!.task?.type).toBe('treat');
  });

  it('civilian cars accelerate and brake smoothly, queue for red lights, and cyclists are slower', () => {
    const w = World.create(content, { seed: 13, difficulty: 'normal', freeplay: false, traffic: true });
    expect(w.civilians.some(c => c.type === 'bike')).toBe(true);
    const speeds = (t: string) => w.civilians.filter(c => c.type === t).map(c => c.speed);
    expect(Math.max(...speeds('bike'))).toBeLessThan(Math.min(...speeds('car')));
    const prev = new Map<number, { v: number; x: number; y: number }>();
    let maxJerk = 0, braking = 0, moving = 0;
    for (let i = 0; i < 30 * 60; i++) {
      w.tick();
      for (const c of w.civilians) {
        const p = prev.get(c.id);
        if (p !== undefined && Math.hypot(c.x - p.x, c.y - p.y) < 2) maxJerk = Math.max(maxJerk, Math.abs(c.v - p.v) * 30); // (a respawned car jumps)
        prev.set(c.id, { v: c.v, x: c.x, y: c.y });
        if (c.braking && c.v > 0.05) braking++;
        if (c.v > 1) moving++;
      }
    }
    expect(maxJerk).toBeLessThanOrEqual(18); // tiles/s^2: no instantaneous stops from cruising speed (that would be >100)
    expect(braking).toBeGreaterThan(50);
    expect(moving).toBeGreaterThan(500);
  }, 60000);
});

describe('LA-style gameplay: spreading crews, reconnaissance, boarding, undertaker, salvage', () => {
  it('pressing treat or arrest sends each colleague to a different person', () => {
    const w = newWorld(9);
    const inc = w.spawnIncident('truck_collision', { severity: 2 })!;
    const victims = inc.victims.map(id => w.victims.get(id)!);
    expect(victims.length).toBeGreaterThanOrEqual(2);
    const amb = [...w.vehicles.values()].find(v => v.defId === 'ambulance')!;
    const medics = w.orderDismount([amb.id]);
    for (const m of medics) { const r = w.responders.get(m)!; r.x = r.px = victims[0].x; r.y = r.py = victims[0].y + 0.8; r.inVehicle = false; }
    w.orderAbility(medics, 'treat'); // no explicit target: spread over the casualties
    const targets = medics.map(m => (w.responders.get(m)!.task as { victimId: number }).victimId);
    expect(new Set(targets).size).toBe(Math.min(medics.length, victims.length));
    const inc2 = w.spawnIncident('fight', { severity: 3 }) ?? w.spawnIncident('crime', { severity: 3 })!;
    const car = [...w.vehicles.values()].find(v => v.defId === 'police_van')!;
    const cops = w.orderDismount([car.id]);
    if (inc2.suspects.length >= 2 && cops.length >= 2) {
      w.orderAbility(cops, 'arrest');
      const sus = cops.map(c => (w.responders.get(c)!.task as { suspectId?: number } | null)?.suspectId).filter(x => x !== undefined);
      expect(new Set(sus).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('after a reconnaissance the fire crew knows who is still inside; rescue needs it', () => {
    const w = newWorld(5);
    const inc = w.spawnIncident('house_fire', { severity: 1 })!;
    expect(inc.scouted).toBe(false);
    const eng = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
    const crew = w.orderDismount([eng.id]);
    const f = crew[1];
    // nobody can be rescued before it is known they are inside
    expect(w.orderAbility([f], 'rescue')).toBe(0);
    const b = w.buildings.get(inc.buildingId!)!;
    const r = w.responders.get(f)!; r.x = r.px = b.door.x + 0.5; r.y = r.py = b.door.y + 1.2;
    expect(w.orderAbility([f], 'recon')).toBe(1);
    run(w, 20, () => inc.scouted);
    expect(inc.scouted).toBe(true);
    const ev = w.drainEvents().find(e => /Verkenning/.test(e.message));
    expect(ev).toBeTruthy();
    const trapped = inc.victims.filter(id => w.victims.get(id)?.transport === 'trapped').length;
    expect(ev!.message).toContain(trapped ? 'binnen!' : 'niemand meer binnen');
    if (trapped) expect(w.orderAbility([f], 'rescue')).toBe(1);
  });

  it('a paramedic is never left behind: boarding works even when there is no walking route', () => {
    const w = newWorld(8);
    const amb = [...w.vehicles.values()].find(v => v.defId === 'ambulance')!;
    const ids = w.orderDismount([amb.id]);
    const r = w.responders.get(ids[0])!;
    r.x = r.px = amb.x + 6; r.y = r.py = amb.y + 6; r.path = [];
    w['walkTo'] = () => false; // boxed in: no route
    w.orderBoard([amb.id]);
    run(w, 5);
    expect(ids.every(id => w.responders.get(id)!.inVehicle)).toBe(true);
    w.orderToHospital([amb.id]); // (no patient: just must not crash)
  });

  it('loading is a slide-in of a couple of seconds, not instantaneous', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('car_accident', { severity: 1 })!;
    const victim = [...w.victims.values()].find(x => x.incidentId === inc.id)!;
    victim.treated = true;
    const amb = [...w.vehicles.values()].find(v => v.defId === 'ambulance')!;
    const ids = w.orderDismount([amb.id]);
    const m = w.responders.get(ids[0])!;
    m.x = m.px = victim.x + 0.5; m.y = m.py = victim.y; amb.x = amb.px = victim.x + 1.5; amb.y = amb.py = victim.y + 1;
    w.orderAbility([ids[0]], 'carry', { kind: 'victim', id: victim.id });
    run(w, 10, () => victim.loadT > 0.1);
    expect(victim.transport).toBe('carried');
    expect(victim.loadT).toBeGreaterThan(0);
    expect(victim.loadT).toBeLessThan(1);
    run(w, 6, () => victim.transport === 'inAmbulance');
    expect(victim.transport).toBe('inAmbulance');
    expect(amb.patients).toContain(victim.id);
  });

  it('the undertaker collects the dead and the incident only closes afterwards', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('car_accident', { severity: 1 })!;
    const victim = [...w.victims.values()].find(x => x.incidentId === inc.id)!;
    for (const id of inc.victims) if (id !== victim.id) w.victims.delete(id);
    inc.victims = [victim.id];
    victim.health = 0.01; victim.treated = false;
    run(w, 5);
    expect(victim.transport).toBe('dead');
    run(w, 200, () => victim.transport === 'collected');
    expect(victim.transport).toBe('collected');
    const hearse = [...w.vehicles.values()].find(v => v.defId === 'hearse')!;
    expect(hearse.patients).toContain(victim.id);
    run(w, 300, () => !w.victims.has(victim.id));
    expect(w.victims.has(victim.id)).toBe(false); // handed over at the funeral home
  });
});

describe('backup calls (LA-mod style)', () => {
  it('the commander calls the nearest free vehicle of a type; only commanders and officers may', () => {
    const w = newWorld(5);
    const cmd = [...w.vehicles.values()].find(v => v.defId === 'command_vehicle')!;
    const before = w.budget;
    const amb = w.callBackup(cmd.id, 'ambulance')!;
    expect(amb).toBeTruthy();
    expect(w.budget).toBe(before); // a free vehicle: no cost
    expect(amb.path.length).toBeGreaterThan(0);
    run(w, 1);
    expect(amb.lights).toBe(true);
    const eng = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
    expect(w.callBackup(eng.id, 'ambulance')).toBeNull(); // an engine crew cannot call backup
    expect(w.callBackup(cmd.id, 'hearse')).toBeNull(); // not in its list
  });
});

describe('P2000-style calls, GRIP and the associated vehicles', () => {
  it('has a broad set of call types, and every one can be spawned', () => {
    const ids = Object.keys(content.incidents);
    expect(ids.length).toBeGreaterThanOrEqual(50);
    for (const need of ['automatic_alarm', 'gas_leak', 'elevator_rescue', 'high_rise_fire', 'industrial_explosion', 'building_collapse', 'breathing_problem', 'overdose', 'domestic_violence', 'riot', 'flooding', 'animal_on_road', 'oil_spill', 'hazmat_leak', 'bus_crash']) expect(ids).toContain(need);
    let ok = 0;
    for (const id of ids) {
      const w = newWorld(17);
      const inc = w.spawnIncident(id, { severity: 2 });
      if (inc) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(ids.length - 2);
  });

  it('every call has a P2000 pager line with the right priority code', () => {
    const w = newWorld(5);
    const cardiac = w.spawnIncident('cardiac_arrest', { severity: 3 })!;
    expect(cardiac.pager).toMatch(/^A1 Rendam .+ \d+ Hartstilstand( [A-Za-z]+)*$/);
    const smoke = w.spawnIncident('chimney_fire', { severity: 1 })!;
    expect(smoke.pager).toMatch(/^Prio 2 BRW Rendam /);
    const fire = w.spawnIncident('house_fire', { severity: 3 })!;
    expect(fire.pager).toMatch(/^Prio 1 BRW /);
    const ev = w.drainEvents().find(e => e.type === 'incident_started' && (e as { incidentId: number }).incidentId === cardiac.id)!;
    expect(ev.message).toContain('📞 Nieuwe melding');
    for (let i = 0; i < 30 * 12; i++) w.tick();
    expect(w.drainEvents().some(e => e.message.includes('📟 A1'))).toBe(true); // the P2000 line follows when the call is clear
  });

  it('an automatic alarm is closed by a reconnaissance alone', () => {
    const w = newWorld(5);
    const inc = w.spawnIncident('automatic_alarm', { severity: 1 })!;
    const eng = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
    const crew = w.orderDismount([eng.id]);
    const b = w.buildings.get(inc.buildingId!)!;
    const r = w.responders.get(crew[1])!; r.x = r.px = b.door.x + 0.5; r.y = r.py = b.door.y + 1.0;
    expect(w.orderAbility([crew[1]], 'recon')).toBe(1);
    run(w, 20, () => !w.incidents.has(inc.id));
    expect(w.incidents.has(inc.id)).toBe(false);
    expect(w.solved).toBe(1);
  });

  it('GRIP: scaling up sends the associated units, costs money, and dissolves after the incident', () => {
    const w = newWorld(5);
    expect(w.setGrip(2)).toBe(false); // nothing to scale up for
    const inc = w.spawnIncident('high_rise_fire', { severity: 3 })!;
    const budget = w.budget;
    expect(w.setGrip(2)).toBe(true);
    expect(w.grip).toBe(2);
    expect(w.budget).toBe(budget - 600);
    run(w, 30); // the units leave one after the other
    const moving = [...w.vehicles.values()].filter(v => v.path.length > 0 || Math.hypot(v.x - (v.home.x + 0.5), v.y - (v.home.y + 0.5)) > 1).map(v => v.defId);
    for (const need of ['ovd_car', 'copi_unit', 'lgh_car', 'hazmat_unit']) expect(moving).toContain(need);
    expect(moving.filter(d => d === 'ambulance').length).toBeGreaterThanOrEqual(1);
    expect(w.setGrip(1)).toBe(true); // scale down
    expect(w.grip).toBe(1);
    // done: the structure dissolves by itself
    void inc; w.incidents.clear(); for (const b of w.buildings.values()) b.fire = 0; // everything has been handled
    run(w, 60, () => w.grip === 0);
    expect(w.grip).toBe(0);
  });

  it('a water tanker supplies engines next to it; the OvD speeds up treatment and extinguishing', () => {
    const w = newWorld(5);
    const tanker = [...w.vehicles.values()].find(v => v.defId === 'water_tanker')!;
    const eng = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
    expect(tanker.water).toBe(12000);
    eng.water = 100; eng.x = eng.px = tanker.x + 2; eng.y = eng.py = tanker.y; eng.path = [];
    run(w, 5);
    expect(eng.water).toBeGreaterThan(500);
    expect(tanker.water).toBeLessThan(12000);
    const ovd = [...w.vehicles.values()].find(v => v.defId === 'ovd_car')!;
    expect(w.vehicleDef(ovd).callable).toContain('hazmat_unit');
  });
});
