import { pdfTestOptions } from './pdf-fixtures.ts';
/**
 * Assembly of the packet is all-or-nothing: the foreign scan looks before
 * anything of the previous build is removed, the new build is assembled in a temp folder next to
 * the packet and renamed over it whole, sheets are hashed from the very bytes that get written,
 * the fitted PDFs are only merged when the report vouches for their bytes, and a tmp file that
 * write.ts did not create is left alone. PDFs here are mupdf fixtures; every address is RFC 5737.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';

import { mergedPdfName, packetDirOf, runPack } from './pack.ts';
import { buildPdf } from './pdf-fixtures.ts';
import { pdfDir, runPdf } from './pdf.ts';
import { initFolder } from './templates.ts';
import { runRules } from './rules-page.ts';
import { defaultTmpName, writeSheet } from './write.ts';


const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });
const tempDir = (prefix: string): string => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
/** Temp build folders of THIS packet: the shared tmpdir holds the builds of parallel test files too. */
const ownBuilds = (packDir: string): string[] =>
  readdirSync(realpathSync(join(packDir, '..'))).filter((name) => name.startsWith(basename(packDir) + '.build-'));

const fakePdf = (outPath: string): void =>
  writeFileSync(outPath, buildPdf({ pages: [{ widthMm: 400, heightMm: 277, lines: [{ x: 50, y: 60, size: 8 }] }] }));

const GOOD_LETTER = [
  'Что приложено: PDF для просмотра и исходники схем.',
  'Что изменилось: Обновили подпись потока измерений.',
  'Что проверено: На листах L3 подписаны порты сбора и записи.',
  '',
].join('\n');

const PACKET_NAMES = [
  'Общая схема__L1.drawio',
  'Зоны и узлы__L2.drawio',
  'Прием телеметрии__L3-1.drawio',
  'Хранение измерений__L3-2.drawio',
].sort();
const MERGED_PDF = mergedPdfName('Служба ИБ', PACKET_NAMES.length);

/** A package init, rules and a passing pdf run produced, with its packet already built once. */
function packedPackage(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = tempDir(prefix);
  t.after(() => {
    rmDir(dir);
    rmDir(packetDirOf(dir));
    rmDir(pdfDir(dir));
  });
  assert.equal(initFolder(dir).code, 0);
  assert.equal(runRules(join(dir, 'poc.yaml'), false).code, 0);
  assert.equal(runPdf(dir, { exportSheet: (_source, outPath) => fakePdf(outPath) }).code, 0);
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  assert.equal(runPack(dir, { withLetter: true }).code, 0);
  return dir;
}

const pdfTest = await pdfTestOptions();

test('a foreign file stops pack, and the previous build stands untouched', pdfTest, (t) => {
  const dir = packedPackage(t, 'sd-pack-foreign-');
  const packDir = packetDirOf(dir);
  mkdirSync(join(packDir, 'Visio'));
  writeFileSync(join(packDir, 'Visio', 'l1.vsdx'), 'visio');
  writeFileSync(join(packDir, 'README.txt'), 'чужой файл');
  const result = runPack(dir, { withLetter: true });
  const out = result.lines.join('\n');
  assert.equal(result.code, 1, out);
  assert.ok(out.includes('SD-K02') && out.includes('README.txt'), out);
  // The scan refused before anything was removed: sheets, merge, Visio and the letter are where
  // they were. The old order deleted the previous build first, so a stray README ate the packet.
  for (const name of PACKET_NAMES)
    assert.ok(existsSync(join(packDir, 'схемы', name)), 'sheet survived the refusal: ' + name);
  assert.ok(existsSync(join(packDir, MERGED_PDF)), 'the previous merge survived');
  assert.ok(existsSync(join(packDir, 'Visio', 'l1.vsdx')), 'Visio survived');
  assert.ok(existsSync(join(packDir, 'записка.txt')), 'the letter survived');
});

test('a sheet of an older build under схемы/ is pack output, not a foreign file', pdfTest, (t) => {
  const dir = packedPackage(t, 'sd-pack-oldsheet-');
  const sheetDir = join(packetDirOf(dir), 'схемы');
  writeFileSync(join(sheetDir, 'Лист из прежнего состава__L3-3.drawio'), '<mxfile/>');
  const result = runPack(dir, { withLetter: true });
  const out = result.lines.join('\n');
  assert.equal(result.code, 0, 'the previous build is pack' + "'" + 's own output: ' + out);
  assert.ok(!existsSync(join(sheetDir, 'Лист из прежнего состава__L3-3.drawio')), 'the rebuild drops it whole');
});

test('the packet path taken by a plain file is a clean refusal, never a crash', pdfTest, (t) => {
  const dir = packedPackage(t, 'sd-pack-occupied-');
  const packDir = packetDirOf(dir);
  rmSync(packDir, { recursive: true });
  writeFileSync(packDir, 'не папка');
  const result = runPack(dir, { withLetter: true });
  const out = result.lines.join('\n');
  assert.equal(result.code, 2, out);
  assert.ok(readFileSync(packDir, 'utf8') === 'не папка', 'the skill does not remove foreign things');
  const tail = result.lines.at(-1) ?? '';
  assert.ok(tail.startsWith('Человеку: ') || tail.startsWith('Дальше: '), out);
});

test('a sheet rewritten mid-build is refused by hash, and the old packet stays whole', pdfTest, (t) => {
  // The seam marks the moment of the race: the hook fires right before the sheet is read for the
  // copy, so the bytes that reach the packet are hashed and compared with the report. A sheet
  // edited between the report check and the copy must stop the build, not slip a packet whose
  // merge and sheets came from different moments.
  const dir = packedPackage(t, 'sd-pack-race-');
  const packDir = packetDirOf(dir);
  const oldBytes = readFileSync(join(packDir, 'схемы', PACKET_NAMES[0] as string));
  let fired = false;
  const result = runPack(dir, {
    withLetter: true,
    beforeSheetCopy: (file: string): void => {
      if (fired || file !== 'l1.drawio') return;
      fired = true;
      writeFileSync(join(dir, file), readFileSync(join(dir, file), 'utf8') + '\n');
    },
  });
  const out = result.lines.join('\n');
  assert.ok(fired, 'the hook fired');
  assert.equal(result.code, 2, out);
  assert.ok(out.includes('l1.drawio'), 'the refusal names the sheet: ' + out);
  assert.ok(out.includes('pdf'), 'the person is sent through pdf again: ' + out);
  const tail = result.lines.at(-1) ?? '';
  assert.ok(tail.startsWith('Человеку: ') || tail.startsWith('Дальше: '), out);
  // No half-packet: the previous assembly is byte-identical or gone, never half-overwritten.
  const packed = join(packDir, 'схемы', PACKET_NAMES[0] as string);
  if (existsSync(packed)) assert.deepEqual(readFileSync(packed), oldBytes, 'the old copy was not overwritten');
  assert.deepEqual(ownBuilds(packDir), [], 'no temp build folder is left next to the packet');
});

test('a fitted PDF the report does not vouch for is not merged', pdfTest, (t) => {
  const dir = packedPackage(t, 'sd-pack-fitted-');
  const packDir = packetDirOf(dir);
  const fitted = join(pdfDir(dir), 'l1.pdf');
  // Another valid PDF: mupdf would merge it happily, and the reviewer would get a page its sheets do not
  // explain. The report now carries the hash of every written fitted PDF; pack checks the bytes.
  writeFileSync(fitted, buildPdf({ pages: [{ widthMm: 400, heightMm: 277, lines: [{ x: 50, y: 60, size: 9 }] }] }));
  const result = runPack(dir, { withLetter: true });
  const out = result.lines.join('\n');
  assert.equal(result.code, 2, out);
  assert.ok(!out.includes('ИТОГ: PASS'), out);
  assert.ok(out.includes('pdf'), 'the line sends through pdf: ' + out);
  assert.ok(!existsSync(join(packDir, MERGED_PDF)), 'no merge of unvouched bytes inside the packet');
  const tail = result.lines.at(-1) ?? '';
  assert.ok(tail.startsWith('Человеку: ') || tail.startsWith('Дальше: '), out);
});

test('a rebuild keeps Visio and leaves no build temp beside the packet', pdfTest, (t) => {
  const dir = packedPackage(t, 'sd-pack-visio-');
  const packDir = packetDirOf(dir);
  mkdirSync(join(packDir, 'Visio'));
  writeFileSync(join(packDir, 'Visio', 'l1.vsdx'), 'visio');
  assert.equal(runPack(dir, { withLetter: true }).code, 0);
  assert.ok(existsSync(join(packDir, 'Visio', 'l1.vsdx')), 'the person' + "'" + 's Visio copy rides through');
  assert.deepEqual(ownBuilds(packDir), [], 'no temp build folder is left next to the packet');
});

test('writeSheet leaves a foreign file that squats its tmp name', (t) => {
  const dir = tempDir('sd-write-eexist-');
  t.after(() => rmDir(dir));
  const sheet = join(dir, 'l1.drawio');
  writeFileSync(sheet, 'старые байты\n');
  const squat = join(dir, 'l1.drawio.squatter.tmp');
  writeFileSync(squat, 'чужой файл\n');
  assert.throws(
    () => writeSheet(sheet, 'новые байты\n', () => squat),
    (error: unknown) => (error as { code?: string }).code === 'EEXIST',
  );
  assert.equal(readFileSync(squat, 'utf8'), 'чужой файл\n', 'a tmp file of another owner is not ours to delete');
  assert.equal(readFileSync(sheet, 'utf8'), 'старые байты\n', 'and the sheet was not touched');
  // The normal name stays a real unique name: the default generator is exported for tests.
  assert.notEqual(defaultTmpName(sheet), defaultTmpName(sheet), 'two tmp names never collide');
});

test('a regular file at the sheet directory path survives a refused rebuild', pdfTest, (t) => {
  const dir = packedPackage(t, 'sec-pack-sheet-dir-');
  const pack = packetDirOf(dir);
  const occupied = join(pack, 'схемы');
  rmSync(occupied, { recursive: true });
  writeFileSync(occupied, 'preserve this file');
  const before = readdirSync(pack);
  const result = runPack(dir, { withLetter: true });
  assert.notEqual(result.code, 0, result.lines.join('\n'));
  assert.ok(result.lines.join('\n').includes(occupied), result.lines.join('\n'));
  assert.deepEqual(readdirSync(pack), before);
  assert.equal(readFileSync(occupied, 'utf8'), 'preserve this file');
});

test('invalid pack-build names stop cleanup before deleting old outputs', pdfTest, (t) => {
  const dir = packedPackage(t, 'sec-pack-build-names-');
  const pack = packetDirOf(dir);
  const outside = join(dir, 'keep.txt');
  writeFileSync(outside, 'keep');
  rmSync(join(pdfDir(dir), 'pdf-report.json'), { force: true });
  // Simulate an invalid edited build index. The target is an expendable fixture.
  for (const name of ['../../' + basename(dir) + '/keep.txt', outside, 'sub\\keep.drawio']) {
    writeFileSync(join(pdfDir(dir), 'pack-build.json'), JSON.stringify({ merged: MERGED_PDF, sheets: [name] }));
    const result = runPack(dir, { withLetter: true });
    assert.notEqual(result.code, 0, result.lines.join('\n'));
    assert.match(result.lines.join('\n'), /pack-build\.json/u);
    assert.equal(readFileSync(outside, 'utf8'), 'keep');
    assert.ok(existsSync(join(pack, MERGED_PDF)));
  }
});
