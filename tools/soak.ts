// Soak / fuzz test: many seeds and difficulties with random player actions, checking invariants every few seconds.
// Run: npx vite-node tools/soak.ts [minutesPerRun=12] [seeds=6]
import { loadBuiltinContent } from '../src/data';
import { World, SIM_DT } from '../src/sim/world';
import { createSnapshot } from '../src/sim/snapshot';
import { Rng } from '../src/sim/rng';

const minutes = Number(process.argv[2] ?? 12), seeds = Number(process.argv[3] ?? 6);
const content = loadBuiltinContent();
const problems: string[] = [];
const bad = (ctx: string, msg: string) => { if (problems.length < 60) problems.push(`${ctx}: ${msg}`); };
let runs = 0, ticks = 0;
for (const difficulty of ['easy', 'normal', 'hard'] as const) for (let seed = 1; seed <= seeds; seed++) {
  const ctx = `${difficulty}/${seed}`;
  if (process.env.SOAK_ONLY && process.env.SOAK_ONLY !== ctx) continue;
  const w = World.create(content, { seed, difficulty, freeplay: true, traffic: true });
  const rng = new Rng(seed * 7919);
  let stuckFor = new Map<number, number>(); const lastPos = new Map<number, { x: number; y: number }>();
  try {
    for (let i = 0; i < minutes * 60 * 30; i++) {
      w.tick(SIM_DT); ticks++;
      if (w.over) break;
      if (process.env.SOAK_TRACE && i % 60 === 0 && w.time >= Number(process.env.SOAK_FROM ?? 0)) { const v = w.vehicles.get(Number(process.env.SOAK_TRACE)); if (v) console.log(`trace t=${w.time.toFixed(0)} pos=${v.x.toFixed(2)},${v.y.toFixed(2)} sp=${v.speedNow.toFixed(2)} path=${v.path.length} next=${JSON.stringify(v.path[0])} blocked=${v.blocked.toFixed(1)} jam=${(w as any).jam.get(v.id)} lw=${(w as any).lightWait.get(v.id)} patrol=${v.patrol} ret=${v.returning} silent=${v.silent} state=${v.state} prio=${v.prio} canGo=${v.path[0] ? w.canGo(v.path[0].x, v.path[0].y, Math.abs(v.path[0].x + 0.5 - v.x) > Math.abs(v.path[0].y + 0.5 - v.y)) : '-'}`); }
      if (i % 90 === 0) { // every 3 s: random player action
        const vs = [...w.vehicles.values()], ids = vs.map(v => v.id);
        const pick = () => ids[rng.int(0, ids.length - 1)];
        const incs = [...w.incidents.values()];
        const a = rng.int(0, 9);
        if (a <= 2 && incs.length) { const inc = rng.pick(incs); w.questionCaller(inc.id); w.dispatchRecommended(inc.id); }
        else if (a === 3) w.orderMove([pick()], rng.int(1, w.w - 2), rng.int(1, w.h - 2), rng.chance(0.5) ? 1 : 2);
        else if (a === 4) w.orderDismount([pick()]);
        else if (a === 5) w.orderBoard([pick()]);
        else if (a === 6) w.orderReturn([pick()]);
        else if (a === 7) w.orderToHospital([pick()]);
        else if (a === 8) w.setGrip(rng.int(0, 4));
        else if (incs.length) w.adviseCaller(rng.pick(incs).id);
      }
      if (i % 30 === 0) { // every second: auto-crews so the world keeps moving
        for (const r of w.responders.values()) if (!r.inVehicle && !r.task && !r.path.length && rng.chance(0.2)) { for (const a of ['recon', 'rescue', 'extinguish', 'treat', 'carry', 'arrest', 'secure', 'clear', 'disperse', 'collect'] as const) if (w.canDo(r, a) && w.orderAbility([r.id], a) > 0) break; }
      }
      if (i % 150 !== 0) continue; // invariants every 5 s
      const t = w.time.toFixed(0);
      for (const v of w.vehicles.values()) {
        if (![v.x, v.y, v.angle, v.speedNow].every(Number.isFinite)) bad(ctx, `t=${t} vehicle ${v.id} NaN position`);
        if (v.x < -1 || v.y < -1 || v.x > w.w + 1 || v.y > w.h + 1) bad(ctx, `t=${t} vehicle ${v.id} left the map (${v.x.toFixed(1)},${v.y.toFixed(1)})`);
        if (v.patients.length > (w.vehicleDef(v).patientCapacity ?? 0)) bad(ctx, `t=${t} vehicle ${v.id} over capacity`);
        if (!v.path.length && v.dest && !v.blocked) { /* waiting for a path: fine */ }
        const moving = v.path.length > 0 && v.crew.every(id => w.responders.get(id)?.inVehicle !== false);
        const k = stuckFor.get(v.id) ?? 0;
        const lp = lastPos.get(v.id); lastPos.set(v.id, { x: v.x, y: v.y });
        stuckFor.set(v.id, moving && lp && Math.hypot(v.x - lp.x, v.y - lp.y) < 0.15 ? k + 5 : 0);
        if (k > 240) { {
          const near = [...w.vehicles.values()].filter(o => o !== v && Math.hypot(o.x - v.x, o.y - v.y) < 3).map(o => `${o.defId}#${o.id}@${o.x.toFixed(1)},${o.y.toFixed(1)} path${o.path.length} idle${!o.dest}`);
          const civ = [...w.civilians.values()].filter(o => Math.hypot(o.x - v.x, o.y - v.y) < 3).map(o => `(${o.x.toFixed(1)},${o.y.toFixed(1)} a${o.angle.toFixed(2)} sp${((o as any).speed ?? 0).toFixed(2)} ${(o as any).type ?? ''})`).join(' ') + ' jam=' + (w as any).jam.get(v.id);
          bad(ctx, `t=${t} vehicle ${v.id} (${v.defId}) stuck 4+ min at ${v.x.toFixed(1)},${v.y.toFixed(1)} dest=${JSON.stringify(v.dest)} next=${JSON.stringify(v.path[0])} blocked=${v.blocked.toFixed(1)} prio=${v.prio} state=${v.state} near=[${near.join(' ')}] civs=${civ} intersection=${w.isIntersection(Math.floor(v.x), Math.floor(v.y))} contra=${v.contraflow} ghost=${v.ghost.toFixed(1)} avoid=${v.avoid.length} speed=${v.speedNow.toFixed(2)} lane=${JSON.stringify(w.laneAt(Math.floor(v.x), Math.floor(v.y)))} angle=${v.angle.toFixed(2)} crewOut=${v.crew.some(id => w.responders.get(id)?.inVehicle === false)} path=${JSON.stringify(v.path.slice(0, 4))}`);
        } stuckFor.set(v.id, -600); }
        for (const id of v.crew) if (!w.responders.has(id)) bad(ctx, `t=${t} vehicle ${v.id} has unknown crew ${id}`);
      }
      for (const r of w.responders.values()) {
        if (![r.x, r.y].every(Number.isFinite)) bad(ctx, `t=${t} responder ${r.id} NaN`);
        if (!w.vehicles.has(r.vehicleId)) bad(ctx, `t=${t} responder ${r.id} has no vehicle`);
      }
      for (const x of w.victims.values()) {
        if (![x.x, x.y, x.health].every(Number.isFinite)) bad(ctx, `t=${t} victim ${x.id} NaN`);
        if (x.health < -1 || x.health > 101) bad(ctx, `t=${t} victim ${x.id} health ${x.health}`);
      }
      for (const inc of w.incidents.values()) {
        if (!w.content.incidents[inc.defId]) bad(ctx, `t=${t} unknown incident def`);
        if (inc.buildingId && !w.buildings.has(inc.buildingId)) bad(ctx, `t=${t} incident ${inc.id} building gone`);
        if (inc.status === 'active' && inc.elapsed > 4000) bad(ctx, `t=${t} incident ${inc.id} (${inc.defId}) active for ${inc.elapsed.toFixed(0)} s`);
      }
      for (const b of w.buildings.values()) if (b.fire < 0 || b.fire > 100.001 || b.damage < 0 || b.damage > 100.001) bad(ctx, `t=${t} building ${b.id} fire/damage out of range`);
      if (![w.score, w.budget, w.reputation].every(Number.isFinite)) bad(ctx, `t=${t} score/budget/reputation not finite`);
      if (i % 1800 === 0) { // snapshot + save/load roundtrip every minute
        const snap = createSnapshot(w, 0.5);
        for (const v of snap.vehicles) if (![v.position.x, v.position.z, v.yaw].every(Number.isFinite)) bad(ctx, `t=${t} snapshot vehicle NaN`);
        for (const p of snap.people) if (![p.position.x, p.position.z].every(Number.isFinite)) bad(ctx, `t=${t} snapshot person NaN`);
        const w2 = World.fromSave(content, JSON.parse(JSON.stringify(w.serialize())));
        if (w2.vehicles.size !== w.vehicles.size || w2.incidents.size !== w.incidents.size || w2.responders.size !== w.responders.size) bad(ctx, `t=${t} save/load changed entity counts`);
        for (let k2 = 0; k2 < 90; k2++) w2.tick(SIM_DT); // the loaded world must keep running
      }
    }
  } catch (e) { bad(ctx, `EXCEPTION ${(e as Error).stack?.split('\n').slice(0, 4).join(' | ')}`); }
  runs++;
  console.log(`${ctx}: t=${w.time.toFixed(0)} solved=${w.solved} failed=${w.failed} deaths=${w.deaths} score=${w.score.toFixed(0)} problems so far=${problems.length}`);
}
console.log(`\n${runs} runs, ${ticks} ticks, ${problems.length} problem(s)`);
for (const p of problems) console.log(' - ' + p);
process.exit(problems.length ? 1 : 0);
