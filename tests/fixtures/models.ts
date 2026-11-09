import { readFile } from 'node:fs/promises';
import type { ProcessDocument } from '../../src/domain.ts';
export const minimal = JSON.parse(await readFile(new URL('./minimal.json', import.meta.url), 'utf8')) as ProcessDocument;
const simple = minimal;
export function fullProfile(): ProcessDocument {
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

export function calls(): ProcessDocument {
  const model = structuredClone(minimal);
  model.id = 'Calls';
  model.stages.push({ id: 'SharedStage', name: 'Общая проверка' });
  model.processes.push({ id: 'Shared', name: 'Общий тестовый процесс' });
  model.pools.push({ id: 'SharedPool', name: 'Второй участник', process: 'Shared' });
  Object.assign(model.nodes[1], { type: 'callActivity', calledElement: 'Shared', description: 'Вызвать общий тестовый процесс.' });
  model.nodes.push(
    { id: 'SharedStart', type: 'start', name: 'Общий вход', process: 'Shared', stage: 'SharedStage' },
    { id: 'SharedTask', type: 'serviceTask', name: 'Тестовый шаг', description: 'Описание общего шага.', process: 'Shared', stage: 'SharedStage' },
    { id: 'SharedEnd', type: 'end', name: 'Общий выход', process: 'Shared', stage: 'SharedStage' });
  model.flows.push(
    { id: 'SharedFirst', type: 'sequence', source: 'SharedStart', target: 'SharedTask' },
    { id: 'SharedLast', type: 'sequence', source: 'SharedTask', target: 'SharedEnd' });
  return model;
}

export function events(): ProcessDocument {
  const model = structuredClone(minimal); model.id = 'Events'; model.lanes = [];
  model.pools[0].bounds = { x: 40, y: 40, width: 1200, height: 660 };
  model.nodes.forEach((node, index) => { delete node.lane; node.bounds = { x: 140 + index * 340, y: 100, width: node.type === 'task' ? 200 : 36, height: node.type === 'task' ? 80 : 36 }; });
  model.nodes[1].type = 'timerCatch'; model.nodes[1].timer = { kind: 'timeDuration', expression: 'PT1H' }; model.nodes[1].bounds = { x: 480, y: 100, width: 36, height: 36 };
  model.nodes.push(
    { id: 'EventSub', name: 'Тестовый подпроцесс', description: 'Условное событие запускает тестовый шаг.', type: 'eventSubProcess', process: 'Work', stage: 'Review', bounds: { x: 140, y: 300, width: 880, height: 300 } },
    { id: 'Conditional', name: 'Тестовое условие', type: 'conditionalStart', condition: 'syntheticFlag', parent: 'EventSub', process: 'Work', stage: 'Review', bounds: { x: 200, y: 420, width: 36, height: 36 } },
    { id: 'SubTask', name: 'Внутренний шаг', description: 'Описание внутреннего шага.', type: 'userTask', parent: 'EventSub', process: 'Work', stage: 'Review', bounds: { x: 440, y: 400, width: 200, height: 80 } },
    { id: 'Terminate', name: 'Остановка', type: 'terminateEnd', parent: 'EventSub', process: 'Work', stage: 'Review', bounds: { x: 820, y: 420, width: 36, height: 36 } });
  model.flows.push({ id: 'SubFirst', type: 'sequence', source: 'Conditional', target: 'SubTask' }, { id: 'SubLast', type: 'sequence', source: 'SubTask', target: 'Terminate' });
  return model;
}
