import Phaser from 'phaser';
import { SIM_DT, World, type WorldOptions, type SaveGame, type OrderTarget } from '../sim/world';
import type { Ability, Building, Content, GameEvent } from '../sim/types';
import { ART_SCALE } from './assets';
import type { AudioEngine } from './audio';
import { Commands, pickUnit, pickVehicle } from './selection';
import type { GameRenderer } from './renderer';
import { createSnapshot } from '../sim/snapshot';

export const T = 32;

/** The drawing calls the building painter needs (implemented by CanvasPen). */
interface Pen {
  clear(): this;
  setDepth(d: number): this;
  fillStyle(color: number, alpha?: number): this;
  fillRect(x: number, y: number, w: number, h: number): this;
  lineStyle(width: number, color: number, alpha?: number): this;
  strokeRect(x: number, y: number, w: number, h: number): this;
  lineBetween(x0: number, y0: number, x1: number, y1: number): this;
}

/** Tiny Phaser-Graphics-like pen on a 2D canvas, used to bake static art into textures without any WebGL framebuffer. */
class CanvasPen implements Pen {
  constructor(private ctx: CanvasRenderingContext2D) {}
  clear(): this { return this; }
  setDepth(): this { return this; }
  lineStyle(width: number, color: number, alpha = 1): this {
    this.ctx.lineWidth = width;
    this.ctx.globalAlpha = alpha;
    this.ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
    return this;
  }
  strokeRect(x: number, y: number, w: number, h: number): this {
    this.ctx.strokeRect(x, y, w, h);
    return this;
  }
  lineBetween(x0: number, y0: number, x1: number, y1: number): this {
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
    return this;
  }
  fillStyle(color: number, alpha = 1): this {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    return this;
  }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.ctx.fillRect(x, y, w, h);
    return this;
  }
}
const S = 1 / ART_SCALE;

export interface BootData {
  content: Content;
  images: Map<string, HTMLImageElement>;
}
export const boot: { data: BootData | null } = { data: null };

type Tracked = { img: Phaser.GameObjects.Image; frame: number };
interface Particle {
  img: Phaser.GameObjects.Image;
  life: number;
  max: number;
  vx: number;
  vy: number;
  kind: 'flame' | 'smoke' | 'drop';
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class GameScene extends Phaser.Scene {
  world: World | null = null;
  content!: Content;
  state: 'menu' | 'playing' | 'gameover' = 'menu';
  speed = 1;
  selected = new Set<number>();
  inspect: OrderTarget | null = null;
  edgeScroll = false;
  private listeners: ((e: GameEvent) => void)[] = [];
  private acc = 0;
  private alpha = 1;
  private frame = 0;
  private maps = { veh: new Map<number, Tracked>(), res: new Map<number, Tracked>(), vic: new Map<number, Tracked>(), sus: new Map<number, Tracked>(), civ: new Map<number, Tracked>(), ped: new Map<number, Tracked>(), by: new Map<number, Tracked>(), obs: new Map<string, Tracked>() };
  private staticObjs: Phaser.GameObjects.GameObject[] = [];
  private staticTextures: string[] = [];
  private terrainSerial = 0;
  private buildingGfx = new Map<string, { img: Phaser.GameObjects.Image; key: string; destroyed: boolean }>();
  private fx!: Phaser.GameObjects.Graphics;
  private signals!: Phaser.GameObjects.Graphics;
  private lightPhase = -1;
  private incidentIcons = new Map<number, Phaser.GameObjects.Text>();
  private pool: Particle[] = [];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private dragStart: { x: number; y: number; wx: number; wy: number; shift: boolean } | null = null;
  private dragging = false;
  private lastTime = -1;
  private panning: { x: number; y: number; sx: number; sy: number } | null = null;
  fps = 60;
  audio: AudioEngine | null = null;
  viewMode: '2d' | '3d' = '2d';
  renderer3d: GameRenderer | null = null;
  private commands = new Commands(this);

  constructor() {
    super('game');
  }

  /** Switch the active renderer. 3D is loaded lazily so the 2D build stays small (docs/3d.md). */
  async setViewMode(mode: '2d' | '3d'): Promise<void> {
    if (mode === this.viewMode) return;
    if (mode === '3d' && !this.renderer3d) {
      const { Three3DRenderer } = await import('./three-renderer');
      this.renderer3d = new Three3DRenderer(this);
      if (this.world) this.renderer3d.load(this.world);
      this.renderer3d.resize(this.scale.width, this.scale.height);
    }
    this.viewMode = mode;
    this.game.canvas.style.display = mode === '3d' ? 'none' : '';
    const el = (this.renderer3d as unknown as { canvas?: HTMLCanvasElement })?.canvas;
    if (el) el.style.display = mode === '3d' ? '' : 'none';
    if (mode === '3d' && this.world) this.renderer3d!.centerOn(this.cameras.main.worldView.centerX / T, this.cameras.main.worldView.centerY / T);
  }

  onEvent(fn: (e: GameEvent) => void): void {
    this.listeners.push(fn);
  }

  create(): void {
    const data = boot.data!;
    this.content = data.content;
    for (const [k, img] of data.images) if (!this.textures.exists(k)) this.textures.addImage(k, img);
    this.fx = this.add.graphics().setDepth(5000);
    this.signals = this.add.graphics().setDepth(900);
    this.input.mouse?.disableContextMenu();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E,R,ESC,F,ONE,TWO,THREE,X,H,B,Z') as Record<string, Phaser.Input.Keyboard.Key>;
    this.setupInput();
    this.makePool();
    this.cameras.main.setBackgroundColor('#1d2a1d');
    this.scale.on('resize', (size: { width: number; height: number }) => this.renderer3d?.resize(size.width, size.height));
    this.startWorld({ seed: 1, difficulty: 'normal', freeplay: false, traffic: true });
    this.state = 'menu';
    this.cameras.main.setZoom(0.9);
    this.cameras.main.centerOn(32 * T, 24 * T);
  }

  // ---------- game lifecycle ----------
  startWorld(opts: WorldOptions, save?: SaveGame): void {
    this.world = save ? World.fromSave(this.content, save) : World.create(this.content, opts);
    this.selected.clear();
    this.inspect = null;
    this.acc = 0;
    this.renderer3d?.load(this.world);
    this.rebuildStatic();
    this.cameras.main.setBounds(-150, -100, this.world.w * T + 300, this.world.h * T + 450);
    for (const m of Object.values(this.maps)) { for (const t of m.values()) t.img.destroy(); m.clear(); }
    for (const t of this.incidentIcons.values()) t.destroy();
    this.incidentIcons.clear();
    this.lightPhase = -1;
    for (const p of this.pool) p.img.setVisible(false).setActive(false);
    const st = [...this.world.buildings.values()].find(b => b.type === 'station');
    if (st) this.cameras.main.centerOn((st.x + st.w / 2) * T, (st.y + st.h / 2) * T);
  }

  begin(opts: WorldOptions, save?: SaveGame): void {
    this.startWorld({ ...opts, traffic: true }, save);
    this.state = 'playing';
    this.speed = 1;
    this.cameras.main.setZoom(1);
    const first = [...this.world!.vehicles.values()][0];
    if (first) this.cameras.main.centerOn(first.x * T, first.y * T);
  }

  toMenu(): void {
    this.startWorld({ seed: Date.now() & 0xffff, difficulty: 'normal', freeplay: false, traffic: true });
    this.state = 'menu';
    this.speed = 1;
    this.cameras.main.setZoom(0.9);
    this.cameras.main.centerOn(32 * T, 24 * T);
  }

  setSpeed(s: number): void {
    this.speed = s;
  }
  togglePause(): void {
    this.speed = this.speed === 0 ? 1 : 0;
  }

  // ---------- commands (used by input and HUD; shared with the 3D renderer via Commands, see selection.ts) ----------
  selectedVehicleIds(): number[] {
    return this.commands.selectedVehicleIds();
  }
  selectedResponderIds(): number[] {
    return this.commands.selectedResponderIds();
  }
  cmdDismount(): void {
    this.commands.cmdDismount();
  }
  cmdReturn(): void {
    this.commands.cmdReturn();
  }
  cmdDeploy(): void {
    this.commands.cmdDeploy();
  }
  cmdHospital(): void {
    this.commands.cmdHospital();
  }
  cmdBoard(): void {
    this.commands.cmdBoard();
  }
  cmdStop(): void {
    this.commands.cmdStop();
  }
  cmdAbility(a: Ability): void {
    this.commands.cmdAbility(a);
  }
  selectCrew(): void {
    this.commands.selectCrew();
  }
  select(ids: number[], additive = false): void {
    this.commands.select(ids, additive);
  }
  centerOn(tx: number, ty: number): void {
    if (this.viewMode === '3d' && this.renderer3d) { this.renderer3d.centerOn(tx, ty); return; }
    this.cameras.main.centerOn(tx * T, ty * T);
  }
  zoomBy(f: number): void {
    if (this.viewMode === '3d' && this.renderer3d) { (this.renderer3d as unknown as { zoomBy(f: number): void }).zoomBy(f); return; }
    const c = this.cameras.main;
    c.setZoom(Phaser.Math.Clamp(c.zoom * f, 0.5, 2.2));
  }
  /** Tile coordinates under a screen position (relative to the canvas). */
  screenToTile(sx: number, sy: number): { x: number; y: number } | null {
    if (this.viewMode === '3d' && this.renderer3d) return this.renderer3d.screenToTile(sx, sy);
    const wp = this.cameras.main.getWorldPoint(sx, sy);
    return { x: wp.x / T, y: wp.y / T };
  }
  /** Screen position (relative to the canvas) of a tile coordinate. Used by tests and the HUD. */
  tileToScreen(tx: number, ty: number): { x: number; y: number } {
    if (this.viewMode === '3d' && this.renderer3d) return this.renderer3d.tileToScreen(tx, ty);
    const c = this.cameras.main;
    return { x: (tx * T - c.worldView.x) * c.zoom, y: (ty * T - c.worldView.y) * c.zoom };
  }

  // ---------- input ----------
  private setupInput(): void {
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 0.9 : 1.1));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.state !== 'playing' || !this.world) return;
      if (p.middleButtonDown()) { this.panning = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY }; return; }
      if (p.rightButtonDown()) {
        const wp = this.cameras.main.getWorldPoint(p.x, p.y);
        this.commands.rightClick(wp.x / T, wp.y / T);
        return;
      }
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.dragStart = { x: p.x, y: p.y, wx: wp.x, wy: wp.y, shift: !!(p.event as MouseEvent | undefined)?.shiftKey };
      this.dragging = false;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.panning && p.isDown) {
        const c = this.cameras.main;
        c.setScroll(this.panning.sx - (p.x - this.panning.x) / c.zoom, this.panning.sy - (p.y - this.panning.y) / c.zoom);
      }
      if (this.dragStart && Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y) > 6) this.dragging = true;
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.panning = null;
      const d = this.dragStart;
      this.dragStart = null;
      if (!d || !this.world || this.state !== 'playing') return;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      if (this.dragging) {
        this.commands.boxSelect(d.wx / T, d.wy / T, wp.x / T, wp.y / T, d.shift);
        this.dragging = false;
        return;
      }
      this.commands.leftClick(wp.x / T, wp.y / T, d.shift);
    });
    const kd = (k: string, fn: () => void) => this.input.keyboard!.on(`keydown-${k}`, () => { if (this.state === 'playing') fn(); });
    kd('SPACE', () => this.togglePause());
    kd('E', () => this.cmdDismount());
    kd('R', () => this.cmdBoard());
    kd('X', () => this.cmdStop());
    kd('H', () => this.cmdReturn());
    kd('Z', () => this.cmdHospital());
    kd('B', () => this.cmdDeploy());
    kd('ESC', () => { this.selected.clear(); this.inspect = null; });
    kd('ONE', () => this.setSpeed(1));
    kd('TWO', () => this.setSpeed(2));
    kd('THREE', () => this.setSpeed(4));
    kd('F', () => {
      const id = [...this.selected][0];
      const e = this.world!.vehicles.get(id) ?? this.world!.responders.get(id);
      if (e) this.centerOn(e.x, e.y);
    });
  }

  pickVehicle(x: number, y: number): number | null {
    return pickVehicle(this.world!, x, y);
  }

  pickUnit(x: number, y: number): number | null {
    return pickUnit(this.world!, x, y);
  }

  // ---------- static world ----------
  private rebuildStatic(): void {
    for (const o of this.staticObjs) o.destroy();
    this.staticObjs = [];
    for (const k of this.staticTextures) if (this.textures.exists(k)) this.textures.remove(k);
    this.staticTextures = [];
    for (const b of this.buildingGfx.values()) b.img.destroy();
    this.buildingGfx.clear();
    const w = this.world!;
    const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const bays = new Set(w.map.stations.flatMap(st => (st.bays ?? []).map(b => b.y * w.w + b.x)));
    // The terrain is drawn once on small 2D canvases (16x16 tiles each) and uploaded as textures: thousands of tile
    // rectangles are not replayed every frame, and no WebGL framebuffer or huge buffer is needed.
    const CH = 16;
    this.terrainSerial++;
    for (let cy0 = 0; cy0 < w.h; cy0 += CH) {
      for (let cx0 = 0; cx0 < w.w; cx0 += CH) {
        const cw = Math.min(CH, w.w - cx0), chh = Math.min(CH, w.h - cy0);
        const canvas = document.createElement('canvas');
        canvas.width = cw * T;
        canvas.height = chh * T;
        const g = new CanvasPen(canvas.getContext('2d')!);
        g.fillStyle(0x2f4a2c, 1).fillRect(0, 0, cw * T, chh * T);
        for (let y = cy0; y < cy0 + chh; y++) {
          for (let x = cx0; x < cx0 + cw; x++) {
            const px = (x - cx0) * T, py = (y - cy0) * T;
        if (w.isRoad(x, y)) {
          g.fillStyle(0x3b3f46, 1).fillRect(px, py, T, T);
          g.fillStyle(0x434850, 0.6).fillRect(px + 4, py + ((hash(x, y) % 5) * 5), 6, 2);
          const curb = 0xa9a79f;
          if (!w.isRoad(x, y - 1)) g.fillStyle(curb, 1).fillRect(px, py, T, 3);
          if (!w.isRoad(x, y + 1)) g.fillStyle(curb, 1).fillRect(px, py + T - 3, T, 3);
          if (!w.isRoad(x - 1, y)) g.fillStyle(curb, 1).fillRect(px, py, 3, T);
          if (!w.isRoad(x + 1, y)) g.fillStyle(curb, 1).fillRect(px + T - 3, py, 3, T);
          // lane markings along the middle of 2-wide roads
          if (!w.isIntersection(x, y)) {
            const vert = w.isRoad(x, y - 1) && w.isRoad(x, y + 1) && !(w.isRoad(x - 1, y) && w.isRoad(x + 1, y));
            if (vert && w.isRoad(x + 1, y) && !w.isRoad(x - 1, y)) g.fillStyle(0xe8e0a0, 0.9).fillRect(px + T - 1, py + (y % 2 ? 4 : 0), 2, 12);
            const horiz = w.isRoad(x - 1, y) && w.isRoad(x + 1, y) && !(w.isRoad(x, y - 1) && w.isRoad(x, y + 1));
            if (horiz && w.isRoad(x, y + 1) && !w.isRoad(x, y - 1)) g.fillStyle(0xe8e0a0, 0.9).fillRect(px + (x % 2 ? 4 : 0), py + T - 1, 12, 2);
          }
        } else if (w.isWater(x, y)) {
          g.fillStyle(0x2d6fa6, 1).fillRect(px, py, T, T);
          g.fillStyle(0x4f93c8, 0.45).fillRect(px + 4 + ((hash(x, y) % 3) * 4), py + 8, 12, 2).fillRect(px + 10, py + 20 + (hash(y, x) % 3) * 2, 12, 2);
          if (!w.isWater(x, y - 1)) g.fillStyle(0xd8c690, 0.9).fillRect(px, py, T, 3);
          if (!w.isWater(x, y + 1)) g.fillStyle(0xd8c690, 0.9).fillRect(px, py + T - 3, T, 3);
          if (!w.isWater(x - 1, y)) g.fillStyle(0xd8c690, 0.9).fillRect(px, py, 3, T);
          if (!w.isWater(x + 1, y)) g.fillStyle(0xd8c690, 0.9).fillRect(px + T - 3, py, 3, T);
        } else if (w.isParking(x, y)) {
          g.fillStyle(0x4b505b, 1).fillRect(px, py, T, T);
          g.fillStyle(0x565c68, 0.55).fillRect(px + 2, py + 2, T - 4, T - 4);
          if (bays.has(y * w.w + x)) {
            g.fillStyle(0xf2f2f2, 0.9).fillRect(px, py, 2, T).fillRect(px + T - 2, py, 2, T);
            g.fillStyle(0xf2f2f2, 0.5).fillRect(px + T / 2 - 4, py + T - 5, 8, 2);
          }
          if (!w.isParking(x, y - 1) && !w.isRoad(x, y - 1)) g.fillStyle(0xa9a79f, 1).fillRect(px, py, T, 3);
        } else if (!w.isBuilding(x, y)) {
          const v = hash(x, y) % 4;
          g.fillStyle(v === 0 ? 0x34522f : v === 1 ? 0x2c4529 : 0x315030, 1).fillRect(px, py, T, T);
          if (w.isTree(x, y)) {
            const t = this.add.image(x * T + 16 + ((hash(x, y) >> 3) % 7) - 3, y * T + 16, hash(x, y) % 2 ? 'tree' : 'tree2').setScale(S * (0.9 + (hash(x, y) % 4) / 10)).setDepth(3);
            this.staticObjs.push(t);
          }
        }
          }
        }
        const key = `terrain_${this.terrainSerial}_${cx0}_${cy0}`;
        this.textures.addCanvas(key, canvas);
        this.staticTextures.push(key);
        this.staticObjs.push(this.add.image(cx0 * T, cy0 * T, key).setOrigin(0, 0).setDepth(0));
      }
    }
    for (const b of w.buildings.values()) {
      this.bakeBuilding(b, false);
      if (b.type === 'station' || b.type === 'hospital') {
        const label = this.add.text((b.x + b.w / 2) * T, (b.y + b.h) * T - b.height - 20, b.name ?? '', { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#fff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(800);
        this.staticObjs.push(label);
      }
    }
  }

  private buildingColors(b: Building): { wall: number; roof: number } {
    if (b.type === 'station') {
      const st = this.world!.map.stations.find(s => s.buildingId === b.id);
      return { fire: { wall: 0x8e2b2b, roof: 0xc0392b }, ambulance: { wall: 0xb89b1e, roof: 0xf1c40f }, police: { wall: 0x23498f, roof: 0x2e6bd6 }, tech: { wall: 0x4d7a2a, roof: 0x7cb342 } }[st?.category ?? 'fire'];
    }
    switch (b.type) {
      case 'residential': return { wall: 0xb08968, roof: 0x9c4a3a };
      case 'apartment': return { wall: 0x8a8d93, roof: 0xb8bcc4 };
      case 'commercial': return { wall: 0x4f6d8a, roof: 0x6f93b8 };
      case 'industrial': return { wall: 0x666a6e, roof: 0x8c9196 };
      case 'hospital': return { wall: 0xcfd8dc, roof: 0xf5f7f8 };
      case 'office': return { wall: 0x3a566e, roof: 0x5b86a6 };
      case 'warehouse': return { wall: 0x777c80, roof: 0x9aa1a6 };
      case 'school': return { wall: 0x9a5a46, roof: 0xc47a5d };
      case 'shopping': return { wall: 0x7b4f7d, roof: 0xa879aa };
      case 'church': return { wall: 0xc9bfa8, roof: 0x7a6a5a };
      default: return { wall: 0x888888, roof: 0xaaaaaa };
    }
  }

  /** Paint a building onto its own small canvas and show it as an image (static art is not re-drawn every frame). */
  private bakeBuilding(b: Building, destroyed: boolean): void {
    const hh = b.height;
    const ox = b.x * T - 10, oy = b.y * T - hh - 44;
    const canvas = document.createElement('canvas');
    canvas.width = b.w * T + 30;
    canvas.height = b.h * T + hh + 62;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(-ox, -oy);
    this.drawBuilding(new CanvasPen(ctx), b, destroyed);
    const key = `bld_${this.terrainSerial}_${b.id}_${destroyed ? 1 : 0}`;
    this.textures.addCanvas(key, canvas);
    const old = this.buildingGfx.get(b.id);
    if (old) {
      old.img.setTexture(key);
      if (this.textures.exists(old.key)) this.textures.remove(old.key);
      old.key = key;
      old.destroyed = destroyed;
    } else {
      this.buildingGfx.set(b.id, { img: this.add.image(ox, oy, key).setOrigin(0, 0).setDepth((b.y + b.h) * T), key, destroyed });
    }
    this.staticTextures.push(key);
  }

  private drawBuilding(g: Pen, b: Building, destroyed: boolean): void {
    g.clear();
    const x = b.x * T, y = b.y * T, w = b.w * T, h = b.h * T, hh = b.height;
    const col = this.buildingColors(b);
    if (destroyed) {
      g.fillStyle(0x24201d, 1).fillRect(x + 2, y + 2, w - 4, h - 4);
      g.fillStyle(0x3a322c, 1).fillRect(x + 6, y + 8, w * 0.4, h * 0.3).fillRect(x + w * 0.5, y + h * 0.5, w * 0.35, h * 0.3);
      return;
    }
    g.fillStyle(0x000000, 0.22).fillRect(x + 4, y + 4, w, h); // shadow
    // front wall (south face)
    g.fillStyle(col.wall, 1).fillRect(x, y + h - hh, w, hh);
    g.fillStyle(0x000000, 0.18).fillRect(x, y + h - hh, w, 3);
    const winCols = Math.max(1, Math.floor(w / 14));
    const floors = Math.max(1, Math.floor(hh / 14));
    for (let f = 0; f < floors; f++) for (let c = 0; c < winCols; c++) {
      g.fillStyle(0xffe9a8, b.type === 'industrial' ? 0.35 : 0.8).fillRect(x + 5 + c * (w - 10) / winCols, y + h - hh + 3 + f * 13, 7, 7);
    }
    // roof, shifted up
    const ry = y - hh;
    g.fillStyle(col.roof, 1).fillRect(x, ry, w, h);
    g.lineStyle(2, 0x000000, 0.35).strokeRect(x, ry, w, h);
    switch (b.type) {
      case 'residential':
        g.lineStyle(2, 0x000000, 0.25).lineBetween(x, ry + h / 2, x + w, ry + h / 2);
        g.fillStyle(0xffffff, 0.08).fillRect(x, ry, w, h / 2);
        g.fillStyle(0x5d4037, 1).fillRect(x + w * 0.65, ry + 4, 8, 10); // chimney
        if (b.roof === 'hip') g.lineStyle(2, 0x000000, 0.2).lineBetween(x, ry, x + w / 2, ry + h / 2).lineBetween(x + w, ry, x + w / 2, ry + h / 2).lineBetween(x, ry + h, x + w / 2, ry + h / 2).lineBetween(x + w, ry + h, x + w / 2, ry + h / 2);
        break;
      case 'apartment':
        g.fillStyle(0x000000, 0.15).fillRect(x + 8, ry + 8, 14, 10).fillRect(x + w - 24, ry + h - 20, 14, 10);
        break;
      case 'commercial':
        g.fillStyle(0xd35400, 1).fillRect(x, ry + h - 8, w, 8);
        g.fillStyle(0x000000, 0.12).fillRect(x + 8, ry + 8, w - 16, h - 22);
        break;
      case 'industrial':
        for (let i = 0; i < Math.floor(w / 12); i++) g.lineStyle(1, 0x000000, 0.2).lineBetween(x + 6 + i * 12, ry, x + 6 + i * 12, ry + h);
        g.fillStyle(0x4a4e52, 1).fillRect(x + w - 18, ry + 6, 10, 10);
        break;
      case 'station': {
        g.fillStyle(0xffffff, 0.9).fillRect(x + 6, ry + h / 2 - 3, w - 12, 6);
        for (let i = 0; i < Math.floor((b.w - 1) / 2); i++) g.fillStyle(0x222222, 0.6).fillRect(x + 10 + i * 56, y + h - hh + 3, 40, hh - 3);
        break;
      }
      case 'office':
        for (let i = 0; i < Math.floor(w / 12); i++) for (let j = 0; j < Math.floor(h / 12); j++) g.fillStyle(0xffffff, 0.12).fillRect(x + 4 + i * 12, ry + 4 + j * 12, 8, 8);
        g.fillStyle(0x2c3e50, 1).fillRect(x + w - 22, ry + 6, 14, 10).fillRect(x + 8, ry + h - 18, 10, 8);
        break;
      case 'warehouse':
        for (let i = 0; i < Math.floor(w / 12); i++) g.lineStyle(1, 0x000000, 0.18).lineBetween(x + 6 + i * 12, ry, x + 6 + i * 12, ry + h);
        for (let i = 0; i < Math.floor(w / 44); i++) g.fillStyle(0x3b3f43, 1).fillRect(x + 8 + i * 44, y + h - hh + 2, 32, hh - 2);
        break;
      case 'school':
        g.lineStyle(2, 0x000000, 0.25).lineBetween(x, ry, x + w / 2, ry + h / 2).lineBetween(x + w, ry, x + w / 2, ry + h / 2).lineBetween(x, ry + h, x + w / 2, ry + h / 2).lineBetween(x + w, ry + h, x + w / 2, ry + h / 2);
        g.fillStyle(0xffd54f, 1).fillRect(x + w / 2 - 2, ry + h / 2 - 12, 4, 12);
        break;
      case 'shopping':
        for (let i = 0; i < Math.floor(w / 16); i++) g.fillStyle(i % 2 ? 0xffffff : 0xe53935, 0.9).fillRect(x + i * 16, ry + h - 10, 16, 10);
        g.fillStyle(0x000000, 0.12).fillRect(x + 8, ry + 8, w - 16, h - 28);
        break;
      case 'church':
        g.lineStyle(2, 0x000000, 0.25).lineBetween(x, ry + h / 2, x + w, ry + h / 2);
        g.fillStyle(0x8d7b68, 1).fillRect(x + w / 2 - 10, ry - 14, 20, 20);
        g.fillStyle(0xffffff, 1).fillRect(x + w / 2 - 1.5, ry - 26, 3, 14).fillRect(x + w / 2 - 6, ry - 21, 12, 3);
        break;
      case 'hospital':
        g.fillStyle(0xd32f2f, 1).fillRect(x + w / 2 - 22, ry + h / 2 - 7, 44, 14).fillRect(x + w / 2 - 7, ry + h / 2 - 22, 14, 44);
        break;
    }
    // door marker
    const dx = b.door.x * T, dy = b.door.y * T;
    g.fillStyle(0xffffff, 0.35).fillRect(dx + 8, dy + (b.door.y >= b.y + b.h ? 0 : T - 4), T - 16, 4);
  }

  // ---------- particles ----------
  private makePool(): void {
    const add = (kind: Particle['kind'], tex: string, n: number) => {
      for (let i = 0; i < n; i++) this.pool.push({ img: this.add.image(0, 0, tex).setVisible(false).setActive(false), life: 0, max: 1, vx: 0, vy: 0, kind });
    };
    add('flame', 'flame', 260);
    add('smoke', 'smoke', 180);
    add('drop', 'drop', 120);
  }
  private emitParticle(kind: Particle['kind'], x: number, y: number): void {
    for (const p of this.pool) {
      if (p.kind !== kind || p.img.active) continue;
      p.img.setActive(true).setVisible(true).setPosition(x, y).setAlpha(1);
      if (kind === 'flame') { p.max = 0.5 + Math.random() * 0.5; p.vx = (Math.random() - 0.5) * 10; p.vy = -22 - Math.random() * 18; p.img.setScale(S * (0.7 + Math.random() * 0.6)).setDepth(3000); }
      else if (kind === 'smoke') { p.max = 1.4 + Math.random(); p.vx = 8 + Math.random() * 10; p.vy = -18 - Math.random() * 10; p.img.setScale(S * 0.6).setDepth(3100); }
      else { p.max = 0.35; p.vx = (Math.random() - 0.5) * 20; p.vy = (Math.random() - 0.5) * 20; p.img.setScale(S * 1.2).setDepth(3050); }
      p.life = 0;
      return;
    }
  }
  private updateParticles(dt: number): void {
    for (const p of this.pool) {
      if (!p.img.active) continue;
      p.life += dt;
      if (p.life >= p.max) { p.img.setActive(false).setVisible(false); continue; }
      const k = p.life / p.max;
      p.img.x += p.vx * dt; p.img.y += p.vy * dt;
      if (p.kind === 'flame') p.img.setAlpha(1 - k).setScale(S * (1 - k * 0.5));
      else if (p.kind === 'smoke') p.img.setAlpha(0.55 * (1 - k)).setScale(S * (0.6 + k * 1.2));
      else p.img.setAlpha(1 - k);
    }
  }

  // ---------- per-frame ----------
  override update(time: number, _delta: number): void {
    // Real elapsed time (not Phaser's smoothed delta): the simulation must keep real-time pace even when rendering is slow.
    const dt = this.lastTime < 0 ? 0 : Math.min(Math.max((time - this.lastTime) / 1000, 0), 0.25);
    this.lastTime = time;
    this.fps = this.game.loop.actualFps;
    this.frame++;
    if (this.viewMode === '2d') this.moveCamera(dt);
    const w = this.world;
    if (!w) return;
    if (this.speed > 0 && this.state !== 'gameover') {
      this.acc += dt * this.speed;
      let steps = 0;
      const t0 = performance.now();
      while (this.acc >= SIM_DT && steps < 40 && (steps < 2 || performance.now() - t0 < 40)) { w.tick(SIM_DT); this.acc -= SIM_DT; steps++; }
      if (this.acc >= SIM_DT) this.acc = 0; // cannot keep up: drop the backlog instead of a spiral of death
      this.alpha = Math.min(1, this.acc / SIM_DT);
      for (const e of w.drainEvents()) {
        if (this.state === 'playing') this.listeners.forEach(f => f(e));
        if ((e.type === 'game_over' || e.type === 'mission_complete') && this.state === 'playing') { this.state = 'gameover'; }
      }
    }
    this.normaliseSelection();
    let centre: { x: number; y: number };
    if (this.viewMode === '3d' && this.renderer3d) {
      this.renderer3d.render(createSnapshot(w, this.alpha), dt);
      centre = (this.renderer3d as unknown as { cameraTile(): { x: number; y: number } }).cameraTile();
    } else {
      this.render(time, dt);
      const wv = this.cameras.main.worldView;
      centre = { x: wv.centerX / T, y: wv.centerY / T };
    }
    this.audio?.update(w, centre, this.state === 'playing', this.speed === 0);
  }

  private normaliseSelection(): void {
    const w = this.world!;
    let changed = false;
    const next = new Set<number>();
    for (const id of this.selected) {
      const r = w.responders.get(id);
      if (r) { if (r.inVehicle) { next.add(r.vehicleId); changed = true; } else next.add(id); }
      else if (w.vehicles.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) this.selected = next;
  }

  private moveCamera(dt: number): void {
    if (this.state !== 'playing' && this.state !== 'gameover') return;
    const c = this.cameras.main, sp = (700 / c.zoom) * dt;
    let dx = 0, dy = 0;
    if (this.keys.A.isDown || this.keys.LEFT.isDown) dx -= sp;
    if (this.keys.D.isDown || this.keys.RIGHT.isDown) dx += sp;
    if (this.keys.W.isDown || this.keys.UP.isDown) dy -= sp;
    if (this.keys.S.isDown || this.keys.DOWN.isDown) dy += sp;
    const p = this.input.activePointer;
    if (this.edgeScroll && this.input.isOver && !this.dragStart) {
      const m = 14, W = this.scale.width, H = this.scale.height;
      if (p.x < m) dx -= sp; else if (p.x > W - m) dx += sp;
      if (p.y < m) dy -= sp; else if (p.y > H - m) dy += sp;
    }
    if (dx || dy) c.setScroll(c.scrollX + dx, c.scrollY + dy);
  }

  private track<T extends { id: number }>(map: Map<number, Tracked>, items: Iterable<T>, make: (i: T) => Phaser.GameObjects.Image, upd: (img: Phaser.GameObjects.Image, i: T) => void): void {
    for (const it of items) {
      let t = map.get(it.id);
      if (!t) { t = { img: make(it), frame: 0 }; map.set(it.id, t); }
      t.frame = this.frame;
      upd(t.img, it);
    }
    for (const [id, t] of map) if (t.frame !== this.frame) { t.img.destroy(); map.delete(id); }
  }

  private render(time: number, dt: number): void {
    const w = this.world!, a = this.alpha, m = this.maps;
    const ix = (e: { px: number; x: number }) => lerp(e.px, e.x, a) * T;
    const iy = (e: { py: number; y: number }) => lerp(e.py, e.y, a) * T;
    const lane = (img: Phaser.GameObjects.Image, e: { px: number; x: number; py: number; y: number }, ang: number, off: number) => {
      img.setPosition(ix(e) - Math.sin(ang) * off, iy(e) + Math.cos(ang) * off).setRotation(ang);
    };
    this.track(m.veh, w.vehicles.values(), v => this.add.image(0, 0, `veh_${v.defId}`).setScale(S), (img, v) => { lane(img, v, v.angle, 0); img.setDepth(1000 + v.y); });
    this.track(m.res, w.responders.values(), r => this.add.image(0, 0, `res_${r.role}`).setScale(S), (img, r) => {
      img.setVisible(!r.inVehicle).setPosition(ix(r), iy(r)).setRotation(r.angle).setDepth(1100 + r.y);
    });
    this.track(m.vic, w.victims.values(), () => this.add.image(0, 0, 'victim').setScale(S), (img, v) => {
      const show = v.transport === 'scene' || v.transport === 'carried' || v.transport === 'dead';
      img.setVisible(show).setPosition(ix(v), iy(v)).setDepth(1050 + v.y).setTexture(v.transport === 'dead' ? 'victim_dead' : 'victim');
      img.setTint(v.treated ? 0xb9f6ca : v.health < 35 ? 0xffab91 : 0xffffff);
    });
    this.track(m.sus, w.suspects.values(), () => this.add.image(0, 0, 'suspect').setScale(S), (img, s) => {
      img.setPosition(ix(s), iy(s)).setDepth(1050 + s.y);
      img.setTint(s.arrested ? 0x90a4ae : 0xffffff);
    });
    this.track(m.civ, w.civilians, c => this.add.image(0, 0, `civ_${c.color}`).setScale(S), (img, c) => { lane(img, c, c.angle, 0); img.setDepth(900 + c.y); });
    this.track(m.ped, w.pedestrians, p => this.add.image(0, 0, `ped_${p.color}`).setScale(S * 0.9), (img, p) => img.setPosition(ix(p), iy(p)).setDepth(850 + p.y));
    this.track(m.by, w.bystanders.values(), b => this.add.image(0, 0, `ped_${b.color}`).setScale(S * 1.05), (img, b) => img.setPosition(ix(b), iy(b)).setDepth(1040 + b.y));
    // obstacles
    const seen = new Set<string>();
    for (const inc of w.incidents.values()) {
      const def = this.content.incidents[inc.defId];
      inc.obstacle.forEach(o => {
        const k = `${o.x},${o.y}`;
        seen.add(k);
        if (!m.obs.has(k)) {
          const big = (def.obstacle?.tiles ?? 1) > 1;
          m.obs.set(k, { img: this.add.image((o.x + 0.5) * T, (o.y + 0.5) * T, big ? 'barrier' : 'wreck').setScale(S).setDepth(950).setRotation(big ? Math.PI / 2 : 0.3), frame: 0 });
        }
      });
    }
    for (const [k, t] of m.obs) if (!seen.has(k)) { t.img.destroy(); m.obs.delete(k); }

    // buildings: redraw when destroyed
    for (const b of w.buildings.values()) {
      const e = this.buildingGfx.get(b.id)!;
      if (b.destroyed !== e.destroyed) this.bakeBuilding(b, b.destroyed);
    }

    // traffic lights
    if (w.lightPhase !== this.lightPhase) {
      this.lightPhase = w.lightPhase;
      const g = this.signals.clear();
      for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
        if (!w.isIntersection(x, y) || w.isIntersection(x - 1, y) || w.isIntersection(x, y - 1)) continue;
        const pts: [number, number, boolean][] = [[x - 0.1, y - 0.1, true], [x + 2.1, y + 2.1, true], [x + 2.1, y - 0.1, false], [x - 0.1, y + 2.1, false]];
        for (const [cx, cy, ew] of pts) {
          const green = (this.lightPhase === 0) === ew;
          g.fillStyle(0x111111, 1).fillCircle(cx * T, cy * T, 6);
          g.fillStyle(green ? 0x43e05a : 0xf44336, 1).fillCircle(cx * T, cy * T, 4);
        }
      }
    }

    const fx = this.fx.clear();
    const blink = Math.floor(time / 140) % 2 === 0;
    // fire glow + particles
    const live = this.speed > 0;
    for (const b of w.buildings.values()) {
      if (b.fire <= 0 && !(b.destroyed && b.damage >= 100 && b.fire > 0)) continue;
      const x = b.x * T, y = b.y * T - b.height, bw = b.w * T, bh = b.h * T;
      fx.fillStyle(0xff3d00, Math.min(0.55, (b.fire / 100) * 0.5) * (0.8 + 0.2 * Math.sin(time / 90 + b.x))).fillRect(x, b.destroyed ? b.y * T : y, bw, b.destroyed ? bh : bh);
      if (live) {
        const n = (b.fire / 100) * 16 * dt * (b.w * b.h) / 6;
        const emit = (rate: number, kind: Particle['kind']) => { let r = rate; while (r > 0) { if (Math.random() < Math.min(1, r)) this.emitParticle(kind, x + Math.random() * bw, (b.destroyed ? b.y * T : y) + Math.random() * bh); r -= 1; } };
        emit(n * 2, 'flame');
        emit(n, 'smoke');
      }
    }
    this.updateParticles(live ? dt : 0);

    // emergency lights
    for (const v of w.vehicles.values()) {
      if (!v.lights) continue;
      const len = w.vehicleDef(v).length * T * 0.5 - 10;
      const x = ix(v) - Math.sin(v.angle) * 7 + Math.cos(v.angle) * len, y = iy(v) + Math.cos(v.angle) * 7 + Math.sin(v.angle) * len;
      fx.fillStyle(blink ? 0xff3030 : 0x3070ff, 0.75).fillCircle(x, y, 7).fillStyle(blink ? 0xff3030 : 0x3070ff, 0.25).fillCircle(x, y, 14);
    }
    // water spray
    for (const r of w.responders.values()) {
      const t = r.task;
      if (!t || t.type !== 'extinguish' || t.deploy < 2.5) continue;
      const b = w.buildings.get(t.buildingId);
      if (!b) continue;
      const tx = Math.max(b.x, Math.min(b.x + b.w, r.x)) * T, ty = Math.max(b.y, Math.min(b.y + b.h, r.y)) * T - b.height * 0.5;
      fx.lineStyle(3, 0x90caf9, 0.8).lineBetween(ix(r), iy(r), tx, ty);
      if (live) { const k = Math.random(); this.emitParticle('drop', lerp(ix(r), tx, k), lerp(iy(r), ty, k)); }
    }
    // hoses: from the engine to every responder who is working with water
    for (const r of w.responders.values()) {
      if (r.task?.type !== 'extinguish' || r.inVehicle) continue;
      const veh = w.vehicles.get(r.vehicleId);
      if (veh) fx.lineStyle(3, 0xf9a825, 0.95).lineBetween(ix(veh), iy(veh), ix(r), iy(r));
    }
    // police tape around secured incident locations
    for (const inc of w.incidents.values()) {
      if (!inc.secured) continue;
      const x0 = (inc.x - 1.8) * T, y0 = (inc.y - 1.8) * T, size = 3.6 * T, seg = 10;
      for (let k = 0; k < (size * 4) / seg; k++) {
        const d = k * seg, side = Math.floor(d / size), o = d % size;
        const px = side === 0 ? x0 + o : side === 1 ? x0 + size : side === 2 ? x0 + size - o : x0;
        const py = side === 0 ? y0 : side === 1 ? y0 + o : side === 2 ? y0 + size : y0 + size - o;
        const nx = side === 0 ? px + seg : side === 1 ? px : side === 2 ? px - seg : px;
        const ny = side === 0 ? py : side === 1 ? py + seg : side === 2 ? py : py - seg;
        fx.lineStyle(3, k % 2 ? 0xffffff : 0xe53935, 0.9).lineBetween(px, py, nx, ny);
      }
    }
    // selection + paths
    for (const id of this.selected) {
      const v = w.vehicles.get(id);
      if (v) {
        fx.lineStyle(2, 0x66ff66, 0.95).strokeEllipse(ix(v), iy(v), w.vehicleDef(v).length * T + 8, 38);
        if (v.path.length) {
          fx.lineStyle(2, 0x66ff66, 0.5).beginPath().moveTo(ix(v), iy(v));
          for (const p of v.path) fx.lineTo((p.x + 0.5) * T, (p.y + 0.5) * T);
          fx.strokePath();
        }
        continue;
      }
      const r = w.responders.get(id);
      if (r) {
        fx.lineStyle(2, 0x66ff66, 0.95).strokeCircle(ix(r), iy(r), 14);
        if (r.path.length) { fx.lineStyle(1, 0x66ff66, 0.5).beginPath().moveTo(ix(r), iy(r)); for (const p of r.path) fx.lineTo((p.x + 0.5) * T, (p.y + 0.5) * T); fx.strokePath(); }
      }
    }
    if (this.inspect) {
      const t = this.inspect;
      const e = t.kind === 'victim' ? w.victims.get(t.id) : t.kind === 'suspect' ? w.suspects.get(t.id) : null;
      if (e) fx.lineStyle(2, 0xffeb3b, 1).strokeCircle(ix(e), iy(e), 14);
      if (t.kind === 'building') { const b = w.buildings.get(t.id); if (b) fx.lineStyle(2, 0xffeb3b, 1).strokeRect(b.x * T, b.y * T - b.height, b.w * T, b.h * T); }
    }
    if (this.dragging && this.dragStart) {
      const p = this.input.activePointer, wp = this.cameras.main.getWorldPoint(p.x, p.y);
      fx.lineStyle(1, 0x66ff66, 1).fillStyle(0x66ff66, 0.12).fillRect(this.dragStart.wx, this.dragStart.wy, wp.x - this.dragStart.wx, wp.y - this.dragStart.wy).strokeRect(this.dragStart.wx, this.dragStart.wy, wp.x - this.dragStart.wx, wp.y - this.dragStart.wy);
    }
    // incident markers
    const keep = new Set<number>();
    for (const inc of w.incidents.values()) {
      keep.add(inc.id);
      const def = this.content.incidents[inc.defId];
      let txt = this.incidentIcons.get(inc.id);
      if (!txt) {
        txt = this.add.text(0, 0, def.icon ?? '❗', { fontSize: '26px' }).setOrigin(0.5).setDepth(4000);
        this.incidentIcons.set(inc.id, txt);
      }
      const b = inc.buildingId ? w.buildings.get(inc.buildingId) : null;
      const bob = Math.sin(time / 250 + inc.id) * 3;
      txt.setPosition(inc.x * T, inc.y * T - (b ? b.height : 6) - 22 + bob);
      const col = inc.severity >= 3 ? 0xff1744 : inc.severity === 2 ? 0xffa000 : 0xffee58;
      fx.lineStyle(3, col, 0.5 + 0.5 * Math.sin(time / 200)).strokeCircle(inc.x * T, inc.y * T - (b ? b.height * 0.5 : 0), 30 + Math.sin(time / 300) * 3);
    }
    for (const [id, t] of this.incidentIcons) if (!keep.has(id)) { t.destroy(); this.incidentIcons.delete(id); }
  }
}
