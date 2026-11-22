import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { World, SIM_DT } from '../../src/sim/world';
import { content } from './helpers';
it('metrics', () => {
  const w = World.create(content, { seed: 7, difficulty: 'normal', freeplay: true, traffic: true });
  const W = w as any;
  const cls: Record<string, number> = {};
  const tl: Record<number, number[]> = {};
  const pts: string[] = [];
  let n = 0;
  for (let i = 0; i < 30 * 240; i++) {
    w.reputation = 100; w.tick(SIM_DT);
    if (i < 30 * 20 || i % 90) continue;
    const bk = Math.floor(i / 900); tl[bk] ??= [0, 0];
    for (const c of w.civilians) {
      n++; tl[bk][1]++;
      if (c.v >= 0.2) { cls.moving = (cls.moving ?? 0) + 1; continue; }
      tl[bk][0]++;
      const nx = c.path[0];
      let k = 'nopath';
      if (nx) {
        const dx = nx.x + 0.5 - c.x, dy = nx.y + 0.5 - c.y, d = Math.hypot(dx, dy) || 1;
        const b = W.findBlocker(c, c.x, c.y, dx / d, dy / d, 2.4, c.len, c.hw, 0);
        if (c.wait > 0) k = 'wait';
        else if (b) k = 'blocked-' + b.kind + (b.halted ? '-halted' : '-moving');
        else if (W.isIntersection(nx.x, nx.y) && !W.isIntersection(Math.floor(c.x), Math.floor(c.y)) && !W.canGo(nx.x, nx.y, Math.abs(dx) > Math.abs(dy))) k = W.isSignalised(nx.x, nx.y) ? 'signal' : 'yield';
        else if (W.isIntersection(nx.x, nx.y) && W.exitBlocked(c.path, c.id)) k = 'exit-blocked';
        else k = 'other-free';
        if (k === 'exit-blocked' && pts.length < 12 && i > 30 * 150) pts.push(`${c.id}@${c.x.toFixed(1)},${c.y.toFixed(1)}->${nx.x},${nx.y} t=${w.time.toFixed(0)}`);
      } else if (c.wait > 0) k = 'wait-nopath';
      cls[k] = (cls[k] ?? 0) + 1;
    }
  }
  writeFileSync('m.txt', JSON.stringify(Object.entries(tl).map(([k, v]) => `${+k * 30}s:${(100 * v[0] / v[1]).toFixed(0)}%`)) + '\n' + pts.join('\n') + '\n' + JSON.stringify(Object.fromEntries(Object.entries(cls).map(([k, v]) => [k, +(100 * v / n).toFixed(1)]))));
}, 120000);
