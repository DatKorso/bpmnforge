import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BpmnModdle } from 'bpmn-moddle';
import { buildProcess } from '../src/build.ts';
import { minimal, fullProfile, calls, events } from './fixtures/models.ts';

for (const [name, fixture] of Object.entries({ minimal: () => structuredClone(minimal), branching: fullProfile, calls, events })) {
  test(`${name}: IDs, documentation, endpoints and geometry survive HTML/BPMN export`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bpmnforge semantics '));
    try {
      const model = fixture();
      const sourcePath = join(dir, 'source.json'), htmlPath = join(dir, 'out.html'), bpmnPath = join(dir, 'out.bpmn');
      await writeFile(sourcePath, JSON.stringify(model));
      const result = await buildProcess({ sourcePath, htmlPath, bpmnPath });
      const xml = await readFile(bpmnPath, 'utf8'), html = await readFile(htmlPath, 'utf8');
      const data = JSON.parse(html.match(/id="bpmnforge-data">([\s\S]*?)<\/script>/)![1]);
      assert.deepEqual(data.model, model); assert.equal(data.xml, xml); assert.deepEqual(data.geometry, JSON.parse(JSON.stringify(result.geometry)));
      const { elementsById, warnings } = await new BpmnModdle().fromXML(xml);
      assert.deepEqual(warnings, []);
      for (const item of [...model.processes, ...model.pools, ...model.lanes, ...model.nodes, ...model.flows, ...(model.annotations ?? [])]) assert.ok(elementsById[item.id], item.id);
      for (const node of model.nodes) {
        const item = elementsById[node.id];
        if (node.description) assert.equal(item.documentation[0].text, node.description);
        if (node.calledElement) assert.equal(item.calledElement, node.calledElement);
        if (node.parent) assert.equal(item.$parent.id, node.parent);
      }
      for (const flow of model.flows) {
        assert.equal(elementsById[flow.id].sourceRef.id, flow.source);
        assert.equal(elementsById[flow.id].targetRef.id, flow.target);
        if (flow.condition) assert.equal(elementsById[flow.id].conditionExpression.body, flow.condition);
      }
      for (const [id, bounds] of Object.entries(result.geometry.shapes)) {
        const di = elementsById[`BPMNFORGE_DI_${id}`];
        assert.deepEqual({ x: di.bounds.x, y: di.bounds.y, width: di.bounds.width, height: di.bounds.height }, bounds);
      }
      for (const [id, points] of Object.entries(result.geometry.edges)) assert.deepEqual(elementsById[`BPMNFORGE_DI_${id}`].waypoint.map((p: any) => ({ x: p.x, y: p.y })), points);
      if (name === 'events') {
        assert.equal(elementsById.EventSub.triggeredByEvent, true);
        assert.equal(elementsById.Conditional.eventDefinitions[0].condition.body, 'syntheticFlag');
        assert.equal(elementsById.Check.eventDefinitions[0].timeDuration.body, 'PT1H');
        assert.equal(elementsById.Terminate.eventDefinitions[0].$type, 'bpmn:TerminateEventDefinition');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
