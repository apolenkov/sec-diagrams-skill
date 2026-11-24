/**
 * The blindener of SD-E01 messages, split out of drawio.ts (the size cap).
 *
 * Every message the parser builds comes from one of the shapes below: a fixed sentence, a tag
 * name, a page or file name, a cell id, a library position. No attribute value stands in any of
 * them, because a package may hold real addresses and host names and a parse error must not
 * recite them. A message that matches nothing - written by future code, or
 * carrying an arbitrary echo - is replaced by one fixed sentence, so the console stays blind
 * whatever a parser starts quoting.
 */
const SAFE_NAME = '[A-Za-z_][A-Za-z0-9_.:-]{0,63}';
const SAFE_ID = '[^"\\n]{1,64}';
const FILE_PREFIX = '[^\\n]{1,90}\\.drawio: ';

export const BLIND_E01 = 'лист не читается: значения в сообщении SD-E01 не печатаются';

const SAFE_MESSAGES: readonly RegExp[] = [
  /^input is larger than 32 MiB$/u,
  /^DTD declarations are forbidden$/u,
  /^expected exactly one root element$/u,
  /^mxfile has no diagram pages$/u,
  new RegExp('^' + BLIND_E01 + '$', 'u'),
  new RegExp('^unsupported root element "' + SAFE_NAME + '"$', 'u'),
  new RegExp('^cannot locate the start of tag "' + SAFE_NAME + '"$', 'u'),
  new RegExp('^cannot locate the end tag of "' + SAFE_NAME + '"$', 'u'),
  /^(?:page "[^"]*": )?compressed payload is unreadable$/u,
  /^(?:file|page "[^"]*"): \d+:\d+: (?:malformed XML|[a-z ]+)\.?$/u,
  new RegExp('^(?:file|page "[^"]*"): tag "' + SAFE_NAME + '" is not closed correctly$', 'u'),
  new RegExp('^(?:file|page "[^"]*"): unclosed tag "' + SAFE_NAME + '"$', 'u'),
  new RegExp('^page "[^"]*": cell id "' + SAFE_ID + '" is repeated$', 'u'),
  new RegExp(
    '^page "[^"]*": cell "' +
      SAFE_ID +
      '" attribute "(?:parent|source|target)" references a cell that is not on the page$',
    'u',
  ),
  new RegExp('^' + FILE_PREFIX + '(?:no such file|лист не читается)$', 'u'),
  /^правка отклонена, файл не изменен: лист после правки не читается \([^\n]*\)$/u,
];

/** The message of a parse error, with every part that is not a known shape cut away. */
export function blindMessage(message: string): string {
  const at = /^позиция (\d+): (.+)$/u.exec(message);
  if (at) return 'позиция ' + at[1] + ': ' + blindMessage(at[2]!);
  if (SAFE_MESSAGES.some((shape) => shape.test(message))) return message;
  const wrapped = new RegExp('^(' + FILE_PREFIX + ')([\\s\\S]*)$', 'u').exec(message);
  if (wrapped !== null && blindMessage(wrapped[2] ?? '') === wrapped[2]) return message;
  return BLIND_E01;
}
