import { pdfTestOptions } from './pdf-fixtures.ts';
/**
 * The copy for sending reaches further than its folder: the packet that pack
 * builds from it is a sending copy too, a manifest that cannot be read refuses value commands
 * instead of guessing "working copy", SD-E01 never quotes an attribute value, and every write
 * is atomic, mode-preserving and honest about what it changed. Every address is from RFC 5737.
 */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';
import { runCheck } from './check.ts';

import { runPdf } from './pdf.ts';
import { packetDirOf, runPack } from './pack.ts';
import { COPY_MARKER } from './values-guard.ts';
import {
  LETTER,
  fakePdf,
  fillCell,
  rmDir,
  sendingCopyOfPackage,
  show,
  stublessPackage,
  tempDir,
  workingPackage,
} from './sending-fixtures.ts';

const pdfTest = await pdfTestOptions();

test('the packet of a sending copy is a sending copy; the packet of a working copy is not', pdfTest, (t) => {
  const dir = stublessPackage(t, 'sd-guard-packet-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-guard-packet-to');
  assert.equal(runPdf(copy, { exportSheet: (_source, outPath) => fakePdf(outPath) }).code, 0);
  writeFileSync(join(copy, 'записка.txt'), LETTER);
  const packed = runPack(copy, { withLetter: true });
  assert.equal(packed.code, 0, show(packed.lines));
  const packet = packetDirOf(copy);
  assert.ok(existsSync(join(packet, COPY_MARKER)), 'pack leaves the copy marker in the packet');
  const sheet = join(packet, 'схемы', 'Зоны и узлы__L2.drawio');
  const get = runCli(['text', 'get', sheet, 'sensor']);
  assert.equal(get.code, 64, show(get.lines));
  assert.ok(show(get.lines).includes('маркер'), 'the packet marker is what closes it: ' + show(get.lines));
  fillCell(sheet, 'sensor', 'Пул XX.XX.XX.XX');
  const checked = runCheck(join(packet, 'схемы'), false);
  assert.ok(
    checked.lines.some((line) => line.startsWith('FAIL SD-T08')),
    'check on the packet reads it as a copy for sending: ' + show(checked.lines),
  );

  // The same run over the working copy marks nothing: its packet is not a sending copy.
  assert.equal(runPdf(dir, { exportSheet: (_source, outPath) => fakePdf(outPath) }).code, 0);
  writeFileSync(join(dir, 'записка.txt'), LETTER);
  assert.equal(runPack(dir, { withLetter: true }).code, 0);
  assert.ok(!existsSync(join(packetDirOf(dir), COPY_MARKER)), 'a working packet carries no marker');
  const workingPacketGet = runCli([
    'text',
    'get',
    join(packetDirOf(dir), 'схемы', 'Зоны и узлы__L2.drawio'),
    'sensor',
  ]);
  assert.equal(
    workingPacketGet.code,
    64,
    'no manifest next to the packed sheets either: ' + show(workingPacketGet.lines),
  );
});

test('value commands open only a confirmed working copy: no manifest and a broken one refuse', (t) => {
  // «разрешено, где подтверждено»: the absence of a manifest is no longer a guess of a plain
  // working copy - the sheet's values are closed until a manifest says "final": false.
  const dir = tempDir('sd-guard-manifest-');
  t.after(() => rmDir(dir));
  const sheet = join(dir, 'l1.drawio');
  writeFileSync(sheet, readFileSync(join(import.meta.dirname, '..', 'content', 'templates', 'l1.drawio')));
  const bare = runCli(['text', 'get', sheet, 'collector']);
  assert.equal(bare.code, 64, 'without a manifest the working copy is not confirmed: ' + show(bare.lines));
  assert.ok((bare.lines.at(-1) ?? '').startsWith('Человеку: '), show(bare.lines));
  writeFileSync(join(dir, 'manifest.json'), '{ "service": "Служба ИБ", ');
  const broken = runCli(['text', 'get', sheet, 'collector']);
  assert.equal(broken.code, 64, show(broken.lines));
  assert.ok(show(broken.lines).includes('manifest.json'), show(broken.lines));
  assert.equal(runCli(['text', 'set', sheet, 'collector', 'Сборщик']).code, 64, 'and so is text set');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      { service: 'Служба ИБ', titlePrefix: '', final: false, sheets: [{ file: 'l1.drawio', level: 'L1', topic: 'Т' }] },
      null,
      2,
    ),
  );
  assert.equal(runCli(['text', 'get', sheet, 'collector']).code, 0, 'the confirmed copy opens again');
});

test('SD-E01 names the cell and the attribute, never the referenced value', (t) => {
  const dir = tempDir('sd-guard-blind-');
  t.after(() => rmDir(dir));
  writeFileSync(
    join(dir, 'l1.drawio'),
    '<mxfile><diagram name="L1"><mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="e1" edge="1" parent="1" source="192.0.2.99" target="1"/></root></mxGraphModel></diagram></mxfile>',
  );
  const result = runCli(['check', dir]);
  const out = show(result.lines);
  assert.equal(result.code, 65, out);
  assert.ok(out.includes('e1') && out.includes('source'), 'the line names the cell and the attribute: ' + out);
  assert.ok(!out.includes('192.0.2.99'), 'the referenced value never reaches the console: ' + out);
});

test('a write keeps the mode, refuses a read-only file and never touches a foreign tmp file', (t) => {
  const dir = tempDir('sd-guard-write-');
  t.after(() => rmDir(dir));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      { service: 'Служба ИБ', titlePrefix: '', final: false, sheets: [{ file: 'l1.drawio', level: 'L1', topic: 'Т' }] },
      null,
      2,
    ),
  );
  const file = join(dir, 'l1.drawio');
  writeFileSync(
    file,
    '<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="k1" value="старое" vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell>' +
      '</root></mxGraphModel></diagram></mxfile>',
  );
  chmodSync(file, 0o640);
  const foreign = join(dir, 'l1.drawio.tmp');
  writeFileSync(foreign, 'чужой временный файл\n');
  assert.equal(runCli(['text', 'set', file, 'k1', 'новое']).code, 0);
  assert.equal(readFileSync(foreign, 'utf8'), 'чужой временный файл\n', 'a foreign .tmp is nobody to remove');
  assert.equal(readFileSync(file, 'utf8').includes('новое'), true);
  chmodSync(file, 0o444);
  const refused = runCli(['text', 'set', file, 'k1', 'еще']);
  assert.ok(refused.code >= 64, 'a read-only file is refused, not written: ' + show(refused.lines));
  assert.ok(!readFileSync(file, 'utf8').includes('еще'), 'the refused write changed nothing');
  assert.equal(readFileSync(file, 'utf8').includes('новое'), true, 'the earlier value stays');
  assert.equal(readFileSync(foreign, 'utf8'), 'чужой временный файл\n');
});

test('fix --safe gives back the first sheet when the second one cannot be written', (t) => {
  const dir = tempDir('sd-guard-rollback-');
  t.after(() => {
    chmodSync(join(dir, 'b.drawio'), 0o644);
    rmDir(dir);
  });
  const sheet = (value: string): string =>
    '<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="k1" value="' +
    value +
    '" style="whiteSpace=wrap;" vertex="1" parent="1">' +
    '<mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        service: 'Служба ИБ',
        titlePrefix: '',
        final: false,
        sheets: [
          { file: 'a.drawio', level: 'L1', topic: 'А' },
          { file: 'b.drawio', level: 'L2', topic: 'Б' },
        ],
      },
      null,
      2,
    ),
  );
  const first = join(dir, 'a.drawio');
  const second = join(dir, 'b.drawio');
  writeFileSync(first, sheet('Ёмкость 100—200'));
  writeFileSync(second, sheet('Буфер 300—400'));
  const before = readFileSync(first, 'utf8');
  chmodSync(second, 0o444);
  const result = runCli(['fix', '--safe', dir]);
  assert.ok(result.code >= 64, 'the run reports the failure: ' + show(result.lines));
  assert.equal(
    readFileSync(first, 'utf8'),
    before,
    'the fixed first sheet is given back: ' + readFileSync(first, 'utf8'),
  );
  assert.ok(!show(result.lines).includes('файл навык не менял') || readFileSync(first, 'utf8') === before);
});

test('final builds beside the target and renames: a failure leaves no half folder, a nested target is refused', (t) => {
  const dir = workingPackage(t, 'sd-guard-final-');
  const parent = tempDir('sd-guard-final-to');
  t.after(() => rmDir(parent));
  const copy = join(parent, 'copy');
  chmodSync(join(dir, 'l2.drawio'), 0o000);
  const failed = runCli(['final', dir, copy]);
  chmodSync(join(dir, 'l2.drawio'), 0o644);
  assert.ok(failed.code >= 64, 'an unreadable sheet fails the run: ' + show(failed.lines));
  assert.ok(!existsSync(copy), 'a failed copy leaves no half folder behind');
  assert.equal(runCli(['final', dir, copy]).code, 0, 'the retry after the fix builds the copy');
  assert.ok(existsSync(join(copy, 'manifest.json')));
  assert.equal(runCli(['final', dir, join(dir, 'inner')]).code, 64, 'a copy inside the source is a bad call');
});

test('fix --safe in a sending copy only styles: text stays for the person, with code and id', (t) => {
  const dir = workingPackage(t, 'sd-guard-fixcopy-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-guard-fixcopy-to');
  const sheet = join(copy, 'l2.drawio');
  fillCell(sheet, 'sensor', 'Ёмкость «пул» 100—200 192.0.2.0/24');
  assert.equal(runCli(['style', 'set', join(copy, 'l2.drawio'), 'collector', 'fontFamily=Courier']).code, 0);
  const result = runCli(['fix', '--safe', copy]);
  const out = show(result.lines);
  assert.equal(result.code, 0, out);
  const after = readFileSync(sheet, 'utf8');
  assert.ok(after.includes('Ёмкость «пул» 100—200'), 'the value stays exactly as the person wrote it: ' + out);
  assert.ok(out.includes('SD-T01') && out.includes('sensor'), 'the run prints the code and the id: ' + out);
  assert.ok(out.includes('человек'), 'and says who fixes the text: ' + out);
  assert.ok(!after.includes('fontFamily=Courier'), 'styles are still fixed');
});
