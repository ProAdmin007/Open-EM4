import { describe, expect, it } from 'vitest';
import { newWorld } from './helpers';

describe('call questions, hospital beds, light unit', () => {
  it('questioning the caller grows the recommended units for a big incident', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('bus_crash', { severity: 3 }) ?? w.spawnIncident('truck_collision', { severity: 3 });
    expect(inc).toBeTruthy();
    const before = inc!.units.length;
    expect(inc!.questioned).toBe(false);
    expect(w.questionCaller(inc!.id)).toBe(true);
    expect(w.questionCaller(inc!.id)).toBe(false);
    expect(inc!.units.length).toBeGreaterThanOrEqual(before);
    expect(inc!.units.filter(u => u === 'ambulance').length).toBeGreaterThanOrEqual(1);
  });

  it('a hospital has a limited number of beds that free up again', () => {
    const w = newWorld(8);
    const h = [...w.buildings.values()].find(b => b.type === 'hospital')!;
    expect(w.bedsFree(h)).toBe(4);
    w.hospitalBeds.set(h.id, [w.time + 100, w.time + 100, w.time + 100, w.time + 100]);
    expect(w.bedsFree(h)).toBe(0);
    w.time += 200;
    expect(w.bedsFree(h)).toBe(4);
  });

  it('at night a scene is only lit with a parked light unit', () => {
    const w = newWorld(8);
    w.time = 936; // midnight
    expect(w.isNight).toBe(true);
    const lu = [...w.vehicles.values()].find(v => v.defId === 'light_unit');
    expect(lu).toBeTruthy();
    expect(w.sceneLit(lu!.x + 3, lu!.y)).toBe(true);
    expect(w.sceneLit(lu!.x + 60, lu!.y)).toBe(false);
    w.time = 0;
    expect(w.sceneLit(lu!.x + 60, lu!.y)).toBe(true);
  });
});
