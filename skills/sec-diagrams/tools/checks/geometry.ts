/** Resolve edge paths, anchor positions and arrowheads from draw.io geometry. */
import { styleValue } from '../drawio.ts';
import type { Box } from './model.ts';

export interface Point {
  x: number;
  y: number;
}

/**
 * One element of the page XML as the core exposes it. Structurally the same shape as the
 * model's XmlElementLike, so the model can hand its elements over without an import cycle.
 */
export interface RouteElement {
  name: string;
  attributes: Map<string, string>;
  children: RouteElement[];
}

export interface EdgeRoute {
  points: Point[];
  sourcePoint: Point | null;
  targetPoint: Point | null;
}

const finite = (text: string | undefined): number => {
  const value = Number(text ?? '0');
  return Number.isFinite(value) ? value : 0;
};

export const boxCentre = (box: Box): Point => ({ x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 });

/** Points of `<Array as="points">` and the free ends of an edge geometry. */
export function edgeRoute(geometry: RouteElement | undefined): EdgeRoute {
  if (geometry === undefined) return { points: [], sourcePoint: null, targetPoint: null };
  const array = geometry.children.find((child) => child.name === 'Array' && child.attributes.get('as') === 'points');
  const points = (array?.children ?? [])
    .filter((child) => child.name === 'mxPoint')
    .map((child) => ({ x: finite(child.attributes.get('x')), y: finite(child.attributes.get('y')) }));
  let sourcePoint: Point | null = null;
  let targetPoint: Point | null = null;
  for (const child of geometry.children) {
    if (child.name !== 'mxPoint') continue;
    const as = child.attributes.get('as');
    const point = { x: finite(child.attributes.get('x')), y: finite(child.attributes.get('y')) };
    if (as === 'sourcePoint') sourcePoint = point;
    if (as === 'targetPoint') targetPoint = point;
  }
  return { points, sourcePoint, targetPoint };
}

/** A style fraction in [0, 1]. Undefined when absent or outside. */
const fraction = (style: string, key: string): number | undefined => {
  const raw = styleValue(style, key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
};

const shift = (style: string, key: string): number => finite(styleValue(style, key));

/** The point of the frame the edge is drawn from: the exit/entry fraction, else the centre. */
export function anchorPoint(box: Box, style: string, kind: 'exit' | 'entry'): Point {
  const fx = fraction(style, kind + 'X');
  const fy = fraction(style, kind + 'Y');
  if (fx === undefined || fy === undefined) return boxCentre(box);
  return {
    x: box.x1 + fx * (box.x2 - box.x1) + shift(style, kind + 'Dx'),
    y: box.y1 + fy * (box.y2 - box.y1) + shift(style, kind + 'Dy'),
  };
}

/** Source end, the routing points, target end (absolute); null when an end is unknown. */
export function edgePolyline(a: Point | null, b: Point | null, points: Point[], offset: Point): Point[] | null {
  if (a === null || b === null) return null;
  return [a, ...points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })), b];
}

function segmentDistance(pt: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / length));
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
}

/** The distance from a point to the closest segment of a polyline. */
export function polylineDistance(pt: Point, line: Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < line.length; index += 1)
    best = Math.min(best, segmentDistance(pt, line[index] as Point, line[index + 1] as Point));
  return best;
}

const ARROWLESS = new Set(['', 'none']);

/**
 * Marks a the reviewer solution puts at the start of a line to name the initiator of the connection
 * (a circle, a thin circle, a tick). They are notation, not arrow heads - at either end, so a
 * line drawn from the receiver back to the initiator still points one way (№13, №14).
 */
const INITIATOR_MARKS = new Set(['oval', 'ovalthin', 'dash', 'dashthin']);

/**
 * An arrow is anything that is not "" or
 * "none" and not an initiator mark; the end arrow is drawn by default.
 */
export function hasArrowEnd(style: string, end: 'start' | 'end'): boolean {
  const value = styleValue(style, end + 'Arrow');
  const fallback = end === 'end' && !style.startsWith(';') ? 'classic' : 'none';
  const drawn = (value ?? fallback).toLowerCase();
  return !ARROWLESS.has(drawn) && !INITIATOR_MARKS.has(drawn);
}

/**
 * An orthogonal line without a point to bend at, whose anchors sit on perpendicular sides of
 * their blocks (exit sideways, entry from above): draw.io must bend it through one right angle
 * the sheet does not hold, and the straight chord the checker reads is not the route the reader
 * sees. Anchors on parallel sides route near their chord, corner or centre anchors are not
 * readable at all - both keep the numbers under the rule.
 */
const sideOf = (fx: string | undefined, fy: string | undefined): boolean | null => {
  if (fx === undefined || fy === undefined) return null;
  const x = Number(fx);
  const y = Number(fy);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if ((x === 0 || x === 1) && y === 0.5) return true;
  if (x === 0.5 && (y === 0 || y === 1)) return false;
  return null;
};

export const orthogonallyRerouted = (style: string, line: Point[] | undefined): boolean => {
  if (styleValue(style, 'edgeStyle') !== 'orthogonalEdgeStyle') return false;
  if (line === undefined || line.length !== 2) return false;
  const from = line[0] as Point;
  const to = line[1] as Point;
  if (Math.abs(from.x - to.x) <= 1e-9 || Math.abs(from.y - to.y) <= 1e-9) return false;
  const exits = sideOf(styleValue(style, 'exitX'), styleValue(style, 'exitY'));
  const enters = sideOf(styleValue(style, 'entryX'), styleValue(style, 'entryY'));
  return exits !== null && enters !== null && exits !== enters;
};

export interface SeparatorProbe {
  source: string;
  target: string;
  style: string;
}

const touches = (point: Point, box: Box): boolean =>
  box.x1 - 3 <= point.x && point.x <= box.x2 + 3 && box.y1 - 3 <= point.y && point.y <= box.y2 + 3;

/**
 * A separator is an edge without source and target and without an arrow at either end,
 * whose ends touch no vertex. A frame or canvas that holds both ends does not count as touched:
 * it only groups the line. Any arrow or any touch of a real block makes the line a connection.
 */
export function isSeparatorLine(edge: SeparatorProbe, line: Point[], vertexBoxes: Box[]): boolean {
  if (edge.source !== '' || edge.target !== '') return false;
  if (hasArrowEnd(edge.style, 'end') || hasArrowEnd(edge.style, 'start')) return false;
  const first = line[0] as Point;
  const last = line[line.length - 1] as Point;
  for (const end of [first, last]) {
    for (const box of vertexBoxes) {
      if (!touches(end, box)) continue;
      const bothInside = touches(first, box) && touches(last, box);
      if (!bothInside) return false;
    }
  }
  return true;
}

/** the cell a single arrowhead points at; null for two heads or none. */
export function headAt(style: string, source: string, target: string): string | null {
  const start = hasArrowEnd(style, 'start');
  const end = hasArrowEnd(style, 'end');
  if (start === end) return null;
  return end ? target : source;
}
