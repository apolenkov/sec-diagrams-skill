/**
 * Drawing primitives for the synthetic templates: styles, geometry helpers and the XML writer.
 *
 * Every style is assembled from pieces whose key sets do not overlap, so no key repeats in one
 * style and no later fontSize silently wins over an earlier one. Sizes follow the A3 contract:
 * the title is 20, zone captions are 16, nothing is smaller than 14 - after fitting the sheet
 * into A3 the smallest text still reads at 8 pt.
 */

import { FOOTER_TEXT } from './checks/text.ts';
import {
  anchorPoint,
  corridors,
  labelWidth,
  planConnection,
  rect,
  segmentFrames,
  type Point,
  type Rect,
} from './template-geometry.ts';

export interface CellDef {
  id: string;
  value: string;
  style: string;
  parent: string;
  kind: 'vertex' | 'edge';
  source?: string;
  target?: string;
  /** Edge labels and legend samples must not pick up connectors; draw.io marks them 0. */
  notConnectable?: boolean;
  geometry: string;
}

interface VertexArgs {
  id: string;
  value: string;
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
  parent?: string;
}

export const font = (size: number): string => 'fontFamily=Arial;fontSize=' + size + ';html=1;';
const titleStyle = (): string => 'text;align=left;sdRole=title;fontStyle=1;' + font(20);
const zoneStyle = (): string =>
  'rounded=0;fillColor=none;strokeColor=#000000;verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;' + font(16);
const legendStyle = (): string => zoneStyle() + 'sdRole=legend;';
const bandStyle = (): string =>
  'rounded=0;fillColor=#E6E6E6;strokeColor=#000000;verticalAlign=top;fontStyle=1;' + font(14);
const nodeStyle = (fill: string): string =>
  'rounded=0;whiteSpace=wrap;spacingLeft=48;fillColor=' + fill + ';' + font(14);
const swatchStyle = (fill: string): string => 'rounded=0;strokeColor=#000000;fillColor=' + fill + ';';
const iconStyle = (shape: string): string =>
  'html=1;outlineConnect=0;fillColor=#CCCCCC;strokeColor=#6881B3;shape=' + shape + ';';
const edgeStyle = (color: string, arrow: string): string =>
  'edgeStyle=orthogonalEdgeStyle;rounded=1;jumpStyle=arc;jumpSize=12;' +
  font(14) +
  'strokeWidth=2;strokeColor=' +
  color +
  ';endArrow=' +
  arrow +
  ';';
/** labelPadding=4: the border the ИБ draws around the digit must not touch the digit. */
const numberStyle = (): string =>
  'edgeLabel;html=1;align=center;verticalAlign=middle;fontFamily=Arial;fontSize=14;fontStyle=1;' +
  'labelBackgroundColor=#FFFFFF;labelBorderColor=#000000;labelPadding=4;';
/** Centered on the point the offset names - the pairing template-geometry.ts places the label with. */
const protocolStyle = (): string =>
  'edgeLabel;html=1;align=center;verticalAlign=middle;fontFamily=Arial;fontSize=14;labelBackgroundColor=none;';
const listStyle = (): string => 'text;align=left;verticalAlign=top;whiteSpace=wrap;' + font(14);
const rowStyle = (): string => 'text;align=left;verticalAlign=middle;' + font(14);
const footerStyle = (): string => 'text;align=left;fontColor=#FF0000;fontStyle=1;' + font(14);

export const RED = '#ad3b31';
export const GREEN = '#237a53';
export const PURPLE = '#754bb0';
export const BLUE = '#2867a6';
export const DENY = '#64748b';
const FILL_NEW = '#DAE8FC';
const FILL_OLD = '#FFFFFF';

export const SHAPES = {
  server: 'mxgraph.networks.server',
  arm: 'mxgraph.networks.monitor',
  proxy: 'mxgraph.networks.proxy_server',
  firewall: 'mxgraph.networks.firewall',
} as const;

export type IconName = keyof typeof SHAPES;

/** Icon frames keep the native ratio of each glyph so it never stretches. */
const ICON_FRAMES: Record<IconName, { x: number; y: number; w: number; h: number }> = {
  server: { x: 8, y: 8, w: 28, h: 34 },
  arm: { x: 6, y: 25, w: 40, h: 30 },
  proxy: { x: 8, y: 8, w: 28, h: 34 },
  firewall: { x: 8, y: 8, w: 28, h: 34 },
};

const LEGEND_MEANING: Record<string, string> = {
  [RED]: 'красный: управление',
  [GREEN]: 'зеленый: доступ приложения',
  [PURPLE]: 'фиолетовый: поток внутри сегмента',
  [BLUE]: 'синий: поток между сегментами',
  [DENY]: 'серая линия с крестом: запрещенный доступ',
};

const box = (x: number, y: number, w: number, h: number): string =>
  '<mxGeometry x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" as="geometry"/>';
const RELATIVE = '<mxGeometry relative="1" as="geometry"/>';

/** Numbers and labels keep x as the only path coordinate; y stays 0, see template-geometry.ts. */
const fmt = (value: number): string => String(Math.round(value * 1e4) / 1e4);

const edgeGeometry = (points: Array<[number, number]>): string =>
  points.length === 0
    ? RELATIVE
    : '<mxGeometry relative="1" as="geometry"><Array as="points">' +
      points.map(([x, y]) => '<mxPoint x="' + x + '" y="' + y + '"/>').join('') +
      '</Array></mxGeometry>';

const labelGeometry = (x: number, offset: Point): string =>
  '<mxGeometry x="' +
  fmt(x) +
  '" y="0" relative="1" as="geometry"><mxPoint x="' +
  fmt(offset.x) +
  '" y="' +
  fmt(offset.y) +
  '" as="offset"/></mxGeometry>';

/** The page area every frame must stay inside: the sheet margin is part of the A3 contract. */
export const PAGE_FRAME = rect(20, 20, 1654 - 40, 1169 - 40);

/* The sheet furniture outside the zones: the number and the label keep clear of every one of them. */
const TITLE_FRAME = rect(56, 24, 1536, 44);
const FOOTER_FRAME = rect(56, 1108, 1536, 27);

/** Cell geometry from a frame, so a frame is declared once and the cells read it. */
const place = (frame: Rect): { x: number; y: number; w: number; h: number } => ({
  x: frame.x1,
  y: frame.y1,
  w: frame.x2 - frame.x1,
  h: frame.y2 - frame.y1,
});

const sampleGeometry = (y: number): string =>
  '<mxGeometry relative="1" as="geometry"><mxPoint x="20" y="' +
  y +
  '" as="sourcePoint"/>' +
  '<mxPoint x="100" y="' +
  y +
  '" as="targetPoint"/></mxGeometry>';

const vertex = (args: VertexArgs): CellDef => ({
  id: args.id,
  value: args.value,
  style: args.style,
  parent: args.parent ?? '1',
  kind: 'vertex',
  geometry: box(args.x, args.y, args.w, args.h),
});

const escapeXml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    // A raw newline in an XML attribute is normalized to a space by any reader; a character
    // reference survives it. draw.io writes line breaks exactly this way.
    .replaceAll('\n', '&#10;');

function cellXml(cell: CellDef): string {
  const attrs = ['id="' + cell.id + '"', 'value="' + escapeXml(cell.value) + '"'];
  attrs.push(cell.kind === 'edge' ? 'edge="1"' : 'vertex="1"');
  if (cell.notConnectable === true) attrs.push('connectable="0"');
  attrs.push('parent="' + cell.parent + '"');
  if (cell.source !== undefined) attrs.push('source="' + cell.source + '"');
  if (cell.target !== undefined) attrs.push('target="' + cell.target + '"');
  attrs.push('style="' + escapeXml(cell.style) + '"');
  return '<mxCell ' + attrs.join(' ') + '>' + cell.geometry + '</mxCell>';
}

export function sheetXml(pageName: string, cells: CellDef[]): string {
  const lines = [
    '<mxfile host="sec-diagrams" type="device">',
    '<diagram name="' + escapeXml(pageName) + '">',
    '<mxGraphModel page="1" pageWidth="1654" pageHeight="1169" grid="0">',
    '<root>',
    '<mxCell id="0" />',
    '<mxCell id="1" parent="0" />',
    ...cells.map(cellXml),
    '</root>',
    '</mxGraphModel>',
    '</diagram>',
    '</mxfile>',
  ];
  return lines.join('\n') + '\n';
}

const FW_ICON = { x: 16, y: 36, w: 28, h: 34 };

export const fwIconFrame = (band: ZoneSpec): Rect =>
  rect(band.x + FW_ICON.x, band.y + FW_ICON.y, FW_ICON.w, FW_ICON.h);

export interface NodeSpec {
  id: string;
  label: string;
  zone: string;
  x: number;
  y: number;
  icon?: IconName;
  isNew: boolean;
}

export interface EdgeSpec {
  /** The denied connection carries no number and no protocol. */
  n?: number;
  color: string;
  from: string;
  to: string;
  protocol?: string;
  purpose?: string;
  /** Explicit bend points in page coordinates; the route is orthogonal through them. */
  points?: Array<[number, number]>;
  exit: [number, number];
  entry: [number, number];
}

export interface ZoneSpec {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetSpec {
  pageName: string;
  title: string;
  zones: ZoneSpec[];
  firewalls: ZoneSpec[];
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

export const NODE_W = 175;
export const NODE_H = 80;

/** Absolute frame of a node: its own coordinates are zone-relative. */
export const nodeFrame = (spec: SheetSpec, node: NodeSpec): Rect => {
  const zone = spec.zones.find((candidate) => candidate.id === node.zone);
  if (zone === undefined) throw new Error('node ' + node.id + ' stands in unknown zone ' + node.zone);
  return rect(zone.x + node.x, zone.y + node.y, NODE_W, NODE_H);
};

/** The strip a zone caption paints: top-left of the frame, one 16 pt line plus padding. */
export const zoneTitle = (zone: ZoneSpec): Rect => rect(zone.x + 4, zone.y + 2, 12 + zone.label.length * 9.6, 24);

/** Frame of an edge endpoint: a node by id, or a zone when the line runs to the zone frame. */
export const frameOf = (spec: SheetSpec, id: string): Rect => {
  const zone = spec.zones.find((candidate) => candidate.id === id);
  if (zone !== undefined) return rect(zone.x, zone.y, zone.w, zone.h);
  const node = spec.nodes.find((candidate) => candidate.id === id);
  if (node !== undefined) return nodeFrame(spec, node);
  throw new Error('edge endpoint ' + id + ' is neither a node nor a zone');
};

/** The route of a connection in page coordinates, endpoints on the frames included. */
export const connectionPolyline = (spec: SheetSpec, edge: EdgeSpec): Point[] => [
  anchorPoint(frameOf(spec, edge.from), edge.exit),
  ...(edge.points ?? []).map(([x, y]) => ({ x, y })),
  anchorPoint(frameOf(spec, edge.to), edge.entry),
];

/** Frame of a declared zone or of the firewall band. */
const boxOf = (frame: { x: number; y: number; w: number; h: number }): Rect => rect(frame.x, frame.y, frame.w, frame.h);

/** Zone frames: a piece of a line, a number and a label each lie whole in one of them or outside all. */
export const sheetZones = (spec: SheetSpec): Rect[] => spec.zones.map(boxOf);

/** The blocks, the firewall band and its glyph: nothing stands on them and no line runs along them. */
export const sheetSolids = (spec: SheetSpec): Rect[] => [
  ...spec.nodes.map((node) => nodeFrame(spec, node)),
  ...spec.firewalls.flatMap((band) => [boxOf(band), fwIconFrame(band)]),
];

/** Frames a route is cut by, so that a piece of it never straddles a border: zones, band, blocks. */
export const sheetCuts = (spec: SheetSpec): Rect[] => [...sheetZones(spec), ...sheetSolids(spec)];

/** The slits a line may only cross: between the corporate zone and the band, the band and the contour. */
export const sheetCorridors = (spec: SheetSpec): Rect[] => corridors([...spec.zones.map(boxOf), ...spec.firewalls.map(boxOf)]);

/** The sheet furniture outside the zones, by name: the number and the label keep clear of all of it. */
export const sheetChrome = (spec: SheetSpec): Record<string, Rect> => ({
  title: TITLE_FRAME,
  list: listFrame(spec),
  legend: legendFrame(spec),
  footer: FOOTER_FRAME,
});

/** Everything the number and the label keep CLEARANCE from: band, blocks, captions, sheet furniture. */
export const sheetKeepOut = (spec: SheetSpec): Rect[] => [
  ...sheetSolids(spec),
  ...spec.zones.map(zoneTitle),
  ...Object.values(sheetChrome(spec)),
];

function nodeCells(nodes: NodeSpec[]): CellDef[] {
  return nodes.flatMap((node) => {
    const cells = [
      vertex({
        id: node.id,
        value: node.label,
        style: nodeStyle(node.isNew ? FILL_NEW : FILL_OLD),
        x: node.x,
        y: node.y,
        w: NODE_W,
        h: NODE_H,
        parent: node.zone,
      }),
    ];
    if (node.icon === undefined) return cells;
    const frame = ICON_FRAMES[node.icon];
    return [
      ...cells,
      vertex({
        id: node.id + '-icon',
        value: '',
        style: iconStyle(SHAPES[node.icon]),
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
        parent: node.id,
      }),
    ];
  });
}

const anchorKeys = (exit: [number, number], entry: [number, number]): string =>
  'exitX=' + exit[0] + ';exitY=' + exit[1] + ';entryX=' + entry[0] + ';entryY=' + entry[1] + ';';

function edgeCells(spec: SheetSpec): CellDef[] {
  const cuts = sheetCuts(spec);
  const zones = sheetZones(spec);
  const solids = sheetSolids(spec);
  const keepOut = sheetKeepOut(spec);
  const strips = sheetCorridors(spec);
  const lines = spec.edges.map((edge) => connectionPolyline(spec, edge));
  const segments = lines.map((line) => segmentFrames([line]));
  const cells: CellDef[] = [];
  const taken: Rect[] = [];
  spec.edges.forEach((edge, index) => {
    const arrow = edge.color === DENY ? 'cross' : 'classic';
    const id = edge.n === undefined ? 'e-deny' : 'e' + edge.n;
    cells.push({
      id,
      value: '',
      style: edgeStyle(edge.color, arrow) + anchorKeys(edge.exit, edge.entry),
      parent: '1',
      kind: 'edge',
      source: edge.from,
      target: edge.to,
      geometry: edgeGeometry(edge.points ?? []),
    });
    if (edge.n === undefined) return;
    const own = segments[index] ?? [];
    const others = [...segments.filter((at, line) => line !== index).flat(), ...taken];
    const plan = planConnection({
      connectionName: spec.title + ' связь ' + edge.n,
      polyline: lines[index] as Point[],
      text: edge.protocol ?? '',
      cuts,
      zones,
      solids,
      keepOut,
      strips,
      own,
      others,
      page: PAGE_FRAME,
    });
    taken.push(plan.numberBox, plan.labelBox);
    cells.push(
      {
        id: 'n' + edge.n,
        value: String(edge.n),
        style: numberStyle(),
        parent: id,
        kind: 'vertex',
        notConnectable: true,
        geometry: labelGeometry(plan.x, { x: 0, y: 0 }),
      },
      {
        id: 'p' + edge.n,
        value: edge.protocol ?? '',
        style: protocolStyle(),
        parent: id,
        kind: 'vertex',
        notConnectable: true,
        geometry: labelGeometry(plan.x, plan.labelOffset),
      },
    );
  });
  return cells;
}

/** The legend is as wide as its longest row plus paddings; the list takes the rest of the row. */
const legendFrame = (spec: SheetSpec): Rect => {
  const longest = Math.max(...legendRows(spec).map((row) => labelWidth(row.label)));
  const w = Math.ceil(120 + longest + 20);
  return rect(1588 - w, 744, w, 317);
};

/** The connection list: everything left of the legend, between the zones and the footnote. */
const listFrame = (spec: SheetSpec): Rect => rect(56, 752, legendFrame(spec).x1 - 88, 278);

/** A list line as on the sent sheets: purpose first, then " - " and the protocol with its port. */
function listLine(edge: EdgeSpec): string {
  const purpose = edge.purpose ?? '';
  return String(edge.n) + '. ' + purpose.charAt(0).toUpperCase() + purpose.slice(1) + ' - ' + edge.protocol;
}

function listCells(edges: EdgeSpec[], frame: Rect): CellDef[] {
  const text = edges
    .filter((edge) => edge.n !== undefined)
    .map(listLine)
    .join('\n');
  return [vertex({ id: 'list', value: text, style: listStyle(), ...place(frame) })];
}

/** Legend rows: one per line color used on the sheet, then one per fill status present. */
function legendRows(spec: SheetSpec): Array<{ kind: 'line' | 'fill'; color: string; label: string }> {
  const rows: Array<{ kind: 'line' | 'fill'; color: string; label: string }> = [];
  const used: string[] = [];
  for (const edge of spec.edges) if (!used.includes(edge.color)) used.push(edge.color);
  for (const color of used) rows.push({ kind: 'line', color, label: LEGEND_MEANING[color] ?? '' });
  if (spec.nodes.some((node) => node.isNew)) rows.push({ kind: 'fill', color: FILL_NEW, label: 'Новый объект' });
  if (spec.nodes.some((node) => !node.isNew))
    rows.push({ kind: 'fill', color: FILL_OLD, label: 'Существующий объект' });
  return rows;
}

function legendCells(spec: SheetSpec): CellDef[] {
  const frame = legendFrame(spec);
  const rows = legendRows(spec);
  const textW = Math.ceil(Math.max(...rows.map((row) => labelWidth(row.label))));
  const cells: CellDef[] = [vertex({ id: 'legend', value: 'Легенда', style: legendStyle(), ...place(frame) })];
  rows.forEach((row, index) => {
    const y = 43 + index * 41;
    const id = 'legend-row-' + (index + 1);
    if (row.kind === 'line') {
      const arrow = row.color === DENY ? 'cross' : 'classic';
      cells.push({
        id,
        value: '',
        style: edgeStyle(row.color, arrow),
        parent: 'legend',
        kind: 'edge',
        geometry: sampleGeometry(y + 14),
      });
    } else {
      cells.push(
        vertex({ id, value: '', style: swatchStyle(row.color), x: 20, y: y + 2, w: 40, h: 24, parent: 'legend' }),
      );
    }
    cells.push(
      vertex({ id: id + '-text', value: row.label, style: rowStyle(), x: 120, y, w: textW, h: 28, parent: 'legend' }),
    );
  });
  return cells;
}

/** All cells of one sheet: title, zones, the firewall band, nodes, connections, list, legend. */
export function sheetCells(spec: SheetSpec): CellDef[] {
  return [
    vertex({ id: 'title', value: spec.title, style: titleStyle(), ...place(TITLE_FRAME) }),
    ...spec.zones.map((zone) => vertex({ ...zone, value: zone.label, style: zoneStyle() })),
    ...spec.firewalls.flatMap((band) => [
      vertex({ ...band, value: band.label, style: bandStyle() }),
      vertex({ id: band.id + '-icon', value: '', style: iconStyle(SHAPES.firewall), ...FW_ICON, parent: band.id }),
    ]),
    ...nodeCells(spec.nodes),
    ...edgeCells(spec),
    ...listCells(spec.edges, listFrame(spec)),
    ...legendCells(spec),
    vertex({ id: 'footer', value: FOOTER_TEXT, style: footerStyle(), ...place(FOOTER_FRAME) }),
  ];
}
