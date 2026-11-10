import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

export const simple = {
  version: 1, id: 'Simple', name: 'Проверка заявки',
  stages: [{ id: 'Review', name: 'Проверка' }],
  processes: [{ id: 'Main', name: 'Работа' }],
  pools: [{ id: 'Team', name: 'Команда', process: 'Main' }],
  lanes: [{ id: 'Agent', name: 'Исполнитель', process: 'Main' }],
  nodes: [
    { id: 'Start', type: 'start', name: 'Начало', process: 'Main', lane: 'Agent', stage: 'Review' },
    { id: 'Check', type: 'task', name: 'Проверить данные', process: 'Main', lane: 'Agent', stage: 'Review' },
    { id: 'End', type: 'end', name: 'Готово', process: 'Main', lane: 'Agent', stage: 'Review' }
  ],
  flows: [{ id: 'ToCheck', type: 'sequence', source: 'Start', target: 'Check' }, { id: 'ToEnd', type: 'sequence', source: 'Check', target: 'End' }]
};
const bin = resolve('bin/bpmnforge.mjs');
export function cli(args: string[], cwd?: string) { return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd }); }

test('tracer: permanent CLI generates matching HTML and BPMN with DI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bpmnforge tracer '));
  try {
    const source = join(dir, 'source.bpmnforge.json');
    const html = join(dir, 'process.html'); const bpmn = join(dir, 'process.bpmn');
    await writeFile(source, JSON.stringify(simple));
    const result = cli(['build', source, '--html', html, '--bpmn', bpmn]);
    assert.equal(result.status, 0, result.stderr);
    const xml = await readFile(bpmn, 'utf8'); const page = await readFile(html, 'utf8');
    for (const id of ['Start', 'Check', 'End', 'ToCheck', 'ToEnd']) { assert.ok(xml.includes(`id="${id}"`)); assert.ok(page.includes(id)); }
    assert.match(xml, /BPMNShape/); assert.match(xml, /Bounds/); assert.match(xml, /waypoint/);
    assert.match(page, /bpmn-canvas/);
    const browser = await chromium.launch({ channel: process.env.BPMNFORGE_BROWSER_CHANNEL });
    try {
      const context = await browser.newContext({ offline: true }); const tab = await context.newPage();
      await tab.goto(pathToFileURL(html).href);
      await tab.waitForSelector('body[data-ready="true"]');
      assert.equal(await tab.locator('.djs-shape[data-element-id="Check"]').count(), 1);
    } finally { await browser.close(); }
    assert.equal(cli(['validate', source, '--html', html]).status, 0);
    assert.equal(cli(['version']).stdout.trim(), '0.2.0');
    await writeFile(source, '{broken'); await writeFile(html, 'old html'); await writeFile(bpmn, 'old bpmn');
    assert.equal(cli(['build', source, '--html', html, '--bpmn', bpmn]).status, 1);
    assert.equal(await readFile(html, 'utf8'), 'old html'); assert.equal(await readFile(bpmn, 'utf8'), 'old bpmn');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
