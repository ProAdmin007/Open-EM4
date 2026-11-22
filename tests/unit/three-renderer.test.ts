import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gableRoofGeometry, pickGroundTile, projectTileToNDC } from '../../src/game/three-renderer';
import { Commands, pickUnit, pickVehicle, type SelectionHost } from '../../src/game/selection';
import { TILE_METERS, tileToWorld3D } from '../../src/sim/space';
import { newWorld, run } from './helpers';

function camLookingAtTile(tx: number, ty: number, height = 60): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 4 / 3, 0.5, 2000);
  const p = tileToWorld3D(tx, ty);
  cam.position.set(p.x + height, height, p.z + height);
  cam.lookAt(p.x, 0, p.z);
  cam.updateMatrixWorld(true); // no render loop in this test: matrixWorld/matrixWorldInverse must be refreshed by hand
  return cam;
}

describe('3D ray-picking math (pure, no WebGL needed)', () => {
  it('picks the tile the camera looks straight at (NDC centre)', () => {
    const cam = camLookingAtTile(10, 8);
    const hit = pickGroundTile(cam, 0, 0);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(10, 0);
    expect(hit!.y).toBeCloseTo(8, 0);
  });
  it('projectTileToNDC and pickGroundTile are inverses for a visible tile', () => {
    const cam = camLookingAtTile(20, 15);
    const ndc = projectTileToNDC(cam, 22, 17);
    expect(Math.abs(ndc.x)).toBeLessThan(1);
    expect(Math.abs(ndc.y)).toBeLessThan(1);
    const back = pickGroundTile(cam, ndc.x, ndc.y);
    expect(back).not.toBeNull();
    expect(back!.x).toBeCloseTo(22, 1);
    expect(back!.y).toBeCloseTo(17, 1);
  });
  it('returns null when the ray cannot hit the ground (looking up, away from the plane)', () => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
    cam.position.set(0, 10, 0);
    cam.lookAt(0, 100, 0); // straight up: ray points away from the y=0 plane
    cam.updateMatrixWorld(true);
    expect(pickGroundTile(cam, 0, 0)).toBeNull();
  });
  it('tile (0,0) sits at the world origin (consistent with tileToWorld3D)', () => {
    const cam = camLookingAtTile(0, 0);
    const hit = pickGroundTile(cam, 0, 0)!;
    const world = tileToWorld3D(hit.x, hit.y);
    expect(world.x).toBeCloseTo(0, 0);
    expect(world.z).toBeCloseTo(0, 0);
    expect(TILE_METERS).toBe(4.5);
  });
});

describe('procedural roof geometry', () => {
  it('a gable roof is a closed 6-triangle prism no taller than its rise', () => {
    const geo = gableRoofGeometry(10, 6, 3);
    const pos = geo.getAttribute('position');
    expect(pos.count).toBe(18); // 6 triangles, non-indexed
    let maxY = 0;
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
    expect(maxY).toBeCloseTo(3);
  });
});

describe('snapshot -> scene diffing (Commands/selection logic shared by 2D and 3D)', () => {
  function host(): SelectionHost {
    return { world: null, state: 'playing', selected: new Set<number>(), inspect: null, audio: null };
  }
  it('picks the nearest vehicle within its footprint, not a farther one', () => {
    const w = newWorld(1);
    const vehicles = [...w.vehicles.values()];
    const v = vehicles[0];
    expect(pickVehicle(w, v.x, v.y)).toBe(v.id);
    expect(pickVehicle(w, v.x + 500, v.y + 500)).toBeNull();
  });
  it('pickUnit prefers an on-foot responder over a vehicle at the same spot', () => {
    const w = newWorld(1);
    const v = [...w.vehicles.values()][0];
    w.orderDismount([v.id]);
    run(w, 1);
    const r = [...w.responders.values()].find(r => !r.inVehicle && r.vehicleId === v.id);
    if (r) expect(pickUnit(w, r.x, r.y)).toBe(r.id);
  });
  it('boxSelect selects vehicles and on-foot responders inside the rectangle and nothing outside it', () => {
    const w = newWorld(1);
    const h = host();
    h.world = w;
    const cmds = new Commands(h);
    const v = [...w.vehicles.values()][0];
    cmds.boxSelect(v.x - 1, v.y - 1, v.x + 1, v.y + 1, false);
    expect(h.selected.has(v.id)).toBe(true);
    cmds.boxSelect(v.x + 1000, v.y + 1000, v.x + 1001, v.y + 1001, false);
    expect(h.selected.size).toBe(0);
  });
  it('select replaces the set unless additive, and clears any inspected target', () => {
    const h = host();
    h.inspect = { kind: 'building', id: 'x' };
    const cmds = new Commands(h);
    cmds.select([1, 2], false);
    expect([...h.selected].sort()).toEqual([1, 2]);
    expect(h.inspect).toBeNull();
    cmds.select([3], true);
    expect([...h.selected].sort()).toEqual([1, 2, 3]);
  });
  it('a right-click sends selected vehicles toward the target tile (same World order both renderers share)', () => {
    const w = newWorld(1);
    const h = host();
    h.world = w;
    const cmds = new Commands(h);
    const v = [...w.vehicles.values()][0];
    cmds.select([v.id]);
    let farRoad: { x: number; y: number } | null = null;
    for (let y = 0; y < w.h && !farRoad; y++) for (let x = 0; x < w.w && !farRoad; x++) if (w.isRoad(x, y) && Math.hypot(x - v.x, y - v.y) > 10) farRoad = { x, y };
    cmds.rightClick(farRoad!.x + 0.5, farRoad!.y + 0.5);
    expect(v.path.length).toBeGreaterThan(0);
  });
  it('double right-click on the selected vehicle itself dismounts everyone (shared with the 2D input)', () => {
    const w = newWorld(1);
    const h = host();
    h.world = w;
    const cmds = new Commands(h);
    const v = [...w.vehicles.values()][0];
    cmds.select([v.id]);
    cmds.rightClick(v.x, v.y);
    cmds.rightClick(v.x, v.y);
    expect([...w.responders.values()].some(r => r.vehicleId === v.id && !r.inVehicle)).toBe(true);
  });
});
