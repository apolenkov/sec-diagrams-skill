/**
 * The fix --safe planner: what one cell would become under the profile, and how a whole sheet
 * converges. Split out of cli.ts (the agent file-size cap); cli.ts re-exports fixContext and
 * planCell so the tests keep their import. The plan must read a sheet the way check reads it -
 * the same model, the same regions: a hidden cell joins no rule and
 * no count, a legend found by the geometry search excuses its samples just like a marked one, and
 * what check does not report, fix must not rewrite and must not count.
 *
 * In a copy for sending fix edits styles only: a filled-in label is a person's pen, so a value
 * fix is reported by code and cell id and left for the person to make in draw.io.
 */
import {
  setCellStyle,
  setCellValue,
  setStyleKey,
  styleValue,
  parseDrawio,
  type Cell,
  type DrawioFile,
} from './drawio.ts';
import { buildModel } from './checks/model.ts';
import { cleanFont, decodeEntities, labelFonts } from './label.ts';
import { loadProfile, type Profile } from './profile.ts';

export const FIX_CODES = ['SD-T01', 'SD-F01', 'SD-L04'] as const;

type FixCode = (typeof FIX_CODES)[number];

/** What fix --safe may rewrite: the fonts and the edge jump size come from the profile, not from code. */
export interface FixContext {
  fonts: Set<string>;
  font: string;
  jumpSize: string;
  profile: Profile;
}

/** Exported for tests: the plan must read the same profile the check reads. */
export const fixContext = (profile: Profile = loadProfile()): FixContext => ({
  fonts: new Set(profile.fonts),
  font: profile.fonts[0] as string,
  jumpSize: String(profile.jumpSize),
  profile,
});

const edgeStyleKeys = (fix: FixContext): Array<[string, string]> => [
  ['rounded', '1'],
  ['jumpStyle', 'arc'],
  ['jumpSize', fix.jumpSize],
];

/**
 * Safe label substitutions only: ё/Ё, «», a long or medium dash between digits, and the long
 * dash that parts a list line "N. назначение — протокол", where the notation wants " - ". The
 * substitutions reach label text only: between an opening and a closing tag - encoded as in a
 * stored value or raw - stands markup, an href or a face, and those bytes stay untouched
 *. Every tag boundary or newline starts a line of its own, so a whole <br>-list
 * converges in one pass, not one dash per run.
 */
function fixLabel(value: string): string {
  const clean = (text: string): string =>
    text
      .replaceAll('ё', 'е')
      .replaceAll('Ё', 'Е')
      .replaceAll('«', '"')
      .replaceAll('»', '"')
      .replace(/(?<=[0-9])[—–](?=[0-9])/gu, '-')
      .replace(/^(\d{1,2}\. [^\n]*?) [—–] /u, '$1 - ');
  const isMarkup = (part: string): boolean =>
    part !== '' && (part === '\n' || part.startsWith('&lt;') || part.startsWith('<'));
  return value
    .split(/(&lt;.*?&gt;|<.*?>|\n)/gsu)
    .map((part) => (isMarkup(part) ? part : clean(part)))
    .join('');
}

export interface CellPlan {
  cellId: string;
  pageIndex: number;
  kind: 'value' | 'style';
  next: string;
  codes: FixCode[];
}

/**
 * Exported for tests: how one cell would be rewritten. The decisions mirror the checks: an edge
 * inside the legend is notation the reviewer compares with the samples, so check never reports
 * it and fix never touches its style; a font the label asks for in its own markup is
 * the markup's business - fix edits the cell's style text, never that markup.
 */
export function planCell(cell: Cell, fix: FixContext, inLegend = false, withText = true): CellPlan | undefined {
  const base = { cellId: cell.id, pageIndex: cell.pageIndex };
  const fixedLabel = fixLabel(cell.value);
  if (withText && fixedLabel !== cell.value) return { ...base, kind: 'value', next: fixedLabel, codes: ['SD-T01'] };
  const codes: FixCode[] = [];
  let style = cell.style;
  if (cell.edge && !inLegend) {
    for (const [key, wanted] of edgeStyleKeys(fix)) {
      if (styleValue(style, key) === wanted) continue;
      style = setStyleKey(style, key, wanted);
      if (!codes.includes('SD-L04')) codes.push('SD-L04');
    }
  }
  const styled = cell.value === '' ? undefined : styleValue(style, 'fontFamily');
  const allowed = new Set<string>([...fix.fonts].map(cleanFont));
  const markup = labelFonts(decodeEntities(cell.value))
    .map(cleanFont)
    .filter((family) => family !== '');
  const styleFontBroken = styled !== undefined && !allowed.has(cleanFont(styled));
  // Same reading as SD-F01: a font the markup asks for is not on the list - fix cannot rewrite
  // markup, it would only pretend to fix the cell. A font the markup allows is enough: the cell
  // style is left alone unless it contradicts the list itself.
  let needsFont = false;
  if (cell.value !== '' && !markup.some((family) => !allowed.has(family))) {
    needsFont = markup.length > 0 ? styleFontBroken : styled === undefined || styleFontBroken;
  }
  if (needsFont) {
    style = setStyleKey(style, 'fontFamily', fix.font);
    codes.push('SD-F01');
  }
  if (codes.length === 0) return undefined;
  return { ...base, kind: 'style', next: style, codes };
}

/**
 * The regions the plan must read the way check reads them: hidden cells take no part in any
 * rule, and the legend is decided by the same search check runs - the skill's mark or a frame
 * found by geometry. buildModel is the single source of both answers.
 */
function pageRegions(
  drawio: DrawioFile,
  pageIndex: number,
  fix: FixContext,
): { shown: Set<string>; legend: Set<string> } {
  const page = drawio.pages[pageIndex];
  if (page === undefined) return { shown: new Set(), legend: new Set() };
  const model = buildModel(page.name, page, fix.profile, [], false);
  const shown = new Set(model.allCells.map((cell) => cell.id));
  const legend = new Set(model.allCells.filter((cell) => cell.inLegend).map((cell) => cell.id));
  return { shown, legend };
}

/**
 * One pass over the sheet: the first plan to apply, plus the value cells the copy refuses to
 * edit. A refused cell is remembered by id, so the next round does not offer it again.
 */
function planRound(
  drawio: DrawioFile,
  fix: FixContext,
  values: boolean,
  seen: Set<string>,
): { plan?: CellPlan; manual: string[] } {
  const manual: string[] = [];
  for (const page of drawio.pages) {
    const regions = pageRegions(drawio, page.index, fix);
    for (const cell of page.cells) {
      // A hidden cell is a draft layer: check does not see it, so fix neither rewrites nor counts it.
      if (!regions.shown.has(cell.id)) continue;
      const handled = String(page.index) + ':' + cell.id;
      if (!values) {
        // A copy for sending: the text is a person's pen. Report it once, keep its bytes, and
        // plan the style on its own - a font is fixed whatever the label says.
        if (!seen.has(handled) && fixLabel(cell.value) !== cell.value) {
          seen.add(handled);
          manual.push(cell.id);
        }
        const style = planCell(cell, fix, regions.legend.has(cell.id), false);
        if (style !== undefined) return { plan: style, manual };
        continue;
      }
      const plan = planCell(cell, fix, regions.legend.has(cell.id));
      if (plan !== undefined) return { plan, manual };
    }
  }
  return { manual };
}

export function fixFile(
  drawio: DrawioFile,
  fix: FixContext,
  values = true,
): { text: string; counts: Map<FixCode, number>; manual: string[] } {
  const counts = new Map<FixCode, number>(FIX_CODES.map((code) => [code, 0]));
  const manual: string[] = [];
  const seen = new Set<string>();
  let current = drawio;
  let text = drawio.text;
  // Each cell needs at most a label edit and a style edit; more rounds mean the plan does not converge.
  const limit = 2 * drawio.pages.reduce((sum, page) => sum + page.cells.length, 0) + 1;
  for (let round = 0; ; round += 1) {
    const pass = planRound(current, fix, values, seen);
    manual.push(...pass.manual);
    const plan = pass.plan;
    if (plan === undefined) break;
    if (round >= limit) throw new Error('fix --safe did not converge after ' + String(limit) + ' edits');
    for (const code of plan.codes) counts.set(code, (counts.get(code) ?? 0) + 1);
    text =
      plan.kind === 'value'
        ? setCellValue(current, plan.pageIndex, plan.cellId, plan.next)
        : setCellStyle(current, plan.pageIndex, plan.cellId, plan.next);
    current = parseDrawio(text);
  }
  return { text, counts, manual };
}
