import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutProcess } from '../src/layout.ts';
import { measureReadability } from '../src/readability.ts';
import type { Bounds, Flow, ProcessDocument } from '../src/domain.ts';
import { isVertex } from '../src/ports.ts';

function scene(boxes: Record<string, Bounds>, flows: Flow[]): ProcessDocument {
  return { version: 1, id: 'Routes', name: 'Synthetic routing', stages: [{ id: 'Stage', name: 'Stage' }],
    processes: [{ id: 'Work', name: 'Work' }], pools: [{ id: 'Pool', name: 'Pool', process: 'Work', bounds: { x: 0, y: 0, width: 1500, height: 1200 } }], lanes: [],
    nodes: Object.entries(boxes).map(([id, bounds]) => ({ id, name: id, type: 'task', process: 'Work', stage: 'Stage', bounds })), flows };
}

test('route score compares length, forty per bend and four hundred per crossing deterministically', () => {
  const model = scene({
    Left: { x: 100, y: 100, width: 180, height: 80 }, Right: { x: 900, y: 100, width: 180, height: 80 },
    Above: { x: 500, y: 0, width: 180, height: 80 }, Below: { x: 500, y: 300, width: 180, height: 80 }
  }, [
    { id: 'Across', type: 'sequence', source: 'Left', target: 'Right' },
    { id: 'Vertical', type: 'sequence', source: 'Above', target: 'Below' }
  ]);
  const manual = structuredClone(model);
  manual.flows[0].route = [{ x: 280, y: 140 }, { x: 900, y: 140 }];
  manual.flows[1].route = [{ x: 590, y: 80 }, { x: 590, y: 300 }];
  const baseline = layoutProcess(manual), improved = layoutProcess(model);
  assert.equal(baseline.crossings.length, 1);
  const score = (g: typeof improved) => { const r=measureReadability(model,g,'manual');return r.routeLength.total+40*r.bends+400*r.crossings; };
  assert.ok(score(improved)<=score(baseline),'an expensive perimeter detour need not beat an affordable crossing');
  assert.deepEqual(measureReadability(model, improved, 'manual').closeParallelSegments, []);
  assert.deepEqual(layoutProcess({ ...model, flows: [...model.flows].reverse() }), improved);
  assert.deepEqual(model.nodes, manual.nodes, 'routing does not alter source geometry or IDs');
});

test('joint gateway ports reserve a manual vertex and keep the remaining connections at distinct vertices', () => {
  const model=scene({Gateway:{x:500,y:500,width:50,height:50},Left:{x:100,y:485,width:200,height:80},Right:{x:900,y:485,width:200,height:80},Upper:{x:425,y:100,width:200,height:80},Lower:{x:425,y:900,width:200,height:80}},[
    {id:'Manual',type:'sequence',source:'Left',target:'Gateway',route:[{x:300,y:525},{x:500,y:525}]},
    {id:'Rightward',type:'sequence',source:'Gateway',target:'Right'},
    {id:'Upward',type:'sequence',source:'Gateway',target:'Upper'},
    {id:'Return',type:'sequence',source:'Lower',target:'Gateway',return:true},
  ]);model.nodes[0].type='xor';
  const original=structuredClone(model),g=layoutProcess(model);
  const points=model.flows.map(f=>g.edges[f.id][f.source==='Gateway'?0:g.edges[f.id].length-1]);
  assert.ok(points.every(p=>isVertex(p,g.shapes.Gateway)));assert.equal(new Set(points.map(p=>JSON.stringify(p))).size,4);
  assert.deepEqual(g.edges.Manual,model.flows[0].route);assert.deepEqual(model,original);
  assert.deepEqual(measureReadability(model,g,'manual').portExceptions,[]);
  assert.deepEqual(layoutProcess({...model,flows:[...model.flows].reverse()}),g);
});

test('more than four gateway connections retain every flow and report contour exceptions as warnings', () => {
  const model=scene({Gateway:{x:450,y:500,width:100,height:100},...Object.fromEntries(Array.from({length:5},(_,i)=>[`T${i}`,{x:900,y:50+i*220,width:200,height:80}]))},Array.from({length:5},(_,i)=>({id:`F${i}`,type:'sequence',source:'Gateway',target:`T${i}`})));
  model.nodes[0].type='xor';const g=layoutProcess(model),r=measureReadability(model,g,'manual');
  assert.equal(Object.keys(g.edges).length,5);assert.ok(r.portExceptions.length>=1);
  assert.ok(r.diagnostics.some(d=>d.code==='READABILITY_GATEWAY_PORT_EXCEPTION'&&d.severity==='warning'));
  assert.deepEqual(r.closeParallelSegments,[]);assert.deepEqual(r.shapeClearances,[]);
});

test('explicit label bounds with a small profile gap remain authored and receive a warning', () => {
  const model=scene({A:{x:100,y:100,width:200,height:80},B:{x:600,y:100,width:200,height:80}},[
    {id:'F',type:'sequence',source:'A',target:'B',name:'Сохранённая подпись',route:[{x:300,y:140},{x:600,y:140}],labelBounds:{x:302,y:100,width:120,height:30}},
  ]);
  const before=structuredClone(model),g=layoutProcess(model),r=measureReadability(model,g,'manual');
  assert.deepEqual(g.labels.F,model.flows[0].labelBounds);assert.deepEqual(g.edges.F,model.flows[0].route);assert.deepEqual(model,before);
  assert.ok(r.diagnostics.some(d=>d.code==='READABILITY_LABEL_CLEARANCE'&&d.id==='F'));
  const metric=r.labels.find(label=>label.id==='F')!;assert.equal(metric.distanceToSource,2);assert.equal(metric.distanceToOwner,10);
});

test('fixed geometry blocking a vertex permits a diagnosed contour exception without crossing figures', () => {
  const model=scene({Gateway:{x:500,y:500,width:50,height:50},Blocker:{x:430,y:490,width:55,height:70},
    Right:{x:950,y:485,width:200,height:80},Upper:{x:425,y:100,width:200,height:80},Lower:{x:425,y:900,width:200,height:80},Diagonal:{x:950,y:100,width:200,height:80}},
    ['Right','Upper','Lower','Diagonal'].map((target,i)=>({id:`F${i}`,type:'sequence',source:'Gateway',target})));
  model.nodes[0].type='xor';const before=structuredClone(model),g=layoutProcess(model),r=measureReadability(model,g,'manual');
  assert.equal(Object.keys(g.edges).length,4);assert.ok(r.portExceptions.some(item=>item.gateway==='Gateway'&&item.degree===4));
  assert.deepEqual(r.closeParallelSegments,[]);assert.deepEqual(r.shapeClearances,[]);assert.deepEqual(model,before);
});

for (const gap of [0.5, 4]) test(`manual ${gap}-unit parallel gap warns while an automatic route separates the lines`, () => {
  const model = scene({
    A: { x: 100, y: 300, width: 200, height: 80 }, B: { x: 1000, y: 300, width: 200, height: 80 },
    C: { x: 300, y: 600, width: 200, height: 80 }, D: { x: 800, y: 600, width: 200, height: 80 }
  }, [
    { id: 'Upper', type: 'sequence', source: 'A', target: 'B', route: [{ x: 200, y: 300 }, { x: 200, y: 140 }, { x: 1100, y: 140 }, { x: 1100, y: 300 }] },
    { id: 'Lower', type: 'sequence', source: 'C', target: 'D', route: [{ x: 400, y: 600 }, { x: 400, y: 140 + gap }, { x: 900, y: 140 + gap }, { x: 900, y: 600 }] }
  ]);
  const before = structuredClone(model), geometry = layoutProcess(model);
  assert.deepEqual(geometry.edges.Lower, model.flows[1].route, 'explicit route stays verbatim');
  const report = measureReadability(model, geometry, 'manual');
  assert.equal(report.closeParallelSegments.length, 1);
  assert.equal(report.closeParallelSegments[0].gap, gap);
  assert.ok(report.diagnostics.some(diagnostic => diagnostic.code === 'MANUAL_ROUTE_CLEARANCE' && diagnostic.severity === 'warning'));
  delete model.flows[1].route;
  const automatic = layoutProcess(model);
  assert.deepEqual(measureReadability(model, automatic, 'manual').closeParallelSegments, []);
  assert.deepEqual(automatic.edges.Upper, before.flows[0].route, 'other manual route stays reserved');
});

test('shared gateway fan-out separates long parallel stretches by at least fourteen units', () => {
  const model = scene({ A: { x: 100, y: 100, width: 50, height: 50 }, B: { x: 600, y: 100, width: 50, height: 50 } }, [
    { id: 'Forward', type: 'sequence', source: 'A', target: 'B' },
    { id: 'Parallel', type: 'sequence', source: 'A', target: 'B' },
    { id: 'Return', type: 'sequence', source: 'B', target: 'A', return: true }
  ]);
  model.nodes.forEach(node => { node.type = 'xor'; });
  const geometry = layoutProcess(model), report = measureReadability(model, geometry, 'manual');
  assert.deepEqual(report.closeParallelSegments, []);
  assert.ok(report.minimumParallelGap === null || report.minimumParallelGap >= 14);
  assert.equal(Object.keys(geometry.edges).length, 3);
  assert.deepEqual(layoutProcess(model), geometry);
});
