import { readFile } from 'node:fs/promises';
import { BpmnForgeError } from './domain.ts';
import { buildProcess, prepareProcess, type BuildOptions } from './build.ts';
export async function runCli(args: string[], io = { out: (text: string) => console.log(text), err: (text: string) => console.error(text) }): Promise<number> {
  const json = args.includes('--json');
  const command = args[0];
  try {
    const [, sourcePath, ...flags] = args;
    if (command === 'version' && args.length === 1) { const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')); io.out(pkg.version); return 0; }
    if (!['build', 'validate'].includes(command) || !sourcePath || sourcePath.startsWith('--')) throw new BpmnForgeError(2, 'Usage: bpmnforge validate|build source.bpmnforge.json [--json] [--layout auto|grid|graph] [--html output.html] [--bpmn output.bpmn]; bpmnforge version');
    const options: BuildOptions = { sourcePath };
    const seen = new Set<string>();
    for (let i = 0; i < flags.length;) {
      const flag = flags[i];
      if (flag === '--json' && !seen.has(flag)) { seen.add(flag); i++; continue; }
      const value = flags[i + 1];
      if (!['--html', '--bpmn', '--layout'].includes(flag) || !value || value.startsWith('--') || seen.has(flag)) throw new BpmnForgeError(2, 'ARGUMENT: invalid output option');
      if (flag === '--layout' && !['auto', 'grid', 'graph'].includes(value)) throw new BpmnForgeError(2, 'ARGUMENT: layout must be auto, grid or graph');
      seen.add(flag); if (flag === '--layout') options.layout = value as BuildOptions['layout']; else if (flag === '--html') options.htmlPath = value; else options.bpmnPath = value; i += 2;
    }
    const result = command === 'build' ? await buildProcess(options) : await prepareProcess(options);
    if (json) { io.out(JSON.stringify({ status: 'ok', command, diagnostics: result.diagnostics, geometry: result.geometry, readability: result.readability, outputs: { html: result.htmlPath, bpmn: result.bpmnPath } })); return 0; }
    for (const diagnostic of result.diagnostics) io.err(`${diagnostic.severity} ${diagnostic.code} [${diagnostic.id}]: ${diagnostic.message}`);
    io.out(command === 'build' ? 'Built HTML and BPMN' : 'Valid process'); return 0;
  } catch (error) {
    if (error instanceof BpmnForgeError) {
      if (json) { io.out(JSON.stringify({ status: 'error', command, code: error.code, diagnostics: error.diagnostics.length ? error.diagnostics : [{ code: error.message.match(/^([A-Z_]+):/)?.[1] ?? 'ERROR', id: args[1] ?? 'cli', message: error.message, severity: 'error' }] })); return error.code; }
      if (error.diagnostics.length) for (const diagnostic of error.diagnostics) io.err(`${diagnostic.code} [${diagnostic.id}]: ${diagnostic.message}`); else io.err(error.message); return error.code;
    }
    if (json) { io.out(JSON.stringify({ status: 'error', command, code: 3, diagnostics: [{ code: 'INTERNAL', id: args[1] ?? 'cli', message: 'Unexpected generator error', severity: 'error' }] })); return 3; }
    io.err('INTERNAL: unexpected generator error'); return 3;
  }
}
