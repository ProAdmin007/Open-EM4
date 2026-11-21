// Deterministic generator for src/data/map_default.json. Run: node tools/genmap.mjs
import { writeFileSync } from 'node:fs';
const W = 64, H = 48;
const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const isRoad = (x, y) => x % 10 < 2 || y % 10 < 2;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isRoad(x, y) && x < 62) grid[y][x] = 'R';
for (let y = 0; y < H; y++) for (let x = 62; x < W; x++) grid[y][x] = '.';
const buildings = [];
let n = 1;
const add = (type, x, y, w, h, height, extra = {}) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = 'B';
  const b = { id: `b${n++}`, type, x, y, w, h, height, ...extra };
  buildings.push(b);
  return b;
};
const special = { '1,1': 'fire', '4,1': 'ambulance', '2,3': 'police', '3,2': 'hospital', '5,3': 'depot' };
const hash = (a, b) => ((a * 73856093) ^ (b * 19349663)) >>> 0;
const stations = [];
for (let bj = 0; bj < 5; bj++) for (let bi = 0; bi < 6; bi++) {
  const bx = bi * 10 + 2, by = bj * 10 + 2;
  const sp = special[`${bi},${bj}`];
  if (sp === 'fire') { const b = add('station', bx + 1, by + 1, 6, 4, 14, { name: 'Brandweerkazerne' }); stations.push({ id: 'fire_station', category: 'fire', buildingId: b.id, fleet: ['fire_engine', 'aerial_ladder', 'rescue_vehicle', 'command_vehicle'] }); add('residential', bx + 1, by + 5, 3, 3, 14); add('residential', bx + 5, by + 5, 3, 3, 14); continue; }
  if (sp === 'ambulance') { const b = add('station', bx + 1, by + 1, 5, 3, 14, { name: 'Ambulancepost' }); stations.push({ id: 'ambulance_post', category: 'ambulance', buildingId: b.id, fleet: ['ambulance', 'ambulance', 'rapid_responder', 'mmt_car'] }); add('commercial', bx + 1, by + 5, 6, 3, 16); continue; }
  if (sp === 'police') { const b = add('station', bx + 1, by + 1, 5, 4, 14, { name: 'Politiebureau' }); stations.push({ id: 'police_station', category: 'police', buildingId: b.id, fleet: ['patrol_car', 'patrol_car', 'police_van', 'police_motorcycle'] }); add('residential', bx + 1, by + 6, 3, 2, 14); continue; }
  if (sp === 'hospital') { add('hospital', bx + 1, by + 1, 6, 5, 26, { name: 'Ziekenhuis' }); continue; }
  if (sp === 'depot') { const b = add('station', bx + 1, by + 1, 5, 4, 14, { name: 'Technische dienst' }); stations.push({ id: 'tech_depot', category: 'tech', buildingId: b.id, fleet: ['tow_truck', 'service_van', 'crane_truck'] }); add('industrial', bx + 1, by + 6, 4, 2, 18); continue; }
  const r = hash(bi, bj) % 10;
  if (r < 5) {
    for (const [dx, dy] of [[1, 1], [5, 1], [1, 5], [5, 5]]) {
      if (by + dy + 3 > H - 1) continue;
      const apt = (hash(bi + dx, bj + dy) % 4) === 0;
      add(apt ? 'apartment' : 'residential', bx + dx, by + dy, 3, 3, apt ? 34 : 14);
    }
  } else if (r < 7) {
    add('commercial', bx + 1, by + 1, 6, 3, 18); if (by + 8 < H) add('commercial', bx + 1, by + 5, 6, 3, 22);
  } else if (r < 9) {
    add('industrial', bx + 1, by + 1, 6, 4, 20); if (by + 7 < H) add('industrial', bx + 1, by + 6, 3, 2, 16); 
  } else {
    for (let j = by; j < Math.min(by + 8, H); j++) for (let i = bx; i < bx + 8; i++) if (!isRoad(i, j) && (i + j * 3) % 3 !== 0) grid[j][i] = 'T';
  }
}
// scatter some trees on remaining grass tiles
for (let y = 0; y < H; y++) for (let x = 0; x < 62; x++) if (grid[y][x] === '.' && hash(x, y) % 9 === 0) grid[y][x] = 'T';
const map = { id: 'default_city', name: 'Rendam', width: W, height: H, legend: { R: 'road', '.': 'grass', T: 'tree', B: 'building' }, rows: grid.map(r => r.join('')), buildings, stations };
writeFileSync(new URL('../src/data/map_default.json', import.meta.url), JSON.stringify(map));
console.log('buildings', buildings.length, 'stations', stations.length);
