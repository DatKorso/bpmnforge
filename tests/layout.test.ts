import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { layoutProcess } from '../src/layout.ts';
import { BpmnForgeError, type Bounds, type Flow, type Point, type ProcessDocument, type ProcessNode } from '../src/domain.ts';

function modelWith(nodes: { id: string; type?: ProcessNode['type']; bounds: Bounds; labelBounds?: Bounds }[], flows: Flow[]): ProcessDocument {
  return {
    version: 1, id: 'Routing', name: 'Routing', stages: [{ id: 'Stage', name: 'Stage' }],
    processes: [{ id: 'Work', name: 'Work' }],
    pools: [{ id: 'Pool', name: 'Pool', process: 'Work', bounds: { x: 0, y: 0, width: 1600, height: 1800 } }],
    lanes: [], nodes: nodes.map(node => ({ name: node.id, type: 'task', process: 'Work', stage: 'Stage', ...node })), flows
  };
}
const link = (id: string, source: string, target: string): Flow => ({ id, type: 'sequence', source, target });
function assertCentered(point: Point, box: Bounds) {
  assert.ok([
    { x: box.x, y: box.y + box.height / 2 }, { x: box.x + box.width, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y }, { x: box.x + box.width / 2, y: box.y + box.height }
  ].some(center => center.x === point.x && center.y === point.y), `Expected side midpoint, received ${JSON.stringify(point)}`);
}

test('shifted task prefers a centered gateway branch over a straight corner shortcut', () => {
  const model = modelWith([
    { id: 'Gateway', type: 'xor', bounds: { x: 560, y: 1308, width: 50, height: 50 } },
    { id: 'Hidden', bounds: { x: 550, y: 1465, width: 210, height: 90 } }
  ], [{ ...link('No', 'Gateway', 'Hidden'), name: 'Нет' }]);
  const geometry = layoutProcess(model);
  assert.deepEqual(geometry.edges.No, [{ x: 610, y: 1333 }, { x: 655, y: 1333 }, { x: 655, y: 1465 }]);
  assert.deepEqual(geometry.shapes.Hidden, model.nodes[1].bounds);
  assert.ok(geometry.labels.No, 'the centered route still has a readable branch label');
});

test('shifted tasks keep centered endpoints without moving either block', () => {
  const model = modelWith([
    { id: 'A', bounds: { x: 100, y: 100, width: 180, height: 80 } },
    { id: 'B', bounds: { x: 400, y: 120, width: 180, height: 100 } }
  ], [link('Across', 'A', 'B')]);
  const geometry = layoutProcess(model);
  assert.equal(geometry.edges.Across.length, 4);
  assertCentered(geometry.edges.Across[0], geometry.shapes.A);
  assertCentered(geometry.edges.Across.at(-1)!, geometry.shapes.B);
  assert.deepEqual(geometry.shapes.A, model.nodes[0].bounds);
  assert.deepEqual(geometry.shapes.B, model.nodes[1].bounds);
});

test('diagonal tasks connect with one bend and close facing tasks need no stub detour', () => {
  for (const target of [{ x: 400, y: 350, width: 180, height: 80 }, { x: 300, y: 100, width: 180, height: 80 }]) {
    const model = modelWith([
      { id: 'A', bounds: { x: 100, y: 100, width: 180, height: 80 } }, { id: 'B', bounds: target }
    ], [link('Across', 'A', 'B')]);
    assert.equal(layoutProcess(model).edges.Across.length, target.y === 100 ? 2 : 3);
  }
});

test('gateway branches use separate vertices with readable labels and stable routing', () => {
  const model = modelWith([
    { id: 'Gateway', type: 'xor', bounds: { x: 560, y: 1308, width: 50, height: 50 }, labelBounds: { x: 490, y: 1218, width: 190, height: 76 } },
    { id: 'Hidden', bounds: { x: 550, y: 1465, width: 210, height: 90 } },
    { id: 'Next', bounds: { x: 785, y: 1285, width: 190, height: 96 } }
  ], [{ ...link('No', 'Gateway', 'Hidden'), name: 'Нет' }, { ...link('Yes', 'Gateway', 'Next'), name: 'Да' }]);
  const geometry = layoutProcess(model);
  for (const flow of model.flows) {
    assertCentered(geometry.edges[flow.id][0], geometry.shapes[flow.source]);
    assertCentered(geometry.edges[flow.id].at(-1)!, geometry.shapes[flow.target]);
  }
  assert.notDeepEqual(geometry.edges.No[0], geometry.edges.Yes[0]);
  assert.ok(geometry.labels.No && geometry.labels.Yes);
  assert.deepEqual(layoutProcess(model), geometry);
  model.flows.reverse();
  assert.deepEqual(layoutProcess(model), geometry, 'flow input order does not affect routing');
});

test('automatic task attachments stay off rounded corners', () => {
  const model = modelWith([
    { id: 'A', type: 'xor', bounds: { x: 270, y: 100, width: 50, height: 50 } },
    { id: 'B', bounds: { x: 290, y: 300, width: 180, height: 80 } }
  ], [link('Down', 'A', 'B')]);
  const end = layoutProcess(model).edges.Down.at(-1)!;
  const box = model.nodes[1].bounds!;
  if (end.y === box.y || end.y === box.y + box.height) assert.ok(end.x >= box.x + 14 && end.x <= box.x + box.width - 14);
  else assert.ok(end.y >= box.y + 14 && end.y <= box.y + box.height - 14);
  assert.ok(layoutProcess(model).edges.Down.length > 2, 'the aligned x=295 is too close to the task corner');
});

test('direct routes still respect blocking shapes and flow labels', () => {
  const model = modelWith([
    { id: 'A', bounds: { x: 100, y: 100, width: 180, height: 80 } },
    { id: 'B', bounds: { x: 700, y: 100, width: 180, height: 80 } },
    { id: 'Obstacle', bounds: { x: 400, y: 70, width: 180, height: 140 } }
  ], [{ ...link('Across', 'A', 'B'), name: 'Обойти препятствие' }]);
  const geometry = layoutProcess(model);
  assert.ok(geometry.edges.Across.length >= 4);
  assertCentered(geometry.edges.Across[0], geometry.shapes.A);
  assertCentered(geometry.edges.Across.at(-1)!, geometry.shapes.B);
  assert.ok(geometry.labels.Across);
  assert.deepEqual(layoutProcess(model), geometry);
  model.flows[0].route = [{ x: 280, y: 140 }, { x: 700, y: 140 }];
  assert.throws(() => layoutProcess(model), error => error instanceof BpmnForgeError && error.diagnostics.some(item => item.code === 'ROUTE_OBSTACLE' && item.relatedIds?.includes('Obstacle')));
});

test('caller-provided stepped routes remain verbatim even when a straight route is possible', () => {
  const route = [{ x: 585, y: 1358 }, { x: 585, y: 1425 }, { x: 655, y: 1425 }, { x: 655, y: 1465 }];
  const model = modelWith([
    { id: 'Gateway', type: 'xor', bounds: { x: 560, y: 1308, width: 50, height: 50 } },
    { id: 'Hidden', bounds: { x: 550, y: 1465, width: 210, height: 90 } }
  ], [{ ...link('No', 'Gateway', 'Hidden'), route }]);
  assert.deepEqual(layoutProcess(model).edges.No, route);
});

test('parallel gateway links use distinct contour ports and a marked return keeps its corridor', () => {
  const model = modelWith([
    { id: 'A', type: 'xor', bounds: { x: 100, y: 100, width: 50, height: 50 } },
    { id: 'B', type: 'xor', bounds: { x: 500, y: 100, width: 50, height: 50 } }
  ], [link('Forward', 'A', 'B'), link('Parallel', 'A', 'B'), { ...link('Return', 'B', 'A'), return: true }]);
  const geometry = layoutProcess(model);
  assert.equal(geometry.edges.Forward.length, 2);
  assert.equal(geometry.edges.Parallel.length, 4, 'a centered detour takes priority over a straight sloped-side shortcut');
  assert.ok(geometry.edges.Return.length > 2);
  assert.notDeepEqual(geometry.edges.Forward[0], geometry.edges.Parallel[0]);
  for (const flow of model.flows) {
    assertCentered(geometry.edges[flow.id][0], geometry.shapes[flow.source]);
    assertCentered(geometry.edges[flow.id].at(-1)!, geometry.shapes[flow.target]);
  }
  assert.deepEqual(layoutProcess(model), geometry);
});

test('task receives two centered inputs and keeps a centered output', () => {
  const model = modelWith([
    { id: 'Send', type: 'xor', bounds: { x: 200, y: 100, width: 50, height: 50 } },
    { id: 'Poll', type: 'xor', bounds: { x: 500, y: 700, width: 50, height: 50 } },
    { id: 'Unknown', bounds: { x: 800, y: 400, width: 200, height: 80 } },
    { id: 'End', type: 'end', bounds: { x: 1200, y: 422, width: 36, height: 36 } }
  ], [link('FromSend', 'Send', 'Unknown'), link('FromPoll', 'Poll', 'Unknown'), link('ToEnd', 'Unknown', 'End')]);
  const geometry = layoutProcess(model);
  const ports = [geometry.edges.FromSend.at(-1)!, geometry.edges.FromPoll.at(-1)!, geometry.edges.ToEnd[0]];
  ports.forEach(point => assertCentered(point, geometry.shapes.Unknown));
  assert.equal(new Set(ports.map(point => `${point.x},${point.y}`)).size, 3);
  assert.deepEqual(geometry.shapes.Unknown, model.nodes[2].bounds);
  assert.deepEqual(layoutProcess(model), geometry);
});

test('a crowded task falls back to distinct ports with corner clearance after its midpoints are occupied', () => {
  const model = modelWith([
    { id: 'Task', bounds: { x: 400, y: 500, width: 200, height: 80 } },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `Choice${i}`, bounds: { x: 850, y: 100 + i * 220, width: 180, height: 80 } }))
  ], Array.from({ length: 5 }, (_, i) => link(`Select${i}`, 'Task', `Choice${i}`)));
  const geometry = layoutProcess(model);
  const points = model.flows.map(flow => geometry.edges[flow.id][0]);
  assert.equal(new Set(points.map(point => `${point.x},${point.y}`)).size, 5);
  for (const point of points) {
    if (point.x === 400 || point.x === 600) assert.ok(point.y >= 514 && point.y <= 566);
    else {
      assert.ok(point.y === 500 || point.y === 580);
      assert.ok(point.x >= 414 && point.x <= 586);
    }
  }
  assert.deepEqual(layoutProcess(model), geometry);
});

test('a route that doubles back is rejected instead of being normalized into a valid hint', () => {
  const model = modelWith([
    { id: 'A', bounds: { x: 100, y: 100, width: 180, height: 80 } },
    { id: 'B', bounds: { x: 700, y: 100, width: 180, height: 80 } }
  ], [{ ...link('Across', 'A', 'B'), route: [{ x: 280, y: 140 }, { x: 500, y: 140 }, { x: 400, y: 140 }, { x: 700, y: 140 }] }]);
  assert.throws(() => layoutProcess(model), error => error instanceof BpmnForgeError && error.diagnostics.some(item => item.code === 'ROUTE_SELF_INTERSECTION'));
});

test('too-small automatic endpoints report insufficient attachment clearance with the flow ID', () => {
  const model = modelWith([
    { id: 'A', bounds: { x: 100, y: 100, width: 20, height: 20 } },
    { id: 'B', bounds: { x: 400, y: 100, width: 180, height: 80 } }
  ], [link('Across', 'A', 'B')]);
  assert.throws(() => layoutProcess(model), error => error instanceof BpmnForgeError && error.diagnostics.some(item => item.code === 'ROUTE_UNSATISFIABLE' && item.id === 'Across'));
});

// Reproduces the branching, lanes and participant links from the original browser fixture.
const simple = JSON.parse(await readFile(new URL('./fixtures/minimal.json', import.meta.url), 'utf8')) as ProcessDocument;
function fullProfile(): ProcessDocument {
  const model = structuredClone(simple); model.id = 'FullProfile';
  model.stages.push({ id: 'Delivery', name: 'Результат' }); model.lanes.push({ id: 'Reviewer', name: 'Проверяющий', process: 'Work' });
  model.processes.push({ id: 'External', name: 'Внешний процесс' }); model.pools.push({ id: 'Partner', name: 'Партнёр', process: 'External' });
  model.nodes = [model.nodes[0], model.nodes[1],
    { id: 'Decision', name: 'Достаточно данных?', type: 'xor', defaultFlow: 'Skip', process: 'Work', lane: 'Agent', stage: 'Review' },
    { id: 'Fork', name: 'Параллельная проверка', type: 'and', process: 'Work', lane: 'Agent', stage: 'Delivery' },
    { id: 'A', name: 'Проверить документ', type: 'task', process: 'Work', lane: 'Agent', stage: 'Delivery' },
    { id: 'B', name: 'Проверить подпись', type: 'task', process: 'Work', lane: 'Reviewer', stage: 'Delivery', column: 1 },
    { id: 'Join', name: 'Проверки завершены', type: 'and', process: 'Work', lane: 'Agent', stage: 'Delivery' },
    { ...model.nodes[2], stage: 'Delivery' },
    { id: 'PartnerStart', name: 'Запрос получен', type: 'start', process: 'External', stage: 'Review' },
    { id: 'PartnerTask', name: 'Обработать запрос', type: 'task', process: 'External', stage: 'Review' },
    { id: 'PartnerEnd', name: 'Ответ готов', type: 'end', process: 'External', stage: 'Review' }
  ];
  model.annotations = [{ id: 'Note', name: 'Примечание', text: 'Проверка обязательна', process: 'Work', lane: 'Agent', stage: 'Review', row: 1 }];
  model.flows = [
    { id: 'ToCheck', type: 'sequence', source: 'Start', target: 'Check' }, { id: 'ToDecision', type: 'sequence', source: 'Check', target: 'Decision' },
    { id: 'Proceed', name: 'Да', type: 'sequence', source: 'Decision', target: 'Fork', condition: 'Данных достаточно' },
    { id: 'Skip', type: 'sequence', source: 'Decision', target: 'End' },
    { id: 'ToA', type: 'sequence', source: 'Fork', target: 'A' }, { id: 'ToB', type: 'sequence', source: 'Fork', target: 'B' },
    { id: 'FromA', type: 'sequence', source: 'A', target: 'Join' }, { id: 'FromB', type: 'sequence', source: 'B', target: 'Join' },
    { id: 'ToEnd', type: 'sequence', source: 'Join', target: 'End' },
    { id: 'PartnerFlow', type: 'sequence', source: 'PartnerStart', target: 'PartnerTask' }, { id: 'PartnerDone', type: 'sequence', source: 'PartnerTask', target: 'PartnerEnd' },
    { id: 'Request', name: 'Запрос', type: 'message', source: 'Check', target: 'Partner' },
    { id: 'Response', name: 'Ответ', type: 'message', source: 'PartnerTask', target: 'Check' },
    { id: 'AnnotationLink', type: 'association', source: 'Note', target: 'Check' }
  ];
  return model;
}

test('branch bypass searches alternative attachment corridors when the preferred gateway vertex is occupied', () => {
  const model = fullProfile();
  const geometry = layoutProcess(model);
  assert.equal(Object.keys(geometry.edges).length, model.flows.length);
  assert.ok(geometry.edges.Skip.length > 2);
  assert.notDeepEqual(geometry.edges.Proceed[0], geometry.edges.Skip[0]);
  assert.deepEqual(layoutProcess(model), geometry);
});

test('explicit gateway endpoints must touch the diamond contour rather than its bounding rectangle', () => {
  const model = modelWith([
    { id: 'Gateway', type: 'xor', bounds: { x: 100, y: 100, width: 100, height: 80 } },
    { id: 'Task', bounds: { x: 450, y: 100, width: 180, height: 100 } }
  ], [{ ...link('Branch', 'Gateway', 'Task'), route: [{ x: 200, y: 120 }, { x: 450, y: 120 }] }]);
  assert.throws(() => layoutProcess(model), error => error instanceof BpmnForgeError && error.diagnostics.some(item => item.code === 'ROUTE_GATEWAY_PORT' && item.id === 'Branch' && item.relatedIds?.includes('Gateway')));
  const route = [{ x: 175, y: 120 }, { x: 450, y: 120 }];
  model.flows[0].route = route;
  assert.deepEqual(layoutProcess(model).edges.Branch, route, 'a sloped-side attachment is a valid explicit route');
});

test('diamond obstacle checks reject a line through the actual shape interior', () => {
  const model = modelWith([
    { id: 'A', bounds: { x: 100, y: 100, width: 180, height: 80 } },
    { id: 'B', bounds: { x: 700, y: 100, width: 180, height: 80 } },
    { id: 'Gateway', type: 'xor', bounds: { x: 400, y: 90, width: 100, height: 100 } }
  ], [{ ...link('Across', 'A', 'B'), route: [{ x: 280, y: 140 }, { x: 700, y: 140 }] }]);
  assert.throws(() => layoutProcess(model), error => error instanceof BpmnForgeError && error.diagnostics.some(item => item.code === 'ROUTE_OBSTACLE' && item.relatedIds?.includes('Gateway')));
});

test('five outgoing choices and an incoming link keep one gateway with distinct contour attachments', () => {
  const model = modelWith([
    { id: 'Input', bounds: { x: 100, y: 500, width: 180, height: 80 } },
    { id: 'Gateway', type: 'xor', bounds: { x: 400, y: 492, width: 96, height: 96 } },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `Choice${i}`, bounds: { x: 800, y: 100 + i * 220, width: 180, height: 80 } }))
  ], [link('Before', 'Input', 'Gateway'), ...Array.from({ length: 5 }, (_, i) => ({ ...link(`Select${i}`, 'Gateway', `Choice${i}`), name: `Вариант ${i + 1}` }))]);
  const geometry = layoutProcess(model);
  assert.equal(Object.keys(geometry.edges).length, 6);
  const points = model.flows.map(flow => flow.source === 'Gateway' ? geometry.edges[flow.id][0] : geometry.edges[flow.id].at(-1)!);
  assert.equal(new Set(points.map(point => JSON.stringify(point))).size, 6);
  for (const point of points) assert.ok(Math.abs(Math.abs((point.x - 448) / 48) + Math.abs((point.y - 540) / 48) - 1) < 1e-9);
  assert.equal(model.nodes.filter(node => node.type === 'xor').length, 1);
  assert.deepEqual(layoutProcess(model), geometry);
});

test('automatic cell centers align with the 20-unit coordinate grid across lanes and rows', async () => {
  const model = JSON.parse(await readFile(new URL('./fixtures/minimal.json', import.meta.url), 'utf8')) as ProcessDocument;
  model.lanes.push({ id: 'Reviewer', name: 'Reviewer', process: 'Work' });
  model.nodes.push(
    { id: 'Choice', name: 'Choice', type: 'xor', process: 'Work', lane: 'Reviewer', stage: 'Review', column: 0 },
    { id: 'Wait', name: 'Wait', type: 'timerCatch', timer: { kind: 'timeCycle', expression: 'P1D' }, process: 'Work', lane: 'Reviewer', stage: 'Review', column: 1, row: 1 },
    { id: 'Other', name: 'Other', type: 'task', process: 'Work', lane: 'Reviewer', stage: 'Review', column: 2, row: 1 }
  );
  const geometry = layoutProcess(model);
  for (const node of model.nodes) {
    const box = geometry.shapes[node.id];
    assert.equal((box.x + box.width / 2) % 20, 0, `${node.id} horizontal center`);
    assert.equal((box.y + box.height / 2) % 20, 0, `${node.id} vertical center`);
    if (node.type === 'task') {
      for (const edge of [box.x, box.y, box.x + box.width, box.y + box.height]) assert.equal(edge % 20, 0, 'task borders align with grid lines');
    }
  }
});

test('automatic rows fit their blocks and captions instead of reserving 540 units each', () => {
  const model: ProcessDocument = {
    version: 1, id: 'Compact', name: 'Compact', stages: [{ id: 'Stage', name: 'Stage' }],
    processes: [{ id: 'Work', name: 'Work' }], pools: [{ id: 'Pool', name: 'Pool', process: 'Work' }],
    lanes: [{ id: 'Lane', name: 'Lane', process: 'Work' }],
    nodes: [
      { id: 'Task', name: 'Короткая задача', type: 'task', process: 'Work', lane: 'Lane', stage: 'Stage', row: 0, column: 0 },
      { id: 'Tall', name: 'Подробная проверка параметров '.repeat(5), type: 'task', process: 'Work', lane: 'Lane', stage: 'Stage', row: 1, column: 0 },
      { id: 'Gateway', name: 'Достаточно данных для продолжения обработки?', type: 'xor', process: 'Work', lane: 'Lane', stage: 'Stage', row: 0, column: 1 }
    ], flows: []
  };
  const g = layoutProcess(model), lane = g.shapes.Lane;
  assert.ok(lane.height <= 500, 'two rows use their measured content, not 1080 units');
  const first = g.shapes.Task, tall = g.shapes.Tall, caption = g.labels.Gateway;
  assert.ok(tall.height > first.height, 'the fixture includes a taller task');
  assert.ok(tall.y >= Math.max(first.y + first.height, caption.y + caption.height) + 40);
  for (const node of model.nodes) {
    const box = g.shapes[node.id];
    assert.ok(box.y >= lane.y + 40 && box.y + box.height <= lane.y + lane.height - 40);
    assert.equal((box.y + box.height / 2) % 20, 0);
  }
  assert.ok(caption.y + caption.height <= lane.y + lane.height - 40);
});

test('polling loop with four gateway connections uses four vertices and its caption leaves the approaches free', () => {
  const model: ProcessDocument = {
    version: 1, id: 'Polling', name: 'Polling', stages: [{ id: 'Stage', name: 'Stage' }],
    processes: [{ id: 'Work', name: 'Work' }], pools: [{ id: 'Pool', name: 'Pool', process: 'Work' }],
    lanes: [{ id: 'Operator', name: 'Operator', process: 'Work' }, { id: 'Worker', name: 'Worker', process: 'Work' }],
    nodes: [
      { id: 'Poll', name: 'Ожидать результат задачи', type: 'receiveTask', process: 'Work', lane: 'Worker', stage: 'Stage', column: 0 },
      { id: 'Gateway', name: 'Результат обработки?', type: 'xor', process: 'Work', lane: 'Worker', stage: 'Stage', column: 1 },
      { id: 'Created', name: 'Показать заявки и ошибки', type: 'task', process: 'Work', lane: 'Operator', stage: 'Stage', column: 2 },
      { id: 'Unknown', name: 'Ошибка или неизвестный итог', type: 'task', process: 'Work', lane: 'Operator', stage: 'Stage', column: 2, row: 1 }
    ], flows: [
      { ...link('A_WaitAgain', 'Gateway', 'Poll'), return: true, condition: 'Обработка продолжается' },
      { ...link('B_Result', 'Gateway', 'Created'), condition: 'Результат получен' },
      { ...link('C_Error', 'Gateway', 'Unknown'), condition: 'Ошибка или нет результата' },
      link('Z_Probe', 'Poll', 'Gateway')
    ]
  };
  const g = layoutProcess(model), box = g.shapes.Gateway, caption = g.labels.Gateway;
  const points = model.flows.map(flow => g.edges[flow.id][flow.source === 'Gateway' ? 0 : g.edges[flow.id].length - 1]);
  points.forEach(point => assertCentered(point, box));
  assert.equal(new Set(points.map(point => `${point.x},${point.y}`)).size, 4);
  assert.ok(caption.x > box.x + box.width && caption.y > box.y + box.height, 'caption clears bottom and right approaches');
  assert.deepEqual(layoutProcess(model), g);
});

test('single-pool automatic frame contains a return corridor without moving its nodes or route', async () => {
  const model = JSON.parse(await readFile(new URL('./fixtures/minimal.json', import.meta.url), 'utf8')) as ProcessDocument;
  model.nodes.find(node => node.id === 'End')!.column = 3;
  model.nodes.push({ id: 'Second', name: 'Second', type: 'task', process: 'Work', lane: 'Agent', stage: 'Review', column: 2 });
  model.flows = [link('ToCheck', 'Start', 'Check'), link('Next', 'Check', 'Second'), link('ToEnd', 'Second', 'End')];
  const initial = layoutProcess(model), a = initial.shapes.Second, b = initial.shapes.Check;
  const lower = initial.shapes.Team.y + initial.shapes.Team.height + 200;
  const route = [
    { x: a.x + a.width / 2, y: a.y + a.height }, { x: a.x + a.width / 2, y: lower },
    { x: b.x + b.width / 2, y: lower }, { x: b.x + b.width / 2, y: b.y + b.height }
  ];
  model.flows.push({ ...link('Return', 'Second', 'Check'), return: true, route });
  const geometry = layoutProcess(model), pool = geometry.shapes.Team;
  for (const points of Object.values(geometry.edges)) for (const point of points) {
    assert.ok(point.x >= pool.x && point.x <= pool.x + pool.width && point.y >= pool.y && point.y <= pool.y + pool.height, 'route stays inside its frame');
  }
  for (const node of model.nodes) assert.deepEqual(geometry.shapes[node.id], initial.shapes[node.id], 'frame fitting does not change automatic node placement');
  assert.deepEqual(geometry.edges.Return, route);
  const lane = geometry.shapes.Agent;
  assert.equal(lane.y + lane.height, pool.y + pool.height);
  assert.ok(geometry.stages.Review.y + geometry.stages.Review.height >= pool.y + pool.height);
});

test('explicit pool bounds remain author-controlled even when a supplied route leaves them', () => {
  const model = modelWith([
    { id: 'A', bounds: { x: 100, y: 100, width: 180, height: 80 } },
    { id: 'B', bounds: { x: 400, y: 100, width: 180, height: 80 } }
  ], [{ ...link('Return', 'B', 'A'), return: true, route: [{ x: 490, y: 180 }, { x: 490, y: 2200 }, { x: 190, y: 2200 }, { x: 190, y: 180 }] }]);
  assert.deepEqual(layoutProcess(model).shapes.Pool, model.pools[0].bounds);
});
