// Headless simulation benchmark. Run: npm run bench
import { loadBuiltinContent } from '../src/data';
import { World, SIM_DT } from '../src/sim/world';

const content = loadBuiltinContent();
const w = World.create(content, { seed: 7, difficulty: 'hard', freeplay: true, traffic: true });
const ticks = 30 * 60 * Number(process.env.BENCH_MIN ?? 30); // 30 simulated minutes
const t0 = performance.now();
let worst = 0;
for (let i = 0; i < ticks && !w.over; i++) {
  const a = performance.now();
  w.reputation = 100; // unattended run: keep the game alive so we measure steady state
  w.tick(SIM_DT);
  worst = Math.max(worst, performance.now() - a);
}
const ms = performance.now() - t0;
console.log(`simulated ${(w.time / 60).toFixed(1)} min in ${ms.toFixed(0)} ms (${(w.time * 1000 / ms).toFixed(0)}x realtime), avg tick ${(ms / (w.time / SIM_DT)).toFixed(3)} ms, worst tick ${worst.toFixed(2)} ms`);
console.log(`entities: vehicles=${w.vehicles.size} responders=${w.responders.size} civilians=${w.civilians.length} pedestrians=${w.pedestrians.length} incidents=${w.incidents.size} (game over: ${w.over})`);
