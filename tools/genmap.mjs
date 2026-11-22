// Deterministic generator for src/data/map_default.json. Run: node tools/genmap.mjs
// An irregular city: streets at uneven distances (blocks from 6 to 18 tiles wide), some streets that stop at a T-junction
// or end in a cul-de-sac, some missing segments (so a few blocks are much bigger), stations with parking lots, two
// hospitals, a mall, a school, parks with ponds and districts (downtown, mid ring, outskirts, industrial east).
// Roads are always two tiles wide (one lane per direction); buildings are packed along the streets by a seeded greedy lot placer.
import { writeFileSync } from 'node:fs';

const SEED = 2006;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const W = 118, H = 84;
const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const at = (x, y) => (inb(x, y) ? grid[y][x] : '#');

// ---- street lines at uneven distances
function lines(total) {
  const pos = [0];
  let p = 0;
  for (;;) {
    const gap = pick([6, 8, 8, 10, 10, 12, 14, 16]);
    p += gap + 2;
    if (p > total - 12) break;
    pos.push(p);
  }
  pos.push(total - 2);
  return pos;
}
const xs = lines(W), ys = lines(H);
const mainX = new Set([0, xs.length - 1, 1 + Math.floor(rnd() * (xs.length - 2)), 1 + Math.floor(rnd() * (xs.length - 2))]);
const mainY = new Set([0, ys.length - 1, 1 + Math.floor(rnd() * (ys.length - 2))]);
const fillRoad = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) grid[y][x] = 'R'; };
// horizontal streets: segments between consecutive vertical lines; secondary streets lose some segments
ys.forEach((y, j) => { for (let i = 0; i < xs.length - 1; i++) if (mainY.has(j) || chance(0.8)) fillRoad(xs[i], y, xs[i + 1] + 1, y + 1); });
xs.forEach((x, i) => { for (let j = 0; j < ys.length - 1; j++) if (mainX.has(i) || chance(0.8)) fillRoad(x, ys[j], x + 1, ys[j + 1] + 1); });

// ---- cul-de-sacs: short streets that end inside a block
const allFree = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (at(x, y) !== '.') return false; return true; };
for (let k = 0, made = 0; k < 800 && made < 8; k++) {
  const x = int(3, W - 6), y = int(3, H - 6), len = int(6, 11), dir = int(0, 3);
  if (!(at(x, y) === 'R' && at(x + 1, y) === 'R' && at(x, y + 1) === 'R' && at(x + 1, y + 1) === 'R')) continue;
  let rect; // [x0,y0,x1,y1] of the stub and of its clearance area (everything except the side that touches the street)
  if (dir === 0) rect = [x, y + 2, x + 1, y + 1 + len, x - 2, y + 2, x + 3, y + 3 + len];
  else if (dir === 1) rect = [x, y - len, x + 1, y - 1, x - 2, y - 2 - len, x + 3, y - 1];
  else if (dir === 2) rect = [x + 2, y, x + 1 + len, y + 1, x + 2, y - 2, x + 3 + len, y + 3];
  else rect = [x - len, y, x - 1, y + 1, x - 2 - len, y - 2, x - 1, y + 3];
  const [x0, y0, x1, y1, cx0, cy0, cx1, cy1] = rect;
  if (x0 < 3 || y0 < 3 || x1 > W - 4 || y1 > H - 4) continue;
  if (!allFree(cx0, cy0, cx1, cy1)) continue;
  fillRoad(x0, y0, x1, y1); made++;
}

// ---- keep only the road network that is connected to the border road
{
  const seen = new Set(), stack = [[0, 0]];
  while (stack.length) { const [x, y] = stack.pop(); const k = y * W + x; if (!inb(x, y) || seen.has(k) || grid[y][x] !== 'R') continue; seen.add(k); stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x] === 'R' && !seen.has(y * W + x)) grid[y][x] = '.';
}
// no one-tile road slivers: every road tile must belong to a 2x2 road square
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (grid[y][x] !== 'R') continue;
  const sq = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([dx, dy]) => [0, 1].every(a => [0, 1].every(b => at(x + dx + a, y + dy + b) === 'R')));
  if (!sq) grid[y][x] = '.';
}

const hash = (a, b, c = 0) => ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0;
const buildings = [];
const stations = [];
let n = 1;
const add = (type, x, y, w, h, height, extra = {}) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (at(i, j) !== '.' && at(i, j) !== 'T') throw new Error(`building ${type} at ${x},${y} overlaps ${at(i, j)} at ${i},${j}`);
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = 'B';
  const b = { id: `b${n++}`, type, x, y, w, h, height, ...extra };
  buildings.push(b);
  return b;
};
// margin tiles keep a free strip (pavement) between a building and the road unless `roadOk` (station lots front a street)
const clear = (x, y, w, h, m = 1, roadOk = false) => { for (let j = y - m; j < y + h + m; j++) for (let i = x - m; i < x + w + m; i++) { const c = at(i, j); if (c === 'B' || c === 'P' || c === 'W' || c === '#' || (c === 'R' && !roadOk && m > 0)) return false; } for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (grid[j][i] !== '.') return false; return true; };
const nearRoad = (x, y, w, h, lo = 2, hi = 6) => { // a street within lo..hi tiles of the footprint, so the building faces it
  for (let d = lo; d <= hi; d++) { for (let i = x; i < x + w; i++) if (at(i, y - d) === 'R' || at(i, y + h - 1 + d) === 'R') return true; for (let j = y; j < y + h; j++) if (at(x - d, j) === 'R' || at(x + w - 1 + d, j) === 'R') return true; }
  return false;
};
const center = { x: W * (0.38 + rnd() * 0.1), y: H * (0.42 + rnd() * 0.12) };
const district = (x, y) => (x > W * 0.8 ? 'industrial' : (() => { const d = Math.hypot((x - center.x) / 10, ((y - center.y) / 10) * 1.3); return d < 2.6 ? 'downtown' : d < 4.4 ? 'mid' : 'outskirts'; })());

// ---- stations: 8x4 parking lot facing a street (north), the building behind it
const station = (sx, sy, name, id, category, w, h, fleet) => {
  for (let j = sy; j < sy + 4; j++) for (let i = sx; i < sx + 8; i++) grid[j][i] = 'P';
  const b = add('station', sx + 1, sy + 8 - h, w, h, 14, { name, floors: 2, roof: 'flat' });
  const bays = Array.from({ length: 8 }, (_, i) => ({ x: sx + i, y: sy + 2 }));
  stations.push({ id, category, buildingId: b.id, fleet, bays });
};
const sites = [];
for (let y = 2; y < H - 9; y++) for (let x = 2; x < W - 10; x++) {
  let ok = true;
  for (let i = 0; i < 8 && ok; i++) if (at(x + i, y - 1) !== 'R') ok = false;
  if (ok && clear(x, y, 8, 8, 1, true)) sites.push({ x, y });
}
const used = [];
const take = (prefer) => { // farthest-point choice among the free station sites (or the one closest to `prefer`)
  const ok = sites.filter(s => clear(s.x, s.y, 8, 8, 1, true));
  if (!ok.length) throw new Error('no site left for a station');
  let best = ok[0], bs = -Infinity;
  for (const s of ok) {
    const score = prefer ? -Math.hypot(s.x - prefer.x, s.y - prefer.y) : Math.min(...used.map(u => Math.hypot(u.x - s.x, u.y - s.y)));
    if (score > bs) { bs = score; best = s; }
  }
  used.push(best);
  return best;
};
const stationDefs = [
  ['Brandweerkazerne', 'fire_station', 'fire', 6, 4, ['fire_engine', 'aerial_ladder', 'rescue_vehicle', 'command_vehicle', 'copi_unit'], { x: center.x - 14, y: center.y }],
  ['Politiebureau', 'police_station', 'police', 5, 4, ['patrol_car', 'patrol_car', 'police_van', 'police_motorcycle', 'bomb_squad'], { x: center.x + 6, y: center.y + 12 }],
  ['Ambulancepost', 'ambulance_post', 'ambulance', 5, 3, ['ambulance', 'ambulance', 'rapid_responder', 'mmt_car'], { x: center.x + 8, y: center.y - 14 }],
  ['Brandweerpost Oost', 'fire_station_2', 'fire', 5, 3, ['fire_engine', 'rescue_vehicle', 'ovd_car', 'hazmat_unit', 'water_tanker'], null],
  ['Ambulancepost Zuid', 'ambulance_post_2', 'ambulance', 5, 3, ['ambulance', 'rapid_responder', 'lgh_car'], null],
  ['Politiepost Noord', 'police_station_2', 'police', 5, 3, ['patrol_car', 'police_motorcycle', 'riot_van'], null],
  ['Technische dienst', 'tech_depot', 'tech', 5, 4, ['tow_truck', 'service_van', 'crane_truck'], null],
  ['Uitvaartcentrum', 'funeral_home', 'tech', 5, 3, ['hearse'], null],
];
for (const [name, id, cat, w, h, fleet, prefer] of stationDefs) { const s = take(prefer); station(s.x, s.y, name, id, cat, w, h, fleet); }

// ---- hospitals, mall and school campus: big lots next to a street
const bigSites = (w, h) => { const out = []; for (let y = 2; y < H - h - 2; y++) for (let x = 2; x < W - w - 2; x++) if (clear(x, y, w, h, 1) && nearRoad(x, y, w, h)) out.push({ x, y }); return out; };
const placeFar = (w, h, from, fn) => { const c = bigSites(w, h); if (!c.length) throw new Error('no big site'); let best = c[0], bs = -Infinity; for (const s of c) { const score = Math.min(...from.map(u => Math.hypot(u.x - s.x, u.y - s.y))); if (score > bs) { bs = score; best = s; } } from.push(best); fn(best); };
const spread = [];
placeFar(6, 5, spread, s => add('hospital', s.x, s.y, 6, 5, 26, { name: 'Ziekenhuis Centrum', floors: 6, roof: 'flat' }));
placeFar(6, 5, spread, s => add('hospital', s.x, s.y, 6, 5, 22, { name: 'Ziekenhuis Oost', floors: 5, roof: 'flat' }));
placeFar(6, 5, [{ x: center.x, y: center.y }], s => add('shopping', s.x, s.y, 6, 5, 22, { name: 'Winkelcentrum', floors: 2, roof: 'flat' }));
placeFar(6, 3, [{ x: center.x + 20, y: center.y + 10 }], s => { add('school', s.x, s.y, 6, 3, 18, { name: 'School', floors: 2, roof: 'hip' }); if (clear(s.x, s.y + 4, 3, 2, 1)) add('school', s.x, s.y + 4, 3, 2, 14, { name: 'Gymzaal', floors: 1, roof: 'flat' }); });

// ---- general lots, packed along the streets in random order
const house = (x, y, w, h) => { const r = hash(x, y, 3) % 5, floors = r === 0 ? 3 : 2; return add('residential', x, y, w, h, 10 + floors * 3, { floors, roof: r % 2 ? 'hip' : 'gable' }); };
const apartment = (x, y, w, h) => { const floors = 5 + (hash(x, y, 4) % 5); return add('apartment', x, y, w, h, Math.min(60, 14 + floors * 4), { floors, roof: 'flat' }); };
const office = (x, y, w, h) => { const floors = 7 + (hash(x, y, 5) % 8); return add('office', x, y, w, h, Math.min(72, 14 + floors * 4), { floors, roof: 'flat' }); };
const templates = {
  downtown: [[5, () => 6, 3, (x, y) => office(x, y, 6, 3)], [3, () => 5, 4, (x, y) => office(x, y, 5, 4)], [4, () => 3, 3, (x, y) => apartment(x, y, 3, 3)], [1, () => 6, 4, (x, y) => add('shopping', x, y, 6, 4, 20, { floors: 2, roof: 'flat' })], [2, () => 6, 3, (x, y) => add('commercial', x, y, 6, 3, 18, { floors: 2, roof: 'flat' })]],
  mid: [[4, () => 3, 3, (x, y) => apartment(x, y, 3, 3)], [4, () => 3, 3, (x, y) => house(x, y, 3, 3)], [2, () => 4, 3, (x, y) => house(x, y, 4, 3)], [2, () => 6, 3, (x, y) => add('commercial', x, y, 6, 3, 18, { floors: 2, roof: 'flat' })], [1, () => 3, 4, (x, y) => (buildings.filter(b => b.type === 'church').length < 3 ? add('church', x, y, 3, 4, 24, { name: 'Kerk', floors: 3, roof: 'gable' }) : house(x, y, 3, 3))]],
  outskirts: [[7, () => 3, 3, (x, y) => house(x, y, 3, 3)], [3, () => 4, 3, (x, y) => house(x, y, 4, 3)], [2, () => 3, 4, (x, y) => house(x, y, 3, 4)], [1, () => 3, 2, (x, y) => add('residential', x, y, 3, 2, 12, { floors: 2, roof: 'gable' })]],
  industrial: [[3, () => 6, 3, (x, y) => add('warehouse', x, y, 6, 3, 16, { floors: 1, roof: 'flat' })], [2, () => 6, 6, (x, y) => add('warehouse', x, y, 6, 6, 18, { floors: 1, roof: 'flat' })], [3, () => 6, 4, (x, y) => add('industrial', x, y, 6, 4, 20, { floors: 2, roof: 'flat' })], [1, () => 3, 2, (x, y) => add('industrial', x, y, 3, 2, 16, { floors: 1, roof: 'flat' })]],
};
const spots = [];
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) spots.push([x, y]);
for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
for (const [x, y] of spots) {
  if (grid[y][x] !== '.') continue;
  const list = templates[district(x, y)];
  const total = list.reduce((s, t) => s + t[0], 0);
  let r = rnd() * total, t = list[0];
  for (const c of list) { r -= c[0]; if (r <= 0) { t = c; break; } }
  const [, wf, h, make] = t, w = wf();
  if (!chance(0.93)) continue;
  if (clear(x, y, w, h, 1) && nearRoad(x, y, w, h)) make(x, y);
}

// ---- parks with ponds where a big empty area is left, then trees everywhere (denser outside the centre)
let ponds = 0;
for (const size of [7, 6, 5]) {
  const parkSpots = [];
  for (let y = 2; y < H - size - 2; y++) for (let x = 2; x < W - size - 2; x++) if (clear(x, y, size, size, 0)) parkSpots.push([x, y]);
  for (let i = parkSpots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [parkSpots[i], parkSpots[j]] = [parkSpots[j], parkSpots[i]]; }
  for (const [x, y] of parkSpots) {
    if (!clear(x, y, size, size, 0)) continue;
    for (let j = y; j < y + size; j++) for (let i = x; i < x + size; i++) if (hash(i, j, 9) % 2 === 0) grid[j][i] = 'T';
    if (ponds < 4 || chance(0.4)) { ponds++; const pw = 3 + (hash(x, y, 1) % 2), ph = 3; for (let j = y + 1; j < y + 1 + ph; j++) for (let i = x + 1; i < x + 1 + pw; i++) grid[j][i] = 'W'; }
  }
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x] === '.') {
  const d = district(x, y), dens = d === 'downtown' ? 14 : d === 'mid' ? 10 : d === 'industrial' ? 16 : 6;
  if (hash(x, y, 12) % dens === 0) grid[y][x] = 'T';
}

// ---- checks
const types = new Set(buildings.map(b => b.type));
for (const t of ['residential', 'apartment', 'commercial', 'industrial', 'office', 'warehouse', 'school', 'shopping', 'church', 'station', 'hospital']) if (!types.has(t)) throw new Error(`no ${t} generated`);
const map = {
  id: 'default_city', name: 'Rendam', width: W, height: H,
  legend: { R: 'road', '.': 'grass', T: 'tree', B: 'building', P: 'station parking lot', W: 'water' },
  rows: grid.map(r => r.join('')), buildings, stations,
};
writeFileSync(new URL('../src/data/map_default.json', import.meta.url), JSON.stringify(map));
const counts = {};
for (const b of buildings) counts[b.type] = (counts[b.type] ?? 0) + 1;
console.log('size', W, 'x', H, 'streets', xs.length, 'x', ys.length, 'buildings', buildings.length, counts, 'stations', stations.map(s => s.id).join(','));
