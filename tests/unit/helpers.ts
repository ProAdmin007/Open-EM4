import { loadBuiltinContent } from '../../src/data';
import { World, SIM_DT } from '../../src/sim/world';
import type { Difficulty } from '../../src/sim/types';

export const content = loadBuiltinContent();
export const newWorld = (seed = 1, freeplay = false, difficulty: Difficulty = 'normal') =>
  World.create(content, { seed, difficulty, freeplay, traffic: false });
export function run(w: World, seconds: number, until?: () => boolean): void {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n && !w.over; i++) {
    w.tick(SIM_DT);
    if (until?.()) return;
  }
}

/** A straight two-lane road run of at least `len` tiles (no junction): the top-left tile and its direction. */
export function straightRoad(w: World, dir: 'h' | 'v', len = 18): { x: number; y: number } {
  for (let y = 2; y < w.h - 3; y++) for (let x = 2; x < w.w - 3; x++) {
    let ok = true;
    for (let i = 0; i < len && ok; i++) {
      const [a, b] = dir === 'h' ? [{ x: x + i, y }, { x: x + i, y: y + 1 }] : [{ x, y: y + i }, { x: x + 1, y: y + i }];
      if (!w.isRoad(a.x, a.y) || !w.isRoad(b.x, b.y) || w.isIntersection(a.x, a.y) || w.isIntersection(b.x, b.y) || !w.laneAt(a.x, a.y) || !w.laneAt(b.x, b.y)) ok = false;
    }
    if (ok) return { x, y };
  }
  throw new Error('no straight road found');
}
/** A road tile close to a point (for orders that used hard-coded coordinates on the old map). */
export function roadNear(w: World, px: number, py: number): { x: number; y: number } {
  let best = { x: 0, y: 0 }, bd = Infinity;
  for (const r of w.roadList) if (!w.isIntersection(r.x, r.y)) { const d = Math.hypot(r.x - px, r.y - py); if (d < bd) { bd = d; best = r; } }
  return best;
}
