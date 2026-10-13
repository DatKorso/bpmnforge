import type { Geometry, ProcessDocument } from './domain.ts';
export function layoutProcess(model: ProcessDocument): Geometry {
  const shapes: Geometry['shapes'] = Object.create(null); const edges: Geometry['edges'] = Object.create(null);
  const labels: Geometry['labels'] = Object.create(null); const stages: Geometry['stages'] = Object.create(null);
  const width = 200 + Math.max(3, model.nodes.length) * 220;
  model.processes.forEach((process, p) => {
    const top = 50 + p * 260;
    const pool = model.pools.find(pool => pool.process === process.id);
    if (pool) shapes[pool.id] = { x: 40, y: top, width, height: 220 };
    model.lanes.filter(lane => lane.process === process.id).forEach(lane => { shapes[lane.id] = { x: 70, y: top, width: width - 30, height: 220 }; });
    model.nodes.filter(node => node.process === process.id).forEach((node, i) => {
      const size = node.type === 'task' ? { width: 150, height: 80 } : node.type === 'xor' || node.type === 'and' ? { width: 50, height: 50 } : { width: 36, height: 36 };
      shapes[node.id] = { x: 140 + i * 220 + (150 - size.width) / 2, y: top + 110 - size.height / 2, ...size };
      if (node.type !== 'task') labels[node.id] = { x: shapes[node.id].x - 45, y: top + 143, width: 130, height: 40 };
    });
  });
  for (const flow of model.flows) {
    const a = shapes[flow.source], b = shapes[flow.target];
    if (!a || !b) continue;
    const start = { x: a.x + a.width, y: a.y + a.height / 2 }; const end = { x: b.x, y: b.y + b.height / 2 };
    edges[flow.id] = start.y === end.y ? [start, end] : [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end];
  }
  return { shapes, edges, labels, stages, viewport: { x: 0, y: 0, width: width + 80, height: 100 + model.processes.length * 260 } };
}
