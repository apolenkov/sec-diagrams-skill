/**
 * The shared harness of the layout tests: the generated sheets parsed once, the geometry the
 * file carries for every numbered connection, and the few predicates the rules are phrased with.
 *
 * A failure in the rule files names the sheet and the connection, nothing else: internal ids
 * mean nothing to the person who has to fix the sheet.
 */
import { parseDrawio, type DrawioPage } from '../drawio.ts';
import {
  PAGE_FRAME,
  connectionPolyline,
  sheetCorridors,
  sheetCuts,
  sheetKeepOut,
  sheetSolids,
  sheetZones,
  type EdgeSpec,
  type SheetSpec,
} from '../template-cells.ts';
import { SHEETS } from '../template-sheets.ts';
import { templateFiles } from '../templates.ts';
import {
  CLEARANCE,
  LABEL_HEIGHT,
  NUMBER_H,
  NUMBER_W,
  gap,
  labelWidth,
  overlaps,
  pointOnPolyline,
  rect,
  segmentFrames,
  toFrame,
  type Piece,
  type Point,
  type Rect,
} from '../template-geometry.ts';

export const EPS = 0.05;
const FILE_NAMES = ['l1.drawio', 'l2.drawio', 'l3-1.drawio', 'l3-2.drawio'];
export const bands = (spec: SheetSpec): Rect[] => spec.firewalls.map(({ x, y, w, h }) => rect(x, y, w, h));

const num = (element: { attributes: Map<string, string> }, name: string): number =>
  Number(element.attributes.get(name) ?? '0');

/** The geometry the file carries for one cell: the path coordinate, the absolute offset, the route points. */
export function geometryOf(page: DrawioPage, id: string): { x: number; offset: Point; points: Point[] } {
  const target = page.source.targets.get(id);
  if (target === undefined) throw new Error('no cell ' + id + ' on the page');
  const geometry = target.styleHost.children.find((child) => child.name === 'mxGeometry');
  if (geometry === undefined) throw new Error('cell ' + id + ' has no geometry');
  const offset = geometry.children.find((child) => child.name === 'mxPoint' && child.attributes.get('as') === 'offset');
  const list = geometry.children.find((child) => child.name === 'Array' && child.attributes.get('as') === 'points');
  return {
    x: num(geometry, 'x'),
    offset: offset === undefined ? { x: 0, y: 0 } : { x: num(offset, 'x'), y: num(offset, 'y') },
    points: (list?.children ?? []).map((point) => ({ x: num(point, 'x'), y: num(point, 'y') })),
  };
}

export interface Routed {
  edge: EdgeSpec;
  line: Point[];
  numberCenter: Point;
  numberBox: Rect;
  labelBox: Rect;
}

/** Where draw.io will paint the pair: the point of the path at the written x, plus the written offset. */
function centerOf(page: DrawioPage, id: string, line: Point[]): Point {
  const geometry = geometryOf(page, id);
  const onPath = pointOnPolyline(line, geometry.x);
  return { x: onPath.x + geometry.offset.x, y: onPath.y + geometry.offset.y };
}

export const boxAround = (center: Point, halfWidth: number, halfHeight: number): Rect =>
  rect(center.x - halfWidth, center.y - halfHeight, halfWidth * 2, halfHeight * 2);

export const dot = (center: Point): Rect => boxAround(center, 0, 0);

function routedOf(page: DrawioPage, spec: SheetSpec): Routed[] {
  return spec.edges.flatMap((edge) => {
    if (edge.n === undefined) return [];
    const line = connectionPolyline(spec, edge);
    const numberCenter = centerOf(page, 'n' + edge.n, line);
    const labelCenter = centerOf(page, 'p' + edge.n, line);
    return [
      {
        edge,
        line,
        numberCenter,
        numberBox: boxAround(numberCenter, NUMBER_W / 2, NUMBER_H / 2),
        labelBox: boxAround(labelCenter, labelWidth(edge.protocol ?? '') / 2, LABEL_HEIGHT / 2),
      },
    ];
  });
}

export interface SheetData {
  name: string;
  spec: SheetSpec;
  page: DrawioPage;
  content: string;
  routed: Routed[];
  segments: Rect[];
  zones: Rect[];
  solids: Rect[];
  keepOut: Rect[];
  strips: Rect[];
  cuts: Rect[];
}

/** The frames the rules are read against: what a line is cut by, what the pair keeps off. */
export const framesOf = (spec: SheetSpec) => ({
  zones: sheetZones(spec),
  solids: sheetSolids(spec),
  keepOut: sheetKeepOut(spec),
  strips: sheetCorridors(spec),
  cuts: sheetCuts(spec),
});

export const sheetsData = (): SheetData[] =>
  SHEETS.map((spec, index) => {
    const name = FILE_NAMES[index] ?? '';
    const entry = templateFiles().find((file) => file.name === name);
    if (entry === undefined) throw new Error('missing template ' + name);
    const page = parseDrawio(entry.content).pages[0] as DrawioPage;
    return {
      name,
      spec,
      page,
      content: entry.content,
      routed: routedOf(page, spec),
      segments: segmentFrames(spec.edges.map((edge) => connectionPolyline(spec, edge))),
      ...framesOf(spec),
    };
  });

export const forEachSheet = (run: (data: SheetData) => void): void => {
  for (const data of sheetsData()) run(data);
};

/** What a finding may name: the sheet and the connection, nothing else. */
export const at = (data: SheetData, edge: EdgeSpec): string =>
  data.name + ' связь ' + (edge.n === undefined ? 'без номера' : edge.n);

const shrunk = (frame: Rect): Rect => ({ x1: frame.x1 + 1, y1: frame.y1 + 1, x2: frame.x2 - 1, y2: frame.y2 - 1 });

/** Whole inside one zone or whole outside all of them, never across a frame. */
export const singleZone = (box: Rect, zones: Rect[]): boolean =>
  zones.filter((zone) => overlaps(box, shrunk(zone))).length <= 1 &&
  zones.every((zone) => toFrame(box, zone) >= CLEARANCE - EPS);

export const inMargin = (box: Rect): boolean =>
  box.x1 >= PAGE_FRAME.x1 - EPS &&
  box.y1 >= PAGE_FRAME.y1 - EPS &&
  box.x2 <= PAGE_FRAME.x2 + EPS &&
  box.y2 <= PAGE_FRAME.y2 + EPS;

export const holds = (from: Rect, to: Rect): boolean => gap(from, to) >= CLEARANCE - EPS;

export const onFrame = (point: Point, frame: Rect): boolean =>
  point.x >= frame.x1 - EPS &&
  point.x <= frame.x2 + EPS &&
  point.y >= frame.y1 - EPS &&
  point.y <= frame.y2 + EPS &&
  ['x1', 'x2', 'y1', 'y2'].some((side) => Math.abs((side[0] === 'x' ? point.x : point.y) - frame[side as 'x1']) <= EPS);

export const frameOfPiece = (piece: Piece): Rect => ({
  x1: Math.min(piece.from.x, piece.to.x),
  y1: Math.min(piece.from.y, piece.to.y),
  x2: Math.max(piece.from.x, piece.to.x),
  y2: Math.max(piece.from.y, piece.to.y),
});

export const distanceToLine = (point: Point, line: Point[][]): number =>
  Math.min(...segmentFrames(line).map((segment) => gap(dot(point), segment)));
