import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { buildProcess } from '../src/build.ts';
import type { ProcessDocument } from '../src/domain.ts';

const root = resolve('.');
const simple = JSON.parse(await readFile(new URL('./fixtures/minimal.json', import.meta.url), 'utf8')) as ProcessDocument;
import { fullProfile } from './fixtures/models.ts';
const launch = () => chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });

test('consumer bin handles Unicode paths and standalone HTML opens offline at both required sizes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'BPMN Forge проект с пробелами ')); const browser = await launch();
  try {
    const commands = join(dir, 'команды'); const out = join(dir, 'Результат процесса'); const docs = join(out, 'документы');
    await mkdir(commands); await mkdir(docs, { recursive: true }); await symlink(join(root, 'bin/bpmnforge.mjs'), join(commands, 'bpmnforge'));
    const source = join(dir, 'описание процесса.bpmnforge.json'), html = join(out, 'схема процесса.html'), bpmn = join(out, 'схема процесса.bpmn');
    const model = fullProfile(); model.name = '</script><script>window.pwned=true</script>'; model.nodes[1].description = '<img src=x onerror="window.pwned=true">'; model.nodes[1].links = [{ name: '<img onerror=alert(1)>Документ', href: 'документы/инструкция.html' }, { name: 'HTTPS', href: 'https://example.org/help' }];
    for (const [kind, item] of [['Stage', model.stages[0]], ['Process', model.processes[0]], ['Pool', model.pools[0]], ['Lane', model.lanes[0]], ['Annotation', model.annotations![0]], ['Document', model]] as const) item.links = [{ name: `${kind} document`, href: 'документы/инструкция.html' }];
    await writeFile(join(docs, 'инструкция.html'), '<!doctype html><title>Инструкция</title><p>Локальный документ</p>'); await writeFile(source, JSON.stringify(model));
    const env = { ...process.env, PATH: `${commands}:${process.env.PATH}` };
    for (const command of ['validate', 'build']) { const result = spawnSync('bpmnforge', [command, source, '--html', html, '--bpmn', bpmn], { cwd: dir, encoding: 'utf8', env }); assert.equal(result.status, 0, result.stderr); assert.ok(!result.stderr.includes('MISSING_DOCUMENT')); }
    const xml = await readFile(bpmn, 'utf8'); const htmlFirst = await readFile(html); const xmlFirst = await readFile(bpmn);
    const repeated = spawnSync('bpmnforge', ['build', source, '--html', html, '--bpmn', bpmn], { cwd: dir, encoding: 'utf8', env }); assert.equal(repeated.status, 0, repeated.stderr); assert.deepEqual(await readFile(html), htmlFirst); assert.deepEqual(await readFile(bpmn), xmlFirst);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ offline: true, viewport }); const page = await context.newPage(); const requests: string[] = []; const errors: string[] = [];
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); }); page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(html).href); await page.waitForSelector('body[data-ready="true"]');
      for (const node of [...model.nodes, ...model.pools, ...model.lanes, ...(model.annotations ?? [])]) assert.equal(await page.locator(`.djs-shape[data-element-id="${node.id}"]`).count(), 1, node.id);
      for (const flow of model.flows) assert.equal(await page.locator(`.djs-connection[data-element-id="${flow.id}"]`).count(), 1, flow.id);
      assert.equal(await page.locator('h1').textContent(), model.name); assert.equal(await page.evaluate(() => (window as any).pwned), undefined);
      assert.equal(await page.locator('body > script').count(), 2); assert.equal(await page.locator('.bjs-powered-by').isVisible(), true);
      assert.equal(await page.locator('#documents-panel').count(), 0);
      const embedded = await page.locator('#bpmnforge-data').textContent(); const data = JSON.parse(embedded!); assert.equal(data.xml, xml);
      const rendered = await page.evaluate(() => { const registry = (window as any).bpmnforgeViewer.get('elementRegistry'); return Object.fromEntries(registry.getAll().filter((element: any) => !element.labelTarget).map((element: any) => [element.id, element.waypoints ? element.waypoints.map((p: any) => ({ x: p.x, y: p.y })) : { x: element.x, y: element.y, width: element.width, height: element.height }])); });
      for (const [id, bounds] of Object.entries(data.geometry.shapes)) assert.deepEqual(rendered[id], bounds, id);
      for (const [id, points] of Object.entries(data.geometry.edges)) assert.deepEqual(rendered[id], points, id);
      assert.deepEqual(requests, []); assert.deepEqual(errors, []); await context.close();
    }
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test('exported BPMN imports independently into a fresh prepackaged bpmn-js tool using DI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge independent ')); const browser = await launch();
  try {
    const model = fullProfile(), sourcePath = join(dir, 'source.json'), htmlPath = join(dir, 'source.html'), bpmnPath = join(dir, 'source.bpmn'); await writeFile(sourcePath, JSON.stringify(model));
    const result = await buildProcess({ sourcePath, htmlPath, bpmnPath }); const xml = await readFile(bpmnPath, 'utf8');
    const harness = join(dir, 'independent.html'); await writeFile(harness, '<!doctype html><html><body style="margin:0"><div id="tool" style="width:1440px;height:900px"></div></body></html>');
    const context = await browser.newContext({ offline: true }); const page = await context.newPage(); await page.goto(pathToFileURL(harness).href);
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/bpmn-js/dist/bpmn-viewer.production.min.js'), 'utf8') });
    const imported = await page.evaluate(async xml => { const viewer = new (window as any).BpmnJS({ container: '#tool' }); const { warnings } = await viewer.importXML(xml); const registry = viewer.get('elementRegistry'); viewer.get('canvas').zoom('fit-viewport'); return { warnings: warnings.map((w: any) => w.message), elements: Object.fromEntries(registry.getAll().filter((e: any) => !e.labelTarget).map((e: any) => [e.id, e.waypoints ? e.waypoints.map((p: any) => ({ x: p.x, y: p.y })) : { x: e.x, y: e.y, width: e.width, height: e.height }])) }; }, xml);
    assert.deepEqual(imported.warnings, []);
    for (const [id, bounds] of Object.entries(result.geometry.shapes)) { assert.deepEqual(imported.elements[id], bounds, id); assert.equal(await page.locator(`.djs-shape[data-element-id="${id}"]`).count(), 1); }
    for (const [id, points] of Object.entries(result.geometry.edges)) { assert.deepEqual(imported.elements[id], points, id); assert.equal(await page.locator(`.djs-connection[data-element-id="${id}"]`).count(), 1); }
    await context.close();
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
