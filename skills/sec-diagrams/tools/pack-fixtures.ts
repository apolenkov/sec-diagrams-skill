/**
 * pack <folder> tests. The package is a real init + rules folder; the PDF stage is produced by
 * runPdf with an injected exporter (a fixture page at 8 pt, the size of the printable area), so
 * no draw.io is needed. Only files are asserted, never letter text: the console must stay blind.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mergedPdfName } from './pack.ts';
import { buildPdf } from './pdf-fixtures.ts';
import { runPdf } from './pdf.ts';
import { runRules } from './rules-page.ts';
import { initFolder } from './templates.ts';


export const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

export function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A fixture page at 8 pt sized like the printable area; rebuilt per call: mupdf may detach a buffer it has opened. */
export const fakePdf = (outPath: string): void =>
  writeFileSync(outPath, buildPdf({ pages: [{ widthMm: 400, heightMm: 277, lines: [{ x: 50, y: 60, size: 8 }] }] }));

export const GOOD_LETTER = [
  'Что проверено: Потоки показаний от датчиков до базы.',
  '',
  'Что изменилось: Обновлен лист приема телеметрии.',
  '',
  'Что приложено: Обзор, схема зон, два листа L3 и PDF.',
  '',
].join('\n');

export const PACKET_NAMES = [
  'Общая схема__L1.drawio',
  'Зоны и узлы__L2.drawio',
  'Прием телеметрии__L3-1.drawio',
  'Хранение измерений__L3-2.drawio',
].sort();

/** A packet contains the merged PDF and renamed editable sheets. */
export const MERGED_PDF = mergedPdfName('Служба ИБ', PACKET_NAMES.length);

/** A package that init, rules and a passing pdf run produced; the letter is not written yet. */
export function readyPackage(t: { after: (fn: () => void) => void }, prefix = 'sd-pack-'): string {
  const dir = tempDir(prefix);
  t.after(() => [dir, dir + '-pdf', dir + '-обзор'].forEach(rmDir));
  assert.equal(initFolder(dir).code, 0);
  assert.equal(runRules(join(dir, 'poc.yaml'), false).code, 0);
  const pdf = runPdf(dir, { exportSheet: (_source, outPath) => fakePdf(outPath) });
  assert.equal(pdf.code, 0, pdf.lines.join('\n'));
  return dir;
}
