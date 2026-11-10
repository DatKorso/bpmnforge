import type { Point } from './domain.ts';
import { READABLE } from './profile.ts';

/** Bounded rectilinear visibility search used after the cheap corridor candidates.
 * Coordinates come from occupied boundaries; no unit-grid raster or randomness. */
export function visibilityRoute(start: Point, end: Point, xs: number[], ys: number[], cost: (a: Point, b: Point) => number, outward?: {dx:number;dy:number}, inward?: {dx:number;dy:number}): Point[] | null {
  xs = [...new Set([...xs, start.x, end.x])].filter(x => x >= 0).sort((a,b) => a-b);
  ys = [...new Set([...ys, start.y, end.y])].filter(y => y >= 0).sort((a,b) => a-b);
  const width = xs.length, count = width * ys.length * 2;
  if (count > 100000) return null;
  const encode = (x: number, y: number, direction: number) => (y * width + x) * 2 + direction;
  const decode = (key: number) => ({ x: (key >> 1) % width, y: Math.floor((key >> 1) / width), direction: key % 2 });
  const costs = new Float64Array(count).fill(Infinity), previous = new Int32Array(count).fill(-1);
  const heap: { key: number; score: number; distance: number }[] = [];
  const less = (a: typeof heap[number], b: typeof a) => a.score < b.score || a.score === b.score && a.key < b.key;
  const push = (entry: typeof heap[number]) => { heap.push(entry); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (!less(heap[i],heap[p])) break; [heap[i],heap[p]] = [heap[p],heap[i]]; i = p; } };
  const pop = () => { const first = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; while (i * 2 + 1 < heap.length) { let j = i * 2 + 1; if (j + 1 < heap.length && less(heap[j+1],heap[j])) j++; if (!less(heap[j],heap[i])) break; [heap[i],heap[j]] = [heap[j],heap[i]]; i = j; } } return first; };
  const sx = xs.indexOf(start.x), sy = ys.indexOf(start.y), tx = xs.indexOf(end.x), ty = ys.indexOf(end.y);
  for (let direction = 0; direction < 2; direction++) { const key = encode(sx,sy,direction); costs[key] = 0; push({key, distance:0, score:Math.abs(start.x-end.x)+Math.abs(start.y-end.y)}); }
  const cached = new Map<string,number>();
  let expanded = 0;
  while (heap.length && expanded++ < 30000) {
    const current = pop(); if (current.distance !== costs[current.key]) continue;
    const {x,y,direction} = decode(current.key);
    if (x === tx && y === ty) {
      if (previous[current.key] >= 0 && inward) {
        const p = decode(previous[current.key]);
        if ((end.x-xs[p.x])*inward.dx+(end.y-ys[p.y])*inward.dy<0) continue;
      }
      const path: Point[] = []; let key = current.key;
      while (key >= 0) { const p = decode(key); path.push({x:xs[p.x],y:ys[p.y]}); key = previous[key]; }
      return path.reverse();
    }
    for (const [nx,ny,nd] of [[x-1,y,0],[x+1,y,0],[x,y-1,1],[x,y+1,1]]) {
      if (nx < 0 || ny < 0 || nx >= xs.length || ny >= ys.length) continue;
      const from = {x:xs[x],y:ys[y]}, to = {x:xs[nx],y:ys[ny]};
      if (x===sx && y===sy && previous[current.key]<0 && outward && (to.x-start.x)*outward.dx+(to.y-start.y)*outward.dy<0) continue;
      const id = `${Math.min(y*width+x,ny*width+nx)}/${Math.max(y*width+x,ny*width+nx)}`;
      if (!cached.has(id)) cached.set(id,cost(from,to));
      const distance = current.distance + cached.get(id)! + (nd === direction ? 0 : READABLE.bendCost);
      const key = encode(nx,ny,nd);
      if (distance >= costs[key]) continue;
      costs[key] = distance; previous[key] = current.key;
      push({key,distance,score:distance+Math.abs(to.x-end.x)+Math.abs(to.y-end.y)});
    }
  }
  return null;
}
