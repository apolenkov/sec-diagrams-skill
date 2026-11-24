/** Check the sheet title and font families against the profile. */
import { styleValue } from '../drawio.ts';
import {
  NO_MANIFEST_KEY,
  NO_MANIFEST_REASON,
  type Finding,
  type PageModel,
  finding,
  notCheckedFinding,
} from './model.ts';
import { cleanFont, firstFamily, labelFonts } from '../label.ts';

function checkTitle(model: PageModel): Finding[] {
  // Without manifest.json the expected prefix is unknown, so even a correct title cannot pass:
  // NOT_CHECKED, and every other rule on the page keeps running as usual.
  if (!model.hasManifest) return [notCheckedFinding('SD-H01', model, NO_MANIFEST_KEY, NO_MANIFEST_REASON)];
  const marked = model.vertices.find((cell) => styleValue(cell.style, 'sdRole') === 'title');
  const cell = marked ?? model.title;
  if (cell === undefined) return [finding('SD-H01', model, ['-'], 1)];
  // Read the title as one line: a title wrapped after the prefix is still the same title.
  const text = cell.text
    .split(/\s+/u)
    .filter((part) => part !== '')
    .join(' ');
  const tail = text.startsWith(model.titlePrefix) ? text.slice(model.titlePrefix.length) : undefined;
  if (tail !== undefined && titleTailPattern(model).test(tail)) return [];
  return [finding('SD-H01', model, [cell.id])];
}

function titleTailPattern(model: PageModel): RegExp {
  return new RegExp('^(?:' + model.profile.titleTail + ')$', 'u');
}

const styleFont = (style: string): string | undefined => {
  const family = styleValue(style, 'fontFamily');
  return family === undefined || family === '' ? undefined : cleanFont(family);
};

/**
 * A label needs an allowed font from the style or from its own markup. No font anywhere means
 * the draw.io default (Helvetica), which is not on the list.
 */
function checkFonts(model: PageModel): Finding[] {
  const allowed = new Set(model.profile.fonts.map(cleanFont));
  const ids = model.labels
    .filter((cell) => {
      const markup = labelFonts(cell.raw)
        .map(firstFamily)
        .filter((font) => font !== '');
      const fromStyle = styleFont(cell.style);
      if (markup.some((font) => !allowed.has(font))) return true;
      if (markup.length > 0) return fromStyle !== undefined && !allowed.has(fromStyle);
      return fromStyle === undefined || !allowed.has(fromStyle);
    })
    .map((cell) => cell.id);
  return ids.length === 0 ? [] : [finding('SD-F01', model, ids)];
}

/** Title and font rules for one page. */
export function checkSheet(model: PageModel): Finding[] {
  return [...checkTitle(model), ...checkFonts(model)];
}
