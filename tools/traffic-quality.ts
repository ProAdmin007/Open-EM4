// Vehicle movement quality scan: an automatic dispatcher answers every call and we measure how smoothly the emergency vehicles move.
// Run: npx vite-node tools/traffic-quality.ts [minutes=10] [seeds=4]
import { loadBuiltinContent } from '../src/data';
import { World, SIM_DT, KMH_TO_TILES } from '../src/sim/world';

const minutes = Number(process.argv[2] ?? 10), seeds = Number(process.argv[3] ?? 4);
const content = loadBuiltinContent();
interface Box { x: number; y: number; ux: number; uy: number; hl: number; hw: number }
const corners = (b: Box) => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, c]) => [b.x + b.ux * b.hl * a - b.uy * b.hw * c, b.y + b.uy * b.hl * a + b.ux * b.hw * c]);
function overlap(a: Box, b: Box, m: number): boolean {
  const A = { ...a, hl: a.hl - m, hw: a.hw - m }, B = { ...b, hl: b.hl - m, hw: b.hw - m };
  for (const s of [A, B]) for (const [ax, ay] of [[s.ux, s.uy], [-s.uy, s.ux]]) {
    const pa = corners(A).map(([x, y]) => x * ax + y * ay), pb = corners(B).map(([x, y]) => x * ax + y * ay);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}
const hwOf = (len: number) => Math.min(0.5, 0.2 + len * 0.1);
const tot = { vehSeconds: 0, moving: 0, blocked: 0, ghost: 0, contraflow: 0, trips: 0, overlaps: 0, teleports: 0, angleJumps: 0, offroad: 0, giveUps: 0, noRoute: 0, jerk: 0 };
const worst: string[] = [];
const note = (s: string) => { if (worst.length < 40) worst.push(s); };
const otReasons: Record<string, number> = {};
const crawl: Record<string, number> = {};
const pairKinds: Record<string, number> = {};
const pairDur: Record<string, number> = {};
const blockKinds: Record<string, number> = {};
const blockSpots: Record<string, number> = {};
const tripTimes: { ratio: number; desc: string }[] = [];

for (const difficulty of ['normal', 'hard'] as const) for (let seed = 1; seed <= seeds; seed++) {
  const ctx = `${difficulty}/${seed}`;
  const w = World.create(content, { seed, difficulty, freeplay: true, traffic: true });
  const prev = new Map<number, { x: number; y: number; a: number; s: number }>();
  const trip = new Map<number, { t0: number; len: number; from: string }>();
  const seen = new Set<number>(); let eventsSeen = 0;
  const orig = (w as any).onBlocked.bind(w);
  (w as any).onBlocked = (v: any, b: any, dt: number) => {
    const park = w.isParking(Math.floor(v.x), Math.floor(v.y)) ? 'parking' : w.isIntersection(Math.floor(v.x), Math.floor(v.y)) ? 'junction' : 'road';
    const k = `${b.kind}${b.halted ? '-halted' : '-moving'}@${park}`; blockKinds[k] = (blockKinds[k] ?? 0) + dt;
    if (w.vehicleDef(v).flying) return orig(v, b, dt);
    if (false) { const np = (w as any).overtakePath(v.x, v.y, v.path, v.id); const r = np ? 'OK' : (globalThis as any).__ot; otReasons[r] = (otReasons[r] ?? 0) + dt; }
    if (process.env.TQ_DEF && process.env.TQ_CTX === ctx && w.vehicleDef(v).id === process.env.TQ_DEF && (!process.env.TQ_ID || v.id === Number(process.env.TQ_ID)) && Math.abs(w.time - Math.round(w.time / 5) * 5) < 0.04) { const bv = b.id !== undefined ? w.vehicles.get(b.id) : undefined; if (w.time !== (globalThis as any).__lt && process.env.TQ_DIAG && Math.abs(w.time - 385) < 0.04) { const np = (w as any).overtakePath(v.x, v.y, v.path, v.id); console.log('DIAG overtake', !!np, (globalThis as any).__ot, (globalThis as any).__ot, 'lane', JSON.stringify(w.laneAt(Math.floor(v.x), Math.floor(v.y))), [1,2,3,4,5,6,7].map(i => { const l = w.laneAt(92, 73 + i); const o = w.laneAt(93, 73 + i); return `${73 + i}:${l ? l.x + ',' + l.y : '-'}|${o ? o.x + ',' + o.y : '-'}${w.isIntersection(92, 73 + i) ? 'X' : ''}`; }).join(' '), 'path', JSON.stringify(v.path.slice(0, 8)), 'civs near', w.civilians.filter(c => Math.hypot(c.x - 93, c.y - 76) < 8).map(c => `${c.id}@${c.x.toFixed(1)},${c.y.toFixed(1)}`)); }
    if (w.time !== (globalThis as any).__lt) { (globalThis as any).__lt = w.time; console.log('  trace', w.time.toFixed(0), 'cf', v.contraflow, 'ghost', v.ghost.toFixed(1), 'bl', v.blocked.toFixed(1), 'plen', v.path.length, v.name, v.x.toFixed(1), v.y.toFixed(1), 'ang', v.angle.toFixed(2), 'next', JSON.stringify(v.path[0]), 'dest', JSON.stringify(v.dest), 'by', b.kind, bv ? `${bv.name} ${bv.x.toFixed(1)},${bv.y.toFixed(1)} ang ${bv.angle.toFixed(2)} path${bv.path.length} out${bv.crew.filter(c => !w.responders.get(c)!.inVehicle).length}` : `${b.x?.toFixed(1)},${b.y?.toFixed(1)}`, 'jam', ((w as any).jam.get(v.id) ?? 0).toFixed(0)); } }
    const sk = `${Math.floor(v.x / 4) * 4},${Math.floor(v.y / 4) * 4}`; blockSpots[sk] = (blockSpots[sk] ?? 0) + dt;
    return orig(v, b, dt);
  };
  for (let i = 0; i < minutes * 60 * 30; i++) {
    w.reputation = 100; w.tick(SIM_DT);
    if (w.over) break;
    if (i % 30 === 0) { // the auto dispatcher: answer every new call, then let idle crews work
      for (const inc of w.incidents.values()) if (!seen.has(inc.id)) { seen.add(inc.id); w.questionCaller(inc.id); w.dispatchRecommended(inc.id); }
      for (const v of w.vehicles.values()) {
        if (v.path.length || v.returning || v.toHospital || v.patrol) continue;
        const near = [...w.incidents.values()].some(inc => Math.hypot(inc.x - v.x, inc.y - v.y) < 16);
        const inside = v.crew.every(id => w.responders.get(id)!.inVehicle);
        if (near && inside && v.dest === null && v.state === 'idle') { const def = w.vehicleDef(v); if (def.equipment.includes('fire_hose')) w.orderDeployFire([v.id]); else w.orderDismount([v.id]); }
        if (!near && inside && Math.hypot(v.x - (v.home.x + 0.5), v.y - (v.home.y + 0.5)) > 1 && !v.patients.length) w.orderReturn([v.id]);
      }
      for (const r of w.responders.values()) {
        if (r.inVehicle || r.task || r.path.length) continue;
        for (const a of ['recon', 'rescue', 'extinguish', 'treat', 'carry', 'arrest', 'secure', 'defuse', 'clear', 'disperse', 'collect', 'cool'] as const) if (w.canDo(r, a) && w.orderAbility([r.id], a) > 0) break;
      }
      for (const v of w.vehicles.values()) if (v.patients.length && !v.toHospital && !v.path.length && v.crew.every(id => !w.responders.get(id)!.task)) w.orderToHospital([v.id]);
    }
    for (const e of w.events.slice(eventsSeen > w.events.length ? 0 : eventsSeen)) {
      if (/komt er niet door|zit vast/.test(e.message ?? '')) { tot.giveUps++; note(`${ctx} t=${w.time.toFixed(0)} ${e.message}`); }
      if (/geen route/.test(e.message ?? '')) tot.noRoute++;
      if (process.env.TQ_EV && ctx === process.env.TQ_EV) console.log('EV', w.time.toFixed(0), e.message);
    }
    eventsSeen = w.events.length;
    if (process.env.TQ_DUMP) { const [dc, dt0] = process.env.TQ_DUMP.split('@'); if (dc === ctx && Math.abs(w.time - Number(dt0)) < 0.02) for (const v of w.vehicles.values()) if (!w.vehicleDef(v).flying && Math.hypot(v.x - Number(process.env.TQ_X), v.y - Number(process.env.TQ_Y)) < 6) console.log('DUMP', w.vehicleDef(v).id, v.id, v.x.toFixed(2), v.y.toFixed(2), 'ang', v.angle.toFixed(2), 'path', v.path.length, 'dest', JSON.stringify(v.dest), 'blocked', v.blocked.toFixed(1), 'jam', (w as any).jam.get(v.id), 'ghost', v.ghost.toFixed(1), 'cf', v.contraflow, 'state', v.state, 'ret', v.returning, 'speed', v.speedNow.toFixed(2)); }
    const boxes: (Box & { label: string; air: boolean })[] = [];
    for (const v of w.vehicles.values()) {
      const def = w.vehicleDef(v);
      const air = !!def.flying;
      boxes.push({ x: v.x, y: v.y, ux: Math.cos(v.angle), uy: Math.sin(v.angle), hl: def.length / 2, hw: hwOf(def.length), label: `${def.id}#${v.id}`, air: air && v.path.length > 0 });
      if (air) continue;
      const p = prev.get(v.id);
      const moving = v.path.length > 0;
      tot.vehSeconds += SIM_DT;
      if (moving) { tot.moving += SIM_DT; if (v.blocked > 0) tot.blocked += SIM_DT; if (v.ghost > 0) tot.ghost += SIM_DT; if (v.contraflow) tot.contraflow += SIM_DT; }
      if (p) {
        const d = Math.hypot(v.x - p.x, v.y - p.y), vmax = def.maxSpeed * KMH_TO_TILES * 1.15 * SIM_DT;
        if (d > vmax * 1.5 + 0.35) { tot.teleports++; note(`${ctx} t=${w.time.toFixed(1)} ${def.id}#${v.id} jumped ${d.toFixed(2)} tiles in one tick`); }
        const da = Math.abs(Math.atan2(Math.sin(v.angle - p.a), Math.cos(v.angle - p.a)));
        if (da > 1.2 && d > 0.01) { tot.angleJumps++; if (da > 2.5) note(`${ctx} t=${w.time.toFixed(1)} ${def.id}#${v.id} turned ${da.toFixed(1)} rad in one tick`); }
        if (Math.abs(v.speedNow - p.s) > 1.2) tot.jerk++;
      }
      prev.set(v.id, { x: v.x, y: v.y, a: v.angle, s: v.speedNow });
      if (moving && v.lights && v.speedNow < 2.2 && !w.isIntersection(Math.floor(v.x), Math.floor(v.y))) { // siren on, crawling: who is ahead?
        const ux = Math.cos(v.angle), uy = Math.sin(v.angle);
        const lead = w.civilians.find(c => { const dx = c.x - v.x, dy = c.y - v.y, al = dx * ux + dy * uy, la = Math.abs(dx * uy - dy * ux); return al > 0.3 && al < 3.2 && la < 0.7; });
        const lv = [...w.vehicles.values()].find(o => o !== v && !w.vehicleDef(o).flying && (() => { const dx = o.x - v.x, dy = o.y - v.y, al = dx * ux + dy * uy, la = Math.abs(dx * uy - dy * ux); return al > 0.3 && al < 3.2 && la < 0.7; })());
        const key = lead ? `behind civ ${lead.type} moving=${lead.v > 0.3}` : lv ? `behind vehicle moving=${lv.speedNow > 0.3}` : w.isParking(Math.floor(v.x), Math.floor(v.y)) ? 'leaving parking' : 'free road (corner/accel)';
        crawl[key] = (crawl[key] ?? 0) + SIM_DT;
        if (lead) { const np = (w as any).overtakePath(v.x, v.y, v.path, v.id, 4); const r = np ? 'could overtake (K4)' : (globalThis as any).__ot + (w.time < v.passUntil ? ' [passUntil]' : '') + (v.path.length < 5 ? ' [path<5]' : ''); otReasons[r] = (otReasons[r] ?? 0) + SIM_DT; }
      }
      if (moving && !w.isRoad(Math.floor(v.x), Math.floor(v.y)) && !w.isParking(Math.floor(v.x), Math.floor(v.y))) { tot.offroad++; if (tot.offroad < 6) note(`${ctx} t=${w.time.toFixed(1)} ${def.id}#${v.id} off the road at ${v.x.toFixed(1)},${v.y.toFixed(1)}`); }
      // trips: from the moment a path appears until it is empty
      const tr = trip.get(v.id);
      if (moving && !tr && v.dest) trip.set(v.id, { t0: w.time, len: v.path.length, from: `${v.x.toFixed(0)},${v.y.toFixed(0)}` });
      if (!moving && tr) {
        trip.delete(v.id);
        const dur = w.time - tr.t0, ideal = tr.len / (def.maxSpeed * KMH_TO_TILES * 0.9);
        if (tr.len >= 10) { tot.trips++; tripTimes.push({ ratio: dur / Math.max(1, ideal), desc: `${ctx} ${def.id}#${v.id} from ${tr.from} len ${tr.len} took ${dur.toFixed(0)}s vs ${ideal.toFixed(0)}s ideal` }); }
      }
    }
    for (const c of w.civilians) boxes.push({ x: c.x, y: c.y, ux: Math.cos(c.angle), uy: Math.sin(c.angle), hl: c.len / 2, hw: c.hw, label: `civ${c.id}`, air: false });
    if (i % 3 === 0) for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      if (boxes[a].air || boxes[b].air) continue;
      if (Math.abs(boxes[a].x - boxes[b].x) > 3 || Math.abs(boxes[a].y - boxes[b].y) > 3) continue;
      if (overlap(boxes[a], boxes[b], 0.05)) { tot.overlaps++; { const kk = [boxes[a].label.startsWith('civ') ? 'civ' : 'veh', boxes[b].label.startsWith('civ') ? 'civ' : 'veh'].sort().join('-'); pairKinds[kk] = (pairKinds[kk] ?? 0) + 1; const pk = `${ctx} ${boxes[a].label}/${boxes[b].label} @${boxes[a].x.toFixed(0)},${boxes[a].y.toFixed(0)} t${w.time.toFixed(0)}`; pairDur[pk.split(' t')[0]] = (pairDur[pk.split(' t')[0]] ?? 0) + 0.1; } if (tot.overlaps < 12) note(`${ctx} t=${w.time.toFixed(1)} overlap ${boxes[a].label} / ${boxes[b].label}`); }
    }
  }
  console.log(`${ctx}: done`);
}
tripTimes.sort((a, b) => b.ratio - a.ratio);
const mv = Math.max(1, tot.moving);
console.log('\n=== vehicle movement quality ===');
console.log(`vehicle-seconds moving: ${tot.moving.toFixed(0)} of ${tot.vehSeconds.toFixed(0)}`);
console.log(`blocked while moving: ${(100 * tot.blocked / mv).toFixed(1)}%  ghost: ${(100 * tot.ghost / mv).toFixed(2)}%  against lane direction: ${(100 * tot.contraflow / mv).toFixed(2)}%`);
console.log(`trips >=10 tiles: ${tot.trips}; median slowness factor ${tripTimes.length ? tripTimes[Math.floor(tripTimes.length / 2)].ratio.toFixed(2) : '-'}; worst 5:`);
for (const t of tripTimes.slice(0, 5)) console.log('  ' + t.ratio.toFixed(1) + 'x  ' + t.desc);
console.log(`overlaps ${tot.overlaps}, teleports ${tot.teleports}, sharp turns/tick ${tot.angleJumps}, speed jerks ${tot.jerk}, off-road ${tot.offroad}, give-ups ${tot.giveUps}, no-route ${tot.noRoute}`);
for (const n of worst) console.log('  - ' + n);

console.log('overlap pairs', JSON.stringify(pairKinds));
console.log('blocked seconds by cause', JSON.stringify(Object.fromEntries(Object.entries(blockKinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]))));
console.log('blocked hot spots', JSON.stringify(Object.entries(blockSpots).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ':' + Math.round(v))));

console.log('longest overlaps (s)', JSON.stringify(Object.entries(pairDur).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ':' + v.toFixed(1))));

console.log('overtake after >3 s behind a stopped car:', JSON.stringify(Object.fromEntries(Object.entries(otReasons).map(([k, v]) => [k, Math.round(v)]))));

console.log('siren vehicles crawling (<2.2 tiles/s), seconds by situation:', JSON.stringify(Object.fromEntries(Object.entries(crawl).map(([k, v]) => [k, Math.round(v)]))));
