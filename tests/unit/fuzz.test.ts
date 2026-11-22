import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/world';
import { content } from './helpers';

/** A bug-hunting round: random orders on a busy city for a long time, then invariants (no NaN, nothing inside buildings, consistent crews and casualties). */
describe('fuzz: random orders keep the simulation consistent', () => {
  for (const seed of [101, 102, 103]) {
    it(`seed ${seed}`, { timeout: 120000 }, () => {
      const w = World.create(content, { seed, difficulty: 'hard', freeplay: true, traffic: true });
      w.reputation = 1e9; w.budget = 1e7;
      let rnd = seed;
      const R = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
      const abilities = ['extinguish', 'cool', 'rescue', 'treat', 'assist', 'carry', 'arrest', 'secure', 'disperse', 'clear', 'recon', 'collect', 'defuse'] as const;
      for (let i = 0; i < 30 * 480; i++) {
        w.tick();
        if (i % 45 === 0) {
          const veh = [...w.vehicles.values()];
          const act = R();
          const v = veh[Math.floor(R() * veh.length)];
          if (act < 0.25) { const t = w.roadList[Math.floor(R() * w.roadList.length)]; w.orderMove([v.id], t.x + 0.5, t.y + 0.5); }
          else if (act < 0.4) w.orderDismount([v.id]);
          else if (act < 0.55) w.orderBoard([v.id]);
          else if (act < 0.65) w.orderReturn([v.id]);
          else if (act < 0.7) w.orderToHospital([v.id]);
          else if (act < 0.75) w.orderPatrol([v.id]);
          else if (act < 0.8) w.orderDeployFire([v.id]);
          else if (act < 0.83) w.orderCoolFire([v.id]);
          else if (act < 0.86) w.callBackup(v.id, 'ambulance');
          else if (act < 0.88) w.orderStop([v.id]);
          else { const crew = v.crew.filter(id => w.responders.get(id)?.inVehicle === false); if (crew.length) w.orderAbility(crew, abilities[Math.floor(R() * abilities.length)]); }
        }
      }
      // invariants
      for (const v of w.vehicles.values()) {
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.angle)).toBe(true);
        expect(w.isBuilding(Math.floor(v.x), Math.floor(v.y))).toBe(false);
        expect(v.crew.every(id => w.responders.has(id))).toBe(true);
        expect(v.patients.every(id => w.victims.has(id))).toBe(true);
        expect(v.water).toBeGreaterThanOrEqual(0);
      }
      for (const r of w.responders.values()) {
        expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true);
        if (r.inVehicle) expect(w.vehicles.has(r.vehicleId)).toBe(true);
        if (r.carrying !== null) { const vic = w.victims.get(r.carrying); expect(vic === undefined || vic.carriedBy === r.id || vic.transport === 'carried').toBe(true); }
      }
      for (const c of w.civilians) { expect(Number.isFinite(c.x) && Number.isFinite(c.v)).toBe(true); expect(w.isBuilding(Math.floor(c.x), Math.floor(c.y))).toBe(false); }
      for (const vic of w.victims.values()) {
        expect(Number.isFinite(vic.health)).toBe(true);
        if (vic.transport === 'carried') expect(vic.carriedBy !== null && w.responders.has(vic.carriedBy)).toBe(true);
        if (vic.transport === 'inAmbulance') expect([...w.vehicles.values()].some(v => v.patients.includes(vic.id))).toBe(true);
      }
      for (const b of w.buildings.values()) { expect(b.fire).toBeGreaterThanOrEqual(0); expect(b.fire).toBeLessThanOrEqual(100); expect(b.wet).toBeGreaterThanOrEqual(0); }
    });
  }
});
