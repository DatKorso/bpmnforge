import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, symlink, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProcess, prepareProcess, publishArtifacts } from '../src/build.ts';
import * as buildModule from '../src/build.ts';
import { BpmnForgeError } from '../src/domain.ts';
import { layoutProcess } from '../src/layout.ts';
import { runCli } from '../src/cli.ts';
import type { ProcessDocument } from '../src/domain.ts';
const fixture = JSON.parse(await readFile(new URL('./fixtures/minimal.json', import.meta.url), 'utf8')) as ProcessDocument;
const silence = { out: (_text: string) => {}, err: (_text: string) => {} };

test('validate and build return RESERVED_ID and exit 1, preserving prior outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge reserved '));
  try {
    const source = join(dir, 'input.json'), html = join(dir, 'out.html'), bpmn = join(dir, 'out.bpmn');
    await writeFile(html, 'previous HTML'); await writeFile(bpmn, 'previous BPMN');
    for (const id of Object.getOwnPropertyNames(Object.prototype)) {
      const model = structuredClone(fixture);
      model.nodes[1].id = id; model.flows[0].target = id; model.flows[1].source = id;
      await writeFile(source, JSON.stringify(model));
      for (const command of ['validate', 'build']) {
        let output = '';
        const code = await runCli([command, source, '--json', '--html', html, '--bpmn', bpmn], { out: text => { output = text; }, err: () => {} });
        assert.equal(code, 1);
        assert.ok(JSON.parse(output).diagnostics.some((item: any) => item.id === id && item.code === 'RESERVED_ID'));
      }
      assert.equal(await readFile(html, 'utf8'), 'previous HTML'); assert.equal(await readFile(bpmn, 'utf8'), 'previous BPMN');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('publication restores both prior files after an injected second-file failure', async () => {
  assert.equal(typeof (buildModule as any).publishArtifacts, 'function', 'rollback-safe publisher must exist');
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge rollback '));
  try {
    const html = join(dir, 'old.html'), bpmn = join(dir, 'old.bpmn'); await writeFile(html, 'old HTML'); await writeFile(bpmn, 'old BPMN');
    await assert.rejects((buildModule as any).publishArtifacts([{ path: html, content: 'new HTML' }, { path: bpmn, content: 'new BPMN' }], { hook: (event: string, index: number) => { if (event === 'after-replace' && index === 1) throw new Error('Injected failure'); } }));
    assert.equal(await readFile(html, 'utf8'), 'old HTML'); assert.equal(await readFile(bpmn, 'utf8'), 'old BPMN'); assert.deepEqual((await readdir(dir)).sort(), ['old.bpmn', 'old.html']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('two builds are byte-identical and omit environment-specific output paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge deterministic '));
  try { const sourcePath = join(dir, 'input.json'); await writeFile(sourcePath, JSON.stringify(fixture)); const options = { sourcePath, htmlPath: join(dir, 'result.html'), bpmnPath: join(dir, 'result.bpmn') }; await buildProcess(options); const first = [await readFile(options.htmlPath), await readFile(options.bpmnPath)]; await buildProcess(options); assert.deepEqual(await readFile(options.htmlPath), first[0]); assert.deepEqual(await readFile(options.bpmnPath), first[1]); assert.ok(!first[0].toString().includes(dir)); assert.ok(!first[1].toString().includes(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
});
test('stage, lane and cell hints control deterministic shared geometry', () => {
  const model = structuredClone(fixture); model.stages.push({ id: 'Second', name: 'Второй этап' }); model.lanes.push({ id: 'Reviewer', name: 'Ревьюер', process: 'Work' }); model.nodes[1].stage = 'Second'; model.nodes[1].lane = 'Reviewer'; model.nodes[1].column = 2; model.nodes[1].row = 1;
  const g = layoutProcess(model); assert.ok(g.shapes.Check.x > g.shapes.End.x); assert.ok(g.shapes.Check.y > g.shapes.End.y); assert.ok(g.stages.Second.x > g.stages.Review.x); assert.ok(g.shapes.Reviewer.y > g.shapes.Agent.y); assert.deepEqual(layoutProcess(model), g);
});
test('invalid cell and non-orthogonal route hints fail before output publication', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge bad hint '));
  try { const sourcePath = join(dir, 'source.json'); const model = structuredClone(fixture); model.nodes[1].column = 0; await writeFile(sourcePath, JSON.stringify(model)); await assert.rejects(prepareProcess({ sourcePath }), (error: unknown) => error instanceof BpmnForgeError && error.code === 1); delete model.nodes[1].column; model.flows[0].route = [{ x: 1, y: 1 }, { x: 2, y: 2 }]; await writeFile(sourcePath, JSON.stringify(model)); await assert.rejects(prepareProcess({ sourcePath }), (error: unknown) => error instanceof BpmnForgeError && error.code === 1); } finally { await rm(dir, { recursive: true, force: true }); }
});
test('CLI invocation and path errors return 2 and unexpected failures return 3', async () => {
  for (const args of [[], ['build'], ['unknown'], ['build', 'missing.json'], ['version', 'extra'], ['build', 'input.json', '--wat', 'x'], ['build', 'input.json', '--html']]) assert.equal(await runCli(args, silence), 2);
  assert.equal(await runCli(['version'], { out: () => { throw new Error('Unexpected'); }, err: () => {} }), 3);
});
test('source/output aliases, output directories, symlinks and hardlinks are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge path guards '));
  try { const sourcePath = join(dir, 'source.json'); await writeFile(sourcePath, JSON.stringify(fixture)); const same = join(dir, 'same'); await mkdir(same);
    for (const options of [{ sourcePath, htmlPath: sourcePath }, { sourcePath, htmlPath: same }, { sourcePath, htmlPath: join(dir, 'out'), bpmnPath: join(dir, 'out') }, { sourcePath, htmlPath: join(dir, 'absent', 'out') }]) await assert.rejects(buildProcess(options), (error: unknown) => error instanceof BpmnForgeError && error.code === 2);
    const alias = join(dir, 'alias'); await symlink(sourcePath, alias); await assert.rejects(buildProcess({ sourcePath, htmlPath: alias }), (e: unknown) => e instanceof BpmnForgeError && e.code === 2); await rm(alias); await link(sourcePath, alias); await assert.rejects(buildProcess({ sourcePath, htmlPath: alias }), (e: unknown) => e instanceof BpmnForgeError && e.code === 2);
    assert.deepEqual(JSON.parse(await readFile(sourcePath, 'utf8')), fixture);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('validation and build share diagnostics and do not modify old outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge shared validation '));
  try { const model = structuredClone(fixture); model.flows[0].target = 'Missing'; const sourcePath = join(dir, 'source.json'), htmlPath = join(dir, 'result.html'), bpmnPath = join(dir, 'result.bpmn'); await writeFile(sourcePath, JSON.stringify(model)); await writeFile(htmlPath, 'old HTML'); await writeFile(bpmnPath, 'old BPMN'); const diagnostics: unknown[] = []; for (const fn of [prepareProcess, buildProcess]) { try { await fn({ sourcePath, htmlPath, bpmnPath }); assert.fail('Expected invalid source'); } catch (e) { assert.ok(e instanceof BpmnForgeError); diagnostics.push(e.diagnostics); } } assert.deepEqual(diagnostics[0], diagnostics[1]); assert.equal(await readFile(htmlPath, 'utf8'), 'old HTML'); assert.equal(await readFile(bpmnPath, 'utf8'), 'old BPMN'); } finally { await rm(dir, { recursive: true, force: true }); }
});
test('publication restores prior or absent outputs at each replacement boundary', async () => {
  for (const old of [true, false]) for (const event of ['before-replace', 'after-replace'] as const) for (const failIndex of [0, 1]) {
    const dir = await mkdtemp(join(tmpdir(), 'bpmnforge failure boundaries '));
    try {
      const paths = [join(dir, 'first.html'), join(dir, 'second.bpmn')];
      if (old) for (const path of paths) await writeFile(path, 'prior bytes');
      await assert.rejects(publishArtifacts(paths.map(path => ({ path, content: 'new bytes' })), { hook: (point, index) => { if (point === event && index === failIndex) throw new Error('Injected failure'); } }));
      if (old) for (const path of paths) assert.equal(await readFile(path, 'utf8'), 'prior bytes');
      assert.deepEqual((await readdir(dir)).sort(), old ? ['first.html', 'second.bpmn'] : []);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
test('valid explicit route hints are reused verbatim in the shared geometry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge explicit route '));
  try {
    const model = structuredClone(fixture); const route = layoutProcess(model).edges.ToCheck; model.flows[0].route = route;
    const sourcePath = join(dir, 'source.json'); await writeFile(sourcePath, JSON.stringify(model));
    assert.deepEqual((await prepareProcess({ sourcePath })).geometry.edges.ToCheck, route);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
