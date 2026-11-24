/**
 * Read normalized text from a draw.io label.
 *
 * A draw.io label is HTML: tags are dropped, `<br>` and block tags become line breaks, hidden
 * runs (`display:none`, `visibility:hidden`, `hidden`, `<script>`, `<style>`) are skipped, and
 * character references inside a text run are decoded. The XML layer of the value is already
 * decoded by the core reader, so what this module sees is the HTML layer: a label whose stored
 * text is `&amp;lt;br&amp;gt;` after XML loses its markers and keeps visible text. Nothing here
 * reports anything: the functions only turn a stored value into plain text.
 */

const BLOCK_TAGS = new Set(['br', 'div', 'p', 'li', 'tr', 'table', 'ul', 'ol', 'h1', 'h2', 'h3']);
const CELL_TAGS = new Set(['td', 'th']);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr']);
const INVISIBLE_TAGS = new Set(['script', 'style']);

const TAG_PATTERN = /<(\/?)([A-Za-z][^>\s/]*)([^>]*?)(\/?)>/gy;
const NUMERIC_ENTITY = /&#(\d{1,7}|[xX][0-9a-fA-F]{1,6});/gu;
const NAMED_ENTITY = /&([A-Za-z][A-Za-z0-9]*);/gu;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '\u00a9',
  hellip: '\u2026',
  laquo: '\u00ab',
  raquo: '\u00bb',
  mdash: '\u2014',
  ndash: '\u2013',
  middot: '\u00b7',
  bull: '\u2022',
  times: '\u00d7',
};

const codePoint = (reference: string, whole: string): string => {
  const value = /^[xX]/u.test(reference) ? Number.parseInt(reference.slice(1), 16) : Number.parseInt(reference, 10);
  return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;
};

/** Decodes the character references of one text run; an unknown named reference is kept as such. */
export function decodeEntities(text: string): string {
  return text
    .replaceAll(NUMERIC_ENTITY, (whole: string, reference: string): string => codePoint(reference, whole))
    .replaceAll(NAMED_ENTITY, (whole: string, name: string): string => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

/** Collapses every run of white space to one space, like " ".join(text.split()) after NFC. */
export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .split(/\s+/u)
    .filter((part) => part !== '')
    .join(' ');
}

interface Frame {
  name: string;
  hidden: boolean;
}

const hiddenAbove = (stack: Frame[]): boolean => stack.some((frame) => frame.hidden);

const isHiddenStyle = (attributes: string): boolean =>
  /display\s*:\s*none|visibility\s*:\s*hidden/iu.test(attributes) || /(?:^|\s)hidden(?:\s|=|\/|$)/iu.test(attributes);

function closeFrame(stack: Frame[], name: string): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]?.name === name) {
      stack.length = index;
      return;
    }
  }
}

function emitOpen(parts: string[], name: string, stack: Frame[]): void {
  if (hiddenAbove(stack)) return;
  if (BLOCK_TAGS.has(name)) parts.push('\n');
  else if (CELL_TAGS.has(name)) parts.push(' ');
}

/** Plain text of a label: tags removed, block boundaries turned into line breaks. */
export function labelPlainText(value: string): string {
  const parts: string[] = [];
  const stack: Frame[] = [];
  let index = 0;
  while (index < value.length) {
    const next = value.indexOf('<', index);
    const run = next < 0 ? value.slice(index) : value.slice(index, next);
    if (run !== '' && !hiddenAbove(stack)) parts.push(decodeEntities(run));
    if (next < 0) break;
    TAG_PATTERN.lastIndex = next;
    const match = TAG_PATTERN.exec(value);
    if (match === null) {
      parts.push('<');
      index = next + 1;
      continue;
    }
    index = TAG_PATTERN.lastIndex;
    const [whole, slash, rawName = '', attributes = ''] = match;
    const name = rawName.toLowerCase();
    if (slash === '/') {
      if (!hiddenAbove(stack) && BLOCK_TAGS.has(name)) parts.push('\n');
      closeFrame(stack, name);
      continue;
    }
    emitOpen(parts, name, stack);
    if (whole.endsWith('/>') || VOID_TAGS.has(name)) continue;
    stack.push({ name, hidden: INVISIBLE_TAGS.has(name) || isHiddenStyle(attributes) || hiddenAbove(stack) });
  }
  return parts.join('');
}

/** Normalized text of a stored label: one normalized line per source line. */
export function labelText(value: string): string {
  return labelPlainText(value)
    .split('\n')
    .map(normalize)
    .filter((line) => line !== '')
    .join('\n');
}

const FONT_FACE_PATTERN = /<font\b[^>]*\bface\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;
const CSS_FAMILY_PATTERN = /font-family\s*:\s*((?:"[^"]*"|'[^']*'|[^;"'<>])+)/giu;
const CSS_SHORTHAND_PATTERN = /(?:^|[;"'])\s*font\s*:\s*([^;"'<>]+)/giu;
const UNSUPPORTED_SHORTHAND = '[unsupported font shorthand]';

/**
 * Fonts the label itself asks for: a font face attribute, font-family, and the font shorthand.
 * A style attribute stored in a label keeps its quotes as character references - a browser
 * writes `font-family: &quot;Times New Roman&quot;` when the text comes from a rich-text editor -
 * so the references are decoded before the scan and a quoted family name is taken whole.
 */
export function labelFonts(value: string): string[] {
  const markup = decodeEntities(value);
  const families: string[] = [];
  for (const match of markup.matchAll(FONT_FACE_PATTERN)) families.push(match[1] ?? match[2] ?? '');
  for (const match of markup.matchAll(CSS_FAMILY_PATTERN)) families.push(match[1] ?? '');
  for (const match of markup.matchAll(CSS_SHORTHAND_PATTERN)) {
    const declaration = match[1] ?? '';
    const sized = /(?:\d*\.)?\d+(?:px|pt|em|rem|%)\s+(.+)$/u.exec(declaration);
    families.push(sized?.[1] ?? UNSUPPORTED_SHORTHAND);
  }
  return families;
}

/** The compared form of a font name: no "!important", no quotes, lower case. */
export function cleanFont(family: string): string {
  return family
    .replace(/\s*!important\s*$/iu, '')
    .trim()
    .replace(/^["']+|["']+$/gu, '')
    .toLowerCase();
}

/**
 * The family the page really renders: the first of a `font-family` stack, where the rest are
 * fallbacks a browser shows only when the first is missing. `Arial, sans-serif` asks for Arial.
 */
export function firstFamily(family: string): string {
  return cleanFont(family.split(',')[0] ?? '');
}
