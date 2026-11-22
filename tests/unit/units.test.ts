import { describe, expect, it } from 'vitest';
import { content, newWorld, run } from './helpers';
import { World } from '../../src/sim/world';

describe('unit state', () => {
  it('vehicles cannot drive while the crew is outside, and can after boarding', () => {
    const w = newWorld();
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    const ids = w.orderDismount([v.id]);
    expect(ids.length).toBe(5);
    w.orderMove([v.id], 40, 30);
    expect(v.path.length).toBe(0);
    expect(w.drainEvents().some(e => e.type === 'warn')).toBe(true);
    w.orderBoard([v.id]);
    run(w, 10, () => ids.every(id => w.responders.get(id)!.inVehicle));
    expect(ids.every(id => w.responders.get(id)!.inVehicle)).toBe(true);
    w.orderMove([v.id], 40, 30);
    expect(v.path.length).toBeGreaterThan(0);
  });
  it('responders on foot never enter buildings', () => {
    const w = newWorld();
    const v = [...w.vehicles.values()][0];
    const ids = w.orderDismount([v.id]);
    w.orderMove(ids, v.x + 10, v.y + 6);
    for (let i = 0; i < 300; i++) {
      w.tick();
      for (const id of ids) {
        const r = w.responders.get(id)!;
        expect(w.isBuilding(Math.floor(r.x), Math.floor(r.y))).toBe(false);
      }
    }
  });
  it('rejects abilities without the required equipment or role', () => {
    const w = newWorld();
    const car = [...w.vehicles.values()].find(x => x.defId === 'rapid_responder')!;
    const ids = w.orderDismount([car.id]);
    w.spawnIncident('crime');
    expect(w.orderAbility(ids, 'arrest')).toBe(0);
  });
  it('the traffic light alternates', () => {
    const w = newWorld();
    const a = w.lightPhase;
    run(w, 13);
    expect(w.lightPhase).not.toBe(a);
  });
  it('civilian traffic and pedestrians move without ever entering buildings', () => {
    const w = (await_import());
    for (let i = 0; i < 600; i++) w.tick();
    expect(w.civilians.some(c => c.path.length > 0)).toBe(true);
    for (const c of w.civilians) expect(w.isBuilding(Math.floor(c.x), Math.floor(c.y))).toBe(false);
    for (const p of w.pedestrians) expect(w.isBuilding(Math.floor(p.x), Math.floor(p.y))).toBe(false);
  });
});

function await_import(): World {
  return World.create(content, { seed: 4, difficulty: 'normal', freeplay: false, traffic: true });
}

describe('commander and maps', () => {
  it('a dismounted fire officer (bevelvoerder) makes nearby firefighters more effective', () => {
    const w = newWorld(5);
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    const ids = w.orderDismount([v.id]);
    const officer = ids.map(id => w.responders.get(id)!).find(r => r.role === 'fire_officer')!;
    const fighter = ids.map(id => w.responders.get(id)!).find(r => r.role === 'firefighter')!;
    expect(w.commanderNear(fighter)).toBe(true);
    expect(w.commanderNear(officer)).toBe(false);
    officer.inVehicle = true;
    expect(w.commanderNear(fighter)).toBe(false);
  });
  it('a world can be created on any validated map and remembers it in saves', () => {
    const map = { ...content.maps.default_city, id: 'copy_city', name: 'Copy' };
    const c = { ...content, maps: { ...content.maps, copy_city: map } };
    const w = World.create(c, { seed: 1, difficulty: 'easy', freeplay: false, traffic: false, mapId: 'copy_city' });
    expect(w.map.id).toBe('copy_city');
    expect(World.fromSave(c, JSON.parse(JSON.stringify(w.serialize()))).map.id).toBe('copy_city');
  });
});
