import { describe, expect, it } from 'vitest';
import { newWorld, run } from './helpers';

describe('fire model', () => {
  it('grows, damages the building and destroys it when ignored', () => {
    const w = newWorld(7);
    const inc = w.spawnIncident('house_fire', { severity: 1 })!;
    const b = w.buildings.get(inc.buildingId!)!;
    const start = b.fire;
    run(w, 20);
    expect(b.fire).toBeGreaterThan(start);
    expect(b.damage).toBeGreaterThan(0);
    run(w, 300, () => b.destroyed);
    expect(b.destroyed).toBe(true);
    expect(w.failed).toBeGreaterThanOrEqual(1);
  });
  it('spreads to nearby buildings and creates a linked incident', () => {
    let spread = false;
    for (let seed = 1; seed <= 8 && !spread; seed++) {
      const w = newWorld(seed);
      w.spawnIncident('industrial_fire', { severity: 3 });
      run(w, 150, () => [...w.buildings.values()].filter(b => b.fire > 0 || b.destroyed).length > 1);
      if ([...w.buildings.values()].filter(b => b.fire > 0 || b.destroyed).length > 1) {
        spread = true;
        expect(w.incidents.size + w.failed).toBeGreaterThan(1);
      }
    }
    expect(spread).toBe(true);
  });
  it('extinguishing reduces intensity down to zero', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('house_fire', { severity: 1 })!;
    const b = w.buildings.get(inc.buildingId!)!;
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    w.orderMove([v.id], b.door.x + 0.5, b.door.y + 0.5);
    run(w, 60, () => !v.path.length);
    const ids = w.orderDismount([v.id]);
    w.orderAbility(ids, 'extinguish', { kind: 'building', id: b.id });
    run(w, 60, () => b.fire <= 0);
    expect(b.fire).toBe(0);
  });
});
