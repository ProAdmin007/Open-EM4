import { describe, expect, it } from 'vitest';
import { newWorld, roadNear, run } from './helpers';

describe('arrest: pistol, fleeing suspects, transport', () => {
  it('a running suspect is covered with a pistol, gives up, is cuffed, put in the patrol car and booked at the station', () => {
    const w = newWorld(6);
    const inc = w.spawnIncident('armed_robbery', { severity: 1 })!;
    const s = w.suspects.get(inc.suspects[0])!;
    s.runner = true; s.obey = true; s.arrestTime = 2;
    const car = [...w.vehicles.values()].find(v => v.defId === 'patrol_car')!;
    car.path = []; car.dest = null;
    // park the patrol car beside the suspect on the road (any nearby free road tile)
    const t = roadNear(w, s.x, s.y);
    car.x = car.px = t.x + 0.5; car.y = car.py = t.y + 0.5; car.angle = w.laneAngle(t.x, t.y);
    const out = w.orderDismount([car.id]);
    const cop = w.responders.get(out[0])!;
    cop.x = cop.px = s.x - 4; cop.y = cop.py = s.y; cop.path = [];
    expect(w.orderAbility([cop.id], 'arrest', { kind: 'suspect', id: s.id })).toBeGreaterThan(0);
    let sawFlee = false, sawAim = false;
    for (let i = 0; i < 30 * 90 && !s.arrested; i++) { w.tick(); if (s.mode === 'flee') sawFlee = true; if (cop.aiming !== null) sawAim = true; }
    expect(sawFlee).toBe(true);
    expect(sawAim).toBe(true);
    expect(s.arrested).toBe(true);
    run(w, 60, () => s.mode === 'boarded');
    expect(s.mode).toBe('boarded');
    expect(car.prisoners).toContain(s.id);
    w.orderBoard([car.id]);
    run(w, 15);
    expect(w.orderToHospital([car.id])).toBe(1);
    run(w, 240, () => car.prisoners.length === 0);
    expect(car.prisoners.length).toBe(0);
    expect(w.suspects.has(s.id)).toBe(false);
  }, 60000);
});
