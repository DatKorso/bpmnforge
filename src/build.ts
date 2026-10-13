import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { BplmError } from './domain.ts';
import { validateProcess } from './validate.ts';
import { layoutProcess } from './layout.ts';
import { exportBpmn } from './bpmn.ts';
import { renderStandaloneHtml } from './html.ts';
export interface BuildOptions { sourcePath: string; htmlPath?: string; bpmnPath?: string }
export function outputPaths(options: BuildOptions) {
  const sourcePath = resolve(options.sourcePath); const stem = sourcePath.slice(0, -extname(sourcePath).length);
  return { sourcePath, htmlPath: resolve(options.htmlPath ?? `${stem}.html`), bpmnPath: resolve(options.bpmnPath ?? `${stem}.bpmn`) };
}
export async function prepareProcess(options: BuildOptions) {
  const paths = outputPaths(options); let text: string;
  try { text = await readFile(paths.sourcePath, 'utf8'); } catch { throw new BplmError(2, 'PATH: cannot read source'); }
  let data: unknown; try { data = JSON.parse(text); } catch { throw new BplmError(1, 'JSON: invalid source JSON'); }
  const { model, diagnostics } = await validateProcess(data, paths); const geometry = layoutProcess(model);
  return { ...paths, model, diagnostics, geometry };
}
export async function buildProcess(options: BuildOptions) {
  const result = await prepareProcess(options); const xml = await exportBpmn(result.model, result.geometry); const html = await renderStandaloneHtml(result.model, result.geometry, xml);
  try { await writeFile(result.htmlPath, html); await writeFile(result.bpmnPath, xml); } catch { throw new BplmError(2, 'PATH: cannot publish output'); }
  return result;
}
