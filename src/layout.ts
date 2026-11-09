import type { Geometry, ProcessDocument, Bounds, Point, Diagnostic } from './domain.ts';
import { BpmnForgeError } from './domain.ts';
const CLEARANCE = 14;
const TASK_TYPES = new Set(['task', 'userTask', 'serviceTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'callActivity']);
interface Port { point: Point; dx: number; dy: number }
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
    if (!ports.some(port => equal(port.point, point))) ports.push({ point, dx, dy });
  };
  if (preferred.x === box.x || preferred.x === box.x + box.width) add(preferred.x === box.x ? -1 : 1, 0, preferred.x, preferred.y);
  else add(0, preferred.y === box.y ? -1 : 1, preferred.x, preferred.y);
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    add(dx, dy, center.x, center.y);
    if (flexible) add(dx, dy, opposite.x + opposite.width / 2, opposite.y + opposite.height / 2);
    if (diamond) {
      add(dx, dy, center.x + spread, center.y + spread);
      add(dx, dy, opposite.x + opposite.width / 2, opposite.y + opposite.height / 2);
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
export function layoutProcess(model: ProcessDocument): Geometry {
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
  const sizes = new Map(items.map(item => {
    const annotation = 'text' in item, type = 'type' in item ? item.type : 'annotation';
    const size = annotation ? { width: 180, height: Math.max(70, Math.ceil(item.text.length / 22) * 18 + 24) }
      : TASK_TYPES.has(type) ? { width: 200, height: Math.max(80, Math.ceil((Math.ceil(item.name.length / 22) * 18 + 24) / 40) * 40) }
      : type === 'xor' || type === 'and' ? { width: 50, height: 50 } : { width: 36, height: 36 };
    return [item.id, size] as const;
  }));
  const labelHeight = (name: string) => Math.max(40, Math.ceil(name.length / 22) * 18);
  const gridCeil = (value: number) => Math.ceil(value / 20) * 20;
  for (const item of items) {
    const key = `${item.process}/${item.lane ?? ''}/${item.stage}/${item.row ?? 0}`;
    const column = item.column ?? counts.get(key) ?? 0, row = item.row ?? 0;
    const cell = `${key}/${column}`;
    const otherId = occupied.get(cell);
    if (otherId) cellConflicts.push({ id: item.id, otherId });
    else occupied.set(cell, item.id);
    counts.set(key, Math.max(counts.get(key) ?? 0, column + 1)); cells.set(item.id, { column, row });
  }
  let x = 110;
  for (const stage of model.stages) {
    const columns = Math.max(1, ...items.filter(item => item.stage === stage.id).map(item => cells.get(item.id)!.column + 1));
    stages[stage.id] = { x, y: 60, width: columns * 260, height: 0 }; x += columns * 260;
  }
  const width = x - 40 + 40; let top = 60;
  for (const process of model.processes) {
    const pool = model.pools.find(pool => pool.process === process.id)!; const poolTop = top;
    const lanes = model.lanes.filter(lane => lane.process === process.id);
    const partitions = lanes.length ? lanes : [{ id: '', process: process.id }];
    for (const lane of partitions) {
      const members = items.filter(item => item.process === process.id && (item.lane ?? '') === lane.id);
      const rows = Math.max(1, ...members.map(item => cells.get(item.id)!.row + 1));
      const rowCenters: number[] = [];
      let height = 0;
      for (let row = 0; row < rows; row++) {
        const rowMembers = members.filter(item => cells.get(item.id)!.row === row);
        const above = gridCeil(Math.max(20, ...rowMembers.map(item => sizes.get(item.id)!.height / 2)) + 40);
        const below = gridCeil(Math.max(20, ...rowMembers.map(item => {
          const size = sizes.get(item.id)!;
          if ('text' in item || TASK_TYPES.has(item.type)) return size.height / 2;
          return (isGateway(item.id) ? size.height / 2 + 20 : 38) + labelHeight(item.name);
        })) + 40);
        rowCenters.push(top + height + above);
        height += above + below;
      }
      if (lane.id) shapes[lane.id] = { x: 70, y: top, width: width - 30, height };
      for (const item of members) {
        const annotation = 'text' in item, type = 'type' in item ? item.type : 'annotation';
        const taskLike = TASK_TYPES.has(type);
        const size = sizes.get(item.id)!;
        if (size.height > 400) fail('LABEL_SIZE', item.id, 'Text annotation exceeds a grid cell; split the annotation');
        const cell = cells.get(item.id)!, centerY = rowCenters[cell.row];
        shapes[item.id] = { x: stages[item.stage].x + cell.column * 260 + (220 - size.width) / 2, y: centerY - size.height / 2, ...size };
        if (!annotation && !taskLike) {
          const box = shapes[item.id];
          // A centered caption blocks the bottom vertex when a gateway has
          // four connections. Keep the caption diagonally clear of every port.
          labels[item.id] = { x: isGateway(item.id) ? box.x + box.width + 20 : box.x + box.width / 2 - 90,
            y: isGateway(item.id) ? box.y + box.height + 20 : centerY + 38, width: 180, height: labelHeight(item.name) };
        }
      }
      top += height;
    }
    shapes[pool.id] = { x: 40, y: poolTop, width, height: top - poolTop }; top += 80;
  }
  const explicit = items.every(item => item.bounds) && model.pools.every(pool => pool.bounds) && model.lanes.every(lane => lane.bounds);
  if (explicit) {
    for (const item of items) {
      shapes[item.id] = { ...item.bounds! };
      if (item.labelBounds) labels[item.id] = { ...item.labelBounds };
      else delete labels[item.id];
    }
    for (const pool of model.pools) shapes[pool.id] = { ...pool.bounds! };
    for (const lane of model.lanes) shapes[lane.id] = { ...lane.bounds! };
    for (const stage of model.stages) {
      const boxes = model.nodes.filter(item => item.stage === stage.id).map(item => item.bounds!);
      if (!boxes.length) continue;
      const minX = Math.min(...boxes.map(box => box.x)), minY = Math.min(...boxes.map(box => box.y));
      stages[stage.id] = { x: Math.max(0, minX - 80), y: Math.max(0, minY - 100), width: Math.max(...boxes.map(box => box.x + box.width)) - minX + 160, height: Math.max(...boxes.map(box => box.y + box.height)) - minY + 200 };
    }
  }
  for (const conflict of cellConflicts) {
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
  for (const [id, label] of Object.entries(labels)) for (const [otherId, box] of shapeEntries) {
    if (model.nodes.some(node => node.id === id && node.parent === otherId)) continue;
    if (id !== otherId && boxOverlap(label, box)) errors.push({ code: 'LABEL_OVERLAP', id, relatedIds: [otherId], bounds: label, message: 'Label overlaps an element', severity: 'error' });
  }
  if (errors.length) throw new BpmnForgeError(1, 'Invalid layout', errors);
  const crossings: Geometry['crossings'] = [];
  const sortedFlows = [...model.flows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
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
  function checkRoute(id: string, route: Point[]): { errors: Diagnostic[]; crossings: Geometry['crossings'] } {
    const problems: Diagnostic[] = [], found: Geometry['crossings'] = [];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      if (a.x !== b.x && a.y !== b.y) { problems.push({ code: 'ROUTE_ORTHOGONAL', id, point: a, message: 'Route segment is not orthogonal', severity: 'error' }); continue; }
      if (equal(a, b)) { problems.push({ code: 'ROUTE_ZERO_LENGTH', id, point: a, message: 'Route segment has zero length', severity: 'error' }); continue; }
      if (i > 1) {
        const previous = route[i - 2];
        if ((a.x - previous.x) * (b.x - a.x) + (a.y - previous.y) * (b.y - a.y) < 0) problems.push({ code: 'ROUTE_SELF_INTERSECTION', id, point: a, message: 'Route doubles back on itself', severity: 'error' });
      }
      const flow = model.flows.find(item => item.id === id);
      for (const obstacle of obstacles()) {
        const parent = model.nodes.find(node => node.id === obstacle.id && node.type === 'eventSubProcess');
        if (parent && flow && [flow.source, flow.target].every(endpoint => model.nodes.some(node => node.id === endpoint && node.parent === parent.id))) continue;
        if (obstacle.diamond ? insideDiamondSegment(a, b, obstacle.box) : insideSegment(a, b, obstacle.box)) problems.push({ code: 'ROUTE_OBSTACLE', id, relatedIds: [obstacle.id], point: a.x === b.x ? { x: a.x, y: Math.max(Math.min(a.y, b.y), obstacle.box.y) } : { x: Math.max(Math.min(a.x, b.x), obstacle.box.x), y: a.y }, bounds: obstacle.box, message: `Route intersects ${obstacle.id}`, severity: 'error' });
      }
      for (const [otherId, otherRoute] of Object.entries(edges)) for (let j = 1; j < otherRoute.length; j++) {
        const contact = interaction(a, b, otherRoute[j - 1], otherRoute[j]); if (!contact) continue;
        if (contact.kind === 'crossing') found.push({ flows: [otherId, id], point: contact.point, over: id });
        else problems.push({ code: contact.kind === 'overlap' ? 'ROUTE_OVERLAP' : 'ROUTE_TOUCH', id, relatedIds: [otherId], point: contact.point, message: `Route ${contact.kind} with ${otherId}`, severity: 'error' });
      }
      for (let j = 1; j < i - 1; j++) {
        const contact = interaction(a, b, route[j - 1], route[j]);
        if (contact) problems.push({ code: 'ROUTE_SELF_INTERSECTION', id, point: contact.point, message: 'Route intersects itself', severity: 'error' });
      }
    }
    return { errors: problems, crossings: found };
  }
  function placeLabel(id: string, title: string, route: Point[]): Bounds | null {
    const width = Math.min(260, Math.max(110, Math.ceil(Math.min(title.length, 300) / 12) * 18));
    const height = Math.max(36, Math.ceil(title.length / Math.max(12, Math.floor(width / 9))) * 18);
    const candidates: Bounds[] = [];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      if (a.y === b.y) for (const offset of [-height - 10, 10]) candidates.push({ x: (a.x + b.x) / 2 - width / 2, y: a.y + offset, width, height });
      else for (const offset of [10, -width - 10]) candidates.push({ x: a.x + offset, y: (a.y + b.y) / 2 - height / 2, width, height });
    }
    return candidates.find(box => labelClear(box, route)) ?? null;
  }
  function labelClear(box: Bounds, route: Point[]): boolean {
    return box.x >= 0 && box.y >= 0 && obstacles().every(other => !boxOverlap(box, other.box)) && Object.values(edges).every(points => points.slice(1).every((end, i) => !insideSegment(points[i], end, box))) && route.slice(1).every((end, i) => !insideSegment(route[i], end, box));
  }
  for (const flow of sortedFlows) {
    const a = shapes[flow.source], b = shapes[flow.target];
    if (!a || !b) { fail('ROUTE_ENDPOINT', flow.id, 'No shape for connector endpoint'); continue; }
    const start = port(flow, 'source', a), end = port(flow, 'target', b);
    const title = flow.name ?? flow.condition ?? (model.nodes.some(node => node.defaultFlow === flow.id) ? 'Иначе' : '');
    const candidates: Point[][] = [];
    let extraCorridors: (() => void) | undefined;
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
      const sources = attachmentPorts(a, b, start, !sourceType || sourceType === 'eventSubProcess' || TASK_TYPES.has(sourceType), isGateway(flow.source), spread(flow.source, a));
      const targets = attachmentPorts(b, a, end, !targetType || targetType === 'eventSubProcess' || TASK_TYPES.has(targetType), isGateway(flow.target), spread(flow.target, b));
      if (!sources.length || !targets.length) { fail('ROUTE_UNSATISFIABLE', flow.id, 'Endpoint has no attachment side with sufficient corner clearance'); continue; }
      const outside = (port: Port): Point => ({ x: port.point.x + port.dx * 26, y: port.point.y + port.dy * 26 });
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
        const wrap = (middle: Point[]) => [source.point, s, ...middle, t, target.point];
        if (s.y === t.y || s.x === t.x) candidates.push(wrap([]));
        const blocked = obstacles();
        const xs = [...new Set([(s.x + t.x) / 2, s.x, t.x, ...blocked.flatMap(({ box }) => [box.x - CLEARANCE, box.x + box.width + CLEARANCE])])].filter(x => x >= 0).sort((x, y) => Math.abs(x - (s.x + t.x) / 2) - Math.abs(y - (s.x + t.x) / 2)).slice(0, 24);
        const topRoute = Math.max(8, Math.min(...blocked.map(({ box }) => box.y)) - 32 - Object.keys(edges).length * 16);
        const bottomRoute = Math.max(...blocked.map(({ box }) => box.y + box.height)) + 32 + Object.keys(edges).length * 16;
        const ys = [...new Set([(s.y + t.y) / 2, topRoute, bottomRoute, s.y, t.y, ...blocked.flatMap(({ box }) => [box.y - CLEARANCE, box.y + box.height + CLEARANCE])])].filter(y => y >= 0).sort((y, z) => Math.abs(y - (s.y + t.y) / 2) - Math.abs(z - (s.y + t.y) / 2)).slice(0, 28);
        candidates.push(wrap([{ x: t.x, y: s.y }])); candidates.push(wrap([{ x: s.x, y: t.y }]));
        for (const x of xs) candidates.push(wrap([{ x, y: s.y }, { x, y: t.y }]));
        for (const y of ys) candidates.push(wrap([{ x: s.x, y }, { x: t.x, y }]));
        const starts = [s.x, ...xs.filter(x => Math.abs(x - s.x) < 120)].slice(0, 6);
        const ends = [t.x, ...xs.filter(x => Math.abs(x - t.x) < 120)].slice(0, 6);
        for (const y of [topRoute, bottomRoute, ...ys]) for (const x1 of starts) for (const x2 of ends) candidates.push(wrap([{ x: x1, y: s.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: t.y }]));
      };
      addCorridors(sources[0], targets[0]);
      extraCorridors = () => {
        const centered = (port: Port, box: Bounds) => port.dx ? port.point.y === box.y + box.height / 2 : port.point.x === box.x + box.width / 2;
        for (const source of sources.filter(port => centered(port, a))) for (const target of targets.filter(port => centered(port, b))) {
          if (source !== sources[0] || target !== targets[0]) addCorridors(source, target);
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
    const shiftedEndpoints = (route: Point[]) => Number(endpointOffset(route[0], a, flow.source) > 1e-9) + Number(endpointOffset(route.at(-1)!, b, flow.target) > 1e-9);
    const totalOffset = (route: Point[]) => endpointOffset(route[0], a, flow.source) / Math.min(a.width, a.height) + endpointOffset(route.at(-1)!, b, flow.target) / Math.min(b.width, b.height);
    let chosen: Point[] | null = null, chosenLabel: Bounds | null = null, accepted: Geometry['crossings'] = [], nearest: Diagnostic[] = [];
    // Try centered simple routes and then centered detours before considering
    // shifted ports. A shorter corner attachment must not win prematurely.
    for (let attempt = 0; attempt < (flow.route ? 1 : 3); attempt++) {
      const sortedCandidates = (flow.route ? candidates : candidates.map(normalized)).filter(route => route.length >= 2)
        .filter(route => flow.route || (attempt < 2 ? shiftedEndpoints(route) === 0 : shiftedEndpoints(route) > 0)).sort((u, v) => {
          return (attempt === 2 ? shiftedEndpoints(u) - shiftedEndpoints(v) || totalOffset(u) - totalOffset(v) : 0)
            || u.length - v.length || routeLength(u) - routeLength(v);
        });
      for (const route of sortedCandidates) {
        const result = checkRoute(flow.id, route);
        if (result.errors.length) { if (!nearest.length || result.errors.length < nearest.length) nearest = result.errors; continue; }
        const label = title ? flow.labelBounds ?? placeLabel(flow.id, title, route) : null;
        if (title && (!label || !labelClear(label, route))) { nearest = [{ code: 'LABEL_CLEARANCE', id: flow.id, point: route[0], message: 'No readable label position for flow', severity: 'error' }]; continue; }
        chosen = route; chosenLabel = label; accepted = result.crossings; break;
      }
      if (chosen) break;
      if (attempt === 0 && extraCorridors) extraCorridors();
    }
    if (!chosen) { const unsatisfiable: Diagnostic = { code: 'ROUTE_UNSATISFIABLE', id: flow.id, relatedIds: [flow.source, flow.target], point: start, message: 'No collision-free orthogonal route exists; add a valid route hint or more grid space', severity: 'error' }; errors.push(...(flow.route ? nearest : [unsatisfiable])); continue; }
    edges[flow.id] = chosen; if (chosenLabel) labels[flow.id] = chosenLabel; crossings.push(...accepted);
  }
  if (errors.length) throw new BpmnForgeError(1, 'Invalid layout hints', errors);
  if (!explicit && model.pools.length === 1) {
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
    const partitions = model.lanes.filter(lane => lane.process === model.pools[0].process);
    for (const [index, lane] of partitions.entries()) {
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
  const allBoxes = Object.values(shapes);
  return { shapes, edges, labels, stages, crossings, viewport: { x: 0, y: 0, width: Math.max(width + 80, ...routePoints.map(point => point.x + 40), ...allBoxes.map(box => box.x + box.width + 40)), height: Math.max(top, ...routePoints.map(point => point.y + 40), ...allBoxes.map(box => box.y + box.height + 40)) } };
}
