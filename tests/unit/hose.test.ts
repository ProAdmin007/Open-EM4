import { describe, expect, it } from 'vitest';
import { newWorld } from './helpers';

describe('hose laid along the walked route', () => {
  it('a firefighter pulling a hose leaves a trail from the engine, and it is rolled up when they board', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('house_fire', { severity: 2 })!;
    w.questionCaller(inc.id);
    w.dispatchRecommended(inc.id);
    const eng = [...w.vehicles.values()].find(v => v.defId === 'fire_engine' && v.dest)!;
    for (let i = 0; i < 30 * 120 && eng.path.length; i++) w.tick();
    expect(eng.path.length).toBe(0);
    const out = w.orderDeployFire([eng.id]);
    expect(out.length).toBeGreaterThan(0);
    let maxTrail = 0;
    for (let i = 0; i < 30 * 40; i++) { w.tick(); for (const id of out) maxTrail = Math.max(maxTrail, w.responders.get(id)!.trail?.length ?? 0); }
    expect(maxTrail).toBeGreaterThan(2);
    const r = w.responders.get(out[0])!;
    const first = r.trail?.[0];
    if (first) expect(Math.hypot(first.x - eng.x, first.y - eng.y)).toBeLessThan(3); // starts at the engine
    w.orderBoard([eng.id]);
    for (let i = 0; i < 30 * 40; i++) w.tick();
    for (const id of out) { const rr = w.responders.get(id)!; if (rr.inVehicle) expect(rr.trail).toBeUndefined(); }
  });
});
