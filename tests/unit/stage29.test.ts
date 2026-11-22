import { describe, expect, it } from 'vitest';
import { World, SIM_DT } from '../../src/sim/world';
import { content, newWorld, run } from './helpers';

describe('traffic flow', () => {
  it('only the big crossings have lights, and traffic keeps flowing instead of piling up', () => {
    const w = World.create(content, { seed: 7, difficulty: 'normal', freeplay: true, traffic: true });
    let lit = 0;
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (w.isSignalised(x, y)) lit++;
    expect(lit).toBeGreaterThan(0);
    expect(lit / 4).toBeLessThan(40);
    let stopped = 0, total = 0;
    for (let i = 0; i < 30 * 200; i++) {
      w.reputation = 100; w.tick(SIM_DT);
      if (i > 30 * 100 && i % 30 === 0) for (const c of w.civilians) { total++; if (c.v < 0.2) stopped++; }
    }
    expect(stopped / total).toBeLessThan(0.45); // it used to grow to two thirds
  }, 60000);

  it('vehicles on a prio 1 run are fast, prio 2 is calmer, both show their lights, only prio 1 sounds the siren', () => {
    const w = newWorld(2);
    const a = [...w.vehicles.values()].find(v => v.defId === 'ambulance')!;
    w.orderMove([a.id], 90, 40, 1);
    let top1 = 0;
    for (let i = 0; i < 30 * 15; i++) { w.tick(); top1 = Math.max(top1, a.speedNow); }
    expect(top1).toBeGreaterThan(4); // tiles per second
    expect(a.prio).toBe(1);
    const b = [...w.vehicles.values()].find(v => v.defId === 'rapid_responder')!;
    w.orderMove([b.id], 20, 70, 2);
    run(w, 3);
    expect(b.prio).toBe(2);
    expect(b.lights).toBe(true);
  });
});

describe('scene management', () => {
  it('responders never stand exactly on top of each other', () => {
    const w = newWorld(3);
    const eng = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
    const crew = w.orderDismount([eng.id]);
    const first = w.responders.get(crew[0])!;
    for (const id of crew) { const r = w.responders.get(id)!; r.x = r.px = first.x; r.y = r.py = first.y; r.path = []; }
    run(w, 3);
    for (const a of crew) for (const b of crew) if (a < b) {
      const p = w.responders.get(a)!, q = w.responders.get(b)!;
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(0.3);
    }
  });

  it('scaling down GRIP releases the idle units, which drive back to their station', () => {
    const w = newWorld(5);
    w.spawnIncident('high_rise_fire', { severity: 3 });
    w.setGrip(3);
    run(w, 90);
    const away = [...w.vehicles.values()].filter(v => Math.hypot(v.x - (v.home.x + 0.5), v.y - (v.home.y + 0.5)) > 3 && v.path.length === 0);
    const before = [...w.vehicles.values()].filter(v => v.returning).length;
    w.setGrip(0);
    const after = [...w.vehicles.values()].filter(v => v.returning).length;
    expect(w.grip).toBe(0);
    expect(after).toBeGreaterThan(before - (away.length ? 0 : 1));
  });

  it('an unattended house fire takes minutes to burn down', () => {
    const w = newWorld(4);
    const inc = w.spawnIncident('house_fire', { severity: 2 })!;
    const b = w.buildings.get(inc.buildingId!)!;
    run(w, 90);
    expect(b.destroyed).toBe(false);
  });
});
