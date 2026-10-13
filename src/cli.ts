import { readFile } from 'node:fs/promises';
import { BplmError } from './domain.ts';
import { buildProcess, prepareProcess } from './build.ts';
export async function runCli(args: string[], io = { out: (text: string) => console.log(text), err: (text: string) => console.error(text) }): Promise<number> {
  try {
    const [command, sourcePath, ...flags] = args;
    if (command === 'version' && args.length === 1) { const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')); io.out(pkg.version); return 0; }
    if (!['build', 'validate'].includes(command) || !sourcePath || sourcePath.startsWith('--')) throw new BplmError(2, 'Usage: bplm validate|build source.bplm.json [--html output.html] [--bpmn output.bpmn]; bplm version');
    const options: { sourcePath: string; htmlPath?: string; bpmnPath?: string } = { sourcePath };
    const seen = new Set<string>();
    for (let i = 0; i < flags.length; i += 2) { const flag = flags[i], value = flags[i + 1]; if (!['--html', '--bpmn'].includes(flag) || !value || value.startsWith('--') || seen.has(flag)) throw new BplmError(2, 'ARGUMENT: invalid output option'); seen.add(flag); if (flag === '--html') options.htmlPath = value; else options.bpmnPath = value; }
    const result = command === 'build' ? await buildProcess(options) : await prepareProcess(options);
    for (const diagnostic of result.diagnostics) io.err(`${diagnostic.severity} ${diagnostic.code} [${diagnostic.id}]: ${diagnostic.message}`);
    io.out(command === 'build' ? 'Built HTML and BPMN' : 'Valid process'); return 0;
  } catch (error) {
    if (error instanceof BplmError) { if (error.diagnostics.length) for (const diagnostic of error.diagnostics) io.err(`${diagnostic.code} [${diagnostic.id}]: ${diagnostic.message}`); else io.err(error.message); return error.code; }
    io.err('INTERNAL: unexpected generator error'); return 3;
  }
}
