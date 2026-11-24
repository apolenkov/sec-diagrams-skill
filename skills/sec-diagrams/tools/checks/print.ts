/**
 * Print checks for the sheet itself, before any PDF exists. The gate in pdf.ts measures the
 * exported file; these two rules read what the source sheet already decides about that export:
 *
 * - SD-P01: every cell whose font prints below 8 pt. A page prints fitted onto landscape A3
 *   inside the margins of the pdf step, and the fit shrinks the whole drawing by the smaller of
 *   the width and the height fit (fitScale of pdf-fit.ts, the function the paper itself uses)
 *   over the larger of the page and the drawing: content sticking out past the page edge takes
 *   paper too. Only glyphs a reader sees count: an empty span prints nothing. A
 *   fontSize under 8/scale pt is unreadable on paper, and the finding carries the cell ids the
 *   pdf FAIL asks for. The default a cell renders at without its own size is 12 - except an
 *   edge label, which draw.io draws at 11.
 * - SD-P02: the mxGraphModel page is not the landscape A3 recommended by the author:
 *   `pageWidth="1654" pageHeight="1169"`. A different size letterboxes or tiles the export.
 *
 * A page without declared size is left to the print gate: every real draw.io sheet writes
 * pageWidth/pageHeight, and there is nothing here to measure the scale against. The size is the
 * one of the page being judged, from its own parsed model tag: a file of several pages answers
 * page by page.
 */
import { authorAdvice } from './finding.ts';
import { styleValue, type DrawioPage } from '../drawio.ts';
import { decodeEntities } from '../label.ts';
import { fitScale } from '../pdf-fit.ts';
import { finding, type Finding, type PageModel } from './model.ts';

/** The page size every sheet of the package carries - the templates and the rules page alike. */
export const A3_SHEET = { width: 1654, height: 1169 } as const;
/** The smallest font the reviewer reads on paper. */
const MIN_PRINT_PT = 8;
/** What draw.io renders for a cell whose style names no fontSize: 12, and 11 on an edge label. */
const DEFAULT_FONT_SIZE = 12;
/** Measured PDF export before fitting: paper points per draw.io unit or inline CSS pixel. */
const EXPORT_PT_PER_UNIT = 0.72;
const DEFAULT_EDGE_LABEL_SIZE = 11;
/** An inline size may carry CSS units: 10px is 7.5 pt, 10pt stays 10. */
const INLINE_FONT_SIZE = /<([a-z][\w-]*)\b[^>]*?font-size:\s*(\d+(?:\.\d+)?)(pt|px)?[^>]*>([\s\S]*?)<\/\1\s*>/giu;
const ANY_TAG = /<[^>]*>/gu;
/** Markup nobody sees prints nothing: a hidden element carries no size worth guarding. */
const HIDDEN_MARKUP = /<[^>]*display\s*:\s*none[^>]*>[\s\S]*?(?:<\/[^>]+>|\/>)/giu;

/**
 * The smallest size the cell can render at: the style's own fontSize, and - in an html cell -
 * any inline size the visible markup asks for, pt and px alike. The print gate measures the
 * real glyphs; this is the static upper bound of the same question, so a smaller decides.
 */
function smallestPrintedFont(raw: string, style: string, onEdge: boolean, scale: number): number {
  const styled = Number(styleValue(style, 'fontSize'));
  const sizes = [(styled || (onEdge ? DEFAULT_EDGE_LABEL_SIZE : DEFAULT_FONT_SIZE)) * scale];
  if (styleValue(style, 'html') === '1') {
    const visible = decodeEntities(raw).replace(HIDDEN_MARKUP, ' ');
    for (const match of visible.matchAll(INLINE_FONT_SIZE)) {
      // An element with no glyph inside prints nothing: its size decides nothing.
      if ((match[4] ?? '').replace(ANY_TAG, '').trim() === '') continue;
      const size = Number.parseFloat(match[2] ?? '');
      // A CSS pixel and a draw.io layout unit shrink together. Convert to paper
      // points only once, including the fitter's cap on enlargement.
      const pixels = match[3] === 'pt' ? size / 0.75 : size;
      if (size > 0) sizes.push(pixels * scale);
    }
  }
  return Math.min(...sizes);
}

/** The size the page being judged declares; 0 when it does not say. Exported for style set. */
export function declaredSize(page: DrawioPage): { width: number; height: number } {
  return { width: page.width, height: page.height };
}

/** The far corner the drawing itself reaches: a box past the page scales the fit down too. */
function drawingExtent(model: PageModel): { width: number; height: number } {
  let right = 0;
  let bottom = 0;
  for (const cell of model.allCells) {
    right = Math.max(right, cell.box?.x2 ?? 0);
    bottom = Math.max(bottom, cell.box?.y2 ?? 0);
  }
  for (const line of model.polylines.values())
    for (const point of line) {
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
  return { width: right, height: bottom };
}

/** The print scale of a page and its drawing: the fit of the pdf step, by width and height. */
export function printScale(page: { width: number; height: number }, model?: PageModel): number {
  const extent = model === undefined ? { width: 0, height: 0 } : drawingExtent(model);
  return Math.min(EXPORT_PT_PER_UNIT, fitScale(Math.max(page.width, extent.width), Math.max(page.height, extent.height)));
}

export function checkPrint(model: PageModel, page: DrawioPage): Finding[] {
  const { width, height } = declaredSize(page);
  const findings: Finding[] = [];
  const declared = width !== 0 || height !== 0;
  if (declared && (width !== A3_SHEET.width || height !== A3_SHEET.height)) {
    findings.push(authorAdvice(finding('SD-P02', model, [], 1)));
  }
  if (width <= 0) return findings;
  const scale = printScale({ width, height: Math.max(height, 1) }, model);
  const small = model.labels.filter((cell) => smallestPrintedFont(cell.raw, cell.style, cell.onEdge, scale) < MIN_PRINT_PT);
  if (small.length > 0)
    findings.push(
      finding(
        'SD-P01',
        model,
        small.map((cell) => cell.id),
      ),
    );
  return findings;
}

/** The smallest style set may write: the page's own floor of 8 pt on the fitted A3 print. */
export const minFontSizeFor = (page: { width: number; height: number }): number =>
  Math.ceil(MIN_PRINT_PT / printScale(page));
