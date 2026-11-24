/** Blind checks over a package folder. See references/rules.md for codes and statuses. */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DrawioInputError, parseDrawio, type DrawioFile } from './drawio.ts';
import {
  DirectoryNameConflict,
  ProfileError,
  loadManifestOrNull,
  loadProfile,
  retiredOf,
  sheetOf,
  type Manifest,
  type Profile,
  listDrawio,
  resolveDirectoryName,
  rulesSheetName,
} from './profile.ts';
import { nodeCommand } from './shell.ts';
import { printFinding, printNotChecked } from './check-print.ts';
import { COPY_MARKER, underCopyMarker } from './values-guard.ts';
import { LEGEND_NOT_FOUND_KEY, buildModel, type Finding } from './checks/model.ts';
import { checkProtocols } from './checks/protocols.ts';
import { checkNumbers } from './checks/numbers.ts';
import { checkLines } from './checks/lines.ts';
import { checkText } from './checks/text.ts';
import { checkFinal } from './checks/final.ts';
import { checkSheet } from './checks/sheet.ts';
import { collectLinks, firewallReview } from './firewall-links.ts';
import { FIX_CODES, fixContext, planCell } from './fix.ts';
import { confirmWorkingFile } from './values-guard.ts';
import { checkPrint } from './checks/print.ts';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

/** The codes fix --safe really cures; the "Дальше:" line offers the command only because of these. */
export { FIX_CODES };

/**
 * What a SD-N01 finding is about, in one static word, and how to fix exactly that. Only the
 * gap carries the no-renumbering advice: a gap on a sheet that already went to the reviewer is a retired
 * number, never a reason to renumber, because the reader compares sheets by these numbers.
 */
export interface CheckResult {
  code: number;
  lines: string[];
}

export const NOT_CHECKED_LINE = 'NOT_CHECKED SD-G01 (наложения и изломы: проверь глазами)';
const G01_JSON_REASON = 'layout-not-checked';

function parsePackageFile(path: string, name: string): DrawioFile {
  try {
    return parseDrawio(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof DrawioInputError) throw new DrawioInputError(name + ': ' + error.message);
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new DrawioInputError(name + ': no such file');
    }
    throw error;
  }
}

/** Sheets to walk: the manifest order when manifest.json is there, the folder listing when not. */
function sheetFiles(files: readonly string[], manifest: Manifest | null): readonly string[] {
  if (manifest === null) return files;
  const listed = new Set(manifest.sheets.map((sheet) => sheet.file.normalize('NFC')));
  const extra = files.map(name => name.normalize('NFC')).filter(name => !listed.has(name));
  if (extra.length > 0) {
    throw new ProfileError('manifest.json: file not listed in sheets: ' + extra.join(', '));
  }
  return manifest.sheets.map((sheet) => sheet.file);
}

export const MISSING_KEY = 'missing-file';

/**
 * A sheet listed in manifest.json but not on disk. init lists «Карта сетевой фильтрации» before
 * the rules command builds it, so this is NOT_CHECKED, not FAIL; but it is never silent, because
 * the same line also catches a typo in a sheet name. pack treats it as a hard SD-K01.
 */
const missingFile = (file: string, rulesFile: string): Finding => ({
  code: 'SD-K01',
  file,
  page: '-',
  ids: [],
  count: 1,
  status: 'NOT_CHECKED',
  reasonKey: MISSING_KEY,
  reason: file === rulesFile ? 'файла нет: лист правил строит команда rules' : 'файла нет',
});

function checkFolder(
  dir: string,
  profile: Profile,
  isFinal: boolean,
  manifest: Manifest | null,
  legacy: boolean,
) {
  let canFix = false;
  let hasL3 = false;
  const links = new Map<string, number>();
  const unreadableLevels = new Set<string>();
  const findings: Finding[] = [];
  const files = listDrawio(dir, manifest);
  const rulesFile = resolveDirectoryName(files, rulesSheetName(manifest));
  for (const name of sheetFiles(files, manifest)) {
    const file = resolveDirectoryName(files, name);
    const path = join(dir, file);
    if (!existsSync(path)) {
      findings.push(missingFile(file, rulesFile));
      continue;
    }
    const sheet = manifest === null ? undefined : sheetOf(manifest, name);
    const drawio = parsePackageFile(path, file.normalize('NFC'));
    for (const page of drawio.pages) {
      const model = buildModel(file, page, profile, retiredOf(sheet, page.name), isFinal);
      model.titlePrefix = manifest?.titlePrefix ?? '';
      model.hasManifest = manifest !== null;
      model.legacySubmission = legacy;
      const level = sheet?.level ?? page.name;
      if (/^L3(?:-\d+)?$/u.test(level)) {
        hasL3 = true;
        collectLinks(links, unreadableLevels, level, model);
        findings.push(...checkProtocols(model, page));
      }
      if (!isFinal && !canFix) {
        const visible = new Map(model.allCells.map(cell => [cell.id, cell]));
        const values = confirmWorkingFile(path).allowed;
        const fix = fixContext(profile);
        canFix = page.cells.some(cell => visible.has(cell.id) &&
          planCell(cell, fix, visible.get(cell.id)?.inLegend, values) !== undefined);
      }
      findings.push(
        ...checkNumbers(model),
        ...checkLines(model),
        ...checkText(model),
        ...checkFinal(model),
        ...checkSheet(model),
        ...checkPrint(model, page),
      );
    }
  }
  const review = firewallReview(dir, links, unreadableLevels, hasL3, rulesFile);
  return { findings: findings.concat(review.findings), unmatched: review.unmatched, canFix, rulesFile };
}

const compareFindings = (a: Finding, b: Finding): number =>
  a.file.localeCompare(b.file) || a.page.localeCompare(b.page) || a.code.localeCompare(b.code);

function summary(findings: Finding[]): string[] {
  const totals = new Map<string, number>();
  for (const found of findings) totals.set(found.code, (totals.get(found.code) ?? 0) + found.count);
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, total]) => code + ': ' + total);
}

/**
 * The tail of every check run: notes on their own lines, then a single `Дальше:` line holding
 * exactly one command - no `# пояснение`, no ` ; ` chain, so the line runs in any shell exactly
 * as printed. FAILs come first, then the missing-legend advice, then the plain steps.
 */
function furtherLines(
  fails: Finding[],
  skipped: Finding[],
  dir: string,
  workingCopy: boolean,
  retired: boolean,
  hasManifest: boolean,
  canFix: boolean,
  rulesFile: string,
): string[] {
  const check = nodeCommand(CLI_PATH, 'check', dir);
  if (fails.length > 0) {
    if (fails.every(found => found.reasonKey === 'stale-rules-links'))
      return ['Дальше: ' + nodeCommand(CLI_PATH, 'rules', join(dir, 'poc.yaml'), '--force')];
    if (fails.every(found => found.code === 'SD-R01'))
      return workingCopy ? ['Дальше: ' + check] : ['Человеку: сверь поле link в poc.yaml копии с листом L3.'];
    // In a copy for sending no fix and no text set run: the lines above name the cells, the
    // person rewrites them in draw.io.
    if (!workingCopy) return ['Человеку: значения и разметку в копии правит человек в draw.io по строкам выше.'];
    if (canFix && fails.some((found) => (FIX_CODES as readonly string[]).includes(found.code))) {
      // A sheet with retired numbers has already been to the reviewer: the number book must not move
      // under a folder-wide fix - the resend route names each change by hand.
      if (retired)
        return [
          'Человеку: на листе есть снятые номера (retired в manifest.json): правь только по списку изменений, порядок - references/resend.md.',
        ];
      return [
        'Внимание: если пакет уже отправлялся на проверку, fix --safe не запускай, правь только по списку изменений (references/resend.md).',
        'Дальше: ' + nodeCommand(CLI_PATH, 'fix', '--safe', dir),
      ];
    }
    return ['Правь по подсказке в строках выше: text set, style set или draw.io.', 'Дальше: ' + check];
  }
  const missing = skipped.filter((found) => found.reasonKey === MISSING_KEY);
  if (missing.some((found) => found.file === rulesFile)) {
    return [
      'rules построит лист правил по poc.yaml, check перечитает пакет.',
      'Дальше: ' + nodeCommand(CLI_PATH, 'rules', join(dir, 'poc.yaml')),
    ];
  }
  if (missing.length > 0) return ['Человеку: поправь имя в manifest.json'];
  if (skipped.some((found) => found.reasonKey === LEGEND_NOT_FOUND_KEY)) {
    return [
      'Легенда на листе не найдена: номера и линии по этой проверке не исправляй; ' +
        'если пакет уже отправлялся, правь только по списку изменений, см. references/resend.md.',
      'Дальше: ' + check,
    ];
  }
  if (skipped.length > 0) {
    if (underCopyMarker(dir))
      return ['Человеку: листы под маркером копии правит человек в draw.io; manifest там не заводят.'];
    if (!hasManifest)
      return [
        'manifest.json нет, а листы в папке есть: создай manifest.json по образцу из SKILL.md ' +
          '(service, titlePrefix, sheets[]: file, level, topic, retired); для уже отправленного пакета - references/resend.md. ' +
          'init здесь не нужен: он кладет шаблоны листов.',
        'Дальше: ' + check,
      ];
    return [skipped.some(found => found.ids.some(id => id !== '-') && found.code !== 'SD-R01')
      ? 'Человеку: сверь глазами названные ячейки.'
      : 'Человеку: проверь причины NOT_CHECKED в строках выше.'];
  }
  if (!workingCopy) return ['Дальше: ' + nodeCommand(CLI_PATH, 'pdf', dir)];
  // A clean working copy is worth its sending copy: that is the folder a person fills values in.
  // When the copy already exists, the road runs through it.
  const copy = dir + '-отправка';
  if (existsSync(copy))
    return [
      'Копия для отправки уже есть: значения вписывают в нее, рабочую копию больше не меняют.',
      'Дальше: ' + nodeCommand(CLI_PATH, 'check', copy),
    ];
  return [
    'Копия для отправки: значения впишет человек в draw.io и в poc.yaml копии.',
    'Дальше: ' + nodeCommand(CLI_PATH, 'final', dir, dir + '-отправка'),
  ];
}

/** SD-E01 and SD-E02 also end with a next step: fix the named file, then repeat the check. */
function errorResult(error: unknown, dir: string): CheckResult {
  if (error instanceof DirectoryNameConflict) return { code: 65, lines: [error.message] };
  if (error instanceof ProfileError || error instanceof DrawioInputError) {
    return {
      code: 65,
      lines: [
        error.code + ': ' + error.message,
        'Исправь названный файл и повтори проверку.',
        'Дальше: ' + nodeCommand(CLI_PATH, 'check', dir),
      ],
    };
  }
  throw error;
}

export const NO_SHEETS_KEY = 'no-sheets';
const NO_SHEETS_REASON = 'в папке нет листов .drawio и нет manifest.json';
const PACKET_ROOT_KEY = 'packet-copy-root';
const MARKED_SHEET_STEP = 'Человеку: листы правит человек в draw.io в копии для отправки.';

/**
 * A folder without a single sheet is not a package yet: NOT_CHECKED, exit 2, never a clean run.
 * The root of a sending packet is a different animal: its sheets ride under схемы/, its values
 * are a person's pen, and neither the manifest recipe nor the схемы/ folder is a way for the
 * agent to fix anything there - the text branch points at the person in draw.io, the
 * json branch reports the packet root as a structured notChecked with its reason and path.
 */
function emptyFolderResult(dir: string, json: boolean): CheckResult {
  if (json)
    return {
      code: 2,
      lines: [
        JSON.stringify({
          findings: [],
          warnings: [],
          notChecked: [
            {
              code: '-',
              file: dir,
              page: '-',
              status: 'NOT_CHECKED',
              reason: existsSync(join(dir, COPY_MARKER)) ? PACKET_ROOT_KEY : NO_SHEETS_KEY,
            },
            { code: 'SD-G01', status: 'NOT_CHECKED', reason: G01_JSON_REASON },
          ],
        }),
      ],
    };
  if (underCopyMarker(dir))
    return { code: 2, lines: ['NOT_CHECKED ' + NO_SHEETS_REASON + ': ' + dir, MARKED_SHEET_STEP] };
  return {
    code: 2,
    lines: [
      'NOT_CHECKED ' + NO_SHEETS_REASON + ': ' + dir,
      'init создаст пакет из шаблонов: четыре листа, manifest.json и poc.yaml. Если путь неверный, проверь его.',
      'Дальше: ' + nodeCommand(CLI_PATH, 'init', dir),
    ],
  };
}

/** True when any manifest sheet already carries retired numbers: the sheet has been to the reviewer. */
function manifestHasRetired(manifest: Manifest | null): boolean {
  return (
    manifest !== null &&
    manifest.sheets.some((sheet) =>
      Object.values(sheet.retired ?? {}).some((numbers) => Array.isArray(numbers) && numbers.length > 0),
    )
  );
}

/** Runs every ported check over the package; --json returns the same content without texts. */
export function runCheck(folder: string, json: boolean, submitted = false): CheckResult {
  const dir = resolve(folder);
  try {
    if (!existsSync(join(dir, 'manifest.json')) && (existsSync(dir) ? listDrawio(dir).length === 0 : true))
      return emptyFolderResult(dir, json);
    const profile = loadProfile();
    // A copy for sending is the only folder where an address is legal and a stub is not. The
    // packet pack built from such a copy is one too: pack left the copy marker, and a folder
    // under that marker reads as a copy for sending.
    const manifest = loadManifestOrNull(dir);
    const marked = underCopyMarker(dir);
    const legacy = submitted && manifest === null && !marked;
    const isFinal = legacy || manifest?.final === true || marked;
    const workingCopy = !isFinal;
    const review = checkFolder(dir, profile, isFinal, manifest, legacy);
    const all = review.findings.sort(compareFindings);
    const fails = all.filter((found) => found.status === 'FAIL');
    const warnings = all.filter((found) => found.status === 'WARN');
    const skipped = all.filter((found) => found.status === 'NOT_CHECKED');
    const code = fails.length > 0 ? 1 : skipped.length > 0 ? 2 : 0;
    if (json) {
      const body = {
        unreferencedLinks: review.unmatched,
        warnings: warnings.map(({ code, file, page, ids, status, reason }) => ({ code, file, page, ids, status, reason })),
        findings: fails.map((found) => ({
          code: found.code,
          file: found.file,
          page: found.page,
          ids: found.ids.filter((id) => id !== '-'),
          ...(found.reasonKey ? { reason: found.reasonKey } : {}),
        })),
        notChecked: [
          ...skipped.map((found) => ({
            code: found.code,
            file: found.file,
            page: found.page,
            status: found.status,
            reason: found.reasonKey,
            ...(found.ids.length ? { ids: found.ids } : {}),
          })),
          { code: 'SD-G01', status: 'NOT_CHECKED', reason: G01_JSON_REASON },
        ],
      };
      return { code, lines: [JSON.stringify(body)] };
    }
    let further: string[];
    if (legacy) {
      further = ['Человеку: сверь открытые поля с письмом, номера с предыдущей отправкой и кегль по переданному PDF.'];
    } else if (isFinal && manifest?.final === false) {
      further = [MARKED_SHEET_STEP];
    } else {
      further = furtherLines(fails, skipped, dir, workingCopy, manifestHasRetired(manifest), manifest !== null, review.canFix, review.rulesFile);
    }
    return {
      code,
      lines: [
        ...fails.flatMap((found) => printFinding(found, isFinal, review.canFix, review.rulesFile).split('\n')),
        ...warnings.map((found) => printFinding(found, isFinal, review.canFix, review.rulesFile)),
        ...skipped.map(printNotChecked),
        ...summary(fails),
        NOT_CHECKED_LINE,
        ...further,
      ],
    };
  } catch (error) {
    return errorResult(error, dir);
  }
}
