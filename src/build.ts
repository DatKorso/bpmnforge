import { readFile, writeFile, stat, lstat, realpath, rename, rm } from 'node:fs/promises';
import { resolve, extname, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BpmnForgeError } from './domain.ts';
import { validateProcess } from './validate.ts';
import { layoutProcess } from './layout.ts';
import { exportBpmn } from './bpmn.ts';
import { renderStandaloneHtml } from './html.ts';
export interface BuildOptions { sourcePath: string; htmlPath?: string; bpmnPath?: string }
export function outputPaths(options: BuildOptions) {
  const sourcePath = resolve(options.sourcePath); const extension = extname(sourcePath); const stem = extension ? sourcePath.slice(0, -extension.length) : sourcePath;
  const htmlPath = resolve(options.htmlPath ?? `${stem}.html`), bpmnPath = resolve(options.bpmnPath ?? `${stem}.bpmn`);
  if (new Set([sourcePath, htmlPath, bpmnPath]).size !== 3) throw new BpmnForgeError(2, 'PATH: source and outputs must be distinct');
  return { sourcePath, htmlPath, bpmnPath };
}
async function checkPaths(paths: ReturnType<typeof outputPaths>) {
  try {
    const source = await stat(paths.sourcePath); if (!source.isFile()) throw new BpmnForgeError(2, 'PATH: source must be a regular file');
    if (source.size > 4 * 1024 * 1024) throw new BpmnForgeError(1, 'SOURCE_SIZE: source exceeds 4 MiB');
    const identities = new Set([`${source.dev}:${source.ino}`]); const canonical = new Set([await realpath(paths.sourcePath)]);
    for (const path of [paths.htmlPath, paths.bpmnPath]) {
      const parent = await realpath(dirname(path)); if (!(await stat(parent)).isDirectory()) throw new BpmnForgeError(2, 'PATH: output parent must be a directory');
      const key = resolve(parent, basename(path)); if (canonical.has(key)) throw new BpmnForgeError(2, 'PATH: output aliases source or another output'); canonical.add(key);
      let info; try { info = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (info) { if (!info.isFile() || info.isSymbolicLink()) throw new BpmnForgeError(2, 'PATH: output must be a regular file'); const identity = `${info.dev}:${info.ino}`; if (identities.has(identity)) throw new BpmnForgeError(2, 'PATH: output aliases source or another output'); identities.add(identity); }
    }
  } catch (error) { if (error instanceof BpmnForgeError) throw error; throw new BpmnForgeError(2, 'PATH: source or output directory is unavailable'); }
}
export async function prepareProcess(options: BuildOptions) {
  const paths = outputPaths(options); let text: string;
  await checkPaths(paths);
  try { text = await readFile(paths.sourcePath, 'utf8'); } catch { throw new BpmnForgeError(2, 'PATH: cannot read source'); }
  let data: unknown; try { data = JSON.parse(text); } catch { throw new BpmnForgeError(1, 'JSON: invalid source JSON'); }
  const { model, diagnostics } = await validateProcess(data, paths); const geometry = layoutProcess(model);
  for (const crossing of geometry.crossings) diagnostics.push({ code: 'ACCEPTED_CROSSING', id: crossing.over, relatedIds: crossing.flows, point: crossing.point, message: `Right-angle crossing of ${crossing.flows.join(' and ')} accepted with a bridge`, severity: 'info' });
  return { ...paths, model, diagnostics, geometry };
}
export async function buildProcess(options: BuildOptions) {
  const result = await prepareProcess(options); const xml = await exportBpmn(result.model, result.geometry);
  const unavailableDocuments = result.diagnostics.filter(item => item.code === 'MISSING_DOCUMENT' && item.href).map(item => ({ id: item.id, href: item.href! }));
  const html = await renderStandaloneHtml(result.model, result.geometry, xml, unavailableDocuments);
  await publishArtifacts([{ path: result.htmlPath, content: html }, { path: result.bpmnPath, content: xml }]);
  return result;
}

export async function publishArtifacts(artifacts: { path: string; content: string }[], options: { hook?: (event: 'before-replace' | 'after-replace', index: number) => void | Promise<void> } = {}): Promise<void> {
  const entries = artifacts.map(artifact => ({ ...artifact, temp: `${artifact.path}.tmp-${randomUUID()}`, backup: `${artifact.path}.bak-${randomUUID()}`, backedUp: false, replaced: false }));
  let rollbackFailed = false;
  try {
    if (new Set(entries.map(entry => resolve(entry.path))).size !== entries.length) throw new BpmnForgeError(2, 'PATH: duplicate publication targets');
    for (const entry of entries) {
      let info; try { info = await lstat(entry.path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (info && (!info.isFile() || info.isSymbolicLink())) throw new BpmnForgeError(2, 'PATH: output must be a regular file');
      await writeFile(entry.temp, entry.content, { flag: 'wx' });
      if (await readFile(entry.temp, 'utf8') !== entry.content) throw new BpmnForgeError(3, 'PUBLISH: temporary artifact verification failed');
    }
    for (const [index, entry] of entries.entries()) {
      await options.hook?.('before-replace', index);
      try { await rename(entry.path, entry.backup); entry.backedUp = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(entry.temp, entry.path); entry.replaced = true;
      await options.hook?.('after-replace', index);
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      try { if (entry.replaced) await rm(entry.path, { force: true }); if (entry.backedUp) { await rename(entry.backup, entry.path); entry.backedUp = false; } } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) throw new BpmnForgeError(3, 'PUBLISH_ROLLBACK: restoration failed; adjacent backups retained');
    if (error instanceof BpmnForgeError) throw error;
    throw new BpmnForgeError(typeof (error as NodeJS.ErrnoException).code === 'string' ? 2 : 3, 'PUBLISH: artifacts were not published; previous outputs restored');
  } finally {
    for (const entry of entries) { await rm(entry.temp, { force: true }).catch(() => {}); if (!rollbackFailed) await rm(entry.backup, { force: true }).catch(() => {}); }
  }
}
