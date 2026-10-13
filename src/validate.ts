import { BplmError } from './domain.ts';
import type { ProcessDocument, Diagnostic } from './domain.ts';
export async function validateProcess(input: unknown, _options: { htmlPath: string }): Promise<{ model: ProcessDocument; diagnostics: Diagnostic[] }> {
  const model = input as ProcessDocument;
  if (model?.version !== 1 || !Array.isArray(model.nodes) || !Array.isArray(model.flows) || !Array.isArray(model.processes)) throw new BplmError(1, 'SCHEMA: invalid process document');
  return { model, diagnostics: [] };
}
