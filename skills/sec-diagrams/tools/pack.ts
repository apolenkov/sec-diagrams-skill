/**
 * Assemble the merged PDF, editable diagrams and optional cover note in a sibling packet directory.
 * The PDF report must match the current diagram bytes before any sheet can be copied.
 */
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { DrawioInputError } from './drawio.ts';
import { mupdfInstallHint, mupdfLoaded, silenceBackendDiagnostics } from './pdf-gate.ts';
import { fittedPdfPaths, pdfDir, worstStatus, type PdfReport, type ReportStatus } from './pdf.ts';
import { DirectoryNameConflict, ProfileError, isRulesSheet, listDrawio, loadManifest, loadProfile, packageFileName, type Manifest } from './profile.ts';
import { writeChecklist, type PacketPdf } from './pack-checklist.ts';

import { nodeCommand } from './shell.ts';
import { mergedPdfName, packetDirOf } from './pack-names.ts';
import {
  foreignStop,
  inspectCheck,
  inspectLetter,
  inspectReport,
  namingProblems,
  packetForeignNames,
  type CheckStage,
} from './pack-inspect.ts';
import { copyIntoBuild, dropPacketParts, loadBuildList, moveVisio, PacketCleanupError, saveBuildList, validatePacketDirectories } from './pack-build.ts';
import { fitToPacket } from './pack-fit.ts';
import { LETTER_FILE } from './letter.ts';
import { COPY_MARKER } from './values-guard.ts';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');
export { mergedPdfName, packetDirOf } from './pack-names.ts';

export interface PackResult {
  code: number;
  lines: string[];
}

export interface PackDeps {
  withLetter?: boolean;
  withRules?: boolean;
  /** Test seam: the moment right before one sheet is read for the copy. */
  beforeSheetCopy?: (fileName: string) => void;
}

function packCommand(dir: string, { withLetter, withRules }: PackDeps): string {
  return nodeCommand(CLI_PATH, 'pack', dir, ...(withLetter ? ['--with-letter'] : []), ...(withRules ? ['--with-rules'] : []));
}

function stepsBeforePack(dir: string, deps: PackDeps, command: 'check' | 'pdf' | 'init'): string[] {
  return [
    ...(deps.withLetter || deps.withRules ? ['После ' + command + ' повтори ' + packCommand(dir, deps)] : []),
    'Дальше: ' + nodeCommand(CLI_PATH, command, dir),
  ];
}

function runPackInner(dir: string, deps: PackDeps, source: Manifest, files: readonly string[]): PackResult {
  silenceBackendDiagnostics();
  const nextPack = 'Дальше: ' + packCommand(dir, deps);
  const withLetter = deps.withLetter ?? false;
  const manifest = deps.withRules ? source : {
    ...source, sheets: source.sheets.filter(sheet => !isRulesSheet(sheet)),
  };
  if (!manifest.sheets.length || (deps.withRules && !source.sheets.some(isRulesSheet)))
    return { code: 1, lines: ['FAIL SD-K01: проверь состав листов в manifest.json', ...stepsBeforePack(dir, deps, 'check')] };
  validatePacketDirectories(dir);
  const previous = loadBuildList(dir);
  const fittedPaths = fittedPdfPaths(dir, manifest.sheets.map(sheet => sheet.file));
  const naming = namingProblems(dir, source, files, !deps.withRules);
  if (naming.length > 0) {
    return {
      code: 1,
      lines: [
        ...naming,
        'Поправь manifest.json и файлы листов по строкам выше.',
        nextPack,
      ],
    };
  }
  const checked = inspectCheck(dir);
  if ('lines' in checked) return checked;
  if (checked.fails.length > 0)
    return { code: 1, lines: [...checked.fails, ...checked.warnings, ...stepsBeforePack(dir, deps, 'check')] };
  const staged = inspectReport(dir, manifest, files);
  const mergedName = mergedPdfName(manifest.service, manifest.sheets.length);
  if ('problems' in staged) {
    // Nothing of this run was written; give back what an older run left, but keep the letter.
    dropPacketParts(dir, manifest);
    return {
      code: 2,
      lines: [
        ...staged.problems,
        'Пакет не собран, прежняя склейка и старые копии листов удалены: прогони pdf, затем снова pack.',
        ...stepsBeforePack(dir, deps, 'pdf'),
      ],
    };
  }
  const packDir = packetDirOf(dir);
  const foreign = packetForeignNames(dir, manifest, mergedName, withLetter || previous?.withLetter === true);
  if (foreign.length > 0) return foreignStop(dir, foreign, nextPack);
  if (withLetter) {
    const letter = inspectLetter(dir, loadProfile().masks, nextPack);
    if (letter !== null) return letter;
  }
  // The new assembly is built in a temp folder next to the packet and renamed over it whole:
  // a failure on any step leaves either the old packet or the new one, never half of either.
  // The copy marker goes in first, so even a half-built temp folder reads as a sending copy.
  const build = mkdtempSync(join(dirname(packDir), basename(packDir) + '.build-'));
  try {
    if (manifest.final === true) writeFileSync(join(build, COPY_MARKER), '');
    const packet = fitToPacket(manifest, staged.report, fittedPaths, build);
    if (packet.path === null) {
      rmSync(build, { recursive: true, force: true });
      dropPacketParts(dir, manifest);
      return {
        code: 2,
        lines: [
          packet.line,
          'Пакет не собран: Прежняя склейка и старые копии листов удалены.',
          ...stepsBeforePack(dir, deps, 'pdf'),
        ],
      };
    }
    const copied = copyIntoBuild(build, dir, manifest, files, staged.report, deps);
    validatePacketDirectories(dir);
    const latest = loadBuildList(dir);
    const changed = packetForeignNames(dir, manifest, mergedName, withLetter || latest?.withLetter === true);
    if (changed.length > 0) {
      rmSync(build, { recursive: true, force: true });
      return foreignStop(dir, changed, nextPack);
    }
    moveVisio(packDir, build);
    rmSync(packDir, { recursive: true, force: true });
    renameSync(build, packDir);
    saveBuildList(dir, {
      merged: mergedName,
      sheets: manifest.sheets.map((sheet) => packageFileName(sheet)),
      withLetter,
    });
    const whole: PacketPdf = { ...packet, path: join(packDir, mergedName) };
    const checklist = writeChecklist(dir, manifest, checked.skips, checked.warnings, staged.report, whole, {
      unreferencedLinks: checked.unreferencedLinks,
      withLetter,
    });
    return conclude(dir, deps, copied, checked, staged.report, whole, checklist);
  } catch (error) {
    // The temp build goes away whole; a Visio folder already moved into it goes back first.
    moveVisio(build, packDir);
    rmSync(build, { recursive: true, force: true });
    if (error instanceof PacketCleanupError) throw error;
    dropPacketParts(dir, manifest);
    const why = error instanceof Error ? error.message : 'сборка не удалась';
    return {
      code: 2,
      lines: [
        'Пакет не собран: ' + why,
        'Сборка шла во временной папке рядом, прежний пакет не тронут; временная удалена.',
        ...stepsBeforePack(dir, deps, 'pdf'),
      ],
    };
  }
}

function conclude(
  dir: string,
  deps: PackDeps,
  sheetCount: number,
  checked: CheckStage,
  report: PdfReport,
  packet: PacketPdf,
  checklist: string,
): PackResult {
  const statuses: ReportStatus[] = [report.status, packet.status, ...report.files.map((file) => file.status)];
  if (checked.code === 2) statuses.push('NOT_CHECKED');
  const final = worstStatus(statuses);
  const files = [...(deps.withLetter ? [LETTER_FILE] : []), packet.name];
  return {
    code: final === 'PASS' ? 0 : final === 'FAIL' ? 1 : 2,
    lines: [
      ...checked.warnings,
      ...checked.skips.map((skip) => `NOT_CHECKED ${skip.code} ${skip.file} "${skip.page}" - в чек-листе`),
      packet.line,
      `PACK ${packetDirOf(dir)}: ${sheetCount} .drawio, ${files.join(', ')}`,
      'PDF: ' + (packet.path === null ? packet.name + ' не собран' : packet.path),
      'Чек-лист: ' + checklist,
      'ИТОГ: ' + final,
      ...(final === 'FAIL'
        ? [
            'Поправь листы по замечаниям, затем снова прогони pdf и pack.',
            ...stepsBeforePack(dir, deps, 'pdf'),
          ]
        : ['Пакет отправляет только автор.', 'Человеку: пройди чек-лист глазами']),
    ],
  };
}

/**
 * pack <folder>: the stages in order, the first blocking problem wins. A SD-E01/SD-E02 from a
 * stage leaves with code 65 and the stage's own message; nothing outside the two side directories
 * is written except the letter skeleton when --with-letter is selected.
 */
export function runPack(folder: string, deps: PackDeps = {}): PackResult {
  const dir = resolve(folder);
  if (!mupdfLoaded()) {
    return {
      code: 2,
      lines: [
        'NOT_CHECKED SD-P04 PDF-движок mupdf не подключен - пакет не собран',
        mupdfInstallHint(),
        ...stepsBeforePack(dir, deps, 'pdf'),
      ],
    };
  }
  let files: string[] = [];
  try {
    if (!existsSync(join(dir, 'manifest.json')) && existsSync(dir)) files = listDrawio(dir);
    const source = loadManifest(dir);
    files = listDrawio(dir, source);
    return runPackInner(dir, deps, source, files);
  } catch (error) {
    const nextPack = 'Дальше: ' + packCommand(dir, deps);
    if (error instanceof PacketCleanupError) {
      return { code: 2, lines: ['Пакет не собран. ' + error.message, nextPack] };
    }
    if (error instanceof DirectoryNameConflict) return { code: 65, lines: [error.message] };
    if (error instanceof ProfileError || error instanceof DrawioInputError) {
      const lines = [error.code + ': ' + error.message];
      if (error instanceof ProfileError && error.message === 'manifest.json: файла нет') {
        if (files.length > 0) {
          lines.push(
            'Создай manifest.json по образцу из SKILL.md (service, titlePrefix, sheets[]: file, level, topic, retired); ' +
              'для уже отправленного пакета - references/resend.md. init здесь не нужен: он кладет шаблоны листов.',
            nextPack,
          );
        } else {
          lines.push(
            'init положит шаблоны листов, manifest.json и poc.yaml.',
            ...stepsBeforePack(dir, deps, 'init'),
          );
        }
      } else {
        lines.push('Исправь названный файл и повтори проверку.', nextPack);
      }
      return { code: 65, lines };
    }
    throw error;
  }
}
