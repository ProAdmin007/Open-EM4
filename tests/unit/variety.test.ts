import { describe, expect, it } from 'vitest';
import { World, sevFactor } from '../../src/sim/world';
import { createSnapshot } from '../../src/sim/snapshot';
import { TILE_METERS, buildingHeightMeters, headingToYaw, tileToWorld3D, vehicleDimensions, world3DToTile } from '../../src/sim/space';
import { content, newWorld, run } from './helpers';

describe('bigger, more varied city', () => {
  const map = content.maps.default_city;
  it('is at least twice the old size (64x48) in each direction... or area', () => {
    expect(map.width * map.height).toBeGreaterThanOrEqual(2 * 64 * 48);
    expect(map.width).toBeGreaterThanOrEqual(100);
    expect(map.height).toBeGreaterThanOrEqual(70);
  });
  it('has many buildings of many kinds, several stations per service, two hospitals and water', () => {
    expect(map.buildings.length).toBeGreaterThanOrEqual(150);
    expect(new Set(map.buildings.map(b => b.type)).size).toBeGreaterThanOrEqual(9);
    for (const cat of ['fire', 'ambulance', 'police'] as const) expect(map.stations.filter(s => s.category === cat).length).toBeGreaterThanOrEqual(2);
    expect(map.buildings.filter(b => b.type === 'hospital').length).toBeGreaterThanOrEqual(2);
    expect(map.rows.join('')).toContain('W');
  });
  it('water can be neither walked nor driven on', () => {
    const w = newWorld(1);
    let found = 0;
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (w.isWater(x, y)) { found++; expect(w.isWalkable(x, y)).toBe(false); expect(w.isDrivable(x, y)).toBe(false); }
    expect(found).toBeGreaterThan(10);
  });
  it('every building has a reachable door and every station has parking bays', () => {
    const w = newWorld(1);
    for (const b of w.buildings.values()) expect(w.isWalkable(b.door.x, b.door.y)).toBe(true);
    for (const st of map.stations) expect(st.bays?.length).toBeGreaterThanOrEqual(st.fleet.length);
  });
  it('a reinforcement goes to the next station of the service when the first has no free bay', () => {
    const w = newWorld(1);
    w.budget = 1e7;
    const fireStations = new Set<string>();
    for (let i = 0; i < 9; i++) { const v = w.callReinforcement('fire_engine'); if (v) fireStations.add(v.stationId); }
    expect(fireStations.size).toBe(2);
  });
});

describe('incident variety', () => {
  const defs = Object.values(content.incidents);
  it('offers many kinds, with at least six different medical emergencies', () => {
    expect(defs.length).toBeGreaterThanOrEqual(20);
    const medical = defs.filter(d => d.category === 'ambulance' && d.spawn.on === 'building' && d.victims?.location === 'scene' && !d.fire);
    expect(medical.length).toBeGreaterThanOrEqual(6);
    expect(new Set(medical.map(d => d.victims!.condition)).size).toBe(medical.length);
    expect(defs.filter(d => d.category === 'fire').length).toBeGreaterThanOrEqual(5);
    expect(defs.filter(d => d.category === 'police').length).toBeGreaterThanOrEqual(5);
    expect(defs.filter(d => d.category === 'tech').length).toBeGreaterThanOrEqual(3);
  });
  it('every incident definition can be spawned on the default map and has flavour text', () => {
    for (const d of defs) {
      const w = newWorld(3);
      const inc = w.spawnIncident(d.id);
      expect(inc, d.id).not.toBeNull();
      expect(inc!.description.length, d.id).toBeGreaterThan(5);
    }
  });
  it('random freeplay produces a wide mix of incident types', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const w = World.create(content, { seed, difficulty: 'hard', freeplay: true, traffic: false });
      w.reputation = 1e9;
      for (let i = 0; i < 30 * 900; i++) {
        w.tick();
        for (const inc of w.incidents.values()) seen.add(inc.defId);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(14);
  }, 30000);
});

describe('severity changes how long things take', () => {
  it('treatment takes longer for higher severity and differs per medical condition', () => {
    const treat = (def: string, sev: number) => {
      const w = newWorld(4);
      const inc = w.spawnIncident(def, { severity: sev })!;
      return w.victims.get(inc.victims[0])!.treatTime;
    };
    expect(treat('fall_injury', 3)).toBeGreaterThan(treat('fall_injury', 1) * 1.5);
    expect(treat('choking', 1)).toBeLessThan(treat('fall_injury', 1));
    expect(treat('fall_injury', 1)).toBeLessThan(treat('cardiac_arrest', 1));
    expect(treat('childbirth', 1)).toBeGreaterThan(treat('cardiac_arrest', 1));
  });
  it('arrests take longer for armed or more serious suspects', () => {
    const arrest = (def: string, sev: number) => {
      const w = newWorld(4);
      const inc = w.spawnIncident(def, { severity: sev })!;
      return w.suspects.get(inc.suspects[0])!.arrestTime;
    };
    expect(arrest('burglary', 3)).toBeGreaterThan(arrest('burglary', 1));
    expect(arrest('armed_robbery', 2)).toBeGreaterThan(arrest('burglary', 2) * 1.5);
    expect(arrest('vandalism', 1)).toBeLessThan(arrest('burglary', 1));
  });
  it('heavier wrecks take longer to clear', () => {
    const clearTime = (def: string, sev: number) => {
      const w = newWorld(5);
      const inc = w.spawnIncident(def, { severity: sev })!;
      const truck = [...w.vehicles.values()].find(v => v.defId === 'tow_truck')!;
      w.orderMove([truck.id], inc.x, inc.y);
      run(w, 120, () => !truck.path.length);
      const crew = w.orderDismount([truck.id]);
      w.orderAbility(crew, 'clear', { kind: 'incident', id: inc.id });
      const t0 = w.time;
      run(w, 200, () => inc.cleared);
      return inc.cleared ? w.time - t0 : Infinity;
    };
    const tree = clearTime('fallen_tree', 1), block = clearTime('road_blockage', 1), heavy = clearTime('broken_down_truck', 1), heavySevere = clearTime('road_blockage', 2);
    expect(tree).toBeLessThan(block);
    expect(block).toBeLessThan(heavy);
    expect(heavySevere).toBeGreaterThan(block);
  });
  it('fires of different kinds and severity are harder to put out', () => {
    const w = newWorld(6);
    const house = w.buildings.get(w.spawnIncident('house_fire', { severity: 1 })!.buildingId!)!;
    const houseSevere = w.buildings.get(w.spawnIncident('house_fire', { severity: 3 })!.buildingId!)!;
    const warehouse = w.buildings.get(w.spawnIncident('warehouse_fire', { severity: 1 })!.buildingId!)!;
    expect(houseSevere.resistance).toBeGreaterThan(house.resistance);
    expect(warehouse.resistance).toBeGreaterThan(house.resistance);
    expect(sevFactor(3)).toBeGreaterThan(sevFactor(2));
  });
  it('the actual extinguishing takes longer on a severe fire than on a mild one', () => {
    const extinguishTime = (sev: number) => {
      const w = newWorld(8);
      const inc = w.spawnIncident('house_fire', { severity: sev })!;
      for (const id of inc.victims) w.victims.delete(id);
      inc.victims = [];
      const b = w.buildings.get(inc.buildingId!)!;
      b.fire = 40; // same starting intensity, only the resistance differs
      const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
      w.orderMove([v.id], b.door.x + 0.5, b.door.y + 0.5);
      run(w, 120, () => !v.path.length);
      b.fire = 40;
      b.growth = 0; // isolate the effect of the resistance
      const crew = w.orderDismount([v.id]);
      w.orderAbility(crew, 'extinguish', { kind: 'building', id: b.id });
      const t0 = w.time;
      run(w, 120, () => b.fire <= 0);
      return w.time - t0;
    };
    expect(extinguishTime(3)).toBeGreaterThan(extinguishTime(1));
  });
});

describe('3D preparation', () => {
  it('converts between tile space and metres and back', () => {
    const p = tileToWorld3D(10, 20, 3);
    expect(p).toEqual({ x: 10 * TILE_METERS, y: 3, z: 20 * TILE_METERS });
    expect(world3DToTile(p)).toEqual({ x: 10, y: 20 });
    expect(headingToYaw(Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });
  it('gives realistic real-world dimensions', () => {
    const engine = vehicleDimensions(content.vehicles.fire_engine);
    expect(engine.length).toBeGreaterThan(7);
    expect(engine.length).toBeLessThan(11);
    expect(vehicleDimensions(content.vehicles.police_motorcycle).width).toBeLessThan(1.2);
    const tower = content.maps.default_city.buildings.find(b => b.type === 'office')!;
    expect(buildingHeightMeters(tower)).toBeGreaterThan(20);
  });
  it('builds an interpolated, renderer-agnostic snapshot of the world', () => {
    const w = World.create(content, { seed: 2, difficulty: 'normal', freeplay: false, traffic: true });
    const v = [...w.vehicles.values()][0];
    w.orderMove([v.id], 50, 30);
    w.tick();
    const mid = createSnapshot(w, 0.5), end = createSnapshot(w, 1);
    const sv = mid.vehicles.find(x => x.id === v.id)!, ev = end.vehicles.find(x => x.id === v.id)!;
    expect(sv.model).toBe('vehicle/' + v.defId);
    expect(ev.x).toBeCloseTo(v.x);
    expect(sv.x).toBeGreaterThanOrEqual(Math.min(v.px, v.x) - 1e-9);
    expect(sv.x).toBeLessThanOrEqual(Math.max(v.px, v.x) + 1e-9);
    expect(ev.position.x).toBeCloseTo(v.x * TILE_METERS);
    expect(ev.position.z).toBeCloseTo(v.y * TILE_METERS);
    expect(ev.size.length).toBeGreaterThan(5);
    expect(end.buildings.length).toBe(w.buildings.size);
    expect(end.buildings[0].heightMeters).toBeGreaterThan(0);
    expect(end.cars.length).toBeGreaterThan(20);
    expect(end.people.length).toBeGreaterThan(20);
    // crew inside vehicles is not part of the visible people
    expect(end.people.some(p => p.kind === 'responder')).toBe(false);
  });
  it('a model override in a definition is used', () => {
    const c = { ...content, vehicles: { ...content.vehicles, fire_engine: { ...content.vehicles.fire_engine, model: 'custom/engine.glb' } } };
    const w = World.create(c, { seed: 1, difficulty: 'normal', freeplay: false, traffic: false });
    expect(createSnapshot(w).vehicles.find(x => x.model === 'custom/engine.glb')).toBeTruthy();
  });
});
