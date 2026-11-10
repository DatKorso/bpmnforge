import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { buildProcess } from '../src/build.ts';
import { minimal } from './fixtures/models.ts';
import { layoutProcess } from '../src/layout.ts';

// Synthetic scene only: widely spaced steps reproduce the small overview zoom,
// while two interstage sequence transitions exercise independent stage entries.
test('reading frames, entries, resize, cameras, overview and information labels work offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bpmnforge readability '));
  const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
  try {
    const model = structuredClone(minimal);
    model.stages.push({ id: 'Read', name: 'Чтение' });
    model.nodes[1].stage = model.nodes[2].stage = 'Read';
    model.nodes[0].column = 0;
    model.nodes[1].column = 0;
    model.nodes[2].column = 4;
    model.annotations = [{ id: 'DistantNote', name: 'Удалённая заметка', text: 'Синтетическая заметка расширяет обзор', process: 'Work', lane: 'Agent', stage: 'Read', column: 140, row: 2 }];
    model.nodes.push({ id: 'Other', name: 'Вторая точка входа', type: 'task', stage: 'Read', process: 'Work', lane: 'Agent', column: 2, row: 1 });
    model.flows.push({ id: 'OtherEntry', type: 'sequence', source: 'Start', target: 'Other' }, { id: 'OtherEnd', type: 'sequence', source: 'Other', target: 'End' },
      { id: 'InfoOne', type: 'association', originalType: 'association', source: 'Check', target: 'Other', name: 'Возможная доработка' },
      { id: 'InfoTwo', type: 'association', originalType: 'association', source: 'Other', target: 'Start', name: 'Отдельная доставка outbox' });
    model.nodes[1].description = 'Длинное описание. '.repeat(100);
    model.links = [{ name: 'Синтетическая инструкция', href: 'https://example.org/synthetic' }];
    const sourcePath = join(directory, 'source.json'), htmlPath = join(directory, 'result.html');
    await writeFile(sourcePath, JSON.stringify(model)); await buildProcess({ sourcePath, htmlPath });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport, offline: true });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(6000);
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href); await page.waitForSelector('body[data-ready="true"]');
        const view = () => page.evaluate(() => {
          const v = (window as any).bpmnforgeViewer.get('canvas').viewbox();
          return { x: v.x + v.width / 2, y: v.y + v.height / 2, scale: v.scale, outer: v.outer };
        });
        assert.equal(await page.locator('#details').isVisible(), false);
        assert.equal(await page.locator('#documents-panel').count(), 0);

        await page.getByRole('button', { name: 'Чтение', exact: true }).click();
        assert.equal(await page.getByLabel('Режим этапа').inputValue(), 'read');
        assert.equal(await page.getByLabel('Точка входа', { exact: true }).locator('option').count(), 2);
        assert.equal(await page.getByLabel('Точка входа', { exact: true }).inputValue(), 'Check', 'interstage entry precedes the leftmost fallback');
        const beforePan = await view();
        await page.locator('#bpmn-canvas').focus(); await page.keyboard.press('ArrowRight');
        const panned = await view(); assert.notEqual(panned.x, beforePan.x);
        assert.equal(await page.locator('#lane-context [data-lane="Agent"]').isVisible(), true);
        await page.getByRole('button', { name: 'Проверка', exact: true }).click();
        await page.getByRole('button', { name: 'Чтение', exact: true }).click();
        assert.ok(Math.abs((await view()).x - panned.x) < 2, 'stage camera is restored');
        await page.getByRole('button', { name: 'К началу этапа', exact: true }).click();
        assert.ok(Math.abs((await view()).x - beforePan.x) < 2, 'start resets the stage camera');
        await page.getByLabel('Точка входа', { exact: true }).selectOption('Other');
        const entry = (await page.locator('.djs-shape[data-element-id="Other"]').boundingBox())!;
        const frame = (await page.locator('#bpmn-canvas').boundingBox())!;
        assert.ok(entry.x >= frame.x + 31 && entry.y >= frame.y + 31 && entry.x + entry.width <= frame.x + frame.width - 31 && entry.y + entry.height <= frame.y + frame.height - 31);
        await page.getByLabel('Режим этапа').selectOption('whole');
        assert.ok((await view()).scale < beforePan.scale, 'whole stage provides an overview');
        const whole = await page.evaluate(() => {
          const data = JSON.parse(document.getElementById('bpmnforge-data')!.textContent!);
          const view = (window as any).bpmnforgeViewer.get('canvas').viewbox();
          return [...data.model.nodes, ...(data.model.annotations ?? [])].filter((n: any) => n.stage === 'Read').flatMap((n: any) => [data.geometry.shapes[n.id], data.geometry.labels[n.id]].filter(Boolean)).map((b: any) =>
            [(b.x - view.x) * view.scale, (b.y - view.y) * view.scale, (view.x + view.width - b.x - b.width) * view.scale, (view.y + view.height - b.y - b.height) * view.scale]);
        });
        assert.ok(whole.every(margins => margins.every(value => value >= 31)), `whole-stage frame includes node labels and annotations with margins: ${JSON.stringify(whole)}`);
        await page.getByRole('button', { name: 'Вся схема', exact: true }).click();
        const overview = await view(); assert.ok(overview.scale < .2);
        await page.getByRole('button', { name: 'Уменьшить', exact: true }).click();
        const reduced = await view(); assert.ok(reduced.scale < overview.scale, 'minus reduces a small overview zoom');
        await page.getByRole('button', { name: 'Увеличить', exact: true }).click();
        assert.ok((await view()).scale > reduced.scale);
        assert.equal(await page.locator('.reading-frame').count(), 0);
        await page.getByRole('button', { name: 'Чтение', exact: true }).click();
        await page.getByRole('button', { name: 'К началу этапа', exact: true }).click();
        await page.locator('.djs-shape[data-element-id="Check"]').focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#details').isVisible(), true);
        const order = await page.locator('#details h3').allTextContents();
        assert.ok(order.indexOf('Исходящие связи') < order.indexOf('Описание'));
        assert.ok(await page.locator('.bpmnforge-outgoing').count() > 0);
        const beforeResize = await view();
        await page.setViewportSize({ width: viewport.width === 1440 ? 1920 : 1440, height: viewport.height === 900 ? 1080 : 900 });
        await page.waitForFunction(() => {
          const c = (window as any).bpmnforgeViewer.get('canvas').viewbox().outer, d = document.getElementById('bpmn-canvas')!;
          return Math.abs(c.width - d.clientWidth) < 2 && Math.abs(c.height - d.clientHeight) < 2;
        });
        const resized = await view();
        assert.ok(Math.abs(resized.x - beforeResize.x) < 2 && Math.abs(resized.y - beforeResize.y) < 2 && Math.abs(resized.scale - beforeResize.scale) < .01, 'resize preserves center and scale');
        await page.getByRole('button', { name: 'Закрыть описание' }).click();
        await page.waitForFunction(() => document.querySelector('#details')!.hasAttribute('hidden'));
        assert.equal(await page.locator('#details').isVisible(), false);
        assert.equal(await page.locator('.association-label').count(), 2);
        assert.match((await page.locator('.association-label').allTextContents()).join(' ').replace(/\s+/g, ' '), /Возможная доработка.*Отдельная доставка outbox/);
        await page.locator('#settings summary').click();
        const info = page.getByRole('checkbox', { name: 'Информационные связи (2)', exact: true });
        assert.equal(await info.isChecked(), true); await info.uncheck();
        assert.equal(await page.locator('.djs-connection[data-element-id="InfoOne"]').isVisible(), false);
        assert.equal(await page.locator('#association-labels').isVisible(), false);
        await info.check();
        assert.equal(await page.locator('.djs-connection[data-element-id="InfoOne"]').isVisible(), true);
        await page.getByRole('button', { name: 'Проверка', exact: true }).click();
        assert.equal(await page.locator('#details').isVisible(), false);
        assert.equal(await page.locator('.bpmnforge-selected').count(), 0);
        assert.equal(await page.locator('.bjs-powered-by').isVisible(), true);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('shared wrapping keeps actual SVG text inside task bounds with padding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bpmnforge measured text '));
  const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
  try {
    const model = structuredClone(minimal);
    model.nodes[0].name = 'Начало синтетической проверки длинной подписи события с сохранением исходного имени';
    model.nodes[2].name = 'Синтетическая проверка завершена после выполнения всех обязательных технических действий';
    model.flows[0].name = 'Передать данные в синтетический этап обработки и проверки';
    model.nodes[1].name = 'Проверить поступившие синтетические сведения и подготовить подтверждение выполнения всех обязательных условий технической обработки';
    model.nodes.splice(2, 0, { id: 'Identifier', type: 'serviceTask', name: 'SyntheticResponse_WithAnIntentionallyLongUnbrokenIdentifierForWrappingVerification_AndAnotherLongTechnicalIdentifier', stage: 'Review', process: 'Work', lane: 'Agent' });
    model.flows[1].target = 'Identifier';
    model.flows.push({ id: 'IdentifierEnd', type: 'sequence', source: 'Identifier', target: 'End' });
    const sourcePath = join(directory, 'source.json'), htmlPath = join(directory, 'result.html');
    await writeFile(sourcePath, JSON.stringify(model)); await buildProcess({ sourcePath, htmlPath });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport, offline: true });
      try {
        const page = await context.newPage(); await page.goto(pathToFileURL(htmlPath).href); await page.waitForSelector('body[data-ready="true"]');
        for (const id of ['Check', 'Identifier']) {
          const measured = await page.locator(`.djs-shape[data-element-id="${id}"] text`).evaluate(element => {
            const text = element as SVGTextElement, box = text.getBBox();
            const shape = (window as any).bpmnforgeViewer.get('elementRegistry').get(text.closest('[data-element-id]')!.getAttribute('data-element-id'));
            return { x: box.x, y: box.y, width: box.width, height: box.height, shapeWidth: shape.width, shapeHeight: shape.height, font: getComputedStyle(text).fontSize };
          });
          assert.equal(measured.font, '14px');
          assert.ok(measured.x >= 16 && measured.y >= 16 && measured.x + measured.width <= measured.shapeWidth - 16 && measured.y + measured.height <= measured.shapeHeight - 16, `${id} text has 16 units padding: ${JSON.stringify(measured)}`);
        }
        const labels = await page.evaluate(() => {
          const data = JSON.parse(document.getElementById('bpmnforge-data')!.textContent!), registry = (window as any).bpmnforgeViewer.get('elementRegistry');
          return Object.entries(data.geometry.labels).flatMap(([id, bounds]: [string, any]) => {
            const text = registry.getGraphics(`${id}_label`)?.querySelector('text') as SVGTextElement | undefined;
            if (!text) return [];
            const b = text.getBBox(); return [{ id, x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height, width: bounds.width, height: bounds.height, font: getComputedStyle(text).fontSize }];
          });
        });
        assert.ok(labels.length >= 3);
        for (const label of labels) {
          assert.equal(label.font, '14px');
          assert.ok(label.x >= -.1 && label.y >= -.1 && label.right <= label.width + .1 && label.bottom <= label.height + .1, `external label fits calculated bounds: ${JSON.stringify(label)}`);
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('mixed entries, successor visibility, lane strip and whole-stage route exclusion work at both desktop sizes', async () => {
  const directory=await mkdtemp(join(tmpdir(),'bpmnforge mixed entries ')),browser=await chromium.launch({channel:process.env.BPMNFORGE_BROWSER_CHANNEL});
  try {
    const model=structuredClone(minimal);model.stages.push({id:'Read',name:'Следующий этап'});
    model.lanes[0].name='Исполнитель с полным длинным синтетическим названием для контекста';
    model.nodes[1].stage=model.nodes[2].stage='Read';model.nodes[1].column=0;model.nodes[2].column=2;
    model.nodes.push({id:'LocalStart',name:'Самостоятельный вход',type:'start',process:'Work',lane:'Agent',stage:'Read',row:1,column:0},
      {id:'LocalTask',name:'Следующий самостоятельный шаг',type:'task',process:'Work',lane:'Agent',stage:'Read',row:1,column:1},
      {id:'LocalEnd',name:'Готово',type:'end',process:'Work',lane:'Agent',stage:'Read',row:1,column:2});
    model.flows.push({id:'LocalNext',type:'sequence',source:'LocalStart',target:'LocalTask'},{id:'LocalDone',type:'sequence',source:'LocalTask',target:'LocalEnd'});
    const g=layoutProcess(model),check=g.shapes.Check,end=g.shapes.End;
    model.flows.find(f=>f.id==='ToEnd')!.route=[{x:check.x+check.width/2,y:check.y},{x:check.x+check.width/2,y:8},{x:8000,y:8},{x:8000,y:end.y+end.height/2},{x:end.x+end.width,y:end.y+end.height/2}];
    const sourcePath=join(directory,'source.json'),htmlPath=join(directory,'result.html');await writeFile(sourcePath,JSON.stringify(model));await buildProcess({sourcePath,htmlPath});
    for(const viewport of [{width:1440,height:900},{width:1920,height:1080}]) {
      const context=await browser.newContext({viewport,offline:true});
      try {
        const page=await context.newPage();await page.goto(pathToFileURL(htmlPath).href);await page.waitForSelector('body[data-ready="true"]');
        await page.getByRole('button',{name:'Следующий этап',exact:true}).click();
        const choices=page.getByLabel('Точка входа',{exact:true});assert.deepEqual(await choices.locator('option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value)),['Check','LocalStart']);
        const visible=async(ids:string[])=>{
          const canvas=(await page.locator('#bpmn-canvas').boundingBox())!,strip=(await page.locator('#lane-context').boundingBox())!;
          assert.equal(strip.width,180);assert.ok(strip.x+strip.width<=canvas.x+1);
          for(const id of ids){const box=(await page.locator(`.djs-shape[data-element-id="${id}"]`).boundingBox())!;assert.ok(box.x>=canvas.x+31&&box.y>=canvas.y+31&&box.x+box.width<=canvas.x+canvas.width-31&&box.y+box.height<=canvas.y+canvas.height-31,`${id} is fully visible`);}
          const scale=await page.evaluate(()=>(window as any).bpmnforgeViewer.get('canvas').viewbox().scale);assert.ok(scale>=1&&scale<=1.25);
        };
        await visible(['Check','End']);
        assert.equal(await page.locator('.djs-shape[data-element-id="Start"]').evaluate(e=>e.classList.contains('bpmnforge-muted')), false);
        assert.match(await page.locator('#lane-context [data-lane="Agent"]').getAttribute('title')??'',/полным длинным/);
        await choices.selectOption('LocalStart');await visible(['LocalStart','LocalTask']);
        await page.getByRole('button',{name:'К началу этапа',exact:true}).click();assert.equal(await choices.inputValue(),'LocalStart');await visible(['LocalStart','LocalTask']);
        await page.getByLabel('Режим этапа').selectOption('whole');
        const wholeScale=await page.evaluate(()=>(window as any).bpmnforgeViewer.get('canvas').viewbox().scale);assert.ok(wholeScale>.8,'remote x=8000 detour does not control stage scale');
        await page.getByRole('button',{name:'Проверка',exact:true}).click();await page.getByRole('button',{name:'Следующий этап',exact:true}).click();
        assert.equal(await page.getByLabel('Режим этапа').inputValue(),'whole');assert.equal(await choices.inputValue(),'LocalStart');
        assert.ok(Math.abs(await page.evaluate(()=>(window as any).bpmnforgeViewer.get('canvas').viewbox().scale)-wholeScale)<.002);
        assert.ok(await page.locator('.bjs-powered-by').isVisible());
      } finally {await context.close();}
    }
  } finally {await browser.close();await rm(directory,{recursive:true,force:true});}
});
