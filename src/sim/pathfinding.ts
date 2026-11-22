export interface Vec {
  x: number;
  y: number;
}

export interface PathOptions {
  /** Allow 8-direction movement (no corner cutting). Default false. */
  diagonal?: boolean;
  /** Safety valve against huge searches. */
  maxNodes?: number;
  /** Optional directed-edge filter (e.g. one-way lanes): return false to forbid the step a -> b. */
  edge?: (ax: number, ay: number, bx: number, by: number) => boolean;
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, p: number): void {
    const a = this.items, b = this.prio;
    let i = a.length;
    a.push(item);
    b.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (b[parent] <= b[i]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      [b[parent], b[i]] = [b[i], b[parent]];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items, b = this.prio;
    const top = a[0];
    const lastI = a.pop()!;
    const lastP = b.pop()!;
    if (a.length) {
      a[0] = lastI;
      b[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [b[m], b[i]] = [b[i], b[m]];
        i = m;
      }
    }
    return top;
  }
}

const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const D8 = [...D4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * A* on a tile grid. `goal` is either a target tile (A* with Manhattan/octile heuristic)
 * or a predicate (then behaves like Dijkstra and returns the nearest matching tile).
 * Returns tiles from the first step up to and including the goal (start excluded), or null.
 */
export function findPath(
  width: number,
  height: number,
  start: Vec,
  goal: Vec | ((x: number, y: number) => boolean),
  passable: (x: number, y: number) => boolean,
  opts: PathOptions = {},
): Vec[] | null {
  const sx = Math.floor(start.x), sy = Math.floor(start.y);
  const isFn = typeof goal === 'function';
  const gx = isFn ? 0 : Math.floor((goal as Vec).x), gy = isFn ? 0 : Math.floor((goal as Vec).y);
  const reached = (x: number, y: number) => (isFn ? (goal as (x: number, y: number) => boolean)(x, y) : x === gx && y === gy);
  if (reached(sx, sy)) return [];
  if (!isFn && !passable(gx, gy)) return null;
  const dirs = opts.diagonal ? D8 : D4;
  const n = width * height;
  const g = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (x: number, y: number) => {
    if (isFn) return 0;
    const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
    return opts.diagonal ? Math.max(dx, dy) + 0.4142 * Math.min(dx, dy) : dx + dy;
  };
  const heap = new MinHeap();
  const s = sy * width + sx;
  g[s] = 0;
  heap.push(s, h(sx, sy));
  let expanded = 0;
  const maxNodes = opts.maxNodes ?? 100000;
  while (heap.size && expanded++ < maxNodes) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % width, cy = (cur / width) | 0;
    if (reached(cx, cy)) {
      const out: Vec[] = [];
      for (let k = cur; k !== s; k = prev[k]) out.push({ x: k % width, y: (k / width) | 0 });
      return out.reverse();
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !passable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) continue;
      if (opts.edge && !opts.edge(cx, cy, nx, ny)) continue;
      const ni = ny * width + nx;
      if (closed[ni]) continue;
      const ng = g[cur] + (dx !== 0 && dy !== 0 ? 1.4142 : 1);
      if (ng < g[ni]) {
        g[ni] = ng;
        prev[ni] = cur;
        heap.push(ni, ng + h(nx, ny));
      }
    }
  }
  return null;
}
