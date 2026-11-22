import { describe, expect, it } from 'vitest';
import { newWorld, run } from './helpers';
import { World as WorldCls } from '../../src/sim/world';

describe('bystanders', () => {
  it('walk away after a police dispersal and are then removed', () => {
    const w = newWorld(3);
    const inc = w.spawnIncident('car_accident', { severity: 1 })!;
    const ids = [...inc.bystanders];
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const car = [...w.vehicles.values()].find(v => v.defId === 'patrol_car')!;
    w.orderMove([car.id], inc.x, inc.y);
    run(w, 90, () => !car.path.length);
    const cops = w.orderDismount([car.id]);
    w.orderAbility(cops, 'disperse', { kind: 'incident', id: inc.id });
    run(w, 6);
    expect(ids.some(id => w.bystanders.get(id)?.leaving)).toBe(true);
    run(w, 30);
    expect(w.bystanders.size).toBe(0);
  });
  it('a right-click on a bystander picks the incident', () => {
    const w = newWorld(3);
    const inc = w.spawnIncident('car_accident', { severity: 1 })!;
    w.victims.clear();
    const by = w.bystanders.get(inc.bystanders[0])!;
    expect(w.pick(by.x, by.y)).toEqual({ kind: 'incident', id: inc.id });
  });
});

describe('reinforcements', () => {
  it('cost budget, add a vehicle with crew at the right station and are limited', () => {
    const w = newWorld(1);
    const before = w.vehicles.size, budget = w.budget;
    const v = w.callReinforcement('fire_engine')!;
    expect(v).toBeTruthy();
    expect(w.vehicles.size).toBe(before + 1);
    expect(w.budget).toBe(budget - w.reinforcementCost('fire_engine'));
    expect(v.crew.length).toBe(5);
    expect(v.stationId).toBe('fire_station');
    // a fresh vehicle can immediately be sent out
    w.orderMove([v.id], 30, 20);
    expect(v.path.length).toBeGreaterThan(0);
  });
  it('refuse when the budget is too low or the category is full', () => {
    const w = newWorld(1);
    w.budget = 100;
    expect(w.callReinforcement('aerial_ladder')).toBeNull();
    expect(w.drainEvents().some(e => e.type === 'warn' && /middelen/.test(e.message))).toBe(true);
    w.budget = 1e6;
    let n = 0;
    while (w.callReinforcement('patrol_car')) n++;
    expect(w.vehiclesOf('police').length).toBe(WorldCls.MAX_VEHICLES_PER_CATEGORY);
    expect(n).toBeGreaterThan(0);
  });
  it('reinforcements do not overlap existing vehicles', () => {
    const w = newWorld(1);
    w.budget = 1e6;
    for (let i = 0; i < 3; i++) w.callReinforcement('ambulance');
    const amb = w.vehiclesOf('ambulance');
    for (let i = 0; i < amb.length; i++) for (let j = i + 1; j < amb.length; j++) expect(Math.hypot(amb[i].x - amb[j].x, amb[i].y - amb[j].y)).toBeGreaterThanOrEqual(0.99);
  });
});

describe('return to station and fire deploy', () => {
  it('every service vehicle can return to its station parking spot, crew boarding first', () => {
    for (const defId of ['fire_engine', 'ambulance', 'patrol_car', 'tow_truck']) {
      const w = newWorld(2);
      const v = [...w.vehicles.values()].find(x => x.defId === defId)!;
      const home = { ...v.home };
      w.orderMove([v.id], 50, 30);
      run(w, 120, () => !v.path.length);
      expect(Math.hypot(v.x - home.x, v.y - home.y)).toBeGreaterThan(3);
      w.orderDismount([v.id]); // crew on foot
      expect(w.orderReturn([v.id])).toBe(1);
      run(w, 200, () => Math.hypot(v.x - (home.x + 0.5), v.y - (home.y + 0.5)) < 0.6 && !v.path.length && !v.returning);
      expect(v.crew.every(id => w.responders.get(id)!.inVehicle)).toBe(true);
      expect(Math.hypot(v.x - (home.x + 0.5), v.y - (home.y + 0.5))).toBeLessThan(0.6);
    }
  });
  it('a manual move order cancels returning', () => {
    const w = newWorld(2);
    const v = [...w.vehicles.values()][0];
    w.orderMove([v.id], 50, 30);
    run(w, 5);
    w.orderReturn([v.id]);
    expect(v.returning).toBe(true);
    w.orderMove([v.id], 40, 20);
    expect(v.returning).toBe(false);
  });
  it('"slangen aansluiten & blussen" gets the crew out and fighting immediately', () => {
    const w = newWorld(5);
    const inc = w.spawnIncident('house_fire', { severity: 1 })!;
    for (const id of inc.victims) w.victims.delete(id);
    inc.victims = [];
    const b = w.buildings.get(inc.buildingId!)!;
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    w.orderMove([v.id], b.door.x + 0.5, b.door.y + 0.5);
    run(w, 90, () => !v.path.length);
    const out = w.orderDeployFire([v.id]);
    expect(out.length).toBe(5);
    expect(out.every(id => w.responders.get(id)!.task?.type === 'extinguish')).toBe(true);
    run(w, 120, () => !w.incidents.has(inc.id));
    expect(w.solved).toBe(1);
  });
  it('deploy is ignored for vehicles without a hose and warns when there is no fire', () => {
    const w = newWorld(5);
    const amb = [...w.vehicles.values()].find(x => x.defId === 'ambulance')!;
    expect(w.orderDeployFire([amb.id])).toEqual([]);
    expect(amb.crew.every(id => w.responders.get(id)!.inVehicle)).toBe(true);
    const eng = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    w.orderDeployFire([eng.id]);
    expect(w.drainEvents().some(e => e.type === 'warn' && /geen brand/.test(e.message))).toBe(true);
  });
});

import { mergeContent } from '../../src/sim/content';
import { World } from '../../src/sim/world';
import { content as builtin } from './helpers';
import { readFileSync } from 'node:fs';

describe('missions', () => {
  it('all built-in missions reference existing incidents and can be completed or failed', () => {
    const ids = Object.keys(builtin.missions);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) for (const e of builtin.missions[id].script) expect(builtin.incidents[e.def]).toBeTruthy();
  });
  it('a mission ends in success once every scripted incident is resolved', () => {
    const w = World.create(builtin, { seed: 1, difficulty: 'normal', freeplay: false, traffic: false, missionId: 'first_shift' });
    run(w, 5);
    const inc = [...w.incidents.values()][0];
    const b = w.buildings.get(inc.buildingId!)!;
    for (const id of inc.victims) w.victims.delete(id);
    inc.victims = [];
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    w.orderMove([v.id], b.door.x + 0.5, b.door.y + 0.5);
    run(w, 90, () => !v.path.length);
    w.orderDeployFire([v.id]);
    run(w, 120, () => w.won);
    expect(w.won).toBe(true);
    expect(w.over).toBe(true);
    expect(w.drainEvents().some(e => e.type === 'mission_complete')).toBe(true);
  });
  it('a mission fails when too many incidents are lost', () => {
    const w = World.create(builtin, { seed: 1, difficulty: 'easy', freeplay: false, traffic: false, missionId: 'first_shift' });
    run(w, 600, () => w.over);
    expect(w.over).toBe(true);
    expect(w.won).toBe(false);
    expect(w.drainEvents().some(e => e.type === 'game_over' && /mislukt/.test(e.message))).toBe(true);
  });
  it('mission progress survives save and load', () => {
    const w = World.create(builtin, { seed: 1, difficulty: 'normal', freeplay: false, traffic: false, missionId: 'rush_hour' });
    run(w, 10);
    const copy = World.fromSave(builtin, JSON.parse(JSON.stringify(w.serialize())));
    expect(copy.mission?.id).toBe('rush_hour');
    run(w, 60);
    run(copy, 60);
    expect(copy.incidents.size).toBe(w.incidents.size);
  });
});

describe('LA-style example pack', () => {
  const pack = JSON.parse(readFileSync('mods/la-style-pack.json', 'utf-8'));
  it('validates and merges without errors', () => {
    const { content: c, errors } = mergeContent(builtin, pack, 'la-style-pack.json');
    expect(errors).toEqual([]);
    expect(c.vehicles.squad.crew[0].role).toBe('firefighter_paramedic');
    expect(c.incidents.freeway_pileup).toBeTruthy();
    expect(c.missions.la_pileup).toBeTruthy();
  });
  it('the multi-role squad can be bought and its crew can both fight fire and treat victims', () => {
    const { content: c } = mergeContent(builtin, pack, 'x');
    const w = World.create(c, { seed: 2, difficulty: 'normal', freeplay: false, traffic: false });
    w.budget = 5000;
    const squad = w.callReinforcement('squad')!;
    expect(squad).toBeTruthy();
    const crew = w.orderDismount([squad.id]);
    const r = w.responders.get(crew[0])!;
    expect(w.canDo(r, 'extinguish')).toBe(true);
    expect(w.canDo(r, 'treat')).toBe(true);
  });
  it('the pile-up spawns many victims, bystanders and a full road block', () => {
    const { content: c } = mergeContent(builtin, pack, 'x');
    const w = World.create(c, { seed: 2, difficulty: 'normal', freeplay: false, traffic: false });
    const inc = w.spawnIncident('freeway_pileup')!;
    expect(inc.victims.length).toBeGreaterThanOrEqual(3);
    expect(inc.bystanders.length).toBeGreaterThanOrEqual(3);
    expect(inc.obstacle.length).toBe(2);
  });
});
