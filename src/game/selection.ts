import type { World, OrderTarget } from '../sim/world';
import type { Ability } from '../sim/types';

/**
 * Selection and order logic shared by every renderer. It only needs tile coordinates (via `pickVehicle`/`pickUnit`) and
 * the existing `World` order methods, so the 2D (`GameScene`) and 3D (`Three3DRenderer`) input handlers both drive the
 * same commands instead of duplicating them. See docs/3d.md.
 */
export interface SelectionHost {
  world: World | null;
  state: 'menu' | 'playing' | 'gameover';
  selected: Set<number>;
  inspect: OrderTarget | null;
  audio: { play(name: string): void } | null;
}

/** Nearest vehicle within its own footprint of a tile position, or null. */
export function pickVehicle(w: World, x: number, y: number): number | null {
  let best: number | null = null, bd = Infinity;
  for (const v of w.vehicles.values()) {
    const d = Math.hypot(v.x - x, v.y - y);
    if (d < w.vehicleDef(v).length * 0.55 && d < bd) { bd = d; best = v.id; }
  }
  return best;
}

/** Nearest selectable unit (on-foot responder first, then vehicle) at a tile position, or null. */
export function pickUnit(w: World, x: number, y: number): number | null {
  let best: number | null = null, bd = 1.0;
  for (const r of w.responders.values()) if (!r.inVehicle) { const d = Math.hypot(r.x - x, r.y - y); if (d < Math.min(bd, 0.7)) { bd = d; best = r.id; } }
  if (best !== null) return best;
  for (const v of w.vehicles.values()) { const d = Math.hypot(v.x - x, v.y - y); if (d < Math.min(bd, w.vehicleDef(v).length * 0.55)) { bd = d; best = v.id; } }
  return best;
}

export class Commands {
  private lastRight = { id: -1, t: 0 };
  /** dispatch priority for new orders: 1 = lights and sirens, 2 = normal driving */
  prio: 1 | 2 = 1;

  constructor(private host: SelectionHost) {}

  selectedVehicleIds(): number[] {
    return [...this.host.selected].filter(id => this.host.world?.vehicles.has(id));
  }
  selectedResponderIds(): number[] {
    return [...this.host.selected].filter(id => this.host.world?.responders.has(id));
  }
  select(ids: number[], additive = false): void {
    if (!additive) this.host.selected.clear();
    for (const id of ids) this.host.selected.add(id);
    this.host.inspect = null;
  }
  selectCrew(): void {
    const w = this.host.world!;
    const ids = new Set<number>();
    for (const id of this.selectedVehicleIds()) for (const r of w.vehicles.get(id)!.crew) if (!w.responders.get(r)!.inVehicle) ids.add(r);
    if (ids.size) this.host.selected = ids;
  }
  cmdDismount(): void {
    const w = this.host.world!;
    let vehicles = this.selectedVehicleIds();
    if (!vehicles.length) vehicles = [...new Set(this.selectedResponderIds().map(id => w.responders.get(id)!.vehicleId))];
    const out = w.orderDismount(vehicles);
    if (out.length) { this.host.selected = new Set(out); this.host.audio?.play('dismount'); }
  }
  cmdReturn(): void {
    if (this.host.world!.orderReturn([...this.host.selected])) this.host.audio?.play('order');
  }
  cmdDeploy(): void {
    const out = this.host.world!.orderDeployFire([...this.host.selected]);
    if (out.length) { this.host.selected = new Set(out); this.host.audio?.play('dismount'); }
  }
  cmdCool(): void {
    const out = this.host.world!.orderCoolFire([...this.host.selected]);
    if (out.length) { this.host.selected = new Set(out); this.host.audio?.play('dismount'); }
  }
  cmdPatrol(): void {
    const w = this.host.world!;
    const ids = [...this.host.selected].map(id => (w.vehicles.has(id) ? id : w.responders.get(id)?.vehicleId ?? id));
    if (w.orderPatrol(ids)) this.host.audio?.play('order');
  }
  cmdBackup(defId: string): void {
    const w = this.host.world!;
    const ids = [...this.host.selected].map(id => (w.vehicles.has(id) ? id : w.responders.get(id)?.vehicleId ?? id));
    for (const id of new Set(ids)) if (w.callBackup(id, defId)) { this.host.audio?.play('order'); break; }
  }
  cmdHospital(): void {
    if (this.host.world!.orderToHospital([...this.host.selected])) this.host.audio?.play('order');
  }
  cmdBoard(): void {
    this.host.world!.orderBoard([...this.host.selected]);
  }
  cmdStop(): void {
    this.host.world!.orderStop([...this.host.selected]);
  }
  cmdAbility(a: Ability): void {
    this.host.world!.orderAbility(this.selectedResponderIds(), a);
  }

  /** Box-select everything (vehicles, on-foot responders) whose tile position falls in [x0,x1] x [y0,y1]. */
  boxSelect(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const w = this.host.world!;
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1), loY = Math.min(y0, y1), hiY = Math.max(y0, y1);
    const ids: number[] = [];
    for (const v of w.vehicles.values()) if (v.x >= lo && v.x <= hi && v.y >= loY && v.y <= hiY) ids.push(v.id);
    for (const r of w.responders.values()) if (!r.inVehicle && r.x >= lo && r.x <= hi && r.y >= loY && r.y <= hiY) ids.push(r.id);
    const foot = ids.filter(id => w.responders.has(id));
    this.select(foot.length ? foot : ids, additive);
  }

  /** Right-click order: moves selected vehicles/responders to a tile, with a double-click-on-own-vehicle = dismount shortcut. */
  rightClick(tx: number, ty: number): void {
    const w = this.host.world!;
    const veh = pickVehicle(w, tx, ty);
    const now = performance.now();
    if (veh !== null) {
      const dbl = this.lastRight.id === veh && now - this.lastRight.t < 600;
      this.lastRight = { id: veh, t: now };
      if (dbl) {
        const out = w.orderDismount([veh]);
        if (out.length) { this.host.selected = new Set(out); this.host.audio?.play('dismount'); }
        return;
      }
      if (this.host.selected.size === 1 && this.host.selected.has(veh)) return;
    } else this.lastRight = { id: -1, t: 0 };
    if (this.host.selected.size) this.host.audio?.play('order');
    w.contextOrder([...this.host.selected], tx, ty, this.prio);
  }

  /** Send the recommended units of a call. */
  cmdDispatch(incidentId: number): void {
    const w = this.host.world;
    if (w && w.dispatchRecommended(incidentId)) this.host.audio?.play('order');
  }

  /** Left-click on empty ground / an inspectable entity (victim, suspect, building, incident). */
  leftClick(tx: number, ty: number, additive: boolean): void {
    const w = this.host.world!;
    const hit = pickUnit(w, tx, ty);
    if (hit !== null) { this.select([hit], additive); return; }
    const t = w.pick(tx, ty);
    if (t && (t.kind === 'victim' || t.kind === 'suspect' || t.kind === 'building' || t.kind === 'incident')) { this.host.selected.clear(); this.host.inspect = t; return; }
    if (!additive) { this.host.selected.clear(); this.host.inspect = null; }
  }

  keyCommand(key: string): boolean {
    switch (key) {
      case 'E': this.cmdDismount(); return true;
      case 'R': this.cmdBoard(); return true;
      case 'X': this.cmdStop(); return true;
      case 'H': this.cmdReturn(); return true;
      case 'Z': this.cmdHospital(); return true;
      case 'B': this.cmdDeploy(); return true;
      case 'ESC': this.host.selected.clear(); this.host.inspect = null; return true;
      default: return false;
    }
  }
}
