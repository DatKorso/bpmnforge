import type { Bounds, Diagnostic, Geometry, Point, ProcessDocument } from './domain.ts';

import { READABLE, boxDistance } from './profile.ts';
import { isVertex } from './ports.ts';
import { readingFragment, stageEntries } from './reading.ts';
const GAP = READABLE.routeGap;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (b: Bounds): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overlap = (a: Bounds, b: Bounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
};
interface Gap { flows: [string, string]; segments: [number, number]; gap: number; projection: number; point: Point; manual: boolean }
export function measureReadability(model: ProcessDocument, geometry: Geometry, layout: 'manual' | 'grid' | 'graph') {
  const flows = [...model.flows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const gaps: Gap[] = [], portGaps: Gap[] = [];
  let minimumParallelGap: number | null = null;
  for (let f = 0; f < flows.length; f++) for (let g = f + 1; g < flows.length; g++) {
    const left = flows[f], right = flows[g], a = geometry.edges[left.id] ?? [], b = geometry.edges[right.id] ?? [];
    const common = [left.source, left.target].filter(id => id === right.source || id === right.target).map(id => geometry.shapes[id]).filter(Boolean);
    for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
      const horizontal = a[i].y === a[i - 1].y;
      if (horizontal !== (b[j].y === b[j - 1].y)) continue;
      const axis = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x';
      const lo = Math.max(Math.min(a[i][axis], a[i - 1][axis]), Math.min(b[j][axis], b[j - 1][axis]));
      const hi = Math.min(Math.max(a[i][axis], a[i - 1][axis]), Math.max(b[j][axis], b[j - 1][axis]));
      if (hi <= lo) continue;
      const gap = Math.abs(a[i][cross] - b[j][cross]);
      const point = horizontal ? { x: (lo + hi) / 2, y: (a[i].y + b[j].y) / 2 } : { x: (a[i].x + b[j].x) / 2, y: (lo + hi) / 2 };
      const inFanout = common.some(box => {
        const low = horizontal ? box.x - 28 : box.y - 28, high = horizontal ? box.x + box.width + 28 : box.y + box.height + 28;
        return lo >= low && hi <= high;
      });
      if (!inFanout) minimumParallelGap = minimumParallelGap === null ? gap : Math.min(minimumParallelGap, gap);
      if (gap < GAP) (inFanout ? portGaps : gaps).push({ flows: [left.id, right.id], segments: [i - 1, j - 1], gap, projection: hi - lo, point, manual: !!(left.route || right.route) });
    }
  }
  const routes = flows.map(flow => {
    const route = geometry.edges[flow.id] ?? [];
    return { id: flow.id, type: flow.type, manual: !!flow.route, length: route.slice(1).reduce((sum, p, i) => sum + distance(p, route[i]), 0), bends: Math.max(0, route.length - 2) };
  });
  const lengths = routes.map(r => r.length).sort((a, b) => a - b);
  const labelMetrics = Object.entries(geometry.labels).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, box]) => {
    const route = geometry.edges[id], own = geometry.shapes[id];
    const boundaryDistance = route?.length ? Math.min(...route.slice(1).map((end, i) => boxDistance(box, { x: Math.min(end.x,route[i].x), y: Math.min(end.y,route[i].y), width: Math.abs(end.x-route[i].x), height: Math.abs(end.y-route[i].y) }))) : own ? boxDistance(box,own) : 0;
    const flow = flows.find(flow => flow.id === id), source = flow ? geometry.shapes[flow.source] : undefined;
    const collisions = Object.entries(geometry.shapes).filter(([otherId, other]) => otherId !== id && !model.pools.some(pool => pool.id === otherId) && !model.lanes.some(lane => lane.id === otherId) && !model.nodes.some(n => n.id === id && n.parent === otherId) && overlap(box, other)).map(([otherId]) => otherId);
    const clearances = [...Object.entries(geometry.shapes).filter(([otherId]) => otherId !== id && !model.pools.some(pool => pool.id === otherId) && !model.lanes.some(lane => lane.id === otherId) && !model.nodes.some(n => n.id === id && n.parent === otherId)), ...Object.entries(geometry.labels).filter(([otherId]) => otherId !== id)]
      .map(([otherId,other]) => ({id:otherId,gap:boxDistance(box,other)})).filter(item => item.gap < READABLE.labelGap);
    return { id, bounds: box, distanceToOwner: boundaryDistance, distanceToSource: source ? boxDistance(box,source) : null, collisions, clearances };
  });
  const intervalDeviations: { kind: string; id: string; relatedIds: string[]; gap: number; minimum: number; preferred: number; manual: boolean }[] = [];
  for (const flow of flows.filter(flow => flow.type === 'sequence' && !flow.return)) {
    const a = geometry.shapes[flow.source], b = geometry.shapes[flow.target]; if (!a || !b) continue;
    const gap = boxDistance(a,b);
    if (gap < READABLE.preferredStepGap) intervalDeviations.push({kind:'step',id:flow.id,relatedIds:[flow.source,flow.target],gap,minimum:READABLE.minimumStepGap,preferred:READABLE.preferredStepGap,manual:!!(model.nodes.find(n=>n.id===flow.source)?.bounds || model.nodes.find(n=>n.id===flow.target)?.bounds)});
  }
  // Compare occupied areas of adjacent logical rows, including external names.
  for (const lane of [...model.lanes, ...model.pools.filter(pool => !model.lanes.some(lane => lane.process === pool.process))]) {
    const members = [...model.nodes,...(model.annotations??[])].filter(n=>n.process===lane.process && (!('lane' in n) || !n.lane || n.lane===lane.id) && !('parent' in n && n.parent));
    const frame = geometry.shapes[lane.id];
    for (const item of members) {
      const boxes = [geometry.shapes[item.id],geometry.labels[item.id]].filter(Boolean);
      if (!frame || !boxes.length) continue;
      for (const box of boxes) {
        const gap = Math.min(box.x-frame.x-('lane' in item && item.lane ? 30 : 30),box.y-frame.y,frame.x+frame.width-box.x-box.width,frame.y+frame.height-box.y-box.height);
        if (gap < READABLE.lanePadding) { intervalDeviations.push({kind:'lane',id:item.id,relatedIds:[lane.id],gap,minimum:READABLE.lanePadding,preferred:READABLE.lanePadding,manual:!!(item.bounds||lane.bounds)});break; }
      }
    }
    for (let i=0;i<members.length;i++) for (let j=i+1;j<members.length;j++) {
      const a=members[i],b=members[j],ab=geometry.shapes[a.id],bb=geometry.shapes[b.id];
      if (!ab || !bb || a.stage!==b.stage || ab.y+ab.height/2===bb.y+bb.height/2 || ab.x+ab.width<=bb.x || bb.x+bb.width<=ab.x) continue;
      const gap=Math.min(...[ab,geometry.labels[a.id]].filter(Boolean).flatMap(x=>[bb,geometry.labels[b.id]].filter(Boolean).map(y=>boxDistance(x,y))));
      if(gap<READABLE.branchGap) intervalDeviations.push({kind:'branch',id:a.id,relatedIds:[b.id],gap,minimum:READABLE.branchGap,preferred:READABLE.branchGap,manual:!!(a.bounds||b.bounds)});
    }
  }
  const portExceptions = model.nodes.filter(node=>node.type==='xor'||node.type==='and').flatMap(node=>flows.flatMap(flow=>(['source','target'] as const).filter(side=>flow[side]===node.id).flatMap(side=>{
    const route=geometry.edges[flow.id], point=side==='source'?route?.[0]:route?.at(-1);
    if(!point || isVertex(point,geometry.shapes[node.id]))return [];
    return [{id:flow.id,gateway:node.id,side,point,manual:!!flow.route,degree:flows.reduce((n,f)=>n+Number(f.source===node.id)+Number(f.target===node.id),0)}];
  })));
  const shapeClearances: {id:string;relatedIds:string[];gap:number;point:Point;manual:boolean}[]=[];
  for(const flow of flows) {
    const route=geometry.edges[flow.id]??[];
    for(const node of [...model.nodes,...(model.annotations??[])]) {
      if(node.id===flow.source||node.id===flow.target||model.nodes.some(n=>n.parent===node.id&&(n.id===flow.source||n.id===flow.target)))continue;
      const box=geometry.shapes[node.id];if(!box)continue;
      const gap=Math.min(...route.slice(1).map((p,i)=>boxDistance(box,{x:Math.min(p.x,route[i].x),y:Math.min(p.y,route[i].y),width:Math.abs(p.x-route[i].x),height:Math.abs(p.y-route[i].y)})));
      if(gap<READABLE.shapeGap)shapeClearances.push({id:flow.id,relatedIds:[node.id],gap,point:center(box),manual:!!flow.route});
    }
  }
  const decorations: { code: string; id: string; relatedIds: string[]; point: Point; gap: number }[] = [];
  // Arrowheads occupy the final 10 units; bridge arcs occupy a 7-unit radius.
  for (const flow of flows) {
    const route = geometry.edges[flow.id]; if (!route?.length) continue;
    const tip = route.at(-1)!;
    for (const other of flows) {
      if (other.id === flow.id || [other.source, other.target].includes(flow.target)) continue;
      const points = geometry.edges[other.id] ?? [];
      const gap = Math.min(...points.slice(1).map((end, i) => segmentDistance(tip, points[i], end)));
      if (gap < GAP) decorations.push({ code: 'READABILITY_ARROW_CLEARANCE', id: flow.id, relatedIds: [other.id], point: tip, gap });
    }
  }
  for (let i = 0; i < geometry.crossings.length; i++) for (let j = i + 1; j < geometry.crossings.length; j++) {
    const a = geometry.crossings[i], b = geometry.crossings[j], gap = distance(a.point, b.point);
    if (gap < GAP && a.over === b.over) decorations.push({ code: 'READABILITY_BRIDGE_CLEARANCE', id: a.over, relatedIds: [...new Set([...a.flows, ...b.flows])], point: a.point, gap });
  }
  const diagnostics: Diagnostic[] = gaps.map(gap => ({ code: gap.manual ? 'MANUAL_ROUTE_CLEARANCE' : 'READABILITY_PARALLEL_CLEARANCE', id: gap.flows[0], relatedIds: [gap.flows[1]], point: gap.point, severity: 'warning', message: `Parallel routes have ${gap.gap} units of clearance over ${gap.projection}; recommended minimum is ${GAP}${gap.manual ? '; explicit route preserved' : ''}` }));
  for (const metric of labelMetrics) {
    if (metric.distanceToOwner > READABLE.labelOwnerDistance || (metric.distanceToSource !== null && metric.distanceToSource > READABLE.labelOwnerDistance)) diagnostics.push({ code: 'READABILITY_LABEL_DISTANCE', id: metric.id, bounds: metric.bounds, severity: 'warning', message: `Label boundary is ${Math.round(metric.distanceToOwner)} units from its owner${metric.distanceToSource === null ? '' : `; ${Math.round(metric.distanceToSource)} from the branch source`}` });
    if (metric.clearances.length) diagnostics.push({ code: 'READABILITY_LABEL_CLEARANCE', id: metric.id, relatedIds: metric.clearances.map(item=>item.id), bounds:metric.bounds, severity:'warning',message:`Label clearance is below ${READABLE.labelGap}` });
    if (metric.collisions.length) diagnostics.push({ code: 'READABILITY_LABEL_OVERLAP', id: metric.id, relatedIds: metric.collisions, bounds: metric.bounds, severity: 'warning', message: 'Label overlaps other content' });
  }
  diagnostics.push(...intervalDeviations.map(item=>({code:'READABILITY_INTERVAL',id:item.id,relatedIds:item.relatedIds,severity:'warning' as const,message:`${item.kind} interval ${Math.round(item.gap*10)/10}; minimum ${item.minimum}, preferred ${item.preferred}${item.manual?'; explicit geometry preserved':''}`})));
  diagnostics.push(...portExceptions.map(item=>({code:'READABILITY_GATEWAY_PORT_EXCEPTION',id:item.id,relatedIds:[item.gateway],point:item.point,severity:'warning' as const,message:`Gateway contour port used (${item.degree} connections)${item.manual?'; explicit route preserved':'; vertices exhausted or obstructed by fixed geometry'}`})));
  diagnostics.push(...shapeClearances.map(item=>({code:'READABILITY_SHAPE_CLEARANCE',id:item.id,relatedIds:item.relatedIds,point:item.point,severity:'warning' as const,message:`Route/shape clearance ${Math.round(item.gap*10)/10} is below ${READABLE.shapeGap}${item.manual?'; explicit route preserved':''}`})));
  diagnostics.push(...decorations.map(item => ({ code: item.code, id: item.id, relatedIds: item.relatedIds, point: item.point, severity: 'warning' as const, message: `Decoration clearance ${Math.round(item.gap * 10) / 10} is below ${GAP}` })));
  const readingFragments = model.stages.flatMap(stage=>stageEntries(model,geometry,stage.id).flatMap(entry=>[{width:1440,height:900},{width:1920,height:1080}].map(viewport=>{
    // Conservative standard desktop frame; the viewer records its exact outer
    // size and visibility separately in window.bpmnforgeReading after framing.
    const outer={width:viewport.width-24-READABLE.laneStrip,height:viewport.height-220};
    return {stage:stage.id,viewport,outer,...readingFragment(model,geometry,stage.id,entry.id,outer)!};
  })));
  for(const frame of readingFragments) if(!frame.entryFits || frame.missingSuccessors.length) diagnostics.push({code:'READABILITY_FRAGMENT_CONTEXT',id:frame.entry,relatedIds:frame.missingSuccessors,severity:'warning',message:`${frame.viewport.width}×${frame.viewport.height}: ${!frame.entryFits?'entry exceeds the readable frame':'next step needs the accessible navigation control'}`});
  return { profile: READABLE.id, intervalDeviations, portExceptions, shapeClearances, readingFragments, dimensions: {width:geometry.viewport.width,height:geometry.viewport.height}, layout, recommendedClearance: GAP, crossings: geometry.crossings.length, crossingsPer100Flows: flows.length ? geometry.crossings.length / flows.length * 100 : 0, minimumParallelGap, closeParallelSegments: gaps, portFanoutSegments: portGaps, routes, routeLength: { total: lengths.reduce((a,b) => a+b,0), median: lengths.length ? lengths.length % 2 ? lengths[(lengths.length-1)/2] : (lengths[lengths.length/2-1]+lengths[lengths.length/2])/2 : 0, max: lengths.at(-1) ?? 0 }, bends: routes.reduce((sum,r) => sum+r.bends,0), labels: labelMetrics, decorationClearances: decorations, diagnostics };
}
