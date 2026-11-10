import type { Bounds, Geometry, ProcessDocument } from './domain.ts';
import { READABLE } from './profile.ts';

export function unionBounds(boxes: Bounds[]): Bounds {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x+b.width))-x, height: Math.max(...boxes.map(b => b.y+b.height))-y };
}
export function readingNodeBounds(geometry: Geometry, id: string): Bounds {
  return geometry.labels[id] ? unionBounds([geometry.shapes[id],geometry.labels[id]]) : geometry.shapes[id];
}
export function stageEntries(model: ProcessDocument, geometry: Geometry, stage: string) {
  const nodes = model.nodes.filter(n=>n.stage===stage && !n.parent && n.type!=='eventSubProcess');
  const byId = new Map(model.nodes.map(n=>[n.id,n]));
  const incoming = new Set(model.flows.filter(f=>f.type==='sequence' && !f.return && byId.get(f.source)?.stage!==stage).map(f=>f.target));
  const ordered = (items: typeof nodes) => items.sort((a,b)=>geometry.shapes[a.id].x-geometry.shapes[b.id].x || geometry.shapes[a.id].y-geometry.shapes[b.id].y || (a.id<b.id?-1:a.id>b.id?1:0));
  const interstage = ordered(nodes.filter(n=>incoming.has(n.id)));
  const starts = ordered(nodes.filter(n=>!incoming.has(n.id) && (n.type==='start'||n.type==='conditionalStart')));
  return interstage.length || starts.length ? [...interstage,...starts] : ordered(nodes).slice(0,1);
}
/** Entry -> successor -> nearest fork/second step -> remaining neighbors.
 * Scale is chosen from the entire candidate frame, rather than fixed at 125%.
 */
export function readingFragment(model: ProcessDocument, geometry: Geometry, stage: string, entry: string, outer: {width:number;height:number}) {
  const byId = new Map(model.nodes.map(n=>[n.id,n]));
  const selected = byId.get(entry) ?? stageEntries(model,geometry,stage)[0];
  if (!selected) return null;
  const fit = (box: Bounds) => Math.min((outer.width-READABLE.viewportMargin*2)/box.width,(outer.height-READABLE.viewportMargin*2)/box.height);
  const outgoing = (id: string) => model.flows.filter(f=>f.source===id && f.type==='sequence' && !f.return && byId.get(f.target)?.stage===stage)
    .sort((a,b)=>{ const aa=geometry.shapes[a.target],bb=geometry.shapes[b.target],origin=geometry.shapes[id];return Math.abs(aa.x-origin.x)+Math.abs(aa.y-origin.y)-Math.abs(bb.x-origin.x)-Math.abs(bb.y-origin.y) || (a.id<b.id?-1:a.id>b.id?1:0); });
  const immediate = outgoing(selected.id);
  const second = immediate.flatMap(f=>outgoing(f.target)).sort((a,b)=>Number(['xor','and'].includes(byId.get(b.target)!.type))-Number(['xor','and'].includes(byId.get(a.target)!.type)) || (a.id<b.id?-1:a.id>b.id?1:0));
  const incoming = model.flows.filter(f=>f.type==='sequence'&&!f.return&&f.target===selected.id&&byId.get(f.source)?.stage===stage);
  const candidates = [immediate[0],...second,...immediate.slice(1),...incoming].filter(Boolean);
  const visible = new Set([selected.id]); let bounds = readingNodeBounds(geometry,selected.id);
  for(const flow of candidates) {
    const next = flow.target===selected.id?flow.source:flow.target;
    if(visible.has(next))continue;
    const candidate = unionBounds([bounds,readingNodeBounds(geometry,next)]);
    if(fit(candidate)+1e-9<READABLE.minimumReadScale)continue;
    bounds=candidate;visible.add(next);
    // Include a branch condition only if it does not hide the next step.
    const label=geometry.labels[flow.id];
    if(label){const withLabel=unionBounds([bounds,label]);if(fit(withLabel)>=READABLE.minimumReadScale)bounds=withLabel;}
  }
  const missingSuccessors = immediate.filter(f=>!visible.has(f.target)).map(f=>f.target);
  const scale = Math.min(READABLE.preferredReadScale,Math.max(READABLE.minimumReadScale,Math.floor(fit(bounds)*1000)/1000));
  return {entry:selected.id,bounds,scale,visible:[...visible],missingSuccessors,entryFits:fit(readingNodeBounds(geometry,selected.id))>=READABLE.minimumReadScale};
}
