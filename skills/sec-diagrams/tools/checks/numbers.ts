/** Check connection numbers against the connections and the numbered list. */
import { styleValue } from '../drawio.ts';
import { normalize } from '../label.ts';
import {
  LEGEND_NOT_FOUND_KEY,
  LEGEND_NOT_FOUND_REASON,
  NUMBER_TOLERANCE,
  type Finding,
  type NumberBadge,
  type PageLabel,
  type PageModel,
  finding,
  notCheckedFinding,
} from './model.ts';
import { boxCentre, headAt, orthogonallyRerouted, polylineDistance, type Point } from './geometry.ts';
import { hasLinesOutsideLegend } from './lines.ts';

const CODE = 'SD-N01';

const badgeOf = (model: PageModel, cell: PageLabel): NumberBadge | undefined =>
  model.badges.find((badge) => badge.cellId === cell.id);

const connectionOf = (model: PageModel, id: string): PageLabel | undefined =>
  model.connections.find((edge) => edge.id === id);

const validBadges = (model: PageModel): NumberBadge[] => model.badges.filter((badge) => badge.valid);

/** a digit vertex whose style is not the number style. */
function badStyles(model: PageModel): string[] {
  return model.badges.filter((badge) => !badge.valid).map((badge) => badge.cellId);
}

/** a number no polyline of the sheet passes by. */
function unboundNumbers(model: PageModel): string[] {
  return model.badges.filter((badge) => badge.edges.length === 0).map((badge) => badge.cellId);
}

/** Read the arrow style at a single end. */
const styleTuple = (edge: PageLabel): string =>
  [
    (styleValue(edge.style, 'strokeColor') ?? '#000000').toLowerCase(),
    styleValue(edge.style, 'strokeWidth') ?? '1',
    styleValue(edge.style, 'startArrow') ?? '',
    styleValue(edge.style, 'endArrow') ?? '',
  ].join('|');

/** Shared distance along the routes, including a branch partway along a straight segment. */
function commonPrefix(lines: Point[][]): Point[] {
  const first = lines[0]?.[0];
  if (!first || !lines.every(line => line[0]?.x === first.x && line[0]?.y === first.y)) return [];
  const prefix = [first];
  const next = lines.map(() => 1);
  let start = first;
  // Fractional entry anchors in XML can differ by a few thousandths of a drawing unit.
  const epsilon = 0.01;
  while (true) {
    const ends: Point[] = [];
    for (const [i, line] of lines.entries()) {
      let index = next[i] as number;
      let point = line[index];
      while (point && Math.hypot(point.x - start.x, point.y - start.y) < epsilon) point = line[++index];
      next[i] = index;
      if (!point) return prefix;
      ends.push(point);
    }
    const distance = (point: Point): number => Math.hypot(point.x - start.x, point.y - start.y);
    const nearest = ends.reduce((a, b) => distance(a) <= distance(b) ? a : b);
    if (!ends.every(end => polylineDistance(nearest, [start, end]) < epsilon)) return prefix;
    prefix.push(nearest);
    start = nearest;
  }
}

/** two arrows from one source along one trunk, both targets named. */
function sharedBranch(model: PageModel, badge: NumberBadge): boolean {
  const edges = badge.edges.map((id) => connectionOf(model, id));
  if (edges.some((edge) => edge === undefined) || edges.length < 2) return false;
  const lines = edges as PageLabel[];
  const source = (lines[0] as PageLabel).source;
  if (source === '' || lines.some((edge) => edge.source !== source)) return false;
  if (new Set(lines.map((edge) => edge.target)).size !== lines.length) return false;
  const byId = new Map(model.allCells.map((cell) => [cell.id, cell]));
  const targets = lines.map((edge) => byId.get(edge.target));
  if (targets.some((cell) => cell === undefined || cell.text === '')) return false;
  if (new Set(lines.map(styleTuple)).size !== 1) return false;
  const polylines = lines.map((edge) => model.polylines.get(edge.id));
  if (polylines.some((line) => line === undefined)) return false;
  const prefix = commonPrefix(polylines as Point[][]);
  const badgeCell = byId.get(badge.cellId);
  if (prefix.length < 2 || badgeCell === undefined || badgeCell.box === null) return false;
  if (polylineDistance(boxCentre(badgeCell.box), prefix) > NUMBER_TOLERANCE) return false;
  const description = itemDescription(model, badge.value);
  const names = (targets as PageLabel[]).map((cell) => normalize(cell.text.split('\n')[0] ?? '').toLowerCase());
  if (names.some((name) => name === '')) return false;
  return names.every((name) => namedIn(description, name, names)) || enumerated(description, names);
}

const WORD_START = '(?<![\\p{L}\\p{N}_])';
const WORD_END = '(?![\\p{L}\\p{N}_])';
const LIST_LINE = /^(\d{1,2})\. /u;
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** the whole item, continuation lines included, normalized and lowercased. */
function itemDescription(model: PageModel, value: number): string {
  const item = model.listItems.find((entry) => entry.value === value);
  const cell = model.allCells.find((entry) => entry.id === item?.cellId);
  if (item === undefined || cell === undefined) return '';
  const chunks: string[] = [];
  let current: number | null = null;
  for (const line of cell.text.split('\n')) {
    const match = LIST_LINE.exec(normalize(line));
    if (match !== null) current = Number(match[1]);
    if (current === value) chunks.push(normalize(line));
  }
  return normalize(chunks.join('\n').replace(/\)\n(?=[A-Za-z]+ \()/gu, '); ')).toLowerCase();
}

/** the line names the target, or a «слова product» target without its product. */
function namedIn(description: string, name: string, names: string[]): boolean {
  if (description.includes(name)) return true;
  const words = name.split(' ');
  const lead = words.slice(0, -1);
  if (words.length < 3 || !/^[a-z][a-z0-9]*$/u.test(words.at(-1) ?? '')) return false;
  if (!lead.every((word) => /^[а-я]+$/u.test(word))) return false;
  const stems = lead.map((word) => (word.length > 4 ? escapeRegExp(word.slice(0, -1)) + '[а-я]*' : escapeRegExp(word)));
  const found = new RegExp(WORD_START + stems.join('\\s+') + WORD_END, 'u').test(description);
  const prefix = lead.join(' ');
  return found && names.filter((other) => other.startsWith(prefix)).length === 1;
}

/** Compact enumeration: targets «вм 1» and «вм 2» named as «вм 1 или 2». */
function enumerated(description: string, names: string[]): boolean {
  const parts = names.map((name) => /^(.+?) (\d+)$/u.exec(name));
  if (parts.some((part) => part === null)) return false;
  const matches = parts as RegExpExecArray[];
  const base = matches[0]?.[1] ?? '';
  if (matches.some((match) => match[1] !== base)) return false;
  const words = base.split(' ');
  const stemmed = words.every((word) =>
    new RegExp(WORD_START + escapeRegExp(word.length > 4 ? word.slice(0, -2) : word), 'u').test(description),
  );
  if (!stemmed) return false;
  const numbers = matches.map((match) => escapeRegExp(match[2] ?? ''));
  const list = numbers.join('\\s*(?:,|и|или)\\s*');
  return new RegExp(WORD_START + escapeRegExp(words[0] ?? '') + '\\s+' + list + WORD_END, 'u').test(description);
}

/** a number the polyline of several connections passes by. */
function ambiguousNumbers(model: PageModel): string[] {
  return model.badges
    .filter((badge) => badge.edges.length > 1 && !sharedBranch(model, badge))
    .map((badge) => badge.cellId);
}

/**
 * The two one-way arrows of one two-way exchange carry one number and
 * one list item. A pair counts when each number stands on exactly one arrow, both arrows run
 * between the same two blocks, and their heads point at different blocks.
 */
function reverseTwinValues(model: PageModel): Set<number> {
  const byValue = new Map<number, NumberBadge[]>();
  for (const badge of validBadges(model)) byValue.set(badge.value, [...(byValue.get(badge.value) ?? []), badge]);
  const twins = new Set<number>();
  for (const [value, badges] of byValue) {
    if (badges.length !== 2 || badges.some((badge) => badge.edges.length !== 1)) continue;
    const a = connectionOf(model, (badges[0] as NumberBadge).edges[0] as string);
    const b = connectionOf(model, (badges[1] as NumberBadge).edges[0] as string);
    if (a === undefined || b === undefined || a.id === b.id) continue;
    if (a.source === '' || a.target === '' || a.source === a.target) continue;
    if (!(a.source === b.source || a.source === b.target) || !(a.target === b.source || a.target === b.target))
      continue;
    const headA = headAt(a.style, a.source, a.target);
    const headB = headAt(b.style, b.source, b.target);
    if (headA !== null && headB !== null && headA !== headB) twins.add(value);
  }
  return twins;
}

/** Every connection carries exactly one number; the ids name the line and its numbers. */
function numberPerEdge(model: PageModel): string[] {
  const cellsByEdge = new Map<string, string[]>();
  for (const badge of model.badges) {
    for (const edgeId of badge.edges) cellsByEdge.set(edgeId, [...(cellsByEdge.get(edgeId) ?? []), badge.cellId]);
  }
  const ids: string[] = [];
  for (const edge of model.connections) {
    const cells = cellsByEdge.get(edge.id) ?? [];
    if (cells.length === 1) continue;
    ids.push(edge.id, ...cells);
  }
  return ids;
}

/** two lines drawn with the same number, except the reverse twins. */
function duplicateNumbers(model: PageModel, routeBlind = false): string[] {
  const twins = reverseTwinValues(model);
  const byValue = new Map<number, string[]>();
  for (const badge of validBadges(model)) {
    // with an orthogonal route unreadable, a plate no chord passes by may still be
    // the number of that very line where draw.io will bend it - its twin is then not a second
    // number but the same question of position, and the position goes to NOT_CHECKED.
    if (routeBlind && badge.edges.length === 0) continue;
    byValue.set(badge.value, [...(byValue.get(badge.value) ?? []), badge.cellId]);
  }
  return [...byValue.entries()]
    .filter(([value, cells]) => cells.length > 1 && !twins.has(value))
    .map(([, cells]) => cells)
    .flat();
}

/**
 * Every number from 1 to the largest one that neither stands on the sheet nor the manifest
 * calls retired is a hole - 0 is not a number anyone retired, so a sheet starting at 3 misses
 * 1 and 2 even when 2 is retired (a neighbour-only walk let 3, 4, 5 pass
 * with 2 retired, and the missing 1 stayed silent). The first badge above each hole answers
 * for it: that is the number whose predecessor the reader looks for and does not find.
 */
function gapNumbers(model: PageModel): string[] {
  const used = [...new Set(model.badges.map((badge) => badge.value))].sort((a, b) => a - b);
  if (used.length === 0) return [];
  const largest = used[used.length - 1] ?? 0;
  const denyNumbers = new Set(model.denyBadges.map(badge => badge.value));
  const ids = new Set<string>();
  for (let hole = 1; hole <= largest; hole += 1) {
    if (used.includes(hole) || model.retired.has(hole) || denyNumbers.has(hole)) continue;
    const above = used.find((value) => value > hole) ?? 0;
    const cellId = model.badges.find((badge) => badge.value === above)?.cellId;
    if (cellId !== undefined) ids.add(cellId);
  }
  return [...ids];
}

/** A number the manifest says is retired, given back to a live line. */
function reusedRetired(model: PageModel): string[] {
  return model.labels
    .filter((cell) => {
      const badge = badgeOf(model, cell);
      return badge !== undefined && model.retired.has(badge.value);
    })
    .map((cell) => cell.id);
}

/** A line whose number has no matching item in the connection list. */
function missingListLines(model: PageModel): string[] {
  const lines = new Set(model.listItems.map((item) => item.value));
  return validBadges(model)
    .filter((badge) => !lines.has(badge.value))
    .map((badge) => badge.cellId);
}

/** An item of the connection list no line carries, or two items with the same number. */
function listProblems(model: PageModel): string[] {
  const numbers = new Set([...model.badges, ...model.denyBadges].map(badge => badge.value));
  const missing = model.listItems.filter((item) => !numbers.has(item.value)).map((item) => item.cellId);
  const byValue = new Map<number, string[]>();
  for (const item of model.listItems) byValue.set(item.value, [...(byValue.get(item.value) ?? []), item.cellId]);
  const duplicates = [...byValue.values()].filter((cells) => cells.length > 1).flat();
  return [...missing, ...duplicates];
}

/** One finding per page: numbering or list does not match the lines.
 *
 * Without a legend - the skill's mark or a frame the search can read - the rule does not run:
 * the legend is what tells the samples of the notation from the lines of the sheet, and every
 * line would read as unnumbered or wrongly coloured. The page gets NOT_CHECKED with the
 * legend-not-found reason and a person reads the numbers. */
export function checkNumbers(model: PageModel): Finding[] {
  // A rules sheet numbers nothing: "443" is a port, not a connection number, and there are no
  // lines to bind it to - the lines under the "sdRole=rules" mark left the model already. The same
  // holds for any page without one line outside the legend: a digit in a table of such a page
  // binds to nothing, so the rule keeps silent instead of asking for a legend.
  if (!hasLinesOutsideLegend(model)) return [];
  // an orthogonal line without kink points is bent by draw.io around a
  // right angle the sheet does not hold - the checker sees the chord. Where a number stands
  // on such a line cannot be read here - only the position of the numbers excuses itself;
  // duplicates, gaps and the list hold no matter what the route does.
  const rerouted = model.connections.filter((edge) => orthogonallyRerouted(edge.style, model.polylines.get(edge.id)));
  if (model.legend === 'none') return [notCheckedFinding(CODE, model, LEGEND_NOT_FOUND_KEY, LEGEND_NOT_FOUND_REASON)];
  const allGroups: Array<[string, string[]]> = [
    ['n01-line-without-number', numberPerEdge(model)],
    ['n01-duplicate', duplicateNumbers(model, rerouted.length > 0)],
    ['n01-badge-style', badStyles(model)],
    ['n01-number-off-line', unboundNumbers(model)],
    ['n01-number-on-two-lines', ambiguousNumbers(model)],
    ['n01-gap', gapNumbers(model)],
    ['n01-retired-taken', reusedRetired(model)],
    ['n01-no-list-line', missingListLines(model)],
    ['n01-list-line-without-line', listProblems(model)],
  ];
  const routeBlind = new Set(['n01-line-without-number', 'n01-number-off-line', 'n01-number-on-two-lines']);
  const groups = rerouted.length > 0 ? allGroups.filter(([key]) => !routeBlind.has(key)) : allGroups;
  const blind =
    rerouted.length > 0
      ? [
          notCheckedFinding(
            CODE,
            model,
            'n01-orthogonal-route',
            'ортогональная линия без точек излома: маршрут рисует draw.io, привязку номеров не проверить',
            rerouted.map((edge) => edge.id),
          ),
        ]
      : [];
  // One finding per reason: the console line names the reason statically, and only the gap
  // finding carries the no-renumbering advice (references/resend.md).
  return [
    ...blind,
    ...groups
      .filter(([, ids]) => ids.length > 0)
      .map(([reasonKey, ids]) => reasonKey === 'n01-gap' && model.legacySubmission
        ? notCheckedFinding(CODE, model, 'n01-retirement-unknown', 'сверь пропуски с номерами, снятыми после прошлой отправки', ids)
        : { ...finding(CODE, model, ids), reasonKey }),
  ];
}
