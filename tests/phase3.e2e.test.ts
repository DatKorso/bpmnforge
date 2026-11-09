import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildProcess } from '../src/build.ts';

test('long API identifiers wrap in the details panel without losing paragraph breaks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bpmnforge long descriptions '));
  const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
  try {
    const model = JSON.parse(await readFile(new URL('./fixtures/minimal.json', import.meta.url), 'utf8'));
    const description = 'POST /synthetic/testing/data\n\nSyntheticResponse_WithAnIntentionallyLongUnbrokenIdentifierForWrappingVerification\n\nOriginal API identifiers must stay intact when copied.';
    model.nodes.find((node: any) => node.id === 'Check').description = description;
    const sourcePath = join(directory, 'source.json'), htmlPath = join(directory, 'result.html');
    await writeFile(sourcePath, JSON.stringify(model));
    await buildProcess({ sourcePath, htmlPath });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport, offline: true });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(6000);
        await page.goto(pathToFileURL(htmlPath).href);
        await page.waitForSelector('body[data-ready="true"]');
        await page.locator('.djs-shape[data-element-id="Check"]').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#details > p').innerText(), description, `paragraphs and identifiers preserved at ${viewport.width}`);
        const dimensions = await page.locator('#details').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
        assert.equal(dimensions.scroll, dimensions.client, `details do not scroll horizontally at ${viewport.width}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('grid is opt-in, follows diagram coordinates, and preserves interaction and geometry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bpmnforge grid '));
  const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
  try {
    const sourcePath = fileURLToPath(new URL('./fixtures/minimal.json', import.meta.url));
    const htmlPath = join(directory, 'grid.html');
    await buildProcess({ sourcePath, htmlPath, bpmnPath: join(directory, 'grid.bpmn') });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport, offline: true });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(6000);
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href);
        await page.waitForSelector('body[data-ready="true"]');
        const checkbox = page.getByRole('checkbox', { name: 'Сетка', exact: true });
        const grid = page.locator('#BPMNFORGE_GridArea');
        assert.equal(await checkbox.isChecked(), false, 'grid starts disabled');
        assert.equal(await grid.isVisible(), false);
        const initial = await page.evaluate(() => {
          const data = JSON.parse(document.querySelector('#bpmnforge-data')!.textContent!);
          const viewer = (window as any).bpmnforgeViewer, registry = viewer.get('elementRegistry');
          return { inner: viewer.get('canvas').viewbox().inner, xml: data.xml,
            shapes: data.model.nodes.map((node: any) => { const item = registry.get(node.id); return { id: item.id, x: item.x, y: item.y, width: item.width, height: item.height }; }),
            paths: data.model.flows.map((flow: any) => registry.get(flow.id).waypoints) };
        });
        await checkbox.check(); assert.equal(await grid.isVisible(), true);
        assert.deepEqual(await page.evaluate(() => (window as any).bpmnforgeViewer.get('canvas').viewbox().inner), initial.inner, 'grid does not enlarge overview bounds');
        await page.locator('.djs-shape[data-element-id="Check"]').click();
        assert.match(await page.locator('#details h2').innerText(), /Проверить данные/, 'grid does not intercept block clicks');
        await page.getByRole('button', { name: 'Увеличить', exact: true }).click();
        const diagram = await page.locator('#bpmn-canvas').boundingBox(); assert.ok(diagram);
        await page.mouse.move(diagram.x + 80, diagram.y + diagram.height - 40);
        await page.mouse.down(); await page.mouse.move(diagram.x + 140, diagram.y + diagram.height - 70, { steps: 3 }); await page.mouse.up();
        const aligned = await page.evaluate(() => {
          const canvas = (window as any).bpmnforgeViewer.get('canvas'), view = canvas.viewbox();
          const grid = document.querySelector('#BPMNFORGE_GridArea') as SVGGraphicsElement;
          const gridMatrix = grid.getScreenCTM()!, diagramMatrix = canvas.getActiveLayer().getScreenCTM()!;
          const attributes = ['x', 'y', 'width', 'height'].map(name => Number(grid.getAttribute(name)));
          return { gridMatrix: [gridMatrix.a, gridMatrix.b, gridMatrix.c, gridMatrix.d, gridMatrix.e, gridMatrix.f],
            diagramMatrix: [diagramMatrix.a, diagramMatrix.b, diagramMatrix.c, diagramMatrix.d, diagramMatrix.e, diagramMatrix.f],
            coversView: attributes[0] <= view.x && attributes[1] <= view.y && attributes[0] + attributes[2] >= view.x + view.width && attributes[1] + attributes[3] >= view.y + view.height };
        });
        assert.deepEqual(aligned.gridMatrix, aligned.diagramMatrix, 'grid moves and scales with diagram coordinates');
        assert.equal(aligned.coversView, true, 'grid fills the panned viewport');
        await page.getByRole('button', { name: 'Обзор схемы', exact: true }).click();
        assert.equal(await checkbox.isChecked(), true, 'overview preserves grid toggle');
        assert.deepEqual(await page.evaluate(() => (window as any).bpmnforgeViewer.get('canvas').viewbox().inner), initial.inner);
        const after = await page.evaluate(() => {
          const data = JSON.parse(document.querySelector('#bpmnforge-data')!.textContent!), registry = (window as any).bpmnforgeViewer.get('elementRegistry');
          return { xml: data.xml,
            shapes: data.model.nodes.map((node: any) => { const item = registry.get(node.id); return { id: item.id, x: item.x, y: item.y, width: item.width, height: item.height }; }),
            paths: data.model.flows.map((flow: any) => registry.get(flow.id).waypoints) };
        });
        assert.equal(after.xml, initial.xml); assert.deepEqual(after.shapes, initial.shapes); assert.deepEqual(after.paths, initial.paths);
        await checkbox.focus(); await page.keyboard.press('Space');
        assert.equal(await checkbox.isChecked(), false); assert.equal(await grid.isVisible(), false);
        await page.keyboard.press('Space'); assert.equal(await grid.isVisible(), true);
        await page.reload(); await page.waitForSelector('body[data-ready="true"]');
        assert.equal(await checkbox.isChecked(), false, 'reload restores the disabled default');
        assert.equal(await grid.isVisible(), false); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('wheel zoom has a small bounded step, responds to scroll distance and keeps the cursor anchor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bpmnforge wheel '));
  const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
  try {
    const sourcePath = fileURLToPath(new URL('./fixtures/minimal.json', import.meta.url));
    const htmlPath = join(directory, 'wheel.html');
    await buildProcess({ sourcePath, htmlPath, bpmnPath: join(directory, 'wheel.bpmn') });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, offline: true });
    page.setDefaultTimeout(6000);
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForSelector('body[data-ready="true"]');
    const diagram = page.locator('#bpmn-canvas'), bounds = (await diagram.boundingBox())!;
    const x = Math.round(bounds.width * 0.4), y = Math.round(bounds.height * 0.4);
    await page.mouse.move(bounds.x + x, bounds.y + y);
    const zoom = () => page.evaluate(() => (window as any).bpmnforgeViewer.get('canvas').zoom() as number);
    const before = await zoom();
    const anchor = await page.evaluate(({ x, y }) => {
      const view = (window as any).bpmnforgeViewer.get('canvas').viewbox();
      return { x: view.x + x / view.scale, y: view.y + y / view.scale };
    }, { x, y });
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(scale => (window as any).bpmnforgeViewer.get('canvas').zoom() < scale, before);
    const normal = await zoom();
    assert.ok(normal / before > 0.95 && normal / before < 0.99, 'ordinary wheel step is less than 5%');
    const anchorDrift = await page.evaluate(({ x, y, anchor }) => {
      const view = (window as any).bpmnforgeViewer.get('canvas').viewbox();
      return Math.hypot((anchor.x - view.x) * view.scale - x, (anchor.y - view.y) * view.scale - y);
    }, { x, y, anchor });
    assert.ok(anchorDrift < 2, 'zoom stays anchored under the cursor');
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(scale => (window as any).bpmnforgeViewer.get('canvas').zoom() > scale, normal);
    const restored = await zoom();
    assert.ok(Math.abs(restored - before) < 0.003, 'opposite wheel movement returns to the previous scale');
    await page.mouse.wheel(0, 10);
    await page.waitForFunction(scale => (window as any).bpmnforgeViewer.get('canvas').zoom() < scale, restored);
    const fine = await zoom();
    assert.ok(fine / restored > normal / before, 'fine scrolling has a smaller effect');
    await page.mouse.wheel(0, 3000);
    await page.waitForFunction(scale => (window as any).bpmnforgeViewer.get('canvas').zoom() < scale, fine);
    const large = await zoom();
    assert.ok(large / fine > 0.95, 'a large wheel event does not cause a large jump');
    const zero = await diagram.evaluate(element => {
      const canvas = (window as any).bpmnforgeViewer.get('canvas'), before = canvas.zoom();
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, deltaX: 100, bubbles: true, cancelable: true }));
      return { before, after: canvas.zoom() };
    });
    assert.equal(zero.before, zero.after, 'horizontal scrolling alone does not zoom');
    await page.getByRole('button', { name: 'Увеличить', exact: true }).click();
    assert.ok(Math.abs(await zoom() / large - 1.2) < 0.003, 'the zoom button retains its separate step');
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
