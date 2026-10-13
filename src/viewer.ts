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
  showOverview(); document.body.dataset.ready = 'true'; status.textContent = 'Схема загружена';
}).catch(() => { document.body.dataset.error = 'true'; status.textContent = 'Не удалось открыть BPMN'; });
const list = document.getElementById('documents')!;
for (const item of [data.model, ...data.model.stages, ...data.model.processes, ...data.model.pools, ...data.model.lanes, ...data.model.nodes, ...(data.model.annotations ?? [])]) for (const link of item.links ?? []) {
  const a = document.createElement('a'); a.textContent = link.name; a.setAttribute('href', link.href); a.rel = 'noopener noreferrer'; list.append(a);
}
