import { describe, expect, it } from 'vitest';
import { newWorld, run } from './helpers';

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
    run(w, 10);
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

import { World } from '../../src/sim/world';
import { content } from './helpers';
function await_import(): World {
  return World.create(content, { seed: 4, difficulty: 'normal', freeplay: false, traffic: true });
}
