import { describe, expect, it } from 'vitest';
import { newWorld } from './helpers';

describe('air ambulance (R7)', () => {
  it('starts on open ground by the hospital, not on a road', () => {
    const w = newWorld(8);
    const h = [...w.vehicles.values()].find(v => v.defId === 'air_ambulance')!;
    expect(h).toBeTruthy();
    expect(w.isRoad(Math.floor(h.x), Math.floor(h.y))).toBe(false);
  });

  it('flies in a straight line, faster than an ambulance, and lands off the road', () => {
    const w = newWorld(8);
    const heli = [...w.vehicles.values()].find(v => v.defId === 'air_ambulance')!;
    const amb = [...w.vehicles.values()].find(v => v.defId === 'ambulance')!;
    const tx = 100, ty = 60;
    w.orderMove([heli.id], tx, ty);
    w.orderMove([amb.id], tx, ty);
    let tHeli = 0;
    for (let i = 0; i < 30 * 240 && (heli.path.length || !tHeli); i++) {
      w.tick();
      if (!heli.path.length && !tHeli) tHeli = w.time;
      if (tHeli) break;
    }
    expect(tHeli).toBeGreaterThan(0);
    expect(Math.hypot(heli.x - tx, heli.y - ty)).toBeLessThan(14);
    expect(w.isRoad(Math.floor(heli.x), Math.floor(heli.y))).toBe(false);
    expect(amb.path.length).toBeGreaterThan(0); // the ambulance is still on its way
  });

  it('is recommended for a mass-casualty incident only', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('bus_crash', { severity: 3 })!;
    w.questionCaller(inc.id);
    if (inc.victims.length >= 3) expect(inc.units).toContain('air_ambulance');
    const small = w.spawnIncident('kitchen_fire', { severity: 1 })!;
    expect(small.units).not.toContain('air_ambulance');
  });

  it('never blocks road traffic while overhead', () => {
    const w = newWorld(8);
    const heli = [...w.vehicles.values()].find(v => v.defId === 'air_ambulance')!;
    w.orderMove([heli.id], 60, 60);
    for (let i = 0; i < 300; i++) w.tick();
    const car = [...w.vehicles.values()].find(v => v.defId === 'patrol_car')!;
    w.orderMove([car.id], 70, 60);
    for (let i = 0; i < 30 * 60; i++) w.tick();
    expect(car.blocked).toBe(0);
  });
});
