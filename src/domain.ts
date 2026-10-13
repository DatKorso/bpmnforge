export interface Named { id: string; name: string; description?: string; links?: { name: string; href: string }[] }
export interface ProcessNode extends Named {
  type: 'start' | 'end' | 'task' | 'xor' | 'and'; process: string; lane?: string; stage: string;
  required?: boolean; defaultFlow?: string; column?: number; row?: number;
}
export interface Flow extends Named { type: 'sequence' | 'message' | 'association'; source: string; target: string; condition?: string; return?: boolean; route?: Point[] }
export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }
export interface ProcessDocument extends Named {
  version: 1; stages: Named[]; processes: Named[]; pools: (Named & { process: string })[];
  lanes: (Named & { process: string })[]; nodes: ProcessNode[]; flows: Flow[];
  annotations?: (Named & { process: string; text: string; stage: string; lane?: string; column?: number; row?: number })[];
}
export interface Geometry { shapes: Record<string, Bounds>; edges: Record<string, Point[]>; labels: Record<string, Bounds>; stages: Record<string, Bounds>; viewport: Bounds }
export interface Diagnostic { code: string; id: string; message: string; severity: 'error' | 'warning' }
export class BplmError extends Error {
  code: number; diagnostics: Diagnostic[];
  constructor(code: number, message: string, diagnostics: Diagnostic[] = []) { super(message); this.code = code; this.diagnostics = diagnostics; }
}
