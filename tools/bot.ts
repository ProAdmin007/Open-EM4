// A simple automatic player used by the feasibility check.
import { World, SIM_DT } from '../src/sim/world';
import type { Ability } from '../src/sim/types';

const ORDER: Ability[] = ['recon', 'rescue', 'extinguish', 'treat', 'carry', 'arrest', 'secure', 'defuse', 'clear', 'disperse', 'collect', 'cool', 'assist'];


export function runBot(w: World, incId: number, maxSeconds: number): { solvedAt: number | null; firstArrival: number | null; sent: number } {
  const t0 = w.time, failed0 = w.failed;
  const inc0 = w.incidents.get(incId)!;
  w.questionCaller(incId);
  w.dispatchRecommended(incId);
  const sent = inc0.units.length;
  let firstArrival: number | null = null;
  const tx = inc0.x, ty = inc0.y;
  for (let i = 0; i < maxSeconds * 30; i++) {
    w.reputation = 100;
    w.tick(SIM_DT);
    if (!w.incidents.has(incId)) return { solvedAt: w.failed > failed0 ? null : w.time - t0, firstArrival, sent };
    if (i % 30 !== 0) continue;
    for (const v of w.vehicles.values()) {
      const near = Math.hypot(v.x - tx, v.y - ty) < 24 || (inc0.buildingId && w.buildings.get(inc0.buildingId) && Math.hypot(v.x - (w.buildings.get(inc0.buildingId)!.door.x + 0.5), v.y - (w.buildings.get(inc0.buildingId)!.door.y + 0.5)) < 14);
      if (!near || v.path.length || !v.dest === false) continue;
      if (firstArrival === null) firstArrival = w.time - t0;
      const out = v.crew.filter(id => !w.responders.get(id)!.inVehicle).length;
      if (out === 0 && !v.returning && !v.toHospital && !v.patrol) {
        const def = w.vehicleDef(v);
        if (def.equipment.includes('fire_hose')) w.orderDeployFire([v.id]); else w.orderDismount([v.id]);
      }
    }
    for (const r of w.responders.values()) {
      if (r.task?.type === 'assist' && (w.canDo(r, 'carry') || w.canDo(r, 'treat'))) { r.task = null; r.path = []; } // medics do not just stand around assisting
      if (r.inVehicle || r.task || r.path.length) continue;
      const veh = w.vehicles.get(r.vehicleId);
      const full = !!veh && veh.patients.length >= w.vehicleDef(veh).patientCapacity;
      for (const a of ORDER) { if (a === 'carry' && full) continue; if (w.canDo(r, a) && w.orderAbility([r.id], a) > 0) break; }
    }
    for (const v of w.vehicles.values()) {
      if (v.patients.length && !v.toHospital && !v.path.length && v.crew.every(id => { const t = w.responders.get(id)!.task; return !t || t.type !== 'load' || v.patients.length >= w.vehicleDef(v).patientCapacity; })) { for (const id of v.crew) { const r = w.responders.get(id)!; if (r.task) { r.task = null; r.path = []; } } w.orderToHospital([v.id]); }
      if (v.prisoners.length && !v.returning && !v.path.length && v.crew.every(id => !w.responders.get(id)!.task)) w.orderToHospital([v.id]);
    }
  }
  return { solvedAt: null, firstArrival, sent };
}

