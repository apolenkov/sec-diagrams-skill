import { pdfTestOptions } from './pdf-fixtures.ts';
/**
 * The copy for sending, part two: rules reads the copy's own poc.yaml, the open marks
 * survive a rebuild, the road of hints runs end to end, and the leak audit listens to every
 * command - no agent call, not even a refused one, prints a value the person wrote. Every
 * address is from RFC 5737, the marker string is invented.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';
import { runCheck } from './check.ts';

// The road runs the real pdf and pack: load the on-demand engine once, before the first test.
import { pdfDir, runPdf } from './pdf.ts';
import { packetDirOf, runPack } from './pack.ts';
import { runRules } from './rules-page.ts';
import {
  E2E_POC,
  LETTER,
  NL,
  VALUES,
  fakePdf,
  fillCell,
  pocWithPurpose,
  rmDir,
  sendingCopyOfPackage,
  show,
  stublessPackage,
  tempDir,
  workingPackage,
} from './sending-fixtures.ts';

const pdfTest = await pdfTestOptions();

test('rules reads poc.yaml of the copy for sending as that copy reads its sheets', (t) => {
  const dir = workingPackage(t, 'sd-rulesfinal-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-rulesfinal-to');
  const source = readFileSync(join(dir, 'poc.yaml'), 'utf8');
  const poc = join(copy, 'poc.yaml');
  writeFileSync(poc, pocWithPurpose(source, 'согласование до 203.0.113.77'));
  const good = runRules(poc, true);
  assert.equal(good.code, 0, show(good.lines));
  writeFileSync(poc, pocWithPurpose(source, 'сервер 192.0.2.300'));
  const bad = runRules(poc, true);
  assert.equal(bad.code, 1, show(bad.lines));
  assert.ok(show(bad.lines).includes('SD-T04'), show(bad.lines));
  assert.ok(!show(bad.lines).includes('192.0.2.300'), 'the refusal never quotes the value');
  // A working copy still refuses any address in the same text.
  const work = join(dir, 'poc.yaml');
  writeFileSync(work, pocWithPurpose(source, 'сервер 192.0.2.10'));
  assert.equal(runRules(work, true).code, 1, 'a working copy fails any address in a free text');
});

test('the row open list marks the rules cells; a rebuild keeps them marked; unknown fields are SD-E02', (t) => {
  const dir = workingPackage(t, 'sd-openfields-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-openfields-to');
  const source = readFileSync(join(dir, 'poc.yaml'), 'utf8');
  const poc = join(copy, 'poc.yaml');
  const withOpen = (fields: string): string => source
    .replace('        dst_fqdn: "ingest.example.org"\n', '')
    .replace('        src_fqdn: "sensor.example.org"', '        open: [' + fields + ']');
  writeFileSync(poc, withOpen('"src_addr", "dst_fqdn"'));
  assert.equal(runRules(poc, true).code, 0);
  const sheet = join(copy, 'Карта сетевой фильтрации.drawio');
  const marked = (readFileSync(sheet, 'utf8').match(/sdRole=open/g) ?? []).length;
  assert.equal(marked, 2, 'exactly the declared fields carry the mark');
  assert.equal(runRules(poc, true).code, 0);
  assert.equal((readFileSync(sheet, 'utf8').match(/sdRole=open/g) ?? []).length, 2, 'the rebuild re-marks them');
  writeFileSync(poc, withOpen('"bogus"'));
  const wrong = runRules(poc, true);
  assert.equal(wrong.code, 65, show(wrong.lines));
  assert.ok(show(wrong.lines).includes('SD-E02'), show(wrong.lines));
  assert.ok(show(wrong.lines).includes('open'), 'the error names the field path');
});

test('the end to end copy: the road by the hints, values by hand, check clean, pack names the marks', pdfTest, (t) => {
  const dir = workingPackage(t, 'sd-e2e-');
  const first = runCheck(dir, false);
  assert.equal(first.code, 0, show(first.lines));
  assert.ok((first.lines.at(-1) ?? '').includes("'final'"), show(first.lines));
  assert.ok(
    first.lines.some((line) => line.includes('впишет человек') && !line.startsWith('Дальше: ')),
    show(first.lines),
  );

  const parent = tempDir('sd-e2e-to');
  t.after(() => rmDir(parent));
  const copy = join(parent, 'copy');
  const made = runCli(['final', dir, copy]);
  assert.equal(made.code, 0, show(made.lines));
  assert.ok(show(made.lines).includes('вписывает человек'), show(made.lines));

  // The person, not the agent: addresses straight into the copy's sheet and poc.yaml, the rest open.
  fillCell(join(copy, 'l2.drawio'), 'sensor', 'Датчик 192.0.2.0/24');
  fillCell(join(copy, 'l2.drawio'), 'collector', 'Сборщик 198.51.100.10');
  fillCell(join(copy, 'l2.drawio'), 'bridge', 'Шлюз датчиков XX.XX.XX.XX');
  writeFileSync(join(copy, 'poc.yaml'), E2E_POC);
  assert.equal(runRules(join(copy, 'poc.yaml'), true).code, 0);

  const marked = runCheck(copy, true);
  const report = JSON.parse(marked.lines[0] ?? '') as {
    findings: Array<{ code: string; file: string; ids: string[] }>;
  };
  const rulesStubs = report.findings.filter(
    (found) => found.code === 'SD-T08' && found.file.normalize('NFC') === 'Карта сетевой фильтрации.drawio',
  );
  assert.deepEqual(rulesStubs, [], 'the poc.yaml open marks excused every stub on the rules page');
  const stubs = report.findings.filter((found) => found.code === 'SD-T08');
  assert.ok(stubs.length > 0, 'the sheet keeps stubs to mark');
  const openIds = stubs.flatMap((found) => found.ids);
  for (const value of VALUES) assert.ok(!(marked.lines[0] ?? '').includes(value), 'the json report stays blind');

  for (const found of stubs) assert.equal(runCli(['open', join(copy, found.file), ...found.ids]).code, 0);

  const clean = runCheck(copy, false);
  assert.ok(!clean.lines.some((line) => line.startsWith('FAIL')), show(clean.lines));
  assert.equal(clean.code, 0, show(clean.lines));
  assert.ok((clean.lines.at(-1) ?? '').includes("'pdf'"), show(clean.lines));
  for (const value of VALUES) assert.ok(!show(clean.lines).includes(value), 'check stays blind');

  assert.equal(runPdf(copy, { exportSheet: (_source, outPath) => fakePdf(outPath) }).code, 0);
  writeFileSync(join(copy, 'записка.txt'), LETTER);
  const packed = runPack(copy, { withLetter: true });
  const out = show(packed.lines);
  assert.equal(packed.code, 0, out);
  const checklist = readFileSync(join(pdfDir(copy), 'чек-лист.md'), 'utf8');
  assert.ok(checklist.includes('открытых значений ' + openIds.length), checklist);
  assert.ok(checklist.includes('(id: '), 'the checklist names the marked cells');
  const packet = readdirSync(join(packetDirOf(copy), 'схемы'))
    .filter((name) => name.endsWith('.drawio'))
    .map((name) => readFileSync(join(packetDirOf(copy), 'схемы', name), 'utf8'))
    .join(NL);
  assert.ok(packet.includes('192.0.2.0/24'), 'the packed sheet carries the real address');
  for (const value of VALUES) assert.ok(!out.includes(value) && !checklist.includes(value), 'no value is printed');
});

test('no command of the agent prints a value of the copy for sending, errors included', (t) => {
  const dir = workingPackage(t, 'sd-blind-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-blind-to');
  const sheet = join(copy, 'l2.drawio');
  fillCell(sheet, 'sensor', 'Пул 203.0.113.77 MARKER-7f3a');
  fillCell(sheet, 'collector', 'Сборщик XX.XX.XX.XX');
  const source = readFileSync(join(dir, 'poc.yaml'), 'utf8');
  const poc = join(copy, 'poc.yaml');
  writeFileSync(poc, pocWithPurpose(source, 'согласование MARKER-7f3a до 192.0.2.10'));

  const heard: string[] = [];
  const listen = (name: string, result: { code: number; lines: string[] }): number => {
    heard.push(name + ' ' + show(result.lines));
    return result.code;
  };
  assert.equal(listen('rules', runRules(poc, true)), 0, show(runRules(poc, true).lines));
  assert.equal(listen('check', runCheck(copy, false)), 1, 'the left stub still fails');
  assert.equal(listen('check json', runCheck(copy, true)), 1);
  listen('pack', runPack(copy));
  listen('fix', runCli(['fix', '--safe', copy]));
  assert.equal(listen('style ok', runCli(['style', 'set', sheet, 'sensor', 'fontSize=14'])), 0);
  listen('style bad', runCli(['style', 'set', sheet, 'sensor', 'color=красный']));
  assert.equal(listen('open unknown', runCli(['open', sheet, 'нет-такой-ид'])), 64);
  assert.equal(listen('open', runCli(['open', sheet, 'collector'])), 0);
  assert.equal(listen('open undo', runCli(['open', '--undo', sheet, 'collector'])), 0);
  assert.equal(listen('text get', runCli(['text', 'get', sheet, 'sensor'])), 64);
  assert.equal(listen('text set', runCli(['text', 'set', sheet, 'sensor', 'Пул 192.0.2.1'])), 64);
  listen('final twice', runCli(['final', copy, join(copy, '-again')]));
  writeFileSync(poc, 'sheet: [ MARKER-7f3a');
  assert.equal(listen('rules broken yaml', runRules(poc, true)), 65);
  writeFileSync(
    poc,
    'sheet: "x"\ntables:\n  - from: "a"\n    to: "b"\n    rows:\n      - src: "c"\n        dst: "d"\n        port: 443\n        proto: "TCP"\n        purpose: "MARKER-7f3a 203.0.113.77"\nwhitelist: []\nnotes: []\n',
  );
  assert.equal(listen('rules zod', runRules(poc, true)), 65);
  writeFileSync(poc, pocWithPurpose(source, 'сервер 192.0.2.999 MARKER-7f3a'));
  assert.equal(listen('rules text', runRules(poc, true)), 1);

  const every = heard.join(NL);
  for (const value of VALUES) assert.ok(!every.includes(value), 'a value leaked into the output');
});

test('pack of a working copy says the review packet is the final copy', pdfTest, (t) => {
  const dir = workingPackage(t, 'sd-pack-working-');
  assert.equal(runPdf(dir, { exportSheet: (_source, outPath) => fakePdf(outPath) }).code, 0);
  writeFileSync(join(dir, 'записка.txt'), LETTER);
  const packed = runPack(dir, { withLetter: true });
  assert.equal(packed.code, 0, show(packed.lines));
  const checklist = readFileSync(join(pdfDir(dir), 'чек-лист.md'), 'utf8');
  assert.ok(checklist.includes('рабочая копия: на проверку отправляй копию с настоящими значениями (final)'), checklist);
});

test('a final copy with nothing open says the letter paragraph goes away', pdfTest, (t) => {
  const dir = stublessPackage(t, 'sd-final-empty-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-final-empty-to');
  assert.equal(runPdf(copy, { exportSheet: (_source, outPath) => fakePdf(outPath) }).code, 0);
  writeFileSync(join(copy, 'записка.txt'), LETTER);
  const packed = runPack(copy, { withLetter: true });
  assert.equal(packed.code, 0, show(packed.lines));
  const checklist = readFileSync(join(pdfDir(copy), 'чек-лист.md'), 'utf8');
  assert.ok(checklist.includes('открытых значений нет'), checklist);
});
