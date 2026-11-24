/** Validate the YAML contract and report field paths without revealing values. */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

import { ProfileError } from './profile.ts';

/**
 * poc.yaml writes an empty field as `key:` with no value, and YAML reads that as null. An
 * empty field is the same thing as a missing one: null becomes undefined here, and
 * the sheet fills the hole with its own placeholder.
 */
const asMissing = (value: unknown): unknown =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value;
const optText = z.preprocess(asMissing, z.string().min(1).optional());

const rowSchema = z
  .object({
    link: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    action: z.enum(['allow', 'deny']).optional(),
    proto: z.string().min(1),
    port: optText,
    dst: z.string().min(1),
    dst_addr: optText,
    dst_fqdn: optText,
    src: z.string().min(1),
    src_addr: optText,
    src_fqdn: optText,
    purpose: optText,
    open: z.preprocess(
      asMissing,
      z.array(z.enum(['dst_addr', 'dst_fqdn', 'src_addr', 'src_fqdn'])).optional(),
    ),
  })
  .strict();

const tableSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    rows: z.array(rowSchema).min(1),
  })
  .strict();

/**
 * A whitelist row keeps its holes the way a rule row does: an open field may stay unfilled and
 * gets the sdRole=open mark, an unmarked hole stops the copy. A note is plain
 * text or text that declares its own open mark.
 */
export const WHITELIST_FIELDS = ['purpose', 'name', 'requester'] as const;

const whitelistSchema = z
  .object({
    purpose: optText,
    name: optText,
    requester: optText,
    open: z.preprocess(asMissing, z.array(z.enum(WHITELIST_FIELDS)).optional()),
  })
  .strict();
const noteSchema = z.union([
  z.string().min(1),
  z.object({ text: z.string().min(1), open: z.preprocess(asMissing, z.literal(true).optional()) }).strict(),
]);
type PocNote = { text: string; open: boolean };

const pocSchema = z
  .object({
    sheet: z.string().min(1),
    tables: z.array(tableSchema),
    whitelist: z.preprocess(asMissing, z.array(whitelistSchema).optional()),
    notes: z.preprocess(asMissing, z.array(noteSchema).optional()),
  })
  .strict()
  .transform((poc) => ({
    ...poc,
    whitelist: poc.whitelist ?? [],
    notes: (poc.notes ?? []).map((note): PocNote =>
      typeof note === 'string' ? { text: note, open: false } : { text: note.text, open: note.open === true },
    ),
  }))
  .refine((poc) => poc.tables.length > 0 || poc.whitelist.length > 0, { path: ['tables'] });

export type Poc = z.infer<typeof pocSchema>;
type PocRow = Poc['tables'][number]['rows'][number];
type PocWhite = Poc['whitelist'][number];

export type { PocRow, PocWhite };

const RU_TYPE: Record<string, string> = {
  string: 'строка',
  number: 'число',
  boolean: 'значение',
  array: 'список',
  object: 'объект',
  null: 'пусто',
  undefined: 'пусто',
};

/**
 * The reason of an issue by its kind: a type, a key, a length - never the
 * value, which in a copy for sending could be a real address. The word for the wanted type
 * carries its own gender: «ожидалась строка, получено число».
 */
function issueReason(issue: z.ZodIssue): string {
  const ru = (kind: string): string => RU_TYPE[kind] ?? kind;
  switch (issue.code) {
    case 'invalid_type': {
      // zod v4 names the received type in its message ("expected string, received number") and
      // carries no value; the value itself must never reach the report.
      const got = /received (\S+)$/u.exec(issue.message)?.[1] ?? 'значение';
      return 'ожидалась ' + ru(issue.expected) + ', получено ' + ru(got);
    }
    case 'unrecognized_keys':
      return 'неизвестный ключ';
    case 'too_small':
      return 'значение пустое';
    case 'invalid_value':
      return 'значение не из набора';
    default:
      return 'не подходит контракту';
  }
}

const issuePaths = (error: z.ZodError): string[] => [
  ...new Set(
    error.issues.flatMap((issue) => {
      const reason = issueReason(issue);
      const base = issue.path.length > 0 ? issue.path.join('.') : 'root';
      // A strict object names its unknown keys on the issue, not on the path: complete the
      // path here, so the report points at tables.0.rows.0.prto, the typo itself.
      // But a key is person's text too: a slip can hide a real address in it, so only a
      // field-name shape is printed, the rest reads as «?».
      const keys = (issue as { keys?: unknown }).keys;
      const field = /^[a-z_]{1,20}$/u;
      const paths =
        Array.isArray(keys) && keys.length > 0
          ? keys.map((key) => base + '.' + (typeof key === 'string' && field.test(key) ? key : '?'))
          : [base];
      return paths.map((path) => path + ': ' + reason);
    }),
  ),
];

/** poc.yaml through zod; a rejected value becomes SD-E02 naming field paths, never values. */
export function loadPoc(path: string): Poc {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ProfileError('poc.yaml: not readable');
  }
  let data: unknown;
  try {
    // logLevel error: the library warns about questionable yaml through console.warn, and the
    // warning quotes the questionable line - values a copy for sending must never leak.
    // silent would go further and swallow the duplicate-key error itself, so it is error.
    data = parse(text, { logLevel: 'error' });
  } catch (error) {
    // The parser's own message quotes the broken line; a copy for sending holds real values
    // there, so the error keeps only the place: the line the parser marked (linePos in yaml v2).
    const mark = (error as { linePos?: Array<{ line?: number }> }) ?? {};
    const line = Array.isArray(mark.linePos) ? mark.linePos[0]?.line : undefined;
    const at = typeof line === 'number' ? ', строка ' + line : '';
    throw new ProfileError('poc.yaml: нечитаемый YAML' + at);
  }
  const parsed = pocSchema.safeParse(data);
  if (!parsed.success) throw new ProfileError('poc.yaml: ' + issuePaths(parsed.error).join('; '));
  return parsed.data;
}
