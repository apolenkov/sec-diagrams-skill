/**
 * In-memory synthetic PDF builders for the print-gate tests, one per Python test fixture.
 * Coordinates are top-left origin in points, like PyMuPDF's `insert_text`.
 * Nothing here is written to disk by the tests.
 */
import type { PDFDocument, PDFObject, Rect, Rotate } from './mupdf-api.ts';
import { loadMupdf, mupdfEngine, PT_PER_MM } from './pdf-gate.ts';

export async function pdfTestOptions(): Promise<{ skip: boolean | string }> {
  if (await loadMupdf()) return { skip: false };
  if (process.env.SEC_DIAGRAMS_REQUIRE_MUPDF === '1') throw new Error('MuPDF is required for this test run');
  return { skip: 'optional mupdf engine is unavailable' };
}

export const TOKEN = 'SYNTHETIC_TOKEN_ONLY';

export interface FixtureLine {
  /** Baseline start, points from the left edge of the displayed page. */
  x: number;
  /** Baseline start, points from the top edge of the displayed page. */
  y: number;
  size: number;
  body?: string;
  /** Render mode 3: text is only used as a clipping path. */
  invisible?: boolean;
  /** Fill and stroke alpha via an ExtGState. */
  transparent?: boolean;
}

export interface FixtureImage {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FixturePage {
  widthMm?: number;
  heightMm?: number;
  rotate?: Rotate;
  lines?: FixtureLine[];
  image?: FixtureImage;
  /** Draw a rectangle and nothing else: no text evidence at all. */
  vectorOnly?: boolean;
  /** Wrap the whole page content in this optional-content group. */
  layer?: string;
}

export interface FixtureSpec {
  pages: FixturePage[];
  /** Make the CropBox of page 1 narrower than the MediaBox. */
  cropShrinkPt?: number;
  /** Attach a text annotation to page 1. */
  annotation?: boolean;
}

const A3_LANDSCAPE: Pick<FixturePage, 'widthMm' | 'heightMm'> = { widthMm: 420, heightMm: 297 };
const TRANSPARENT = 'GS0';

const num = (value: number): string => String(Math.round(value * 1e6) / 1e6);

const escapeText = (body: string): string => body.replace(/([\\()])/g, '\\$1');

function lineOperator(heightPt: number, font: string, line: FixtureLine): string {
  const body = escapeText(line.body ?? TOKEN);
  const mode = line.invisible === true ? '3 Tr ' : '';
  const block =
    `BT ${mode}/${font} ${num(line.size)} Tf 1 0 0 1 ${num(line.x)} ${num(heightPt - line.y)} Tm ` + `(${body}) Tj ET`;
  return line.transparent === true ? `q /${TRANSPARENT} gs ${block} Q` : block;
}

function imageOperator(heightPt: number, image: FixtureImage): string {
  return (
    `q ${num(image.width)} 0 0 ${num(image.height)} ${num(image.x)} ` +
    `${num(heightPt - image.y - image.height)} cm /Im0 Do Q`
  );
}

function pageContent(heightPt: number, page: FixturePage): string {
  const operators = (page.lines ?? []).map((line) => lineOperator(heightPt, 'F1', line));
  if (page.image) operators.push(imageOperator(heightPt, page.image));
  if (page.vectorOnly === true) operators.push('1 0 0 1 50 50 40 40 re S');
  return operators.join('\n');
}

function pageResources(doc: PDFDocument, font: PDFObject, page: FixturePage): Record<string, unknown> {
  const resources: Record<string, unknown> = { Font: { F1: font } };
  if (page.lines?.some((line) => line.transparent === true)) {
    resources.ExtGState = { [TRANSPARENT]: doc.addObject({ Type: 'ExtGState', CA: 0, ca: 0 }) };
  }
  if (page.image) {
    const mupdf = mupdfEngine();
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 10, 10], false);
    pixmap.clear(255);
    resources.XObject = { Im0: doc.addImage(new mupdf.Image(pixmap)) };
  }
  return resources;
}

/** Optional content needs one /OCProperties in the catalog plus one /OCG per layer. */
function layerGroup(doc: PDFDocument, name: string): PDFObject {
  const root = doc.getTrailer().get('Root');
  const group = doc.addObject({ Type: 'OCG', Name: `(${name})` });
  const existing = root.get('OCProperties');
  if (existing.isNull()) {
    root.put('OCProperties', doc.addObject({ OCGs: [group], D: { ON: [group], Order: [group], RBGroups: [] } }));
  } else {
    existing.get('OCGs').push(group);
    existing.get('D').get('ON').push(group);
    existing.get('D').get('Order').push(group);
  }
  return group;
}

function appendPages(doc: PDFDocument, spec: FixtureSpec): void {
  const mupdf = mupdfEngine();
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'), 'Latin');
  for (const page of spec.pages) {
    const widthPt = (page.widthMm ?? A3_LANDSCAPE.widthMm ?? 420) * PT_PER_MM;
    const heightPt = (page.heightMm ?? A3_LANDSCAPE.heightMm ?? 297) * PT_PER_MM;
    const media: Rect = [0, 0, widthPt, heightPt];
    const resources = pageResources(doc, font, page);
    let content = pageContent(heightPt, page);
    if (page.layer !== undefined) {
      resources.Properties = {
        MC0: doc.addObject({ PG: 0, Name: `(${page.layer})`, Intent: 'View', OCGs: [layerGroup(doc, page.layer)] }),
      };
      content = `/OC /MC0 BDC\n${content}\nEMC`;
    }
    const object = doc.addPage(media, page.rotate ?? 0, resources, content);
    doc.insertPage(doc.countPages(), object);
  }
}

function toBytes(doc: PDFDocument): Uint8Array {
  return doc.saveToBuffer('').asUint8Array();
}

/** CropBox and annotations can only be set on a page loaded from saved bytes. */
function applyPageObjects(bytes: Uint8Array, spec: FixtureSpec): Uint8Array {
  if (spec.cropShrinkPt === undefined && spec.annotation !== true) return bytes;
  const mupdf = mupdfEngine();
  const doc = new mupdf.PDFDocument(bytes);
  const page = doc.loadPage(0);
  if (spec.cropShrinkPt !== undefined) {
    const media = page.getBounds('MediaBox');
    page.setPageBox('CropBox', [media[0], media[1], media[2] - spec.cropShrinkPt, media[3]]);
  }
  if (spec.annotation === true) {
    const annotation = page.createAnnotation('Text');
    annotation.setRect([100, 100, 130, 130]);
    annotation.setContents('note');
    annotation.update();
  }
  return toBytes(doc);
}

export function buildPdf(spec: FixtureSpec): Uint8Array {
  const mupdf = mupdfEngine();
  const doc = new mupdf.PDFDocument();
  appendPages(doc, spec);
  return applyPageObjects(toBytes(doc), spec);
}

const a3 = (lines: FixtureLine[], over: Partial<FixturePage> = {}): FixtureSpec => ({
  pages: [{ ...A3_LANDSCAPE, lines, ...over }],
});

/** One builder per Python test that produces a PDF; keyed by the Python test name. */
export const FIXTURES = {
  eight_pt_passes_exact: () => buildPdf(a3([{ x: 50, y: 60, size: 8 }])),
  seven_pt_fails: () => buildPdf(a3([{ x: 50, y: 60, size: 7 }])),
  fractional_below_eight_fails_without_integer_rounding: () => buildPdf(a3([{ x: 50, y: 60, size: 7.99 }])),
  all_physical_pages_and_rotation: () =>
    buildPdf({
      pages: [
        { widthMm: 297, heightMm: 420, rotate: 90, lines: [{ x: 50, y: 60, size: 8 }] },
        { ...A3_LANDSCAPE, lines: [{ x: 50, y: 60, size: 7 }] },
      ],
    }),
  margin_failure: () => buildPdf(a3([{ x: 5, y: 60, size: 8 }])),
  off_page_text_not_clipped_away: () =>
    buildPdf(
      a3([
        { x: 50, y: 60, size: 8 },
        { x: -5, y: 90, size: 8 },
      ]),
    ),
  wrong_sheet: () => buildPdf(a3([{ x: 50, y: 60, size: 8 }], { widthMm: 210, heightMm: 297 })),
  crop_is_unverified: () => buildPdf({ ...a3([{ x: 50, y: 60, size: 8 }]), cropShrinkPt: 1 }),
  no_text_vector_only_unverified: () => buildPdf(a3([], { vectorOnly: true })),
  raster_with_extracted_text_unverified: () =>
    buildPdf(a3([{ x: 50, y: 60, size: 8 }], { image: { x: 100, y: 100, width: 50, height: 50 } })),
  hidden_text_unverified: () =>
    buildPdf(
      a3([
        { x: 50, y: 60, size: 8 },
        { x: 50, y: 90, size: 7, invisible: true },
      ]),
    ),
  zero_opacity_unverified: () =>
    buildPdf(
      a3([
        { x: 50, y: 60, size: 8 },
        { x: 50, y: 90, size: 7, transparent: true },
      ]),
    ),
  density_over_half: () =>
    buildPdf(
      a3(
        Array.from({ length: 62 }, (_, index) => ({
          x: 50,
          y: 50 + index * 12,
          size: 8,
          body: 'M'.repeat(110),
        })),
      ),
    ),
  duplicate_lines_count_union_once: () =>
    buildPdf(
      a3([
        { x: 50, y: 60, size: 8 },
        { x: 50, y: 60, size: 8 },
      ]),
    ),
  single_line_union_reference: () => buildPdf(a3([{ x: 50, y: 60, size: 8 }])),
  cli_json_and_no_text_or_path: () => buildPdf(a3([{ x: 50, y: 60, size: 8 }])),
  source_bytes_unchanged: () => buildPdf(a3([{ x: 50, y: 60, size: 8 }])),
  vector_fit_preserves_multiple_pages_and_orientations: () =>
    buildPdf({
      pages: [
        { widthMm: 500, heightMm: 350, lines: [{ x: 50, y: 60, size: 20 }] },
        { widthMm: 350, heightMm: 500, lines: [{ x: 50, y: 60, size: 20 }] },
      ],
    }),
  annotation_present: () => buildPdf({ ...a3([{ x: 50, y: 60, size: 8 }]), annotation: true }),
  optional_content_layer: () => buildPdf(a3([{ x: 50, y: 60, size: 8 }], { layer: 'LayerA' })),
  /** Header only: opens as a PDF shell but has no page tree, so it is unreadable to the gate. */
  unreadable_file_no_details: () => new TextEncoder().encode('%PDF-1.4\nnot a document\n'),
} satisfies Record<string, () => Uint8Array>;

export type FixtureName = keyof typeof FIXTURES;
