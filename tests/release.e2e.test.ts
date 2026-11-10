import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { buildProcess } from '../src/build.ts';
import { calls, events, minimal } from './fixtures/models.ts';

test('synthetic calls, event subprocess and full licenses work offline at both desktop sizes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge release '));
  const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
  const notices = [
    await readFile(new URL('../LICENSE', import.meta.url), 'utf8'),
    await readFile(new URL('../assets/THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8')
  ].join('\n');
  try {
    for (const fixture of [calls, events]) {
      const model = fixture();
      model.nodes[1].links = [{ name: 'Тестовый документ', href: 'synthetic-missing.md' }];
      const sourcePath = join(dir, 'source.json'), htmlPath = join(dir, 'result.html');
      await writeFile(sourcePath, JSON.stringify(model)); await buildProcess({ sourcePath, htmlPath });
      for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
        const context = await browser.newContext({ viewport, offline: true });
        try {
          const page = await context.newPage(); page.setDefaultTimeout(6000);
          const errors: string[] = [], requests: string[] = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
          await page.goto(pathToFileURL(htmlPath).href); await page.waitForSelector('body[data-ready="true"]');
          const logo = page.locator('.bjs-powered-by'); assert.equal(await logo.isVisible(), true);
          const logoBox = (await logo.boundingBox())!, canvasBox = (await page.locator('#bpmn-canvas').boundingBox())!;
          assert.ok(logoBox.x >= canvasBox.x && logoBox.y >= canvasBox.y && logoBox.x + logoBox.width <= canvasBox.x + canvasBox.width && logoBox.y + logoBox.height <= canvasBox.y + canvasBox.height);
          assert.equal(await logo.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'logo is not obscured');
          await page.locator('.license summary').click();
          assert.equal(await page.locator('.license pre').textContent(), notices);
          assert.equal(await page.locator('.license').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight && document.documentElement.scrollHeight === document.documentElement.clientHeight), true);
          await page.locator('.license summary').click();
          const check = page.locator('.djs-shape[data-element-id="Check"]');
          await check.focus(); await page.keyboard.press('Enter');
          assert.equal(await page.locator('#details .document-unavailable').count(), 0);
          assert.equal(await page.locator('#details a').count(), 0);
          if (model.id === 'Calls') {
            await page.locator('#details').getByRole('button', { name: /Открыть общий процесс/ }).click();
            assert.equal(await page.getByRole('button', { name: 'Общая проверка', exact: true }).getAttribute('aria-pressed'), 'true');
            await page.locator('.djs-shape[data-element-id="SharedTask"]').click();
            assert.match(await page.locator('#details').innerText(), /Описание общего шага/);
            await page.getByRole('button', { name: 'Проверка', exact: true }).click();
            await check.click();
            const box = (await check.boundingBox())!;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 3 }); await page.mouse.up();
            await check.click(); assert.match(await page.locator('#details').innerText(), /Вызвать общий тестовый процесс/);
          } else {
            await page.locator('.djs-shape[data-element-id="Conditional"]').focus(); await page.keyboard.press('Enter');
            assert.match(await page.locator('#details').innerText(), /Подпроцесс: Тестовый подпроцесс/);
            await page.locator('#details').getByRole('button', { name: /Подпроцесс:/ }).click();
            assert.match(await page.locator('#details').innerText(), /Внутренние шаги/);
          }
          assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a long synthetic stage list exposes scroll controls without overlapping the reader', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge stages '));
  const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
  try {
    const model = structuredClone(minimal);
    model.stages = Array.from({ length: 14 }, (_, i) => ({ id: `Stage${i}`, name: `Тестовый этап ${i + 1}` }));
    model.nodes = model.stages.map((stage, i) => ({ id: `Node${i}`, name: `Тестовый блок ${i + 1}`, type: i === 0 ? 'start' : i === 13 ? 'end' : 'task', process: 'Work', lane: 'Agent', stage: stage.id }));
    model.flows = model.nodes.slice(1).map((node, i) => ({ id: `Flow${i}`, type: 'sequence', source: model.nodes[i].id, target: node.id }));
    const sourcePath = join(dir, 'source.json'), htmlPath = join(dir, 'result.html');
    await writeFile(sourcePath, JSON.stringify(model)); await buildProcess({ sourcePath, htmlPath });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport, offline: true });
      try {
        const page = await context.newPage(); await page.goto(pathToFileURL(htmlPath).href); await page.waitForSelector('body[data-ready="true"]');
        await page.getByRole('button', { name: 'Следующие этапы' }).click();
        await page.waitForFunction(() => document.querySelector('#stages')!.scrollLeft > 100);
        await page.getByRole('button', { name: 'Тестовый этап 14', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Тестовый этап 14', exact: true }).getAttribute('aria-pressed'), 'true');
        const canvas = (await page.locator('#bpmn-canvas').boundingBox())!;
        assert.equal(await page.locator('#details').isVisible(), false, 'empty panel takes no space');
        const strip=(await page.locator('#lane-context').boundingBox())!;
        assert.equal(strip.width,180);
        assert.ok(strip.x+strip.width<=canvas.x+1,'lane names have their own strip');
        assert.ok(canvas.width > viewport.width - 220 && canvas.y + canvas.height <= viewport.height);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
