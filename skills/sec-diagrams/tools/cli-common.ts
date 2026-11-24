/**
 * The shared frame of the CLI answers, split out of cli.ts (the size cap): the result shape, the
 * usage refusal, the "Дальше:" line and the folder/file argument check. cli.ts and cli-fix.ts
 * both answer through these, so the wording of a bad call is one sentence in one place.
 */
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { nodeCommand } from './shell.ts';

export const CLI_PATH = join(import.meta.dirname, 'cli.ts');

export interface CliResult {
  code: number;
  lines: string[];
}

export const USAGE =
  'usage: node cli.ts text get <file> <id> [--page <name>] | text set <file> <id> <text> [--page <name>] | ' +
  'style set <file> <id> <key>=<value> [--page <name>] | fix --safe <folder> | check <folder> [--json] [--submitted] | rules <poc.yaml> [--force] | init <folder> | ' +
  'final <folder> <copy> | open [--undo] [--page <лист>] <file> <id>... | letter <folder> | pdf <folder> | pack <folder> [--with-letter] [--with-rules]';

/** A call error still ends with its next step: the corrected call is right above it in the USAGE. */
export const HELP_STEP = 'Дальше: ' + nodeCommand(CLI_PATH, 'help');
export const usageError = (message: string, nextStep = HELP_STEP): CliResult => ({
  code: 64,
  lines: [message, USAGE, nextStep],
});

export const furtherLine = (folder: string): string => 'Дальше: ' + nodeCommand(CLI_PATH, 'check', folder);

/**
 * A call error, not a Node stack: a command that wants a folder says so when the path is a file,
 * and a command that wants a sheet says so when the path is a directory. Missing paths keep the
 * ENOENT answer they already give.
 */
export const wrongKind = (path: string, want: 'folder' | 'file'): CliResult | null => {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(resolve(path));
  } catch {
    return usageError('no such file or directory: ' + path);
  }
  const ok = want === 'folder' ? stat.isDirectory() : stat.isFile();
  if (ok) return null;
  return usageError(want === 'folder' ? 'ожидается папка: ' + path : 'ожидается файл .drawio: ' + path);
};
