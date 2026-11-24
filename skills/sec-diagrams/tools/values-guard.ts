/**
 * What opens a sheet's values, and what keeps them closed .
 *
 * A folder holds values a person typed: the agent may read and write them - `text get`,
 * `text set`, the text half of `fix --safe` - only in a CONFIRMED working copy:
 *
 * - the path is taken through realpathSync, so a symlink leads to the folder it really reads;
 * - the nearest manifest.json up the tree passes the manifest schema and carries "final": false
 *   explicitly - an old copy without the field is not confirmed either, its person is asked to
 *   add it (a copy for sending once had the same manifest and would read as one);
 * - no copy marker stands in any folder from the sheet's own up to the root, and no manifest
 *   with a final other than false stands above: the packet pack builds from a sending copy
 *   carries that marker, and the copy itself gets it too.
 *
 * Everything else - no manifest, a broken one, one off the schema, a final that is not a
 * boolean, a marker above - refuses with 64 and ends with a person's step. The rest of the
 * commands (check, rules, fix styles, style, open, pdf, pack) never print a value and never
 * quote an input fragment in an error, so they keep working on every folder.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { manifestSchema } from './profile.ts';

/** The empty marker file pack leaves in the packet of a sending copy; hidden by its leading dot. */
export const COPY_MARKER = '.sending-copy';

/** The refusal a values command answers with on a copy for sending. */
export const TEXT_VALUES_REFUSED =
  'в копии для отправки значения вписывает человек в draw.io; агенту хватает check, pdf, pack';

const PERSON_DRAWIO = 'Человеку: значения вносит человек в draw.io.';
const PERSON_MANIFEST = 'Человеку: почини manifest.json и повтори вызов; файл навык не менял.';
const PERSON_FINAL_FALSE =
  'Человеку: проверь обезличенность листов и добавь в manifest.json рядом с листом поле "final": false - оно подтверждает рабочую копию.';
const PERSON_CREATE =
  'Человеку: значения открыты только в подтвержденной рабочей копии; создай manifest.json по образцу из SKILL.md с "final": false.';

/** Whether a folder's own manifest.json decides, and how. */
type FinalField = 'none' | 'broken' | 'missing' | 'false' | 'true' | 'other';

function finalField(dir: string): FinalField {
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) return 'none';
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return 'broken';
  }
  if (!manifestSchema.safeParse(data).success) return 'broken';
  const record = data as Record<string, unknown>;
  if (!('final' in record)) return 'missing';
  const final = record['final'];
  if (final === false) return 'false';
  if (final === true) return 'true';
  return 'other';
}

/**
 * Defense in depth for the value printout: even in a confirmed working copy the
 * printed text never carries a real IPv4 - a plain address, one with a short or dotted mask,
 * one with a range end - every such token reads back as XX.XX.XX.XX. A working copy holds no
 * real addresses (SKILL.md), so this masks nothing the agent needs; a stray real value, typed
 * in by hand or left by an old sheet, never reaches the console of an outside model.
 */
const IPV4_PRINT =
  /(?<![\d.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/(?:\d{1,3}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}))?(?:-(?:\d{1,3}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}))?(?![\d.])/gu;

export const maskIpv4 = (text: string): string => text.replaceAll(IPV4_PRINT, 'XX.XX.XX.XX');

/** The answer of the guard: allowed, or a blind refusal with the person's next step. */
export interface CopyVerdict {
  readonly allowed: boolean;
  readonly reason: string;
  readonly hint: string;
}

const refused = (reason: string, hint: string): CopyVerdict => ({ allowed: false, reason, hint });

/** The chain of folders from the given one up to the root, that one first. */
function chainToRoot(dir: string): string[] {
  const chain: string[] = [];
  let current = dir;
  for (;;) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) return chain;
    current = parent;
  }
}

/** The verdict for one folder: the file form asks the same question one level deeper. */
export function confirmWorkingFolder(folder: string): CopyVerdict {
  let dir: string;
  try {
    dir = realpathSync(folder);
  } catch {
    return refused('не удалось определить папку листа', PERSON_MANIFEST);
  }
  const chain = chainToRoot(dir);
  const fields = chain.map(finalField);
  const nearest = fields.findIndex((field) => field !== 'none');
  // The manifest of the folder itself speaks first: inside a copy for sending it says true.
  const field = nearest === -1 ? 'none' : (fields[nearest] as FinalField);
  if (field === 'broken') return refused('manifest.json рядом с листом не читается или не по схеме', PERSON_MANIFEST);
  if (field === 'true') return refused(TEXT_VALUES_REFUSED, PERSON_DRAWIO);
  if (field === 'other') return refused('manifest.json: final должен быть true или false', PERSON_MANIFEST);
  // A copy marker at or above the folder closes it: a packet, or any folder under either copy.
  const marked = chain.some((dir) => existsSync(join(dir, COPY_MARKER)));
  if (marked)
    return refused('под папкой лежит маркер копии для отправки: значения такой папки агенту закрыты', PERSON_DRAWIO);
  if (nearest === -1) return refused('рядом с листом нет manifest.json: рабочая копия не подтверждена', PERSON_CREATE);
  if (field === 'missing')
    return refused('в manifest.json рядом с листом нет поля final: копия не подтверждена', PERSON_FINAL_FALSE);
  for (const above of fields.slice(nearest + 1)) {
    if (above !== 'none' && above !== 'false')
      return refused('в папке выше лежит manifest.json с final, отличным от false', PERSON_DRAWIO);
  }
  return { allowed: true, reason: '', hint: '' };
}

/** The verdict for one sheet file: symlinks are followed, then the folder question is asked. */
export function confirmWorkingFile(file: string): CopyVerdict {
  let real: string;
  try {
    real = realpathSync(resolve(file));
  } catch {
    return refused('не удалось определить путь к листу', PERSON_MANIFEST);
  }
  return confirmWorkingFolder(dirname(real));
}

export function underCopyMarker(folder: string): boolean {
  const dir = existsSync(folder) ? realpathSync(folder) : resolve(folder);
  return chainToRoot(dir).some((ancestor) => existsSync(join(ancestor, COPY_MARKER)));
}
