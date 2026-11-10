import type { Bounds, Point, ProcessDocument } from './domain.ts';
import { READABLE, expanded } from './profile.ts';

export interface Port { point: Point; dx: number; dy: number }
export const endpointKey = (flow: string, side: 'source' | 'target') => `${flow}/${side}`;
export function vertices(box: Bounds): Port[] {
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  return [{ point: { x: box.x, y }, dx: -1, dy: 0 }, { point: { x: box.x + box.width, y }, dx: 1, dy: 0 },
    { point: { x, y: box.y }, dx: 0, dy: -1 }, { point: { x, y: box.y + box.height }, dx: 0, dy: 1 }];
}
export const isVertex = (point: Point, box: Bounds) => vertices(box).some(port => port.point.x === point.x && port.point.y === point.y);

/** Joint assignments include both directions, reserve explicit endpoints first,
 * and enumerate all four-vertex permutations before any contour exception. */
export function gatewayAssignments(model: ProcessDocument, shapes: Record<string, Bounds>, selected = new Map<string, number>(), labels: Record<string, Bounds> = {}) {
  const result = new Map<string, { keys: string[]; variants: (Port | undefined)[][] }>();
  const settled = new Map<string, Port>();
  for (const node of model.nodes.filter(node => ['xor','and','start','end','conditionalStart','timerCatch','terminateEnd'].includes(node.type)).sort((a, b) => a.id < b.id ? -1 : 1)) {
    const connections = model.flows.flatMap(flow => (['source', 'target'] as const).filter(side => flow[side] === node.id).map(side => ({ flow, side })))
      .sort((a, b) => a.flow.id < b.flow.id ? -1 : a.flow.id > b.flow.id ? 1 : a.side < b.side ? -1 : 1);
    const ports = vertices(shapes[node.id]);
    const fixed = connections.filter(({ flow }) => flow.route).map(({ flow, side }) => side === 'source' ? flow.route![0] : flow.route!.at(-1)!);
    const intersects = (a: Point,b: Point,box: Bounds) => a.x===b.x ? a.x>box.x && a.x<box.x+box.width && Math.max(a.y,b.y)>box.y && Math.min(a.y,b.y)<box.y+box.height
      : a.y>box.y && a.y<box.y+box.height && Math.max(a.x,b.x)>box.x && Math.min(a.x,b.x)<box.x+box.width;
    const available = ports.filter(port => fixed.every(point => Math.hypot(point.x - port.point.x, point.y - port.point.y) >= READABLE.routeGap)
      && Object.values(labels).every(label=>!intersects(port.point,{x:port.point.x+port.dx*READABLE.stub,y:port.point.y+port.dy*READABLE.stub},expanded(label,READABLE.labelGap))));
    const automatic = connections.filter(({ flow }) => !flow.route);
    const cost = (port: Port, index: number) => {
      const { flow, side } = automatic[index], other = shapes[side === 'source' ? flow.target : flow.source];
      if (!other) return 0;
      const x = other.x + other.width / 2, y = other.y + other.height / 2;
      const dx = x - port.point.x, dy = y - port.point.y;
      const box = shapes[node.id], toward = (x-box.x-box.width/2)*port.dx+(y-box.y-box.height/2)*port.dy;
      const otherPort = settled.get(endpointKey(flow.id, side === 'source' ? 'target' : 'source'));
      const mismatch = !!(otherPort && (port.dy && otherPort.dy && port.dy !== otherPort.dy || port.dx && otherPort.dx && port.dx === otherPort.dx));
      return (Math.abs(dx) + Math.abs(dy) + Number(mismatch) * READABLE.bendCost * 4 + (toward < 0 ? READABLE.bendCost * 3 + READABLE.stub * 4 : toward === 0 ? READABLE.bendCost * 2 + READABLE.stub * 2 : 0))
        * (flow.return ? .95 : 1 + (automatic.length - index) * .001);
    };
    const variants: { ports: (Port | undefined)[]; cost: number; key: string }[] = [];
    if (automatic.length <= available.length) {
      const visit = (assigned: Port[], unused: Port[], score: number) => {
        if (assigned.length === automatic.length) { variants.push({ ports: assigned, cost: score, key: assigned.map(port => ports.indexOf(port)).join('') }); return; }
        for (const port of unused) visit([...assigned, port], unused.filter(other => other !== port), score + cost(port, assigned.length));
      };
      visit([], available, 0);
    } else {
      // Sixteen masks bound high-degree matching independently of node degree.
      let states = new Map<number, { ports: (Port | undefined)[]; cost: number }>([[0, { ports: [], cost: 0 }]]);
      for (let i = 0; i < automatic.length; i++) {
        const next = new Map<number, { ports: (Port | undefined)[]; cost: number }>();
        for (const [mask, state] of states) for (let p = -1; p < available.length; p++) {
          if (p >= 0 && mask & (1 << p)) continue;
          const updated = mask | (p < 0 ? 0 : 1 << p), score = state.cost + (p < 0 ? 1000000 : cost(available[p], i));
          if (!next.has(updated) || score < next.get(updated)!.cost) next.set(updated, { ports: [...state.ports, p < 0 ? undefined : available[p]], cost: score });
        }
        states = next;
      }
      for (const state of states.values()) variants.push({ ...state, key: '' });
    }
    variants.sort((a, b) => a.cost - b.cost || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const keys = automatic.map(({ flow, side }) => endpointKey(flow.id, side));
    result.set(node.id, { keys, variants: variants.map(variant => variant.ports) });
    const chosen = variants[selected.get(node.id) ?? 0]?.ports ?? [];
    keys.forEach((key,index)=>{if(chosen[index])settled.set(key,chosen[index]!);});
  }
  return result;
}
