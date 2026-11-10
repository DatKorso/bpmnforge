import type { Geometry, ProcessDocument, Bounds, Point, Diagnostic } from './domain.ts';
import { BpmnForgeError } from './domain.ts';
import { graphCells, orderedLanes } from './graph.ts';
import { taskSize, textHeight } from './text.ts';
import { READABLE, TASK_TYPES, gridCeil, expanded, boxDistance } from './profile.ts';
import { gatewayAssignments, endpointKey, isVertex, type Port } from './ports.ts';
import { visibilityRoute } from './visibility.ts';
const CLEARANCE = READABLE.routeGap;
const routeLength = (route: Point[]) => route.slice(1).reduce((total, point, i) => total + Math.abs(point.x - route[i].x) + Math.abs(point.y - route[i].y), 0);
const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const boxOverlap = (a: Bounds, b: Bounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const insideSegment = (a: Point, b: Point, box: Bounds) => a.y === b.y
  ? a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
  : a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height;
const boundary = (p: Point, b: Bounds) => ((p.x === b.x || p.x === b.x + b.width) && p.y >= b.y && p.y <= b.y + b.height) || ((p.y === b.y || p.y === b.y + b.height) && p.x >= b.x && p.x <= b.x + b.width);
const diamondBoundary = (p: Point, b: Bounds) => Math.abs(Math.abs((p.x - b.x - b.width / 2) / (b.width / 2)) + Math.abs((p.y - b.y - b.height / 2) / (b.height / 2)) - 1) < 1e-9;
function insideDiamondSegment(a: Point, b: Point, box: Bounds): boolean {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (a.y === b.y) {
    const half = box.width / 2 * (1 - Math.abs((a.y - cy) / (box.height / 2)));
    return half > 0 && Math.max(a.x, b.x) > cx - half + 1e-9 && Math.min(a.x, b.x) < cx + half - 1e-9;
  }
  const half = box.height / 2 * (1 - Math.abs((a.x - cx) / (box.width / 2)));
  return half > 0 && Math.max(a.y, b.y) > cy - half + 1e-9 && Math.min(a.y, b.y) < cy + half - 1e-9;
}
function compareRoutes(a: Point[], b: Point[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const order = a[i].x - b[i].x || a[i].y - b[i].y; if (order) return order; }
  return a.length - b.length;
}
function normalized(points: Point[]): Point[] {
  const unique = points.filter((point, index) => index === 0 || !equal(point, points[index - 1]));
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const a = unique[index - 1], b = unique[index + 1];
    return !((a.x === point.x && point.x === b.x && (point.y - a.y) * (b.y - point.y) >= 0)
      || (a.y === point.y && point.y === b.y && (point.x - a.x) * (b.x - point.x) >= 0));
  });
}
function attachmentPorts(box: Bounds, opposite: Bounds, preferred: Point, flexible: boolean, diamond = false, spread = 0): Port[] {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const clampX = (x: number) => Math.max(box.x + CLEARANCE, Math.min(box.x + box.width - CLEARANCE, x));
  const clampY = (y: number) => Math.max(box.y + CLEARANCE, Math.min(box.y + box.height - CLEARANCE, y));
  const ports: Port[] = [];
  const add = (dx: number, dy: number, x: number, y: number) => {
    if (flexible && (dx ? box.height : box.width) < CLEARANCE * 2) return;
    let point = { x: dx ? (dx > 0 ? box.x + box.width : box.x) : flexible ? clampX(x) : center.x,
      y: dy ? (dy > 0 ? box.y + box.height : box.y) : flexible ? clampY(y) : center.y };
    if (diamond) {
      if (dx) {
        const yOnSide = Math.max(center.y - box.height * 0.35, Math.min(center.y + box.height * 0.35, y));
        point = { x: center.x + dx * box.width / 2 * (1 - Math.abs((yOnSide - center.y) / (box.height / 2))), y: yOnSide };
      } else {
        const xOnSide = Math.max(center.x - box.width * 0.35, Math.min(center.x + box.width * 0.35, x));
        point = { x: xOnSide, y: center.y + dy * box.height / 2 * (1 - Math.abs((xOnSide - center.x) / (box.width / 2))) };
      }
    }
    if (!ports.some(port => equal(port.point, point) && port.dx === dx && port.dy === dy)) ports.push({ point, dx, dy });
  };
  if (preferred.x === box.x || preferred.x === box.x + box.width) add(preferred.x === box.x ? -1 : 1, 0, preferred.x, preferred.y);
  else add(0, preferred.y === box.y ? -1 : 1, preferred.x, preferred.y);
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    add(dx, dy, center.x, center.y);
    if (flexible) add(dx, dy, opposite.x + opposite.width / 2, opposite.y + opposite.height / 2);
    if (flexible && spread) for (const offset of (Math.abs(spread)>32 ? [-80,-64,-48,-32,-16,16,32,48,64,80] : [-32,-16,16,32])) add(dx, dy, center.x + offset, center.y + offset);
    if (diamond) {
      add(dx, dy, center.x + spread, center.y + spread);
      add(dx, dy, opposite.x + opposite.width / 2, opposite.y + opposite.height / 2);
      for (const offset of [-box.width * .25, box.width * .25, -box.width * .35, box.width * .35]) add(dx, dy, center.x + offset, center.y + offset);
    }
  }
  return ports;
}
function interaction(a: Point, b: Point, c: Point, d: Point): { kind: 'overlap' | 'crossing' | 'touch'; point: Point } | null {
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)), hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
    return lo < hi ? { kind: 'overlap', point: { x: lo, y: a.y } } : null;
  }
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)), hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
    return lo < hi ? { kind: 'overlap', point: { x: a.x, y: lo } } : null;
  }
  if ((a.y === b.y) === (c.y === d.y)) return null;
  const horizontal = a.y === b.y ? [a, b] : [c, d], vertical = a.x === b.x ? [a, b] : [c, d];
  const point = { x: vertical[0].x, y: horizontal[0].y };
  if (point.x < Math.min(horizontal[0].x, horizontal[1].x) || point.x > Math.max(horizontal[0].x, horizontal[1].x) || point.y < Math.min(vertical[0].y, vertical[1].y) || point.y > Math.max(vertical[0].y, vertical[1].y)) return null;
  const clearance = Math.min(...[a, b, c, d].map(p => Math.abs(p.x - point.x) + Math.abs(p.y - point.y)));
  return { kind: clearance >= 12 ? 'crossing' : 'touch', point };
}
export type LayoutMode = 'auto' | 'grid' | 'graph';
export function selectedLayout(model: ProcessDocument, mode: LayoutMode = 'auto'): 'manual' | 'grid' | 'graph' {
  if (!['auto', 'grid', 'graph'].includes(mode)) throw new BpmnForgeError(2, 'ARGUMENT: layout must be auto, grid or graph');
  if (mode !== 'auto') return mode;
  const items = [...model.nodes, ...(model.annotations ?? [])];
  if (items.every(item => item.bounds) && model.pools.every(pool => pool.bounds) && model.lanes.every(lane => lane.bounds)) return 'manual';
  return items.some(item => item.column !== undefined || item.row !== undefined) ? 'grid' : 'graph';
}
export function layoutProcess(model: ProcessDocument, options: { layout?: LayoutMode } = {}): Geometry {
  const state = { variants: new Map<string, number>(), expansions: new Map<string, number>(), exceptions: new Set<string>(), alternatives: new Map<string, number>() };
  // Retry a failed joint assignment before expanding its local intervals twice.
  // Only fixed geometry (or degree > 4) can ultimately use contour exceptions.
  for (let attempt = 0; attempt <= model.nodes.length * 74 + 1; attempt++) {
    try { return layoutAttempt(model, options, state); } catch (error) {
      if (!(error instanceof BpmnForgeError) || !error.diagnostics.some(d => d.code === 'ROUTE_UNSATISFIABLE')) throw error;
      const failed = new Set(error.diagnostics.filter(d => d.code === 'ROUTE_UNSATISFIABLE').flatMap(d => d.relatedIds ?? []));
      const gateways = model.nodes.filter(n => failed.has(n.id) && (n.type === 'xor' || n.type === 'and')).sort((a,b) => a.id < b.id ? -1 : 1);
      let retry = false;
      for (const node of gateways) {
        const current = state.variants.get(node.id) ?? 0;
        if (current + 1 < (state.alternatives.get(node.id) ?? 0)) { state.variants.set(node.id, current + 1); retry = true; break; }
        const expansion = state.expansions.get(node.id) ?? 0;
        if (!node.bounds && expansion < 2) { state.expansions.set(node.id, expansion + 1); state.variants.set(node.id, 0); retry = true; break; }
        if (!state.exceptions.has(node.id) && (node.bounds || model.flows.some(f => f.route && (f.source === node.id || f.target === node.id)))) {
          state.exceptions.add(node.id); retry = true; break;
        }
      }
      if (!retry) throw error;
    }
  }
  throw new BpmnForgeError(1, 'Invalid layout: exhausted local routing attempts');
}
interface RoutingState { variants: Map<string, number>; expansions: Map<string, number>; exceptions: Set<string>; alternatives: Map<string, number> }
function layoutAttempt(model: ProcessDocument, options: { layout?: LayoutMode }, state: RoutingState): Geometry {
  const shapes: Geometry['shapes'] = Object.create(null), edges: Geometry['edges'] = Object.create(null);
  const labels: Geometry['labels'] = Object.create(null), stages: Geometry['stages'] = Object.create(null);
  const errors: Diagnostic[] = [];
  const fail = (code: string, id: string, message: string) => errors.push({ code, id, message, severity: 'error' });
  const cells = new Map<string, { column: number; row: number }>(), occupied = new Map<string, string>();
  const cellConflicts: { id: string; otherId: string }[] = [];
  const items = [...model.nodes, ...(model.annotations ?? [])];
  const nodeTypes = new Map(model.nodes.map(node => [node.id, node.type]));
  const isGateway = (id: string) => nodeTypes.get(id) === 'xor' || nodeTypes.get(id) === 'and';
  const counts = new Map<string, number>();
  const mode = selectedLayout(model, options.layout);
  const graph = mode === 'graph' ? graphCells(model) : null;
  const columnCenters = new Map<string, number[]>();
  const sizes = new Map(items.map(item => {
    const annotation = 'text' in item, type = 'type' in item ? item.type : 'annotation';
    const size = annotation ? { width: 180, height: Math.max(80, Math.ceil((textHeight(item.text, 148) + 32) / 40) * 40) }
      : TASK_TYPES.has(type) ? taskSize(item.name)
      : type === 'xor' || type === 'and' ? { width: 50, height: 50 } : { width: 36, height: 36 };
    return [item.id, item.bounds ? { width: item.bounds.width, height: item.bounds.height } : size] as const;
  }));
  const labelHeight = (name: string) => Math.max(40, textHeight(name, 180));
  for (const item of items) {
    const hinted = graph?.get(item.id);
    const row = hinted?.row ?? item.row ?? 0;
    const key = `${item.process}/${item.lane ?? ''}/${item.stage}/${row}`;
    const column = hinted?.column ?? item.column ?? counts.get(key) ?? 0;
    const cell = `${key}/${column}`;
    const otherId = occupied.get(cell);
    if (otherId) cellConflicts.push({ id: item.id, otherId });
    else occupied.set(cell, item.id);
    counts.set(key, Math.max(counts.get(key) ?? 0, column + 1)); cells.set(item.id, { column, row });
  }
  let x = 100;
  for (const stage of model.stages) {
    const members = items.filter(item => item.stage === stage.id);
    const columns = Math.max(1, ...members.map(item => cells.get(item.id)!.column + 1));
    const centers: number[] = [];
    let right = x + READABLE.lanePadding;
    let previous: typeof members = [];
    for (let column = 0; column < columns; column++) {
      const current = members.filter(item => cells.get(item.id)!.column === column);
      if (!current.length) { centers.push(right + READABLE.emptyColumn / 2); right += READABLE.emptyColumn; continue; }
      const half = Math.max(...current.map(item => sizes.get(item.id)!.width / 2));
      const expansion = Math.max(0, ...current.map(item => state.expansions.get(item.id) ?? 0), ...previous.map(item => state.expansions.get(item.id) ?? 0)) * READABLE.grid * 2;
      const firstCaptionHalf = column === 0 ? Math.max(0, ...current.map(item => 'type' in item && !TASK_TYPES.has(item.type) && !isGateway(item.id) ? 90 : 0)) : 0;
      let center = gridCeil(right + Math.max(half, firstCaptionHalf) + expansion);
      // Two external captions on the same row also need their own interval.
      if (previous.length) for (const a of previous) for (const b of current) {
        if (a.process !== b.process || a.lane !== b.lane || cells.get(a.id)!.row !== cells.get(b.id)!.row) continue;
        const external = (item: typeof a) => 'type' in item && !TASK_TYPES.has(item.type) && item.type !== 'eventSubProcess';
        if (external(a) && external(b)) center = Math.max(center, gridCeil(centers[cells.get(a.id)!.column] + 180 + READABLE.labelGap));
      }
      centers.push(center); right = center + half + READABLE.preferredStepGap; previous = current;
    }
    const end = gridCeil(right - (members.length ? READABLE.preferredStepGap : 0) + READABLE.lanePadding);
    columnCenters.set(stage.id, centers);
    stages[stage.id] = { x, y: 60, width: end - x, height: 0 }; x = end;
  }
  const width = x - 40 + 40; let top = 60;
  for (const process of model.processes) {
    const pool = model.pools.find(pool => pool.process === process.id)!; const poolTop = top;
    const lanes = orderedLanes(model,process.id);
    const partitions = lanes.length ? lanes : [{ id: '', process: process.id }];
    for (const lane of partitions) {
      const members = items.filter(item => item.process === process.id && (item.lane ?? '') === lane.id);
      const rows = Math.max(1, ...members.map(item => cells.get(item.id)!.row + 1));
      const rowCenters: number[] = [];
      const rowBottoms: number[] = [];
      let height = 0;
      for (let row = 0; row < rows; row++) {
        const rowMembers = members.filter(item => cells.get(item.id)!.row === row);
        const halfHeight = Math.max(20, ...rowMembers.map(item=>sizes.get(item.id)!.height/2));
        const rowExpansion=Math.max(0,...rowMembers.map(item=>state.expansions.get(item.id)??0))*READABLE.grid;
        const above = gridCeil(Math.max(20, ...rowMembers.map(item => sizes.get(item.id)!.height / 2)) + (row === 0 ? READABLE.lanePadding : READABLE.branchGap / 2)+rowExpansion);
        const below = gridCeil(Math.max(20, ...rowMembers.map(item => {
          const size = sizes.get(item.id)!;
          if ('text' in item || TASK_TYPES.has(item.type)) return size.height / 2;
          return (isGateway(item.id) ? Math.max(halfHeight + 20, size.height / 2 + 40 + READABLE.labelGap) : 38) + labelHeight(item.name);
        })) + (row === rows - 1 ? READABLE.lanePadding : READABLE.branchGap / 2)+rowExpansion);
        rowCenters.push(top + height + above);
        rowBottoms.push(halfHeight);
        height += above + below;
      }
      if (lane.id) shapes[lane.id] = { x: 70, y: top, width: width - 30, height };
      for (const item of members) {
        const annotation = 'text' in item, type = 'type' in item ? item.type : 'annotation';
        const taskLike = TASK_TYPES.has(type);
        const size = sizes.get(item.id)!;
        if (!item.bounds && annotation && size.height > 400) fail('LABEL_SIZE', item.id, 'Text annotation exceeds a grid cell; split the annotation');
        const cell = cells.get(item.id)!, centerY = rowCenters[cell.row];
        shapes[item.id] = { x: columnCenters.get(item.stage)![cell.column] - size.width / 2, y: centerY - size.height / 2, ...size };
        if (!annotation && !taskLike) {
          const box = shapes[item.id];
          // A centered caption blocks the bottom vertex when a gateway has
          // four connections. Keep the caption diagonally clear of every port.
          labels[item.id] = { x: isGateway(item.id) ? box.x + box.width + 20 : box.x + box.width / 2 - 90,
            y: isGateway(item.id) ? centerY + Math.max(rowBottoms[cell.row] + 20, box.height / 2 + 40 + READABLE.labelGap) : centerY + 38, width: 180, height: labelHeight(item.name) };
        }
      }
      top += height;
    }
    shapes[pool.id] = { x: 40, y: poolTop, width, height: top - poolTop }; top += 80;
  }
  const explicit = items.every(item => item.bounds) && model.pools.every(pool => pool.bounds) && model.lanes.every(lane => lane.bounds);
  for (const item of items) if (item.bounds) {
    shapes[item.id] = { ...item.bounds };
    if (item.labelBounds) labels[item.id] = { ...item.labelBounds };
    else if (explicit) delete labels[item.id];
    else if (labels[item.id]) {
      const box = shapes[item.id];
      labels[item.id] = { x: box.x + box.width / 2 - 90, y: box.y + box.height + 20, width: 180, height: labelHeight(item.name) };
    }
  }
  for (const item of items) if (item.labelBounds) labels[item.id] = { ...item.labelBounds };
  for (const flow of model.flows) if(flow.labelBounds && (flow.name||flow.condition||model.nodes.some(node=>node.defaultFlow===flow.id))) labels[flow.id]={...flow.labelBounds};
  for (const pool of model.pools) if (pool.bounds) shapes[pool.id] = { ...pool.bounds };
  for (const lane of model.lanes) if (lane.bounds) shapes[lane.id] = { ...lane.bounds };
  if (explicit) for (const stage of model.stages) {
    const boxes = model.nodes.filter(item => item.stage === stage.id).map(item => shapes[item.id]);
    if (!boxes.length) continue;
    const minX = Math.min(...boxes.map(box => box.x)), minY = Math.min(...boxes.map(box => box.y));
    stages[stage.id] = { x: Math.max(0, minX - 80), y: Math.max(0, minY - 100), width: Math.max(...boxes.map(box => box.x + box.width)) - minX + 160, height: Math.max(...boxes.map(box => box.y + box.height)) - minY + 200 };
  }
  for (const conflict of cellConflicts.filter(conflict => !items.find(item => item.id === conflict.id)?.bounds || !items.find(item => item.id === conflict.otherId)?.bounds)) {
    const bounds = shapes[conflict.id];
    errors.push({ code: 'CELL_CONFLICT', id: conflict.id, relatedIds: [conflict.otherId], point: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, bounds, message: 'Two elements occupy the same stage/lane cell', severity: 'error' });
  }
  const itemIds = new Set(items.map(item => item.id));
  for (const node of model.nodes) if (node.parent) {
    const child = shapes[node.id], parent = shapes[node.parent];
    if (child && parent && (child.x < parent.x + 12 || child.y < parent.y + 12 || child.x + child.width > parent.x + parent.width - 12 || child.y + child.height > parent.y + parent.height - 12)) {
      errors.push({ code: 'SUBPROCESS_BOUNDS', id: node.id, relatedIds: [node.parent], bounds: child, message: 'Child shape must fit inside its event subprocess', severity: 'error' });
    }
  }
  const obstacles = () => [
    ...Object.entries(shapes).filter(([id]) => itemIds.has(id)).map(([id, box]) => ({ id, box, diamond: isGateway(id) })),
    ...Object.entries(labels).map(([id, box]) => ({ id, box, diamond: false }))
  ];
  const shapeEntries = Object.entries(shapes).filter(([id]) => itemIds.has(id));
  for (let i = 0; i < shapeEntries.length; i++) for (let j = i + 1; j < shapeEntries.length; j++) {
    const left = model.nodes.find(node => node.id === shapeEntries[i][0]), right = model.nodes.find(node => node.id === shapeEntries[j][0]);
    if ((left?.parent === right?.id || right?.parent === left?.id) && boxOverlap(shapeEntries[i][1], shapeEntries[j][1])) continue;
    if (boxOverlap(shapeEntries[i][1], shapeEntries[j][1])) errors.push({ code: 'SHAPE_OVERLAP', id: shapeEntries[i][0], relatedIds: [shapeEntries[j][0]], bounds: shapeEntries[i][1], message: 'Element shapes overlap', severity: 'error' });
  }
  // External captions choose an unoccupied quadrant after all shape sizes
  // are known. Explicit label bounds remain authoritative.
  for (const item of items) {
    const label = labels[item.id]; if (!label || item.labelBounds || item.bounds) continue;
    const box = shapes[item.id], cx = box.x + box.width / 2;
    const candidates = [label,
      { ...label, x: cx - label.width / 2, y: box.y + box.height + 20 },
      { ...label, x: box.x - label.width - 20, y: box.y + box.height + 20 },
      { ...label, x: box.x + box.width + 20, y: box.y - label.height - 20 },
      { ...label, x: cx - label.width / 2, y: box.y - label.height - 20 },
      { ...label, x: box.x - label.width - 20, y: box.y - label.height - 20 }
    ];
    const valid = candidates.filter(candidate => candidate.x >= 0 && candidate.y >= 0
      && shapeEntries.every(([id, shape]) => id === item.id || !boxOverlap(expanded(candidate, READABLE.labelGap), shape))
      && Object.entries(labels).every(([id, other]) => id === item.id || !boxOverlap(expanded(candidate, READABLE.labelGap), other))
      && (!isGateway(item.id) || [
        [{x:cx,y:box.y},{x:cx,y:box.y-40}], [{x:cx,y:box.y+box.height},{x:cx,y:box.y+box.height+40}],
        [{x:box.x,y:box.y+box.height/2},{x:box.x-40,y:box.y+box.height/2}], [{x:box.x+box.width,y:box.y+box.height/2},{x:box.x+box.width+40,y:box.y+box.height/2}]
      ].every(([a,b])=>!insideSegment(a,b,expanded(candidate,READABLE.labelGap)))));
    if (valid.length) labels[item.id] = valid[0];
  }
  for (const [id, label] of Object.entries(labels)) for (const [otherId, box] of shapeEntries) {
    if (model.nodes.some(node => node.id === id && node.parent === otherId)) continue;
    if (id !== otherId && boxOverlap(label, box)) errors.push({ code: 'LABEL_OVERLAP', id, relatedIds: [otherId], bounds: label, message: 'Label overlaps an element', severity: 'error' });
  }
  if (errors.length) throw new BpmnForgeError(1, 'Invalid layout', errors);
  const assignments = gatewayAssignments(model, shapes, state.variants, labels), assignedPorts = new Map<string, Port>();
  for (const [id, assignment] of assignments) {
    state.alternatives.set(id, assignment.variants.length);
    const ports = assignment.variants[state.variants.get(id) ?? 0] ?? [];
    assignment.keys.forEach((key, index) => { if (ports[index] && !state.exceptions.has(id)) assignedPorts.set(key, ports[index]!); });
  }
  const approaches = () => [...assignedPorts].map(([key,port])=>({ flow: key.slice(0,key.lastIndexOf('/')), node: model.flows.find(flow=>flow.id===key.slice(0,key.lastIndexOf('/')))![key.endsWith('/source')?'source':'target'],
    box: expanded({x:Math.min(port.point.x,port.point.x+port.dx*READABLE.stub),y:Math.min(port.point.y,port.point.y+port.dy*READABLE.stub),width:Math.abs(port.dx*READABLE.stub),height:Math.abs(port.dy*READABLE.stub)},READABLE.routeGap) }));
  let reservedApproaches = approaches();
  const degree = new Map(model.nodes.map(node=>[node.id,model.flows.reduce((sum,flow)=>sum+Number(flow.source===node.id)+Number(flow.target===node.id),0)]));
  const reserves = (reserved: typeof reservedApproaches[number], flow: ProcessDocument['flows'][number]) => reserved.flow!==flow.id
    && (!([flow.source,flow.target].includes(reserved.node)) || (degree.get(reserved.node) ?? 0)<=4);
  const crossings: Geometry['crossings'] = [];
  const flowById = new Map(model.flows.map(flow => [flow.id, flow]));
  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  let routeObstacles = obstacles();
  const constraintCache = new Map<string, {id:string;box:Bounds;original:Bounds;diamond:boolean}[]>();
  const routeConstraints = (id:string) => {
    if(!constraintCache.has(id)) {
      const flow=flowById.get(id),manual=!!flow?.route;
      constraintCache.set(id,routeObstacles.flatMap(obstacle=>{
        const parent=nodeById.get(obstacle.id)?.type==='eventSubProcess'?nodeById.get(obstacle.id):undefined;
        if(parent&&flow&&[flow.source,flow.target].every(endpoint=>nodeById.get(endpoint)?.parent===parent.id))return [];
        const unrelated=obstacle.id!==flow?.source&&obstacle.id!==flow?.target;
        return [{id:obstacle.id,original:obstacle.box,box:!manual&&unrelated?expanded(obstacle.box,itemIds.has(obstacle.id)?READABLE.shapeGap:READABLE.labelGap):obstacle.box,diamond:obstacle.diamond&&(manual||!unrelated)}];
      }));
    }
    return constraintCache.get(id)!;
  };
  const routingPriority = (flow: ProcessDocument['flows'][number]) => flow.route ? 0 : flow.type !== 'sequence' ? 3 : flow.return ? 2 : 1;
  const sortedFlows = [...model.flows].sort((a, b) => routingPriority(a) - routingPriority(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  function parallelClearance(a: Point, b: Point, c: Point, d: Point, id: string, otherId: string): number {
    const horizontal = a.y === b.y;
    if (horizontal !== (c.y === d.y)) return Infinity;
    const lo = Math.max(Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y), Math.min(horizontal ? c.x : c.y, horizontal ? d.x : d.y));
    const hi = Math.min(Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y), Math.max(horizontal ? c.x : c.y, horizontal ? d.x : d.y));
    if (hi <= lo) return Infinity;
    const first = flowById.get(id)!, second = flowById.get(otherId)!;
    // Shared attachments may fan out within 28 units of their common shape.
    // A long coincident trunk beyond that local port zone still fails.
    for (const endpoint of [first.source, first.target]) if (endpoint === second.source || endpoint === second.target) {
      const box = shapes[endpoint];
      const from = (horizontal ? box.x : box.y) - 28, to = (horizontal ? box.x + box.width : box.y + box.height) + 28;
      if (lo >= from && hi <= to) return Infinity;
    }
    return Math.abs(horizontal ? a.y - c.y : a.x - c.x);
  }
  const port = (flow: typeof sortedFlows[number], side: 'source' | 'target', box: Bounds): Point => {
    const group = sortedFlows.filter(item => item[side] === flow[side]);
    const offset = (group.findIndex(item => item.id === flow.id) - (group.length - 1) / 2) * Math.min(16, box.height * 0.65 / Math.max(1, group.length));
    const opposite = shapes[side === 'source' ? flow.target : flow.source];
    const deltaY = (opposite.y + opposite.height / 2) - (box.y + box.height / 2);
    if (Math.abs(deltaY) > Math.max(box.height, opposite.height) / 2 + 50 && !flow.return) {
      const direction = side === 'source' ? deltaY : -deltaY;
      if (side === 'source' && direction > 0 && labels[flow.source]) return { x: box.x + box.width, y: box.y + box.height / 2 + offset };
      if (side === 'source' && direction < 0 && flow.type === 'sequence') return { x: box.x + box.width, y: box.y + box.height / 2 + offset };
      if (side === 'target' && direction < 0 && labels[flow.target]) return { x: box.x, y: box.y + box.height / 2 + offset };
      const desiredX = box.width > 500 ? opposite.x + opposite.width / 2 : box.x + box.width / 2;
      return { x: Math.max(box.x + CLEARANCE, Math.min(box.x + box.width - CLEARANCE, desiredX + (direction > 0 ? 18 : -18) + offset)), y: side === 'source' ? (direction > 0 ? box.y + box.height : box.y) : (direction > 0 ? box.y : box.y + box.height) };
    }
    return { x: side === 'source' ? box.x + box.width : box.x, y: box.y + box.height / 2 + offset };
  };
  function checkRoute(id: string, route: Point[], allowClose = false): { errors: Diagnostic[]; crossings: Geometry['crossings'] } {
    const problems: Diagnostic[] = [], found: Geometry['crossings'] = [];
    const manual = Boolean(flowById.get(id)?.route);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      if (a.x !== b.x && a.y !== b.y) { problems.push({ code: 'ROUTE_ORTHOGONAL', id, point: a, message: 'Route segment is not orthogonal', severity: 'error' }); if (!manual) return { errors: problems, crossings: found }; continue; }
      if (equal(a, b)) { problems.push({ code: 'ROUTE_ZERO_LENGTH', id, point: a, message: 'Route segment has zero length', severity: 'error' }); if (!manual) return { errors: problems, crossings: found }; continue; }
      if (i > 1) {
        const previous = route[i - 2];
        if ((a.x - previous.x) * (b.x - a.x) + (a.y - previous.y) * (b.y - a.y) < 0) problems.push({ code: 'ROUTE_SELF_INTERSECTION', id, point: a, message: 'Route doubles back on itself', severity: 'error' });
      }
      if (problems.length && !manual) return { errors: problems, crossings: found };
      const flow = flowById.get(id);
      if (!manual && flow && reservedApproaches.some(reserved=>reserves(reserved,flow) && insideSegment(a,b,reserved.box))) {
        problems.push({code:'ROUTE_RESERVED_PORT',id,point:a,message:'Route blocks another assigned attachment approach',severity:'error'});
        return {errors:problems,crossings:found};
      }
      for (const obstacle of routeConstraints(id)) {
        if (obstacle.diamond ? insideDiamondSegment(a, b, obstacle.box) : insideSegment(a, b, obstacle.box)) problems.push({ code: 'ROUTE_OBSTACLE', id, relatedIds: [obstacle.id], point: a.x === b.x ? { x: a.x, y: Math.max(Math.min(a.y, b.y), obstacle.original.y) } : { x: Math.max(Math.min(a.x, b.x), obstacle.original.x), y: a.y }, bounds: obstacle.original, message: `Route intersects ${obstacle.id}`, severity: 'error' });
        if (problems.length && !manual) return { errors: problems, crossings: found };
      }
      for (const [otherId, otherRoute] of Object.entries(edges)) for (let j = 1; j < otherRoute.length; j++) {
        if (!allowClose && !flow?.route && parallelClearance(a, b, otherRoute[j - 1], otherRoute[j], id, otherId) < CLEARANCE - 1e-9) problems.push({ code: 'ROUTE_CLEARANCE', id, relatedIds: [otherId], point: a, message: 'Parallel routes need at least 14 units of clearance outside shared ports', severity: 'error' });
        if (problems.length && !manual) return { errors: problems, crossings: found };
        const contact = interaction(a, b, otherRoute[j - 1], otherRoute[j]); if (!contact) continue;
        if (contact.kind === 'crossing') found.push({ flows: [otherId, id], point: contact.point, over: id });
        else problems.push({ code: contact.kind === 'overlap' ? 'ROUTE_OVERLAP' : 'ROUTE_TOUCH', id, relatedIds: [otherId], point: contact.point, message: `Route ${contact.kind} with ${otherId}`, severity: 'error' });
        if (problems.length && !manual) return { errors: problems, crossings: found };
      }
      for (let j = 1; j < i - 1; j++) {
        const contact = interaction(a, b, route[j - 1], route[j]);
        if (contact) problems.push({ code: 'ROUTE_SELF_INTERSECTION', id, point: contact.point, message: 'Route intersects itself', severity: 'error' });
      }
    }
    return { errors: problems, crossings: found };
  }
  let labelFixedCache = new Map<string,boolean>();
  function placeLabel(id: string, title: string, route: Point[]): Bounds | null {
    const width = Math.min(260, Math.max(110, Math.ceil(Math.sqrt(title.length) * 24 / 20) * 20));
    const height = Math.max(36, textHeight(title, width));
    const candidates: Bounds[] = [];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      if (a.y === b.y && Math.abs(a.x - b.x) >= width + 20) for (const offset of [-height - 10, 10]) candidates.push({ x: b.x > a.x ? a.x + 10 : a.x - width - 10, y: a.y + offset, width, height });
      if (a.x === b.x && Math.abs(a.y - b.y) >= height + 20) for (const offset of [10, -width - 10]) candidates.push({ x: a.x + offset, y: b.y > a.y ? a.y + 10 : a.y - height - 10, width, height });
      if (a.y === b.y) for (const offset of [-height - 10, 10]) candidates.push({ x: (a.x + b.x) / 2 - width / 2, y: a.y + offset, width, height });
      else for (const offset of [10, -width - 10]) candidates.push({ x: a.x + offset, y: (a.y + b.y) / 2 - height / 2, width, height });
    }
    const flow = flowById.get(id)!;
    const source = shapes[flow.source], target = shapes[flow.target];
    if (source) for (const gap of [20,40,60]) {
      for (const x of [source.x,source.x+source.width-width,source.x+source.width/2-width/2]) {
        candidates.push({x,y:source.y-height-gap,width,height},{x,y:source.y+source.height+gap,width,height});
      }
      for (const y of [source.y,source.y+source.height-height]) candidates.push({x:source.x-width-gap,y,width,height},{x:source.x+source.width+gap,y,width,height});
    }
    const laneId = nodeById.get(flow.source)?.lane;
    const lane = laneId ? shapes[laneId] : undefined;
    const score = (box: Bounds) => {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const origin = source ? { x: source.x + source.width / 2, y: source.y + source.height / 2 } : route[0];
      const destination = target ? { x: target.x + target.width / 2, y: target.y + target.height / 2 } : route.at(-1)!;
      const distance = source ? boxDistance(box,source) : Math.abs(cx - origin.x) + Math.abs(cy - origin.y);
      const branchDistance = Math.min(...route.slice(1).map((p,i)=>boxDistance(box,{x:Math.min(p.x,route[i].x),y:Math.min(p.y,route[i].y),width:Math.abs(p.x-route[i].x),height:Math.abs(p.y-route[i].y)})));
      const outsideLane = lane && (box.y < lane.y || box.y + box.height > lane.y + lane.height);
      return distance + branchDistance * 2 + Number(outsideLane) * 2000 + (Math.abs(cx - destination.x) + Math.abs(cy - destination.y)) * 0.1;
    };
    return candidates.filter(box => labelClear(box, route)).map(box=>({box,score:score(box)})).sort((a, b) => a.score - b.score || a.box.y - b.box.y || a.box.x - b.box.x)[0]?.box ?? null;
  }
  function labelClear(box: Bounds, route: Point[], manual=false, owner?:string): boolean {
    const padded = expanded(box, manual?0:READABLE.labelGap);
    const key=`${box.x}/${box.y}/${box.width}/${box.height}/${manual}`;
    if (!labelFixedCache.has(key)) labelFixedCache.set(key,box.x >= 0 && box.y >= 0 && routeObstacles.every(other => other.id===owner || !boxOverlap(padded, other.box))
      && (manual||[...assignedPorts.values()].every(port=>!insideSegment(port.point,{x:port.point.x+port.dx*40,y:port.point.y+port.dy*40},padded)))
      && Object.values(edges).every(points => points.slice(1).every((end, i) => !insideSegment(points[i], end, padded))));
    return labelFixedCache.get(key)! && route.slice(1).every((end, i) => !insideSegment(route[i], end, padded));
  }
  const closeCount = (id: string, route: Point[]) => {
    let count = 0;
    for (const [otherId, other] of Object.entries(edges)) for (let i = 1; i < route.length; i++) for (let j = 1; j < other.length; j++) {
      if (parallelClearance(route[i-1], route[i], other[j-1], other[j], id, otherId) < CLEARANCE - 1e-9) count++;
    }
    return count;
  };
  const routePenalty = (id: string, route: Point[]) => {
    const flow = flowById.get(id)!;
    const result = checkRoute(id, route, true);
    return closeCount(id, route) * 100000 + result.errors.length * 1000000 + result.crossings.length * READABLE.crossingCost + (route.length - 2) * READABLE.bendCost + routeLength(route)
      + [route[0], route.at(-1)!].reduce((sum, point, index) => {
        const box = shapes[index ? flow.target : flow.source];
        if (!nodeTypes.has(index ? flow.target : flow.source)) return sum;
        return sum + Math.min(
          Math.abs(point.x - box.x) + Math.abs(point.y - box.y - box.height / 2),
          Math.abs(point.x - box.x - box.width) + Math.abs(point.y - box.y - box.height / 2),
          Math.abs(point.x - box.x - box.width / 2) + Math.abs(point.y - box.y),
          Math.abs(point.x - box.x - box.width / 2) + Math.abs(point.y - box.y - box.height)
        ) * (isGateway(index ? flow.target : flow.source) ? 0 : READABLE.taskPortCost);
      }, 0);
  };
  let firstLength = Infinity, firstWidth = Infinity, firstHeight = Infinity;
  const searchedScores = new Map<string,number>();
  const extents = (routes: Point[][], extra: Bounds[] = []) => {
    const points = routes.flat();
    const boxes = [...Object.values(shapes), ...Object.values(labels), ...extra];
    const left = Math.min(...points.map(p => p.x), ...boxes.map(b => b.x)), top = Math.min(...points.map(p => p.y), ...boxes.map(b => b.y));
    return { width: Math.max(...points.map(p => p.x), ...boxes.map(b => b.x + b.width)) - left, height: Math.max(...points.map(p => p.y), ...boxes.map(b => b.y + b.height)) - top };
  };
  for (let pass = 0; pass <= READABLE.improvementPasses; pass++) {
  routeObstacles=obstacles();constraintCache.clear();
  if (pass === 1) { firstLength = Object.values(edges).reduce((sum, route) => sum + routeLength(route), 0); const bounds = extents(Object.values(edges)); firstWidth = bounds.width; firstHeight = bounds.height; }
  let improved = false;
  const ordered = pass ? sortedFlows.filter(flow => !flow.route).map(flow => {
    const previous = edges[flow.id];
    delete edges[flow.id];
    const penalty = routePenalty(flow.id, previous);
    edges[flow.id] = previous;
    return { flow, penalty };
  }).filter(item => item.penalty >= READABLE.crossingCost && item.penalty>(searchedScores.get(item.flow.id)??-Infinity)+1e-9).sort((a,b) => b.penalty - a.penalty || (a.flow.id < b.flow.id ? -1 : 1)).slice(0, 8).map(item => item.flow) : sortedFlows;
  for (const flow of ordered) {
    const previous = edges[flow.id], previousLabel = labels[flow.id];
    delete edges[flow.id]; if (previous) delete labels[flow.id];
    routeObstacles = obstacles();
    constraintCache.clear();
    labelFixedCache = new Map();
    const previousPenalty = previous ? routePenalty(flow.id, previous) : Infinity;
    const a = shapes[flow.source], b = shapes[flow.target];
    if (!a || !b) { fail('ROUTE_ENDPOINT', flow.id, 'No shape for connector endpoint'); continue; }
    const start = port(flow, 'source', a), end = port(flow, 'target', b);
    const title = flow.name ?? flow.condition ?? (model.nodes.some(node => node.defaultFlow === flow.id) ? 'Иначе' : '');
    const candidates: Point[][] = [];
    let extraCorridors: (() => void) | undefined;
    let shiftedCorridors: (() => void) | undefined;
    let visibilityCandidates: (() => void) | undefined;
    if (flow.route) {
      const invalid = ([[flow.source, flow.route[0], a], [flow.target, flow.route.at(-1)!, b]] as const).find(([id, point, box]) => !(isGateway(id) ? diamondBoundary(point, box) : boundary(point, box)));
      if (invalid) { errors.push({ code: isGateway(invalid[0]) ? 'ROUTE_GATEWAY_PORT' : 'ROUTE_ENDPOINT', id: flow.id, relatedIds: [invalid[0]], point: invalid[1], message: 'Route hint must start and end on the actual endpoint contour', severity: 'error' }); continue; }
      candidates.push(flow.route.map(point => ({ ...point })));
    } else {
      const sourceType = nodeTypes.get(flow.source), targetType = nodeTypes.get(flow.target);
      const spread = (id: string, box: Bounds) => {
        const connections = sortedFlows.filter(item => item.source === id || item.target === id);
        return (connections.findIndex(item => item.id === flow.id) - (connections.length - 1) / 2) * Math.min(16, Math.min(box.width, box.height) * 0.65 / Math.max(1, connections.length));
      };
      const sourceAssignment = assignedPorts.get(endpointKey(flow.id, 'source')), targetAssignment = assignedPorts.get(endpointKey(flow.id, 'target'));
      if (([flow.source,flow.target] as const).some((id,index)=>isGateway(id)&&(degree.get(id)??0)<=4&&!state.exceptions.has(id)&&!(index?targetAssignment:sourceAssignment))) {
        errors.push({code:'ROUTE_UNSATISFIABLE',id:flow.id,relatedIds:[flow.source,flow.target],point:start,message:'Gateway vertices require another joint assignment or a wider local interval',severity:'error'});continue;
      }
      const crowded = (id: string, box: Bounds) => isGateway(id) ? spread(id, box) : sortedFlows.filter(item=>item.source===id||item.target===id).length >= 4 ? 16 : 0;
      const sources = sourceAssignment ? [sourceAssignment] : attachmentPorts(a, b, start, !sourceType || sourceType === 'eventSubProcess' || TASK_TYPES.has(sourceType), isGateway(flow.source), crowded(flow.source, a));
      const targets = targetAssignment ? [targetAssignment] : attachmentPorts(b, a, end, !targetType || targetType === 'eventSubProcess' || TASK_TYPES.has(targetType), isGateway(flow.target), crowded(flow.target, b));
      if (isGateway(flow.source) && !sourceAssignment && !state.exceptions.has(flow.source)) sources.splice(0,sources.length,...sources.filter(port=>!isVertex(port.point,a)));
      if (isGateway(flow.target) && !targetAssignment && !state.exceptions.has(flow.target)) targets.splice(0,targets.length,...targets.filter(port=>!isVertex(port.point,b)));
      if (!sources.length || !targets.length) { fail('ROUTE_UNSATISFIABLE', flow.id, 'Endpoint has no attachment side with sufficient corner clearance'); continue; }
      const outside = (port: Port): Point => ({ x: port.point.x + port.dx * READABLE.stub, y: port.point.y + port.dy * READABLE.stub });
      const stubCache = new Map<string,boolean>();
      const stubValid = (port: Port) => {
        const key=`${port.point.x}/${port.point.y}/${port.dx}/${port.dy}`;
        if(!stubCache.has(key))stubCache.set(key,!checkRoute(flow.id,[port.point,outside(port)]).errors.length);
        return stubCache.get(key)!;
      };
      if (!flow.return && flow.source !== flow.target) for (const source of sources) for (const target of targets) {
        const s = outside(source), t = outside(target);
        const wrap = (middle: Point[]) => [source.point, s, ...middle, t, target.point];
        // Facing ports may connect directly even when the 26 px stubs would overlap.
        const dx = target.point.x - source.point.x, dy = target.point.y - source.point.y;
        if ((dx === 0 || dy === 0) && dx * source.dx + dy * source.dy > 0 && dx * target.dx + dy * target.dy < 0) candidates.push([source.point, target.point]);
        candidates.push(wrap([{ x: t.x, y: s.y }]), wrap([{ x: s.x, y: t.y }]));
        candidates.push(wrap([{ x: (s.x + t.x) / 2, y: s.y }, { x: (s.x + t.x) / 2, y: t.y }]));
        candidates.push(wrap([{ x: s.x, y: (s.y + t.y) / 2 }, { x: t.x, y: (s.y + t.y) / 2 }]));
      }
      // Keep the existing corridor search as a bounded fallback for obstacles,
      // parallel links and returns, using valid points on gateways and events.
      const addCorridors = (source: Port, target: Port) => {
        const s = outside(source), t = outside(target);
        if (!stubValid(source) || !stubValid(target)) return;
        const wrap = (middle: Point[]) => [source.point, s, ...middle, t, target.point];
        if (s.y === t.y || s.x === t.x) candidates.push(wrap([]));
        const blocked = routeObstacles;
        const xs = [...new Set([(s.x + t.x) / 2, s.x, t.x, ...blocked.flatMap(({ box }) => [box.x - CLEARANCE, box.x + box.width + CLEARANCE]), ...Object.values(edges).flatMap(route => route.flatMap(point => [point.x - CLEARANCE, point.x + CLEARANCE]))])].filter(x => x >= 0).sort((x, y) => Math.abs(x - (s.x + t.x) / 2) - Math.abs(y - (s.x + t.x) / 2)).slice(0, 24);
        const topRoute = Math.max(8, Math.min(...blocked.map(({ box }) => box.y)) - 32 - Object.keys(edges).length * 16);
        const bottomRoute = Math.max(...blocked.map(({ box }) => box.y + box.height)) + 32 + Object.keys(edges).length * 16;
        const sourceLane = nodeById.get(flow.source)?.lane;
        const lane = sourceLane ? shapes[sourceLane] : undefined;
        const corridorIndex = sortedFlows.filter(item => item.type !== 'sequence' || item.return).findIndex(item => item.id === flow.id);
        const localIndex = Math.max(0,sortedFlows.filter(item=>(item.return||item.type!=='sequence') && nodeById.get(item.source)?.stage===nodeById.get(flow.source)?.stage).findIndex(item=>item.id===flow.id));
        const localYs = [Math.max(8,Math.min(a.y,b.y)-40-(localIndex%3)*CLEARANCE),Math.max(a.y+a.height,b.y+b.height)+40+(localIndex%3)*CLEARANCE];
        const reservedY = flow.return ? localYs[1] : Math.max(...blocked.map(({ box }) => box.y + box.height)) + 32 + Math.max(0, corridorIndex) * CLEARANCE;
        // Reserve a distinct perimeter corridor for returns and distant information links.
        if (flow.return || (flow.type !== 'sequence' && Math.abs(s.x - t.x) + Math.abs(s.y - t.y) > 800)) {
          candidates.push(wrap([{ x: s.x, y: reservedY }, { x: t.x, y: reservedY }]));
        }
        const ys = [...new Set([(s.y + t.y) / 2, reservedY, topRoute, bottomRoute, s.y, t.y, ...blocked.flatMap(({ box }) => [box.y - CLEARANCE, box.y + box.height + CLEARANCE]), ...Object.values(edges).flatMap(route => route.flatMap(point => [point.y - CLEARANCE, point.y + CLEARANCE]))])].filter(y => y >= 0).sort((y, z) => Math.abs(y - (s.y + t.y) / 2) - Math.abs(z - (s.y + t.y) / 2)).slice(0, 28);
        candidates.push(wrap([{ x: t.x, y: s.y }])); candidates.push(wrap([{ x: s.x, y: t.y }]));
        for (const x of xs) candidates.push(wrap([{ x, y: s.y }, { x, y: t.y }]));
        for (const y of localYs) candidates.push(wrap([{ x: s.x, y }, { x: t.x, y }]));
        for (const y of ys) candidates.push(wrap([{ x: s.x, y }, { x: t.x, y }]));
      };
      addCorridors(sources[0], targets[0]);
      shiftedCorridors = () => {
        for (const [id,side,list] of [[flow.source,'source',sources],[flow.target,'target',targets]] as const) {
          const assignment=assignments.get(id);
          if (!assignedPorts.has(endpointKey(flow.id,side)) || !assignment) continue;
          const used=model.flows.filter(other=>other.id!==flow.id&&edges[other.id]).flatMap(other=>(['source','target'] as const).filter(s=>other[s]===id).map(s=>s==='source'?edges[other.id][0]:edges[other.id].at(-1)!));
          for(const port of assignment.variants.flat().filter((port):port is Port=>!!port)) if(!used.some(point=>equal(point,port.point))&&!list.some(other=>equal(other.point,port.point))) list.push(port);
        }
        if (!sourceAssignment && !isGateway(flow.source)) for (const port of attachmentPorts(a,b,start,!sourceType || sourceType === 'eventSubProcess' || TASK_TYPES.has(sourceType),false,80)) {
          if (!sources.some(other=>equal(other.point,port.point))) sources.push(port);
        }
        if (!targetAssignment && !isGateway(flow.target)) for (const port of attachmentPorts(b,a,end,!targetType || targetType === 'eventSubProcess' || TASK_TYPES.has(targetType),false,80)) {
          if (!targets.some(other=>equal(other.point,port.point))) targets.push(port);
        }
        const offset = (port: Port, box: Bounds) => port.dx ? Math.abs(port.point.y - box.y - box.height / 2) : Math.abs(port.point.x - box.x - box.width / 2);
        for (const source of sources.filter(port=>offset(port,a)<1e-9)) for(const target of targets.filter(port=>offset(port,b)<1e-9)) addCorridors(source,target);
        const pairs = sources.flatMap(source => targets.map(target => ({source, target, shift: offset(source, a) + offset(target, b), both: Number(offset(source,a)>1e-9&&offset(target,b)>1e-9)})))
          .filter(pair => pair.shift > 1e-9).sort((u,v) => u.both - v.both || u.shift - v.shift).slice(0,384);
        for (const {source, target} of pairs) addCorridors(source, target);
      };
      extraCorridors = () => {
        const centered = (port: Port, box: Bounds) => port.dx ? port.point.y === box.y + box.height / 2 : port.point.x === box.x + box.width / 2;
        for (const source of sources.filter(port => centered(port, a))) for (const target of targets.filter(port => centered(port, b))) {
          if (source !== sources[0] || target !== targets[0]) addCorridors(source, target);
        }
      };
      visibilityCandidates = () => {
        const blocked = routeObstacles.map(obstacle => ({ ...obstacle, box: expanded(obstacle.box, itemIds.has(obstacle.id) ? READABLE.shapeGap : READABLE.labelGap) }));
        const clip = (values: number[], lo: number, hi: number) => [...new Set(values)].filter(v => v >= 0).sort((u,v) => Math.min(Math.abs(u-lo),Math.abs(u-hi)) - Math.min(Math.abs(v-lo),Math.abs(v-hi)) || u-v).slice(0,90);
        const boundaries = [...blocked,...reservedApproaches.filter(reserved=>reserved.flow!==flow.id)];
        const xs = [...clip(boundaries.flatMap(({box}) => [box.x,box.x+box.width]).concat(Object.values(edges).flatMap(route => route.flatMap(p => [p.x-CLEARANCE,p.x+CLEARANCE]))),a.x,b.x),8,Math.max(...boundaries.map(({box})=>box.x+box.width))+CLEARANCE];
        const ys = [...clip(boundaries.flatMap(({box}) => [box.y,box.y+box.height]).concat(Object.values(edges).flatMap(route => route.flatMap(p => [p.y-CLEARANCE,p.y+CLEARANCE]))),a.y,b.y),8,Math.max(...boundaries.map(({box})=>box.y+box.height))+CLEARANCE];
        const rawSegmentCost = (from: Point, to: Point) => {
          if (reservedApproaches.some(reserved=>reserves(reserved,flow) && insideSegment(from,to,reserved.box))) return Infinity;
          for (const obstacle of routeConstraints(flow.id)) {
            if (obstacle.diamond ? insideDiamondSegment(from,to,obstacle.box) : insideSegment(from,to,obstacle.box)) return Infinity;
          }
          let crossings = 0;
          for (const [id,route] of Object.entries(edges)) for (let i = 1; i < route.length; i++) {
            if (parallelClearance(from,to,route[i-1],route[i],flow.id,id) < CLEARANCE-1e-9) return Infinity;
            const hit = interaction(from,to,route[i-1],route[i]);
            if (!hit) continue;
            if (hit.kind === 'overlap' || Math.min(Math.abs(hit.point.x-route[i-1].x)+Math.abs(hit.point.y-route[i-1].y),Math.abs(hit.point.x-route[i].x)+Math.abs(hit.point.y-route[i].y)) < 12) return Infinity;
            crossings++;
          }
          return Math.abs(from.x-to.x)+Math.abs(from.y-to.y)+crossings*READABLE.crossingCost;
        };
        const visibilityCosts=new Map<string,number>();
        const segmentCost=(from:Point,to:Point)=>{
          const points=from.x<to.x||from.x===to.x&&from.y<to.y?[from,to]:[to,from];
          const key=`${points[0].x}/${points[0].y}/${points[1].x}/${points[1].y}`;
          if(!visibilityCosts.has(key))visibilityCosts.set(key,rawSegmentCost(from,to));
          return visibilityCosts.get(key)!;
        };
        const centered = (port: Port, box: Bounds) => isVertex(port.point,box);
        const pairs = sources.flatMap(source => targets.map(target => ({source,target})))
          .sort((u,v) => Number(centered(v.source,a))+Number(centered(v.target,b))-Number(centered(u.source,a))-Number(centered(u.target,b))
            || Math.abs(u.source.point.x-u.target.point.x)+Math.abs(u.source.point.y-u.target.point.y)-Math.abs(v.source.point.x-v.target.point.x)-Math.abs(v.source.point.y-v.target.point.y)).slice(0,32);
        for (const {source,target} of pairs) {
          const s = outside(source), t = outside(target);
          if (!stubValid(source) || !stubValid(target)) continue;
          const middle = visibilityRoute(s,t,xs,ys,segmentCost,source,{dx:-target.dx,dy:-target.dy});
          if (middle) {
            const route = normalized([source.point,...middle,target.point]);
            candidates.push(route);
            if (!checkRoute(flow.id,route).errors.length && (!title || flow.labelBounds || placeLabel(flow.id,title,route))) break;
          }
        }
      };
    }
    // Participants and annotations may connect anywhere on their boundary;
    // the midpoint preference belongs to flow nodes.
    const endpointOffset = (point: Point, box: Bounds, id: string) => !nodeTypes.has(id) ? 0 : Math.min(
      Math.abs(point.x - box.x) + Math.abs(point.y - box.y - box.height / 2),
      Math.abs(point.x - box.x - box.width) + Math.abs(point.y - box.y - box.height / 2),
      Math.abs(point.x - box.x - box.width / 2) + Math.abs(point.y - box.y),
      Math.abs(point.x - box.x - box.width / 2) + Math.abs(point.y - box.y - box.height)
    );
    let chosen: Point[] | null = null, chosenLabel: Bounds | null = null, accepted: Geometry['crossings'] = [], nearest: Diagnostic[] = [];
    let bestScore = Infinity;
    // A single score compares crossings, port shifts, bends and length. The
    // cheap part is a lower bound, allowing the search to stop once a valid
    // zero-crossing route cannot be beaten by any remaining candidate.
    const lowerScore = (route: Point[]) => (route.length - 2) * READABLE.bendCost + routeLength(route)
      + ((isGateway(flow.source) ? 0 : endpointOffset(route[0], a, flow.source)) + (isGateway(flow.target) ? 0 : endpointOffset(route.at(-1)!, b, flow.target))) * READABLE.taskPortCost;
    const seenCandidates = new Set<string>();
    for (let attempt = 0; attempt < (flow.route ? 1 : 4); attempt++) {
      const ranked = candidates.map(route => flow.route ? route : normalized(route)).filter(route => route.length >= 2).map(route => ({ route, lower: lowerScore(route) }))
        .sort((u,v) => u.lower - v.lower || compareRoutes(u.route, v.route));
      let examinedAfterValid = 0;
      for (const { route, lower } of ranked) {
        if (lower >= bestScore) break;
        const key = JSON.stringify(route); if (seenCandidates.has(key)) continue; seenCandidates.add(key);
        if (chosen && examinedAfterValid++ >= (sortedFlows.length <= 20 ? 2048 : 96)) break;
        const result = checkRoute(flow.id, route);
        if (result.errors.length) { if (!nearest.length || result.errors.length < nearest.length) nearest = result.errors; continue; }
        const score = lower + result.crossings.length * READABLE.crossingCost;
        if (score >= bestScore) continue;
        const label = title ? flow.labelBounds ?? placeLabel(flow.id, title, route) : null;
        if (title && (!label || !labelClear(label, route,!!flow.labelBounds,flow.id))) { nearest = [{ code: 'LABEL_CLEARANCE', id: flow.id, point: route[0], message: 'No readable label position for flow', severity: 'error' }]; continue; }
        chosen = route; chosenLabel = label; accepted = result.crossings; bestScore = score;
      }
      if (attempt === 0 && extraCorridors && (!chosen || accepted.length || endpointOffset(chosen[0], a, flow.source) + endpointOffset(chosen.at(-1)!, b, flow.target) > 1e-9)) extraCorridors();
      else if (!chosen && attempt === 1 && shiftedCorridors) shiftedCorridors();
      else if (chosen && attempt === 1 && flow.type!=='sequence' && accepted.length>=4 && visibilityCandidates) visibilityCandidates();
      else if (!chosen && attempt === 2 && visibilityCandidates) visibilityCandidates();
      else if (chosen || flow.route) break;
    }
    const proposedRoutes = chosen ? [...Object.values(edges), chosen] : [];
    const proposedExtents = chosen ? extents(proposedRoutes,chosenLabel?[chosenLabel]:[]) : { width: Infinity, height: Infinity };
    const outsideBudget = pass > 0 && (proposedRoutes.reduce((sum, route) => sum + routeLength(route), 0) > firstLength * (1 + READABLE.lengthGrowth) + 1e-9
      || proposedExtents.width > firstWidth * (1 + READABLE.extentGrowth) + 1e-9 || proposedExtents.height > firstHeight * (1 + READABLE.extentGrowth) + 1e-9);
    const exceptions = (route: Point[]) => Number(isGateway(flow.source) && !isVertex(route[0], a)) + Number(isGateway(flow.target) && !isVertex(route.at(-1)!, b));
    if (previous && (!chosen || outsideBudget || exceptions(chosen) > exceptions(previous) || bestScore >= previousPenalty - 1e-9)) { searchedScores.set(flow.id,previousPenalty);edges[flow.id] = previous; if (previousLabel) labels[flow.id] = previousLabel; continue; }
    if (!chosen) { const unsatisfiable: Diagnostic = { code: 'ROUTE_UNSATISFIABLE', id: flow.id, relatedIds: [flow.source, flow.target], point: start, message: 'No collision-free orthogonal route exists; add a valid route hint or more grid space', severity: 'error' }; errors.push(...(flow.route ? nearest : [unsatisfiable])); continue; }
    edges[flow.id] = chosen; if (chosenLabel) labels[flow.id] = chosenLabel; improved = true;
    searchedScores.set(flow.id,bestScore);
    // A failed initial assignment can swap still-unused vertices within the
    // joint allocation; already routed/manual approaches remain occupied.
    for(const [side,point] of [['source',chosen[0]],['target',chosen.at(-1)!]] as const) {
      const key=endpointKey(flow.id,side),assigned=assignedPorts.get(key),id=flow[side];
      if(!assigned || equal(assigned.point,point))continue;
      const assignment=assignments.get(id)!;
      const replacement=assignment.variants.flat().find(port=>port&&equal(port.point,point));
      if(!replacement)continue;
      const swapped=assignment.keys.find(other=>other!==key&&assignedPorts.has(other)&&equal(assignedPorts.get(other)!.point,point));
      if(swapped)assignedPorts.set(swapped,assigned);
      assignedPorts.set(key,replacement);
    }
    reservedApproaches=approaches();
  }
  if (!improved || errors.length) break;
  }
  // Recompute bridges after the bounded improvement passes.
  const finalEdges = Object.entries(edges);
  for (let i = 0; i < finalEdges.length; i++) for (let j = i + 1; j < finalEdges.length; j++) {
    const [firstId, first] = finalEdges[i], [secondId, second] = finalEdges[j];
    for (let a = 1; a < first.length; a++) for (let b = 1; b < second.length; b++) {
      const hit = interaction(first[a-1], first[a], second[b-1], second[b]);
      if (hit?.kind === 'crossing') crossings.push({ flows: [firstId, secondId], point: hit.point, over: secondId });
    }
  }
  if (errors.length) throw new BpmnForgeError(1, 'Invalid layout hints', errors);
  if (!explicit && model.pools.length === 1 && !model.pools[0].bounds) {
    // A single-pool automatic diagram owns every route. Fit its frame after
    // routing instead of moving nodes away from their logical cells.
    const pool = shapes[model.pools[0].id];
    const points = Object.values(edges).flat();
    const content = [...items.map(item => shapes[item.id]), ...Object.values(labels)];
    const minX = Math.min(...points.map(point => point.x), ...content.map(box => box.x));
    const minY = Math.min(...points.map(point => point.y), ...content.map(box => box.y));
    const maxX = Math.max(...points.map(point => point.x), ...content.map(box => box.x + box.width));
    const maxY = Math.max(...points.map(point => point.y), ...content.map(box => box.y + box.height));
    const left = Math.max(0, Math.min(pool.x, Math.floor(minX / 20) * 20 - 20));
    const upper = Math.max(0, Math.min(pool.y, Math.floor(minY / 20) * 20 - 20));
    const right = Math.max(pool.x + pool.width, Math.ceil(maxX / 20) * 20 + 20);
    const lower = Math.max(pool.y + pool.height, Math.ceil(maxY / 20) * 20 + 20);
    Object.assign(pool, { x: left, y: upper, width: right - left, height: lower - upper });
    const partitions = orderedLanes(model,model.pools[0].process);
    for (const [index, lane] of partitions.entries()) {
      if (lane.bounds) continue;
      const box = shapes[lane.id], y = index === 0 ? upper : box.y;
      const bottom = index === partitions.length - 1 ? lower : box.y + box.height;
      Object.assign(box, { x: left + 30, y, width: right - left - 30, height: bottom - y });
    }
  }
  if (!explicit) {
    const bottom = Math.max(top, ...model.pools.map(pool => shapes[pool.id].y + shapes[pool.id].height));
    for (const stage of Object.values(stages)) stage.height = bottom - stage.y;
  }
  const routePoints = Object.values(edges).flat();
  const allBoxes = [...Object.values(shapes), ...Object.values(labels)];
  return { shapes, edges, labels, stages, crossings, viewport: { x: 0, y: 0, width: Math.max(width + 80, ...routePoints.map(point => point.x + 40), ...allBoxes.map(box => box.x + box.width + 40)), height: Math.max(top, ...routePoints.map(point => point.y + 40), ...allBoxes.map(box => box.y + box.height + 40)) } };
}
