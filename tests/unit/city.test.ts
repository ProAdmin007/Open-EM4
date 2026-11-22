import { describe, expect, it } from 'vitest';
import { content, newWorld, run } from './helpers';
import { World } from '../../src/sim/world';

describe('the irregular city', () => {
  const map = content.maps.default_city;
  const w = newWorld(1);

  it('has one connected road network', () => {
    const seen = new Set<number>();
    const stack = [w.roadList[0]];
    while (stack.length) {
      const t = stack.pop()!;
      const k = t.y * 4096 + t.x;
      if (seen.has(k) || !w.isRoad(t.x, t.y)) continue;
      seen.add(k);
      stack.push({ x: t.x + 1, y: t.y }, { x: t.x - 1, y: t.y }, { x: t.x, y: t.y + 1 }, { x: t.x, y: t.y - 1 });
    }
    expect(seen.size).toBe(w.roadList.length);
  });

  it('is not a regular grid: streets lie at uneven distances and block sizes differ a lot', () => {
    // widths of the free runs between vertical streets along many rows
    const widths = new Set<number>();
    for (let y = 2; y < map.height - 2; y += 3) {
      let run = 0;
      for (let x = 0; x < map.width; x++) { if (map.rows[y][x] === 'R') { if (run >= 5) widths.add(run); run = 0; } else run++; }
    }
    expect(widths.size).toBeGreaterThanOrEqual(6);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThanOrEqual(8);
  });

  it('has T-junctions and dead-end streets next to ordinary crossings', () => {
    let tj = 0, cross = 0, deadEnds = 0;
    for (const r of w.roadList) {
      if (!w.isIntersection(r.x, r.y) || w.isIntersection(r.x - 1, r.y) || w.isIntersection(r.x, r.y - 1)) continue;
      const arms = [w.isRoad(r.x - 1, r.y), w.isRoad(r.x + 2, r.y), w.isRoad(r.x, r.y - 1), w.isRoad(r.x, r.y + 2)].filter(Boolean).length;
      if (arms === 3) tj++; else if (arms === 4) cross++;
    }
    for (const r of w.roadList) { // a road tile whose 2x2 square has only one road neighbour direction: the closed end of a street
      if (!(w.isRoad(r.x + 1, r.y) && w.isRoad(r.x, r.y + 1) && w.isRoad(r.x + 1, r.y + 1))) continue;
      const arms = [w.isRoad(r.x - 1, r.y) && w.isRoad(r.x - 1, r.y + 1), w.isRoad(r.x + 2, r.y) && w.isRoad(r.x + 2, r.y + 1), w.isRoad(r.x, r.y - 1) && w.isRoad(r.x + 1, r.y - 1), w.isRoad(r.x, r.y + 2) && w.isRoad(r.x + 1, r.y + 2)].filter(Boolean).length;
      if (arms === 1) deadEnds++;
    }
    expect(tj).toBeGreaterThanOrEqual(3);
    expect(cross).toBeGreaterThanOrEqual(6);
    expect(deadEnds).toBeGreaterThanOrEqual(2);
  });

  it('puts buildings along streets and station lots against a street', () => {
    const near = (b: { x: number; y: number; w: number; h: number }) => {
      for (let d = 1; d <= 7; d++) for (let i = b.x - d; i < b.x + b.w + d; i++) for (let j = b.y - d; j < b.y + b.h + d; j++) if (w.isRoad(i, j)) return true;
      return false;
    };
    for (const b of map.buildings) expect(near(b)).toBe(true);
    for (const st of map.stations) for (const bay of st.bays!) expect(w.isRoad(bay.x, bay.y - 3)).toBe(true);
  });
});

describe('fire jumps over the street', () => {
  it('spreads to a building on the other side of the street, much less than next door, and more downwind', () => {
    const base = newWorld(2);
    let pair: { a: string; b: string; gap: number } | null = null;
    const bs = [...base.buildings.values()].filter(b => b.type !== 'station' && b.type !== 'hospital');
    for (const a of bs) for (const b of bs) {
      if (a === b) continue;
      const gap = Math.hypot(Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0), Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0));
      if (gap >= 3.5 && gap <= 5 && !pair) pair = { a: a.id, b: b.id, gap };
    }
    expect(pair).toBeTruthy();
    const a0 = base.buildings.get(pair!.a)!, b0 = base.buildings.get(pair!.b)!;
    expect(base.spreadFactor({ ...a0, fire: 100 }, b0, pair!.gap)).toBeGreaterThan(0.05);
    expect(base.spreadFactor({ ...a0, fire: 100 }, b0, 1.0)).toBeGreaterThan(base.spreadFactor({ ...a0, fire: 100 }, b0, pair!.gap) * 2);
    expect(base.spreadFactor({ ...a0, fire: 40 }, b0, pair!.gap)).toBe(0); // a young fire does not jump a street
    // wind: downwind is easier than upwind
    const dx = b0.x - a0.x, dy = b0.y - a0.y, len = Math.hypot(dx, dy);
    base.wind.x = dx / len; base.wind.y = dy / len;
    const down = base.spreadFactor({ ...a0, fire: 100 }, b0, pair!.gap);
    base.wind.x = -dx / len; base.wind.y = -dy / len;
    const up = base.spreadFactor({ ...a0, fire: 100 }, b0, pair!.gap);
    expect(down).toBeGreaterThan(up);
    // and it really happens in the simulation
    let jumped = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const w = World.create(content, { seed, difficulty: 'normal', freeplay: false, traffic: false });
      const a = w.buildings.get(pair!.a)!, b = w.buildings.get(pair!.b)!;
      const inc = w.spawnIncident('house_fire', { buildingId: a.id, severity: 3 })!;
      expect(inc).toBeTruthy();
      a.fire = 100; a.spread = 3; a.growth = 0; a.resistance = 1e6; // a raging fire that nobody can put out
      const ddx = b.x - a.x, ddy = b.y - a.y, l = Math.hypot(ddx, ddy);
      w.wind.x = ddx / l; w.wind.y = ddy / l;
      run(w, 600, () => b.fire > 0);
      if (b.fire > 0) jumped++;
    }
    expect(jumped).toBeGreaterThan(0);
  });
});

describe('response routes', () => {
  it('are reasonably direct: no big detours to the scene', () => {
    const w = newWorld(3);
    const engine = [...w.vehicles.values()].find(v => v.defId === 'fire_engine')!;
    let worst = 0, sum = 0, n = 0;
    for (const t of ['house_fire', 'kitchen_fire', 'car_accident', 'road_blockage', 'burglary', 'cardiac_arrest', 'fallen_tree', 'office_fire']) {
      const inc = w.spawnIncident(t, { severity: 1 });
      if (!inc) continue;
      const b = inc.buildingId ? w.buildings.get(inc.buildingId)! : null;
      const tx = b ? b.door.x + 0.5 : inc.x, ty = b ? b.door.y + 0.5 : inc.y;
      engine.x = engine.px = engine.home.x + 0.5; engine.y = engine.py = engine.home.y + 0.5; engine.path = []; engine.dest = null;
      w.orderMove([engine.id], tx, ty);
      const len = engine.path.length;
      const manhattan = Math.abs(tx - engine.x) + Math.abs(ty - engine.y);
      if (manhattan < 20) continue; // very short trips may legitimately loop around a block (one-way lanes)
      const ratio = len / manhattan;
      worst = Math.max(worst, ratio); sum += ratio; n++;
    }
    expect(n).toBeGreaterThan(3);
    expect(sum / n).toBeLessThan(1.5);
    expect(worst).toBeLessThan(2.3);
  });
});

describe('placement of buildings', () => {
  it('no building stands on or against the road: there is always a pavement strip', () => {
    const w = newWorld(1);
    for (const b of w.map.buildings) {
      if (b.type === 'station') continue; // a station's lot fronts the street; the building itself is behind the lot
      for (let j = b.y - 1; j <= b.y + b.h; j++) for (let i = b.x - 1; i <= b.x + b.w; i++) expect(w.isRoad(i, j)).toBe(false);
    }
    for (const b of w.map.buildings) for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) expect(w.isRoad(i, j) || w.isParking(i, j) || w.isWater(i, j)).toBe(false);
  });
});
