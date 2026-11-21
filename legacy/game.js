'use strict';
// Open-EM4 – een open source, in de browser draaiende hulpdienstsimulatie.
// Geen originele Emergency-assets; alles wordt getekend met canvas.

const T = 32, W = 32, H = 22;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);

const TYPES = {
  fire:      { label: 'Brandweer', color: '#e53935', speed: 3.2 },
  ambulance: { label: 'Ambulance', color: '#f5f5f5', speed: 4.2 },
  police:    { label: 'Politie',   color: '#1e66f5', speed: 4.8 },
};
const INC = {
  fire:     { label: '🔥 Brand',    needs: { fire: 100 },                 time: 120, pts: 150 },
  accident: { label: '💥 Ongeluk',  needs: { ambulance: 60, police: 40 }, time: 100, pts: 120 },
  crime:    { label: '🕵 Inbraak',  needs: { police: 70 },                time: 80,  pts: 90  },
};

let map, units, incidents, particles, state, selected, drag, lastT, nextSpawn, stations, uid;

// ---------- kaart ----------
const isRoadCoord = (x, y) => x % 7 === 3 || y % 7 === 3;
function buildMap() {
  map = [];
  for (let y = 0; y < H; y++) {
    map[y] = [];
    for (let x = 0; x < W; x++) {
      map[y][x] = isRoadCoord(x, y) ? 'road'
        : { type: 'building', h: 20 + ((x * 7 + y * 13) % 5) * 8, tint: (x * 31 + y * 17) % 4, burned: false };
    }
  }
}
const road = (x, y) => x >= 0 && y >= 0 && x < W && y < H && map[y][x] === 'road';

function bfs(sx, sy, goal) {
  const key = (x, y) => y * W + x, prev = new Map([[key(sx, sy), null]]), q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (goal(x, y)) { const p = []; for (let k = key(x, y); k !== null; k = prev.get(k)) p.unshift([k % W, (k / W) | 0]); return p; }
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (road(nx, ny) && !prev.has(key(nx, ny))) { prev.set(key(nx, ny), key(x, y)); q.push([nx, ny]); }
    }
  }
  return null;
}
// dichtstbijzijnde weg-tegel naast (tx,ty)
function accessTile(tx, ty) {
  if (road(tx, ty)) return [tx, ty];
  let best = null, bd = 1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (road(x, y)) { const d = Math.hypot(x - tx, y - ty); if (d < bd) { bd = d; best = [x, y]; } }
  return best;
}

// ---------- spel ----------
function init() {
  buildMap();
  stations = [
    { type: 'fire', x: 3, y: 3 }, { type: 'ambulance', x: 17, y: 3 }, { type: 'police', x: 24, y: 17 },
  ];
  units = []; incidents = []; particles = []; selected = new Set(); drag = null; uid = 1;
  for (const s of stations) for (let i = 0; i < 2; i++)
    units.push({ id: uid++, type: s.type, x: s.x + i * 0.0, y: s.y, path: [], target: null, home: s, angle: 0 });
  state = { score: 0, rep: 100, t: 0, solved: 0, paused: false, over: false };
  nextSpawn = 5;
  $('overlay').classList.add('hidden');
  render_ui();
}

function spawnIncident() {
  const kind = ['fire', 'fire', 'accident', 'crime'][(Math.random() * 4) | 0];
  let x, y;
  if (kind === 'accident') { do { x = (Math.random() * W) | 0; y = (Math.random() * H) | 0; } while (!road(x, y) || (x % 7 === 3 && y % 7 === 3)); }
  else { do { x = (Math.random() * W) | 0; y = (Math.random() * H) | 0; } while (road(x, y) || map[y][x].burned || incidents.some(i => i.x === x && i.y === y)); }
  const def = INC[kind], [ax, ay] = accessTile(x, y);
  incidents.push({ id: uid++, kind, x, y, ax, ay, left: { ...def.needs }, timer: def.time, max: def.time, intensity: kind === 'fire' ? 20 : 0 });
  render_ui();
}

function sendUnit(u, ix, iy, inc) {
  const sx = Math.round(u.x), sy = Math.round(u.y);
  const [gx, gy] = accessTile(ix, iy);
  const startRoad = road(sx, sy) ? [sx, sy] : accessTile(sx, sy);
  const p = bfs(startRoad[0], startRoad[1], (x, y) => x === gx && y === gy);
  if (p) { u.path = p; u.target = inc ? inc.id : null; }
}

function update(dt) {
  state.t += dt;
  nextSpawn -= dt;
  if (nextSpawn <= 0 && incidents.length < 6) {
    spawnIncident();
    nextSpawn = Math.max(6, 20 - state.t / 25) * (0.6 + Math.random() * 0.8);
  }
  // eenheden bewegen
  for (const u of units) {
    if (!u.path.length) continue;
    const [tx, ty] = u.path[0], dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy), step = TYPES[u.type].speed * dt;
    u.angle = Math.atan2(dy, dx);
    if (d <= step) { u.x = tx; u.y = ty; u.path.shift(); } else { u.x += dx / d * step; u.y += dy / d * step; }
  }
  // meldingen
  for (const inc of incidents) {
    inc.timer -= dt;
    if (inc.kind === 'fire') {
      inc.intensity += 1.2 * dt;
      if (Math.random() < dt * 8) particles.push({ x: inc.x + 0.5 + (Math.random() - .5) * .6, y: inc.y + 0.5, vy: -1.2, life: 0.8 });
    }
    for (const u of units) {
      if (u.path.length || Math.hypot(u.x - inc.ax, u.y - inc.ay) > 1.6) continue;
      const need = inc.left[u.type];
      if (need > 0) {
        const rate = inc.kind === 'fire' ? 14 : 8;
        inc.left[u.type] = Math.max(0, need - rate * dt);
        if (inc.kind === 'fire') inc.intensity = Math.max(0, inc.intensity - rate * dt * 0.6);
        if (Math.random() < dt * 10) particles.push({ x: u.x + .5, y: u.y + .5, vy: -.5, life: .5, water: true });
      }
    }
    if (Object.values(inc.left).every(v => v <= 0.01)) { inc.done = true; state.score += Math.round(INC[inc.kind].pts * (0.5 + inc.timer / inc.max)); state.solved++; }
    else if (inc.timer <= 0 || inc.intensity >= 100) {
      inc.done = true; state.rep -= inc.kind === 'fire' ? 15 : 10; state.score -= 50;
      if (inc.kind === 'fire') map[inc.y][inc.x].burned = true;
    }
  }
  const before = incidents.length;
  incidents = incidents.filter(i => !i.done);
  if (incidents.length !== before) render_ui();
  for (const p of particles) { p.life -= dt; p.y += p.vy * dt; }
  particles = particles.filter(p => p.life > 0);
  if (state.rep <= 0 && !state.over) {
    state.over = true; state.rep = 0;
    $('ovTitle').textContent = 'Game over';
    $('ovText').textContent = `Score: ${state.score} – Opgelost: ${state.solved}`;
    $('overlay').classList.remove('hidden');
  }
  $('score').textContent = state.score; $('rep').textContent = Math.max(0, Math.round(state.rep));
  $('solved').textContent = state.solved;
  $('time').textContent = `${(state.t / 60) | 0}:${String((state.t % 60) | 0).padStart(2, '0')}`;
  for (const li of document.querySelectorAll('#incidents li')) {
    const inc = incidents.find(i => i.id == li.dataset.id);
    if (inc) li.querySelector('small').textContent = ` ${Math.ceil(inc.timer)}s`;
  }
}

function render_ui() {
  const ul = $('incidents'); ul.innerHTML = '';
  for (const inc of incidents) {
    const li = document.createElement('li');
    li.className = inc.kind; li.dataset.id = inc.id;
    li.innerHTML = `${INC[inc.kind].label}<small></small>`;
    li.onclick = () => dispatchTo(inc);
    ul.appendChild(li);
  }
}
function dispatchTo(inc) {
  for (const id of selected) { const u = units.find(u => u.id === id); if (u) sendUnit(u, inc.x, inc.y, inc); }
}

// ---------- tekenen ----------
const tintCols = ['#6d6a75', '#7a6a5d', '#5d6f7a', '#756a6a'];
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = map[y][x], px = x * T, py = y * T;
    if (c === 'road') {
      ctx.fillStyle = '#3a3d44'; ctx.fillRect(px, py, T, T);
      ctx.fillStyle = '#6a6f78';
      if (x % 7 === 3 && y % 7 !== 3) ctx.fillRect(px + T / 2 - 1, py + 6, 2, 8);
      if (y % 7 === 3 && x % 7 !== 3) ctx.fillRect(px + 6, py + T / 2 - 1, 8, 2);
    } else {
      ctx.fillStyle = '#3f5a3a'; ctx.fillRect(px, py, T, T);
      ctx.fillStyle = c.burned ? '#2a2420' : tintCols[c.tint];
      ctx.fillRect(px + 3, py + 3, T - 6, T - 6);
      ctx.fillStyle = c.burned ? '#1a1612' : '#00000033'; ctx.fillRect(px + 3, py + T - 9, T - 6, 6);
    }
  }
  for (const s of stations) {
    ctx.fillStyle = TYPES[s.type].color; ctx.fillRect(s.x * T + 4, s.y * T - T + 4, T - 8, T - 8);
    ctx.fillStyle = '#000'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText({ fire: '🚒', ambulance: '🚑', police: '🚓' }[s.type], s.x * T + T / 2, s.y * T - 10);
  }
  const blink = Math.floor(state.t * 4) % 2;
  for (const inc of incidents) {
    const cx = inc.x * T + T / 2, cy = inc.y * T + T / 2;
    ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
    if (inc.kind === 'fire') {
      ctx.fillStyle = `rgba(255,${80 + blink * 60},0,${0.3 + inc.intensity / 150})`;
      ctx.beginPath(); ctx.arc(cx, cy, T * (0.4 + inc.intensity / 150), 0, 7); ctx.fill();
    }
    ctx.fillText(INC[inc.kind].label.split(' ')[0], cx, cy + 8);
    // timerbalk
    ctx.fillStyle = '#000a'; ctx.fillRect(cx - 14, cy - 22, 28, 5);
    ctx.fillStyle = inc.timer / inc.max > .3 ? '#4c4' : '#e44'; ctx.fillRect(cx - 14, cy - 22, 28 * Math.max(0, inc.timer / inc.max), 5);
  }
  for (const u of units) {
    const cx = u.x * T + T / 2, cy = u.y * T + T / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(u.angle);
    ctx.fillStyle = TYPES[u.type].color; ctx.fillRect(-12, -7, 24, 14);
    ctx.fillStyle = '#0006'; ctx.fillRect(4, -6, 6, 12);
    if (u.path.length || u.target) { ctx.fillStyle = blink ? '#f33' : '#33f'; ctx.fillRect(-2, -4, 4, 8); }
    ctx.restore();
    if (selected.has(u.id)) { ctx.strokeStyle = '#0f0'; ctx.lineWidth = 2; ctx.strokeRect(cx - 16, cy - 16, 32, 32); }
  }
  for (const p of particles) {
    ctx.fillStyle = p.water ? `rgba(120,190,255,${p.life * 2})` : `rgba(255,${(p.life * 200) | 0},0,${p.life})`;
    ctx.beginPath(); ctx.arc(p.x * T, p.y * T, p.water ? 3 : 4 * p.life + 1, 0, 7); ctx.fill();
  }
  if (drag && drag.moved) {
    ctx.strokeStyle = '#0f0'; ctx.lineWidth = 1;
    ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0);
  }
  if (state.paused) { ctx.fillStyle = '#fff'; ctx.font = '40px sans-serif'; ctx.fillText('PAUZE', canvas.width / 2, canvas.height / 2); }
}

function loop(ts) {
  const dt = Math.min(0.05, (ts - (lastT || ts)) / 1000); lastT = ts;
  if (!state.paused && !state.over) update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ---------- invoer ----------
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
}
canvas.addEventListener('mousedown', e => { const [x, y] = pos(e); drag = { x0: x, y0: y, x1: x, y1: y, moved: false, shift: e.shiftKey }; });
canvas.addEventListener('mousemove', e => { if (!drag) return; [drag.x1, drag.y1] = pos(e); if (Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) > 6) drag.moved = true; });
canvas.addEventListener('mouseup', e => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.moved) {
    const [a, b] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)], [c, f] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
    if (!d.shift) selected.clear();
    for (const u of units) { const cx = u.x * T + T / 2, cy = u.y * T + T / 2; if (cx >= a && cx <= b && cy >= c && cy <= f) selected.add(u.id); }
    return;
  }
  const tx = (d.x0 / T) | 0, ty = (d.y0 / T) | 0;
  const clicked = units.find(u => Math.hypot(u.x * T + T / 2 - d.x0, u.y * T + T / 2 - d.y0) < 18);
  if (clicked) { if (!d.shift) selected.clear(); selected.add(clicked.id); return; }
  const inc = incidents.find(i => i.x === tx && i.y === ty);
  for (const id of selected) { const u = units.find(u => u.id === id); if (u) sendUnit(u, tx, ty, inc); }
});
document.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => {
  selected.clear(); units.filter(u => u.type === b.dataset.sel).forEach(u => selected.add(u.id));
});
const togglePause = () => { state.paused = !state.paused; };
$('pause').onclick = togglePause;
addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); togglePause(); } });
$('restart').onclick = init;

init();
requestAnimationFrame(loop);
