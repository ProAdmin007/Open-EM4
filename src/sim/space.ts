import type { BuildingDef, VehicleDef } from './types';

/**
 * Coordinate conventions, shared by every renderer (2D today, 3D later).
 *
 * - Simulation space: tile units. +x = east, +y = south, a tile is 1 x 1. Entity positions are tile *centres* (x.5, y.5).
 * - Heading: radians, `atan2(dy, dx)` in simulation space (0 = east, π/2 = south).
 * - 3D world space (three.js style, right-handed, Y up): X = east, Z = south, Y = up, in metres.
 * - One tile is TILE_METERS metres. Roads are two tiles wide (one lane per direction), so a lane is 4.5 m wide and a
 *   1.9-tile fire engine is ~8.5 m long, which matches real vehicles.
 */
export const TILE_METERS = 4.5;
/** Height of one storey in metres. */
export const FLOOR_METERS = 3.2;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Tile coordinates (sim) -> 3D world position on the ground plane, with an optional height above the ground. */
export function tileToWorld3D(tx: number, ty: number, height = 0): Vec3 {
  return { x: tx * TILE_METERS, y: height, z: ty * TILE_METERS };
}

/** 3D world position -> tile coordinates (inverse of tileToWorld3D, ignoring height). */
export function world3DToTile(p: Vec3): { x: number; y: number } {
  return { x: p.x / TILE_METERS, y: p.z / TILE_METERS };
}

/** Heading in simulation space -> rotation around the Y axis for a model whose front points along +X. */
export function headingToYaw(heading: number): number {
  return -heading;
}

export interface Dimensions {
  length: number;
  width: number;
  height: number;
}

/** Real-world size of a vehicle model in metres, derived from its definition. */
export function vehicleDimensions(def: VehicleDef): Dimensions {
  const length = def.length * TILE_METERS;
  const motorcycle = def.length < 1.2;
  const tall = def.category === 'fire' && def.equipment.includes('aerial_ladder');
  return { length, width: motorcycle ? 0.9 : 2.5, height: motorcycle ? 1.3 : tall ? 3.8 : 3.0 };
}

/** Building height in metres: floors x storey height (falls back to the 2D extrusion height). */
export function buildingHeightMeters(b: BuildingDef): number {
  return (b.floors ?? Math.max(1, Math.round(b.height / 10))) * FLOOR_METERS;
}

/** Default model id for an asset: `<group>/<id>`. A definition's own `model` field overrides it. */
export const modelId = (group: 'vehicle' | 'person' | 'building', id: string, override?: string): string => override ?? `${group}/${id}`;
