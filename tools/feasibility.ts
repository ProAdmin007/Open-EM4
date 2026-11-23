// Feasibility check: a simple "perfect-ish player" bot handles every incident type alone; prints how long it takes against the time limit.
// Run: npx vite-node tools/feasibility.ts [seed] [incidentId...]
import { loadBuiltinContent } from '../src/data';
import { World } from '../src/sim/world';
import { runBot } from './bot';

interface Result { id: string; severity: number; limit: number; solvedAt: number | null; firstArrival: number | null; vehicles: number; note: string }

{
  const content = loadBuiltinContent();
  const seed = Number(process.argv[2] ?? 3);
  const only = process.argv.slice(3);
  const rows: Result[] = [];
  for (const def of Object.values(content.incidents)) {
    if (only.length && !only.includes(def.id)) continue;
    const w = World.create(content, { seed, difficulty: 'normal', freeplay: false, traffic: true });
    const sev = def.severity.max;
    const inc = w.spawnIncident(def.id, { severity: sev });
    if (!inc) { rows.push({ id: def.id, severity: sev, limit: def.failAfterSec, solvedAt: null, firstArrival: null, vehicles: 0, note: 'spawn failed' }); continue; }
    const r = runBot(w, inc.id, def.failAfterSec * 1.3);
    rows.push({ id: def.id, severity: sev, limit: def.failAfterSec, solvedAt: r.solvedAt, firstArrival: r.firstArrival, vehicles: r.sent, note: r.solvedAt === null ? 'NOT SOLVED' : r.solvedAt > def.failAfterSec ? 'TOO SLOW' : r.solvedAt > def.failAfterSec * 0.7 ? 'tight' : 'ok' });
  }
  console.log('incident'.padEnd(26) + 'sev limit  solved arrive units note');
  for (const r of rows) console.log(r.id.padEnd(26) + `${r.severity}   ${String(r.limit).padEnd(5)} ${r.solvedAt === null ? '-'.padEnd(6) : r.solvedAt.toFixed(0).padEnd(6)} ${r.firstArrival === null ? '-'.padEnd(6) : r.firstArrival.toFixed(0).padEnd(6)} ${r.vehicles}     ${r.note}`);
  const bad = rows.filter(r => r.note !== 'ok' && r.note !== 'tight');
  console.log(`\n${rows.length - bad.length}/${rows.length} feasible for the bot`);
}
