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
function fitScale(bounds: { width: number; height: number }) {
  const outer = canvas.viewbox().outer;
  return Math.min(2, Math.min((outer.width - 50) / (bounds.width + 60), (outer.height - 50) / (bounds.height + 60)));
}
function setView(bounds: { x: number; y: number; width: number; height: number }, minimumScale = 0, center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }) {
  const outer = canvas.viewbox().outer;
  const fittedScale = fitScale(bounds);
  const scale = Math.max(minimumScale, fittedScale);
  const width = outer.width / scale, height = outer.height / scale;
  canvas.viewbox({ x: center.x - width / 2, y: center.y - height / 2, width, height });
  updateZoom();
}
function showOverview() { markStage(null); setView(canvas.viewbox().inner); status.textContent = 'Показана вся схема'; }
function stageFocus(id: string, bounds: { x: number; y: number; width: number; height: number }) {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  if (fitScale(bounds) >= 1.2) return center;
  const shapes = data.model.nodes.filter((node: any) => node.stage === id).map((node: any) => data.geometry.shapes[node.id]).filter(Boolean);
  return shapes.reduce((nearest: any, shape: any) => {
    const candidate = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    const distance = (candidate.x - center.x) ** 2 + (candidate.y - center.y) ** 2;
    return !nearest || distance < nearest.distance ? { ...candidate, distance } : nearest;
  }, null) ?? center;
}
function showStage(id: string) {
  const stage = data.model.stages.find((item: any) => item.id === id);
  if (!stage || !data.geometry.stages[id]) return;
  const bounds = data.geometry.stages[id];
  markStage(id); setView(bounds, 1.2, stageFocus(id, bounds)); status.textContent = `Этап: ${stage.name}`;
}
function adjustZoom(factor: number, center?: { x: number; y: number }) {
  canvas.zoom(Math.max(0.2, Math.min(3, canvas.zoom() * factor)), center); updateZoom();
}
const registry: any = viewer.get('elementRegistry');
const details = document.getElementById('details')!;
const nodeById = new Map<string, any>(data.model.nodes.map((node: any) => [node.id, node]));
const named = new Map<string, any>([...data.model.processes, ...data.model.pools, ...data.model.lanes, ...data.model.nodes, ...(data.model.annotations ?? [])].map((item: any) => [item.id, item]));
const types: Record<string, string> = { start: 'Начало', end: 'Завершение', task: 'Задача', userTask: 'Действие пользователя', serviceTask: 'Сервисная задача', sendTask: 'Отправка сообщения', receiveTask: 'Получение сообщения', businessRuleTask: 'Бизнес-правило', callActivity: 'Вызов общего процесса', timerCatch: 'Ожидание времени', conditionalStart: 'Начало по условию', terminateEnd: 'Завершение процесса', eventSubProcess: 'Событийный подпроцесс', xor: 'Развилка: один исход', and: 'Параллельные ветви' };
let selectedId: string | null = null;
function addText(parent: Element, tag: string, value: string, className?: string): Element {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  parent.append(element); return element;
}
function flowName(flow: any): string {
  const source = nodeById.get(flow.source);
  const outcome = source?.defaultFlow === flow.id ? 'По умолчанию' : flow.condition ? `Условие: ${flow.condition}` : '';
  return [flow.name || flow.id, flow.originalType === 'message' ? 'информационная связь из исходной схемы' : '', outcome, flow.return ? 'Возврат' : ''].filter(Boolean).join(' — ');
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
  if (node.parent) {
    const parent = nodeById.get(node.parent);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `Подпроцесс: ${parent?.name ?? node.parent}`;
    button.addEventListener('click', () => selectNode(node.parent, true)); details.append(button);
  }
  addText(details, 'p', `Этап: ${data.model.stages.find((item: any) => item.id === node.stage)?.name ?? node.stage}`);
  addText(details, 'h3', 'Описание'); addText(details, 'p', node.description || 'Описание не задано');
  if (node.type === 'eventSubProcess') {
    addText(details, 'h3', 'Внутренние шаги');
    for (const child of data.model.nodes.filter((item: any) => item.parent === node.id)) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = child.name;
      button.addEventListener('click', () => selectNode(child.id, true)); details.append(button);
    }
  }
  if (node.type === 'callActivity') {
    const start = data.model.nodes.find((item: any) => item.process === node.calledElement && item.type === 'start' && !item.parent);
    if (start) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `Открыть общий процесс: ${named.get(node.calledElement)?.name ?? node.calledElement}`;
      button.addEventListener('click', () => selectNode(start.id, true)); details.append(button);
    }
  }
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
function renderBridges() {
  if (!data.geometry.crossings?.length) return;
  const layer: SVGGElement = canvas.getLayer('bplm-bridges', 1000);
  const ns = 'http://www.w3.org/2000/svg';
  for (const crossing of data.geometry.crossings) {
    const route: { x: number; y: number }[] = data.geometry.edges[crossing.over];
    const horizontal = route.slice(1).some((point, index) => route[index].y === point.y && point.y === crossing.point.y && Math.min(route[index].x, point.x) < crossing.point.x && crossing.point.x < Math.max(route[index].x, point.x));
    const { x, y } = crossing.point;
    const mask = document.createElementNS(ns, 'circle'); mask.setAttribute('cx', String(x)); mask.setAttribute('cy', String(y)); mask.setAttribute('r', '7'); mask.setAttribute('fill', '#fff'); mask.setAttribute('class', 'bplm-bridge-mask'); layer.append(mask);
    const arc = document.createElementNS(ns, 'path');
    arc.setAttribute('d', horizontal ? `M ${x - 8} ${y} C ${x - 5} ${y - 10}, ${x + 5} ${y - 10}, ${x + 8} ${y}` : `M ${x} ${y - 8} C ${x + 10} ${y - 5}, ${x + 10} ${y + 5}, ${x} ${y + 8}`);
    arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', '#1c679e'); arc.setAttribute('stroke-width', '2.5'); arc.setAttribute('class', 'bplm-bridge'); layer.append(arc);
  }
  layer.style.pointerEvents = 'none';
}
let suppressClickUntil = 0;
eventBus.on('element.click', (event: any) => {
  if (performance.now() < suppressClickUntil) return;
  if (nodeById.has(event.element?.id)) selectNode(event.element.id);
});
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
let dragging: { x: number; y: number; startX: number; startY: number; pointer: number; moved: boolean } | null = null;
diagram.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  dragging = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, pointer: event.pointerId, moved: false };
  diagram.setPointerCapture(event.pointerId);
});
diagram.addEventListener('pointermove', event => {
  if (!dragging || dragging.pointer !== event.pointerId) return;
  if (!dragging.moved) {
    if (Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) < 4) return;
    dragging.moved = true;
  }
  canvas.scroll({ dx: event.clientX - dragging.x, dy: event.clientY - dragging.y });
  dragging.x = event.clientX; dragging.y = event.clientY;
});
diagram.addEventListener('pointerup', () => {
  if (dragging?.moved) suppressClickUntil = performance.now() + 250;
  dragging = null;
});
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
  wireNodes(); renderBridges();
  const firstStage = data.model.stages[0]; if (firstStage) showStage(firstStage.id); else showOverview();
  document.body.dataset.ready = 'true'; status.textContent = 'Схема загружена';
}).catch(() => { document.body.dataset.error = 'true'; status.textContent = 'Не удалось открыть BPMN'; });
const list = document.getElementById('documents')!;
const shownLinks = new Set<string>();
for (const item of [data.model, ...data.model.stages, ...data.model.processes, ...data.model.pools, ...data.model.lanes, ...data.model.nodes, ...(data.model.annotations ?? [])]) for (const link of item.links ?? []) {
  const key = `${link.name}\u0000${link.href}`;
  if (shownLinks.has(key)) continue;
  shownLinks.add(key);
  const a = document.createElement('a'); a.textContent = link.name; a.setAttribute('href', link.href); a.rel = 'noopener noreferrer'; list.append(a);
}
