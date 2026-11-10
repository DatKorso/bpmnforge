import type { Bounds } from './domain.ts';

/** Product conventions, not numerical requirements of the BPMN specification. */
export const READABLE = Object.freeze({
  id: 'readable-v1', grid: 20, taskWidths: [200, 240, 280] as readonly number[],
  taskHeightStep: 40, taskPadding: 16, preferredStepGap: 80, minimumStepGap: 40,
  branchGap: 40, routeGap: 14, shapeGap: 14, labelGap: 8, stub: 26, stubMinimum: 20, stubMaximum: 40,
  lanePadding: 40, emptyColumn: 80, bendCost: 40, crossingCost: 400,
  taskPortCost: 20, improvementPasses: 2, lengthGrowth: .05, extentGrowth: .10,
  labelOwnerDistance: 100, viewportMargin: 32, laneStrip: 180,
  minimumReadScale: 1, preferredReadScale: 1.25,
});
export const TASK_TYPES = new Set(['task', 'userTask', 'serviceTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'callActivity']);
export const gridCeil = (value: number) => Math.ceil(value / READABLE.grid) * READABLE.grid;
export const expanded = (box: Bounds, gap: number): Bounds => ({ x: box.x - gap, y: box.y - gap, width: box.width + gap * 2, height: box.height + gap * 2 });
/** Boundary-to-boundary distance (zero for overlapping/touching rectangles). */
export const boxDistance = (a: Bounds, b: Bounds) => Math.hypot(
  Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
  Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
);
