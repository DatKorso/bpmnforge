import Viewer from 'bpmn-js/lib/Viewer.js';

const data = JSON.parse(document.getElementById('bpmnforge-data')!.textContent!);
const unavailableDocuments = new Set<string>((data.unavailableDocuments ?? []).map((item: { id: string; href: string }) => `${item.id}\u0000${item.href}`));
function documentUnavailable(ownerId: string, href: string) { return unavailableDocuments.has(`${ownerId}\u0000${href}`); }
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
const overviewNote = document.getElementById('overview-note')!;
const fit = document.getElementById('fit') as HTMLButtonElement;
const zoomValue = document.getElementById('zoom-value')!;
document.getElementById('title')!.textContent = data.model.name;
overview.textContent = 'Обзор схемы';

const gridToggle = document.getElementById('grid-toggle') as HTMLInputElement;
gridToggle.checked = false;
let gridLayer: SVGGElement | undefined;
let gridArea: SVGRectElement | undefined;
let gridMask: SVGMaskElement | undefined;
let gridMaskArea: SVGRectElement | undefined;

function updateGrid() {
  if (!gridLayer || !gridArea || !gridMask || !gridMaskArea) return;
  gridLayer.style.display = gridToggle.checked ? '' : 'none';
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
eventBus.on('canvas.viewbox.changed', updateGrid);
eventBus.on('canvas.resized', updateGrid);

let activeStage: string | null = null;
function updateZoom() { zoomValue.textContent = `${Math.round(canvas.zoom() * 100)}%`; }
function markStage(id: string | null) {
  activeStage = id;
  overview.setAttribute('aria-pressed', String(id === null));
  overviewNote.hidden = id !== null;
  fit.textContent = id === null ? 'Вписать схему' : 'К началу этапа';
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
function showOverview() { markStage(null); setView(canvas.viewbox().inner); status.textContent = 'Обзор схемы: выберите этап для чтения'; }
function stageFocus(id: string, bounds: { x: number; y: number; width: number; height: number }) {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  if (fitScale(bounds) >= 1.2) return center;
  const nodes = data.model.nodes.filter((node: any) => node.stage === id && data.geometry.shapes[node.id] && node.type !== 'eventSubProcess');
  const entries = nodes.filter((node: any) => node.type === 'start' || node.type === 'conditionalStart');
  const first = (entries.length ? entries : nodes).sort((a: any, b: any) => {
    const left = data.geometry.shapes[a.id], right = data.geometry.shapes[b.id];
    return left.x - right.x || left.y - right.y;
  })[0];
  if (!first) return center;
  const shape = data.geometry.shapes[first.id];
  const visibleWidth = canvas.viewbox().outer.width / 1.2;
  return { x: shape.x + shape.width / 2 + visibleWidth * 0.38, y: shape.y + shape.height / 2 };
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
  const name = flow.name?.trim() || (source?.defaultFlow === flow.id ? 'Иначе' : flow.condition ? 'Условный переход' : flow.type === 'message' ? 'Сообщение' : flow.type === 'association' ? 'Связь' : '');
  return [name, flow.originalType === 'message' ? 'информационная связь из исходной схемы' : '', flow.return ? 'Возврат' : ''].filter(Boolean).join(' — ');
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
    const prefix = flowName(flow);
    const label = [prefix, other?.name ?? otherId].filter(Boolean).join(': ');
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
    canvas.removeMarker(selectedId, 'bpmnforge-selected');
    for (const flow of data.model.flows.filter((item: any) => item.source === selectedId || item.target === selectedId)) canvas.removeMarker(flow.id, 'bpmnforge-related');
  }
  selectedId = id;
  if (activeStage !== node.stage) showStage(node.stage);
  reveal(id);
  canvas.addMarker(id, 'bpmnforge-selected');
  for (const flow of data.model.flows.filter((item: any) => item.source === id || item.target === id)) canvas.addMarker(flow.id, 'bpmnforge-related');
  details.replaceChildren();
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
  addText(details, 'h3', 'Описание'); addText(details, 'p', node.description || 'Описание не задано');
  if (node.type === 'eventSubProcess') {
    addText(details, 'h3', 'Внутренние шаги');
    for (const child of data.model.nodes.filter((item: any) => item.parent === node.id)) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = child.name;
      button.addEventListener('click', () => selectNode(child.id, true)); details.append(button);
    }
  }
  renderFlows(node, 'incoming'); renderFlows(node, 'outgoing');
  if (node.links?.length) {
    addText(details, 'h3', 'Документы');
    for (const link of node.links) {
      const row = document.createElement('p'); details.append(row);
      if (documentUnavailable(node.id, link.href)) addText(row, 'span', `${link.name} — файл недоступен`, 'document-unavailable');
      else { const a = document.createElement('a'); a.textContent = link.name; a.href = link.href; a.rel = 'noopener noreferrer'; row.append(a); }
    }
  }
  details.scrollTop = 0;
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
  const layer: SVGGElement = canvas.getLayer('bpmnforge-bridges', 1000);
  const ns = 'http://www.w3.org/2000/svg';
  for (const crossing of data.geometry.crossings) {
    const route: { x: number; y: number }[] = data.geometry.edges[crossing.over];
    const horizontal = route.slice(1).some((point, index) => route[index].y === point.y && point.y === crossing.point.y && Math.min(route[index].x, point.x) < crossing.point.x && crossing.point.x < Math.max(route[index].x, point.x));
    const { x, y } = crossing.point;
    const mask = document.createElementNS(ns, 'circle'); mask.setAttribute('cx', String(x)); mask.setAttribute('cy', String(y)); mask.setAttribute('r', '7'); mask.setAttribute('fill', '#fff'); mask.setAttribute('class', 'bpmnforge-bridge-mask'); layer.append(mask);
    const arc = document.createElementNS(ns, 'path');
    arc.setAttribute('d', horizontal ? `M ${x - 8} ${y} C ${x - 5} ${y - 10}, ${x + 5} ${y - 10}, ${x + 8} ${y}` : `M ${x} ${y - 8} C ${x + 10} ${y - 5}, ${x + 10} ${y + 5}, ${x} ${y + 8}`);
    arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', '#1c679e'); arc.setAttribute('stroke-width', '2.5'); arc.setAttribute('class', 'bpmnforge-bridge'); layer.append(arc);
  }
  layer.style.pointerEvents = 'none';
}
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
fit.addEventListener('click', () => activeStage ? showStage(activeStage) : showOverview());
document.getElementById('zoom-in')!.addEventListener('click', () => adjustZoom(1.2));
document.getElementById('zoom-out')!.addEventListener('click', () => adjustZoom(1 / 1.2));
eventBus.on('canvas.viewbox.changed', updateZoom);
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
  else if (event.key === '0') activeStage ? showStage(activeStage) : showOverview();
  else return;
  event.preventDefault();
});

viewer.importXML(data.xml).then(({ warnings }: any) => {
  if (warnings.length) throw new Error('BPMN import warnings');
  wireNodes(); installGrid(); renderBridges();
  const firstStage = data.model.stages[0]; if (firstStage) showStage(firstStage.id); else showOverview();
  document.body.dataset.ready = 'true';
}).catch(() => { document.body.dataset.error = 'true'; status.textContent = 'Не удалось открыть BPMN'; });
const list = document.getElementById('documents')!;
const shownLinks = new Set<string>();
const missingNames: string[] = [];
for (const item of [data.model, ...data.model.stages, ...data.model.processes, ...data.model.pools, ...data.model.lanes, ...data.model.nodes, ...(data.model.annotations ?? [])]) for (const link of item.links ?? []) {
  const key = `${link.name}\u0000${link.href}`;
  if (shownLinks.has(key)) continue;
  shownLinks.add(key);
  if (documentUnavailable(item.id, link.href)) { missingNames.push(link.name); continue; }
  const a = document.createElement('a'); a.textContent = link.name; a.setAttribute('href', link.href); a.rel = 'noopener noreferrer'; list.append(a);
}
if (missingNames.length) {
  const warning = addText(list, 'span', `Недоступные документы: ${missingNames.length}`, 'document-warning');
  warning.setAttribute('title', missingNames.join('; '));
}
