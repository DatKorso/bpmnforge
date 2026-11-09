import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BpmnModdle } from 'bpmn-moddle';
import { validateProcess } from '../src/validate.ts';
import { exportBpmn } from '../src/bpmn.ts';
import { BplmError, type Geometry } from '../src/domain.ts';

const bin = resolve('bin/bplm.mjs');
const cli = (args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
const source = () => ({
  version: 1, id: 'Profile', name: 'Проверка',
  stages: [{ id: 'Stage', name: 'Этап' }],
  processes: [{ id: 'Process', name: 'Работа' }],
  pools: [{ id: 'Pool', name: 'Команда', process: 'Process' }],
  lanes: [{ id: 'Lane', name: 'Исполнитель', process: 'Process' }],
  nodes: [
    { id: 'Start', type: 'start', name: 'Начало', process: 'Process', lane: 'Lane', stage: 'Stage' },
    { id: 'Work', type: 'userTask', name: 'Тестовый шаг', description: 'Описание тестового шага', process: 'Process', lane: 'Lane', stage: 'Stage' },
    { id: 'End', type: 'end', name: 'Готово', process: 'Process', lane: 'Lane', stage: 'Stage' }
  ],
  flows: [{ id: 'ToWork', type: 'sequence', source: 'Start', target: 'Work' }, { id: 'ToEnd', type: 'sequence', source: 'Work', target: 'End' }]
});

const extendedSource = (): any => {
  const input: any = source();
  input.processes.push({ id: 'Process_Shared', name: 'Общий процесс' });
  input.pools.push({ id: 'Pool_Shared', name: 'Второй участник', process: 'Process_Shared' });
  input.nodes = [
    input.nodes[0],
    ...['userTask', 'serviceTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'callActivity', 'callActivity', 'callActivity'].map((type, i) => ({ id: `Work_${i}`, type, name: type, description: `Описание ${type}`, process: 'Process', lane: 'Lane', stage: 'Stage', ...(type === 'callActivity' ? { calledElement: 'Process_Shared' } : {}) })),
    input.nodes[2],
    { id: 'Ready_Start', type: 'start', name: 'Начало', process: 'Process_Shared', stage: 'Stage' },
    { id: 'Ready_End', type: 'end', name: 'Готово', process: 'Process_Shared', stage: 'Stage' }
  ];
  input.flows = input.nodes.slice(0, 10).slice(1).map((node: any, i: number) => ({ id: `Flow_${i}`, type: 'sequence', source: input.nodes[i].id, target: node.id }));
  input.flows.push({ id: 'Ready_Flow', type: 'sequence', source: 'Ready_Start', target: 'Ready_End' });
  return input;
};

const geometryFor = (input: any): Geometry => ({
  shapes: Object.fromEntries([...input.pools, ...input.lanes, ...input.nodes].map((item: any, i: number) => [item.id, { x: 50 + i * 220, y: 100, width: 180, height: 80 }])),
  edges: Object.fromEntries(input.flows.map((item: any, i: number) => [item.id, [{ x: 100 + i * 220, y: 140 }, { x: 200 + i * 220, y: 140 }]])),
  labels: {}, stages: {}, crossings: [], viewport: { x: 0, y: 0, width: 4000, height: 500 }
});

async function rejects(input: any, code: string, id: string) {
  await assert.rejects(validateProcess(input, { htmlPath: '/tmp/bplm-profile.html' }), error => error instanceof BplmError && error.diagnostics.some(item => item.code === code && item.id === id));
}

test('specialized tasks and three calls share one local shared process', async () => {
  const input = extendedSource();
  const result = await validateProcess(input, { htmlPath: '/tmp/bplm-profile.html' }).catch(error => error);
  assert.ok(!(result instanceof Error), result.diagnostics?.map((item: any) => `${item.code} [${item.id}]`).join(', '));
  const { model } = result;
  const xml = await exportBpmn(model, geometryFor(input));
  const { rootElement, warnings } = await new BpmnModdle().fromXML(xml);
  assert.deepEqual(warnings, []);
  assert.equal(rootElement.rootElements.filter((item: any) => item.id === 'Process_Shared').length, 1);
  const main = rootElement.rootElements.find((item: any) => item.id === 'Process');
  for (const [id, expected] of [['Work_0', 'UserTask'], ['Work_1', 'ServiceTask'], ['Work_2', 'SendTask'], ['Work_3', 'ReceiveTask'], ['Work_4', 'BusinessRuleTask']]) {
    const task = main.flowElements.find((item: any) => item.id === id);
    assert.equal(task.$type, `bpmn:${expected}`);
    assert.ok(task.documentation[0].text.startsWith('Описание'));
  }
  for (const id of ['Work_5', 'Work_6', 'Work_7']) {
    const call = main.flowElements.find((item: any) => item.id === id);
    assert.equal(call.$type, 'bpmn:CallActivity');
    assert.equal(call.calledElement, 'Process_Shared');
    assert.ok(call.incoming.length && call.outgoing.length);
    assert.ok(rootElement.diagrams[0].plane.planeElement.some((item: any) => item.bpmnElement?.id === id));
  }
});

test('invalid local call targets and cycles report call IDs', async () => {
  const input = extendedSource();
  input.nodes.find((item: any) => item.id === 'Work_5').calledElement = 'Missing';
  await rejects(input, 'CALL_TARGET', 'Work_5');
  input.nodes.find((item: any) => item.id === 'Work_5').calledElement = 'Process';
  await rejects(input, 'CALL_CYCLE', 'Work_5');
  input.nodes.find((item: any) => item.id === 'Work_5').calledElement = 'Process_Shared';
  input.nodes.splice(-1, 0, { id: 'Ready_Call', type: 'callActivity', name: 'Повтор', process: 'Process_Shared', stage: 'Stage', calledElement: 'Process' });
  input.flows.pop();
  input.flows.push({ id: 'Ready_1', type: 'sequence', source: 'Ready_Start', target: 'Ready_Call' }, { id: 'Ready_2', type: 'sequence', source: 'Ready_Call', target: 'Ready_End' });
  await rejects(input, 'CALL_CYCLE', 'Ready_Call');
  input.nodes.find((item: any) => item.id === 'Ready_Call').calledElement = 'Process_Shared';
  await rejects(input, 'CALL_CYCLE', 'Ready_Call');
});

const eventSource = (): any => {
  const input: any = source();
  input.nodes.splice(1, 0,
    { id: 'Timer', type: 'timerCatch', name: 'Ожидать', process: 'Process', lane: 'Lane', stage: 'Stage', timer: { kind: 'timeDuration', expression: 'PT24H' } });
  input.nodes.push(
    { id: 'Event_Sub', type: 'eventSubProcess', name: 'Сигнал', process: 'Process', lane: 'Lane', stage: 'Stage' },
    { id: 'Event_Start', type: 'conditionalStart', name: 'Сигнал', process: 'Process', lane: 'Lane', stage: 'Stage', parent: 'Event_Sub', condition: 'syntheticFlag' },
    { id: 'Event_Work', type: 'userTask', name: 'Уведомить', process: 'Process', lane: 'Lane', stage: 'Stage', parent: 'Event_Sub' },
    { id: 'Event_End', type: 'terminateEnd', name: 'Прекратить', process: 'Process', lane: 'Lane', stage: 'Stage', parent: 'Event_Sub' }
  );
  input.flows = [
    { id: 'ToTimer', type: 'sequence', source: 'Start', target: 'Timer' },
    { id: 'ToWork', type: 'sequence', source: 'Timer', target: 'Work' },
    { id: 'ToEnd', type: 'sequence', source: 'Work', target: 'End' },
    { id: 'Event_1', type: 'sequence', source: 'Event_Start', target: 'Event_Work' },
    { id: 'Event_2', type: 'sequence', source: 'Event_Work', target: 'Event_End' }
  ];
  return input;
};

test('timer and one-level event subprocess round-trip with owned flows and DI', async () => {
  const input = eventSource();
  const result = await validateProcess(input, { htmlPath: '/tmp/bplm-profile.html' }).catch(error => error);
  assert.ok(!(result instanceof Error), result.diagnostics?.map((item: any) => `${item.code} [${item.id}]`).join(', '));
  const xml = await exportBpmn(result.model, geometryFor(input));
  const { rootElement, warnings } = await new BpmnModdle().fromXML(xml);
  assert.deepEqual(warnings, []);
  const process = rootElement.rootElements.find((item: any) => item.id === 'Process');
  const timer = process.flowElements.find((item: any) => item.id === 'Timer');
  assert.equal(timer.$type, 'bpmn:IntermediateCatchEvent');
  assert.equal(timer.eventDefinitions[0].$type, 'bpmn:TimerEventDefinition');
  assert.equal(timer.eventDefinitions[0].timeDuration.body, 'PT24H');
  const sub = process.flowElements.find((item: any) => item.id === 'Event_Sub');
  assert.equal(sub.$type, 'bpmn:SubProcess'); assert.equal(sub.triggeredByEvent, true);
  assert.ok(!process.flowElements.some((item: any) => item.id === 'Event_Start' || item.id === 'Event_1'));
  const child = sub.flowElements.find((item: any) => item.id === 'Event_Start');
  assert.equal(child.eventDefinitions[0].$type, 'bpmn:ConditionalEventDefinition');
  assert.equal(child.eventDefinitions[0].condition.body, 'syntheticFlag');
  assert.equal(sub.flowElements.find((item: any) => item.id === 'Event_End').eventDefinitions[0].$type, 'bpmn:TerminateEventDefinition');
  assert.equal(sub.flowElements.find((item: any) => item.id === 'Event_1').$type, 'bpmn:SequenceFlow');
  for (const id of ['Timer', 'Event_Sub', 'Event_Start', 'Event_Work', 'Event_End', 'Event_1']) {
    assert.ok(rootElement.diagrams[0].plane.planeElement.some((item: any) => item.bpmnElement?.id === id));
  }
});

test('invalid event definitions, containment and nesting report IDs', async () => {
  const input = eventSource();
  input.nodes.find((item: any) => item.id === 'Timer').timer.expression = ' ';
  await rejects(input, 'EVENT_DEFINITION', 'Timer');
  input.nodes.find((item: any) => item.id === 'Timer').timer.expression = 'PT24H';
  input.nodes.find((item: any) => item.id === 'Event_Start').condition = ' ';
  await rejects(input, 'EVENT_DEFINITION', 'Event_Start');
  input.nodes.find((item: any) => item.id === 'Event_Start').condition = 'syntheticFlag';
  input.flows.push({ id: 'Cross', type: 'sequence', source: 'Timer', target: 'Event_End' });
  await rejects(input, 'SEQUENCE_CONTAINER', 'Cross'); input.flows.pop();
  input.nodes.find((item: any) => item.id === 'Event_Work').parent = 'Missing';
  await rejects(input, 'CONTAINMENT', 'Event_Work');
  input.nodes.find((item: any) => item.id === 'Event_Work').parent = 'Event_Sub';
  input.nodes.push({ id: 'Nested_Sub', type: 'eventSubProcess', name: 'Вложенный', process: 'Process', lane: 'Lane', stage: 'Stage', parent: 'Event_Sub' });
  await rejects(input, 'EVENT_NESTING', 'Nested_Sub');
  input.nodes.pop();
  input.flows.push({ id: 'Sub_Flow', type: 'sequence', source: 'Timer', target: 'Event_Sub' });
  await rejects(input, 'EVENT_SUBPROCESS_FLOW', 'Event_Sub');
});

test('CLI builds userTask with matching offline HTML and BPMN DI; invalid type preserves outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bplm profile '));
  try {
    const input = join(dir, 'source.json'), html = join(dir, 'process.html'), bpmn = join(dir, 'process.bpmn');
    await writeFile(input, JSON.stringify(source()));
    const built = cli(['build', input, '--html', html, '--bpmn', bpmn]);
    assert.equal(built.status, 0, built.stderr);
    const page = await readFile(html, 'utf8');
    assert.ok(page.includes('Work') && page.includes('Описание тестового шага'));
    const { rootElement, warnings } = await new BpmnModdle().fromXML(await readFile(bpmn, 'utf8'));
    assert.deepEqual(warnings, []);
    const process = rootElement.rootElements.find((item: any) => item.id === 'Process');
    const task = process.flowElements.find((item: any) => item.id === 'Work');
    assert.equal(task.$type, 'bpmn:UserTask');
    assert.equal(task.documentation[0].text, 'Описание тестового шага');
    const plane = rootElement.diagrams[0].plane;
    assert.ok(plane.planeElement.some((item: any) => item.$type === 'bpmndi:BPMNShape' && item.bpmnElement.id === 'Work'));
    const invalid: any = source(); invalid.nodes[1].type = 'scriptTask';
    await writeFile(input, JSON.stringify(invalid));
    const failed = cli(['build', input, '--html', html, '--bpmn', bpmn, '--json']);
    assert.equal(failed.status, 1);
    assert.ok(JSON.parse(failed.stdout).diagnostics.some((item: any) => item.id === 'Work'));
    assert.equal(await readFile(html, 'utf8'), page);
    assert.equal((await readFile(bpmn, 'utf8')).includes('id="Work"'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
