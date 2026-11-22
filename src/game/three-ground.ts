import * as THREE from 'three';
import type { World } from '../sim/world';
import { TILE_METERS } from '../sim/space';
import { tileHash } from '../sim/space';

/**
 * High-quality ground for the 3D view: the map is baked into 16x16-tile chunks at 40 px per tile (about 9 px per
 * metre) with seamless fractal noise for asphalt / pavement / grass / water, crisp vector markings (dashed centre
 * line, edge lines, zebra crossings, bay lines), kerbs, slab joints, wheel-track wear, manholes and cracks.
 * The chunk geometry raises the pavements above the road with real kerb walls.
 */

export const GROUND_PX = 40; // pixels per tile
export const CHUNK = 16; // tiles per chunk side
export const KERB_HEIGHT = 0.14; // metres

const h01 = (x: number, y: number, s = 0): number => (tileHash(x + s * 7919, y + s * 104729) & 0xffff) / 65535;
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h01(xi, yi, s), b = h01(xi + 1, yi, s), c = h01(xi, yi + 1, s), d = h01(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** fractal value noise, 0..1, in world-metre coordinates */
function fbm(xm: number, ym: number, s: number): number {
  return vnoise(xm * 0.35, ym * 0.35, s) * 0.5 + vnoise(xm * 1.1, ym * 1.1, s + 1) * 0.3 + vnoise(xm * 3.5, ym * 3.5, s + 2) * 0.2;
}

type Kind = 0 | 1 | 2 | 3 | 4; // grass, road, pavement, water, parking
function kindAt(world: World, x: number, y: number): Kind {
  if (world.isRoad(x, y)) return 1;
  if (world.isWater(x, y)) return 3;
  if (world.isParking(x, y)) return 4;
  const road = (a: number, b: number) => world.isRoad(a, b);
  if (road(x - 1, y) || road(x + 1, y) || road(x, y - 1) || road(x, y + 1) || road(x - 1, y - 1) || road(x + 1, y - 1) || road(x - 1, y + 1) || road(x + 1, y + 1)) return 2;
  return 0;
}

export interface GroundChunk { cx: number; cy: number; canvas: HTMLCanvasElement }

export function bakeGroundChunks(world: World): { kinds: Uint8Array; chunks: GroundChunk[] } {
  const w = world.w, h = world.h;
  const kinds = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) kinds[y * w + x] = kindAt(world, x, y);
  const kind = (x: number, y: number): Kind => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (kinds[y * w + x] as Kind));
  const bays = new Set(world.map.stations.flatMap(st => (st.bays ?? []).map(b => b.y * w + b.x)));
  const road = (x: number, y: number) => kind(x, y) === 1;
  const P = GROUND_PX;
  const chunks: GroundChunk[] = [];
  const M = TILE_METERS;

  for (let cy = 0; cy * CHUNK < h; cy++) {
    for (let cx = 0; cx * CHUNK < w; cx++) {
      const tw = Math.min(CHUNK, w - cx * CHUNK), th = Math.min(CHUNK, h - cy * CHUNK);
      const canvas = document.createElement('canvas');
      canvas.width = tw * P; canvas.height = th * P;
      const ctx = canvas.getContext('2d')!;
      // ---- seamless base: per-pixel colour from tile kind + fractal noise in world metres
      const img = ctx.createImageData(canvas.width, canvas.height);
      const d = img.data;
      for (let py = 0; py < canvas.height; py++) {
        const wy = cy * CHUNK + py / P;
        for (let px = 0; px < canvas.width; px++) {
          const wx = cx * CHUNK + px / P;
          const k = kind(Math.floor(wx), Math.floor(wy));
          const n = fbm(wx * M, wy * M, k);
          const g = (tileHash(px + cx * 977, py + cy * 313) & 255) / 255 - 0.5; // fine grain
          let r: number, gg: number, b: number;
          switch (k) {
            case 1: { const v = 50 + n * 22 + g * 7; r = v; gg = v + 1.5; b = v + 5; break; } // asphalt
            case 4: { const v = 74 + n * 20 + g * 7; r = v; gg = v + 2; b = v + 8; break; } // car park
            case 2: { const v = 150 + n * 30 + g * 7; r = v; gg = v - 0.5; b = v - 4; break; } // pavement
            case 3: { const v = n * 26 + g * 5; r = 36 + v * 0.5; gg = 100 + v; b = 150 + v * 0.8; break; } // water
            default: { const v = n * 36 + g * 9; r = 44 + v * 0.6; gg = 86 + v; b = 42 + v * 0.45; } // grass
          }
          const o = (py * canvas.width + px) * 4;
          d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);

      // ---- vector detail per tile
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const x = cx * CHUNK + tx, y = cy * CHUNK + ty, px = tx * P, py = ty * P;
          const k = kind(x, y);
          const r = hash01(x, y);
          if (k === 1) drawRoadTile(ctx, world, x, y, px, py, P, road, r);
          else if (k === 2) drawPavementTile(ctx, x, y, px, py, P, road);
          else if (k === 3) drawWaterTile(ctx, x, y, px, py, P, kind);
          else if (k === 4) { if (bays.has(y * w + x)) bayLines(ctx, px, py, P); }
          else if (k === 0 && r > 0.82) tufts(ctx, x, y, px, py, P);
        }
      }
      chunks.push({ cx, cy, canvas });
    }
  }
  return { kinds, chunks };
}

const hash01 = (x: number, y: number, s = 0): number => h01(x, y, s + 3);

function drawRoadTile(ctx: CanvasRenderingContext2D, world: World, x: number, y: number, px: number, py: number, P: number, road: (x: number, y: number) => boolean, r: number): void {
  const m = P / TILE_METERS; // px per metre
  if (world.isIntersection(x, y)) {
    if (r > 0.7) { ctx.fillStyle = 'rgba(20,20,24,0.18)'; ctx.fillRect(px + P * 0.25, py + P * 0.3, P * 0.5, P * 0.12); }
    return;
  }
  const horiz = road(x - 1, y) && road(x + 1, y), vert = road(x, y - 1) && road(x, y + 1);
  const nearIx = (a: number, b: number) => world.isIntersection(a, b);
  const crossH = horiz && !vert && (nearIx(x - 1, y) || nearIx(x + 1, y));
  const crossV = vert && !horiz && (nearIx(x, y - 1) || nearIx(x, y + 1));
  const edge = 'rgba(236,236,228,0.95)', centre = 'rgba(240,240,232,0.96)';
  // wheel tracks: darker polished/worn bands in every lane
  if (horiz && !vert) {
    ctx.fillStyle = 'rgba(18,18,22,0.13)';
    for (const dy of [-0.85, 0.85]) ctx.fillRect(px, py + P / 2 + dy * m - 0.3 * m, P, 0.6 * m);
  } else if (vert && !horiz) {
    ctx.fillStyle = 'rgba(18,18,22,0.13)';
    for (const dx of [-0.85, 0.85]) ctx.fillRect(px + P / 2 + dx * m - 0.3 * m, py, 0.6 * m, P);
  }
  // gutter next to kerbs
  ctx.fillStyle = 'rgba(8,8,10,0.28)';
  const gut = 0.28 * m;
  if (kindSide(world, x - 1, y)) ctx.fillRect(px, py, gut, P);
  if (kindSide(world, x + 1, y)) ctx.fillRect(px + P - gut, py, gut, P);
  if (kindSide(world, x, y - 1)) ctx.fillRect(px, py, P, gut);
  if (kindSide(world, x, y + 1)) ctx.fillRect(px, py + P - gut, P, gut);

  if (crossH) { zebra(ctx, px, py, P, m, true); return; }
  if (crossV) { zebra(ctx, px, py, P, m, false); return; }
  const lw = 0.16 * m; // marking width
  if (horiz && !vert) {
    if (road(x, y + 1)) { ctx.fillStyle = centre; ctx.fillRect(px + P * 0.18, py + P - lw / 2, P * 0.36, lw); } // dashed centre line
    ctx.fillStyle = edge;
    if (!road(x, y - 1)) ctx.fillRect(px, py + 0.35 * m, P, lw);
    if (!road(x, y + 1)) ctx.fillRect(px, py + P - 0.35 * m - lw, P, lw);
  } else if (vert && !horiz) {
    if (road(x + 1, y)) { ctx.fillStyle = centre; ctx.fillRect(px + P - lw / 2, py + P * 0.18, lw, P * 0.36); }
    ctx.fillStyle = edge;
    if (!road(x - 1, y)) ctx.fillRect(px + 0.35 * m, py, lw, P);
    if (!road(x + 1, y)) ctx.fillRect(px + P - 0.35 * m - lw, py, lw, P);
  }
  // weathering: manhole, patch, cracks
  if (r > 0.96) {
    const cx = px + P * (0.3 + hash01(x, y, 1) * 0.4), cy = py + P * (0.3 + hash01(x, y, 2) * 0.4);
    ctx.fillStyle = 'rgba(30,30,34,0.9)'; ctx.beginPath(); ctx.arc(cx, cy, 0.42 * m, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(90,90,96,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, 0.3 * m, 0, 7); ctx.moveTo(cx - 0.3 * m, cy); ctx.lineTo(cx + 0.3 * m, cy); ctx.stroke();
  } else if (r > 0.88) {
    ctx.fillStyle = 'rgba(26,26,30,0.22)'; ctx.fillRect(px + P * hash01(x, y, 4) * 0.4, py + P * hash01(x, y, 5) * 0.4, P * 0.45, P * 0.3);
  } else if (r > 0.78) {
    ctx.strokeStyle = 'rgba(15,15,18,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
    let cxp = px + P * hash01(x, y, 6), cyp = py + P * hash01(x, y, 7);
    ctx.moveTo(cxp, cyp);
    for (let i = 0; i < 5; i++) { cxp += (hash01(x + i, y, 8) - 0.5) * 12; cyp += (hash01(x, y + i, 9) - 0.2) * 9; ctx.lineTo(cxp, cyp); }
    ctx.stroke();
  }
}
const kindSide = (world: World, x: number, y: number): boolean => !world.isRoad(x, y) && !world.isParking(x, y) && !world.isWater(x, y);

function zebra(ctx: CanvasRenderingContext2D, px: number, py: number, P: number, m: number, horizontalRoad: boolean): void {
  ctx.fillStyle = 'rgba(240,240,232,0.95)';
  const bar = 0.5 * m, gap = 0.5 * m, inset = 0.45 * m;
  if (horizontalRoad) for (let o = inset; o + bar <= P - inset + 0.01; o += bar + gap) ctx.fillRect(px + 0.5 * m, py + o, P - 1.0 * m, bar);
  else for (let o = inset; o + bar <= P - inset + 0.01; o += bar + gap) ctx.fillRect(px + o, py + 0.5 * m, bar, P - 1.0 * m);
}

function drawPavementTile(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, P: number, road: (x: number, y: number) => boolean): void {
  const m = P / TILE_METERS;
  // slab joints (1 m x 1 m, staggered per row)
  ctx.strokeStyle = 'rgba(80,80,76,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) { const yy = py + i * m; ctx.moveTo(px, yy); ctx.lineTo(px + P, yy); }
  for (let j = 0; j < 4; j++) {
    const off = (j % 2) * 0.5 * m;
    for (let i = 0; i <= 5; i++) { const xx = px + off + i * m; if (xx >= px && xx <= px + P) { ctx.moveTo(xx, py + j * m); ctx.lineTo(xx, py + (j + 1) * m); } }
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,250,0.10)'; ctx.beginPath();
  for (let i = 0; i <= 4; i++) { const yy = py + i * m + 1; ctx.moveTo(px, yy); ctx.lineTo(px + P, yy); }
  ctx.stroke();
  // kerb stones: light top face on every edge that meets the road
  ctx.fillStyle = '#d6d5cd';
  const kw = 0.3 * m;
  if (road(x - 1, y)) ctx.fillRect(px, py, kw, P);
  if (road(x + 1, y)) ctx.fillRect(px + P - kw, py, kw, P);
  if (road(x, y - 1)) ctx.fillRect(px, py, P, kw);
  if (road(x, y + 1)) ctx.fillRect(px, py + P - kw, P, kw);
}

function drawWaterTile(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, P: number, kind: (x: number, y: number) => Kind): void {
  ctx.fillStyle = 'rgba(190,225,250,0.35)';
  for (let i = 0; i < 4; i++) {
    const a = hash01(x, y + i, 11);
    ctx.fillRect(px + a * P * 0.6, py + (i + 0.4) * P * 0.25, P * (0.18 + (i % 2) * 0.12), 1.5);
  }
  const sand = '#bba87a', w = 3;
  ctx.fillStyle = sand;
  if (kind(x - 1, y) !== 3) ctx.fillRect(px, py, w, P);
  if (kind(x + 1, y) !== 3) ctx.fillRect(px + P - w, py, w, P);
  if (kind(x, y - 1) !== 3) ctx.fillRect(px, py, P, w);
  if (kind(x, y + 1) !== 3) ctx.fillRect(px, py + P - w, P, w);
}

function bayLines(ctx: CanvasRenderingContext2D, px: number, py: number, P: number): void {
  ctx.fillStyle = 'rgba(246,246,240,0.95)';
  ctx.fillRect(px, py, 2, P); ctx.fillRect(px + P - 2, py, 2, P); ctx.fillRect(px, py + P - 3, P, 2);
}

function tufts(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, P: number): void {
  for (let i = 0; i < 4; i++) {
    const a = hash01(x + i, y, 21), b = hash01(x, y + i, 22);
    ctx.strokeStyle = i % 2 ? 'rgba(120,170,90,0.55)' : 'rgba(30,60,28,0.6)';
    ctx.beginPath(); ctx.moveTo(px + a * P, py + b * P); ctx.lineTo(px + a * P + (a - 0.5) * 3, py + b * P - 3 - b * 2); ctx.stroke();
  }
  if (hash01(x, y, 23) > 0.9) { ctx.fillStyle = ['#f6e24a', '#f5f5f0', '#e86aa0', '#b48ae8'][Math.floor(hash01(x, y, 24) * 4)]; ctx.fillRect(px + hash01(x, y, 25) * P, py + hash01(x, y, 26) * P, 2, 2); }
}

/** Builds the chunk meshes (pavements raised with kerb walls). */
export function buildGroundMeshes(world: World, baked: { kinds: Uint8Array; chunks: GroundChunk[] }, maxAniso: number): THREE.Group {
  const group = new THREE.Group();
  const w = world.w, h = world.h;
  const kinds = baked.kinds;
  const hAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : kinds[y * w + x] === 2 ? KERB_HEIGHT : 0);
  for (const ch of baked.chunks) {
    const tw = ch.canvas.width / GROUND_PX, th = ch.canvas.height / GROUND_PX;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], nor: number[] = [];
    const wpos: number[] = [], wnor: number[] = [], widx: number[] = [];
    const quad = (p: number[][], u: number[][], n: number[]): void => {
      const base = pos.length / 3;
      for (let i = 0; i < 4; i++) { pos.push(...p[i]); uv.push(...u[i]); nor.push(...n); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const x = ch.cx * CHUNK + tx, y = ch.cy * CHUNK + ty;
        const y0 = hAt(x, y);
        const X0 = x * TILE_METERS, X1 = (x + 1) * TILE_METERS, Z0 = y * TILE_METERS, Z1 = (y + 1) * TILE_METERS;
        const u0 = tx / tw, u1 = (tx + 1) / tw, v1 = 1 - ty / th, v0 = 1 - (ty + 1) / th; // canvas y grows downwards
        quad([[X0, y0, Z0], [X0, y0, Z1], [X1, y0, Z1], [X1, y0, Z0]], [[u0, v1], [u0, v0], [u1, v0], [u1, v1]], [0, 1, 0]);
        if (y0 > 0) { // kerb walls where the neighbour is lower
          const wall = (a: number[], b: number[], n: number[]): void => {
            const base = wpos.length / 3;
            for (const p of [[a[0], 0, a[1]], [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], 0, b[1]]]) { wpos.push(...p); wnor.push(...n); }
            widx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          };
          if (hAt(x - 1, y) < y0) wall([X0, Z1], [X0, Z0], [-1, 0, 0]);
          if (hAt(x + 1, y) < y0) wall([X1, Z0], [X1, Z1], [1, 0, 0]);
          if (hAt(x, y - 1) < y0) wall([X0, Z0], [X1, Z0], [0, 0, -1]);
          if (hAt(x, y + 1) < y0) wall([X1, Z1], [X0, Z1], [0, 0, 1]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    const tex = new THREE.CanvasTexture(ch.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    mesh.receiveShadow = true;
    group.add(mesh);
    if (widx.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      wg.setAttribute('normal', new THREE.Float32BufferAttribute(wnor, 3));
      wg.setIndex(widx);
      const wm = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0xcdccc4 }));
      wm.receiveShadow = true;
      group.add(wm);
    }
  }
  return group;
}

export function groundHeight(world: World, kinds: Uint8Array | null, xm: number, zm: number): number {
  if (!kinds) return 0;
  const x = Math.floor(xm / TILE_METERS), y = Math.floor(zm / TILE_METERS);
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return 0;
  return kinds[y * world.w + x] === 2 ? KERB_HEIGHT : 0;
}
