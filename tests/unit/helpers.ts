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
