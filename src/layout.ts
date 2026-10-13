import type { Geometry, ProcessDocument, Bounds, Point, Diagnostic } from './domain.ts';
import { BplmError } from './domain.ts';
export function layoutProcess(model: ProcessDocument): Geometry {
  const shapes: Geometry['shapes'] = Object.create(null), edges: Geometry['edges'] = Object.create(null);
  const labels: Geometry['labels'] = Object.create(null), stages: Geometry['stages'] = Object.create(null);
  const errors: Diagnostic[] = [];
  const fail = (code: string, id: string, message: string) => errors.push({ code, id, message, severity: 'error' });
  const cells = new Map<string, { column: number; row: number }>(), occupied = new Set<string>();
  const items = [...model.nodes, ...(model.annotations ?? [])];
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = `${item.process}/${item.lane ?? ''}/${item.stage}/${item.row ?? 0}`;
    const column = item.column ?? counts.get(key) ?? 0, row = item.row ?? 0;
    const cell = `${key}/${column}`;
    if (occupied.has(cell)) fail('CELL_CONFLICT', item.id, 'Two elements occupy the same stage/lane cell');
    occupied.add(cell); counts.set(key, Math.max(counts.get(key) ?? 0, column + 1)); cells.set(item.id, { column, row });
  }
  let x = 110;
  for (const stage of model.stages) {
    const columns = Math.max(1, ...items.filter(item => item.stage === stage.id).map(item => cells.get(item.id)!.column + 1));
    stages[stage.id] = { x, y: 50, width: columns * 260, height: 0 }; x += columns * 260;
  }
  const width = x - 40 + 40; let top = 50;
  for (const process of model.processes) {
    const pool = model.pools.find(pool => pool.process === process.id)!; const poolTop = top;
    const lanes = model.lanes.filter(lane => lane.process === process.id);
    const partitions = lanes.length ? lanes : [{ id: '', process: process.id }];
    for (const lane of partitions) {
      const members = items.filter(item => item.process === process.id && (item.lane ?? '') === lane.id);
      const rows = Math.max(1, ...members.map(item => cells.get(item.id)!.row + 1)); const height = rows * 540;
      if (lane.id) shapes[lane.id] = { x: 70, y: top, width: width - 30, height };
      for (const item of members) {
        const annotation = 'text' in item, type = 'type' in item ? item.type : 'annotation';
        const size = annotation ? { width: 180, height: Math.max(70, Math.ceil(item.text.length / 22) * 18 + 24) } : type === 'task' ? { width: 180, height: Math.max(80, Math.ceil(item.name.length / 22) * 18 + 24) } : type === 'xor' || type === 'and' ? { width: 50, height: 50 } : { width: 36, height: 36 };
        if (size.height > 400) fail('LABEL_SIZE', item.id, 'Text annotation exceeds a grid cell; split the annotation');
        const cell = cells.get(item.id)!, centerY = top + 180 + cell.row * 540;
        shapes[item.id] = { x: stages[item.stage].x + cell.column * 260 + (220 - size.width) / 2, y: centerY - size.height / 2, ...size };
        if (!annotation && type !== 'task') labels[item.id] = { x: stages[item.stage].x + cell.column * 260 + 20, y: centerY + 38, width: 180, height: Math.max(40, Math.ceil(item.name.length / 22) * 18) };
      }
      top += height;
    }
    shapes[pool.id] = { x: 40, y: poolTop, width, height: top - poolTop }; top += 80;
  }
  for (const flow of model.flows) {
    const a = shapes[flow.source], b = shapes[flow.target];
    if (!a || !b) { fail('ROUTE_ENDPOINT', flow.id, 'No shape for connector endpoint'); continue; }
    const start = { x: a.x + a.width, y: a.y + a.height / 2 }, end = { x: b.x, y: b.y + b.height / 2 };
    let route: Point[];
    if (flow.route) {
      route = flow.route.map(point => ({ ...point }));
      const onBoundary = (point: Point, box: Bounds) => ((point.x === box.x || point.x === box.x + box.width) && point.y >= box.y && point.y <= box.y + box.height) || ((point.y === box.y || point.y === box.y + box.height) && point.x >= box.x && point.x <= box.x + box.width);
      if (!onBoundary(route[0], a) || !onBoundary(route.at(-1)!, b)) fail('ROUTE_ENDPOINT', flow.id, 'Route hints must begin and end on their element boundaries');
      if (route.slice(1).some((p, i) => p.x !== route[i].x && p.y !== route[i].y)) fail('ROUTE_ORTHOGONAL', flow.id, 'Route segments must be orthogonal');
    } else if (flow.return || end.x <= start.x) {
      const corridor = Math.max(10, Math.min(a.y, b.y) - 40);
      route = [start, { x: start.x + 25, y: start.y }, { x: start.x + 25, y: corridor }, { x: end.x - 25, y: corridor }, { x: end.x - 25, y: end.y }, end];
    } else route = start.y === end.y ? [start, end] : [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end];
    edges[flow.id] = route.filter((point, i) => i === 0 || point.x !== route[i - 1].x || point.y !== route[i - 1].y);
    const title = flow.name ?? flow.condition ?? (model.nodes.some(node => node.defaultFlow === flow.id) ? 'Иначе' : '');
    if (title) { const a = route[0], b = route[1]; labels[flow.id] = { x: (a.x + b.x) / 2 - 60, y: (a.y + b.y) / 2 - 42, width: 120, height: Math.max(36, Math.ceil(title.length / 18) * 18) }; }
  }
  if (errors.length) throw new BplmError(1, 'Invalid layout hints', errors);
  for (const stage of Object.values(stages)) stage.height = top - 50;
  const routePoints = Object.values(edges).flat();
  return { shapes, edges, labels, stages, viewport: { x: 0, y: 0, width: Math.max(width + 80, ...routePoints.map(point => point.x + 40)), height: Math.max(top, ...routePoints.map(point => point.y + 40)) } };
}
