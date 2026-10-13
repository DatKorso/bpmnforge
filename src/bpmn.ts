import { BpmnModdle } from 'bpmn-moddle';
import type { ProcessDocument, Geometry } from './domain.ts';
export async function exportBpmn(model: ProcessDocument, geometry: Geometry): Promise<string> {
  const moddle = new BpmnModdle();
  const create = (type: string, props: any) => moddle.create(type, props);
  const refs = new Map<string, any>(); const processes = new Map<string, any>();
  const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const process of sorted(model.processes)) { const element = create('bpmn:Process', { id: process.id, name: process.name, isExecutable: false, flowElements: [], artifacts: [], laneSets: [] }); processes.set(process.id, element); refs.set(process.id, element); }
  const types = { start: 'StartEvent', end: 'EndEvent', task: 'Task', xor: 'ExclusiveGateway', and: 'ParallelGateway' };
  for (const node of sorted(model.nodes)) {
    const element = create(`bpmn:${types[node.type]}`, { id: node.id, name: node.name, incoming: [], outgoing: [], documentation: node.description ? [create('bpmn:Documentation', { text: node.description })] : [] });
    refs.set(node.id, element); processes.get(node.process).flowElements.push(element); element.$parent = processes.get(node.process);
  }
  for (const annotation of sorted(model.annotations ?? [])) { const element = create('bpmn:TextAnnotation', { id: annotation.id, text: annotation.text }); refs.set(annotation.id, element); processes.get(annotation.process).artifacts.push(element); }
  for (const process of sorted(model.processes)) {
    const lanes = sorted(model.lanes.filter(lane => lane.process === process.id)).map(lane => { const element = create('bpmn:Lane', { id: lane.id, name: lane.name, flowNodeRef: sorted(model.nodes.filter(node => node.lane === lane.id)).map(node => refs.get(node.id)) }); refs.set(lane.id, element); return element; });
    if (lanes.length) processes.get(process.id).laneSets = [create('bpmn:LaneSet', { id: `BPLM_Lanes_${process.id}`, lanes })];
  }
  const collaboration = create('bpmn:Collaboration', { id: 'BPLM_Collaboration', participants: sorted(model.pools).map(pool => { const element = create('bpmn:Participant', { id: pool.id, name: pool.name, processRef: processes.get(pool.process) }); refs.set(pool.id, element); return element; }), messageFlows: [] });
  for (const flow of sorted(model.flows)) {
    const source = refs.get(flow.source), target = refs.get(flow.target);
    const type = flow.type === 'sequence' ? 'SequenceFlow' : flow.type === 'message' ? 'MessageFlow' : 'Association';
    const name = flow.name ?? flow.condition ?? (model.nodes.some(node => node.defaultFlow === flow.id) ? 'Иначе' : undefined);
    const element = create(`bpmn:${type}`, { id: flow.id, name, sourceRef: source, targetRef: target }); refs.set(flow.id, element);
    if (flow.type === 'message') collaboration.messageFlows.push(element);
    else {
      const ownerId = model.nodes.find(node => node.id === flow.source)?.process ?? model.annotations?.find(node => node.id === flow.source)?.process ?? model.nodes.find(node => node.id === flow.target)?.process;
      if (!ownerId) throw new Error('Flow owner missing after validation');
      const owner = processes.get(ownerId);
      if (flow.type === 'sequence') { owner.flowElements.push(element); source.outgoing.push(element); target.incoming.push(element); if (flow.condition) element.conditionExpression = create('bpmn:FormalExpression', { body: flow.condition }); }
      else owner.artifacts.push(element);
    }
  }
  for (const node of model.nodes) if (node.defaultFlow) refs.get(node.id).default = refs.get(node.defaultFlow);
  const plane = create('bpmndi:BPMNPlane', { id: 'BPLM_Plane', bpmnElement: collaboration, planeElement: [] });
  for (const id of Object.keys(geometry.shapes).sort()) {
    const shape = create('bpmndi:BPMNShape', { id: `BPLM_DI_${id}`, bpmnElement: refs.get(id), bounds: create('dc:Bounds', geometry.shapes[id]), isHorizontal: true });
    if (geometry.labels[id]) shape.label = create('bpmndi:BPMNLabel', { bounds: create('dc:Bounds', geometry.labels[id]) });
    plane.planeElement.push(shape);
  }
  for (const id of Object.keys(geometry.edges).sort()) { const edge = create('bpmndi:BPMNEdge', { id: `BPLM_DI_${id}`, bpmnElement: refs.get(id), waypoint: geometry.edges[id].map(point => create('dc:Point', point)) }); if (geometry.labels[id]) edge.label = create('bpmndi:BPMNLabel', { bounds: create('dc:Bounds', geometry.labels[id]) }); plane.planeElement.push(edge); }
  const definitions = create('bpmn:Definitions', { id: `BPLM_Definitions_${model.id}`, targetNamespace: 'https://bplm.local/schema/1', rootElements: [...processes.values(), collaboration], diagrams: [create('bpmndi:BPMNDiagram', { id: 'BPLM_Diagram', plane })] });
  const { xml } = await moddle.toXML(definitions, { format: true });
  const parsed = await moddle.fromXML(xml); if (parsed.warnings.length) throw new Error('Exported BPMN failed round-trip validation');
  return xml;
}
