/**
 * Profile and package manifest: the only place where package data is validated.
 *
 * A profile holds the notation a package is drawn with (palette, fonts, title tail, allowed
 * masks) so that a rule change is a config edit, not a code change. A manifest describes one
 * package: the service it goes to, the title prefix, and one entry per sheet. Both are read
 * through zod; a rejected value becomes a SD-E02 error naming the field path and nothing else,
 * because a package may hold real addresses and host names that must never reach the output.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export class ProfileError extends Error {
  readonly code = 'SD-E02';
}

export class DirectoryNameConflict extends Error {
  constructor(first: string, second: string) {
    const names = [first, second].map(name => JSON.stringify(name.normalize('NFC')));
    super(`SD-K01: файлы ${names.join(' и ')} имеют одинаковое имя в NFC, на диске имена в разных формах Unicode`);
  }
}

const COLOR = /^#[0-9a-f]{6}$/u;
const DRAWIO_FILE = /^[^/\\]+\.drawio$/u;
const TOPIC_FORBIDDEN = /[()/\\:*?"<>|]/u;

export const profileSchema = z.object({
  name: z.string().min(1),
  edgePalette: z
    .array(z.object({ color: z.string().regex(COLOR), arrow: z.boolean(), meaning: z.string().min(1) }))
    .min(1),
  denyColor: z.string().regex(COLOR),
  fonts: z.array(z.string().min(1)).min(1),
  titleTail: z.string().min(1),
  masks: z.array(z.string()),
  jumpSize: z.number().int().positive(),
  legendHeadings: z.array(z.string().min(1)).min(1),
});

export const manifestSchema = z.object({
  service: z.string().min(1),
  titlePrefix: z.string(),
  /** True in a copy for sending: the sheet cells carry real addresses, check allows them. */
  final: z.boolean().optional(),
  sheets: z
    .array(
      z.object({
        file: z.string().regex(DRAWIO_FILE),
        level: z.union([z.literal(''), z.enum(['L1', 'L2', 'L3']), z.string().regex(/^L3-\d+$/u)]),
        topic: z.string().min(1),
        retired: z.record(z.string(), z.array(z.number().int().positive())).optional(),
      }),
    )
    .min(1),
});

export type Profile = z.infer<typeof profileSchema>;
export type SheetEntry = z.infer<typeof manifestSchema>['sheets'][number];
export type Manifest = z.infer<typeof manifestSchema>;

export const DEFAULT_PROFILE = 'default';
export const RULES_SHEET_FILE = 'Карта сетевой фильтрации.drawio';

export const profilePath = (name: string): string =>
  join(import.meta.dirname, '..', 'config', 'profiles', name + '.json');

const fail: (issues: string[], source: string) => never = (issues, source) => {
  throw new ProfileError(source + ': ' + issues.join('; '));
};

const issuePaths = (error: z.ZodError): string[] =>
  error.issues.map((issue) => (issue.path.length > 0 ? issue.path.join('.') : 'root'));

function parseJson(path: string, source: string): unknown {
  if (!existsSync(path)) fail(['файла нет'], source);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(['not readable JSON'], source);
  }
}

/** Reads a profile by name from config/profiles; a schema problem names the field path only. */
export function loadProfile(name: string = DEFAULT_PROFILE): Profile {
  const source = 'config/profiles/' + name + '.json';
  const parsed = profileSchema.safeParse(parseJson(profilePath(name), source));
  if (!parsed.success) fail(issuePaths(parsed.error), source);
  const profile = parsed.data;
  if (profile.fonts.length === 0) fail(['fonts'], source);
  return profile;
}

/**
 * manifest.json when the folder has one, null when it does not.
 *
 * A package can be checked before manifest.json exists (a folder of loose sheets); then the
 * title prefix is simply unknown and SD-H01 reports NOT_CHECKED. A manifest that is there but
 * broken stays SD-E02: a half-read package is worse than no package.
 */
export function loadManifestOrNull(folder: string): Manifest | null {
  return existsSync(join(folder, 'manifest.json')) ? loadManifest(folder) : null;
}

/** Reads manifest.json of a package folder and checks every sheet entry against the schema. */
export function loadManifest(folder: string): Manifest {
  const source = 'manifest.json';
  const data = parseJson(join(folder, 'manifest.json'), source);
  const parsed = manifestSchema.safeParse(data);
  if (!parsed.success) fail(issuePaths(parsed.error), source);
  const manifest = parsed.data;
  const problems: string[] = [];
  if (manifest.service.trim() === '') problems.push('service');
  const seen = new Map<string, string>();
  const packed = new Map<string, string>();
  let hasRules = false;
  manifest.sheets.forEach((sheet, index) => {
    const base = 'sheets.' + index;
    const key = sheet.file.normalize('NFC').toLowerCase();
    // Any second listing of the same file is SD-E02, even the byte-identical one: two manifest
    // rows for one sheet disagree the moment their topics differ.
    if (seen.has(key)) problems.push(base + '.file.duplicate');
    seen.set(key, sheet.file);
    const packedName = packageFileName(sheet).normalize('NFC').toLowerCase();
    if (packed.has(packedName)) problems.push(base + '.file.duplicate-in-package');
    packed.set(packedName, sheet.file);
    if (isRulesSheet(sheet)) {
      if (hasRules) problems.push(base + '.file.duplicate-rules-sheet');
      hasRules = true;
    }
    if (/^\d/u.test(sheet.topic)) problems.push(base + '.topic');
    if (TOPIC_FORBIDDEN.test(sheet.topic)) problems.push(base + '.topic');
  });
  if (problems.length > 0) fail(problems, source);
  return manifest;
}

/** The manifest entry of one package file; undefined when the file is not listed. */
export function sheetOf(manifest: Manifest, fileName: string): SheetEntry | undefined {
  return manifest.sheets.find((sheet) => sheet.file === fileName);
}

/** Retired numbers of one page, from sheets[].retired keyed by the page name. */
export function retiredOf(sheet: SheetEntry | undefined, pageName: string): number[] {
  return sheet?.retired?.[pageName] ?? [];
}

/** File name pack builds from an entry: "Доступ администраторов__L3-1.drawio". */
export function packageFileName(sheet: SheetEntry): string {
  const name = sheet.level === '' ? sheet.topic + '.drawio' : sheet.topic + '__' + sheet.level + '.drawio';
  return name.normalize('NFC');
}

export function isRulesSheet(sheet: SheetEntry): boolean {
  return sheet.file.normalize('NFC') === RULES_SHEET_FILE || packageFileName(sheet) === RULES_SHEET_FILE;
}

/** The source name can differ from the standard name used for the attachment. */
export function rulesSheetName(manifest: Manifest | null): string {
  return manifest?.sheets.find(isRulesSheet)?.file ?? RULES_SHEET_FILE;
}

export function listDrawio(dir: string, manifest: Manifest | null = null): string[] {
  const listed = new Set(manifest?.sheets.map((sheet) => sheet.file.normalize('NFC')));
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.name.endsWith('.drawio')) return false;
      const explicit = listed.has(entry.name.normalize('NFC'));
      if (entry.isFile()) return explicit || !entry.name.startsWith('.');
      return explicit && entry.isSymbolicLink() &&
        statSync(join(dir, entry.name), { throwIfNoEntry: false })?.isFile();
    })
    .map((entry) => entry.name)
    .sort();
  assertUniqueDirectoryNames(names);
  return names;
}

function assertUniqueDirectoryNames(entries: readonly string[]): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const nfc = entry.normalize('NFC');
    const previous = seen.get(nfc);
    if (previous !== undefined && previous !== entry) throw new DirectoryNameConflict(previous, entry);
    seen.set(nfc, entry);
  }
}

/** Keep the directory entry's spelling for I/O, even if the manifest uses another Unicode form. */
export function resolveDirectoryName(entries: readonly string[], name: string): string {
  const nfc = name.normalize('NFC');
  const matches = entries.filter(entry => entry.normalize('NFC') === nfc);
  assertUniqueDirectoryNames(matches);
  return matches[0] ?? name;
}
