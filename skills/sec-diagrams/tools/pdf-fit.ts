/**
 * Fit every source PDF page, as vector content, inside 10 mm A3 margins.
 * Mirrors `fit_pdf_a3.py`; no rasterization, OCR, relayout, crop or font substitution.
 *
 * The template uses the author’s recommended landscape A3 (SD-P02) for every page
 * whatever the shape of the drawing; `auto` keeps the historical name and means landscape.
 * The fitter never enlarges: a drawing cropped smaller than the sheet stays at its own size,
 * because up-scaling would carry a too-small кегль through the print gate of the same run.
 */
import type { Matrix, Rect } from './mupdf-api.ts';
import { A3_LONG_MM, A3_SHORT_MM, PT_PER_MM, mupdfEngine, openPdfDocument } from './pdf-gate.ts';

const MARGIN_MM = 10;

export type FitOrientation = 'portrait' | 'landscape' | 'auto';

export interface Sheet {
  widthPt: number;
  heightPt: number;
}

function sheetFor(orientation: FitOrientation): Sheet {
  const landscape = orientation !== 'portrait';
  const widthMm = landscape ? A3_LONG_MM : A3_SHORT_MM;
  const heightMm = landscape ? A3_SHORT_MM : A3_LONG_MM;
  return { widthPt: widthMm * PT_PER_MM, heightPt: heightMm * PT_PER_MM };
}

/**
 * The scale the fit gives a drawing of this size on the sheet: the smaller of the width and the
 * height fit, never above 1 - shrinking makes a big drawing fit, growing would launder a small
 * font. The source check (SD-P01, style set) asks this same function, so the paper and the
 * static check cannot disagree.
 */
export function fitScale(sourceWidth: number, sourceHeight: number, sheet: Sheet = sheetFor('landscape')): number {
  const width = sheet.widthPt - 2 * MARGIN_MM * PT_PER_MM;
  const height = sheet.heightPt - 2 * MARGIN_MM * PT_PER_MM;
  return Math.min(1, width / sourceWidth, height / sourceHeight);
}

/**
 * Place the source page centred inside the printable rectangle, keeping proportion.
 * MuPDF.js runs a page through its page transform, so both sides of the matrix are
 * the pages' displayed (top-left) spaces; that is the space the gate measures in.
 */
function fitMatrix(bounds: Rect, sheet: Sheet): Matrix {
  const sourceWidth = bounds[2] - bounds[0];
  const sourceHeight = bounds[3] - bounds[1];
  const left = MARGIN_MM * PT_PER_MM;
  const top = MARGIN_MM * PT_PER_MM;
  const width = sheet.widthPt - 2 * left;
  const height = sheet.heightPt - 2 * top;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) throw new RangeError('source page has no area');
  const scale = fitScale(sourceWidth, sourceHeight, sheet);
  const offsetX = left + (width - sourceWidth * scale) / 2 - bounds[0] * scale;
  const offsetY = top + (height - sourceHeight * scale) / 2 - bounds[1] * scale;
  return [scale, 0, 0, scale, offsetX, offsetY];
}

/**
 * Returns a new PDF with one A3 page per source page. `target` mirrors the Python guard
 * against in-place edits: the destination buffer may not be the source buffer.
 */
export function fitPdfA3(bytes: Uint8Array, orientation: FitOrientation, target?: Uint8Array): Uint8Array {
  if (target !== undefined && target.buffer === bytes.buffer) {
    throw new RangeError('source and target must differ');
  }
  const pdf = openPdfDocument(bytes);
  if (pdf === null || pdf.needsPassword() || pdf.countPages() === 0) {
    throw new RangeError('source is not a readable nonempty PDF');
  }
  const mupdf = mupdfEngine();
  const buffer = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buffer, 'pdf', 'compress');
  try {
    for (let index = 0; index < pdf.countPages(); index += 1) {
      const page = pdf.loadPage(index);
      const sheet = sheetFor(orientation);
      const matrix = fitMatrix(page.getBounds(), sheet);
      const device = writer.beginPage([0, 0, sheet.widthPt, sheet.heightPt]);
      try {
        page.run(device, matrix);
      } finally {
        device.close();
      }
      writer.endPage();
    }
  } finally {
    writer.close();
  }
  return buffer.asUint8Array();
}
