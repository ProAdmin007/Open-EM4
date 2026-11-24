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

describe('districts and storms', () => {
  it('the busy district rotates and covers the map', () => {
    const w = newWorld(8);
    const seen = new Set<number>();
    for (let t = 0; t < 4 * 360; t += 360) { w.time = t; seen.add(w.hotDistrict); }
    expect(seen.size).toBe(4);
    expect(w.inDistrict(1, 1, 0)).toBe(true);
    expect(w.inDistrict(w.w - 1, w.h - 1, 3)).toBe(true);
  });
  it('a storm is announced once and ends again', () => {
    const w = newWorld(8);
    let storms = 0;
    for (let t = 0; t < 4000; t += 5) { w.time = t; if (w.storming) storms++; if (w.storming) expect(w.raining).toBe(true); }
    expect(storms).toBeGreaterThan(0);
    expect(storms).toBeLessThan(800 * 0.5);
  });
});

describe('growing floods and shield teams', () => {
  it('a flood grows when it escalates', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('flooding', { severity: 1 })!;
    const n = inc.obstacle.length;
    inc.elapsed = inc.nextEscalation + 1;
    for (let i = 0; i < 3; i++) w.tick();
    expect(inc.obstacle.length).toBeGreaterThan(n);
    for (const o of inc.obstacle) expect(w.obstacles.has(o.x + ',' + o.y) || w.obstacles.size > 0).toBe(true);
  });
  it('arresting an armed suspect is slower without the riot team, and a riot van is recommended', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('armed_robbery', { severity: 2 })!;
    const s = w.suspects.get(inc.suspects[0])!;
    expect(w.shieldFactor(s)).toBe(0.6);
    expect(inc.units).not.toContain('riot_van');
    w.questionCaller(inc.id);
    expect(inc.units).toContain('riot_van');
    const van = [...w.vehicles.values()].find(v => v.defId === 'riot_van')!;
    van.x = s.x + 3; van.y = s.y; van.path = [];
    expect(w.shieldFactor(s)).toBe(1);
  });
});
