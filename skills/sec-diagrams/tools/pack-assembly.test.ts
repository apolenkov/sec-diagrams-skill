import { pdfTestOptions } from './pdf-fixtures.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';
import { GOOD_LETTER, MERGED_PDF, PACKET_NAMES, readyPackage, rmDir, tempDir } from './pack-fixtures.ts';
import { mergedPdfName, packetDirOf, runPack } from './pack.ts';
import { openPdfDocument } from './pdf-gate.ts';
import { pdfDir } from './pdf.ts';
import { writeChecklist } from './pack-checklist.ts';
import { ProfileError, loadManifest } from './profile.ts';
import { RULES_SHEET_FILE } from './rules-page.ts';
import { initFolder } from './templates.ts';

const SHEET_TO_PACKET: ReadonlyArray<readonly [string, string]> = [
  ['l1.drawio', 'Общая схема__L1.drawio'],
  ['l2.drawio', 'Зоны и узлы__L2.drawio'],
  ['l3-1.drawio', PACKET_NAMES[2] as string],
  ['l3-2.drawio', PACKET_NAMES[3] as string],
];

const PACKET_TOP = ['схемы', 'записка.txt', MERGED_PDF].sort();

const lettersOf = (dir: string): string[] => readdirSync(dir).sort();

const pdfTest = await pdfTestOptions();

test('the manual checklist labels YAML paths and draw.io cell ids separately', (t) => {
  const dir = tempDir('sd-checklist-ids-');
  t.after(() => { rmDir(dir); rmDir(pdfDir(dir)); });
  assert.equal(initFolder(dir).code, 0);
  const path = writeChecklist(dir, loadManifest(dir), [
    { code: 'SD-R01', file: 'poc.yaml', page: '-', reason: 'link-legend-unknown', ids: ['tables.0.rows.0.link'] },
    { code: 'SD-T05', file: 'l1.drawio', page: 'L1', reason: 'placeholder-unresolved', ids: ['node-7'] },
  ], [], { status: 'NOT_CHECKED', files: [] }, { path: null, name: '', line: '', status: 'NOT_CHECKED' });
  const checklist = readFileSync(path, 'utf8');
  assert.match(checklist, /SD-R01.*поля YAML `tables\.0\.rows\.0\.link`/u);
  assert.match(checklist, /SD-T05.*ячейки `node-7`/u);
});

test('pack without manifest.json says the file is missing and points at init', pdfTest, (t) => {
  const dir = tempDir('sd-pack-nomanifest-');
  t.after(() => rmDir(dir));
  const result = runPack(dir);
  const out = result.lines.join('\n');
  assert.equal(result.code, 65, out);
  assert.ok(out.includes('manifest.json: файла нет'), out);
  assert.ok(out.includes('Дальше: node ') && out.includes("'init'"), 'the next step is init: ' + out);
});

test('sheet names stored decomposed still match the NFC manifest (SD-K01)', pdfTest, (t) => {
  // Finder and some editors hand back Cyrillic names in NFD; the manifest keeps NFC. The old
  // compare saw two different files in one sheet and reported SD-K01 both ways.
  const dir = readyPackage(t, 'sd-pack-nfd-');
  const nfc = 'Карта сетевой фильтрации.drawio';
  const nfd = nfc.normalize('NFD');
  if (nfc === nfd) return;
  // The lookup is normalization-insensitive, the stored bytes are not: rename keeps one file
  // and leaves readdirSync returning the decomposed name, which is what the manifest compare saw.
  renameSync(join(dir, nfc), join(dir, nfd));
  assert.ok(readdirSync(dir).includes(nfd), 'the sheet name on disk is decomposed now');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);

  const result = runPack(dir, { withRules: true });
  const out = result.lines.join('\n');
  assert.ok(!out.includes('SD-K01'), 'NFD bytes must not read as a missing sheet: ' + out);
  const packDir = packetDirOf(dir);
  assert.ok(existsSync(join(packDir, 'схемы', nfc)), 'the packed sheet keeps the manifest name');
});

test('pack assembles a merged PDF and editable sheets without creating a note', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-default-');
  const result = runCli(['pack', dir]);
  const out = result.lines.join('\n');
  assert.equal(result.code, 0, out);
  const packet = packetDirOf(dir);
  assert.deepEqual(lettersOf(packet), ['схемы', MERGED_PDF].sort());
  assert.deepEqual(lettersOf(join(packet, 'схемы')), PACKET_NAMES);
  assert.equal(openPdfDocument(readFileSync(join(packet, MERGED_PDF)))?.countPages(), PACKET_NAMES.length);
  assert.ok(!existsSync(join(dir, 'записка.txt')));
  assert.doesNotMatch(out, /записка\.txt/u);
  assert.doesNotMatch(readFileSync(join(pdfDir(dir), 'чек-лист.md'), 'utf8'), /записка\.txt/u);
});

test('pack --with-letter assembles four renamed sheets, the letter, the merged PDF and the checklist', pdfTest, (t) => {
  const dir = readyPackage(t);
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  const result = runCli(['pack', dir, '--with-letter']);
  const out = result.lines.join('\n');
  assert.equal(result.code, 0, out);
  const packDir = packetDirOf(dir);
  assert.equal(packDir, dir + '-обзор');
  assert.equal(MERGED_PDF, 'Обзор__Служба ИБ__4.pdf');
  assert.deepEqual(lettersOf(packDir), PACKET_TOP, 'the packet holds the PDF, the letter and схемы/ only');
  assert.deepEqual(lettersOf(join(packDir, 'схемы')), PACKET_NAMES, 'the sheets ride under схемы/');
  for (const [source, packed] of SHEET_TO_PACKET) {
    assert.deepEqual(
      readFileSync(join(packDir, 'схемы', packed)),
      readFileSync(join(dir, source)),
      'sheet bytes are preserved: ' + packed,
    );
  }
  assert.deepEqual(
    readFileSync(join(packDir, 'записка.txt')),
    readFileSync(join(dir, 'записка.txt')),
    'the letter rides in the packet',
  );
  assert.ok(existsSync(join(packDir, MERGED_PDF)), 'the merged PDF lives inside the packet');
  const checklist = readFileSync(join(pdfDir(dir), 'чек-лист.md'), 'utf8');
  assert.match(checklist, /записка\.txt/u);
  for (const source of ['NIST SP 800-41 Rev. 1, § 5.2.2', 'RFC 3022, § 3.1', 'RFC 8446, § 2', 'Crop and Fit to page']) {
    assert.ok(checklist.includes(source), source);
  }
  assert.ok(out.includes(`PACK ${packDir}: ${PACKET_NAMES.length} .drawio, записка.txt, ${MERGED_PDF}`), out);
  assert.ok(out.includes('PDF: ' + join(packDir, MERGED_PDF)), out);
  assert.ok(out.includes('PASS ' + MERGED_PDF + ': стр 4'), 'the merged PDF passes the gate');
  assert.ok(out.includes('ИТОГ: PASS'));
  assert.equal(result.lines.at(-1), 'Человеку: пройди чек-лист глазами');
});

test('pack combines both flags in either order and can rebuild a legacy packet without the extras', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-both-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  const packet = packetDirOf(dir);
  const names = [...PACKET_NAMES, RULES_SHEET_FILE].sort();
  const merged = mergedPdfName('Служба ИБ', names.length);
  for (const flags of [['--with-rules', '--with-letter'], ['--with-letter', '--with-rules']]) {
    const result = runCli(['pack', dir, ...flags]);
    assert.equal(result.code, 0, result.lines.join('\n'));
    assert.deepEqual(lettersOf(packet), ['схемы', merged, 'записка.txt'].sort());
    assert.deepEqual(lettersOf(join(packet, 'схемы')), names);
    assert.equal(openPdfDocument(readFileSync(join(packet, merged)))?.countPages(), names.length);
  }
  const buildList = join(pdfDir(dir), 'pack-build.json');
  writeFileSync(buildList, JSON.stringify({ merged, sheets: names }));
  const result = runCli(['pack', dir]);
  assert.equal(result.code, 0, result.lines.join('\n'));
  assert.deepEqual(lettersOf(packet), ['схемы', MERGED_PDF].sort());
  assert.deepEqual(lettersOf(join(packet, 'схемы')), PACKET_NAMES);
  assert.equal(readFileSync(join(dir, 'записка.txt'), 'utf8'), GOOD_LETTER);
});

test('pack protects a note added by hand to a packet built without a note', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-foreign-letter-');
  assert.equal(runCli(['pack', dir]).code, 0);
  const letter = join(packetDirOf(dir), 'записка.txt');
  writeFileSync(letter, GOOD_LETTER);
  const result = runCli(['pack', dir]);
  assert.equal(result.code, 1, result.lines.join('\n'));
  assert.match(result.lines.join('\n'), /FAIL SD-K02 записка\.txt/u);
  assert.equal(readFileSync(letter, 'utf8'), GOOD_LETTER);
  assert.ok(!existsSync(join(dir, 'записка.txt')));
});

test('a foreign file in the packet directory is SD-K02 and nothing is written', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-foreign-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  mkdirSync(packetDirOf(dir));
  writeFileSync(join(packetDirOf(dir), 'чужой.txt'), 'не трогать\n');
  const result = runPack(dir, { withLetter: true });
  const out = result.lines.join('\n');
  assert.equal(result.code, 1, out);
  assert.ok(out.includes('FAIL SD-K02 чужой.txt'), out);
  assert.deepEqual(lettersOf(packetDirOf(dir)), ['чужой.txt'], 'nothing was copied over');
  assert.ok(!existsSync(join(pdfDir(dir), 'чек-лист.md')));
});

test('a Visio subfolder of .vsdx copies is not a foreign file', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-visio-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  mkdirSync(join(packetDirOf(dir), 'Visio'), { recursive: true });
  writeFileSync(join(packetDirOf(dir), 'Visio', 'L1.vsdx'), 'fake vsdx\n');
  const result = runPack(dir, { withLetter: true });
  const out = result.lines.join('\n');
  assert.equal(result.code, 0, out);
  assert.deepEqual(lettersOf(packetDirOf(dir)), [...PACKET_TOP, 'Visio'].sort());
  assert.ok(existsSync(join(packetDirOf(dir), 'Visio', 'L1.vsdx')), 'the Visio copy stays in place');
});

test('a non-vsdx file inside the Visio subfolder is SD-K02', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-visio-bad-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  mkdirSync(join(packetDirOf(dir), 'Visio'), { recursive: true });
  writeFileSync(join(packetDirOf(dir), 'Visio', 'записка.txt'), 'не vsdx\n');
  const result = runPack(dir, { withLetter: true });
  const out = result.lines.join('\n');
  assert.equal(result.code, 1, out);
  assert.ok(out.includes('FAIL SD-K02 Visio'), out);
});

test('a repeated pack rebuilds the same packet and the merged PDF keeps its page count', pdfTest, (t) => {
  // The merge is rebuilt from the fitted sheets every run, never appended to itself.
  const dir = readyPackage(t, 'sd-pack-twice-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  assert.equal(runPack(dir, { withLetter: true }).code, 0);
  const merged = join(packetDirOf(dir), MERGED_PDF);
  const document = openPdfDocument(readFileSync(merged));
  assert.equal(document?.countPages(), 4);
  assert.equal(runPack(dir, { withLetter: true }).code, 0, 'the second pack runs clean');
  const again = openPdfDocument(readFileSync(merged));
  assert.equal(again?.countPages(), 4, 'a second pack never grows the merge');
  assert.deepEqual(lettersOf(packetDirOf(dir)), PACKET_TOP);
});

test('a manifest that packs two sheets under one name fails SD-E02 before any write', pdfTest, (t) => {
  const dir = tempDir('sd-pack-twins-');
  t.after(() => rmDir(dir));
  assert.equal(initFolder(dir).code, 0);
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    sheets: Array<{ file: string; level: string; topic: string }>;
  };
  const first = manifest.sheets[0];
  const second = manifest.sheets[1];
  if (first === undefined || second === undefined) throw new Error('template manifest too small');
  // Two different source files whose packed names clash once compared in NFC, case-insensitive.
  first.level = 'L1';
  first.topic = 'Тема';
  second.level = 'L1';
  second.topic = 'ТЕМА';
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  assert.throws(
    () => loadManifest(dir),
    (error: unknown) => error instanceof ProfileError,
    'the clash is a manifest error, not a silent overwrite',
  );
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  const result = runPack(dir, { withLetter: true });
  assert.equal(result.code, 65, result.lines.join('\n'));
  assert.ok(!existsSync(packetDirOf(dir)), 'SD-E02 stops before any write');
});

test('a foreign file inside draw.io is SD-K02 too', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-subforeign-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  assert.equal(runPack(dir, { withLetter: true }).code, 0);
  writeFileSync(join(packetDirOf(dir), 'схемы', 'черновик.txt'), 'руками\n');
  const result = runPack(dir, { withLetter: true });
  const out = result.lines.join('\n');
  assert.equal(result.code, 1, out);
  assert.ok(out.includes('FAIL SD-K02'), out);
  assert.ok(out.includes('черновик.txt'), out);
});
