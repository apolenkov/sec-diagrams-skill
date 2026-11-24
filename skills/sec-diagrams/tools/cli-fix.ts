/**
 * `fix --safe <folder>` as a command, split out of cli.ts (the size cap): plan every sheet of
 * the folder first, write only when the whole plan exists, and hand the already-written sheets
 * back when a write fails. The planning itself lives in fix.ts.
 */
import { lstatSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DrawioInputError, parseDrawio, type DrawioFile } from './drawio.ts';
import { FIX_CODES } from './check.ts';
import { listDrawio, loadManifestOrNull, ProfileError, DirectoryNameConflict } from './profile.ts';
import { fixContext, fixFile } from './fix.ts';
import { confirmWorkingFile, confirmWorkingFolder } from './values-guard.ts';
import { defaultTmpName, writeSheet } from './write.ts';
import { writeEdited } from './write-edited.ts';
import { type CliResult, furtherLine, wrongKind } from './cli-common.ts';

/** A sheet the folder commands read: a SD-E01 message that names the file, not the raw path. */
export function parsePackageFile(path: string, name: string): DrawioFile {
  try {
    return parseDrawio(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof DrawioInputError) throw new DrawioInputError(name + ': ' + error.message);
    throw error;
  }
}

function restoreLink(path: string, target: string): void {
  const tmp = defaultTmpName(path);
  symlinkSync(target, tmp);
  try {
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

export function commandFix(folder: string): CliResult {
  const kindError = wrongKind(folder, 'folder');
  if (kindError !== null) return kindError;
  const dir = resolve(folder);
  // Text is rewritten only in a confirmed working copy: a copy for sending, a
  // folder without a manifest and a folder whose manifest cannot be trusted get style fixes
  // only, and the text cells are reported to the person instead.
  const values = confirmWorkingFolder(dir).allowed;
  const fix = fixContext();
  let manifest = null;
  try {
    manifest = loadManifestOrNull(dir);
  } catch (error) {
    if (!(error instanceof ProfileError)) throw error;
  }
  let names: string[];
  try {
    names = listDrawio(dir, manifest);
  } catch (error) {
    if (error instanceof DirectoryNameConflict) return { code: 65, lines: [error.message] };
    throw error;
  }
  // Plan the whole folder first: one unreadable sheet stops the run before the first byte is
  // written, so a package is never half-fixed.
  const plans = names.map((name) => {
    const path = join(dir, name);
    const link = lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
    const drawio = parsePackageFile(path, name);
    const allowValues = values && (link === undefined || confirmWorkingFile(path).allowed);
    return { name, path, link, before: drawio.text, edit: fixFile(drawio, fix, allowValues) };
  });
  const lines: string[] = [];
  const written: typeof plans = [];
  try {
    for (const plan of plans) {
      if (plan.edit.text !== plan.before) {
        writeEdited(plan.path, plan.edit.text);
        written.push(plan);
      }
      const counters = FIX_CODES.map((code) => code + '=' + String(plan.edit.counts.get(code) ?? 0)).join(' ');
      lines.push(plan.name + ': ' + counters);
      for (const cellId of plan.edit.manual) {
        lines.push('SD-T01 ' + plan.name + ' id=' + cellId + ' - текст правит человек в draw.io');
      }
    }
  } catch (error) {
    // The message "the skill changed nothing" must stay true: hand back every
    // sheet already replaced; if a rollback itself fails, say exactly what is left written.
    const left: string[] = [];
    for (const done of written.reverse()) {
      try {
        if (done.link === undefined) writeSheet(done.path, done.before);
        else restoreLink(done.path, done.link);
      } catch {
        left.push(done.path);
      }
    }
    if (left.length > 0) {
      return {
        code: 65,
        lines: [
          'SD-E01: запись не удалась, а вернуть не удалось: ' + left.join(', '),
          'Верни эти файлы из своей копии и повтори вызов.',
          'Человеку: верни перечисленные файлы руками.',
        ],
      };
    }
    throw error;
  }
  return { code: 0, lines: [...lines, furtherLine(dir)] };
}
