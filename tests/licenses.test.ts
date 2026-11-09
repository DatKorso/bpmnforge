import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectBrowserLicenses } from '../scripts/licenses.mjs';

test('all emitted browser dependencies have sorted license notices, deterministically', async () => {
  const result = await build({ entryPoints: ['src/viewer.ts'], bundle: true, write: false, minify: true, metafile: true });
  const notices = await collectBrowserLicenses(result.metafile);
  assert.equal(notices, await collectBrowserLicenses(result.metafile));
  assert.equal(notices, await readFile(new URL('../assets/THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8'));
  for (const name of ['bpmn-js', 'bpmn-moddle', 'diagram-js', 'didi', 'min-dash', 'min-dom', 'moddle', 'moddle-xml', 'tiny-svg']) assert.ok(notices.includes(`${name}@`), name);
  assert.match(notices, /watermark must stay fully visible/);
  const names = [...notices.matchAll(/^([^\n]+@[^\n]+)\nLicense:/gm)].map(match => match[1]);
  assert.deepEqual(names, [...names].sort());
});

test('a bundled component without a license fails; an unused input is excluded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge licensing '));
  try {
    const dependency = join(dir, 'node_modules', 'synthetic'); await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'synthetic', version: '1.0.0', license: 'MIT' }));
    const metadata = { inputs: {}, outputs: { 'viewer.js': { imports: [], exports: [], entryPoint: 'src/viewer.ts', inputs: { 'node_modules/synthetic/index.js': { bytesInOutput: 1 }, 'node_modules/unused/index.js': { bytesInOutput: 0 } }, bytes: 1 } } };
    await assert.rejects(collectBrowserLicenses(metadata, dir), /Missing license text: synthetic@1.0.0/);
    await writeFile(join(dependency, 'LICENSE'), 'Synthetic license text.');
    assert.match(await collectBrowserLicenses(metadata, dir), /Synthetic license text/);
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'synthetic', version: '1.0.0' }));
    await assert.rejects(collectBrowserLicenses(metadata, dir), /Missing license metadata/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
