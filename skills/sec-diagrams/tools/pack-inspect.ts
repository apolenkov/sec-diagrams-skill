/**
 * The look before the build (pack.ts, steps 1-5): manifest names against the folder, check
 * without reprinting, the pdf report against the sheets, the letter, and the foreign files
 * that a person left in the packet. Nothing here writes into the packet; only inspectLetter
 * leaves a file - the letter skeleton. Split out of pack.ts for the file size cap.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runCheck } from './check.ts';
import { LETTER_FILE, checkLetter, letterIssueLine, letterSkeleton } from './letter.ts';
import { loadPdfReport, sha256, worstStatus, type PdfReport } from './pdf.ts';
import { isRulesSheet, packageFileName, resolveDirectoryName, type Manifest } from './profile.ts';
import { shellQuote } from './shell.ts';
import { SHEETS_DIR, MERGED_RE, VISIO_DIR, packetDirOf } from './pack-names.ts';
import { COPY_MARKER } from './values-guard.ts';
import { PacketCleanupError, validatePacketDirectories } from './pack-build.ts';
import type { PackResult } from './pack.ts';

/** Current hash of a sheet, or null when it cannot be read: a deleted sheet is stale too. */
const shaOfFile = (path: string): string | null => {
  try {
    return sha256(new Uint8Array(readFileSync(path)));
  } catch {
    return null;
  }
};

/** Step 1: every manifest sheet must be on disk, every sheet file must be in the manifest. */
export function namingProblems(dir: string, manifest: Manifest, files: readonly string[], optionalRules = false): string[] {
  const lines: string[] = [];
  for (const sheet of manifest.sheets) {
    if (optionalRules && isRulesSheet(sheet)) continue;
    if (!existsSync(join(dir, resolveDirectoryName(files, sheet.file)))) {
      lines.push('FAIL SD-K01 ' + sheet.file.normalize('NFC') + ' - файла нет в папке пакета');
    }
  }
  const listed = new Set(manifest.sheets.map((sheet) => sheet.file.normalize('NFC')));
  for (const name of files.map(name => name.normalize('NFC'))) {
    if (!listed.has(name)) lines.push('FAIL SD-K01 ' + name + ' - файла нет в manifest.json');
  }
  return lines;
}

interface CheckSkip {
  code: string;
  file: string;
  page: string;
  /** Machine-readable reason key, as in check --json. */
  reason: string;
  ids: string[];
}

export interface CheckStage {
  code: number;
  fails: string[];
  warnings: string[];
  skips: CheckSkip[];
  unreferencedLinks: string[];
}

interface SkipEntry {
  code: string;
  file?: string;
  page?: string;
  reason?: string;
  ids?: string[];
}

const isOnPage = (entry: SkipEntry): entry is SkipEntry & { file: string; page: string } =>
  typeof entry.file === 'string' && typeof entry.page === 'string';

/** Run check without reprinting it: FAIL stops pack, NOT_CHECKED joins the checklist. */
export function inspectCheck(dir: string): CheckStage | PackResult {
  const result = runCheck(dir, true);
  if (result.code >= 64) return { code: result.code, lines: result.lines };
  try {
    const body = JSON.parse(result.lines[0] ?? '') as {
      findings: Array<{ code: string; file: string; page: string; ids: string[] }>;
      warnings: Array<{ code: string; file: string; page: string; ids: string[]; reason: string }>;
      notChecked: SkipEntry[];
      unreferencedLinks: string[];
    };
    const fails = body.findings.map(
      (f) => 'FAIL ' + f.code + ' ' + f.file.normalize('NFC') + ' "' + f.page + '"' + (f.ids.length > 0 ? ' id=' + f.ids.join(' ') : ''),
    );
    const skips = body.notChecked.filter(isOnPage).map((entry) => ({
      code: entry.code,
      file: entry.file.normalize('NFC'),
      page: entry.page,
      reason: entry.reason ?? '',
      ids: entry.ids ?? [],
    }));
    const warnings = body.warnings.map(w =>
      `WARN ${w.code} ${w.file.normalize('NFC')} "${w.page}" id=${w.ids.join(',') || '-'} - ${w.reason}`);
    return { code: result.code, fails, warnings, skips, unreferencedLinks: body.unreferencedLinks ?? [] };
  } catch {
    return { code: 65, lines: ['check: отчет не читается'] };
  }
}

/**
 * The report must exist and carry the current sha256 of every manifest sheet under the
 * sheet's NFC name. A report that misses a sheet - the NOT_CHECKED stub of a run without draw.io
 * included - is not a basis for a packet either: pack verifies all sheets before the first byte
 * lands in the packet. Names are compared normalized: the manifest, the report and
 * the file system may hand the same name in different bytes.
 */
export function inspectReport(
  dir: string,
  manifest: Manifest,
  files: readonly string[],
): { report: PdfReport } | { problems: string[] } {
  const report = loadPdfReport(dir);
  if (report === null) return { problems: ['pdf-report.json: нет или не читается'] };
  const problems: string[] = [];
  const entries = new Map(report.files.map((entry) => [entry.file.normalize('NFC'), entry.sha256]));
  for (const sheet of manifest.sheets) {
    const name = sheet.file.normalize('NFC');
    const sha = entries.get(name);
    if (sha === undefined) problems.push('PDF не строен по листу: ' + name);
    else if (shaOfFile(join(dir, resolveDirectoryName(files, sheet.file))) !== sha) {
      problems.push('PDF устарел: ' + name + ' изменен после pdf');
    }
  }
  const listed = new Set(manifest.sheets.map(sheet => sheet.file.normalize('NFC')));
  const included = report.files.filter(file => listed.has(file.file.normalize('NFC')))
    .map(file => ({ ...file, file: file.file.normalize('NFC') }));
  return problems.length > 0
    ? { problems }
    : { report: { files: included, status: worstStatus(included.map(file => file.status)) } };
}

/** Return a blocking result for a missing or unfinished cover note. */
export function inspectLetter(dir: string, masks: readonly string[], nextStep: string): PackResult | null {
  const path = join(dir, LETTER_FILE);
  if (!existsSync(path)) {
    writeFileSync(path, letterSkeleton());
    return {
      code: 1,
      lines: [
        'TODO записка.txt: каркас создан, заполни по references/letter.md',
        nextStep,
      ],
    };
  }
  const issues = checkLetter(readFileSync(path, 'utf8'), masks);
  if (issues.length > 0) {
    return {
      code: 1,
      lines: [
        ...issues.map(letterIssueLine),
        'Исправь записка.txt по references/letter.md: код называет правило, номер - строку.',
        nextStep,
      ],
    };
  }
  return null;
}

function isAllowedVisioFolder(packDir: string, name: string): boolean {
  if (name !== VISIO_DIR) return false;
  try {
    return readdirSync(join(packDir, name), { withFileTypes: true }).every(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.vsdx'),
    );
  } catch {
    return false;
  }
}

/** What a person left in the packet folder that no run of pack would put there. */
export function packetForeignNames(dir: string, manifest: Manifest, mergedName: string, allowLetter: boolean): string[] {
  const packDir = packetDirOf(dir);
  if (!validatePacketDirectories(dir)) return [];
  const expected = new Set([mergedName, SHEETS_DIR, COPY_MARKER]);
  if (allowLetter) expected.add(LETTER_FILE);
  const sheets = new Set(manifest.sheets.map((sheet) => packageFileName(sheet)));
  const foreign: string[] = [];
  let entries;
  try {
    entries = readdirSync(packDir, { withFileTypes: true });
  } catch (error) {
    throw new PacketCleanupError('Не удалось прочитать каталог ' + packDir, { cause: error });
  }
  for (const entry of entries) {
    if (entry.name === SHEETS_DIR ? entry.isDirectory() : entry.isFile() && expected.has(entry.name)) continue;
    // A merge of another composition is pack's own earlier output, whatever sheet count it
    // carries: the rebuild below drops the old folder whole, the person's files are the risk.
    if (entry.isFile() && MERGED_RE.test(entry.name)) continue;
    if (entry.isDirectory() && isAllowedVisioFolder(packDir, entry.name)) continue;
    foreign.push(entry.name);
  }
  const sheetDir = join(packDir, SHEETS_DIR);
  if (existsSync(sheetDir)) {
    let sheetEntries;
    try {
      sheetEntries = readdirSync(sheetDir, { withFileTypes: true });
    } catch (error) {
      throw new PacketCleanupError('Не удалось прочитать каталог ' + sheetDir, { cause: error });
    }
    for (const entry of sheetEntries) {
      // Sheets under схемы/ are pack's output by construction - this manifest's, or the older
      // build's names the saved list may not have: nothing of a person lives there,
      // the packet folder is rebuilt whole. Anything that is not a .drawio is foreign.
      if (entry.isFile() && entry.name.endsWith('.drawio')) continue;
      if (entry.isFile() && sheets.has(entry.name.normalize('NFC'))) continue;
      foreign.push(SHEETS_DIR + '/' + entry.name);
    }
  }
  return foreign;
}

export function foreignStop(dir: string, foreign: string[], nextStep: string): PackResult {
  return {
    code: 1,
    lines: [
      ...foreign.map((name) => 'FAIL SD-K02 ' + name + ' - чужой файл в каталоге пакета'),
      'Убери лишнее из каталога пакета: навык ничего не удаляет. Лишние файлы: ' + shellQuote(packetDirOf(dir)) + '.',
      nextStep,
    ],
  };
}
