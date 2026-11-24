/**
 * Builders of the synthetic sent-style sheet the checker tests share: connections with
 * exit/entry anchors and kink points, numbers as separate white cells 24x24 with a border
 * whose centre sits on the line, a connection list, and a legend drawn as a plain frame with
 * the heading «Обозначения линий» and sample lines inside. Nothing here asserts.
 */
import { parseDrawio } from './drawio.ts';
import { loadProfile } from './profile.ts';
import { buildModel, type Finding, type PageModel } from './checks/model.ts';
import { checkNumbers } from './checks/numbers.ts';
import { checkLines } from './checks/lines.ts';
import { checkText } from './checks/text.ts';
import { checkSheet } from './checks/sheet.ts';

export const profile = loadProfile();

export const BOX_STYLE =
  'rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;fontFamily=Arial;fontSize=14;';
export const TEXT_STYLE = 'text;align=left;verticalAlign=middle;html=1;fontFamily=Arial;fontSize=14;';
export const NUMBER_STYLE = 'rounded=0;html=1;fillColor=#FFFFFF;strokeColor=#000000;fontFamily=Arial;fontSize=14;';
export const edgeStyle = (color: string, anchors: string): string =>
  'edgeStyle=orthogonalEdgeStyle;rounded=1;jumpStyle=arc;jumpSize=12;html=1;strokeWidth=2;strokeColor=' +
  color +
  ';endArrow=classic;' +
  anchors;

export const vertex = (
  id: string,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style = BOX_STYLE,
  parent = '1',
): string =>
  '<mxCell id="' +
  id +
  '" value="' +
  value +
  '" vertex="1" parent="' +
  parent +
  '" style="' +
  style +
  '">' +
  '<mxGeometry x="' +
  x +
  '" y="' +
  y +
  '" width="' +
  w +
  '" height="' +
  h +
  '" as="geometry"/></mxCell>';

export const numberCell = (id: string, value: string, cx: number, cy: number): string =>
  vertex(id, value, cx - 12, cy - 12, 24, 24, NUMBER_STYLE);

export const connection = (id: string, source: string, target: string, color: string, points: string = ''): string =>
  '<mxCell id="' +
  id +
  '" value="" edge="1" parent="1" source="' +
  source +
  '" target="' +
  target +
  '" ' +
  'style="' +
  edgeStyle(color, 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;') +
  '">' +
  '<mxGeometry relative="1" as="geometry">' +
  points +
  '</mxGeometry></mxCell>';

export const freeEdge = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  parent = '1',
): string =>
  '<mxCell id="' +
  id +
  '" value="" edge="1" parent="' +
  parent +
  '" style="' +
  edgeStyle(color, '') +
  '">' +
  '<mxGeometry relative="1" as="geometry"><mxPoint x="' +
  x1 +
  '" y="' +
  y1 +
  '" as="sourcePoint"/>' +
  '<mxPoint x="' +
  x2 +
  '" y="' +
  y2 +
  '" as="targetPoint"/></mxGeometry></mxCell>';

export const kinks = (...at: Array<[number, number]>): string =>
  '<Array as="points">' + at.map(([x, y]) => '<mxPoint x="' + x + '" y="' + y + '"/>').join('') + '</Array>';

export const wrap = (cells: string[], name = 'Лист'): string =>
  '<mxfile host="test"><diagram name="' +
  name +
  '">' +
  '<mxGraphModel page="1" pageWidth="1654" pageHeight="1169" grid="0"><root>' +
  '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
  cells.join('\n') +
  '</root></mxGraphModel></diagram></mxfile>';

export const TITLE = vertex(
  'title',
  'L3: Проверка номеров',
  40,
  20,
  1574,
  40,
  'text;align=left;sdRole=title;fontStyle=1;fontFamily=Arial;fontSize=20;html=1;',
);

export const BLOCKS = [
  vertex('b1', 'Блок один', 100, 120, 200, 60),
  vertex('b2', 'Блок два', 600, 120, 200, 60),
  vertex('b3', 'Блок три', 100, 300, 200, 60),
  vertex('b4', 'Блок четыре', 600, 360, 200, 60),
  vertex('b5', 'Блок пять', 100, 520, 200, 60),
  vertex('b6', 'Блок шесть', 600, 560, 200, 60),
  vertex('b7', 'Блок семь', 100, 700, 200, 60),
  vertex('b8', 'Блок восемь', 600, 720, 200, 60),
];

export const CONNECTIONS = [
  connection('e1', 'b1', 'b2', '#ad3b31'),
  connection('e2', 'b3', 'b4', '#2867a6', kinks([420, 330])),
  connection('e3', 'b5', 'b6', '#237a53', kinks([450, 550])),
  connection('e4', 'b7', 'b8', '#2867a6'),
];

export const NUMBERS = [
  numberCell('n1', '1', 450, 150),
  numberCell('n2', '2', 360, 330),
  numberCell('n3', '3', 375, 550),
  numberCell('n4', '4', 450, 740),
];

export const LIST = vertex(
  'list',
  '1. SSH (22/TCP) - доступ блока один к блоку два&#10;2. HTTPS (443/TCP) - доступ блока три к блоку четыре' +
    '&#10;3. HTTPS (443/TCP) - доступ блока пять к блоку шесть&#10;4. SSH (22/TCP) - доступ блока семь к блоку восемь',
  100,
  940,
  700,
  140,
  'text;align=left;verticalAlign=top;whiteSpace=wrap;html=1;fontFamily=Arial;fontSize=14;',
);

/** The legend without the skill's mark: a frame, a heading from the profile, samples inside. */
export const LEGEND = [
  vertex(
    'lf',
    '',
    950,
    120,
    600,
    420,
    'rounded=0;html=1;fillColor=none;strokeColor=#000000;fontFamily=Arial;fontSize=14;',
  ),
  vertex('legend-head', 'Обозначения линий', 20, 20, 540, 30, TEXT_STYLE, 'lf'),
  freeEdge('legend-line-1', 30, 80, 110, 80, '#ad3b31', 'lf'),
  freeEdge('legend-line-2', 30, 140, 110, 140, '#123456', 'lf'),
];

export const baseCells = (legend: string[]): string[] => [
  TITLE,
  ...BLOCKS,
  ...CONNECTIONS,
  ...NUMBERS,
  LIST,
  ...legend,
];

/** The sheet as a colleague drew it before the skill: nothing carries "sdRole=legend". */
export const sentSheet = (): string => wrap(baseCells(LEGEND));

export interface Analysis {
  model: PageModel;
  findings: Finding[];
  codes: string[];
}

export function analyse(content: string, retired: number[] = []): Analysis {
  const page = parseDrawio(content).pages[0];
  if (page === undefined) throw new Error('the sheet has no page');
  const model = buildModel('sent.drawio', page, profile, retired);
  model.titlePrefix = '';
  const findings = [...checkNumbers(model), ...checkLines(model), ...checkText(model), ...checkSheet(model)];
  return { model, findings, codes: findings.map((found) => found.code + ':' + found.status) };
}

export const idsOf = (analysis: Analysis): string[] => analysis.findings.flatMap((found) => found.ids);

export const trunkSheet = (targets: [string, string], line: string): string =>
  wrap([
    TITLE,
    vertex('src', 'Блок один', 100, 300, 200, 60),
    vertex('t1', targets[0], 700, 150, 200, 60),
    vertex('t2', targets[1], 700, 450, 200, 60),
    connection('e1', 'src', 't1', '#ad3b31', kinks([450, 330])),
    connection('e2', 'src', 't2', '#ad3b31', kinks([450, 330])),
    numberCell('n1', '1', 375, 330),
    vertex('list', line, 100, 940, 700, 60, TEXT_STYLE),
    ...LEGEND,
  ]);
