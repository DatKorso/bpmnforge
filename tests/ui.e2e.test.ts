import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { buildProcess } from '../src/build.ts';

test('HTML excludes document metadata; full view, dimming and stable lane elements work offline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge-ui-'));
  const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
  try {
    const model = JSON.parse(await readFile(new URL('./fixtures/minimal.json', import.meta.url), 'utf8'));
    model.stages.push({ id: 'Second', name: 'Second stage' }); model.nodes[2].stage = 'Second';
    for (const item of [model, ...model.stages, ...model.processes, ...model.pools, ...model.lanes, ...model.nodes]) {
      item.links = [{ name: `Secret-${item.id}`, href: `docs/secret-${item.id}.pdf` }];
    }
    const sourcePath = join(dir, 'source.json'), htmlPath = join(dir, 'result.html');
    const source = JSON.stringify(model); await writeFile(sourcePath, source);
    const result = await buildProcess({ sourcePath, htmlPath });
    assert.ok(result.diagnostics.some(d => d.code === 'MISSING_DOCUMENT'));
    assert.equal(await readFile(sourcePath, 'utf8'), source);
    const html = await readFile(htmlPath, 'utf8');
    for (const item of [model, ...model.stages, ...model.processes, ...model.pools, ...model.lanes, ...model.nodes]) {
      assert.ok(!html.includes(item.links[0].name)); assert.ok(!html.includes(item.links[0].href));
    }
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport, offline: true });
      const page = await context.newPage();
      await page.goto(pathToFileURL(htmlPath).href); await page.waitForSelector('body[data-ready]');
      assert.equal(await page.locator('.bpmnforge-muted').count(), 0);
      await page.locator('#settings summary').click(); await page.locator('#dim-toggle').check();
      assert.ok(await page.locator('.bpmnforge-muted').count() > 0);
      await page.locator('#settings summary').click();
      const nav = (await page.locator('.stage-nav').boundingBox())!, tools = (await page.locator('.view-controls').boundingBox())!;
      assert.ok(nav.y + nav.height <= tools.y);
      await page.locator('#overview').click();
      assert.equal(await page.locator('.bpmnforge-muted').count(), 0);
      assert.equal(await page.locator('.stage-zone').count(), 0);
      await page.locator('.djs-shape[data-element-id="Check"]').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#overview').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#details').isVisible(), true);
      await page.locator('#details-close').click();
      await page.locator('#stages button').first().click();
      assert.ok(await page.locator('.bpmnforge-muted').count() > 0);
      assert.equal(await page.locator('#dim-toggle').isChecked(), true);
      const lane = await page.locator('.lane-name').first().elementHandle();
      await page.evaluate(async () => {
        const c = (window as any).bpmnforgeViewer.get('canvas');
        for (let i = 0; i < 10; i++) c.scroll({ dx: 1, dy: 1 });
        await new Promise(requestAnimationFrame);
      });
      assert.ok(await lane!.evaluate(e => e.isConnected));
      assert.equal(await page.locator('.bjs-powered-by').isVisible(), true);
      await context.close();
    }
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
