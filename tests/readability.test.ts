import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { minimal } from './fixtures/models.ts';
import { layoutProcess } from '../src/layout.ts';
import { measureReadability } from '../src/readability.ts';
import { runCli } from '../src/cli.ts';
import { prepareProcess } from '../src/build.ts';

function parallelScene(gap: number) {
  const model = structuredClone(minimal); model.lanes = [];
  model.pools[0].bounds = { x: 0, y: 0, width: 1400, height: 500 };
  model.nodes = ['A','B','C','D'].map((id,i) => ({ id, name: id, type: 'task' as const, process: 'Work', stage: 'Review', bounds: { x: i % 2 ? 1000 : 100, y: i < 2 ? 100 : 300, width: 200, height: 80 } }));
  model.flows = [
    {id:'First',type:'sequence',source:'A',target:'B',route:[{x:300,y:140},{x:400,y:140},{x:400,y:220},{x:900,y:220},{x:900,y:140},{x:1000,y:140}]},
    {id:'Second',type:'sequence',source:'C',target:'D',route:[{x:300,y:340},{x:450,y:340},{x:450,y:220+gap},{x:850,y:220+gap},{x:850,y:340},{x:1000,y:340}]}
  ];return model;
}
test('manual clearances of 0.5 and 4 are reported without changing route hints', () => {
  for (const gap of [0.5,4]) {
    const model=parallelScene(gap), geometry=layoutProcess(model), report=measureReadability(model,geometry,'manual');
    assert.equal(report.minimumParallelGap,gap);
    assert.ok(report.diagnostics.some(d=>d.code==='MANUAL_ROUTE_CLEARANCE' && d.severity==='warning'));
    assert.deepEqual(geometry.edges.First,model.flows[0].route); assert.deepEqual(geometry.edges.Second,model.flows[1].route);
    assert.equal(report.routes.length,2);assert.ok(report.routeLength.total>0);assert.equal(report.bends,8);
  }
});
test('report exposes crossings and label ownership without changing geometry', () => {
  const model=structuredClone(minimal),geometry=layoutProcess(model), before=JSON.stringify(geometry);
  const report=measureReadability(model,geometry,'graph');
  assert.equal(JSON.stringify(geometry),before);assert.equal(report.layout,'graph');assert.equal(report.recommendedClearance,14);
  assert.equal(report.crossings,geometry.crossings.length);assert.ok(report.labels.every(label=>Number.isFinite(label.distanceToOwner)));
});
test('both CLI commands accept layout mode, preserve existing fields and expose same readability', async () => {
  const dir=await mkdtemp(join(tmpdir(),'bpmnforge-readability-'));
  try {
    const source=join(dir,'source.json');await writeFile(source,JSON.stringify(minimal));
    for(const mode of ['auto','grid','graph']) {
      const outputs:any[]=[];
      for(const command of ['validate','build']) {
        let output='';const code=await runCli([command,source,'--layout',mode,'--json'],{out:text=>{output=text;},err:()=>{}});
        assert.equal(code,0,output);outputs.push(JSON.parse(output));
      }
      assert.deepEqual(outputs[0].readability,outputs[1].readability);
      for(const out of outputs){assert.ok(out.outputs.html);assert.ok(out.geometry.shapes.Start);assert.ok(Array.isArray(out.diagnostics));assert.equal(out.readability.layout,mode==='grid'?'grid':'graph');}
    }
    for(const flags of [['--layout'],['--layout','invalid'],['--layout','graph','--layout','grid']])assert.equal(await runCli(['validate',source,...flags],{out:()=>{},err:()=>{}}),2);
    const before=JSON.stringify(minimal);await prepareProcess({sourcePath:source,layout:'graph'});assert.equal(JSON.stringify(minimal),before);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('manual readability warnings preserve successful validation exit status', async () => {
  const dir=await mkdtemp(join(tmpdir(),'bpmnforge-manual-warning-'));
  try {
    const model=parallelScene(.5);model.processes[0].external=true;
    const source=join(dir,'source.json');await writeFile(source,JSON.stringify(model));
    let output='';
    assert.equal(await runCli(['validate',source,'--json'],{out:text=>{output=text;},err:()=>{}}),0,output);
    const result=JSON.parse(output);assert.equal(result.readability.layout,'manual');
    assert.ok(result.diagnostics.some((d:any)=>d.code==='MANUAL_ROUTE_CLEARANCE' && d.severity==='warning'));
    assert.deepEqual(result.geometry.edges.Second,model.flows[1].route);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('association titles export as standard documentation without unsupported name fields', async () => {
  const { exportBpmn }=await import('../src/bpmn.ts');
  const { BpmnModdle }=await import('bpmn-moddle');
  const model=structuredClone(minimal);
  model.flows.push({id:'Information',source:'Check',target:'Start',type:'association',originalType:'association',name:'Синтетическая информационная связь'}, {id:'Additional',source:'End',target:'Check',type:'association',name:'Вторая подпись'});
  const geometry=layoutProcess(model),xml=await exportBpmn(model,geometry);
  const parsed=await new BpmnModdle().fromXML(xml);
  assert.deepEqual(parsed.warnings,[]);
  for(const id of ['Information','Additional']){assert.equal(parsed.elementsById[id].$type,'bpmn:Association');assert.ok(parsed.elementsById[id].documentation[0].text.includes(model.flows.find(flow=>flow.id===id)!.name));assert.equal(parsed.elementsById[id].name,undefined);assert.ok(geometry.labels[id]);}
});
test('short independent parallel stretches also receive clearance diagnostics', () => {
  const model=parallelScene(.5),geometry=layoutProcess(model);
  geometry.edges.First=[{x:0,y:0},{x:10,y:0}];geometry.edges.Second=[{x:2,y:.5},{x:8,y:.5}];
  const report=measureReadability(model,geometry,'manual');
  assert.equal(report.closeParallelSegments.length,1);assert.equal(report.closeParallelSegments[0].projection,6);
});
