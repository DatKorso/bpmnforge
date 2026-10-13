import Viewer from 'bpmn-js/lib/Viewer.js';
const data = JSON.parse(document.getElementById('bplm-data')!.textContent!);
const viewer = new Viewer({ container: '#bpmn-canvas' });
(window as any).bplmViewer = viewer;
document.getElementById('title')!.textContent = data.model.name;
viewer.importXML(data.xml).then(({ warnings }: any) => {
  if (warnings.length) throw new Error('BPMN import warnings');
  viewer.get('canvas').zoom('fit-viewport');
  document.body.dataset.ready = 'true';
  document.getElementById('status')!.textContent = 'Схема загружена';
}).catch(() => { document.body.dataset.error = 'true'; document.getElementById('status')!.textContent = 'Не удалось открыть BPMN'; });
const list = document.getElementById('documents')!;
for (const item of [data.model, ...data.model.stages, ...data.model.processes, ...data.model.pools, ...data.model.lanes, ...data.model.nodes, ...(data.model.annotations ?? [])]) for (const link of item.links ?? []) {
  const a = document.createElement('a'); a.textContent = link.name; a.setAttribute('href', link.href); a.rel = 'noopener noreferrer'; list.append(a);
}
