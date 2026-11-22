import json
def edit(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        assert a in s, (p,a[:90])
        s=s.replace(a,b,1)
    open(p,'w',encoding='utf-8').write(s)

edit('src/sim/types.ts',[
 ("  /** until this time the vehicle is overtaking through the opposite lane */\n  passUntil: number;\n","  /** until this time the vehicle is overtaking through the opposite lane */\n  passUntil: number;\n  /** dispatch priority: 1 = lights and sirens, 2 = normal traffic (obeys red lights, no lights) */\n  prio: 1 | 2;\n  /** current speed in tiles/s: vehicles accelerate from a standstill */\n  speedNow: number;\n"),
 ("  hearse: number | null;\n}","  hearse: number | null;\n  /** trapped in the wreck: has to be cut free with rescue tools before the stretcher can take them */\n  pinned: boolean;\n  name: string;\n  age: number;\n}"),
 ("  pager: string;\n}","  pager: string;\n  /** vehicle types the control room recommends for this call */\n  units: string[];\n  /** the vehicle types already sent (by the dispatch button or GRIP) */\n  dispatched: boolean;\n}"),
 ("  victims?: { min: number; max: number; location: 'trapped' | 'scene';","  victims?: { min: number; max: number; pinnedChance?: number; location: 'trapped' | 'scene';"),
])
W='src/sim/world.ts'
edit(W,[
 # ---------------- prio on vehicle, creation
 ("returning: false, silent: false, cargo: 0, passUntil: 0, patrol: false,","returning: false, silent: false, cargo: 0, passUntil: 0, prio: 1, speedNow: 0, patrol: false,"),
 ("v.silent ??= false; v.cargo ??= 0; v.passUntil ??= 0;","v.silent ??= false; v.cargo ??= 0; v.passUntil ??= 0; v.prio ??= 1; v.speedNow ??= 0;"),
 ("      v.lights = !v.silent;","      v.lights = !v.silent && v.prio === 1;"),
 # ---------------- orders with priority
 ("  orderMove(ids: number[], x: number, y: number): void {\n    for (const id of ids) {\n      const v = this.vehicles.get(id);\n      if (v) {","  orderMove(ids: number[], x: number, y: number, prio: 1 | 2 = 1): void {\n    for (const id of ids) {\n      const v = this.vehicles.get(id);\n      if (v) {\n        v.prio = prio;"),
 ("  contextOrder(ids: number[], x: number, y: number): void {","  contextOrder(ids: number[], x: number, y: number, prio: 1 | 2 = 1): void {"),
 ("    if (vehicleIds.length) {\n      const tgt = this.targetPoint(target, x, y);\n      this.orderMove(vehicleIds, tgt.x, tgt.y);","    if (vehicleIds.length) {\n      const tgt = this.targetPoint(target, x, y);\n      this.orderMove(vehicleIds, tgt.x, tgt.y, prio);"),
 # ---------------- accelerate from standstill: vehicles
 ("  private driveVehicle(v: Vehicle, dt: number): void {\n    const def = this.vehicleDef(v);\n    let budget = def.maxSpeed * KMH_TO_TILES * dt;","""  private driveVehicle(v: Vehicle, dt: number): void {
    const def = this.vehicleDef(v);
    // speed: accelerate from a standstill (heavy vehicles slowly), slow down for corners, prio 2 drives a little calmer (and in the rain everybody does)
    let vmax = def.maxSpeed * KMH_TO_TILES * (v.prio === 2 ? 0.8 : 1) * (this.raining ? 0.88 : 1);
    const nxt = v.path[1];
    if (nxt && v.path[0] && (nxt.x - v.path[0].x !== v.path[0].x - Math.floor(v.x) || nxt.y - v.path[0].y !== v.path[0].y - Math.floor(v.y)) && Math.hypot(v.path[0].x + 0.5 - v.x, v.path[0].y + 0.5 - v.y) < 1.3) vmax = Math.min(vmax, 1.8);
    const accel = 1.5 + 2.2 / Math.max(1, def.length);
    v.speedNow = Math.max(0, Math.min(vmax, v.speedNow + (v.speedNow < vmax ? accel : -7) * dt));
    if (v.speedNow < 0.15 && vmax > 0.2) v.speedNow = 0.15; // the first moment of pulling away
    let budget = v.speedNow * dt;"""),
 ("      if (blocker) { this.onBlocked(v, blocker, dt); return; }\n      v.blocked = 0;\n      // U-turn: sliding","      if (blocker) { v.speedNow = 0; this.onBlocked(v, blocker, dt); return; }\n      v.blocked = 0;\n      // prio 2 obeys the traffic lights like everybody else\n      if (v.prio === 2 && this.isIntersection(v.path[0].x, v.path[0].y) && !this.isIntersection(Math.floor(v.x), Math.floor(v.y)) && d < 0.95) {\n        if ((this.lightPhase === 0) !== (Math.abs(ux) > Math.abs(uy))) { v.speedNow = 0; return; }\n      }\n      // U-turn: sliding"),
 # ---------------- near enough: stop and be ready
 ("  private onBlocked(v: Vehicle, b: Blocker, dt: number): void {\n    const before = v.blocked;\n    v.blocked += dt;","""  private onBlocked(v: Vehicle, b: Blocker, dt: number): void {
    const before = v.blocked;
    v.blocked += dt;
    // close enough to where it was going but it cannot get any closer: stop right here and be available (a vehicle should not hang about)
    if (v.dest && !v.returning && !v.silent) {
      const near = Math.hypot(v.x - (v.dest.x + 0.5), v.y - (v.dest.y + 0.5));
      if ((v.blocked > 1.0 && (v.path.length <= 4 || near < 4.5)) || (v.blocked > 2.5 && near < 8)) {
        v.path = []; v.dest = null; v.blocked = 0; v.speedNow = 0;
        return;
      }
    }"""),
 # ---------------- overtaking: K parameter + early trigger for sirens
 ("  private overtakePath(x: number, y: number, path: Vec[], selfId: number): Vec[] | null {\n    const cur = { x: Math.floor(x), y: Math.floor(y) };\n    const d = this.laneAt(cur.x, cur.y);\n    const K = 6;","  private overtakePath(x: number, y: number, path: Vec[], selfId: number, K = 6): Vec[] | null {\n    const cur = { x: Math.floor(x), y: Math.floor(y) };\n    const d = this.laneAt(cur.x, cur.y);"),
 ("      const blocker = v.ghost > 0 ? null : this.gate(v, def.length) ?? this.findBlocker(v, v.x, v.y, ux, uy, step, def.length, uturn ? def.length * 0.64 : halfWidth(def.length), PRIO_EMERGENCY);","""      // a siren vehicle does not trail slow traffic: it pulls out to pass as soon as a car is just ahead in the lane
      if (v.lights && this.time > v.passUntil && v.path.length >= 5 && !uturn) {
        const dl = this.laneAt(Math.floor(v.x), Math.floor(v.y));
        if (dl && this.slowAhead(v, dl)) {
          const np = this.overtakePath(v.x, v.y, v.path, v.id, 4);
          if (np) { v.path = np; v.passUntil = this.time + 8; continue; }
        }
      }
      const blocker = v.ghost > 0 ? null : this.gate(v, def.length) ?? this.findBlocker(v, v.x, v.y, ux, uy, step, def.length, uturn ? def.length * 0.64 : halfWidth(def.length), PRIO_EMERGENCY);"""),
 ("  /**\n   * Overtaking: when something slow","""  /** Is there a slower car (or a stopped vehicle) within a few tiles ahead in this lane? */
  private slowAhead(v: Vehicle, lane: Vec): boolean {
    const mine = v.speedNow;
    const ahead = (x: number, y: number) => { const rx = x - v.x, ry = y - v.y; const along = rx * lane.x + ry * lane.y, lat = Math.abs(rx * lane.y - ry * lane.x); return along > 0.6 && along < 3.2 && lat < 0.65; };
    for (const c of this.civilians) if (ahead(c.x, c.y) && c.v < Math.max(1.2, mine * 0.8)) return true;
    for (const o of this.vehicles.values()) if (o !== v && ahead(o.x, o.y) && !o.path.length) return true;
    return false;
  }

  /**
   * Overtaking: when something slow"""),
 # ---------------- people accelerate too
 ("  private stepAlong(e: { x: number; y: number; angle: number }, path: Vec[], speed: number, dt: number): void {\n    let budget = speed * dt;","""  private stepAlong(e: { x: number; y: number; angle: number }, path: Vec[], speed: number, dt: number): void {
    // people (and anything else that walks) accelerate from a standstill instead of moving at full speed at once
    const m = e as { x: number; y: number; angle: number; v?: number; vt?: number };
    if (this.time - (m.vt ?? -9) > 0.25) m.v = 0;
    m.vt = this.time;
    m.v = Math.min(speed, (m.v ?? 0) + 3.2 * dt);
    let budget = Math.max(0.15, m.v) * dt;"""),
 # ---------------- victims: names, pinned
 ("          treatTime: (def.victims.treatTime ?? 6) * sevFactor(sev), condition: def.victims.condition ?? 'Gewond', loadT: 0, hearse: null,\n        };","          treatTime: (def.victims.treatTime ?? 6) * sevFactor(sev), condition: def.victims.condition ?? 'Gewond', loadT: 0, hearse: null,\n          pinned: !trapped && !!def.victims.pinnedChance && this.rng.chance(def.victims.pinnedChance * (0.4 + 0.3 * sev)), ...this.randomPerson(),\n        };"),
 ("condition: 'Gewond door de explosie', loadT: 0, hearse: null,","condition: 'Gewond door de explosie', loadT: 0, hearse: null, pinned: false, ...this.randomPerson(),"),
 ("  private tallWarned = new Set<string>();","""  private tallWarned = new Set<string>();

  /** Weather: a deterministic rain shower now and then (everybody drives a little slower in it). */
  get raining(): boolean {
    const t = this.time / 160 + this.opts.seed * 0.37;
    return Math.sin(t) + 0.6 * Math.sin(t * 0.43 + 2) > 1.15;
  }

  /** A made-up casualty: Dutch first and last name and an age fitting the call. */
  randomPerson(): { name: string; age: number } {
    const first = ['Jan', 'Piet', 'Kees', 'Henk', 'Willem', 'Johan', 'Mohamed', 'Daan', 'Sem', 'Thomas', 'Maria', 'Anna', 'Sophie', 'Emma', 'Fatima', 'Lisa', 'Els', 'Ineke', 'Yara', 'Noor', 'Bram', 'Lars', 'Ruud', 'Sanne', 'Femke'];
    const last = ['de Vries', 'Jansen', 'van den Berg', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Dijk', 'Dekker', 'Brouwer', 'el Amrani', 'Yilmaz', 'Kuijpers'];
    return { name: `${this.rng.pick(first)} ${this.rng.pick(last)}`, age: this.rng.int(4, 88) };
  }

  /** The vehicle types the control room recommends for a call (also shown in the P2000 line). */
  recommendedUnits(inc: Incident): string[] {
    const def = this.content.incidents[inc.defId];
    const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null;
    const out: string[] = [];
    const add = (id: string) => { if (this.content.vehicles[id] && !out.includes(id)) out.push(id); };
    for (const cat of def.requires) {
      if (cat === 'fire') { add('fire_engine'); if (b && (b.floors ?? 1) >= 4 && def.fire) add('aerial_ladder'); if (def.victims?.location === 'trapped' || inc.victims.some(id => this.victims.get(id)?.pinned)) add('rescue_vehicle'); }
      else if (cat === 'ambulance') add('ambulance');
      else if (cat === 'police') add('patrol_car');
      else if (cat === 'tech') add('tow_truck');
    }
    if (inc.victims.some(id => this.victims.get(id)?.pinned)) { add('fire_engine'); add('rescue_vehicle'); }
    if (/hazmat|explosion|chemical/.test(inc.defId)) add('hazmat_unit');
    if (/high_rise|explosion|collapse/.test(inc.defId)) { add('ovd_car'); add('water_tanker'); }
    if (inc.victims.length >= 4) { add('ambulance'); add('lgh_car'); }
    if (inc.suspects.length >= 3 || /riot|demonstration/.test(inc.defId)) add('riot_van');
    if (/suspicious_package/.test(inc.defId)) add('bomb_squad');
    if ((def.obstacle?.mass ?? 0) >= 1.6) add('crane_truck');
    return out;
  }

  /** Send the recommended units (the nearest free vehicle of each type) to the call, with the priority of the pager line. */
  dispatchRecommended(incidentId: number): number {
    const inc = this.incidents.get(incidentId);
    if (!inc) return 0;
    const b = inc.buildingId ? this.buildings.get(inc.buildingId) : null;
    const tx = b ? b.door.x + 0.5 : inc.x, ty = b ? b.door.y + 0.5 : inc.y;
    const prio: 1 | 2 = inc.severity >= 2 ? 1 : 2;
    let n = 0;
    for (const defId of inc.units) {
      const already = [...this.vehicles.values()].some(v => v.defId === defId && v.dest && Math.hypot(v.dest.x - tx, v.dest.y - ty) < 8) || [...this.vehicles.values()].some(v => v.defId === defId && !v.path.length && Math.hypot(v.x - tx, v.y - ty) < 9);
      if (already) continue;
      if (this.sendToScene(defId, tx, ty, prio, false)) n++;
    }
    inc.dispatched = true;
    this.emit({ type: n ? 'info' : 'warn', message: n ? `Uitgerukt voor ${inc.name}: ${n} eenheden (prio ${prio})` : 'Geen vrije eenheden beschikbaar' });
    return n;
  }"""),
 ("  private sendToScene(defId: string, tx: number, ty: number): boolean {","  private sendToScene(defId: string, tx: number, ty: number, prio: 1 | 2 = 1, buy = true): boolean {"),
 ("    const v = free ?? this.callReinforcement(defId, true);\n    if (!v) return false;\n    v.patrol = false; v.returning = false; v.silent = false;","    const v = free ?? (buy ? this.callReinforcement(defId, true) : null);\n    if (!v) return false;\n    v.patrol = false; v.returning = false; v.silent = false; v.prio = prio;"),
 # pager: unit abbreviations
 ("address: '', scouted: false, pager: '',\n    };","address: '', scouted: false, pager: '', units: [], dispatched: false,\n    };"),
 ("i.pager ??= '';","i.pager ??= ''; i.units ??= [];"),
 ("    const urgent = inc.severity >= 2;","    inc.units = this.recommendedUnits(inc);\n    const abbr: Record<string, string> = { fire_engine: 'TS', aerial_ladder: 'HV', rescue_vehicle: 'HW', ambulance: 'AMB', patrol_car: 'PAT', tow_truck: 'BER', police_van: 'BUS', riot_van: 'ME', hazmat_unit: 'OGS', water_tanker: 'WTW', ovd_car: 'OvD', lgh_car: 'LGH', crane_truck: 'KRAAN', bomb_squad: 'EOD', mmt_car: 'MMT' };\n    const urgent = inc.severity >= 2;"),
 ("      : `Prio ${urgent ? 1 : 2} TECH Rendam ${inc.address} ${inc.name}`;","      : `Prio ${urgent ? 1 : 2} TECH Rendam ${inc.address} ${inc.name}`;\n    inc.pager += ` ${inc.units.map(u => abbr[u] ?? u).join(' ')}`;"),
 # ---------------- pinned: rescue + load
 ("      case 'rescue': for (const v of this.victims.values()) if (v.transport === 'trapped' && this.incidents.get(v.incidentId)?.scouted) consider({ kind: 'victim', id: v.id }, dist(r, v)); break;","      case 'rescue': for (const v of this.victims.values()) if ((v.transport === 'trapped' && this.incidents.get(v.incidentId)?.scouted) || (v.pinned && v.transport === 'scene')) consider({ kind: 'victim', id: v.id }, dist(r, v)); break;"),
 ("      case 'rescue': {\n        const v = this.victims.get(t.victimId);\n        const b = v?.buildingId ? this.buildings.get(v.buildingId) : null;","""      case 'rescue': {
        const pv = this.victims.get(t.victimId);
        if (pv && pv.pinned && pv.transport === 'scene') { // cut free with the hydraulic rescue tools
          if (!veh || !this.vehicleDef(veh).equipment.includes('rescue_tools')) { this.emit({ type: 'warn', message: `${r.name}: hydraulisch gereedschap nodig – stuur de hulpverleningswagen` }); return done(); }
          if (this.approachSlot(r, pv.x, pv.y, done)) {
            t.progress += dt * (role.power >= 3 ? 1.4 : 1);
            if (t.progress >= 12 * sevFactor(this.incidents.get(pv.incidentId)?.severity ?? 1, 0.2)) { pv.pinned = false; this.emit({ type: 'info', message: `${pv.name} is bevrijd uit het voertuig` }); done(); }
          }
          break;
        }
        const v = pv;
        const b = v?.buildingId ? this.buildings.get(v.buildingId) : null;"""),
 ("        if (r.carrying === null) {\n          if (this.approachSlot(r, v.x, v.y, done)) {","        if (v.pinned) { this.emit({ type: 'warn', message: `${v.name} zit nog bekneld: eerst bevrijden` }); return done(); }\n        if (r.carrying === null) {\n          if (this.approachSlot(r, v.x, v.y, done)) {"),
 ("        if (v.transport === 'trapped') ability = 'rescue';","        if (v.transport === 'trapped' || v.pinned) ability = 'rescue';"),
])

# JSON: pinnedChance for accidents + demonstration incident
p='src/data/incidents.json'
s=open(p,encoding='utf-8').read()
s=s.replace('"victims": { "min": 1, "max": 2, "location": "scene", "health": [35, 75], "decay": 0.3, "treatTime": 7, "condition": "Letsel na aanrijding" }','"victims": { "min": 1, "max": 2, "pinnedChance": 0.6, "location": "scene", "health": [35, 75], "decay": 0.3, "treatTime": 7, "condition": "Letsel na aanrijding" }',1)
s=s.replace('"victims": { "min": 2, "max": 3, "location": "scene", "health": [30, 70], "decay": 0.33, "treatTime": 8, "condition": "Zwaar letsel" }','"victims": { "min": 2, "max": 3, "pinnedChance": 0.8, "location": "scene", "health": [30, 70], "decay": 0.33, "treatTime": 8, "condition": "Zwaar letsel" }',1)
demo={"id":"demonstration","name":"Demonstratie","category":"police","weight":1,"icon":"📣","descriptions":["Een groep demonstranten bezet het plein voor het gemeentehuis met spandoeken.","Betoging tegen een bouwplan loopt uit de hand, de stemming wordt grimmig.","Demonstratie van tientallen mensen blokkeert de ingang; er zijn spandoeken en trommels."],
      "spawn":{"on":"building","buildingTypes":["shopping","commercial","church","office","school"]},"severity":{"min":1,"max":2},"requires":["police"],"suspects":{"min":0,"max":3,"arrestTime":3},"bystanders":{"min":12,"max":22},"objectives":["area_secured","bystanders_dispersed"],"escalation":{"everySec":55},"failAfterSec":320,"reward":{"score":520,"budget":1000}}
s=s.rstrip()
assert s.endswith(']')
s=s[:-1].rstrip()+',\n  '+json.dumps(demo,ensure_ascii=False)+'\n]\n'
open(p,'w',encoding='utf-8').write(s)
# vehicles: rescue vehicle already has rescue_tools; ensure
