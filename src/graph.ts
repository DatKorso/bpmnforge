import type { ProcessDocument } from './domain.ts';

export interface Cell { column: number; row: number }
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** In-memory placement hints. Association/message links and return arcs cannot
 * introduce ranks or select the visual axis; the source document is untouched.
 */
export function graphCells(model: ProcessDocument): Map<string, Cell> {
  const nodes = new Map(model.nodes.map(node => [node.id, node]));
  const incoming = new Map(model.nodes.map(node => [node.id, [] as string[]]));
  const outgoing = new Map(model.nodes.map(node => [node.id, [] as string[]]));
  for (const flow of [...model.flows].sort((a, b) => compareId(a.id, b.id))) {
    const source = nodes.get(flow.source), target = nodes.get(flow.target);
    if (flow.type !== 'sequence' || flow.return || !source || !target || source.process !== target.process || source.parent !== target.parent) continue;
    incoming.get(target.id)!.push(source.id); outgoing.get(source.id)!.push(target.id);
  }
  const indegree = new Map([...incoming].map(([id, ids]) => [id, ids.length]));
  const ready = [...nodes.keys()].filter(id => indegree.get(id) === 0).sort(compareId), order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!; order.push(id);
    for (const target of outgoing.get(id)!) {
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) { ready.push(target); ready.sort(compareId); }
    }
  }
  // Validation normally rejects unmarked cycles. Keep the helper total for API
  // callers too, with stable placement rather than an infinite traversal.
  for (const id of [...nodes.keys()].sort(compareId)) if (!order.includes(id)) order.push(id);
  const columns = new Map<string, number>(), remaining = new Map<string, number>();
  for (const id of order) {
    const node = nodes.get(id)!;
    columns.set(id, Math.max(0, ...incoming.get(id)!.filter(previous => nodes.get(previous)!.stage === node.stage)
      .map(previous => (columns.get(previous) ?? -1) + 1)));
  }
  for (const id of [...order].reverse()) remaining.set(id, 1 + Math.max(0, ...outgoing.get(id)!.map(next => remaining.get(next) ?? 0)));

  const cells = new Map<string, Cell>();
  const partitions = new Map<string, string[]>();
  for (const id of order) {
    const node = nodes.get(id)!, key = `${node.process}/${node.lane ?? ''}/${node.stage}`;
    if (!partitions.has(key)) partitions.set(key, []);
    partitions.get(key)!.push(id);
  }
  for (const members of partitions.values()) {
    const membership = new Set(members), occupancy = new Map<number, Set<number>>();
    const localPredecessors = (id: string) => incoming.get(id)!.filter(previous => membership.has(previous) && cells.has(previous));
    const preferredRow = (id: string) => {
      const predecessors = localPredecessors(id);
      // A merge returns to the highest occupied sequence axis. For an ordinary
      // continuation this carries the branch's row forward unchanged.
      return predecessors.length ? Math.min(...predecessors.map(previous => cells.get(previous)!.row)) : 0;
    };
    const ranks = [...new Set(members.map(id => columns.get(id)!))].sort((a, b) => a - b);
    for (const column of ranks) {
      const rank = members.filter(id => columns.get(id) === column);
      const barycenter = (id: string) => {
        const predecessors = localPredecessors(id);
        return predecessors.length ? predecessors.reduce((sum, previous) => sum + cells.get(previous)!.row, 0) / predecessors.length : 0;
      };
      rank.sort((a, b) => preferredRow(a) - preferredRow(b) || barycenter(a) - barycenter(b)
        || remaining.get(b)! - remaining.get(a)! || compareId(a, b));
      const occupied = new Set<number>(); occupancy.set(column, occupied);
      for (const id of rank) {
        let row = preferredRow(id);
        while (occupied.has(row)) row++;
        occupied.add(row); cells.set(id, { column, row });
      }
    }
  }
  // Keep notes near the linked step, in the nearest unoccupied cell below it.
  for (const note of [...(model.annotations ?? [])].sort((a, b) => compareId(a.id, b.id))) {
    const related = model.flows.filter(flow => flow.type === 'association' && (flow.source === note.id || flow.target === note.id))
      .map(flow => flow.source === note.id ? flow.target : flow.source).sort(compareId)
      .find(id => nodes.get(id)?.stage === note.stage && nodes.get(id)?.process === note.process && nodes.get(id)?.lane === note.lane);
    const column = related ? cells.get(related)!.column : 0;
    let row = related ? cells.get(related)!.row + 1 : 0;
    const samePartition = [...model.nodes, ...(model.annotations ?? []).filter(item => cells.has(item.id))]
      .filter(item => item.process === note.process && item.lane === note.lane && item.stage === note.stage);
    while (samePartition.some(item => cells.get(item.id)?.column === column && cells.get(item.id)?.row === row)) row++;
    cells.set(note.id, { column, row });
  }
  return cells;
}

/** Place related lanes next to each other without changing source membership or
 * explicit bounds. Entry/successor pairs carry extra weight for reading frames.
 * A subset DP gives a stable minimum of weighted inter-lane span for <= 8 lanes.
 */
export function orderedLanes(model: ProcessDocument, process: string) {
  const lanes=model.lanes.filter(lane=>lane.process===process);
  if(lanes.length<3||lanes.length>8||lanes.some(lane=>lane.bounds)||model.nodes.some(node=>node.process===process&&node.bounds))return lanes;
  const byId=new Map(model.nodes.map(node=>[node.id,node]));
  const entries=new Set(model.nodes.filter(node=>['start','conditionalStart'].includes(node.type)).map(node=>node.id));
  for(const flow of model.flows)if(flow.type==='sequence'&&!flow.return&&byId.get(flow.source)?.stage!==byId.get(flow.target)?.stage)entries.add(flow.target);
  const weights=lanes.map(()=>lanes.map(()=>0));
  for(const flow of model.flows) {
    if(flow.type!=='sequence'||flow.return)continue;
    const source=byId.get(flow.source),target=byId.get(flow.target);
    const a=lanes.findIndex(lane=>lane.id===source?.lane),b=lanes.findIndex(lane=>lane.id===target?.lane);
    if(a<0||b<0||a===b)continue;
    // Minimize entry/successor span first, then the span of other sequences.
    const weight=1+Number(source?.stage===target?.stage&&entries.has(flow.source))*(model.flows.length*lanes.length+1);
    weights[a][b]+=weight;weights[b][a]+=weight;
  }
  const count=1<<lanes.length,cut=new Float64Array(count);
  for(let mask=0;mask<count;mask++)for(let a=0;a<lanes.length;a++)if(mask&(1<<a))for(let b=0;b<lanes.length;b++)if(!(mask&(1<<b)))cut[mask]+=weights[a][b];
  const states=new Map<number,{cost:number;order:number[];key:string}>([[0,{cost:0,order:[],key:''}]]);
  for(let mask=0;mask<count;mask++) {
    const previous=states.get(mask);if(!previous)continue;
    for(let i=0;i<lanes.length;i++)if(!(mask&(1<<i))) {
      const next=mask|(1<<i),cost=previous.cost+cut[next],key=previous.key+i;
      const other=states.get(next);
      if(!other||cost<other.cost||cost===other.cost&&key<other.key)states.set(next,{cost,order:[...previous.order,i],key});
    }
  }
  return states.get(count-1)!.order.map(i=>lanes[i]);
}
