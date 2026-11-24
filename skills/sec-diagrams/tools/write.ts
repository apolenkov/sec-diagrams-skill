/**
 * The one place that replaces an existing skill-owned file. Writes go to a unique temporary
 * file in the same folder - the name, the pid and a random part make collisions impossible -
 * opened with wx so an existing file, the skill's or a stranger's, is never overwritten, then
 * renamed over the target. The target's mode is carried to the temporary file, so a rewrite
 * never widens or loses permissions; a file nobody may write is refused, not forced (finding
 * N10). A crash or a full disk leaves the old file intact, never half of a new one. A tmp name
 * that was already taken by someone else stays theirs: the refusal removes only files this call
 * created, never a squatter.
 */
import { randomBytes } from 'node:crypto';
import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** A refusal the CLI answers with 65: the file is there, but nobody may write it. */
const readOnly = (path: string): Error =>
  Object.assign(new Error('файл только для чтения: ' + basename(path) + ', навык его не меняет'), { code: 'EROFS' });

/** The tmp name of one write: pid and four random bytes, a collision needs both to repeat. */
export const defaultTmpName = (path: string): string =>
  join(dirname(path), basename(path) + '.' + String(process.pid) + '.' + randomBytes(4).toString('hex') + '.tmp');

/** Replaces an existing file atomically, keeping its mode; a read-only file is refused. */
export function writeSheet(path: string, text: string, pickTmp: (path: string) => string = defaultTmpName): void {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o200) === 0) throw readOnly(path);
  const tmp = pickTmp(path);
  // rm may only touch what this call made: writeFileSync with wx fails with EEXIST before it
  // creates anything, and that file belongs to someone else.
  let ours = false;
  try {
    writeFileSync(tmp, text, { flag: 'wx', mode });
    ours = true;
    renameSync(tmp, path);
  } catch (error) {
    if (ours) rmSync(tmp, { force: true });
    throw error;
  }
}
