/**
 * The harness the checks tests share: a sheet runs through the same five check functions the
 * CLI calls, and only the code list comes back; a template is taken from the generator, so a
 * test that edits one string never drifts from what init writes. Nothing here asserts.
 */
import { parseDrawio } from '../drawio.ts';
import { loadProfile } from '../profile.ts';
import { buildModel } from '../checks/model.ts';
import { checkNumbers } from '../checks/numbers.ts';
import { checkLines } from '../checks/lines.ts';
import { checkText } from '../checks/text.ts';
import { checkSheet } from '../checks/sheet.ts';
import { templateFiles } from '../templates.ts';

const profile = loadProfile();

export function codesOf(fileName: string, content: string, retired: number[] = []): string[] {
  const file = parseDrawio(content);
  const findings = file.pages.flatMap((page) => {
    const model = buildModel(fileName, page, profile, retired);
    model.titlePrefix = '';
    return [...checkNumbers(model), ...checkLines(model), ...checkText(model), ...checkSheet(model)];
  });
  return findings.map((found) => found.code);
}

export function template(name: string): string {
  const file = templateFiles().find((entry) => entry.name === name);
  if (file === undefined) throw new Error('template ' + name + ' is missing');
  return file.content;
}

export const l1 = (): string => template('l1.drawio');
export const l3 = (): string => template('l3-1.drawio');

export const sub =
  (from: string, to: string): ((content: string) => string) =>
  (content) =>
    content.replace(from, to);

export const PROXY = l1().split('\n').find((line) => line.includes('id="collector"'))!;

/** Wrap a known cell so the parser sees attributes defined through draw.io Edit Data. */
export const proxyObject = (attrs: string): string =>
  '<object id="collector" ' + attrs + '>' + PROXY.replace(' id="collector" value="Сборщик"', '') + '</object>';
