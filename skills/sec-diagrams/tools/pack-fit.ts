/**
 * Step 6 of pack, split out of pack.ts (the size cap): merge the fitted sheets into the packet
 * under the composition name and gate the merged bytes. Freshness of every sheet against
 * pdf-report.json is proven by pack before this runs; here only the fitted files themselves.
 */
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { checkPdf, isPageMetrics, mupdfEngine, type GateReport } from './pdf-gate.ts';
import { gateCodes, gateWarnings, sha256, type PdfReport } from './pdf.ts';
import type { Manifest } from './profile.ts';
import type { PacketPdf } from './pack-checklist.ts';
import { mergedPdfName } from './pack-names.ts';

function mergePdfs(blobs: Uint8Array[]): Uint8Array {
  const mupdf = mupdfEngine();
  const out = new mupdf.PDFDocument();
  for (const bytes of blobs) {
    const source = mupdf.Document.openDocument(bytes, 'application/pdf');
    if (source === null) throw new Error('not a readable pdf');
    const pdf = source.asPDF();
    if (pdf === null) throw new Error('not a pdf document');
    for (let index = 0; index < pdf.countPages(); index += 1) out.graftPage(out.countPages(), pdf, index);
  }
  // The gate allocates in the same WASM heap before these bytes are written.
  return out.saveToBuffer('compress').asUint8Array().slice();
}

const twoDigits = (value: number | null): string => (value === null ? '-' : value.toFixed(2));
const percent = (fraction: number | null): string => (fraction === null ? '-' : (fraction * 100).toFixed(1));

/** One summary line for the merged PDF: pages, the smallest font, the biggest text share. */
function packetLine(report: GateReport, name: string): string {
  const fonts: number[] = [];
  const fractions: number[] = [];
  const errors = new Set<number>(report.errors);
  for (const page of report.pages) {
    for (const code of page.errors) errors.add(code);
    if (isPageMetrics(page.metrics)) {
      if (page.metrics.minimum_font_pt !== null) fonts.push(page.metrics.minimum_font_pt);
      fractions.push(page.metrics.text_area_fraction);
    }
  }
  const warnings = new Set(report.pages.flatMap(page => page.warnings));
  const codes = gateCodes([...errors].sort((a, b) => a - b));
  codes.push(...gateWarnings([...warnings]));
  const tail = codes.length > 0 ? ' код ' + codes.join(' ') : '';
  const min = fonts.length > 0 ? Math.min(...fonts) : null;
  const max = fractions.length > 0 ? Math.max(...fractions) : null;
  return `${report.status} ${name}: стр ${report.pages.length}, кегль ${twoDigits(min)} пт, текст ${percent(max)}%${tail}`;
}

/**
 * No merge - the previous merged file is deleted and nothing of the packet is assembled over it,
 * so the reviewer never opens a merge older than its sheets. Freshness of the sheets proved,
 * pack hands the report and the build folder: the merge is written into the temp build next to
 * the packet, and every fitted PDF is merged only after its bytes matched the hash
 * the report signed for it - a file edited or swapped after pdf stops the merge.
 */
export function fitToPacket(manifest: Manifest, report: PdfReport, paths: readonly string[], outDir: string): PacketPdf {
  const name = mergedPdfName(manifest.service, manifest.sheets.length);
  const out = join(outDir, name);
  const drop = (): void => rmSync(out, { force: true });
  const notBuilt = (reason: string): PacketPdf => ({
    path: null,
    name,
    line: `не собран ${name}: ${reason}, пройди pdf`,
    status: 'NOT_CHECKED',
  });
  if (!paths.every((path) => existsSync(path))) {
    drop();
    return notBuilt('нет свежих вписанных PDF всех листов');
  }
  const vouched = new Map(report.files.map((entry) => [entry.file.normalize('NFC'), entry.pdfFittedSha]));
  const blobs: Uint8Array[] = [];
  for (const [index, sheet] of manifest.sheets.entries()) {
    const path = paths[index] as string;
    const file = sheet.file.normalize('NFC');
    // Read once: these bytes are hashed, then grafted into the merge - nothing else gets in.
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(path));
    } catch {
      drop();
      return notBuilt('вписанный PDF ' + file + ' не читается');
    }
    const want = vouched.get(file);
    if (want === undefined) {
      drop();
      return notBuilt('вписанный PDF ' + file + ' не подтвержден хешем в отчете');
    }
    if (sha256(bytes) !== want) {
      drop();
      return notBuilt('вписанный PDF ' + file + ' изменен после pdf');
    }
    blobs.push(bytes);
  }
  let bytes: Uint8Array;
  try {
    bytes = mergePdfs(blobs);
  } catch {
    drop();
    return notBuilt('листы не склеились');
  }
  const gate = checkPdf(bytes);
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(out, bytes);
  } catch {
    drop();
    return notBuilt('файл не записан в каталог пакета');
  }
  return { path: out, name, line: packetLine(gate, name), status: gate.status };
}
