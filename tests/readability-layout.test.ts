import test from 'node:test';
import assert from 'node:assert/strict';
import { graphCells, orderedLanes } from '../src/graph.ts';
import { taskSize, textLines, textWidth, textHeight } from '../src/text.ts';
import type { ProcessDocument } from '../src/domain.ts';
import { layoutProcess, selectedLayout } from '../src/layout.ts';
import { minimal, fullProfile, calls, events } from './fixtures/models.ts';
import { READABLE } from '../src/profile.ts';
import { readingFragment, stageEntries } from '../src/reading.ts';
import { measureReadability } from '../src/readability.ts';

function branching(): ProcessDocument {
  const node = (id: string, lane = 'Operator') => ({ id, name: id, type: 'task' as const, process: 'Work', stage: 'Prepare', lane });
  return {
    version: 1, id: 'SyntheticBranches', name: 'Синтетические альтернативы',
    stages: [{ id: 'Prepare', name: 'Подготовка' }, { id: 'Finish', name: 'Завершение' }],
    processes: [{ id: 'Work', name: 'Обработка' }], pools: [{ id: 'Pool', name: 'Участник', process: 'Work' }],
    lanes: [{ id: 'Operator', name: 'Оператор', process: 'Work' }, { id: 'Reviewer', name: 'Проверяющий', process: 'Work' }],
    // Intentionally put the short alternative first to exercise graph ordering.
    nodes: [node('Short'), node('Start'), node('LongA'), node('LongB'), node('Choice'), node('Join'), node('Review', 'Reviewer'), { ...node('End'), stage: 'Finish' }],
    flows: [
      ['In', 'Start', 'Choice'], ['ShortChoice', 'Choice', 'Short'], ['ShortJoin', 'Short', 'Join'],
      ['LongChoice', 'Choice', 'LongA'], ['LongNext', 'LongA', 'LongB'], ['LongJoin', 'LongB', 'Join'],
      ['ReviewChoice', 'Choice', 'Review'], ['ReviewJoin', 'Review', 'Join'], ['Out', 'Join', 'End']
    ].map(([id, source, target]) => ({ id, source, target, type: 'sequence' }))
  };
}

test('graph levels follow sequence steps, keep the longest visual axis and compact alternatives', () => {
  const model = branching(), original = structuredClone(model), cells = graphCells(model);
  assert.deepEqual(model, original, 'computing graph hints does not rewrite source JSON');
  assert.deepEqual(cells.get('Start'), { column: 0, row: 0 });
  assert.deepEqual(cells.get('Choice'), { column: 1, row: 0 });
  assert.deepEqual(cells.get('LongA'), { column: 2, row: 0 });
  assert.deepEqual(cells.get('LongB'), { column: 3, row: 0 });
  assert.deepEqual(cells.get('Short'), { column: 2, row: 1 });
  assert.deepEqual(cells.get('Join'), { column: 4, row: 0 });
  assert.deepEqual(cells.get('Review'), { column: 2, row: 0 }, 'participant lane has its own rows but shares sequence ranks');
  assert.deepEqual(cells.get('End'), { column: 0, row: 0 }, 'stage levels restart inside each stage zone');
  assert.ok(Math.max(...[...cells.values()].map(cell => cell.column)) < model.nodes.length - 1);
});

test('graph hints remain deterministic under array permutations and ignore information/return edges', () => {
  const model = branching(), baseline = graphCells(model);
  model.nodes.reverse(); model.flows.reverse();
  model.flows.push(
    { id: 'Return', source: 'Join', target: 'Choice', type: 'sequence', return: true },
    { id: 'Information', source: 'End', target: 'Start', type: 'association' },
    { id: 'Message', source: 'Join', target: 'Start', type: 'message' }
  );
  model.nodes.forEach(node => { node.column = 99; node.row = 88; });
  assert.deepEqual(graphCells(model), baseline);
});

test('annotation cells sit near their step without colliding with nodes or other notes', () => {
  const model = branching();
  model.annotations = ['NoteB', 'NoteA'].map(id => ({ id, name: id, text: 'Синтетическое примечание', stage: 'Prepare', process: 'Work', lane: 'Operator' }));
  model.flows.push(...model.annotations.map(note => ({ id: `${note.id}Link`, source: note.id, target: 'LongA', type: 'association' as const })));
  const cells = graphCells(model), long = cells.get('LongA')!;
  assert.equal(cells.get('NoteA')!.column, long.column);
  assert.ok(cells.get('NoteA')!.row > long.row);
  assert.notDeepEqual(cells.get('NoteA'), cells.get('NoteB'));
  assert.notDeepEqual(cells.get('NoteA'), cells.get('Short'));
});

test('shared text metrics wrap long Russian words and technical IDs without dropping content', () => {
  const samples = ['Проверить корректность параметров документа и результат обработки', 'POST_CreateShipmentWithCustomsDeclaration_0123456789'.repeat(3), 'ШИРОКАЯ проверка WWW MMM iii\nСледующий абзац'];
  for (const sample of samples) {
    const lines = textLines(sample, 168);
    assert.equal(lines.join('').replace(/\s/g, ''), sample.replace(/\s/g, ''));
    assert.ok(lines.every(line => textWidth(line) <= 168), 'every wrapped line fits the available width');
    assert.equal(textHeight(sample, 168), lines.length * 18);
    const size = taskSize(sample);
    assert.ok([200, 240, 280].includes(size.width));
    assert.equal(size.height % 40, 0);
    assert.ok(size.height >= textHeight(sample, size.width - 32) + 32, 'content has sixteen units of padding on every side');
  }
  assert.equal(taskSize('Проверить заказ').width, 200);
  assert.ok(textWidth('WWW') > textWidth('iii'));
});

test('automatic layout uses graph without hints and keeps either explicit grid hint', () => {
  const model = structuredClone(minimal);
  assert.equal(selectedLayout(model), 'graph');
  assert.deepEqual(layoutProcess(model), layoutProcess(model, { layout: 'graph' }));
  model.nodes[1].column = 3;
  assert.equal(selectedLayout(model), 'grid');
  assert.deepEqual(layoutProcess(model), layoutProcess(model, { layout: 'grid' }));
  delete model.nodes[1].column;
  model.nodes[1].row = 1;
  assert.equal(selectedLayout(model), 'grid');
  assert.deepEqual(layoutProcess(model), layoutProcess(model, { layout: 'grid' }));
});

test('explicit graph recalculates conflicting cell hints in memory and preserves supplied bounds/routes', () => {
  const model = structuredClone(minimal), baseline = layoutProcess(model, { layout: 'graph' });
  for (const node of model.nodes) { node.column = 7; node.row = 9; }
  assert.deepEqual(layoutProcess(model, { layout: 'graph' }), baseline, 'graph ignores cell hints rather than moving shapes to the hinted cell');
  model.nodes[1].bounds = { ...baseline.shapes.Check };
  model.flows[0].route = structuredClone(baseline.edges.ToCheck);
  const original = structuredClone(model), result = layoutProcess(model, { layout: 'graph' });
  assert.deepEqual(result.shapes.Check, model.nodes[1].bounds);
  assert.deepEqual(result.edges.ToCheck, model.flows[0].route);
  assert.deepEqual(model, original, 'layout recalculation never writes computed cells back to JSON');
});

test('complete manual geometry takes precedence in auto even when cell hints conflict', () => {
  const model = structuredClone(minimal), baseline = layoutProcess(model);
  for (const node of model.nodes) { node.bounds = { ...baseline.shapes[node.id] }; node.column = 0; node.row = 0; if (baseline.labels[node.id]) node.labelBounds = { ...baseline.labels[node.id] }; }
  for (const lane of model.lanes) lane.bounds = { ...baseline.shapes[lane.id] };
  for (const pool of model.pools) pool.bounds = { ...baseline.shapes[pool.id] };
  for (const flow of model.flows) flow.route = structuredClone(baseline.edges[flow.id]);
  assert.equal(selectedLayout(model), 'manual');
  const original = structuredClone(model), geometry = layoutProcess(model);
  for (const node of model.nodes) assert.deepEqual(geometry.shapes[node.id], node.bounds);
  for (const flow of model.flows) assert.deepEqual(geometry.edges[flow.id], flow.route);
  assert.deepEqual(model, original);
});

test('graph geometry groups alternatives into fewer columns than array-ordered grid geometry', () => {
  const model = branching(), graph = layoutProcess(model, { layout: 'graph' }), grid = layoutProcess(model, { layout: 'grid' });
  assert.ok(graph.stages.Prepare.width < grid.stages.Prepare.width, 'parallel alternatives share their rank instead of extending the stage');
  assert.equal(graph.shapes.Short.x, graph.shapes.LongA.x);
  assert.ok(graph.shapes.Short.y > graph.shapes.LongA.y);
  assert.equal(graph.shapes.Start.y, graph.shapes.LongA.y);
  assert.equal(graph.shapes.LongA.y, graph.shapes.LongB.y);
  assert.equal(graph.shapes.LongB.y, graph.shapes.Join.y);
  assert.deepEqual(layoutProcess(model, { layout: 'graph' }), graph, 'routing and geometry are repeatable');
});

test('automatic long Russian/API tasks retain measured padding and twenty-unit centers', () => {
  const model = structuredClone(minimal);
  model.nodes[1].name = 'Проверить параметры документа и вызвать POST_CreateShipmentWithCustomsDeclaration_0123456789 для повторной проверки результата';
  const result = layoutProcess(model), task = result.shapes.Check;
  assert.ok([200, 240, 280].includes(task.width));
  assert.equal(task.height % 40, 0);
  assert.ok(textHeight(model.nodes[1].name, task.width - 32) + 32 <= task.height);
  for (const node of model.nodes) {
    const box = result.shapes[node.id];
    assert.equal((box.x + box.width / 2) % 20, 0);
    assert.equal((box.y + box.height / 2) % 20, 0);
  }
});

test('all layout modes retain multiple participants, message links, calls and event subprocess semantics', () => {
  for (const factory of [fullProfile, calls, events]) for (const layout of ['auto', 'grid', 'graph'] as const) {
    const model = factory(), original = structuredClone(model), result = layoutProcess(model, { layout });
    assert.deepEqual(model, original, `${factory.name}/${layout}: node IDs, participants, flow types, endpoints, conditions and hints remain unchanged`);
    assert.equal(Object.keys(result.edges).length, model.flows.length, `${factory.name}/${layout}: no link disappeared`);
    for (const item of [...model.nodes, ...(model.annotations ?? []), ...model.pools, ...model.lanes]) assert.ok(result.shapes[item.id], `${factory.name}/${layout}: ${item.id} has geometry`);
    if (factory === events) for (const node of model.nodes) assert.deepEqual(result.shapes[node.id], node.bounds, 'event subprocess bounds remain author-controlled');
  }
});

test('readable-v1 measures each column separately and preserves an explicitly empty grid interval', () => {
  const model = structuredClone(minimal);
  model.nodes = ['A','B','C','D'].map((id,column)=>({id,name:id,type:'task',process:'Work',lane:'Agent',stage:'Review',column}));
  model.nodes[0].name = 'Подробная синтетическая проверка обязательных технических параметров '.repeat(3);
  model.flows = ['A','B','C'].map((source,i)=>({id:`F${i}`,type:'sequence',source,target:model.nodes[i+1].id}));
  for(const layout of ['grid','graph'] as const) {
    const g=layoutProcess(model,{layout});
    assert.equal(g.shapes.A.width,280);
    for(const [a,b] of [['A','B'],['B','C'],['C','D']]) assert.equal(g.shapes[b].x-g.shapes[a].x-g.shapes[a].width,80);
    assert.equal(measureReadability(model,g,layout).profile,'readable-v1');
  }
  const short = structuredClone(model);short.nodes[0].name='A';
  const before=layoutProcess(short,{layout:'grid'});short.nodes.slice(1).forEach(n=>n.column!++);
  const after=layoutProcess(short,{layout:'grid'});
  assert.equal(after.shapes.B.x-before.shapes.B.x,READABLE.emptyColumn);
  assert.deepEqual(after.shapes.A,before.shapes.A);
});

test('event/task and task/gateway spacing uses contours and centers stay on the grid', () => {
  const model=structuredClone(minimal);model.nodes[2].type='xor';
  for(const layout of ['grid','graph'] as const) {
    const g=layoutProcess(model,{layout});
    for(const [a,b] of [['Start','Check'],['Check','End']]) {
      const gap=g.shapes[b].x-g.shapes[a].x-g.shapes[a].width;
      assert.ok(gap>=80&&gap<120,`${a}/${b}: ${gap}`);
    }
  }
});

test('entries union interstage targets and independent starts; fragments prioritize the next step at 100–125%', () => {
  const model=structuredClone(minimal);model.stages.push({id:'Next',name:'Next'});
  model.nodes[1].stage=model.nodes[2].stage='Next';
  model.nodes.push({id:'Independent',name:'Independent',type:'start',process:'Work',lane:'Agent',stage:'Next',row:1,column:0});
  const g=layoutProcess(model,{layout:'grid'});
  assert.deepEqual(stageEntries(model,g,'Next').map(n=>n.id),['Check','Independent']);
  for(const outer of [{width:1200,height:680},{width:1680,height:860}]) {
    const f=readingFragment(model,g,'Next','Check',outer)!;
    assert.ok(f.visible.includes('Check')&&f.visible.includes('End'));
    assert.deepEqual(f.missingSuccessors,[]);assert.ok(f.scale>=1&&f.scale<=1.25);
    assert.ok(f.bounds.width*f.scale<=outer.width-64&&f.bounds.height*f.scale<=outer.height-64);
  }
  g.shapes.End.x+=4000;
  const f=readingFragment(model,g,'Next','Check',{width:1200,height:680})!;
  assert.deepEqual(f.missingSuccessors,['End']);assert.ok(f.scale>=1);
  assert.ok(measureReadability(model,g,'grid').diagnostics.some(d=>d.code==='READABILITY_FRAGMENT_CONTEXT'&&d.id==='Check'));
});

test('two-transition reading context includes the nearest fork after the immediate successor', () => {
  const model=structuredClone(minimal);model.nodes[0].name='Вход';model.nodes[2].type='xor';model.nodes[2].name='Условие?';
  const g=layoutProcess(model,{layout:'graph'}),f=readingFragment(model,g,'Review','Start',{width:1200,height:680})!;
  assert.deepEqual(f.visible,['Start','Check','End']);assert.equal(f.entryFits,true);
});

test('automatic lane placement keeps entry/successor lanes adjacent without changing membership or manual frames', () => {
  const model=structuredClone(minimal);model.lanes=[{id:'Agent',name:'Agent',process:'Work'},{id:'Middle',name:'Middle',process:'Work'},{id:'Worker',name:'Worker',process:'Work'}];
  model.nodes[2].lane='Worker';model.nodes.push(...Array.from({length:4},(_,row)=>({id:`Middle${row}`,name:'Независимый синтетический шаг',type:'task' as const,stage:'Review',process:'Work',lane:'Middle',column:4,row,required:false})));
  const original=structuredClone(model),lanes=orderedLanes(model,'Work');
  assert.equal(Math.abs(lanes.findIndex(l=>l.id==='Agent')-lanes.findIndex(l=>l.id==='Worker')),1);
  for(const layout of ['grid','graph'] as const){const g=layoutProcess(model,{layout}),f=readingFragment(model,g,'Review','Check',{width:1200,height:680})!;assert.ok(f.visible.includes('End'));}
  assert.deepEqual(model,original);
  model.lanes[0].bounds={x:70,y:60,width:2000,height:200};assert.deepEqual(orderedLanes(model,'Work'),model.lanes);
});

test('a large authored event subprocess retains its bounds rather than inheriting the annotation height limit', () => {
  const model=events(),parent=model.nodes.find(n=>n.type==='eventSubProcess')!;
  parent.bounds!.height=520;model.pools[0].bounds!.height=1000;
  const before=structuredClone(model);
  for(const layout of ['auto','grid','graph'] as const){const g=layoutProcess(model,{layout});assert.deepEqual(g.shapes[parent.id],parent.bounds);}
  assert.deepEqual(model,before);
});
