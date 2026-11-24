/**
 * Single entry point of the sec-diagrams skill: `node cli.ts <command>`, from any directory.
 *
 * Commands: `text get <file> <id> [--page <name>]`, `text set <file> <id> <text>
 * [--page <name>]` (a `\n` in the text argument means a line break), `style set <file> <id>
 * <key>=<value> [--page <name>]` (one style key: color, fill, font, dash, arrows, width), `fix --safe <folder>`,
 * `check <folder> [--json]`, `rules <poc.yaml> [--force]`, `init <folder>`, `final <folder> <copy>`, `pdf <folder>`
 * (export through draw.io Desktop, fit A3, gate) and `pack <folder> [--with-letter] [--with-rules]`.
 * Output is blind: result codes, counts, file and page names and cell ids; a label is printed
 * only by `text get` for the one requested cell. Exit codes: 0 done, 1 check findings,
 * 2 NOT_CHECKED or UNVERIFIED, 64 bad call, 65 SD-E01 or SD-E02, 69 missing runtime dependencies.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  DrawioInputError,
  parseDrawio,
  setCellStyle,
  setCellValue,
  setStyleKey,
  type Cell,
  type DrawioFile,
  type DrawioPage,
} from './drawio.ts';
import { loadProfile, ProfileError } from './profile.ts';
import { inspectLetter } from './pack-inspect.ts';
import { runCheck } from './check.ts';
export { fixContext, planCell, type CellPlan, type FixContext } from './fix.ts';
import { runPdf } from './pdf.ts';
export { loadMupdf } from './pdf-gate.ts';
import { runPack } from './pack.ts';
import { runFinal, runOpen } from './final.ts';
import { confirmWorkingFile, maskIpv4 } from './values-guard.ts';
import { runRules } from './rules-page.ts';
import { blindMessage } from './e01-blind.ts';
import { declaredSize, minFontSizeFor } from './checks/print.ts';
import { initFolder } from './templates.ts';

import { nodeCommand } from './shell.ts';
import { CLI_PATH, HELP_STEP, USAGE, type CliResult, furtherLine, usageError, wrongKind } from './cli-common.ts';
import { writeEdited } from './write-edited.ts';
import { commandFix } from './cli-fix.ts';

export type { CliResult } from './cli-common.ts';

const isFlag = (word: string): boolean => word.startsWith('-');

const isDirectory = (path: string): boolean => {
  try {
    return statSync(resolve(path)).isDirectory();
  } catch {
    return false;
  }
};

interface TextArgs {
  file: string;
  id: string;
  value?: string;
  page?: string;
}

function parseTextArgs(args: string[]): TextArgs | null {
  const positional: string[] = [];
  let page: string | undefined;
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--page') {
      if (page !== undefined) return null;
      page = args[index + 1];
      if (page === undefined) return null;
      index += 2;
      continue;
    }
    if (arg !== undefined) positional.push(arg);
    index += 1;
  }
  if (positional.length < 2 || positional.length > 3) return null;
  const file = positional[0];
  const id = positional[1];
  if (file === undefined || id === undefined) return null;
  const value = positional[2];
  return { file, id, ...(value !== undefined ? { value } : {}), ...(page !== undefined ? { page } : {}) };
}

type Located = { page: DrawioPage; cell: Cell } | CliResult;

const isCliResult = (value: Located): value is CliResult => 'code' in value;

function locateCell(file: DrawioFile, id: string, page: string | undefined): Located {
  const matches = file.pages.filter((candidate) => candidate.cells.some((cell) => cell.id === id));
  if (matches.length === 0) return usageError(`cell id "${id}" is not present in the file`);
  const scoped = page === undefined ? matches : matches.filter((candidate) => candidate.name === page);
  if (scoped.length === 0) return usageError(`page "${page ?? ''}" does not contain cell id "${id}"`);
  if (scoped.length > 1) {
    return usageError(
      `cell id "${id}" is present on pages ${scoped.map((p) => `"${p.name}"`).join(', ')}: pass --page`,
    );
  }
  const found = scoped[0];
  const cell = found?.cells.find((candidate) => candidate.id === id);
  if (found === undefined || cell === undefined) return usageError(`cell id "${id}" is not present in the file`);
  return { page: found, cell };
}

function commandText(sub: string | undefined, args: string[]): CliResult {
  if (sub !== 'get' && sub !== 'set') return usageError('text takes get or set');
  const parsed = parseTextArgs(args);
  if (parsed === null) return usageError('expected <file> <id> and, for set, the new text');
  const newText = parsed.value;
  if (sub === 'get' && newText !== undefined) return usageError('text get takes no new text');
  if (sub === 'set' && newText === undefined) return usageError('text set needs the new text');
  const kindError = wrongKind(parsed.file, 'file');
  if (kindError !== null) return kindError;
  const path = resolve(parsed.file);
  // Values are read and written only in a confirmed working copy (realpath, a manifest that
  // passes the schema and says "final": false, no copy marker and no final manifest above):
  // a copy for sending, a bare sheet, a broken manifest are all refused before the file is
  // even parsed - «разрешено, где подтверждено».
  const verdict = confirmWorkingFile(path);
  if (!verdict.allowed) return { code: 64, lines: ['text ' + sub + ': ' + verdict.reason, verdict.hint] };
  const drawio = parseDrawio(readFileSync(path, 'utf8'));
  const located = locateCell(drawio, parsed.id, parsed.page);
  if (isCliResult(located)) return located;
  const further = furtherLine(dirname(path));
  if (sub === 'set' && newText !== undefined) {
    const value = newText.replace(/\\[\\n]/gu, (whole) => (whole === '\\n' ? '\n' : '\\'));
    writeEdited(path, setCellValue(drawio, located.page.index, parsed.id, value));
    return { code: 0, lines: [`OK ${parsed.file} ${parsed.id}`, further] };
  }
  // Even in a confirmed working copy the printout hides IPv4: the sheet keeps its
  // bytes, the console never shows a real address.
  return { code: 0, lines: [maskIpv4(located.cell.value), further] };
}

/** Style keys a hint may name; geometry, ids and everything else stay untouched. */
const EDGE_STYLE_KEYS = ['rounded', 'jumpStyle', 'jumpSize'];
const STYLE_KEYS = [
  ...EDGE_STYLE_KEYS,
  'strokeColor',
  'fillColor',
  'fontFamily',
  'fontSize',
  'dashed',
  'startArrow',
  'endArrow',
  'strokeWidth',
];
const STYLE_VALUE = /^[#A-Za-z0-9 ._-]{1,40}$/u;
const FONT_SIZE = /^(?:[89]|[1-6]\d|7[0-2])$/u;

function validStyleValue(key: string, value: string): boolean {
  switch (key) {
    case 'rounded': return value === '1';
    case 'jumpStyle': return value === 'arc';
    case 'jumpSize': return value === String(loadProfile().jumpSize);
    case 'fontSize': return FONT_SIZE.test(value);
    default: return STYLE_VALUE.test(value);
  }
}

/** `style set <file> <id> <key>=<value>`: one style key of one cell, spliced in place. */
function commandStyle(sub: string | undefined, args: string[]): CliResult {
  const usage = 'style set takes <file> <id> <key>=<value>, key one of ' + STYLE_KEYS.join(', ');
  const parsed = sub === 'set' ? parseTextArgs(args) : null;
  const pair = parsed?.value ?? '';
  const equals = pair.indexOf('=');
  const key = pair.slice(0, equals);
  const value = pair.slice(equals + 1);
  if (parsed === null || equals <= 0 || !STYLE_KEYS.includes(key) || !validStyleValue(key, value)) {
    return usageError(usage);
  }
  const kindError = wrongKind(parsed.file, 'file');
  if (kindError !== null) return kindError;
  const path = resolve(parsed.file);
  const drawio = parseDrawio(readFileSync(path, 'utf8'));
  const located = locateCell(drawio, parsed.id, parsed.page);
  if (isCliResult(located)) return located;
  if (!located.cell.edge && EDGE_STYLE_KEYS.includes(key)) return usageError(key + ' доступен только для стрелок.');
  // A size under the page floor prints below 8 pt: the paper will not carry it, so the call is
  // refused, not applied.
  if (key === 'fontSize') {
    const declared = declaredSize(located.page);
    const min = declared.width > 0 ? minFontSizeFor(declared) : 0;
    if (min > 0 && Number(value) < min) {
      return usageError(
        'fontSize=' + value + ' ниже минимума листа: минимум ' + String(min) + ' на этом листе, 8 пт на печати A3',
      );
    }
  }
  writeEdited(path, setCellStyle(drawio, located.page.index, parsed.id, setStyleKey(located.cell.style, key, value)));
  return { code: 0, lines: [`OK ${parsed.file} ${parsed.id} ${key}`, furtherLine(dirname(path))] };
}

function commandCheck(second: string | undefined, rest: string[]): CliResult {
  if (second === undefined || second.startsWith('--')) return usageError('check takes <folder> [--json] [--submitted]');
  if (new Set(rest).size !== rest.length || rest.some(flag => flag !== '--json' && flag !== '--submitted'))
    return usageError('check takes <folder> [--json] [--submitted]');
  const kindError = wrongKind(second, 'folder');
  if (kindError !== null) return kindError;
  return runCheck(second, rest.includes('--json'), rest.includes('--submitted'));
}

const PACK_FLAGS = ['--with-letter', '--with-rules'];

/** Both commands take one folder; pack can also include a cover note and the rules sheet. */
function commandFolder(name: 'pdf' | 'pack', second: string | undefined, rest: string[]): CliResult {
  const flags = name === 'pack' ? PACK_FLAGS : [];
  if (second === undefined || isFlag(second) || new Set(rest).size !== rest.length || rest.some(flag => !flags.includes(flag))) {
    return usageError(name + ' takes <folder>' + flags.map(flag => ` [${flag}]`).join(''));
  }
  const kindError = wrongKind(second, 'folder');
  if (kindError !== null) return kindError;
  return name === 'pdf' ? runPdf(second) : runPack(second, {
    withLetter: rest.includes('--with-letter'),
    withRules: rest.includes('--with-rules'),
  });
}

/** rules <poc.yaml> [--force]: one YAML, the flag on either side of it. */
function commandRules(second: string | undefined, rest: string[]): CliResult {
  const given = [second, ...rest];
  const force = given.includes('--force');
  const files = given.filter((arg) => arg !== undefined && arg !== '--force');
  const only = files[0];
  if (files.length !== 1 || only === undefined || only.startsWith('-'))
    return usageError('rules takes <poc.yaml> [--force]');
  if (isDirectory(only)) return usageError('ожидается файл: ' + only);
  return runRules(only, force);
}

function commandLetter(folder: string | undefined, rest: string[]): CliResult {
  if (folder === undefined || rest.length > 0 || isFlag(folder)) return usageError('letter takes <folder>');
  const kindError = wrongKind(folder, 'folder');
  if (kindError !== null) return kindError;
  const dir = resolve(folder);
  try {
    const next = 'Дальше: ' + nodeCommand(CLI_PATH, 'letter', dir);
    return inspectLetter(dir, loadProfile().masks, next) ?? { code: 0, lines: ['PASS записка.txt'] };
  } catch (error) {
    if (error instanceof ProfileError) return { code: 65, lines: [error.code + ': ' + error.message] };
    throw error;
  }
}

/** init <folder>: one folder, no flags; the folder may still be missing - init creates it. */
function commandInit(second: string | undefined, rest: string[]): CliResult {
  if (second === undefined || rest.length > 0) return usageError('init takes <folder>');
  if (existsSync(second) && !isDirectory(second)) return usageError('ожидается папка: ' + second);
  return initFolder(second);
}

/** final <folder> <copy>: the working folder and a copy of it that does not exist yet. */
function commandFinal(second: string | undefined, rest: string[]): CliResult {
  const copy = rest[0];
  if (second === undefined || rest.length !== 1 || copy === undefined || isFlag(second) || isFlag(copy))
    return usageError('final takes <папка> <новая папка>');
  const kindError = wrongKind(second, 'folder');
  if (kindError !== null) return kindError;
  const result = runFinal(second, copy);
  if (result.code !== 64) return result;
  const [reason, nextStep] = result.lines;
  return usageError(reason ?? 'final takes <папка> <новая папка>', nextStep);
}

/**
 * open [--undo] [--page <лист>] <file> <id>...: the sdRole=open mark on whole cells, the flag on either side of the
 * file. Values are never read or printed, so the command works on a sending copy as on a
 * working one; an id that is not on a sheet refuses the call and writes nothing.
 */
function commandOpen(args: string[]): CliResult {
  const undo = args.includes('--undo');
  // open learns the same --page as text and style: an id on two pages must name one.
  const pageAt = args.indexOf('--page');
  const page = pageAt === -1 ? undefined : args[pageAt + 1];
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--undo') continue;
    if (args[index] === '--page') {
      index += 1;
      continue;
    }
    words.push(args[index] as string);
  }
  if (pageAt !== -1 && (page === undefined || isFlag(page)))
    return usageError('open takes [--undo] [--page <лист>] <файл> <id>...');
  const target = words[0];
  const ids = words.slice(1);
  if (target === undefined || isFlag(target) || ids.length === 0 || ids.some(isFlag)) {
    return usageError('open takes [--undo] [--page <лист>] <файл> <id>...');
  }
  const kindError = wrongKind(target, 'file');
  if (kindError !== null) return kindError;
  const result = runOpen(target, ids, undo, page);
  // A refusal of open still ends with a next step: the call is the person's
  // or the agent's hand, the fix is a corrected repeat.
  if (result.code !== 0) return { ...result, lines: [...result.lines, furtherLine(dirname(resolve(target)))] };
  return { ...result, lines: [...result.lines, furtherLine(dirname(resolve(target)))] };
}

/** fix --safe <folder>, and "fix <folder> --safe" too: a weak model copies both forms. */
function commandFixCall(second: string | undefined, rest: string[]): CliResult {
  const words = [second, ...rest].filter((word): word is string => word !== undefined);
  const folders = words.filter((word) => word !== '--safe');
  if (words.length !== 2 || folders.length !== 1 || folders[0] === undefined) {
    return usageError('fix takes --safe <folder>');
  }
  return commandFix(folders[0]);
}

function dispatch(args: string[]): CliResult {
  const [command, second, ...rest] = args;
  if (command === 'help') return { code: 0, lines: [USAGE] };
  if (command === 'text') return commandText(second, rest);
  if (command === 'style') return commandStyle(second, rest);
  if (command === 'check') return commandCheck(second, rest);
  if (command === 'letter') return commandLetter(second, rest);
  if (command === 'rules') return commandRules(second, rest);
  if (command === 'init') return commandInit(second, rest);
  if (command === 'final') return commandFinal(second, rest);
  if (command === 'open') return commandOpen([second, ...rest].filter((word): word is string => word !== undefined));
  if (command === 'pdf' || command === 'pack') return commandFolder(command, second, rest);
  if (command === 'fix') return commandFixCall(second, rest);
  return usageError(`unknown command "${command ?? ''}"`);
}

export function runCli(args: string[]): CliResult {
  try {
    const result = dispatch(args);
    if (result.code === 64 && result.lines.includes(USAGE) && result.lines.at(-1) === HELP_STEP) {
      // A folder argument survives an extra flag or a misplaced option. Only recover
      // commands with a complete set of known arguments; never invent an edit value.
      const dir = args.slice(1).find(word => !isFlag(word) && isDirectory(word));
      let next = HELP_STEP;
      const command = args[0];
      if (dir) next = furtherLine(resolve(dir));
      if (dir && (command === 'pdf' || command === 'pack' || command === 'init')) {
        const flags = command === 'pack' ? PACK_FLAGS.filter(flag => args.includes(flag)) : [];
        next = 'Дальше: ' + nodeCommand(CLI_PATH, command, resolve(dir), ...flags);
      } else if (dir && command === 'rules') {
        next = 'Дальше: ' + nodeCommand(CLI_PATH, 'rules', resolve(dir, 'poc.yaml'));
      } else if (dir && command === 'fix') {
        next = 'Дальше: ' + nodeCommand(CLI_PATH, 'fix', '--safe', resolve(dir));
      } else if (!dir && command === 'check' && args[1] && existsSync(args[1])) {
        next = furtherLine(dirname(resolve(args[1])));
      }
      result.lines[result.lines.length - 1] = next;
    }
    return result;
  } catch (error) {
    if (error instanceof DrawioInputError) {
      // The common blind handler: a SD-E01 line carries the code, the cell id and the attribute
      // name, never an attribute value; DrawioInputError.blind cut anything else away.
      return {
        code: 65,
        lines: [
          `${error.code}: ${blindMessage(error.message)}`,
          'Исправь названный файл и повтори вызов; лист навык не менял.',
          'Человеку: исправь файл из строки выше и повтори вызов.',
        ],
      };
    }
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
      // A filesystem refusal is a call error with a next step, never a Node stack.
      if (error.code === 'ENOENT') return usageError('no such file or directory');
      if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS') {
        return {
          code: 65,
          lines: [
            'SD-E01: ' +
              (typeof error === 'object' && 'message' in error
                ? String(error.message)
                : 'путь недоступен навыку: нет прав на чтение или запись'),
            'Дай доступ к папке и повтори вызов; файл навык не менял.',
            'Человеку: дай доступ к папке и повтори вызов.',
          ],
        };
      }
      if (error.code === 'EISDIR' || error.code === 'ENOTDIR') {
        return usageError('неверный вид пути: файл и папка перепутаны местами');
      }
    }
    throw error;
  }
}
