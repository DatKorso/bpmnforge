import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { minimal, calls } from './fixtures/models.ts';

test('real npm install of tgz works in a clean Unicode consumer with independent dependencies', { timeout: 240_000 }, async () => {
  const root = resolve('.'), dir = await mkdtemp(join(tmpdir(), 'bplm пакет с пробелами '));
  try {
    const packed = spawnSync('npm', ['pack', '--pack-destination', dir, '--json'], { cwd: root, encoding: 'utf8', timeout: 90_000 });
    assert.equal(packed.status, 0, packed.stderr);
    const parsed = JSON.parse(packed.stdout), manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0] as any;
    const files = manifest.files.map((file: any) => file.path) as string[];
    for (const expected of ['LICENSE', 'assets/THIRD-PARTY-NOTICES.txt', 'assets/bpmn-js-LICENSE.txt', 'docs/USER-GUIDE.md', 'docs/LLM-GUIDE.md', 'CHANGELOG.md', 'schema/bplm.schema.json']) assert.ok(files.includes(expected), expected);
    assert.ok(files.every(file => !/^(examples|tests|\.planning|private|\.private)\//.test(file) && !file.endsWith('.DS_Store')));
    const project = join(dir, 'Новый проект'); await mkdir(project);
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'bplm-synthetic-consumer', version: '1.0.0', private: true }));
    const installed = spawnSync('npm', ['install', '--no-audit', '--no-fund', join(dir, manifest.filename)], { cwd: project, encoding: 'utf8', timeout: 120_000 });
    assert.equal(installed.status, 0, installed.stderr);
    const bin = join(project, 'node_modules', '.bin', 'bplm');
    const cli = (args: string[]) => spawnSync(process.execPath, [bin, ...args], { cwd: project, encoding: 'utf8' });
    assert.equal(cli(['version']).stdout.trim(), '0.1.0');
    const source = join(project, 'исходный процесс.bplm.json');
    const html = join(project, 'исходный процесс.bplm.html'), bpmn = join(project, 'исходный процесс.bplm.bpmn');
    for (const model of [minimal, calls()]) {
      await writeFile(source, JSON.stringify(model));
      for (const command of ['validate', 'build']) {
        const result = cli([command, source, '--json']); assert.equal(result.status, 0, result.stderr + result.stdout);
        assert.equal(JSON.parse(result.stdout).status, 'ok');
      }
      const oldHtml = await readFile(html, 'utf8'), oldBpmn = await readFile(bpmn, 'utf8');
      const data = JSON.parse(oldHtml.match(/id="bplm-data">([\s\S]*?)<\/script>/)![1]);
      assert.equal(data.xml, oldBpmn); assert.deepEqual(data.model, model);
      assert.ok(oldHtml.includes('watermark must stay fully visible'));
      const broken = structuredClone(model); broken.nodes[1].id = 'constructor';
      await writeFile(source, JSON.stringify(broken));
      for (const command of ['validate', 'build']) {
        const result = cli([command, source, '--json']); assert.equal(result.status, 1);
        assert.ok(JSON.parse(result.stdout).diagnostics.some((item: any) => item.code === 'RESERVED_ID' && item.id === 'constructor'));
      }
      assert.equal(await readFile(html, 'utf8'), oldHtml); assert.equal(await readFile(bpmn, 'utf8'), oldBpmn);
      if (model.id === 'Calls') {
        const brokenCall = structuredClone(model); brokenCall.nodes[1].calledElement = 'MissingProcess';
        await writeFile(source, JSON.stringify(brokenCall));
        const result = cli(['build', source, '--json']); assert.equal(result.status, 1);
        assert.ok(JSON.parse(result.stdout).diagnostics.some((item: any) => item.code === 'CALL_TARGET' && item.id === 'Check'));
        assert.equal(await readFile(html, 'utf8'), oldHtml); assert.equal(await readFile(bpmn, 'utf8'), oldBpmn);
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
