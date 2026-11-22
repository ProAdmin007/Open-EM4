import { describe, expect, it } from 'vitest';
import { findPath } from '../../src/sim/pathfinding';
import { content, newWorld } from './helpers';

describe('A* pathfinding', () => {
  it('finds a shortest path around a wall', () => {
    const open = (x: number, y: number) => !(x === 2 && y < 4);
    const p = findPath(5, 5, { x: 0, y: 0 }, { x: 4, y: 0 }, open)!;
    expect(p[p.length - 1]).toEqual({ x: 4, y: 0 });
    expect(p.length).toBe(12);
    expect(p.every(t => open(t.x, t.y))).toBe(true);
  });
  it('returns null when the goal is unreachable', () => {
    expect(findPath(5, 5, { x: 0, y: 0 }, { x: 4, y: 4 }, x => x !== 2)).toBeNull();
  });
  it('supports predicate goals and diagonal moves without cutting corners', () => {
    const p = findPath(6, 6, { x: 0, y: 0 }, (x, y) => x === 3 && y === 3, () => true, { diagonal: true })!;
    expect(p.length).toBe(3);
    const blocked = (x: number, y: number) => !(x === 1 && y === 0) && !(x === 0 && y === 1);
    expect(findPath(3, 3, { x: 0, y: 0 }, { x: 1, y: 1 }, blocked, { diagonal: true })).toBeNull();
  });
  it('vehicles only get routes over road and parking tiles and never through buildings', () => {
    const w = newWorld();
    const v = [...w.vehicles.values()][0];
    const dest = w.nearestRoad(50, 40)!;
    expect(w.routeVehicle(v, dest)).toBe(true);
    for (const t of v.path) {
      expect(w.isRoad(t.x, t.y) || w.isParking(t.x, t.y)).toBe(true);
      expect(w.isBuilding(t.x, t.y)).toBe(false);
    }
  });
  it('built-in map has enough buildings', () => {
    expect(content.maps.default_city.buildings.length).toBeGreaterThanOrEqual(15);
  });
});
