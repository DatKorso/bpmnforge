import { Ajv } from 'ajv';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BplmError } from './domain.ts';
import type { ProcessDocument, Diagnostic, Named } from './domain.ts';

const schema = JSON.parse(await readFile(new URL('../schema/bplm.schema.json', import.meta.url), 'utf8'));
const checkSchema = new Ajv({ allErrors: true, strict: true }).compile(schema);

export async function validateProcess(input: unknown, options: { htmlPath: string }): Promise<{ model: ProcessDocument; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, id: string, message: string, severity: 'error' | 'warning' = 'error') => diagnostics.push({ code, id, message, severity });
  const finish = () => {
    diagnostics.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : 1);
    if (diagnostics.some(item => item.severity === 'error')) throw new BplmError(1, 'Invalid process', diagnostics);
  };
  if (!checkSchema(input)) {
    for (const error of checkSchema.errors ?? []) {
      const parts = error.instancePath.split('/').slice(1); let item: any = input; let id = (input as any)?.id ?? '$';
      for (const part of parts) { item = item?.[part]; if (item && typeof item === 'object' && typeof item.id === 'string') id = item.id; }
      report('SCHEMA', id, `${error.instancePath || '/'}: ${error.message}`);
    }
    finish();
  }
  const model = structuredClone(input) as ProcessDocument;
  const entities = [model, ...model.stages, ...model.processes, ...model.pools, ...model.lanes, ...model.nodes, ...model.flows, ...(model.annotations ?? [])];
  const ids = new Set<string>();
  for (const entity of entities) { if (ids.has(entity.id)) report('DUPLICATE_ID', entity.id, 'ID must be globally unique'); ids.add(entity.id); }
  const processes = new Map(model.processes.map(item => [item.id, item])); const stages = new Set(model.stages.map(item => item.id));
  const lanes = new Map(model.lanes.map(item => [item.id, item])); const nodes = new Map(model.nodes.map(item => [item.id, item]));
  const pools = new Map(model.pools.map(item => [item.id, item])); const annotations = new Map((model.annotations ?? []).map(item => [item.id, item]));
  const poolFor = new Map<string, string>();
  for (const pool of model.pools) { if (!processes.has(pool.process)) report('REFERENCE', pool.id, `Unknown process ${pool.process}`); if (poolFor.has(pool.process)) report('POOL_PROCESS', pool.id, 'Process must have exactly one participant'); poolFor.set(pool.process, pool.id); }
  for (const process of model.processes) if (!poolFor.has(process.id)) report('POOL_PROCESS', process.id, 'Process requires a participant');
  for (const item of [...model.lanes, ...model.nodes, ...(model.annotations ?? [])]) if (!processes.has(item.process)) report('REFERENCE', item.id, `Unknown process ${item.process}`);
  for (const item of [...model.nodes, ...(model.annotations ?? [])]) {
    if (!stages.has(item.stage)) report('REFERENCE', item.id, `Unknown stage ${item.stage}`);
    if (item.lane && !lanes.has(item.lane)) report('REFERENCE', item.id, `Unknown lane ${item.lane}`);
    else if (item.lane && lanes.get(item.lane)!.process !== item.process) report('LANE_PROCESS', item.id, 'Lane belongs to a different process');
    if (!item.lane && model.lanes.some(lane => lane.process === item.process)) report('LANE_REQUIRED', item.id, 'Node must name a lane in a partitioned process');
  }
  const incoming = new Map(model.nodes.map(node => [node.id, [] as typeof model.flows])); const outgoing = new Map(model.nodes.map(node => [node.id, [] as typeof model.flows]));
  for (const flow of model.flows) {
    if (!ids.has(flow.source)) report('REFERENCE', flow.id, `Unknown source ${flow.source}`);
    if (!ids.has(flow.target)) report('REFERENCE', flow.id, `Unknown target ${flow.target}`);
    const a = nodes.get(flow.source), b = nodes.get(flow.target);
    if (flow.type === 'sequence') {
      if (!a || !b || a.process !== b.process) report('SEQUENCE_CONTAINER', flow.id, 'Sequence endpoints must be flow nodes of the same process');
      if (a) outgoing.get(a.id)!.push(flow); if (b) incoming.get(b.id)!.push(flow);
      if (flow.condition && a?.type !== 'xor') report('CONDITION_SOURCE', flow.id, 'Conditions are supported only on XOR outgoing branches');
    } else if (flow.type === 'message') {
      const aPool = pools.get(flow.source)?.id ?? (a && poolFor.get(a.process)); const bPool = pools.get(flow.target)?.id ?? (b && poolFor.get(b.process));
      if (!aPool || !bPool || (a && ['xor', 'and', 'start'].includes(a.type)) || (b && ['xor', 'and', 'end'].includes(b.type))) report('MESSAGE_ENDPOINT', flow.id, 'Messages require participant/task or correctly directed event endpoints');
      if (aPool && bPool && aPool === bPool) report('MESSAGE_POOL', flow.id, 'Messages must connect different participants');
    } else {
      const aa = annotations.get(flow.source), ba = annotations.get(flow.target);
      if (!((aa && b && aa.process === b.process) || (ba && a && ba.process === a.process))) report('ASSOCIATION_ENDPOINT', flow.id, 'Association must connect a text annotation to a node in the same process');
    }
    if (flow.type !== 'sequence' && (flow.condition || flow.return)) report('FLOW_METADATA', flow.id, 'Conditions and return markers require a sequence flow');
  }
  for (const node of model.nodes) {
    const ins = incoming.get(node.id)!, outs = outgoing.get(node.id)!;
    if (node.type === 'start' && ins.length) report('START_INCOMING', node.id, 'Start event cannot have incoming sequence flows');
    if (node.type === 'end' && outs.length) report('END_OUTGOING', node.id, 'End event cannot have outgoing sequence flows');
    if (node.defaultFlow) {
      if (node.type !== 'xor') report('DEFAULT_SOURCE', node.id, 'Default branch requires an XOR gateway');
      const flow = outs.find(flow => flow.id === node.defaultFlow);
      if (!flow) report('DEFAULT_FLOW', node.id, 'Default must reference an outgoing sequence flow');
      else if (flow.condition) report('DEFAULT_CONDITION', flow.id, 'Default branch cannot have a condition');
    }
    if (node.type === 'xor' && outs.length > 1) for (const flow of outs) if (flow.id !== node.defaultFlow && !flow.condition?.trim()) report('XOR_CONDITION', flow.id, 'XOR branch requires a condition or an explicit default');
  }
  for (const process of model.processes) {
    const members = model.nodes.filter(node => node.process === process.id), starts = members.filter(node => node.type === 'start');
    if (!starts.length) report('MISSING_START', process.id, 'Process requires a start event');
    if (!members.some(node => node.type === 'end')) report('MISSING_END', process.id, 'Process requires an end event');
    const reached = new Set(starts.map(node => node.id)); const queue = [...reached];
    for (let i = 0; i < queue.length; i++) for (const flow of outgoing.get(queue[i]) ?? []) if (nodes.get(flow.target)?.process === process.id && !reached.has(flow.target)) { reached.add(flow.target); queue.push(flow.target); }
    for (const node of members) if (node.required !== false && !reached.has(node.id)) report('UNREACHABLE', node.id, 'Required node is unreachable from a start event');
  }
  const plain = model.flows.filter(flow => flow.type === 'sequence' && !flow.return && nodes.has(flow.source) && nodes.has(flow.target));
  const adjacency = new Map<string, string[]>(); for (const flow of plain) { const list = adjacency.get(flow.source) ?? []; list.push(flow.target); adjacency.set(flow.source, list); }
  for (const flow of plain) {
    const visited = new Set<string>(), queue = [flow.target];
    for (let i = 0; i < queue.length; i++) { const id = queue[i]; if (id === flow.source) { report('RETURN_REQUIRED', flow.id, 'Cycle requires an explicitly marked return flow'); break; } if (visited.has(id)) continue; visited.add(id); queue.push(...(adjacency.get(id) ?? []).filter(next => !visited.has(next))); }
  }
  for (const item of entities as Named[]) for (const link of item.links ?? []) {
    const href = link.href; let decoded: string;
    try { decoded = decodeURIComponent(href); } catch { report('UNSAFE_URL', item.id, 'Malformed URL encoding'); continue; }
    if (href !== href.trim() || decoded !== decoded.trim() || /[\u0000-\u001f\u007f\\]/.test(decoded)) { report('UNSAFE_URL', item.id, 'URL contains control characters, leading whitespace or backslashes'); continue; }
    if (/^https:\/\//i.test(href)) {
      try { const url = new URL(href); if (!url.hostname || url.username || url.password) throw new Error(); } catch { report('UNSAFE_URL', item.id, 'Invalid HTTPS URL or embedded credentials'); }
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('/') || decoded.split(/[/?#]/).includes('..')) { report('UNSAFE_URL', item.id, 'Only HTTPS and relative document links are supported'); continue; }
    const local = decoded.split(/[?#]/)[0]; if (!local) continue;
    try { const info = await stat(resolve(dirname(options.htmlPath), local)); if (!info.isFile()) throw new Error(); } catch { report('MISSING_DOCUMENT', item.id, `Missing document: ${href}`, 'warning'); }
  }
  finish();
  return { model, diagnostics };
}
