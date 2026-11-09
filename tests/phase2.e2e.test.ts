import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { buildProcess } from '../src/build.ts';
import type { ProcessDocument } from '../src/domain.ts';

const base = JSON.parse(await readFile(new URL('./fixtures/minimal.json', import.meta.url), 'utf8')) as ProcessDocument;

test('offline stage navigation, overview and keyboard canvas controls at both desktop sizes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bplm stage '));
  const browser = await chromium.launch({ channel: process.env.BPLM_BROWSER_CHANNEL });
  try {
    const model = structuredClone(base);
    model.stages.push({ id: 'Publish', name: 'Публикация' });
    model.nodes[2].stage = 'Publish';
    model.nodes[1].description = '<b>Проверить полноту заявки</b>';
    model.nodes[1].links = [{ name: 'Инструкция', href: 'https://example.org/instruction' }];
    for (let index = 0; index < 7; index++) model.nodes.splice(2 + index, 0, { id: `Work${index}`, name: `Действие ${index}`, type: 'task', process: 'Work', lane: 'Agent', stage: 'Review' });
    model.flows = model.nodes.slice(1).map((node, index) => ({ id: `Flow${index}`, type: 'sequence', source: model.nodes[index].id, target: node.id }));
    const sourcePath = join(dir, 'process.json'), htmlPath = join(dir, 'process.html');
    await writeFile(sourcePath, JSON.stringify(model)); await buildProcess({ sourcePath, htmlPath });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport, offline: true }); const page = await context.newPage(); page.setDefaultTimeout(3000);
      const requests: string[] = []; page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await page.goto(pathToFileURL(htmlPath).href); await page.waitForSelector('body[data-ready="true"]');
      const viewbox = () => page.evaluate(() => (window as any).bplmViewer.get('canvas').viewbox());
      await page.getByRole('button', { name: 'Проверка', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Проверка', exact: true }).getAttribute('aria-pressed'), 'true');
      const stage = await viewbox(); assert.ok(stage.width < model.nodes.length * 260 + 100);
      assert.ok(stage.scale >= 1.2, `stage zoom ${stage.scale}`);
      const label = await page.locator('.djs-shape[data-element-id="Work0"] text').first().boundingBox();
      assert.ok(label && label.height >= 13, `screen label height ${label?.height}`);
      await page.getByRole('button', { name: 'Обзор схемы' }).click(); const overview = await viewbox(); assert.ok(overview.width > stage.width);
      await page.getByRole('button', { name: 'Увеличить' }).click(); assert.ok((await viewbox()).scale > overview.scale);
      await page.locator('#bpmn-canvas').focus(); const beforePan = await viewbox(); await page.keyboard.press('ArrowRight'); assert.notEqual((await viewbox()).x, beforePan.x);
      await page.keyboard.press('0'); assert.ok(Math.abs((await viewbox()).scale - overview.scale) < 0.01);
      const check = page.locator('.djs-shape[data-element-id="Check"]');
      await check.focus(); await page.keyboard.press('Enter');
      assert.match(await page.locator('#details').innerText(), /Проверить полноту заявки/);
      assert.match(await page.locator('#details').innerText(), /Исполнитель/);
      assert.equal(await page.locator('#details').locator('a', { hasText: 'Инструкция' }).getAttribute('href'), 'https://example.org/instruction');
      assert.equal(await page.locator('#details').locator('b').count(), 0);
      await page.locator('#details').getByRole('button', { name: /Действие 0/ }).click();
      assert.match(await page.locator('#details').innerText(), /Действие 0/);
      assert.equal(await page.locator('.djs-shape[data-element-id="Work0"]').getAttribute('tabindex'), '0');
      for (let index = 1; index < 7; index++) await page.locator('#details').getByRole('button', { name: new RegExp(`Действие ${index}`) }).click();
      await page.locator('#details').getByRole('button', { name: /Тест завершён/ }).click();
      assert.equal(await page.getByRole('button', { name: 'Публикация', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#details').innerText(), /Тест завершён/);
      assert.equal(await page.locator('.djs-shape[data-element-id="End"]').evaluate(element => document.activeElement === element), true);
      assert.deepEqual(requests, []); await context.close();
    }
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
