/**
 * final <folder> <copy>: the second kind of package copy, the one that goes to the reviewer.
 *
 * The working copy (the folder init built) holds no real addresses or host names on purpose:
 * the agent reads it, there is nothing real in it to leak. A copy for sending carries the real
 * values, and only a person writes them - in draw.io and in the copy's poc.yaml - because a
 * colleague may run the skill on an outside model, and the copy's values must never reach it.
 * This command copies the top level .drawio sheets, manifest.json and poc.yaml into a new
 * folder and puts "final": true in the copy's manifest; from then on text get and text set
 * refuse the copy's files, and the agent's work there is limited to check, pdf, pack, fix --safe
 * and style set - none of which prints a value. check on the copy allows a complete address and
 * reports every stub that stayed (SD-T08). Nothing is written into the working copy.
 *
 * The same file also runs `open [--undo] <file> <id>...`: the sdRole=open mark on a cell, the form
 * in which a not-yet-known value is declared (references/letter.md, step 5). The mark lives in
 * the cell's own style, so it survives a rebuild of the rules page and never names a value.
 *
 * Exit: 0 done, 64 a bad call, a copy that already exists or an id that is not on a sheet,
 * 65 manifest.json is missing, unreadable or already carries "final": true.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { DrawioInputError, parseDrawio, setCellStyle, setStyleKey, styleValue } from './drawio.ts';
import { DirectoryNameConflict, ProfileError, listDrawio, loadManifest } from './profile.ts';
import { COPY_MARKER } from './values-guard.ts';
import { runCheck } from './check.ts';
import { nodeCommand } from './shell.ts';
import { writeSheet } from './write.ts';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

/** The two files of the package that are not sheets; poc.yaml travels when the folder has one. */

export interface FinalResult {
  code: number;
  lines: string[];
}

const refused = (message: string): FinalResult => ({ code: 64, lines: [message] });

const broken = (error: ProfileError): FinalResult => ({
  code: 65,
  lines: [error.code + ': ' + error.message, 'Человеку: почини manifest.json рабочей папки и повтори вызов.'],
});

/** The manifest of the copy: every byte of the working one, plus the mark that turns check round. */
function finalManifest(text: string): string {
  const manifest = JSON.parse(text) as Record<string, unknown>;
  return JSON.stringify({ ...manifest, final: true }, null, 2) + '\n';
}

/**
 * Copies the package into a folder that does not exist yet. A refusal writes nothing at all:
 * the copy is either whole or absent, because a half-made folder reads as a package. The parts
 * go into a temporary folder next to the target and the folder is renamed only when the last
 * byte - the manifest - is written, so a failure in the middle leaves no half-folder that the
 * next call would refuse as "the copy already exists". A copy inside
 * its own source is a bad call.
 */
export function runFinal(source: string, target: string): FinalResult {
  const from = resolve(source);
  const to = resolve(target);
  if (existsSync(to))
    return {
      code: 64,
      lines: ['копия для отправки уже существует: ' + target, 'Дальше: ' + nodeCommand(CLI_PATH, 'check', to)],
    };
  if (from === to) return refused('копия для отправки не может быть рабочей копией: ' + target);
  if (to.startsWith(from + sep)) return refused('копия для отправки не может лежать внутри рабочей копии: ' + target);
  try {
    const manifest = loadManifest(from);
    if (manifest.final === true)
      return {
        code: 65,
        lines: [
          'SD-E02: manifest.json: final: true, копия уже создана',
          'Дальше: ' + nodeCommand(CLI_PATH, 'check', from),
        ],
      };
    const checked = runCheck(from, true);
    if (checked.code === 1 || checked.code >= 64)
      return { code: checked.code, lines: ['Копия не создана: проверь исходные листы.', 'Дальше: ' + nodeCommand(CLI_PATH, 'check', from)] };
    const tmp = mkdtempSync(join(dirname(to), basename(to) + '.final-'));
    try {
      // The marker goes first: a half-built folder under it already reads as a copy for
      // sending, so its copied sheets hold their values closed even if this run dies later.
      writeFileSync(join(tmp, COPY_MARKER), '');
      for (const name of listDrawio(from, manifest)) copyFileSync(join(from, name), join(tmp, name));
      const yaml = join(from, 'poc.yaml');
      if (lstatSync(yaml, { throwIfNoEntry: false })?.isFile()) copyFileSync(yaml, join(tmp, 'poc.yaml'));
      writeFileSync(join(tmp, 'manifest.json'), finalManifest(readFileSync(join(from, 'manifest.json'), 'utf8')));
      renameSync(tmp, to);
    } catch (error) {
      rmSync(tmp, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    if (error instanceof DirectoryNameConflict) return { code: 65, lines: [error.message] };
    if (error instanceof ProfileError) return broken(error);
    throw error;
  }
  // One "Дальше:" - the executable next command; the person's pen gets its own label.
  const lines = ['OK ' + to, 'Человеку: значения вписывает человек в draw.io и в poc.yaml новой папки.'];
  lines.push(
    existsSync(join(to, 'poc.yaml'))
      ? 'Дальше: ' + nodeCommand(CLI_PATH, 'rules', join(to, 'poc.yaml'), '--force')
      : 'Дальше: ' + nodeCommand(CLI_PATH, 'check', to),
  );
  return { code: 0, lines };
}

/** The style without the open mark; only the pair sdRole=open is dropped, every other key stays. */
const withoutOpenMark = (style: string): string =>
  style
    .split(';')
    .filter((segment) => segment !== 'sdRole=open')
    .join(';');

/** Marks a cell cannot take: the legend frame and the page title are structure, not values. */
const STRUCTURAL_MARKS = new Set(['legend', 'title']);

/**
 * open [--undo] <file> <id>...: put the sdRole=open mark on (or take it off) whole cells, one style
 * key each. An id that is not on a sheet stops the call with 64 and nothing is written; so does a
 * structural cell. The command prints ids and file names only - values of a sending copy stay
 * unseen - and works on either kind of copy, because marking is not filling in.
 */
export function runOpen(file: string, ids: string[], undo: boolean, page?: string): FinalResult {
  const path = resolve(file);
  if (ids.length === 0) return refused('open takes [--undo] [--page <лист>] <файл> <id>...');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { code: 65, lines: ['SD-E01: файла нет: ' + path] };
  }
  let drawio;
  try {
    drawio = parseDrawio(text);
  } catch (error) {
    if (error instanceof DrawioInputError)
      return { code: 65, lines: [error.code + ': ' + file + ': ' + error.message] };
    throw error;
  }
  // With --page an id reads only on that page; without it an id standing on two pages is a
  // refusal, not a guess at the first one.
  const pagesOf = (id: string): number => drawio.pages.filter((pg) => pg.cells.some((cell) => cell.id === id)).length;
  const missing = ids.filter((id) => pagesOf(id) === 0);
  if (missing.length > 0) return refused('в ' + path + ' нет ячеек: ' + missing.join(', '));
  if (page === undefined) {
    const doubled = [...new Set(ids)].filter((id) => pagesOf(id) > 1);
    if (doubled.length > 0)
      return refused('id ' + doubled.join(', ') + ' стоит на нескольких страницах: уточни --page <лист>');
  } else {
    const off = [...new Set(ids)].filter(
      (id) => !drawio.pages.some((pg) => pg.name === page && pg.cells.some((cell) => cell.id === id)),
    );
    if (off.length > 0) return refused('на странице "' + page + '" нет ячеек: ' + off.join(', '));
  }
  // The pair (page, id) names a cell: the role check and the write read the same page.
  const pageOfCell = (current: typeof drawio, id: string): number =>
    current.pages.findIndex(
      (pg) => (page === undefined || pg.name === page) && pg.cells.some((cell) => cell.id === id),
    );
  for (const id of new Set(ids)) {
    const cell = drawio.pages[pageOfCell(drawio, id)]?.cells.find((candidate) => candidate.id === id);
    const mark = cell === undefined ? '' : (styleValue(cell.style, 'sdRole') ?? '');
    if (STRUCTURAL_MARKS.has(mark)) {
      return refused('ячейка ' + id + ' несет отметку ' + mark + ': open ставится на ячейку значения');
    }
  }
  for (const id of new Set(ids)) {
    const current = parseDrawio(text);
    const pageIndex = pageOfCell(current, id);
    const cell = current.pages[pageIndex]?.cells.find((candidate) => candidate.id === id);
    if (cell === undefined) return { code: 65, lines: ['SD-E01: лист изменился между проверками: ' + path] };
    const style = undo ? withoutOpenMark(cell.style) : setStyleKey(cell.style, 'sdRole', 'open');
    text = setCellStyle(current, pageIndex, id, style);
  }
  writeSheet(path, text);
  const verb = undo ? 'снято' : 'открыто';
  return {
    code: 0,
    lines: ['OK ' + path + ': ' + verb + ' ячеек ' + new Set(ids).size + ' (' + [...new Set(ids)].join(', ') + ')'],
  };
}
