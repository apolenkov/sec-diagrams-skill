/**
 * Quoting for the "Дальше:" lines: every line names a full command, and a path with spaces,
 * parentheses or an exclamation mark must survive the shell unchanged. Single quotes are the one
 * safe envelope: nothing expands inside them, and an embedded single quote closes the word,
 * quotes the quote itself and reopens - the standard '\\'' dance.
 */
const QUOTE = "'";

/** One shell word: single quotes, with any single quote inside spelled as '\\''. */
export function shellQuote(value: string): string {
  const escapedQuote = process.platform === 'win32' ? "''" : "'\\''";
  return QUOTE + value.replaceAll(QUOTE, escapedQuote) + QUOTE;
}

/** The full node call that reruns this CLI: node '<cli>' <command> <args...>, every word quoted. */
export const nodeCommand = (cliPath: string, ...args: string[]): string =>
  ['node', shellQuote(cliPath), ...args.map(shellQuote)].join(' ');
