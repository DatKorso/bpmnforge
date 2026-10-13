export interface Named { id: string; name: string; description?: string; links?: { name: string; href: string }[]; bounds?: Bounds; labelBounds?: Bounds; external?: boolean }
export interface ProcessNode extends Named {
  type: 'start' | 'end' | 'task' | 'userTask' | 'serviceTask' | 'sendTask' | 'receiveTask' | 'businessRuleTask' | 'callActivity' | 'timerCatch' | 'conditionalStart' | 'terminateEnd' | 'eventSubProcess' | 'xor' | 'and'; process: string; lane?: string; stage: string;
  parent?: string; required?: boolean; defaultFlow?: string; calledElement?: string;
  timer?: { kind: 'timeDate' | 'timeDuration' | 'timeCycle'; expression: string }; condition?: string;
  column?: number; row?: number;
}
export interface Flow { id: string; name?: string; type: 'sequence' | 'message' | 'association'; originalType?: 'message'; source: string; target: string; condition?: string; return?: boolean; route?: Point[]; labelBounds?: Bounds }
export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }
export interface ProcessDocument extends Named {
  version: 1; stages: Named[]; processes: Named[]; pools: (Named & { process: string })[];
  lanes: (Named & { process: string })[]; nodes: ProcessNode[]; flows: Flow[];
  annotations?: (Named & { process: string; text: string; stage: string; lane?: string; column?: number; row?: number })[];
}
export interface Crossing { flows: [string, string]; point: Point; over: string }
export interface Geometry { shapes: Record<string, Bounds>; edges: Record<string, Point[]>; labels: Record<string, Bounds>; stages: Record<string, Bounds>; viewport: Bounds; crossings: Crossing[] }
export interface Diagnostic { code: string; id: string; message: string; severity: 'error' | 'warning' | 'info'; relatedIds?: string[]; point?: Point; bounds?: Bounds }
export class BplmError extends Error {
  code: number; diagnostics: Diagnostic[];
  constructor(code: number, message: string, diagnostics: Diagnostic[] = []) { super(message); this.code = code; this.diagnostics = diagnostics; }
}
