import type { RenderSnapshot } from '../sim/snapshot';
import type { World } from '../sim/world';

/**
 * The contract a renderer has to fulfil. The Phaser 2D scene (`GameScene`) is the first implementation (it currently reads the
 * world directly); a 3D renderer plugs in here by consuming `RenderSnapshot` instead. Input (selection, orders) only needs the
 * two coordinate conversions below, because every order is expressed in tile coordinates (`World.contextOrder(ids, x, y)`).
 */
export interface GameRenderer {
  readonly kind: '2d' | '3d';
  /** (Re)build static scenery for a new world: terrain, buildings, roads. */
  load(world: World): void;
  /** Draw one frame. `dt` in seconds. */
  render(snapshot: RenderSnapshot, dt: number): void;
  /** Screen position (px, relative to the canvas) -> tile coordinates on the ground plane, or null when nothing is hit. */
  screenToTile(sx: number, sy: number): { x: number; y: number } | null;
  /** Tile coordinates -> screen position. */
  tileToScreen(tx: number, ty: number): { x: number; y: number };
  /** Move the camera so that this tile is in the centre of the view. */
  centerOn(tx: number, ty: number): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
