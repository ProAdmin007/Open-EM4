import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/world';
import { content, newWorld, run } from './helpers';
import { mergeContent, validateIncident, validateVehicle } from '../../src/sim/content';

describe('save / load', () => {
  it('round-trips game state through JSON and keeps simulating identically', () => {
    const a = newWorld(21, true);
    run(a, 100);
    const json = JSON.parse(JSON.stringify(a.serialize()));
    const b = World.fromSave(content, json);
    expect(b.time).toBeCloseTo(a.time);
    expect(b.incidents.size).toBe(a.incidents.size);
    expect(b.vehicles.size).toBe(a.vehicles.size);
    run(a, 60);
    run(b, 60);
    expect(b.score).toBe(a.score);
    expect([...b.incidents.keys()]).toEqual([...a.incidents.keys()]);
  });
  it('rejects unknown save versions', () => {
    expect(() => World.fromSave(content, { version: 99 } as never)).toThrow();
  });
});

describe('content validation', () => {
  it('reports clear errors for invalid vehicles', () => {
    const bad = { id: 'x', name: 'X', category: 'boat', maxSpeed: 'fast', capacity: 1, color: '#fff', length: 1, equipment: [], patientCapacity: 0, crew: [{ role: 'nobody', count: 3 }] };
    const text = validateVehicle(bad, content.roles, 'mod.vehicles[0]').join('\n');
    expect(text).toContain('category');
    expect(text).toContain('maxSpeed');
    expect(text).toContain('onbekende rol');
    expect(text).toContain('groter dan capacity');
  });
  it('requires matching blocks for objectives', () => {
    const inc = { id: 'a', name: 'A', category: 'fire', weight: 1, spawn: { on: 'road' }, severity: { min: 1, max: 2 }, requires: ['fire'], objectives: ['fire_out'], escalation: { everySec: 60 }, failAfterSec: 100, reward: { score: 1, budget: 1 } };
    expect(validateIncident(inc).join()).toContain('fire');
  });
  it('merges a valid mod and skips invalid items', () => {
    const good = { id: 'mod_truck', name: 'Mod truck', category: 'fire', maxSpeed: 70, capacity: 2, color: '#f00', length: 1.5, equipment: ['fire_hose'], patientCapacity: 0, crew: [{ role: 'firefighter', count: 2 }] };
    const { content: c, errors } = mergeContent(content, { vehicles: [good, { id: 'bad' }] }, 'testmod');
    expect(c.vehicles.mod_truck).toBeDefined();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('testmod.vehicles[1]');
  });
});
