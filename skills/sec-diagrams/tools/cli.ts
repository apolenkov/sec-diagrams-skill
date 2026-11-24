/** Load runtime dependencies before dispatch so a fresh standalone install gives one actionable line. */
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { shellQuote } from './shell.ts';

export type { CliResult } from './cli-common.ts';
export type { CellPlan, FixContext } from './fix.ts';

const main = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === import.meta.filename;
const runtime = await import('./cli-commands.ts').catch((error: NodeJS.ErrnoException) => {
  if (!main || error.code !== 'ERR_MODULE_NOT_FOUND' || !/Cannot find package '/u.test(error.message)) throw error;
  console.error('Дальше: npm ci --prefix ' + shellQuote(resolve(import.meta.dirname, '..')));
  process.exit(69);
});
export const { runCli, planCell, fixContext } = runtime;

if (main) {
  if (['pack', 'pdf'].includes(process.argv[2] ?? '')) await runtime.loadMupdf();
  const result = runCli(process.argv.slice(2));
  console.log(result.lines.join('\n'));
  process.exitCode = result.code;
}
