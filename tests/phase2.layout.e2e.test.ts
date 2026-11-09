import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { layoutProcess } from '../src/layout.ts';
import { exportBpmn } from '../src/bpmn.ts';
import { renderStandaloneHtml } from '../src/html.ts';
import { BpmnForgeError, type Point, type Bounds, type ProcessDocument } from '../src/domain.ts';

const simple = JSON.parse(await readFile(new URL('./fixtures/minimal.json', import.meta.url), 'utf8')) as ProcessDocument;
function intersects(points: Point[], box: Bounds): boolean {
  return points.slice(1).some((end, index) => {
    const start = points[index];
    return start.y === end.y ? start.y > box.y && start.y < box.y + box.height && Math.max(start.x, end.x) > box.x && Math.min(start.x, end.x) < box.x + box.width
      : start.x > box.x && start.x < box.x + box.width && Math.max(start.y, end.y) > box.y && Math.min(start.y, end.y) < box.y + box.height;
  });
}

test('route around unrelated shape and label, reject through-shape route hint with IDs and coordinate', () => {
  const model = structuredClone(simple);
  model.flows = [{ id: 'Long', type: 'sequence', source: 'Start', target: 'End' }];
  const geometry = layoutProcess(model);
  assert.equal(intersects(geometry.edges.Long, geometry.shapes.Check), false);
  model.flows[0].route = [geometry.edges.Long[0], { x: geometry.shapes.Check.x + 20, y: geometry.edges.Long[0].y }, { x: geometry.shapes.Check.x + 20, y: geometry.shapes.End.y + geometry.shapes.End.height / 2 }, geometry.edges.Long.at(-1)!];
  assert.throws(() => layoutProcess(model), error => error instanceof BpmnForgeError && error.diagnostics.some(d => d.id === 'Long' && d.relatedIds?.includes('Check') && d.point));
});

test('CLI JSON success and failure preserve prior outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge json '));
  try {
    const source = join(dir, 'source.json'), html = join(dir, 'out.html'), bpmn = join(dir, 'out.bpmn');
    const model = structuredClone(simple); await writeFile(source, JSON.stringify(model));
    const cli = (command: string) => spawnSync(process.execPath, [resolve('bin/bpmnforge.mjs'), command, source, '--json', '--html', html, '--bpmn', bpmn], { encoding: 'utf8' });
    const valid = cli('validate'); assert.equal(valid.status, 0, valid.stderr);
    const result = JSON.parse(valid.stdout); assert.equal(result.status, 'ok'); assert.ok(result.geometry.edges.ToCheck);
    const built = cli('build'); assert.equal(built.status, 0, built.stderr); assert.equal(JSON.parse(built.stdout).status, 'ok');
    const priorHtml = await readFile(html), priorBpmn = await readFile(bpmn);
    model.flows[0].route = [{ x: 1, y: 1 }, { x: 2, y: 1 }]; await writeFile(source, JSON.stringify(model));
    const invalid = cli('build'); assert.equal(invalid.status, 1); const failure = JSON.parse(invalid.stdout);
    assert.equal(failure.status, 'error'); assert.equal(failure.diagnostics[0].severity, 'error'); assert.equal(failure.diagnostics[0].id, 'ToCheck');
    assert.deepEqual(await readFile(html), priorHtml); assert.deepEqual(await readFile(bpmn), priorBpmn);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI JSON cell conflict identifies both blocks and a shared location', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge cell conflict '));
  try {
    const source = join(dir, 'source.json');
    const model = structuredClone(simple);
    model.nodes[1].column = 1;
    model.nodes[2].column = 1;
    await writeFile(source, JSON.stringify(model));
    const result = spawnSync(process.execPath, [resolve('bin/bpmnforge.mjs'), 'validate', source, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const diagnostic = JSON.parse(result.stdout).diagnostics.find((item: { code: string }) => item.code === 'CELL_CONFLICT');
    assert.equal(diagnostic.id, 'End');
    assert.deepEqual(diagnostic.relatedIds, ['Check']);
    assert.ok(Number.isFinite(diagnostic.point.x) && Number.isFinite(diagnostic.point.y));
    assert.ok(diagnostic.bounds.width > 0 && diagnostic.bounds.height > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('parallel and marked return routes have distinct corridors', () => {
  const model = structuredClone(simple);
  model.flows.push({ id: 'Parallel', type: 'sequence', source: 'Start', target: 'Check' });
  model.flows.push({ id: 'Back', type: 'sequence', source: 'Check', target: 'Start', return: true });
  const geometry = layoutProcess(model);
  const paths = [geometry.edges.ToCheck, geometry.edges.Parallel, geometry.edges.Back];
  assert.equal(new Set(paths.map(path => JSON.stringify(path))).size, 3);
  for (const path of paths) assert.equal(intersects(path, geometry.shapes.End), false);
});

test('checked right-angle crossing is recorded and bridged without changing BPMN DI', async () => {
  const model = structuredClone(simple); model.nodes = [
    { id: 'A', name: 'A', type: 'task', process: 'Work', lane: 'Agent', stage: 'Review', column: 0 },
    { id: 'C', name: 'C', type: 'task', process: 'Work', lane: 'Agent', stage: 'Review', column: 1 },
    { id: 'B', name: 'B', type: 'task', process: 'Work', lane: 'Agent', stage: 'Review', column: 3 },
    { id: 'D', name: 'D', type: 'task', process: 'Work', lane: 'Agent', stage: 'Review', column: 1, row: 1 }
  ]; model.flows = [];
  const shapes = layoutProcess(model).shapes;
  const crossingY = (shapes.C.y + shapes.C.height + shapes.D.y) / 2;
  const across: Point[] = [{ x: shapes.A.x + shapes.A.width, y: shapes.A.y + shapes.A.height / 2 }, { x: shapes.A.x + shapes.A.width + 40, y: shapes.A.y + shapes.A.height / 2 }, { x: shapes.A.x + shapes.A.width + 40, y: crossingY }, { x: shapes.B.x - 40, y: crossingY }, { x: shapes.B.x - 40, y: shapes.B.y + shapes.B.height / 2 }, { x: shapes.B.x, y: shapes.B.y + shapes.B.height / 2 }];
  const down: Point[] = [{ x: shapes.C.x + shapes.C.width / 2, y: shapes.C.y + shapes.C.height }, { x: shapes.D.x + shapes.D.width / 2, y: shapes.D.y }];
  model.flows = [{ id: 'Across', type: 'sequence', source: 'A', target: 'B', route: across }, { id: 'Down', type: 'sequence', source: 'C', target: 'D', route: down }];
  const geometry = layoutProcess(model);
  assert.deepEqual(geometry.crossings, [{ flows: ['Across', 'Down'], point: { x: down[0].x, y: crossingY }, over: 'Down' }]);
  const xml = await exportBpmn(model, geometry);
  for (const point of down) assert.ok(xml.includes(`<di:waypoint x="${point.x}" y="${point.y}"`), 'DI preserves both ends of the crossing route');
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge bridge ')); const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
  try {
    const html = join(dir, 'bridge.html'); await writeFile(html, await renderStandaloneHtml(model, geometry, xml));
    const page = await browser.newPage(); await page.goto(pathToFileURL(html).href); await page.waitForSelector('body[data-ready="true"]');
    assert.equal(await page.locator('.bpmnforge-bridge').count(), 1); assert.equal(await page.locator('.bpmnforge-bridge-mask').count(), 1);
    const rendered = await page.evaluate(() => (window as any).bpmnforgeViewer.get('elementRegistry').get('Down').waypoints.map((p: Point) => ({ x: p.x, y: p.y })));
    assert.deepEqual(rendered, down);
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
