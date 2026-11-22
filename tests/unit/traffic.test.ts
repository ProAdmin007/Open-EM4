import { describe, expect, it } from 'vitest';
import { World, SIM_DT } from '../../src/sim/world';
import { content, newWorld, roadNear, run, straightRoad } from './helpers';

interface Box { x: number; y: number; ux: number; uy: number; hl: number; hw: number; label: string }

const boxOfVehicle = (v: { x: number; y: number; angle: number; defId: string; id: number }): Box => {
  const d = content.vehicles[v.defId];
  return { x: v.x, y: v.y, ux: Math.cos(v.angle), uy: Math.sin(v.angle), hl: d.length / 2, hw: d.length < 1.2 ? 0.22 : 0.36, label: 'veh' + v.id };
};
const boxOfCar = (c: { x: number; y: number; angle: number; id: number; len: number; hw: number }): Box => ({ x: c.x, y: c.y, ux: Math.cos(c.angle), uy: Math.sin(c.angle), hl: c.len / 2, hw: c.hw, label: 'civ' + c.id });
const inBox = (b: Box, px: number, py: number, margin = 0) => {
  const rx = px - b.x, ry = py - b.y;
  return Math.abs(rx * b.ux + ry * b.uy) <= b.hl + margin && Math.abs(-rx * b.uy + ry * b.ux) <= b.hw + margin;
};
/** Do two oriented boxes overlap? (sampled points of each tested against the other, slightly shrunk) */
function overlap(a: Box, b: Box, shrink = 0.12): boolean {
  const pts = (q: Box) => {
    const out: [number, number][] = [];
    for (const s of [-1, -0.5, 0, 0.5, 1]) for (const t of [-1, 0, 1]) out.push([q.x + q.ux * q.hl * s - q.uy * q.hw * t, q.y + q.uy * q.hl * s + q.ux * q.hw * t]);
    return out;
  };
  const a2 = { ...a, hl: a.hl - shrink, hw: a.hw - shrink * 0.5 }, b2 = { ...b, hl: b.hl - shrink, hw: b.hw - shrink * 0.5 };
  return pts(a2).some(([x, y]) => inBox(b2, x, y)) || pts(b2).some(([x, y]) => inBox(a2, x, y));
}

describe('parking', () => {
  it('every station vehicle starts in a parking bay (not on the road) facing the exit', () => {
    const w = newWorld(1);
    expect(w.vehicles.size).toBe(w.map.stations.reduce((n, st) => n + st.fleet.length, 0));
    for (const v of w.vehicles.values()) {
      expect(w.isParking(Math.floor(v.x), Math.floor(v.y))).toBe(true);
      expect(w.isRoad(Math.floor(v.x), Math.floor(v.y))).toBe(false);
      expect(v.angle).toBeCloseTo(-Math.PI / 2);
    }
  });
  it('parked vehicles do not overlap each other or any building', () => {
    const w = newWorld(1);
    const boxes = [...w.vehicles.values()].map(boxOfVehicle);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    for (const b of boxes) for (const s of [-1, -0.5, 0, 0.5, 1]) expect(w.isBuilding(Math.floor(b.x + b.ux * b.hl * s), Math.floor(b.y + b.uy * b.hl * s))).toBe(false);
  });
  it('civilians never drive into parking lots', { timeout: 30000 }, () => {
    const w = World.create(content, { seed: 3, difficulty: 'normal', freeplay: false, traffic: true });
    for (let i = 0; i < 30 * 120; i++) {
      w.tick(SIM_DT);
      for (const c of w.civilians) expect(w.isParking(Math.floor(c.x), Math.floor(c.y))).toBe(false);
    }
  });
});

describe('lanes', () => {
  it('roads are one-way per lane (right-hand traffic) and routes respect that', () => {
    const w = newWorld(1);
    const h = straightRoad(w, 'h', 4), vv = straightRoad(w, 'v', 4);
    expect(w.laneAt(h.x + 1, h.y + 1)).toEqual({ x: 1, y: 0 }); // south row of a horizontal road: eastbound
    expect(w.laneAt(h.x + 1, h.y)).toEqual({ x: -1, y: 0 }); // north row: westbound
    expect(w.laneAt(vv.x, vv.y + 1)).toEqual({ x: 0, y: 1 }); // west column of a vertical road: southbound
    expect(w.laneAt(vv.x + 1, vv.y + 1)).toEqual({ x: 0, y: -1 });
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    const tgt = roadNear(w, w.w / 2, w.h / 2);
    w.orderMove([v.id], tgt.x + 0.5, tgt.y + 0.5);
    let prev = { x: Math.floor(v.x), y: Math.floor(v.y) };
    for (const t of v.path) {
      const ln = w.laneAt(prev.x, prev.y);
      if (ln && !w.isParking(t.x, t.y)) expect([t.x - prev.x, t.y - prev.y]).toEqual([ln.x, ln.y]);
      prev = t;
    }
  });
});

describe('collisions', () => {
  it('vehicles and cars never overlap, even in busy hard freeplay with several emergency trips', () => {
    const w = World.create(content, { seed: 11, difficulty: 'hard', freeplay: true, traffic: true });
    let overlaps = 0, checks = 0;
    const samples: unknown[] = [];
    const send = () => {
      for (const v of w.vehicles.values()) {
        if (!v.path.length && v.crew.every(id => w.responders.get(id)!.inVehicle)) w.orderMove([v.id], 5 + ((v.id * 13) % 50), 5 + ((v.id * 7) % 38));
      }
    };
    send();
    for (let i = 0; i < 30 * 150; i++) {
      w.reputation = 100;
      w.tick(SIM_DT);
      if (i % 90 === 0) send();
      if (i % 3) continue;
      const boxes: Box[] = [...w.vehicles.values()].map(boxOfVehicle).concat(w.civilians.map(boxOfCar));
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        checks++;
        if (overlap(boxes[a], boxes[b], 0.05)) { overlaps++; if (samples.length < 5) samples.push({ t: (i / 30).toFixed(1), a: boxes[a], b: boxes[b] }); }
      }
    }
    expect(checks).toBeGreaterThan(1000);
    expect(JSON.stringify(samples)).toBe('[]');
    expect(overlaps).toBe(0);
  }, 60_000);
  it('emergency vehicles still reach their destination through traffic', () => {
    const w = World.create(content, { seed: 5, difficulty: 'normal', freeplay: false, traffic: true });
    const v = [...w.vehicles.values()].find(x => x.defId === 'ambulance')!;
    w.orderMove([v.id], 55, 38);
    run(w, 150, () => !v.path.length);
    expect(v.path.length).toBe(0);
    expect(Math.hypot(v.x - 55, v.y - 38)).toBeLessThan(6);
  });
});

describe('people never overlap vehicles', () => {
  it('crew steps out beside the vehicle, outside every vehicle footprint', () => {
    const w = newWorld(1);
    for (const v of w.vehicles.values()) {
      const ids = w.orderDismount([v.id]);
      expect(ids.length).toBe(v.crew.length);
    }
    const boxes = [...w.vehicles.values()].map(boxOfVehicle);
    for (const r of w.responders.values()) {
      if (r.inVehicle) continue;
      for (const b of boxes) expect(inBox(b, r.x, r.y)).toBe(false);
      expect(w.isBuilding(Math.floor(r.x), Math.floor(r.y))).toBe(false);
    }
  });
  it('walking responders never enter a vehicle footprint', () => {
    const w = newWorld(1);
    const fire = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    const ids = w.orderDismount([fire.id]);
    const others = [...w.vehicles.values()].filter(v => v !== fire && v.category === 'fire');
    w.orderMove(ids, others[others.length - 1].x + 1, others[others.length - 1].y); // walk through the parking lot
    for (let i = 0; i < 30 * 20; i++) {
      w.tick(SIM_DT);
      const boxes = [...w.vehicles.values()].map(boxOfVehicle);
      for (const id of ids) {
        const r = w.responders.get(id)!;
        for (const b of boxes) expect(inBox(b, r.x, r.y)).toBe(false);
      }
    }
  });
  it('vehicles wait for people in their way instead of driving over them', () => {
    const w = newWorld(1);
    const amb = [...w.vehicles.values()].find(x => x.defId === 'ambulance')!;
    const other = [...w.vehicles.values()].find(x => x.defId === 'rapid_responder')!;
    const ids = w.orderDismount([other.id]);
    const p = w.responders.get(ids[0])!;
    p.x = amb.x; p.y = amb.y - 1.6; p.px = p.x; p.py = p.y; // person directly in the exit lane
    w.orderMove([amb.id], 45, 30);
    run(w, 4);
    expect(amb.y).toBeGreaterThan(p.y + 0.4); // still south of the person, never on or past them
  });
});

describe('hospital button', () => {
  it('sends a vehicle with a patient to the hospital, crew boards first, and hands the patient over', () => {
    const w = newWorld(9);
    const inc = w.spawnIncident('medical_emergency', { severity: 1 })!;
    const victim = w.victims.get(inc.victims[0])!;
    const amb = [...w.vehicles.values()].find(x => x.defId === 'ambulance')!;
    w.orderMove([amb.id], victim.x, victim.y);
    run(w, 90, () => !amb.path.length);
    const crew = w.orderDismount([amb.id]);
    w.orderAbility(crew, 'treat', { kind: 'victim', id: victim.id });
    run(w, 30, () => victim.treated);
    w.orderAbility(crew, 'carry', { kind: 'victim', id: victim.id });
    run(w, 40, () => victim.transport === 'inAmbulance');
    expect(victim.transport).toBe('inAmbulance');
    expect(w.orderToHospital([amb.id])).toBe(1); // crew is still outside: one order does everything
    run(w, 200, () => victim.transport === 'atHospital');
    expect(victim.transport).toBe('atHospital');
    expect(w.incidents.has(inc.id)).toBe(false);
  });
  it('refuses without a patient and for vehicles that cannot transport', () => {
    const w = newWorld(9);
    const amb = [...w.vehicles.values()].find(x => x.defId === 'ambulance')!;
    expect(w.orderToHospital([amb.id])).toBe(0);
    expect(w.drainEvents().some(e => /geen patiënt/.test(e.message))).toBe(true);
    const eng = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    expect(w.orderToHospital([eng.id])).toBe(0);
  });
});

describe('turning around', () => {
  it('an emergency vehicle makes a U-turn on the spot instead of driving a long detour', () => {
    const w = newWorld(1);
    const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine')!;
    // park it in the westbound lane of a long straight road, destination just behind it in the eastbound lane
    const r = straightRoad(w, 'h', 12);
    v.x = r.x + 6.5; v.y = r.y + 0.5; v.px = v.x; v.py = v.y; v.angle = Math.PI; v.path = []; v.dest = null;
    expect(w.laneAt(r.x + 6, r.y)).toEqual({ x: -1, y: 0 });
    expect(w.laneAt(r.x + 8, r.y + 1)).toEqual({ x: 1, y: 0 });
    expect(w.routeVehicle(v, { x: r.x + 8, y: r.y + 1 })).toBe(true);
    expect(v.path.length).toBeLessThanOrEqual(6);
    // somewhere along the path it crosses to the opposite lane (the U-turn)
    let prev = { x: r.x + 6, y: r.y }, crossed = false;
    for (const t of v.path) { if (w.laneAt(prev.x, prev.y) && w.laneAt(t.x, t.y) && t.x === prev.x && t.y !== prev.y) crossed = true; prev = t; }
    expect(crossed).toBe(true);
  });
  it('ordinary routes still follow the lane directions when no U-turn is needed', () => {
    const w = newWorld(1);
    const v = [...w.vehicles.values()].find(x => x.defId === 'ambulance')!;
    const tgt = roadNear(w, w.w * 0.6, w.h * 0.6);
    w.orderMove([v.id], tgt.x + 0.5, tgt.y + 0.5);
    let prev = { x: Math.floor(v.x), y: Math.floor(v.y) };
    let lateral = 0;
    for (const t of v.path) {
      const la = w.laneAt(prev.x, prev.y);
      if (la && !w.isParking(t.x, t.y) && (t.x - prev.x !== la.x || t.y - prev.y !== la.y)) lateral++;
      prev = t;
    }
    expect(lateral).toBeLessThanOrEqual(2);
  });
  it('a vehicle never ends up stuck facing a closed road: it turns around and still arrives', () => {
    const w = World.create(content, { seed: 7, difficulty: 'normal', freeplay: false, traffic: true });
    const v = [...w.vehicles.values()].find(x => x.defId === 'patrol_car')!;
    const r = straightRoad(w, 'h', 14);
    const inc = w.spawnIncident('road_blockage', { severity: 1, at: { x: r.x + 7, y: r.y } })!;
    expect(inc.obstacle.length).toBe(2);
    v.x = r.x + 11.5; v.y = r.y + 0.5; v.px = v.x; v.py = v.y; v.angle = Math.PI; v.path = [];
    w.orderMove([v.id], r.x + 3.5, r.y + 1.5);
    run(w, 120, () => !v.path.length);
    expect(Math.hypot(v.x - (r.x + 3.5), v.y - (r.y + 1.5))).toBeLessThan(3);
  });
});
