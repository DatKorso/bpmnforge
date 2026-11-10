import Viewer from 'bpmn-js/lib/Viewer.js';
import { textLines } from './text.ts';
import { READABLE } from './profile.ts';
import { readingFragment, stageEntries } from './reading.ts';

const data = JSON.parse(document.getElementById('bpmnforge-data')!.textContent!);
const viewer = new Viewer({ container: '#bpmn-canvas' });
(window as any).bpmnforgeViewer = viewer;
const canvas: any = viewer.get('canvas');
const eventBus: any = viewer.get('eventBus');
const diagram = document.getElementById('bpmn-canvas')!;
const status = document.getElementById('status')!;
const stages = document.getElementById('stages')!;
const previousStages = document.getElementById('stages-prev') as HTMLButtonElement;
const nextStages = document.getElementById('stages-next') as HTMLButtonElement;
const overview = document.getElementById('overview') as HTMLButtonElement;
const fit = document.getElementById('fit') as HTMLButtonElement;
const zoomValue = document.getElementById('zoom-value')!;
document.getElementById('title')!.textContent = data.model.name;
overview.textContent = 'Вся схема';
const dimToggle = document.getElementById('dim-toggle') as HTMLInputElement;
dimToggle.checked = false;

const gridToggle = document.getElementById('grid-toggle') as HTMLInputElement;
gridToggle.checked = false;
let gridLayer: SVGGElement | undefined;
let gridArea: SVGRectElement | undefined;
let gridMask: SVGMaskElement | undefined;
let gridMaskArea: SVGRectElement | undefined;

function updateGrid() {
  if (!gridLayer || !gridArea || !gridMask || !gridMaskArea) return;
  gridLayer.style.display = gridToggle.checked ? '' : 'none';
  if (!gridToggle.checked) return;
  const view = canvas.viewbox();
  const bounds = { x: Math.floor(view.x / 100) * 100 - 100, y: Math.floor(view.y / 100) * 100 - 100,
    width: Math.ceil(view.width / 100) * 100 + 300, height: Math.ceil(view.height / 100) * 100 + 300 };
  for (const element of [gridArea, gridMask, gridMaskArea]) {
    for (const [key, value] of Object.entries(bounds)) element.setAttribute(key, String(value));
  }
}

function installGrid() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = (tag: string, attributes: Record<string, string | number> = {}) => {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  // Separate canvas layer shares diagram coordinates but never contributes to its content bounds.
  gridLayer = canvas.getLayer('bpmnforge-grid', 500);
  gridLayer!.setAttribute('class', 'bpmnforge-grid');
  gridLayer!.setAttribute('aria-hidden', 'true');
  gridLayer!.style.pointerEvents = 'none';
  const definitions = svg('defs');
  const minor = svg('pattern', { id: 'BPMNFORGE_GridMinor', patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: 20, height: 20 });
  minor.append(svg('path', { d: 'M20 0 H0 V20', fill: 'none', stroke: '#9aadc0', 'stroke-width': 0.6, opacity: 0.55 }));
  const major = svg('pattern', { id: 'BPMNFORGE_GridMajor', patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: 100, height: 100 });
  major.append(svg('rect', { width: 100, height: 100, fill: 'url(#BPMNFORGE_GridMinor)' }),
    svg('path', { d: 'M100 0 H0 V100', fill: 'none', stroke: '#708ba5', 'stroke-width': 0.9, opacity: 0.7 }));
  gridMask = svg('mask', { id: 'BPMNFORGE_GridMask', maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse' }) as SVGMaskElement;
  gridMaskArea = svg('rect', { fill: 'white' }) as SVGRectElement;
  gridMask.append(gridMaskArea);
  // Keep node text, gateway/event labels and participant headers clear of grid lines.
  for (const node of data.model.nodes) {
    if (node.type === 'eventSubProcess') continue;
    const b = data.geometry.shapes[node.id];
    if (['start', 'end', 'conditionalStart', 'terminateEnd', 'timerCatch'].includes(node.type)) {
      gridMask.append(svg('ellipse', { cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2 + 1, ry: b.height / 2 + 1, fill: 'black' }));
    } else if (node.type === 'xor' || node.type === 'and') {
      gridMask.append(svg('polygon', { points: `${b.x + b.width / 2},${b.y} ${b.x + b.width},${b.y + b.height / 2} ${b.x + b.width / 2},${b.y + b.height} ${b.x},${b.y + b.height / 2}`, fill: 'black' }));
    } else gridMask.append(svg('rect', { ...b, fill: 'black' }));
  }
  for (const item of [...(data.model.annotations ?? []), ...data.model.pools, ...data.model.lanes]) {
    const b = data.geometry.shapes[item.id];
    gridMask.append(svg('rect', { ...b, width: 'text' in item ? b.width : 30, fill: 'black' }));
  }
  for (const b of Object.values(data.geometry.labels) as { x: number; y: number; width: number; height: number }[]) gridMask.append(svg('rect', { ...b, fill: 'black' }));
  definitions.append(minor, major, gridMask);
  gridArea = svg('rect', { id: 'BPMNFORGE_GridArea', fill: 'url(#BPMNFORGE_GridMajor)', mask: 'url(#BPMNFORGE_GridMask)' }) as SVGRectElement;
  gridLayer!.append(definitions, gridArea);
  updateGrid();
}
gridToggle.addEventListener('change', updateGrid);

eventBus.on('canvas.resized', schedulePresentation);

type Box = { x: number; y: number; width: number; height: number };
type Camera = { x: number; y: number; scale: number };
let activeStage: string | null = null;
let imported = false;
let readingMode: 'read' | 'whole' = 'read';
const stageMode = document.getElementById('stage-mode') as HTMLSelectElement;
const entrySelect = document.getElementById('entry-select') as HTMLSelectElement;
const entryControl = document.getElementById('entry-control')!;
const readingContext = document.getElementById('reading-context')!;
const cameras = new Map<string, Camera>();
const stageModes = new Map<string, 'read' | 'whole'>();
const entryChoices = new Map<string, string>();
let currentCamera: Camera | undefined;
const overlays = (id: string) => { const layer = document.createElement('div'); layer.id = id; layer.className = 'bpmnforge-overlay'; diagram.append(layer); return layer; };
const associationLabels = overlays('association-labels');
const laneContext = document.getElementById('lane-context')!;
function camera(): Camera { const view = canvas.viewbox(); return { x: view.x + view.width / 2, y: view.y + view.height / 2, scale: view.scale }; }
function applyCamera(view: Camera) {
  const outer = canvas.viewbox().outer;
  canvas.viewbox({ x: view.x - outer.width / view.scale / 2, y: view.y - outer.height / view.scale / 2, width: outer.width / view.scale, height: outer.height / view.scale });
}
function saveStage() { if (activeStage && imported) { cameras.set(activeStage, camera()); stageModes.set(activeStage, readingMode); } }
function updateZoom() { zoomValue.textContent = `${Math.round(canvas.zoom() * 100)}%`; }
function markStage(id: string | null) {
  activeStage = id;
  overview.setAttribute('aria-pressed', String(id === null));
  stageMode.disabled = id === null;
  fit.textContent = id === null ? 'Вписать схему' : 'К началу этапа';
  for (const button of stages.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.stage === id));
  readingContext.textContent = id ? `Этап: ${data.model.stages.find((s: any) => s.id === id)?.name ?? id}` : 'Вся схема';
  laneContext.hidden = id === null;
  document.getElementById('diagram-shell')!.classList.toggle('is-overview', id === null);
  canvas.resized();
  applyStageDimming();
}
function applyStageDimming() {
  const id = dimToggle.checked ? activeStage : null;
  for (const item of [...data.model.nodes, ...(data.model.annotations ?? [])]) {
    for (const key of [item.id, `${item.id}_label`]) registry.getGraphics(key)?.classList.toggle('bpmnforge-muted', !!id && item.stage !== id);
  }
  for (const flow of data.model.flows) {
    const muted = !!id && nodeStages.get(flow.source) !== id && nodeStages.get(flow.target) !== id;
    for (const key of [flow.id, `${flow.id}_label`]) registry.getGraphics(key)?.classList.toggle('bpmnforge-muted', muted);
    associationLabelById.get(flow.id)?.classList.toggle('bpmnforge-muted', muted);
  }
}
function fitScale(bounds: { width: number; height: number }, margin = 32) {
  const outer = canvas.viewbox().outer;
  const scale = Math.max(0.001, Math.min(2, (outer.width - margin * 2) / bounds.width, (outer.height - margin * 2) / bounds.height));
  // Canvas reports scale to three decimals. Round down so a wide overview
  // cannot consume its reserved frame through that rounding.
  return Math.max(0.001, Math.floor(scale * 1000) / 1000);
}
function setView(bounds: Box, scale = fitScale(bounds)) { applyCamera({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, scale }); }
function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
}
function nodeBounds(id: string): Box { const b = data.geometry.shapes[id], label = data.geometry.labels[id]; return label ? union([b, label]) : b; }
function stageContentBounds(id: string): Box {
  const elements = [...data.model.nodes, ...(data.model.annotations ?? [])].filter((item: any) => item.stage === id);
  const boxes: Box[] = elements.map((item: any) => nodeBounds(item.id));
  const ids = new Set(elements.map((item: any) => item.id));
  for (const flow of data.model.flows.filter((f: any) => ids.has(f.source) && ids.has(f.target))) {
    if (data.geometry.labels[flow.id]) boxes.push(data.geometry.labels[flow.id]);
  }
  return boxes.length ? union(boxes) : data.geometry.stages[id];
}
function entries(id: string): any[] {
  return stageEntries(data.model, data.geometry, id);
}
function populateEntries(id: string) {
  const choices = entries(id); entrySelect.replaceChildren();
  for (const node of choices) { const option = document.createElement('option'); option.value = node.id; option.textContent = node.name; entrySelect.append(option); }
  entryControl.hidden = choices.length < 2;
  if (entryChoices.has(id) && choices.some(n => n.id === entryChoices.get(id))) entrySelect.value = entryChoices.get(id)!;
}
function readFragment(id: string, entryId = entrySelect.value, position = true) {
  const fragment = readingFragment(data.model, data.geometry, id, entryId, canvas.viewbox().outer);
  const transitions = document.getElementById('fragment-transitions')!; transitions.replaceChildren(); transitions.hidden = true;
  if (!fragment) { setView(stageContentBounds(id)); return; }
  entryChoices.set(id, fragment.entry);
  if (position) setView(fragment.bounds, fragment.scale);
  for (const target of fragment.missingSuccessors) {
    const node = data.model.nodes.find((n: any) => n.id === target);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `Далее: ${node.name}`;
    button.addEventListener('click', () => selectNode(target, true)); transitions.append(button); transitions.hidden = false;
  }
  // Runtime evidence also covers a manually supplied entry larger than the screen.
  (window as any).bpmnforgeReading = { ...fragment, profile: READABLE.id };
}
function showOverview() { saveStage(); clearSelection(); markStage(null); entryControl.hidden = true; document.getElementById('fragment-transitions')!.hidden = true; setView(data.geometry.viewport); updateOverlays(); status.textContent = 'Вся схема'; }
function showStage(id: string, reset = false, explicit = true) {
  const stage = data.model.stages.find((item: any) => item.id === id);
  if (!stage || !data.geometry.stages[id]) return;
  saveStage(); if (explicit) clearSelection();
  markStage(id); populateEntries(id);
  readingMode = reset ? 'read' : stageModes.get(id) ?? 'read'; stageMode.value = readingMode;
  if (reset) { readingMode = 'read'; stageMode.value = 'read'; cameras.delete(id); }
  if (!reset && cameras.has(id)) { applyCamera(cameras.get(id)!); if (readingMode === 'read') readFragment(id, entrySelect.value, false); }
  else if (readingMode === 'whole') setView(stageContentBounds(id));
  else readFragment(id);
  document.getElementById('fragment-transitions')!.hidden = readingMode === 'whole' || !document.getElementById('fragment-transitions')!.childElementCount;
  status.textContent = `Этап: ${stage.name}`; updateOverlays();
}
function adjustZoom(factor: number, center?: { x: number; y: number }) {
  const current = canvas.zoom();
  // Automatic overview and manual controls share the same range; never reverse the requested direction.
  const lower = Math.min(current, fitScale(data.geometry.viewport), 0.05) / 8;
  const target = factor < 1 ? Math.max(lower, current * factor) : Math.min(Math.max(3, current), current * factor);
  canvas.zoom(target, center); schedulePresentation();
}
function syncSize() {
  if (!imported) return;
  const before = currentCamera ?? camera();
  canvas.resized(); applyCamera(before); updateStageScroll(); updateOverlays();
}
let observedSize = '';
new ResizeObserver(() => {
  const next = `${diagram.clientWidth}/${diagram.clientHeight}`;
  if (next === observedSize) return;
  observedSize = next; syncSize();
}).observe(diagram);
stageMode.addEventListener('change', () => {
  readingMode = stageMode.value as 'read' | 'whole';
  if (!activeStage) return;
  cameras.delete(activeStage);
  if (readingMode === 'whole') setView(stageContentBounds(activeStage)); else readFragment(activeStage);
  document.getElementById('fragment-transitions')!.hidden = readingMode === 'whole' || !document.getElementById('fragment-transitions')!.childElementCount;
});
entrySelect.addEventListener('change', () => { if (activeStage) { readingMode = 'read'; stageMode.value = 'read'; readFragment(activeStage); } });
const registry: any = viewer.get('elementRegistry');
const details = document.getElementById('details')!;
const nodeStages = new Map<string, string>(data.model.nodes.map((node: any) => [node.id, node.stage]));
dimToggle.addEventListener('change', applyStageDimming);
const nodeById = new Map<string, any>(data.model.nodes.map((node: any) => [node.id, node]));
const named = new Map<string, any>([...data.model.processes, ...data.model.pools, ...data.model.lanes, ...data.model.nodes, ...(data.model.annotations ?? [])].map((item: any) => [item.id, item]));
const types: Record<string, string> = { start: 'Начало', end: 'Завершение', task: 'Задача', userTask: 'Действие пользователя', serviceTask: 'Сервисная задача', sendTask: 'Отправка сообщения', receiveTask: 'Получение сообщения', businessRuleTask: 'Бизнес-правило', callActivity: 'Вызов общего процесса', timerCatch: 'Ожидание времени', conditionalStart: 'Начало по условию', terminateEnd: 'Завершение процесса', eventSubProcess: 'Событийный подпроцесс', xor: 'Развилка: один исход', and: 'Параллельные ветви' };
let selectedId: string | null = null;
function clearSelection() {
  if (selectedId) {
    canvas.removeMarker(selectedId, 'bpmnforge-selected');
    for (const flow of data.model.flows.filter((item: any) => item.source === selectedId || item.target === selectedId)) {
      for (const marker of ['bpmnforge-related', 'bpmnforge-incoming', 'bpmnforge-outgoing']) canvas.removeMarker(flow.id, marker);
    }
  }
  selectedId = null; details.hidden = true; document.querySelector('.reader')!.classList.remove('has-details');
  if (activeStage) { const stage = data.model.stages.find((s: any) => s.id === activeStage); status.textContent = `Этап: ${stage?.name ?? activeStage}`; readingContext.textContent = `Этап: ${stage?.name ?? activeStage}`; }
  else { status.textContent = 'Вся схема'; readingContext.textContent = 'Вся схема'; }
}
function addText(parent: Element, tag: string, value: string, className?: string): Element {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  parent.append(element); return element;
}
function flowName(flow: any): string {
  const source = nodeById.get(flow.source);
  const name = flow.name?.trim() || (source?.defaultFlow === flow.id ? 'Иначе' : flow.condition ? 'Условный переход' : flow.type === 'message' ? 'Сообщение' : flow.type === 'association' ? 'Связь' : '');
  return [name, flow.originalType === 'message' ? 'информационная связь из исходной схемы' : '', flow.return ? 'Возврат' : ''].filter(Boolean).join(' — ');
}
function reveal(id: string) {
  if (!data.geometry.shapes[id]) return; const box = nodeBounds(id);
  const view = canvas.viewbox();
  const margin = 32 / view.scale;
  if (box.x < view.x + margin || box.x + box.width > view.x + view.width - margin || box.y < view.y + margin || box.y + box.height > view.y + view.height - margin) {
    canvas.viewbox({ x: box.x + box.width / 2 - view.width / 2, y: box.y + box.height / 2 - view.height / 2, width: view.width, height: view.height });
  }
}
function renderFlows(node: any, direction: 'incoming' | 'outgoing') {
  addText(details, 'h3', direction === 'incoming' ? 'Входящие связи' : 'Исходящие связи');
  const list = document.createElement('div'); list.className = `neighbors ${direction}`; details.append(list);
  const flows = data.model.flows.filter((flow: any) => direction === 'incoming' ? flow.target === node.id : flow.source === node.id);
  if (!flows.length) { addText(list, 'p', 'Нет связей'); return; }
  for (const flow of flows) {
    const otherId = direction === 'incoming' ? flow.source : flow.target;
    const other = named.get(otherId); const row = document.createElement('p'); list.append(row);
    const prefix = flowName(flow);
    const label = [prefix, other?.name ?? otherId].filter(Boolean).join(': ');
    if (nodeById.has(otherId)) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `${direction === 'incoming' ? '←' : '→'} ${label}`;
      button.setAttribute('aria-label', `${direction === 'incoming' ? 'Перейти к предыдущему' : 'Перейти к следующему'} блоку: ${label}`);
      button.addEventListener('click', () => selectNode(otherId, true)); row.append(button);
    } else addText(row, 'span', label);
  }
}
function selectNode(id: string, focus = false) {
  const node = nodeById.get(id); if (!node) return;
  clearSelection();
  if (activeStage && activeStage !== node.stage) showStage(node.stage, false, false);
  selectedId = id;
  details.hidden = false; document.querySelector('.reader')!.classList.add('has-details');
  syncSize(); reveal(id);
  canvas.addMarker(id, 'bpmnforge-selected');
  for (const flow of data.model.flows.filter((item: any) => item.source === id || item.target === id)) {
    canvas.addMarker(flow.id, flow.target === id ? 'bpmnforge-incoming' : 'bpmnforge-outgoing');
  }
  details.replaceChildren();
  const close = document.createElement('button'); close.type = 'button'; close.id = 'details-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Закрыть описание'); close.addEventListener('click', () => { clearSelection(); diagram.focus(); }); details.append(close);
  addText(details, 'h2', node.name);
  if (node.parent) {
    const parent = nodeById.get(node.parent);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `Подпроцесс: ${parent?.name ?? node.parent}`;
    button.addEventListener('click', () => selectNode(node.parent, true)); details.append(button);
  }
  if (node.type === 'callActivity') {
    const start = data.model.nodes.find((item: any) => item.process === node.calledElement && item.type === 'start' && !item.parent);
    if (start) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `Открыть общий процесс: ${named.get(node.calledElement)?.name ?? node.calledElement}`;
      button.addEventListener('click', () => selectNode(start.id, true)); details.append(button);
    }
  }
  const meta = document.createElement('dl'); meta.className = 'detail-meta'; meta.setAttribute('aria-label', 'Контекст'); details.append(meta);
  const addMeta = (label: string, value: string) => { addText(meta, 'dt', label); addText(meta, 'dd', value); };
  addMeta('Тип', types[node.type] ?? node.type);
  addMeta('Процесс', named.get(node.process)?.name ?? node.process);
  const pool = data.model.pools.find((item: any) => item.process === node.process);
  if (pool) addMeta('Участник', pool.name);
  if (node.lane) addMeta('Исполнитель', named.get(node.lane)?.name ?? node.lane);
  addMeta('Этап', data.model.stages.find((item: any) => item.id === node.stage)?.name ?? node.stage);
  renderFlows(node, 'incoming'); renderFlows(node, 'outgoing');
  addText(details, 'h3', 'Описание'); addText(details, 'p', node.description || 'Описание не задано');
  if (node.type === 'eventSubProcess') {
    addText(details, 'h3', 'Внутренние шаги');
    for (const child of data.model.nodes.filter((item: any) => item.parent === node.id)) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = child.name;
      button.addEventListener('click', () => selectNode(child.id, true)); details.append(button);
    }
  }
  details.scrollTop = 0;
  status.textContent = `Выбран блок: ${node.name}`;
  readingContext.textContent = `${data.model.stages.find((s: any) => s.id === node.stage)?.name ?? node.stage} · ${named.get(node.lane)?.name ?? pool?.name ?? ''}`;
  if (focus) registry.getGraphics(id)?.focus({ preventScroll: true });
}
function wireNodes() {
  for (const node of data.model.nodes) {
    const graphic: SVGElement | undefined = registry.getGraphics(node.id);
    if (!graphic) continue;
    graphic.setAttribute('tabindex', '0'); graphic.setAttribute('role', 'button');
    graphic.setAttribute('aria-label', `${types[node.type] ?? node.type}: ${node.name}`);
    graphic.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation(); selectNode(node.id, true);
    });
  }
}
function renderBridges() {
  if (!data.geometry.crossings?.length) return;
  const layer: SVGGElement = canvas.getLayer('bpmnforge-bridges', 1000);
  const ns = 'http://www.w3.org/2000/svg';
  for (const crossing of data.geometry.crossings) {
    const route: { x: number; y: number }[] = data.geometry.edges[crossing.over];
    const horizontal = route.slice(1).some((point, index) => route[index].y === point.y && point.y === crossing.point.y && Math.min(route[index].x, point.x) < crossing.point.x && crossing.point.x < Math.max(route[index].x, point.x));
    const { x, y } = crossing.point;
    const mask = document.createElementNS(ns, 'circle'); mask.setAttribute('cx', String(x)); mask.setAttribute('cy', String(y)); mask.setAttribute('r', '7'); mask.setAttribute('fill', '#fff'); mask.setAttribute('class', 'bpmnforge-bridge-mask'); mask.dataset.flows = crossing.flows.join(' '); layer.append(mask);
    const arc = document.createElementNS(ns, 'path');
    arc.setAttribute('d', horizontal ? `M ${x - 8} ${y} C ${x - 5} ${y - 10}, ${x + 5} ${y - 10}, ${x + 8} ${y}` : `M ${x} ${y - 8} C ${x + 10} ${y - 5}, ${x + 10} ${y + 5}, ${x} ${y + 8}`);
    arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', '#1c679e'); arc.setAttribute('stroke-width', '2.5'); arc.setAttribute('class', 'bpmnforge-bridge'); arc.dataset.flows = crossing.flows.join(' '); layer.append(arc);
  }
  layer.style.pointerEvents = 'none';
}
function wrapLabels() {
  const ns = 'http://www.w3.org/2000/svg';
  for (const node of data.model.nodes) {
    if (!['task', 'userTask', 'serviceTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'callActivity'].includes(node.type)) continue;
    const text = registry.getGraphics(node.id)?.querySelector('.djs-label') as SVGTextElement | null;
    const box = data.geometry.shapes[node.id];
    if (!text || !box) continue;
    const lines = textLines(node.name, box.width - 32, 14);
    text.replaceChildren(); text.setAttribute('font-family', 'Arial, sans-serif'); text.setAttribute('font-size', '14px'); text.style.fontFamily = 'Arial, sans-serif'; text.style.fontSize = '14px'; text.setAttribute('text-anchor', 'middle');
    text.setAttribute('transform', '');
    for (const [index, line] of lines.entries()) {
      const span = document.createElementNS(ns, 'tspan'); span.setAttribute('x', String(box.width / 2));
      span.setAttribute('y', String(box.height / 2 - lines.length * 18 / 2 + 14 + index * 18)); span.textContent = line; text.append(span);
    }
  }
  const labels = [...data.model.nodes.map((node: any) => ({ id: node.id, name: node.name })),
    ...data.model.flows.filter((flow: any) => flow.type !== 'association').map((flow: any) => ({ id: flow.id, name: flow.name ?? flow.condition ?? (data.model.nodes.some((node: any) => node.defaultFlow === flow.id) ? 'Иначе' : '') }))];
  for (const item of labels) {
    const box = data.geometry.labels[item.id], graphic = registry.getGraphics(`${item.id}_label`) as SVGElement | undefined;
    const text = graphic?.querySelector('text') as SVGTextElement | null;
    if (!box || !graphic || !text || !item.name) continue;
    // bpmn-js uses its own wrapping widths when importing DI. Restore the bounds
    // computed by the shared metrics before applying the same deterministic lines.
    graphic.setAttribute('transform', `translate(${box.x},${box.y})`);
    const element = registry.get(`${item.id}_label`); Object.assign(element, box);
    text.replaceChildren(); text.setAttribute('transform', ''); text.setAttribute('text-anchor', 'middle');
    text.style.fontFamily = 'Arial, sans-serif'; text.style.fontSize = '14px';
    const lines = textLines(item.name, box.width, 14);
    for (const [index, line] of lines.entries()) {
      const span = document.createElementNS(ns, 'tspan'); span.setAttribute('x', String(box.width / 2));
      span.setAttribute('y', String((box.height - lines.length * 18) / 2 + 14 + index * 18)); span.textContent = line; text.append(span);
    }
  }

}
const associationLabelById = new Map<string, HTMLElement>();
const laneItems: { element: HTMLElement; box: Box }[] = [];
function installLaneContext() {
  const contexts = data.model.pools.flatMap((pool: any) => {
    const lanes = data.model.lanes.filter((lane: any) => lane.process === pool.process);
    return lanes.length ? lanes : [pool];
  });
  for (const lane of contexts) {
    const box = data.geometry.shapes[lane.id]; if (!box) continue;
    const element = document.createElement('div'); element.className = 'lane-name'; element.dataset.lane = lane.id;
    const poolName = data.model.pools.find((p: any) => p.process === lane.process)?.name;
    element.textContent = lane.name;
    element.title = poolName && poolName !== lane.name ? `${poolName} · ${lane.name}` : lane.name;
    laneContext.append(element); laneItems.push({ element, box });
  }
}
function updateOverlays() {
  if (!imported) return;
  const view = canvas.viewbox();
  if (!associationLabels.hidden) for (const [id, label] of associationLabelById) {
    const box = data.geometry.labels[id];
    label.style.transform = `translate(${(box.x - view.x) * view.scale}px, ${(box.y - view.y) * view.scale}px) scale(${view.scale})`;
  }
  if (!laneContext.hidden) {
    const height = diagram.clientHeight;
    for (const { element, box } of laneItems) {
      const top = (box.y - view.y) * view.scale, bottom = (box.y + box.height - view.y) * view.scale;
      element.hidden = bottom < 24 || top > height - 24;
      if (!element.hidden) element.style.transform = `translateY(${Math.max(6, top + 4)}px)`;
    }
  }
}
let presentationFrame = 0;
function schedulePresentation() {
  if (presentationFrame || !imported) return;
  presentationFrame = requestAnimationFrame(() => {
    presentationFrame = 0; updateOverlays(); updateGrid(); updateZoom();
  });
}
const informationToggle = document.getElementById('information-toggle') as HTMLInputElement;
const informationFlows = data.model.flows.filter((f: any) => f.type === 'association' || f.type === 'message');
const informationIds = new Set<string>(informationFlows.map((f: any) => f.id));
document.getElementById('information-count')!.textContent = `Информационные связи (${informationFlows.length})`;
function toggleInformation() {
  for (const flow of informationFlows) {
    const element = registry.getGraphics(flow.id); if (element) element.style.display = informationToggle.checked ? '' : 'none';
    const label = registry.getGraphics(`${flow.id}_label`); if (label) label.style.display = informationToggle.checked ? '' : 'none';
  }
  associationLabels.hidden = !informationToggle.checked;
  updateOverlays();
  for (const bridge of diagram.querySelectorAll<SVGElement>('[data-flows]')) bridge.style.display = !informationToggle.checked && bridge.dataset.flows!.split(' ').some(id => informationIds.has(id)) ? 'none' : '';
}
informationToggle.addEventListener('change', toggleInformation);
function installOverlays() {
  for (const flow of data.model.flows.filter((f: any) => f.type === 'association' && f.name && data.geometry.labels[f.id])) {
    const label = document.createElement('div'); label.className = 'association-label'; label.dataset.flow = flow.id;
    label.textContent = textLines(flow.name, data.geometry.labels[flow.id].width, 14).join('\n');
    const box = data.geometry.labels[flow.id]; label.style.width = `${box.width}px`; label.style.height = `${box.height}px`;
    associationLabels.append(label); associationLabelById.set(flow.id, label);
  }
  installLaneContext();
  toggleInformation(); updateOverlays();
}
eventBus.on('canvas.viewbox.changed', () => { if (imported) { currentCamera = camera(); schedulePresentation(); } });
let suppressClick = false;
eventBus.on('element.click', (event: any) => {
  if (suppressClick) return;
  if (nodeById.has(event.element?.id)) selectNode(event.element.id);
});
for (const stage of data.model.stages) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = stage.name;
  button.dataset.stage = stage.id; button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => showStage(stage.id)); stages.append(button);
}
function updateStageScroll() {
  previousStages.hidden = nextStages.hidden = true;
  const overflow = stages.scrollWidth > stages.clientWidth + 1;
  previousStages.hidden = nextStages.hidden = !overflow;
  previousStages.disabled = stages.scrollLeft <= 1;
  nextStages.disabled = stages.scrollLeft + stages.clientWidth >= stages.scrollWidth - 1;
}
previousStages.addEventListener('click', () => stages.scrollBy({ left: -300, behavior: 'smooth' }));
nextStages.addEventListener('click', () => stages.scrollBy({ left: 300, behavior: 'smooth' }));
stages.addEventListener('scroll', updateStageScroll);
window.addEventListener('resize', updateStageScroll);
requestAnimationFrame(updateStageScroll);
overview.addEventListener('click', showOverview);
fit.addEventListener('click', () => activeStage ? showStage(activeStage, true) : showOverview());
document.getElementById('zoom-in')!.addEventListener('click', () => adjustZoom(1.2));
document.getElementById('zoom-out')!.addEventListener('click', () => adjustZoom(1 / 1.2));

diagram.addEventListener('wheel', event => {
  event.preventDefault(); const rect = diagram.getBoundingClientRect();
  if (!event.deltaY) return;
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? diagram.clientHeight : 1);
  const factor = Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.0003);
  adjustZoom(factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
}, { passive: false });
let dragging: { x: number; y: number; startX: number; startY: number; pointer: number; moved: boolean } | null = null;
diagram.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  suppressClick = false;
  dragging = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, pointer: event.pointerId, moved: false };
});
diagram.addEventListener('pointermove', event => {
  if (!dragging || dragging.pointer !== event.pointerId) return;
  if (!dragging.moved) {
    if (Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) < 4) return;
    dragging.moved = true;
    diagram.setPointerCapture(event.pointerId);
  }
  canvas.scroll({ dx: event.clientX - dragging.x, dy: event.clientY - dragging.y });
  dragging.x = event.clientX; dragging.y = event.clientY;
});
diagram.addEventListener('pointerup', () => {
  if (dragging?.moved) suppressClick = true;
  dragging = null;
});
diagram.addEventListener('pointercancel', () => { dragging = null; });
diagram.addEventListener('keydown', event => {
  if (event.target !== diagram && event.target !== diagram.querySelector('svg')) return;
  const moves: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
  if (moves[event.key]) canvas.scroll({ dx: moves[event.key][0], dy: moves[event.key][1] });
  else if (event.key === '+' || event.key === '=') adjustZoom(1.2);
  else if (event.key === '-') adjustZoom(1 / 1.2);
  else if (event.key === '0') activeStage ? showStage(activeStage, true) : showOverview();
  else return;
  event.preventDefault();
});

viewer.importXML(data.xml).then(({ warnings }: any) => {
  if (warnings.length) throw new Error('BPMN import warnings');
  imported = true; canvas.resized();
  wireNodes(); wrapLabels(); installGrid(); renderBridges(); installOverlays();
  const firstStage = data.model.stages[0]; if (firstStage) showStage(firstStage.id); else showOverview();
  document.body.dataset.ready = 'true';
}).catch(() => { document.body.dataset.error = 'true'; status.textContent = 'Не удалось открыть BPMN'; });
