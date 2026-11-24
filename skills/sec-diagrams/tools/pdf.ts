/**
 * pdf <folder>: export every sheet with draw.io Desktop, fit it into A3 and run the print gate.
 *
 * draw.io is found locally, never online: `SD_DRAWIO` first (a set but broken path means
 * "no draw.io", nothing else is searched), then local installations for the host OS.
 * No network export exists in this file: the sheets must not leave the machine.
 *
 * One file at a time goes through `<draw.io> -x -f pdf -a --crop -o <tmp>/raw.pdf <file>` with
 * execFile (no shell) and a 120 s timeout; a failed or unreadable export is NOT_CHECKED without
 * a word of the engine's message. `--crop` crops every diagram page to its drawing, so a wide
 * drawing no longer gets tiled across several PDF pages; as a safety net the number of PDF
 * pages must equal the number of diagram pages, a mismatch FAILs the sheet. Every exported page
 * is fitted into 10 mm landscape-A3 margins (fitPdfA3) and gated (checkPdf); fitted PDFs and
 * pdf-report.json land in `<folder>-pdf/`, next to the package. A sheet whose export failed or
 * whose gate FAILED loses its previous fitted PDF: `pack` must never merge a stale render.
 * The report carries the sha256 of each source sheet so `pack` can see a PDF made before the
 * last edit. Output is blind: status, file and page names, metrics and codes - never PDF text.
 * Exit codes: 0 all pages PASS, 1 a FAIL, 2 NOT_CHECKED or UNVERIFIED, 65 SD-E01 or SD-K01.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { z } from 'zod';

import { DrawioInputError, parseDrawio } from './drawio.ts';
import { drawioMissingLines, findDrawio, type ExportEnv } from './drawio-path.ts';
import { fitPdfA3 } from './pdf-fit.ts';
import { noTextStep } from './pdf-unverified.ts';
import {
  checkPdf,
  isPageMetrics,
  mupdfInstallHint,
  mupdfLoaded,
  openPdfDocument,
  silenceBackendDiagnostics,
  type GateReport,
  type PageReport,
} from './pdf-gate.ts';

import { AUTHOR_ADVICE } from './checks/finding.ts';
import { DirectoryNameConflict, listDrawio, loadManifestOrNull, ProfileError, resolveDirectoryName } from './profile.ts';
import { nodeCommand } from './shell.ts';

export { DRAWIO_MISSING_LINE, drawioCandidates, findDrawio } from './drawio-path.ts';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

export const PDF_REPORT_NAME = 'pdf-report.json';

/** Fitted sheets of one package live next to it, never inside it: the reviewer gets sources only. */
export const pdfDir = (folder: string): string => resolve(folder) + '-pdf';
export const pdfReportPath = (folder: string): string => join(pdfDir(folder), PDF_REPORT_NAME);
/** Name of the fitted PDF of one sheet inside the pdf directory. */
export const fittedPdfName = (fileName: string): string => basename(fileName, extname(fileName)) + '.pdf';

/** Resolve all fitted paths before exporting or assembling a packet. */
export function fittedPdfPaths(dir: string, files: readonly string[]): string[] {
  const out = pdfDir(dir);
  const entries = existsSync(out) ? readdirSync(out) : [];
  return files.map(file => join(out, resolveDirectoryName(entries, fittedPdfName(file.normalize('NFC')))));
}

const EXPORT_TIMEOUT_MS = 120_000;

/** Writes the raw export of one .drawio to outPath; throws when the export did not happen. */
export type SheetExporter = (sourcePath: string, outPath: string) => void;

function desktopExporter(binary: string, env: ExportEnv): SheetExporter {
  return (sourcePath, outPath) => {
    execFileSync(binary, ['-x', '-f', 'pdf', '-a', '--crop', '-o', outPath, sourcePath], {
      timeout: EXPORT_TIMEOUT_MS,
      stdio: 'ignore',
      env: { ...env },
    });
  };
}

/** Static Russian labels for the gate's numeric codes; they never quote the document. */
const GATE_LABELS: Readonly<Record<number, string>> = {
  101: 'нет текста',
  102: 'скрытый текст',
  103: 'страница не читается',
  104: 'растровая картинка',
  105: 'обрезанная страница',
  106: 'файл не читается',
  108: 'неизвестный кегль',
  109: 'аннотации на странице',
  110: 'слои',
};

/** Static reason per hard gate code; the word is fixed, never taken from the document.
 * The page-format codes join SD-P02, the rule check reads off the same sheet; кегль stays with
 * SD-P01, the one rule whose cell ids check can name; the text share owns SD-P03. */
const FORMAT_ORDER = [1, 2] as const;
const FORMAT_REASONS: Readonly<Record<(typeof FORMAT_ORDER)[number], string>> = {
  1: 'не альбомный A3',
  2: 'текст на полях',
};

/** The ids of the small cells live in the sheet, not in the PDF: check names them as SD-P01. */
const P01_HINT =
  'id назовет check кодом SD-P01; подними кегль командой style set <файл> <id> fontSize=<число>, или раздели лист на два';
/** A fitted page that is not landscape A3 comes from the page size of the sheet itself. */
const P02_HINT = 'страница листа не альбомный A3: check покажет SD-P02, размер страницы листа правят в draw.io';
/** More PDF pages than the sheet has: the drawing spilled over the page the export was told to make. */
const MISMATCH_HINT = 'уменьши рисунок или раздели лист в draw.io: экспорт вышел числом страниц больше, чем лист';

/** Gate code -> printed code: 3 is the measured кегль (SD-P01), 1-2 the page format (SD-P02),
 * 4 the text share (SD-P03); 101+ stay bare gate codes, they only make a page UNVERIFIED. */
export function gateCodes(errors: readonly number[]): string[] {
  const codes: string[] = [];
  if (errors.includes(3)) codes.push('SD-P01 (кегль)');
  const format = FORMAT_ORDER.filter((code) => errors.includes(code)).map((code) => FORMAT_REASONS[code]);
  if (format.length > 0) codes.push('SD-P02 (' + format.join(', ') + ')');
  if (errors.includes(4)) codes.push('SD-P03');
  if (errors.includes(5)) codes.push('SD-P04 (текст за границей страницы)');
  for (const code of errors) {
    if (code >= 100) codes.push(code + ' ' + (GATE_LABELS[code] ?? 'данные не прочитаны'));
  }
  return codes;
}

export function gateWarnings(codes: readonly number[]): string[] {
  return gateCodes(codes).map(code => `WARN ${code} - ${AUTHOR_ADVICE}`);
}

const twoDigits = (value: number | null): string => (value === null ? '-' : value.toFixed(2));
const percent = (fraction: number | null): string => (fraction === null ? '-' : (fraction * 100).toFixed(1));

/** One blind line per page: status, name, page, size of the smallest font, text share, codes. */
export function gatePageLine(file: string, report: PageReport): string {
  const metrics = isPageMetrics(report.metrics) ? report.metrics : null;
  const codes = gateCodes(report.errors);
  const tail = codes.length > 0 ? ' код ' + codes.join(' ') : '';
  return (
    `${report.status} ${file} стр ${report.page}: ` +
    `кегль ${twoDigits(metrics?.minimum_font_pt ?? null)} пт, ` +
    `текст ${percent(metrics?.text_area_fraction ?? null)}%${tail}`
  );
}

export type ReportStatus = 'PASS' | 'FAIL' | 'NOT_CHECKED' | 'UNVERIFIED';

const reportStatuses = z.enum(['PASS', 'FAIL', 'NOT_CHECKED', 'UNVERIFIED']);

const reportFileSchema = z.object({
  file: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  status: reportStatuses,
  pdf: z.string().min(1),
  // Hash of the fitted PDF written next to the report: pack merges only bytes the
  // report signed for. Absent on a failed or removed render, and on a report from an older run -
  // which pack reads, but then it sends the person through pdf instead of merging.
  pdfFittedSha: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
  pages: z.array(
    z.object({
      page: z.number().int().positive(),
      status: z.enum(['PASS', 'FAIL', 'UNVERIFIED']),
      errors: z.array(z.number().int()),
      warnings: z.array(z.number().int()).default([]),
      metrics: z.record(z.string(), z.unknown()),
    }),
  ),
});

export const pdfReportSchema = z.object({
  status: reportStatuses,
  files: z.array(reportFileSchema),
});

export type PdfReport = z.infer<typeof pdfReportSchema>;
export type PdfReportFile = z.infer<typeof reportFileSchema>;

/** Content hash that ties a fitted PDF to the sheet bytes it was made from. */
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * pdf-report.json of a folder, or null when it is absent or unreadable. A broken report is the
 * same as a missing one for the caller: `pack` sends the person back to `pdf`, never trusts it.
 */
export function loadPdfReport(folder: string): PdfReport | null {
  try {
    const parsed = pdfReportSchema.safeParse(JSON.parse(readFileSync(pdfReportPath(folder), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface FileOutcome {
  entry: PdfReportFile;
  lines: string[];
}

function exportFailure(file: string, sha: string): FileOutcome {
  return {
    entry: { file, sha256: sha, status: 'NOT_CHECKED', pdf: fittedPdfName(file), pages: [] },
    lines: [`NOT_CHECKED SD-P04 ${file} - экспорт не удался`],
  };
}

/** A sheet that did not pass has no business leaving a render behind: pack must not merge it. */
const removeStalePdf = (out: string): void => {
  rmSync(out, { force: true });
};

/** A drawing wider than the draw.io page used to tile across PDF pages: numbers only, never PASS. */
function pageMismatchOutcome(
  file: string,
  sha: string,
  out: string,
  pdfPages: number,
  sheetPages: number,
): FileOutcome {
  removeStalePdf(out);
  return {
    entry: { file, sha256: sha, status: 'FAIL', pdf: fittedPdfName(file), pages: [] },
    lines: [
      `FAIL SD-P04 ${file} - страниц PDF ${pdfPages}, страниц листа ${sheetPages}`,
      `Подсказка: ${MISMATCH_HINT}`,
    ],
  };
}

function gatedOutcome(file: string, sha: string, report: GateReport, pdfName: string): FileOutcome {
  const unreadable = report.errors.length > 0;
  const pageLines = report.pages.flatMap(page => [
    gatePageLine(file, page),
    ...gateWarnings(page.warnings).map(warning => `${warning} (${file} стр ${page.page})`),
  ]);
  const lines = unreadable
    ? [`UNVERIFIED ${file}: кегль -, текст - код ${gateCodes(report.errors).join(' ')}`, ...pageLines]
    : pageLines;
  if (report.pages.some((page) => page.errors.some((code) => code === 3))) {
    lines.push(`Подсказка: ${P01_HINT}`);
  }
  if (report.pages.some((page) => page.warnings.includes(1))) {
    lines.push(`Подсказка: ${P02_HINT}`);
  }
  const status: ReportStatus = unreadable ? 'UNVERIFIED' : report.status;
  const pages = report.pages.map((page) => ({
    page: page.page,
    status: page.status,
    errors: [...page.errors],
    warnings: [...page.warnings],
    metrics: { ...page.metrics },
  }));
  return {
    entry: { file, sha256: sha, status, pdf: pdfName, pages },
    lines,
  };
}

/** Count of PDF pages, or null when the engine's bytes cannot be read as a PDF. */
function pdfPageCount(bytes: Uint8Array): number | null {
  try {
    const pdf = openPdfDocument(bytes);
    if (pdf === null || pdf.needsPassword()) return null;
    return pdf.countPages();
  } catch {
    return null;
  }
}

function fitAndGate(file: string, sha: string, raw: string, out: string): FileOutcome {
  const fitted = fitPdfA3(new Uint8Array(readFileSync(raw)), 'auto');
  writeFileSync(out, fitted);
  const outcome = gatedOutcome(file, sha, checkPdf(fitted), basename(out));
  if (outcome.entry.status === 'FAIL') removeStalePdf(out);
  // The report signs for the bytes it just wrote: pack will refuse a file that changed since.
  else outcome.entry.pdfFittedSha = sha256(fitted);
  return outcome;
}

function exportOne(
  source: string,
  file: string,
  sha: string,
  tmp: string,
  out: string,
  sheetPages: number,
  exportSheet: SheetExporter,
): FileOutcome {
  const raw = join(tmp, 'raw.pdf');
  try {
    exportSheet(source, raw);
    if (!existsSync(raw) || statSync(raw).size === 0) throw new Error('empty export');
    const pages = pdfPageCount(readFileSync(raw));
    if (pages !== null && pages !== sheetPages) return pageMismatchOutcome(file, sha, out, pages, sheetPages);
    return fitAndGate(file, sha, raw, out);
  } catch {
    removeStalePdf(out);
    return exportFailure(file, sha);
  } finally {
    rmSync(raw, { force: true });
  }
}

function readSheet(source: string, file: string): Buffer {
  try {
    return readFileSync(source);
  } catch {
    throw new DrawioInputError(file + ': лист не читается');
  }
}

/** How many pages the sheet itself declares: the export must produce exactly that many. */
function diagramPageCount(bytes: Buffer, file: string): number {
  try {
    return parseDrawio(bytes.toString('utf8')).pages.length;
  } catch {
    throw new DrawioInputError(file + ': лист не читается');
  }
}

function writeReport(dir: string, report: PdfReport): string {
  const out = pdfDir(dir);
  mkdirSync(out, { recursive: true });
  writeFileSync(pdfReportPath(dir), JSON.stringify(report, null, 1) + '\n');
  return out;
}

const furtherBy = (worst: ReportStatus, dir: string, files: PdfReport['files'] = []): string[] => {
  // A page without text is the sheet's own fault: name it instead of sending to the installer.
  const noText = worst === 'UNVERIFIED' ? noTextStep(files) : null;
  if (noText !== null) return [noText];
  if (worst === 'PASS') return ['Дальше: ' + nodeCommand(CLI_PATH, 'pack', dir)];
  if (worst === 'FAIL') {
    return [
      'Поправь листы по подсказкам check, затем снова пропусти папку через pdf.',
      'Дальше: ' + nodeCommand(CLI_PATH, 'check', dir),
    ];
  }
  return [
    'Человеку: PDF не проверен - установи draw.io Desktop (или задай SD_DRAWIO) и прогони pdf снова; затем прогони pack.',
  ];
};

/** The status of a run with several parts: FAIL beats UNVERIFIED beats NOT_CHECKED. */
export function worstStatus(statuses: readonly ReportStatus[]): ReportStatus {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNVERIFIED')) return 'UNVERIFIED';
  if (statuses.includes('NOT_CHECKED')) return 'NOT_CHECKED';
  return 'PASS';
}

const exitCodeOf: Readonly<Record<ReportStatus, number>> = { PASS: 0, FAIL: 1, NOT_CHECKED: 2, UNVERIFIED: 2 };

export interface PdfResult {
  code: number;
  lines: string[];
}

export interface PdfDeps {
  /** Test seam: puts a ready PDF at outPath instead of spawning draw.io Desktop. */
  exportSheet?: SheetExporter;
  env?: ExportEnv;
}

/**
 * pdf <folder>: export, fit, gate. Without draw.io nothing is exported: the run is NOT_CHECKED
 * with the install hint and a NOT_CHECKED report, never a PASS.
 */
export function runPdf(folder: string, deps: PdfDeps = {}): PdfResult {
  const dir = resolve(folder);
  const env = deps.env ?? process.env;
  if (!mupdfLoaded()) return withoutEngine(dir);
  try {
    silenceBackendDiagnostics();
    const files = listDrawio(dir, loadManifestOrNull(dir));
    const paths = fittedPdfPaths(dir, files);
    const exportSheet = deps.exportSheet === undefined ? resolvedExporter(env) : deps.exportSheet;
    if (typeof exportSheet !== 'function') return withoutDrawio(dir, env);
    return exportAll(dir, files, paths, exportSheet);
  } catch (error) {
    if (error instanceof DirectoryNameConflict) return { code: 65, lines: [error.message] };
    if (error instanceof ProfileError) return { code: 65, lines: [error.code + ': ' + error.message] };
    if (error instanceof DrawioInputError) {
      return {
        code: 65,
        lines: [
          `${error.code}: ${error.message}`,
          'Исправь названный лист и повтори проверку.',
          'Дальше: ' + nodeCommand(CLI_PATH, 'check', dir),
        ],
      };
    }
    throw error;
  }
}

function resolvedExporter(env: ExportEnv): SheetExporter | null {
  const binary = findDrawio(env);
  return binary === null ? null : desktopExporter(binary, env);
}

function withoutDrawio(dir: string, env: ExportEnv): PdfResult {
  const out = writeReport(dir, { status: 'NOT_CHECKED', files: [] });
  return {
    code: 2,
    lines: [
      ...drawioMissingLines(env),
      `Отчет: ${join(out, PDF_REPORT_NAME)}`,
      ...furtherBy('NOT_CHECKED', dir),
    ],
  };
}

/** No engine, no gate: the module loads on demand, and a skill without `npm ci` says so plainly. */
function withoutEngine(dir: string): PdfResult {
  return {
    code: 2,
    lines: [
      'NOT_CHECKED SD-P04 PDF-движок mupdf не подключен - PDF не проверен',
      mupdfInstallHint(),
      'Дальше: ' + nodeCommand(CLI_PATH, 'pdf', dir),
    ],
  };
}

function exportAll(dir: string, files: readonly string[], paths: readonly string[], exportSheet: SheetExporter): PdfResult {
  if (files.length === 0) {
    const out = writeReport(dir, { status: 'NOT_CHECKED', files: [] });
    return {
      code: 2,
      lines: [
        'NOT_CHECKED SD-P04 в папке нет листов .drawio - PDF не проверен',
        `Отчет: ${join(out, PDF_REPORT_NAME)}`,
        ...furtherBy('NOT_CHECKED', dir),
      ],
    };
  }
  mkdirSync(pdfDir(dir), { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'sd-pdf-'));
  const outcomes: FileOutcome[] = [];
  try {
    for (const [index, name] of files.entries()) {
      const source = join(dir, name);
      const file = name.normalize('NFC');
      const bytes = readSheet(source, file);
      const sheetPages = diagramPageCount(bytes, file);
      const out = paths[index] as string;
      outcomes.push(exportOne(source, file, sha256(new Uint8Array(bytes)), tmp, out, sheetPages, exportSheet));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const status = worstStatus(outcomes.map((outcome) => outcome.entry.status));
  const entries = outcomes.map((outcome) => outcome.entry);
  writeReport(dir, { status, files: entries });
  const lines = outcomes.flatMap((outcome) => outcome.lines);
  return { code: exitCodeOf[status], lines: [...lines, `ИТОГ: ${status}`, ...furtherBy(status, dir, entries)] };
}
