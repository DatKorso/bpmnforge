import Viewer from 'bpmn-js/lib/Viewer.js';

const data = JSON.parse(document.getElementById('bplm-data')!.textContent!);
const viewer = new Viewer({ container: '#bpmn-canvas' });
(window as any).bplmViewer = viewer;
const canvas: any = viewer.get('canvas');
const eventBus: any = viewer.get('eventBus');
const diagram = document.getElementById('bpmn-canvas')!;
const status = document.getElementById('status')!;
const stages = document.getElementById('stages')!;
const overview = document.getElementById('overview') as HTMLButtonElement;
const zoomValue = document.getElementById('zoom-value')!;
document.getElementById('title')!.textContent = data.model.name;

let activeStage: string | null = null;
function updateZoom() { zoomValue.textContent = `${Math.round(canvas.zoom() * 100)}%`; }
function markStage(id: string | null) {
  activeStage = id;
  overview.setAttribute('aria-pressed', String(id === null));
  for (const button of stages.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.stage === id));
}
function setView(bounds: { x: number; y: number; width: number; height: number }, minimumScale = 0) {
  const outer = canvas.viewbox().outer;
  const scale = Math.min(2, Math.max(minimumScale, Math.min((outer.width - 50) / (bounds.width + 60), (outer.height - 50) / (bounds.height + 60))));
  const width = outer.width / scale, height = outer.height / scale;
  canvas.viewbox({ x: bounds.x - 30, y: bounds.y - 30, width, height });
  updateZoom();
}
function showOverview() { markStage(null); setView(data.geometry.viewport); status.textContent = 'Показана вся схема'; }
function showStage(id: string) {
  const stage = data.model.stages.find((item: any) => item.id === id);
  if (!stage || !data.geometry.stages[id]) return;
  markStage(id); setView(data.geometry.stages[id], 0.72); status.textContent = `Этап: ${stage.name}`;
}
function adjustZoom(factor: number, center?: { x: number; y: number }) {
  canvas.zoom(Math.max(0.2, Math.min(3, canvas.zoom() * factor)), center); updateZoom();
}
const registry: any = viewer.get('elementRegistry');
const details = document.getElementById('details')!;
const nodeById = new Map<string, any>(data.model.nodes.map((node: any) => [node.id, node]));
const named = new Map<string, any>([...data.model.processes, ...data.model.pools, ...data.model.lanes, ...data.model.nodes, ...(data.model.annotations ?? [])].map((item: any) => [item.id, item]));
const types: Record<string, string> = { start: 'Начало', end: 'Завершение', task: 'Задача', xor: 'Развилка: один исход', and: 'Параллельные ветви' };
let selectedId: string | null = null;
function addText(parent: Element, tag: string, value: string, className?: string): Element {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  parent.append(element); return element;
}
function flowName(flow: any): string {
  const source = nodeById.get(flow.source);
  const outcome = source?.defaultFlow === flow.id ? 'По умолчанию' : flow.condition ? `Условие: ${flow.condition}` : '';
  return [flow.name || flow.id, outcome, flow.return ? 'Возврат' : ''].filter(Boolean).join(' — ');
}
function reveal(id: string) {
  const box = data.geometry.shapes[id]; if (!box) return;
  const view = canvas.viewbox();
  if (box.x < view.x + 30 || box.x + box.width > view.x + view.width - 30 || box.y < view.y + 30 || box.y + box.height > view.y + view.height - 30) {
    canvas.viewbox({ x: box.x + box.width / 2 - view.width / 2, y: box.y + box.height / 2 - view.height / 2, width: view.width, height: view.height });
  }
}
function renderFlows(node: any, direction: 'incoming' | 'outgoing') {
  addText(details, 'h3', direction === 'incoming' ? 'Входящие связи' : 'Исходящие связи');
  const list = document.createElement('div'); list.className = 'neighbors'; details.append(list);
  const flows = data.model.flows.filter((flow: any) => direction === 'incoming' ? flow.target === node.id : flow.source === node.id);
  if (!flows.length) { addText(list, 'p', 'Нет связей'); return; }
  for (const flow of flows) {
    const otherId = direction === 'incoming' ? flow.source : flow.target;
    const other = named.get(otherId); const row = document.createElement('p'); list.append(row);
    const label = `${flowName(flow)}: ${other?.name ?? otherId}`;
    if (nodeById.has(otherId)) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.setAttribute('aria-label', `${direction === 'incoming' ? 'Перейти к предыдущему' : 'Перейти к следующему'} блоку: ${label}`);
      button.addEventListener('click', () => selectNode(otherId, true)); row.append(button);
    } else addText(row, 'span', label);
  }
}
function selectNode(id: string, focus = false) {
  const node = nodeById.get(id); if (!node) return;
  if (selectedId) {
    canvas.removeMarker(selectedId, 'bplm-selected');
    for (const flow of data.model.flows.filter((item: any) => item.source === selectedId || item.target === selectedId)) canvas.removeMarker(flow.id, 'bplm-related');
  }
  selectedId = id;
  if (activeStage !== node.stage) showStage(node.stage);
  reveal(id);
  canvas.addMarker(id, 'bplm-selected');
  for (const flow of data.model.flows.filter((item: any) => item.source === id || item.target === id)) canvas.addMarker(flow.id, 'bplm-related');
  details.replaceChildren();
  addText(details, 'h2', node.name);
  addText(details, 'p', `Тип: ${types[node.type] ?? node.type}`);
  addText(details, 'p', `Процесс: ${named.get(node.process)?.name ?? node.process}`);
  const pool = data.model.pools.find((item: any) => item.process === node.process);
  if (pool) addText(details, 'p', `Участник: ${pool.name}`);
  if (node.lane) addText(details, 'p', `Исполнитель: ${named.get(node.lane)?.name ?? node.lane}`);
  addText(details, 'p', `Этап: ${data.model.stages.find((item: any) => item.id === node.stage)?.name ?? node.stage}`);
  addText(details, 'h3', 'Описание'); addText(details, 'p', node.description || 'Описание не задано');
  renderFlows(node, 'incoming'); renderFlows(node, 'outgoing');
  if (node.links?.length) {
    addText(details, 'h3', 'Документы');
    for (const link of node.links) { const row = document.createElement('p'); const a = document.createElement('a'); a.textContent = link.name; a.href = link.href; a.rel = 'noopener noreferrer'; row.append(a); details.append(row); }
  }
  status.textContent = `Выбран блок: ${node.name}`;
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
eventBus.on('element.click', (event: any) => { if (nodeById.has(event.element?.id)) selectNode(event.element.id); });
for (const stage of data.model.stages) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = stage.name;
  button.dataset.stage = stage.id; button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => showStage(stage.id)); stages.append(button);
}
overview.addEventListener('click', showOverview);
document.getElementById('fit')!.addEventListener('click', () => activeStage ? showStage(activeStage) : showOverview());
document.getElementById('zoom-in')!.addEventListener('click', () => adjustZoom(1.2));
document.getElementById('zoom-out')!.addEventListener('click', () => adjustZoom(1 / 1.2));
eventBus.on('canvas.viewbox.changed', updateZoom);
diagram.addEventListener('wheel', event => {
  event.preventDefault(); const rect = diagram.getBoundingClientRect();
  adjustZoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, { x: event.clientX - rect.left, y: event.clientY - rect.top });
}, { passive: false });
let dragging: { x: number; y: number; pointer: number } | null = null;
diagram.addEventListener('pointerdown', event => {
  if (event.button !== 0 || (event.target as Element).closest('.djs-shape')) return;
  dragging = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
  diagram.setPointerCapture(event.pointerId);
});
diagram.addEventListener('pointermove', event => {
  if (!dragging || dragging.pointer !== event.pointerId) return;
  canvas.scroll({ dx: event.clientX - dragging.x, dy: event.clientY - dragging.y });
  dragging.x = event.clientX; dragging.y = event.clientY;
});
diagram.addEventListener('pointerup', () => { dragging = null; });
diagram.addEventListener('pointercancel', () => { dragging = null; });
diagram.addEventListener('keydown', event => {
  if (event.target !== diagram && event.target !== diagram.querySelector('svg')) return;
  const moves: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
  if (moves[event.key]) canvas.scroll({ dx: moves[event.key][0], dy: moves[event.key][1] });
  else if (event.key === '+' || event.key === '=') adjustZoom(1.2);
  else if (event.key === '-') adjustZoom(1 / 1.2);
  else if (event.key === '0') activeStage ? showStage(activeStage) : showOverview();
  else return;
  event.preventDefault();
});

viewer.importXML(data.xml).then(({ warnings }: any) => {
  if (warnings.length) throw new Error('BPMN import warnings');
  wireNodes(); showOverview(); document.body.dataset.ready = 'true'; status.textContent = 'Схема загружена';
}).catch(() => { document.body.dataset.error = 'true'; status.textContent = 'Не удалось открыть BPMN'; });
const list = document.getElementById('documents')!;
for (const item of [data.model, ...data.model.stages, ...data.model.processes, ...data.model.pools, ...data.model.lanes, ...data.model.nodes, ...(data.model.annotations ?? [])]) for (const link of item.links ?? []) {
  const a = document.createElement('a'); a.textContent = link.name; a.setAttribute('href', link.href); a.rel = 'noopener noreferrer'; list.append(a);
}
