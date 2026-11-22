// Deterministic generator for src/data/map_default.json. Run: node tools/genmap.mjs
// A 102 x 72 tile city of 10 x 7 blocks (8x8 tiles each) separated by two-tile-wide roads.
// Districts: downtown (offices, shops, apartments), mid ring (apartments, houses, church, shops), outskirts (houses, parks),
// industrial east (warehouses, factories), plus stations (with parking lots), hospitals, a school campus, a mall and parks with ponds.
import { writeFileSync } from 'node:fs';

const BW = 10, BH = 7;
const W = BW * 10 + 2, H = BH * 10 + 2;
const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const isRoad = (x, y) => x % 10 < 2 || y % 10 < 2;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isRoad(x, y)) grid[y][x] = 'R';

const hash = (a, b, c = 0) => ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0;
const buildings = [];
const stations = [];
let n = 1;

const add = (type, x, y, w, h, height, extra = {}) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= H || i >= W || grid[j][i] === 'R' || grid[j][i] === 'B' || grid[j][i] === 'P') throw new Error(`building ${type} at ${x},${y} overlaps ${grid[j]?.[i]} at ${i},${j}`);
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = 'B';
  const b = { id: `b${n++}`, type, x, y, w, h, height, ...extra };
  buildings.push(b);
  return b;
};
const house = (bx, by, dx, dy, seed) => {
  const r = hash(bx + dx, by + dy, seed) % 5;
  const floors = r === 0 ? 3 : 2;
  return add('residential', bx + dx, by + dy, 3, 3, 10 + floors * 3, { floors, roof: r % 2 ? 'hip' : 'gable' });
};
const apartment = (bx, by, dx, dy, seed) => {
  const floors = 5 + (hash(bx + dx, by + dy, seed) % 5);
  return add('apartment', bx + dx, by + dy, 3, 3, Math.min(60, 14 + floors * 4), { floors, roof: 'flat' });
};
const office = (bx, by, dx, dy, w, h, seed) => {
  const floors = 7 + (hash(bx + dx, by + dy, seed) % 8);
  return add('office', bx + dx, by + dy, w, h, Math.min(72, 14 + floors * 4), { floors, roof: 'flat' });
};
const trees = (x0, y0, x1, y1, density, seed) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (grid[y][x] === '.' && hash(x, y, seed) % density === 0) grid[y][x] = 'T';
};
const pond = (bx, by, seed) => {
  const w = 3 + (hash(bx, by, seed) % 2), h = 3;
  const px = bx + 2 + (hash(bx, by, seed + 1) % 2), py = by + 2 + (hash(bx, by, seed + 2) % 2);
  for (let j = py; j < py + h; j++) for (let i = px; i < px + w; i++) grid[j][i] = 'W';
};
const park = (bx, by, withPond, seed) => {
  trees(bx, by, bx + 7, by + 7, 2, seed);
  if (withPond) pond(bx, by, seed);
};

// A station block: parking lot ('P') in the 4 rows facing the north road, building behind it, 8 bays in lot row 2.
const station = (bx, by, name, id, category, w, h, fleet) => {
  for (let j = by; j < by + 4; j++) for (let i = bx; i < bx + 8; i++) grid[j][i] = 'P';
  const b = add('station', bx + 1, by + 8 - h, w, h, 14, { name, floors: 2, roof: 'flat' });
  const bays = Array.from({ length: 8 }, (_, i) => ({ x: bx + i, y: by + 2 }));
  stations.push({ id, category, buildingId: b.id, fleet, bays });
  trees(bx, by + 8 - h, bx + 7, by + 7, 9, 5);
};

const special = {
  '2,1': 'fire', '7,5': 'fire2', '5,1': 'ambulance', '3,5': 'ambulance2', '3,3': 'police', '8,2': 'police2', '1,5': 'depot',
  '4,3': 'hospital', '8,4': 'hospital2', '5,2': 'mall', '6,4': 'school', '5,5': 'pondpark', '2,3': 'pondpark', '7,0': 'pondpark',
};

for (let bj = 0; bj < BH; bj++) {
  for (let bi = 0; bi < BW; bi++) {
    const bx = bi * 10 + 2, by = bj * 10 + 2;
    const sp = special[`${bi},${bj}`];
    if (sp === 'fire') { station(bx, by, 'Brandweerkazerne', 'fire_station', 'fire', 6, 4, ['fire_engine', 'aerial_ladder', 'rescue_vehicle', 'command_vehicle']); continue; }
    if (sp === 'fire2') { station(bx, by, 'Brandweerpost Oost', 'fire_station_2', 'fire', 5, 3, ['fire_engine', 'rescue_vehicle']); continue; }
    if (sp === 'ambulance') { station(bx, by, 'Ambulancepost', 'ambulance_post', 'ambulance', 5, 3, ['ambulance', 'ambulance', 'rapid_responder', 'mmt_car']); continue; }
    if (sp === 'ambulance2') { station(bx, by, 'Ambulancepost Zuid', 'ambulance_post_2', 'ambulance', 5, 3, ['ambulance', 'rapid_responder']); continue; }
    if (sp === 'police') { station(bx, by, 'Politiebureau', 'police_station', 'police', 5, 4, ['patrol_car', 'patrol_car', 'police_van', 'police_motorcycle']); continue; }
    if (sp === 'police2') { station(bx, by, 'Politiepost Noord', 'police_station_2', 'police', 5, 3, ['patrol_car', 'police_motorcycle']); continue; }
    if (sp === 'depot') { station(bx, by, 'Technische dienst', 'tech_depot', 'tech', 5, 4, ['tow_truck', 'service_van', 'crane_truck']); continue; }
    if (sp === 'hospital') { add('hospital', bx + 1, by + 1, 6, 5, 26, { name: 'Ziekenhuis Centrum', floors: 6, roof: 'flat' }); trees(bx, by + 6, bx + 7, by + 7, 4, 3); continue; }
    if (sp === 'hospital2') { add('hospital', bx + 1, by + 2, 6, 5, 22, { name: 'Ziekenhuis Oost', floors: 5, roof: 'flat' }); trees(bx, by, bx + 7, by + 1, 4, 3); continue; }
    if (sp === 'mall') { add('shopping', bx + 1, by + 1, 6, 5, 22, { name: 'Winkelcentrum', floors: 2, roof: 'flat' }); trees(bx, by + 6, bx + 7, by + 7, 3, 4); continue; }
    if (sp === 'school') { add('school', bx + 1, by + 1, 6, 3, 18, { name: 'School', floors: 2, roof: 'hip' }); add('school', bx + 1, by + 5, 3, 2, 14, { name: 'Gymzaal', floors: 1, roof: 'flat' }); trees(bx, by + 4, bx + 7, by + 7, 5, 6); continue; }
    if (sp === 'pondpark') { park(bx, by, true, 11 + bi * 3 + bj); continue; }

    const r = hash(bi, bj, 7) % 10;
    const d = Math.hypot(bi - 4.5, (bj - 3) * 1.3);
    if (bi >= 8) {
      // industrial east
      if (r < 4) { add('warehouse', bx + 1, by + 1, 6, 3, 16, { floors: 1, roof: 'flat' }); add('warehouse', bx + 1, by + 5, 6, 3, 16, { floors: 1, roof: 'flat' }); }
      else if (r < 7) { add('industrial', bx + 1, by + 1, 6, 4, 20, { floors: 2, roof: 'flat' }); add('industrial', bx + 1, by + 6, 3, 2, 16, { floors: 1, roof: 'flat' }); }
      else if (r < 9) { add('warehouse', bx + 1, by + 1, 6, 6, 18, { floors: 1, roof: 'flat' }); }
      else park(bx, by, false, 3);
      trees(bx, by, bx + 7, by + 7, 14, 8);
    } else if (d < 2.0) {
      // downtown
      if (r < 3) { office(bx, by, 1, 1, 6, 3, 1); office(bx, by, 1, 5, 6, 3, 2); }
      else if (r < 5) { add('shopping', bx + 1, by + 1, 6, 4, 20, { floors: 2, roof: 'flat' }); office(bx, by, 1, 6, 6, 2, 3); }
      else { apartment(bx, by, 1, 1, 1); apartment(bx, by, 5, 1, 2); apartment(bx, by, 1, 5, 3); apartment(bx, by, 5, 5, 4); }
      trees(bx, by, bx + 7, by + 7, 12, 9);
    } else if (d < 3.8) {
      // mid ring
      if (r < 3) { apartment(bx, by, 1, 1, 1); apartment(bx, by, 5, 1, 2); apartment(bx, by, 1, 5, 3); apartment(bx, by, 5, 5, 4); }
      else if (r < 6) { house(bx, by, 1, 1, 1); house(bx, by, 5, 1, 2); house(bx, by, 1, 5, 3); house(bx, by, 5, 5, 4); }
      else if (r < 7) { add('church', bx + 1, by + 1, 3, 4, 24, { name: 'Kerk', floors: 3, roof: 'gable' }); house(bx, by, 5, 1, 2); house(bx, by, 5, 5, 4); add('residential', bx + 1, by + 6, 3, 2, 12, { floors: 2, roof: 'gable' }); }
      else if (r < 9) { add('commercial', bx + 1, by + 1, 6, 3, 18, { floors: 2, roof: 'flat' }); add('commercial', bx + 1, by + 5, 6, 3, 20, { floors: 2, roof: 'flat' }); }
      else park(bx, by, hash(bi, bj, 4) % 2 === 0, 5);
      trees(bx, by, bx + 7, by + 7, 10, 10);
    } else {
      // outskirts
      if (r < 6) { house(bx, by, 1, 1, 1); house(bx, by, 5, 1, 2); house(bx, by, 1, 5, 3); house(bx, by, 5, 5, 4); }
      else if (r < 8) { house(bx, by, 1, 1, 1); house(bx, by, 5, 5, 4); }
      else park(bx, by, r === 9, 6);
      trees(bx, by, bx + 7, by + 7, 6, 12);
    }
  }
}

const map = {
  id: 'default_city', name: 'Rendam', width: W, height: H,
  legend: { R: 'road', '.': 'grass', T: 'tree', B: 'building', P: 'station parking lot', W: 'water' },
  rows: grid.map(r => r.join('')), buildings, stations,
};
writeFileSync(new URL('../src/data/map_default.json', import.meta.url), JSON.stringify(map));
const counts = {};
for (const b of buildings) counts[b.type] = (counts[b.type] ?? 0) + 1;
console.log('size', W, 'x', H, 'buildings', buildings.length, counts, 'stations', stations.map(s => s.id).join(','));
