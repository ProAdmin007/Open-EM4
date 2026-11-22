import * as THREE from 'three';
import { tileHash } from '../sim/space';

/**
 * Procedural facade and roof textures for the 3D buildings. The textures are near-white detail maps (brick courses,
 * concrete panels, corrugated cladding, roof tiles, gravel) that are multiplied with the building's colour, so one
 * shared texture per material type is enough. `TEX_METERS` metres of wall are covered by one texture repeat.
 */
export const TEX_METERS = 4;
const SIZE = 256;
const cache = new Map<string, THREE.CanvasTexture>();
const h = (x: number, y: number, s = 0): number => (tileHash(x + s * 31, y + s * 17) & 1023) / 1023;

function make(key: string, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SIZE, SIZE);
  draw(ctx);
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.shared = true;
  cache.set(key, t);
  return t;
}
const grey = (v: number, a = 1): string => `rgba(${v},${v},${v},${a})`;

function grain(ctx: CanvasRenderingContext2D, amount: number, seed: number): void {
  for (let i = 0; i < 2600; i++) {
    const x = (h(i, seed) * SIZE) | 0, y = (h(i, seed + 1) * SIZE) | 0;
    ctx.fillStyle = grey(h(i, seed + 2) > 0.5 ? 255 : 40, amount * h(i, seed + 3));
    ctx.fillRect(x, y, 1, 1);
  }
}

/** Facade detail for a building type. */
export function wallTexture(type: string): THREE.CanvasTexture {
  switch (type) {
    case 'residential': case 'school': case 'station': return make('brick', ctx => {
      const bw = SIZE / 8, bh = SIZE / 24; // 8 bricks across 4 m, 24 courses
      for (let row = 0; row < 24; row++) for (let col = -1; col < 9; col++) {
        const off = (row % 2) * bw / 2, x = col * bw + off, y = row * bh;
        const v = 215 + h(col + row * 13, row, 4) * 40;
        ctx.fillStyle = grey(v); ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
      ctx.strokeStyle = grey(110, 0.55); ctx.lineWidth = 1.3;
      for (let row = 0; row <= 24; row++) { ctx.beginPath(); ctx.moveTo(0, row * bh); ctx.lineTo(SIZE, row * bh); ctx.stroke(); }
      grain(ctx, 0.14, 5);
    });
    case 'apartment': case 'shopping': case 'commercial': return make('panel', ctx => {
      ctx.strokeStyle = grey(120, 0.5); ctx.lineWidth = 1.5;
      for (let i = 0; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(0, i * SIZE / 2); ctx.lineTo(SIZE, i * SIZE / 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i * SIZE / 2, 0); ctx.lineTo(i * SIZE / 2, SIZE); ctx.stroke(); }
      for (let i = 0; i < 40; i++) { ctx.fillStyle = grey(h(i, 6) > 0.5 ? 235 : 190, 0.12); ctx.fillRect(h(i, 7) * SIZE, h(i, 8) * SIZE, 30 + h(i, 9) * 60, 18 + h(i, 10) * 30); }
      grain(ctx, 0.12, 11);
    });
    case 'office': case 'hospital': return make('glass', ctx => {
      const g = ctx.createLinearGradient(0, 0, 0, SIZE);
      g.addColorStop(0, grey(255)); g.addColorStop(1, grey(214)); ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = grey(90, 0.5); ctx.lineWidth = 1.5;
      for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * SIZE / 4, 0); ctx.lineTo(i * SIZE / 4, SIZE); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(SIZE, 0); ctx.moveTo(0, SIZE / 2); ctx.lineTo(SIZE, SIZE / 2); ctx.stroke();
      grain(ctx, 0.06, 12);
    });
    case 'industrial': case 'warehouse': return make('corrugated', ctx => {
      for (let i = 0; i < 32; i++) {
        const x = i * SIZE / 32;
        const g = ctx.createLinearGradient(x, 0, x + SIZE / 32, 0);
        g.addColorStop(0, grey(250)); g.addColorStop(0.5, grey(205)); g.addColorStop(1, grey(250));
        ctx.fillStyle = g; ctx.fillRect(x, 0, SIZE / 32, SIZE);
      }
      for (let i = 0; i < 14; i++) { ctx.fillStyle = grey(60, 0.08); ctx.fillRect(h(i, 13) * SIZE, 0, 3 + h(i, 14) * 4, SIZE); }
      grain(ctx, 0.08, 15);
    });
    case 'church': return make('stone', ctx => {
      const bh = SIZE / 8;
      for (let row = 0; row < 8; row++) {
        let x = 0;
        while (x < SIZE) { const bw = SIZE / 4 + h(row, x, 16) * SIZE / 6; ctx.fillStyle = grey(225 + h(row, x, 17) * 30); ctx.fillRect(x + 1, row * bh + 1, bw - 2, bh - 2); x += bw; }
      }
      ctx.strokeStyle = grey(110, 0.5); for (let r = 0; r <= 8; r++) { ctx.beginPath(); ctx.moveTo(0, r * bh); ctx.lineTo(SIZE, r * bh); ctx.stroke(); }
      grain(ctx, 0.16, 18);
    });
    default: return make('plaster', ctx => { grain(ctx, 0.12, 19); for (let i = 0; i < 30; i++) { ctx.fillStyle = grey(200, 0.1); ctx.fillRect(h(i, 20) * SIZE, h(i, 21) * SIZE, 40, 10); } });
  }
}

/** Roof detail: pitched roofs get tile courses, flat roofs gravel and roofing felt. */
export function roofTexture(kind: 'pitched' | 'flat'): THREE.CanvasTexture {
  if (kind === 'pitched') return make('tiles', ctx => {
    const rh = SIZE / 12, tw = SIZE / 10;
    for (let row = 0; row < 12; row++) for (let col = -1; col < 11; col++) {
      const x = col * tw + (row % 2) * tw / 2, y = row * rh;
      ctx.fillStyle = grey(205 + h(col, row, 22) * 50); ctx.fillRect(x + 1, y + 1, tw - 2, rh - 1);
      ctx.fillStyle = grey(70, 0.35); ctx.fillRect(x, y + rh - 3, tw, 3);
    }
    grain(ctx, 0.1, 23);
  });
  return make('gravel', ctx => {
    for (let i = 0; i < 5000; i++) { ctx.fillStyle = grey(110 + h(i, 24) * 140, 0.5); ctx.fillRect(h(i, 25) * SIZE, h(i, 26) * SIZE, 1 + h(i, 27) * 2, 1 + h(i, 28) * 2); }
    ctx.strokeStyle = grey(70, 0.35); ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * SIZE / 4, 0); ctx.lineTo(i * SIZE / 4, SIZE); ctx.stroke(); }
  });
}

/** Scale a BoxGeometry's UVs so the texture repeats every TEX_METERS metres on every face. */
export function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h2: number, d: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each
  const dims: [number, number][] = [[d, h2], [d, h2], [w, d], [w, d], [w, h2], [w, h2]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / TEX_METERS, (uv.getY(k) * dims[f][1]) / TEX_METERS);
  }
  uv.needsUpdate = true;
}

/** Planar UVs (metres / TEX_METERS) for custom roof geometry. */
export function planarRoofUVs(geo: THREE.BufferGeometry, slope = 1): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / TEX_METERS; uv[i * 2 + 1] = (pos.getZ(i) + pos.getY(i) * slope) / TEX_METERS; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
