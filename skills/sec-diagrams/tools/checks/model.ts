/** Build the page model shared by the checks. Resolve labels, edges, paths, legend and connection numbers. */
import { styleValue, type Cell, type DrawioPage } from '../drawio.ts';

import { labelText, normalize } from '../label.ts';
import type { Profile } from '../profile.ts';
import { anchorPoint, edgePolyline, edgeRoute, isSeparatorLine, type EdgeRoute, type Point } from './geometry.ts';
import { findLegend, type LegendProbe } from './legend.ts';
import { listItemsOf, NUMBER_TEXT, numberBadges, type ListItem, type NumberBadge } from './badges.ts';
import { descendantsOf, shownIds } from './visibility.ts';
import { visibleLabel, wrapperText } from './placeholders.ts';

export {
  finding,
  notCheckedFinding,
  LEGEND_NOT_FOUND_KEY,
  LEGEND_NOT_FOUND_REASON,
  NO_MANIFEST_KEY,
  NO_MANIFEST_REASON,
  type Finding,
} from './finding.ts';

/** How the legend of the page was read: the skill's mark, a heading search, or not at all. */
export type LegendState = 'marked' | 'found' | 'none';

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface LocalGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  relative: boolean;
}

export interface PageLabel {
  id: string;
  raw: string;
  text: string;
  /** The label of the cell with placeholders substituted, free attributes aside. */
  visible: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  source: string;
  target: string;
  inLegend: boolean;
  /** The cell is a label of an edge: it moves with the line and is never the sheet title. */
  onEdge: boolean;
  box: Box | null;
}

export type { NumberBadge, ListItem } from './badges.ts';
export { LIST_ITEM, NUMBER_TOLERANCE } from './badges.ts';

export interface PageModel {
  file: string;
  page: string;
  profile: Profile;
  /** Prefix every title on this file carries, from the manifest; may be empty. */
  titlePrefix: string;
  /** False when the package folder has no manifest.json: SD-H01 cannot know the prefix. */
  hasManifest: boolean;
  /** Imported submission predating the manifest and the open-cell convention. */
  legacySubmission: boolean;
  /** How the legend of the page was read; 'none' turns the legend-dependent codes into NOT_CHECKED. */
  legend: LegendState;
  retired: Set<number>;
  /**
   * True in a copy for sending (manifest.json "final": true): SD-T04 then allows a whole
   * address and SD-T08 reports a stub. A working copy never has it.
   */
  final: boolean;
  /** Cell ids of this page whose own style carries the "sdRole=open" mark. */
  open: Set<string>;
  /** Wrapper cells whose "%имя%" has no attribute of that name: their text cannot be read. */
  unresolvedPlaceholders: string[];
  labels: PageLabel[];
  vertices: PageLabel[];
  edges: PageLabel[];
  connections: PageLabel[];
  badges: NumberBadge[];
  denyBadges: NumberBadge[];
  listItems: ListItem[];
  title: PageLabel | undefined;
  /** Absolute polyline of every edge whose ends can be read. */
  polylines: Map<string, Point[]>;
  /** Every cell on the page, labeled or not, inside the legend or not: for geometry probes. */
  allCells: PageLabel[];
  /** Every cell outside the legend, labeled or not: dashed notation lives on bare edges too. */
  cellsOutsideLegend: () => PageLabel[];
}

/** One element of the page XML as the core exposes it; the element type itself is private. */
export interface XmlElementLike {
  name: string;
  attributes: Map<string, string>;
  children: XmlElementLike[];
}

/** Types the core target without naming the core's private element type. */
export interface GeometrySource {
  styleHost: XmlElementLike;
}

function localGeometry(cell: PageLabel, targetOf: (id: string) => GeometrySource | undefined): LocalGeometry | null {
  const source = targetOf(cell.id);
  if (source === undefined) return null;
  const geometry = source.styleHost.children.find(
    (child) => child.name === 'mxGeometry' && (child.attributes.get('as') ?? 'geometry') === 'geometry',
  );
  if (geometry === undefined) return null;
  const number = (name: string): number => Number(geometry.attributes.get(name) ?? '0');
  return {
    x: number('x'),
    y: number('y'),
    width: number('width'),
    height: number('height'),
    relative: geometry.attributes.get('relative') === '1',
  };
}

/**
 * Absolute boxes of every cell with geometry, resolved through the whole parent chain: an icon
 * is a child of a node that is a child of a zone, and stopping at the direct parent would place
 * it by the node's local coordinates. A child placed with relative="1" sits by fractions of
 * its parent, like draw.io does. A parent cycle yields no box, the same as a missing geometry.
 */
function absoluteBoxes(geometryOf: Map<string, LocalGeometry>, parentOf: Map<string, string>): Map<string, Box | null> {
  const boxes = new Map<string, Box | null>();
  const resolve = (id: string, trail: Set<string>): Box | null => {
    const cached = boxes.get(id);
    if (cached !== undefined) return cached;
    const local = geometryOf.get(id);
    if (local === undefined || trail.has(id)) return null;
    const parentId = parentOf.get(id) ?? '';
    const parent = parentId === id ? null : resolve(parentId, new Set(trail).add(id));
    const parentW = parent === null ? 0 : parent.x2 - parent.x1;
    const parentH = parent === null ? 0 : parent.y2 - parent.y1;
    const x = parent === null ? local.x : local.relative ? parent.x1 + parentW * local.x : parent.x1 + local.x;
    const y = parent === null ? local.y : local.relative ? parent.y1 + parentH * local.y : parent.y1 + local.y;
    const width = local.relative && parent !== null ? parentW : local.width;
    const height = local.relative && parent !== null ? parentH : local.height;
    const box = { x1: x, y1: y, x2: x + width, y2: y + height };
    boxes.set(id, box);
    return box;
  };
  for (const id of geometryOf.keys()) resolve(id, new Set());
  return boxes;
}

const edgeColor = (style: string): string => (styleValue(style, 'strokeColor') ?? '#000000').toLowerCase();

const isLegendContainer = (cell: PageLabel): boolean => styleValue(cell.style, 'sdRole') === 'legend';

function legendIdsOf(cells: PageLabel[], parentOf: Map<string, string>): Set<string> {
  const containers = cells.filter(isLegendContainer).map((cell) => cell.id);
  const inside = new Set<string>(containers);
  for (const cell of cells) {
    let current: string | undefined = cell.id;
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      if (inside.has(current)) {
        inside.add(cell.id);
        break;
      }
      current = parentOf.get(current);
    }
  }
  return inside;
}

const geometryOfPage = (cellId: string, page: DrawioPage): EdgeRoute | undefined => {
  const host = page.source.targets.get(cellId)?.styleHost;
  if (host === undefined) return undefined;
  const geometry = host.children.find(
    (child) => child.name === 'mxGeometry' && (child.attributes.get('as') ?? 'geometry') === 'geometry',
  );
  return edgeRoute(geometry);
};

/**
 * The polyline of every edge: the ends are anchors on the frames of the
 * source and target cells, or the free sourcePoint/targetPoint when there is no cell there;
 * when the parent of the edge is a vertex, the raw points shift by its top left corner.
 */
function buildPolylines(
  edges: PageLabel[],
  routes: Map<string, EdgeRoute>,
  byId: Map<string, PageLabel>,
  parentOf: Map<string, string>,
): Map<string, Point[]> {
  const polylines = new Map<string, Point[]>();
  for (const edge of edges) {
    const route = routes.get(edge.id) ?? { points: [], sourcePoint: null, targetPoint: null };
    const parent = byId.get(parentOf.get(edge.id) ?? '');
    const offset =
      parent !== undefined && parent.vertex && parent.box !== null
        ? { x: parent.box.x1, y: parent.box.y1 }
        : { x: 0, y: 0 };
    const end = (cellId: string, raw: Point | null, kind: 'exit' | 'entry'): Point | null => {
      const cell = cellId === '' ? undefined : byId.get(cellId);
      if (cell !== undefined) return cell.edge || cell.box === null ? null : anchorPoint(cell.box, edge.style, kind);
      return raw === null ? null : { x: raw.x + offset.x, y: raw.y + offset.y };
    };
    const line = edgePolyline(
      end(edge.source, route.sourcePoint, 'exit'),
      end(edge.target, route.targetPoint, 'entry'),
      route.points,
      offset,
    );
    if (line !== null) polylines.set(edge.id, line);
  }
  return polylines;
}

function legendState(
  cells: PageLabel[],
  polylines: Map<string, Point[]>,
  parentOf: Map<string, string>,
  headings: string[],
  pageArea: number,
): { kind: LegendState; inside: Set<string> } {
  if (cells.some(isLegendContainer)) return { kind: 'marked', inside: legendIdsOf(cells, parentOf) };
  const probes: LegendProbe[] = cells.map((cell) => ({
    id: cell.id,
    parent: parentOf.get(cell.id) ?? '',
    vertex: cell.vertex,
    edge: cell.edge,
    connected: cell.edge && cell.source !== '' && cell.target !== '',
    text: cell.text,
    box: cell.box,
    line: polylines.get(cell.id) ?? null,
  }));
  const found = findLegend(probes, headings, pageArea);
  return { kind: found.found ? 'found' : 'none', inside: found.ids };
}

/** Topmost text cell: the title of the sheet,. Number badges sit at the
 * origin of their edge geometry and labels that ride on a line move with it, so digit-only and
 * edge-child labels must never win this race. */
function titleOf(vertices: PageLabel[]): PageLabel | undefined {
  const candidates = vertices.filter(
    (cell) => cell.box !== null && !cell.inLegend && !cell.onEdge && !NUMBER_TEXT.test(cell.text),
  );
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => {
    const left = a.box as Box;
    const right = b.box as Box;
    return left.y1 - right.y1 || left.x1 - right.x1 || a.id.localeCompare(b.id);
  })[0];
}

/** Connections exclude legend samples and the deny line. */
function isConnection(
  edge: PageLabel,
  polylines: Map<string, Point[]>,
  vertexBoxes: Box[],
  denyColor: string,
): boolean {
  if (edge.inLegend || edgeColor(edge.style) === denyColor) return false;
  if (edge.source !== '' && edge.target !== '') return true;
  const line = polylines.get(edge.id);
  return line !== undefined && !isSeparatorLine(edge, line, vertexBoxes);
}

/**
 * Reads one page of a package file into the facts the rules need. The last argument describes
 * which copy the folder is: a copy for sending (final) carries real addresses, and the values it
 * still leaves open are marked on the cells themselves with "sdRole=open" - the open command marks
 * them, and `rules` re-marks the cells named in poc.yaml on every rebuild of the rules page.
 */
export function buildModel(
  file: string,
  page: DrawioPage,
  profile: Profile,
  retired: number[],
  final: boolean = false,
): PageModel {
  const parentOf = new Map<string, string>(page.cells.map((cell: Cell) => [cell.id, cell.parent]));
  // Hidden cells (visible="0" by themselves or by an ancestor) join no rule and no count.
  const shown = shownIds(page.cells, parentOf);
  const unresolved: string[] = [];
  const cells: PageLabel[] = page.cells
    .filter((cell: Cell) => shown.has(cell.id))
    .map((cell: Cell) => {
      const raw = wrapperText(cell, unresolved);
      return {
        id: cell.id,
        raw,
        text: labelText(raw),
        visible: visibleLabel(cell),
        style: cell.style,
        vertex: cell.vertex,
        edge: cell.edge,
        source: cell.source,
        target: cell.target,
        inLegend: false,
        onEdge: false,
        box: null,
      };
    });
  const edgeIds = new Set(cells.filter((cell) => cell.edge).map((cell) => cell.id));
  for (const cell of cells) cell.onEdge = edgeIds.has(parentOf.get(cell.id) ?? '');

  const geometryOf = new Map<string, LocalGeometry>();
  for (const cell of cells) {
    const local = localGeometry(cell, (id) => page.source.targets.get(id));
    if (local !== null) geometryOf.set(cell.id, local);
  }
  const boxes = absoluteBoxes(geometryOf, parentOf);
  for (const cell of cells) cell.box = boxes.get(cell.id) ?? null;

  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  // A cell marked "sdRole=rules" is a table of ports and domains, not part of the scheme, and it
  // excuses only its own subtree: the line and number rules read the sheet without it. The
  // generated rules page marks every cell, so its whole area stays excused as it used to be,
  // and a stray table beside a real scheme no longer silences the scheme (C5 of the review).
  const rulesTree = descendantsOf(cells, parentOf, (cell) => styleValue(cell.style, 'sdRole') === 'rules');
  const edges = cells.filter((cell) => cell.edge && !rulesTree.has(cell.id));
  const routes = new Map<string, EdgeRoute>();
  for (const edge of edges) {
    const route = geometryOfPage(edge.id, page);
    if (route !== undefined) routes.set(edge.id, route);
  }
  const polylines = buildPolylines(edges, routes, byId, parentOf);

  const legend = legendState(cells, polylines, parentOf, profile.legendHeadings, page.width * page.height);
  for (const cell of cells) cell.inLegend = legend.inside.has(cell.id);

  const labels = cells.filter((cell) => cell.text !== '');
  const schemeLabels = labels.filter((cell) => !rulesTree.has(cell.id));
  const vertexBoxes = cells.filter((cell) => cell.vertex && cell.box !== null).map((cell) => cell.box as Box);
  const connections = edges.filter((edge) => isConnection(edge, polylines, vertexBoxes, profile.denyColor));
  const vertices = cells.filter((cell) => cell.vertex && cell.text !== '');

  const badges = numberBadges(schemeLabels, parentOf, connections, polylines);
  const denyEdges = edges.filter(edge => !edge.inLegend && edgeColor(edge.style) === profile.denyColor);
  // Keep every binding to a real connection. Only otherwise unbound labels can
  // belong solely to a deny symbol (as a child, on the line, or by geometry).
  const bound = new Set(badges.filter(badge => badge.edges.length > 0).map(badge => badge.cellId));
  const denyBadges = numberBadges(schemeLabels, parentOf, denyEdges, polylines)
    .filter(badge => badge.edges.length > 0 && !bound.has(badge.cellId));
  const denyIds = new Set(denyBadges.map(badge => badge.cellId));

  return {
    file,
    page: page.name,
    profile,
    titlePrefix: '',
    hasManifest: true,
    legacySubmission: false,
    legend: legend.kind,
    retired: new Set(retired),
    final,
    open: new Set(cells.filter((cell) => styleValue(cell.style, 'sdRole') === 'open').map((cell) => cell.id)),
    unresolvedPlaceholders: [...new Set(unresolved)].sort(),
    labels,
    vertices,
    edges,
    connections,
    badges: badges.filter(badge => !denyIds.has(badge.cellId)),
    denyBadges,
    listItems: listItemsOf(schemeLabels),
    title: titleOf(vertices),
    polylines,
    allCells: cells,
    cellsOutsideLegend: () => cells.filter((cell) => !cell.inLegend),
  };
}

/** Numbers still in use on the sheet, in ascending order. */
export const usedNumbers = (model: PageModel): number[] =>
  model.badges.map((badge) => badge.value).sort((a, b) => a - b);

/** Normalized single-line form used by the text rules. */
export const oneLine = (text: string): string => normalize(text);
