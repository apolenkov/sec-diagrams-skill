/** Check connection colors, widths, arrowheads and jumps against the profile. The legend samples are excluded. */
import { styleValue } from '../drawio.ts';
import {
  LEGEND_NOT_FOUND_KEY,
  LEGEND_NOT_FOUND_REASON,
  type Finding,
  type PageModel,
  type PageLabel,
  finding,
  notCheckedFinding,
} from './model.ts';
import { authorAdvice } from './finding.ts';
import { hasArrow } from './arrows.ts';
import { hasArrowEnd } from './geometry.ts';

/**
 * Any line outside the legend at all. A page of tables only - the rules command builds such a
 * sheet, and a colleague may draw one without the sdRole=rules mark - has no lines: the rules
 * that subtract the legend's samples (SD-N01, SD-L01, SD-L02, SD-L05) find nothing to
 * read there and stay silent, without reporting the legend such a page never owes.
 */
export const hasLinesOutsideLegend = (model: PageModel): boolean => model.edges.some((edge) => !edge.inLegend);

const colorOf = (style: string): string => (styleValue(style, 'strokeColor') ?? '#000000').toLowerCase();

const isDeny = (edge: PageLabel, model: PageModel): boolean => colorOf(edge.style) === model.profile.denyColor;

const isDashed = (cell: PageLabel): boolean => styleValue(cell.style, 'dashed') === '1';

/** a dashed line never; a dashed frame only while the legend explains it
 * with a dashed frame sample (a sent legend draws the status frame, not a dashed line). */
function dashedRule(model: PageModel): string[] {
  const outside = model.cellsOutsideLegend().filter(isDashed);
  const hasSample = model.allCells.some((cell) => cell.inLegend && cell.vertex && isDashed(cell));
  return outside.filter((cell) => !(cell.vertex && hasSample)).map((cell) => cell.id);
}

/** a color outside the palette, or a color that needs an arrow drawn
 * without one at either end. `arrow: false` (black, an existing connection) means the arrow is
 * optional, not forbidden: sent sheets draw existing access both ways. */
function paletteRule(model: PageModel): string[] {
  const byColor = new Map(model.profile.edgePalette.map((entry) => [entry.color, entry.arrow]));
  const ids: string[] = [];
  for (const edge of model.connections) {
    const color = colorOf(edge.style);
    const needsArrow = byColor.get(color);
    const anyArrow = hasArrowEnd(edge.style, 'start') || hasArrowEnd(edge.style, 'end');
    if (needsArrow === undefined || (needsArrow && !anyArrow)) ids.push(edge.id);
  }
  return ids;
}

function denyArrowRule(model: PageModel): string[] {
  return model.edges
    .filter((edge) => !edge.inLegend && isDeny(edge, model) && !hasArrow(edge.style))
    .map((edge) => edge.id);
}

/** The width the sheet mostly uses; any other width is the deviation. */
function commonWidth(widths: number[]): number {
  const counts = new Map<number, number>();
  for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
}

function widthRule(model: PageModel): string[] {
  const widths = model.connections.map((edge) => Number(styleValue(edge.style, 'strokeWidth') ?? '1'));
  const common = commonWidth(widths);
  return model.connections.filter((edge, index) => (widths[index] ?? common) !== common).map((edge) => edge.id);
}

/**
 * A deny sample of a legend may omit the jump keys. On a sheet whose
 * legend the search only found, the sample is the free deny edge: no source, no target, no jump
 * keys, and the found area keeps it out of the rules anyway.
 */
const isDenySample = (edge: PageLabel, model: PageModel): boolean =>
  isDeny(edge, model) &&
  edge.source === '' &&
  edge.target === '' &&
  styleValue(edge.style, 'jumpStyle') === undefined &&
  styleValue(edge.style, 'jumpSize') === undefined;

function jumpRule(model: PageModel): string[] {
  const size = String(model.profile.jumpSize);
  const jumps = (style: string): boolean =>
    styleValue(style, 'jumpStyle') === 'arc' && styleValue(style, 'jumpSize') === size;
  return model.edges
    .filter((edge) => !edge.inLegend && !isDenySample(edge, model))
    .filter((edge) => styleValue(edge.style, 'rounded') !== '1' || !jumps(edge.style))
    .map((edge) => edge.id);
}

/** Two-way means an arrow head at both ends; the initiator mark is not a head at either. */
const isTwoWay = (style: string): boolean => hasArrowEnd(style, 'start') && hasArrowEnd(style, 'end');

function arrowRule(model: PageModel): string[] {
  return model.connections.filter((edge) => isTwoWay(edge.style)).map((edge) => edge.id);
}

const RULES: Array<{ code: string; ids: (model: PageModel) => string[] }> = [
  { code: 'SD-L02', ids: paletteRule },
  { code: 'SD-L03', ids: widthRule },
  { code: 'SD-L04', ids: jumpRule },
  { code: 'SD-L05', ids: arrowRule },
];

/**
 * Codes whose rule subtracts the legend's samples from the count. They run unchanged when the
 * legend carries the "sdRole=legend" mark and when the geometry search found it; only a sheet with
 * no legend at all is beyond them: the samples would be plain lines to the checker, so the rule
 * does not run and the page gets NOT_CHECKED with the legend-not-found reason instead.
 */
const LEGEND_CODES = new Set(['SD-L02', 'SD-L05']);

/** One finding per code and page. */
export function checkLines(model: PageModel): Finding[] {
  // A rules sheet draws tables, not lines: every cell under the "sdRole=rules" mark left the
  // model's edges already, so the notation rules have nothing to read - and never report the
  // missing legend. The same silence falls on any page without one line outside the legend,
  // marked or not: tables alone leave the rules nothing to read, and the legend is notation
  // for lines, not for tables.
  if (!hasLinesOutsideLegend(model)) return [];
  const findings: Finding[] = [];
  for (const rule of RULES) {
    if (model.legend === 'none' && LEGEND_CODES.has(rule.code)) {
      findings.push(notCheckedFinding(rule.code, model, LEGEND_NOT_FOUND_KEY, LEGEND_NOT_FOUND_REASON));
      continue;
    }
    const ids = rule.ids(model);
    if (ids.length > 0) findings.push(finding(rule.code, model, ids));
  }
  if (model.legend === 'none') {
    findings.push(notCheckedFinding('SD-L01', model, LEGEND_NOT_FOUND_KEY, LEGEND_NOT_FOUND_REASON));
  } else {
    const dashed = dashedRule(model);
    if (dashed.length) findings.push(authorAdvice(finding('SD-L01', model, dashed)));
    const deny = [...denyArrowRule(model), ...model.denyBadges.map(badge => badge.cellId)];
    if (deny.length) findings.push(authorAdvice(finding('SD-L02', model, deny)));
  }
  return findings;
}
