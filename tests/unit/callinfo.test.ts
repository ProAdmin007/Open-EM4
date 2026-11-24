import { describe, expect, it } from 'vitest';
import { newWorld } from './helpers';

describe('progressive caller information (112 / 911 style)', () => {
  it('a call starts vague and the caller tells more as time passes', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('house_fire', { severity: 2 })!;
    expect(inc.callStage).toBe(0);
    expect(inc.questioned).toBe(false);
    expect(inc.callLog.length).toBe(1);
    expect(inc.callLog[0]).not.toContain(inc.name);
    const stages: number[] = [];
    for (let i = 0; i < 30 * 45; i++) { w.tick(); if (stages[stages.length - 1] !== inc.callStage) stages.push(inc.callStage); }
    expect(stages).toEqual([0, 1, 2, 3]);
    expect(inc.callLog.length).toBe(4);
    expect(inc.questioned).toBe(true);
  });

  it('only the final stage reveals the real number of casualties in the recommended units', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('bus_crash', { severity: 3 }) ?? w.spawnIncident('truck_collision', { severity: 3 })!;
    const prelim = inc.units.filter(u => u === 'ambulance').length;
    expect(prelim).toBeLessThanOrEqual(1);
    for (let i = 0; i < 30 * 15; i++) w.tick();
    expect(inc.callStage).toBeLessThan(3);
    expect(inc.units.filter(u => u === 'ambulance').length).toBe(prelim);
    for (let i = 0; i < 30 * 30; i++) w.tick();
    expect(inc.callStage).toBe(3);
    expect(inc.units.length).toBeGreaterThanOrEqual(1);
  });

  it('asking again gets everything at once', () => {
    const w = newWorld(8);
    const inc = w.spawnIncident('house_fire', { severity: 2 })!;
    expect(w.questionCaller(inc.id)).toBe(true);
    expect(inc.callStage).toBe(3);
    expect(inc.callLog.length).toBe(4);
    expect(w.questionCaller(inc.id)).toBe(false);
  });
});
