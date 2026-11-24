/** Find legend bounds from explicit annotations or from headings and marker geometry. */
import { normalize } from '../label.ts';
import type { Box } from './model.ts';
import type { Point } from './geometry.ts';

/** One visible cell of the page as the legend search sees it. */
export interface LegendProbe {
  id: string;
  parent: string;
  vertex: boolean;
  edge: boolean;
  /** The edge names both ends: a legend area holding such an edge is the sheet, not a legend. */
  connected: boolean;
  text: string;
  box: Box | null;
  /** The polyline of an edge; null when it cannot be read. */
  line: Point[] | null;
}

export interface LegendResult {
  /** True when a real area was found: a frame around a heading, a column, a band. */
  found: boolean;
  ids: Set<string>;
}

/** The fallback column heading, compared with the text folded to lower case. */
const LEGEND_WORD = 'легенда';
const ICON_KEY_ROW = 'значки на листе:';
/** The gap below which the "Легенда" column stops extending. */
const COLUMN_GAP = 140;
const MARGIN = 2;
/** A heading area over this share of the page is the sheet misread as a legend. */
export const LEGEND_MAX_SHARE = 0.35;

const lower = (text: string): string => normalize(text).toLowerCase();

const areaOf = (box: Box): Box => ({
  x1: box.x1 - MARGIN,
  y1: box.y1 - MARGIN,
  x2: box.x2 + MARGIN,
  y2: box.y2 + MARGIN,
});

const contains = (outer: Box, inner: Box): boolean =>
  outer.x1 <= inner.x1 && outer.y1 <= inner.y1 && outer.x2 >= inner.x2 && outer.y2 >= inner.y2;

const area = (box: Box): number => (box.x2 - box.x1) * (box.y2 - box.y1);

/**
 * The container of a seed heading: its parent when the parent is a vertex, else the smallest
 * vertex around it. When nothing contains the heading there is no area - a lone heading is not
 * a legend to read, and guessing its own narrow box as the legend would silently pass every
 * line outside it.
 */
function containerOf(seed: LegendProbe, byId: Map<string, LegendProbe>): Box | null {
  const parent = byId.get(seed.parent);
  if (parent !== undefined && parent.vertex && parent.box !== null) return parent.box;
  if (seed.box === null) return null;
  const seedBox = seed.box;
  const sameBox = (box: Box): boolean =>
    box.x1 === seedBox.x1 && box.y1 === seedBox.y1 && box.x2 === seedBox.x2 && box.y2 === seedBox.y2;
  const candidates = [...byId.values()].filter(
    (cell) =>
      cell.vertex && cell.id !== seed.id && cell.box !== null && contains(cell.box, seedBox) && !sameBox(cell.box),
  );
  const best = candidates.sort((a, b) => area(a.box as Box) - area(b.box as Box))[0];
  return best?.box ?? null;
}

/** Vertex cells whose box is readable, with the box already resolved out of the nullable field. */
function boxed(cells: LegendProbe[]): Array<{ id: string; box: Box }> {
  return cells.flatMap((cell) => (cell.vertex && cell.box !== null ? [{ id: cell.id, box: cell.box }] : []));
}

/** The bounded column below a cell whose whole text is "Легенда". */
function columnBelow(legend: LegendProbe, labels: LegendProbe[]): Box {
  const base = legend.box as Box;
  let right = base.x2;
  let bottom = base.y2;
  const candidates = boxed(labels)
    .filter((cell) => base.x1 <= cell.box.x1 && cell.box.x1 < base.x2 && cell.box.y1 >= base.y2)
    .sort((a, b) => a.box.y1 - b.box.y1 || a.box.x1 - b.box.x1);
  for (const cell of candidates) {
    if (cell.box.y1 - bottom > COLUMN_GAP) break;
    right = Math.max(right, cell.box.x2);
    bottom = Math.max(bottom, cell.box.y2);
  }
  return areaOf({ x1: base.x1, y1: base.y1, x2: right, y2: bottom });
}

/** The horizontal icon-key band that opens with "Значки на листе:". */
function iconKeyRow(heading: LegendProbe, cells: LegendProbe[]): Box | null {
  const base = heading.box as Box;
  const row = boxed(cells).filter((cell) => cell.box.x1 >= base.x1 && Math.abs(cell.box.y1 - base.y1) <= 4);
  if (row.length === 0) return null;
  return {
    x1: base.x1,
    y1: Math.min(...row.map((cell) => cell.box.y1)),
    x2: Math.max(...row.map((cell) => cell.box.x2)),
    y2: Math.max(...row.map((cell) => cell.box.y2)),
  };
}

interface SeededArea {
  box: Box;
  /** True when a profile heading seeded the area: those boxes carry the trust guards below. */
  fromHeading: boolean;
}

function areasOf(cells: LegendProbe[], headings: string[]): SeededArea[] {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const labels = cells.filter((cell) => cell.text !== '');
  const areas: SeededArea[] = [];
  const seeds = labels.filter((cell) => headings.some((heading) => lower(cell.text).includes(heading.toLowerCase())));
  for (const seed of seeds) {
    const box = containerOf(seed, byId);
    if (box !== null) areas.push({ box, fromHeading: true });
  }
  if (seeds.length === 0) {
    for (const cell of labels) {
      if (cell.vertex && cell.box !== null && lower(cell.text) === LEGEND_WORD)
        areas.push({ box: columnBelow(cell, labels), fromHeading: false });
    }
  }
  for (const cell of labels) {
    if (cell.box === null || lower(cell.text) !== ICON_KEY_ROW) continue;
    const band = iconKeyRow(cell, cells);
    if (band !== null) areas.push({ box: band, fromHeading: false });
  }
  return areas;
}

/**
 * A heading area is trusted while it is smaller than LEGEND_MAX_SHARE of the page and holds no
 * connection with both ends named: a legend of notation samples has neither. The page area of 0
 * (a sheet that does not state its size) disables the size guard only, never the connection one.
 */
function isTrustworthy(seeded: SeededArea, cells: LegendProbe[], pageArea: number): boolean {
  if (seeded.fromHeading && pageArea > 0 && area(seeded.box) > LEGEND_MAX_SHARE * pageArea) return false;
  return !cells.some((cell) => cell.edge && cell.connected && inside(cell, seeded.box));
}

/** An edge is inside only when its whole polyline is. */
function inside(cell: LegendProbe, box: Box): boolean {
  if (cell.edge) {
    return (
      cell.line !== null &&
      cell.line.every((p) => box.x1 - 0.5 <= p.x && p.x <= box.x2 + 0.5 && box.y1 - 0.5 <= p.y && p.y <= box.y2 + 0.5)
    );
  }
  return cell.box !== null && contains(box, cell.box);
}

/** Cells of a legend drawn without the skill's mark; found is false when no area was read. */
export function findLegend(cells: LegendProbe[], headings: string[], pageArea: number): LegendResult {
  const areas = areasOf(cells, headings).filter((seeded) => isTrustworthy(seeded, cells, pageArea));
  if (areas.length === 0) return { found: false, ids: new Set<string>() };
  const ids = new Set(cells.filter((cell) => areas.some((seeded) => inside(cell, seeded.box))).map((cell) => cell.id));
  return { found: true, ids };
}
