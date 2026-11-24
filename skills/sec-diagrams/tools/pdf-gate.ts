/**
 * Read-only PDF geometry gate on MuPDF.js.
 * Output is numeric only: never extracted text, names, coordinates or paths.
 */
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Matrix, MupdfModule, Page, PDFDocument, PDFPage, Rect, Text } from './mupdf-api.ts';
import { shellQuote } from './shell.ts';

export const PT_PER_MM = 72 / 25.4;
export const PRINTABLE_AREA_MM2 = 400 * 277;
export const SIZE_TOLERANCE_MM = 0.2;
export const GEOMETRY_EPS_PT = 0.01;
export const FONT_EPS_PT = 0.00001;
export const TEXT_MARGIN_PT = 10 * PT_PER_MM;
export const MIN_FONT_PT = 8;
export const MAX_TEXT_FRACTION = 0.5;
export const A3_SHORT_MM = 297;
export const A3_LONG_MM = 420;

const FRACTION_EPS = 1e-12;

const PDF_ENGINE = 'mupdf';
const configuredHome = (): string | undefined =>
  process.env.SEC_DIAGRAMS_HOME ? resolve(process.env.SEC_DIAGRAMS_HOME) : undefined;

export function mupdfInstallHint(): string {
  const home = configuredHome();
  const prefix = home === undefined ? '~/.sec-diagrams' : shellQuote(home);
  return 'Установи PDF-движок отдельно (AGPL-3.0-or-later). Команда: npm install --prefix ' + prefix + ' mupdf@1.28.6';
}

let backend: MupdfModule | undefined;
let backendHome: string | undefined;
let quietWanted = false;

function hasPdfApi(module: unknown): module is MupdfModule {
  if (typeof module !== 'object' || module === null) return false;
  const api = module as Partial<MupdfModule>;
  return [api.setLog, api.Document?.openDocument, api.Matrix?.concat, api.Device, api.PDFDocument, api.Buffer,
      api.DocumentWriter, api.Font, api.Pixmap, api.Image].every(member => typeof member === 'function') &&
    Array.isArray(api.Matrix?.identity) && api.ColorSpace?.DeviceRGB !== undefined;
}

async function importFromHome(home: string): Promise<unknown> {
  const root = join(realpathSync(home), 'node_modules');
  // MuPDF.js publishes this entry in its package exports. An absolute import avoids Node's
  // ancestor and global lookup for a user-selected prefix.
  const entry = realpathSync(join(root, PDF_ENGINE, 'dist', 'mupdf.js'));
  const inside = relative(root, entry);
  if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) return undefined;
  return import(pathToFileURL(entry).href);
}

/** Return false when the optional engine cannot load from the selected installation. */
export async function loadMupdf(): Promise<boolean> {
  if (process.env.SEC_DIAGRAMS_NO_MUPDF === '1') return false;
  const home = configuredHome();
  if (backend !== undefined && backendHome === home) return true;
  backend = undefined;
  let candidate: unknown;
  if (home === undefined) {
    try {
      candidate = await import(PDF_ENGINE);
    } catch {
      // Try the default user installation below.
    }
  }
  if (!hasPdfApi(candidate)) {
    try {
      candidate = await importFromHome(home ?? join(homedir(), '.sec-diagrams'));
    } catch {
      return false;
    }
  }
  if (!hasPdfApi(candidate)) return false;
  try {
    if (quietWanted) candidate.setLog({});
  } catch {
    return false;
  }
  backend = candidate;
  backendHome = home;
  return true;
}

export const mupdfLoaded = (): boolean => backend !== undefined && process.env.SEC_DIAGRAMS_NO_MUPDF !== '1' &&
  backendHome === configuredHome();

export function mupdfEngine(): MupdfModule {
  if (backend === undefined) throw new Error('mupdf is not loaded: await loadMupdf() first');
  return backend;
}

export type GateStatus = 'PASS' | 'FAIL' | 'UNVERIFIED';
export type Rectangle = readonly [number, number, number, number];

export interface PageMetrics {
  width_mm: number;
  height_mm: number;
  media_width_mm: number;
  media_height_mm: number;
  printable_area_mm2: number;
  line_count: number;
  raw_span_count: number;
  rendered_span_count: number;
  hidden_span_count: number;
  image_count: number;
  outside_margin_line_count: number;
  minimum_font_pt: number | null;
  below_8pt_span_count: number;
  line_rectangle_union_mm2: number;
  text_area_fraction: number;
}

export interface PageReport {
  page: number;
  status: GateStatus;
  metrics: PageMetrics | Record<string, never>;
  errors: number[];
  warnings: number[];
}

export interface GateReport {
  status: GateStatus;
  errors: number[];
  pages: PageReport[];
}

/** Narrowing helper: a page that could not be measured carries no metrics. */
export function isPageMetrics(value: PageMetrics | Record<string, never>): value is PageMetrics {
  return 'minimum_font_pt' in value;
}

/**
 * Read-only PDF view of the bytes, or null when the engine will not read them as PDF.
 * Shared with the fitter so both open documents the same way.
 */
export function openPdfDocument(bytes: Uint8Array): PDFDocument | null {
  const mupdf = mupdfEngine();
  const document = mupdf.Document.openDocument(bytes, 'application/pdf');
  return document.isPDF() ? document.asPDF() : null;
}

/**
 * The MuPDF.js equivalent of `pymupdf.TOOLS.mupdf_display_errors(False)` plus
 * `mupdf_display_warnings(False)`: engine diagnostics go to an empty sink instead of
 * stderr. It is process-global, so a CLI calls it once at start-up; `checkPdf` itself
 * never changes engine state.
 */
export function silenceBackendDiagnostics(): void {
  quietWanted = true;
  if (backend !== undefined) backend.setLog({});
}

type SweepEvent = readonly [number, number, number, number, number];
type Interval = readonly [number, number];

function compareEvents(a: SweepEvent, b: SweepEvent): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4];
}

function coveredHeight(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const first = sorted[0];
  if (first === undefined) return 0;
  let lo = first[0];
  let hi = first[1];
  let height = 0;
  for (const [start, end] of sorted) {
    if (start > hi) {
      height += hi - lo;
      lo = start;
      hi = end;
    } else if (end > hi) {
      hi = end;
    }
  }
  return height + hi - lo;
}

/** Exact x sweep with merged y intervals; overlapping boxes count once. */
export function unionArea(rectangles: readonly Rectangle[]): number {
  const events: SweepEvent[] = [];
  rectangles.forEach((rect, index) => {
    const [x0, y0, x1, y1] = rect;
    if (![x0, y0, x1, y1].every(Number.isFinite)) throw new RangeError('nonfinite rectangle');
    if (x1 < x0 || y1 < y0) throw new RangeError('inverted rectangle');
    if (x0 < x1 && y0 < y1) {
      events.push([x0, 1, index, y0, y1], [x1, -1, index, y0, y1]);
    }
  });
  events.sort(compareEvents);
  const active = new Map<number, Interval>();
  let area = 0;
  let previousX: number | null = null;
  for (const [x, kind, index, y0, y1] of events) {
    if (previousX !== null && active.size > 0) {
      area += (x - previousX) * coveredHeight([...active.values()]);
    }
    if (kind === 1) active.set(index, [y0, y1]);
    else active.delete(index);
    previousX = x;
  }
  return area;
}

export function isA3(widthMm: number, heightMm: number): boolean {
  const short = Math.min(widthMm, heightMm);
  const long = Math.max(widthMm, heightMm);
  return Math.abs(short - A3_SHORT_MM) <= SIZE_TOLERANCE_MM && Math.abs(long - A3_LONG_MM) <= SIZE_TOLERANCE_MM;
}

/**
 * The author recommends landscape A3 (SD-P02).
 * The unrotated MediaBox may still be portrait when /Rotate turns it landscape on paper.
 */
export function isA3Landscape(widthMm: number, heightMm: number): boolean {
  return Math.abs(widthMm - A3_LONG_MM) <= SIZE_TOLERANCE_MM && Math.abs(heightMm - A3_SHORT_MM) <= SIZE_TOLERANCE_MM;
}

/**
 * A measured кегль violation stays FAIL even when the same page hides raster or
 * hidden text: a raster cannot launder a 7 pt cell. Missing evidence still outranks
 * the other geometry codes - a cropped page is UNVERIFIED in the Python gate, and stays so.
 */
function statusOf(codes: readonly number[]): GateStatus {
  if (codes.includes(3)) return 'FAIL';
  if (codes.some((code) => code >= 100)) return 'UNVERIFIED';
  return codes.length > 0 ? 'FAIL' : 'PASS';
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * One size per change of the glyph transform, plus the character count. The fitter writes the
 * whole page in one BT...ET, so a single text object carries spans of mixed sizes: measuring
 * only the first glyph would let the size of the first span hide every smaller one behind it.
 */
function spanSizes(ctm: Matrix, text: Text): { sizes: number[]; chars: number } {
  const mupdf = mupdfEngine();
  const sizes: number[] = [];
  let chars = 0;
  let previous: number | null = null;
  text.walk({
    showGlyph: (_font, trm) => {
      chars += 1;
      const joined = mupdf.Matrix.concat(ctm, trm);
      const size = Math.hypot(joined[2], joined[3]);
      if (previous === null || Math.abs(size - previous) > FONT_EPS_PT) sizes.push(size);
      previous = size;
    },
  });
  return { sizes, chars };
}

interface TraceEvidence {
  sizes: number[];
  hidden: number;
  layered: boolean;
  images: number;
}

/** Text-trace equivalent of `Page.get_texttrace()`: visible vs hidden spans, layers, rasters. */
function collectTrace(page: Page): TraceEvidence {
  const mupdf = mupdfEngine();
  const evidence: TraceEvidence = { sizes: [], hidden: 0, layered: false, images: 0 };
  let depth = 0;
  const visible = (text: Text, ctm: Matrix, alpha: number): void => {
    if (depth > 0) evidence.layered = true;
    const { sizes, chars } = spanSizes(ctm, text);
    if (!(alpha > 0) || chars === 0) evidence.hidden += 1;
    else evidence.sizes.push(...sizes);
  };
  const hidden = (): void => {
    if (depth > 0) evidence.layered = true;
    evidence.hidden += 1;
  };
  const device = new mupdf.Device({
    beginLayer: () => {
      depth += 1;
    },
    endLayer: () => {
      depth -= 1;
    },
    fillText: (text, ctm, _cs, _color, alpha) => visible(text, ctm, alpha),
    strokeText: (text, _stroke, ctm, _cs, _color, alpha) => visible(text, ctm, alpha),
    clipText: hidden,
    clipStrokeText: hidden,
    ignoreText: hidden,
    fillImage: () => {
      evidence.images += 1;
    },
    fillImageMask: () => {
      evidence.images += 1;
    },
  });
  try {
    page.run(device, mupdf.Matrix.identity);
  } finally {
    device.close();
  }
  return evidence;
}

interface LineEvidence {
  lines: Rectangle[];
  rawSpanCount: number;
}

/**
 * Line rectangles exactly as the Python gate builds them: the extractor's rawdict line
 * box transformed by the page rotation matrix. MuPDF.js already runs the structured-text
 * device through the page transform, so the walk gives that space directly.
 */
function collectLines(page: Page): LineEvidence {
  const lines: Rectangle[] = [];
  const spansPerLine: number[] = [];
  let key: string | null = null;
  // Include glyphs beyond the media box so clipped text still fails the print check.
  page.toStructuredText('preserve-whitespace,clip=no').walk({
    beginLine: (bbox) => {
      lines.push([bbox[0], bbox[1], bbox[2], bbox[3]]);
      spansPerLine.push(0);
      key = null;
    },
    onChar: (_char, _origin, font, size) => {
      const current = `${font.getName()}:${size}`;
      const last = spansPerLine.length - 1;
      if (last < 0) return;
      if (current !== key) {
        key = current;
        spansPerLine[last] = (spansPerLine[last] ?? 0) + 1;
      }
    },
  });
  return { lines, rawSpanCount: spansPerLine.reduce((total, count) => total + count, 0) };
}

/** Unrotated box from the page dictionary, matching PyMuPDF's MediaBox/CropBox. */
function rawBox(page: PDFPage, key: 'MediaBox' | 'CropBox'): Rect | null {
  try {
    const box = page.getObject().getInheritable(key);
    if (!box.isArray() || box.length !== 4) return null;
    const values = [0, 1, 2, 3].map((at) => box.get(at).asNumber());
    if (!values.every(Number.isFinite)) return null;
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = values;
    return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  } catch {
    return null;
  }
}

function intersection(a: Rect, b: Rect): Rect {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

function countOutside(rect: Rect, lines: readonly Rectangle[], margin: number): number {
  const limitX = rect[2] - margin + GEOMETRY_EPS_PT;
  const limitY = rect[3] - margin + GEOMETRY_EPS_PT;
  return lines.filter(
    ([x0, y0, x1, y1]) =>
      x0 < margin - GEOMETRY_EPS_PT || y0 < margin - GEOMETRY_EPS_PT || x1 > limitX || y1 > limitY,
  ).length;
}

interface FontEvidence {
  invalid: boolean;
  sizes: number[];
  minimum: number | null;
  small: number;
}

function fontEvidence(observable: readonly number[]): FontEvidence {
  const invalid = observable.some((size) => !Number.isFinite(size) || size <= 0);
  const sizes = invalid ? [] : [...observable];
  return {
    invalid,
    sizes,
    minimum: sizes.length > 0 ? Math.min(...sizes) : null,
    small: sizes.filter((size) => size + FONT_EPS_PT < MIN_FONT_PT).length,
  };
}

function checkPage(page: PDFPage, number: number): PageReport {
  const errors = new Set<number>();
  const warnings: number[] = [];
  const rect = page.getBounds();
  const media = rawBox(page, 'MediaBox') ?? page.getBounds('MediaBox');
  const crop = intersection(rawBox(page, 'CropBox') ?? media, media);
  const widthMm = (rect[2] - rect[0]) / PT_PER_MM;
  const heightMm = (rect[3] - rect[1]) / PT_PER_MM;
  const mediaWidthMm = (media[2] - media[0]) / PT_PER_MM;
  const mediaHeightMm = (media[3] - media[1]) / PT_PER_MM;
  if (!isA3Landscape(widthMm, heightMm) || !isA3(mediaWidthMm, mediaHeightMm)) warnings.push(1);
  // A crop could conceal text or make the printable-area reference ambiguous.
  if (
    Math.abs(crop[2] - crop[0] - (media[2] - media[0])) > GEOMETRY_EPS_PT ||
    Math.abs(crop[3] - crop[1] - (media[3] - media[1])) > GEOMETRY_EPS_PT
  ) {
    errors.add(105);
  }
  if (page.getAnnotations().length > 0 || page.getWidgets().length > 0) errors.add(109);
  const trace = collectTrace(page);
  if (trace.images > 0) errors.add(104);
  if (trace.hidden > 0) errors.add(102);
  if (trace.layered) errors.add(110);
  const fonts = fontEvidence(trace.sizes);
  if (fonts.invalid) errors.add(108);
  if (fonts.small > 0) errors.add(3);
  const { lines, rawSpanCount } = collectLines(page);
  if (lines.length === 0 || trace.sizes.length === 0 || fonts.sizes.length === 0) errors.add(101);
  const outside = countOutside(rect, lines, TEXT_MARGIN_PT);
  if (outside > 0) {
    if (countOutside(rect, lines, 0) > 0) errors.add(5); // Content lost beyond the paper edge.
    else warnings.push(2); // Readable text within the author's preferred margin.
  }
  const areaMm2 = unionArea(lines) / PT_PER_MM ** 2;
  const fraction = areaMm2 / PRINTABLE_AREA_MM2;
  if (fraction > MAX_TEXT_FRACTION + FRACTION_EPS) warnings.push(4);
  const codes = [...errors].sort((a, b) => a - b);
  return {
    page: number + 1,
    status: statusOf(codes),
    metrics: {
      width_mm: round(widthMm, 6),
      height_mm: round(heightMm, 6),
      media_width_mm: round(mediaWidthMm, 6),
      media_height_mm: round(mediaHeightMm, 6),
      printable_area_mm2: PRINTABLE_AREA_MM2,
      line_count: lines.length,
      raw_span_count: rawSpanCount,
      rendered_span_count: trace.sizes.length,
      hidden_span_count: trace.hidden,
      image_count: trace.images,
      outside_margin_line_count: outside,
      minimum_font_pt: fonts.minimum === null ? null : round(fonts.minimum, 6),
      below_8pt_span_count: fonts.small,
      line_rectangle_union_mm2: round(areaMm2, 6),
      text_area_fraction: round(fraction, 9),
    },
    errors: codes,
    warnings,
  };
}

/** Numeric-only diagnostics; never copies file metadata or document content. */
export function checkPdf(bytes: Uint8Array): GateReport {
  const pages: PageReport[] = [];
  let documentErrors: number[] = [];
  try {
    const pdf = openPdfDocument(bytes);
    if (pdf === null || pdf.needsPassword() || pdf.countPages() === 0) {
      documentErrors = [106];
    } else {
      for (let index = 0; index < pdf.countPages(); index += 1) {
        try {
          pages.push(checkPage(pdf.loadPage(index), index));
        } catch {
          pages.push({ page: index + 1, status: 'UNVERIFIED', metrics: {}, errors: [103], warnings: [] });
        }
      }
    }
  } catch {
    // Backend messages may contain document text: only the code survives.
    pages.length = 0;
    documentErrors = [106];
  }
  const all = [...documentErrors, ...pages.flatMap((page) => page.errors)];
  return { status: statusOf(all), errors: documentErrors, pages };
}
