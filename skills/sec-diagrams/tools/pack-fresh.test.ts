import { pdfTestOptions } from './pdf-fixtures.ts';
/**
 * pack must write nothing before every manifest sheet is proven fresh, the packet
 * it refuses must not keep sheets from the previous assembly, names match in NFC wherever the
 * manifest hands them over, a manifest that lists one file twice is SD-E02, and a pdf run
 * without draw.io does not walk the agent into pack. Every address is from RFC 5737.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';

import { mergedPdfName, packetDirOf, runPack } from './pack.ts';
import { pdfDir, runPdf } from './pdf.ts';
import { LETTER, fakePdf, rmDir, show, workingPackage } from './sending-fixtures.ts';

/** Runs the pdf stage with the fake exporter; the package comes back ready for pack. */
function ready(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = workingPackage(t, prefix);
  t.after(() => {
    rmDir(pdfDir(dir));
    rmDir(packetDirOf(dir));
  });
  assert.equal(runPdf(dir, { exportSheet: (_source, outPath) => fakePdf(outPath) }).code, 0);
  writeFileSync(join(dir, 'записка.txt'), LETTER);
  return dir;
}

const pdfTest = await pdfTestOptions();

test('pack builds twice with a service name containing forbidden filename characters', pdfTest, (t) => {
  const dir = ready(t, 'sd-pack-service-');
  const manifest = join(dir, 'manifest.json');
  const service = 'Обзор: сеть/датчики?';
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('Служба ИБ', service));
  for (let run = 0; run < 2; run++) {
    const result = runPack(dir);
    assert.equal(result.code, 0, show(result.lines));
  }
  const { merged } = JSON.parse(readFileSync(join(pdfDir(dir), 'pack-build.json'), 'utf8'));
  assert.doesNotMatch(merged, /[:/?]/u);
  assert.ok(existsSync(join(packetDirOf(dir), merged)));
});

test('a refusal writes nothing: the packet keeps neither the old merge nor the old sheet copies', pdfTest, (t) => {
  const dir = ready(t, 'sd-pack-refuse-');
  assert.equal(runPack(dir).code, 0);
  const pack = packetDirOf(dir);
  writeFileSync(join(dir, 'l1.drawio'), readFileSync(join(dir, 'l1.drawio'), 'utf8') + '<!-- правка -->\n');
  const result = runPack(dir);
  const out = show(result.lines);
  assert.equal(result.code, 2, out);
  assert.ok(out.includes('PDF устарел: l1.drawio'), out);
  assert.ok(!readFileSync(join(pack, 'записка.txt'), 'utf8').includes('правка'), 'the letter stays for the next run');
  assert.equal(existsSync(join(pack, mergedPdfName('Служба ИБ', 4))), false, 'the old merge is gone: ' + out);
  for (const name of readdirSheetNames(pack)) {
    assert.fail('the packet still holds a sheet copy: ' + name);
  }
});

function readdirSheetNames(pack: string): string[] {
  const sheetDir = join(pack, 'схемы');
  return existsSync(sheetDir) ? readdirSync(sheetDir) : [];
}

test('a merge from an older composition is removed when pack builds, not left as a foreign file', pdfTest, (t) => {
  const dir = ready(t, 'sd-pack-oldmerge-');
  const pack = packetDirOf(dir);
  writeFileSync(join(pack, 'keep.txt') && join(dir, 'записка.txt'), LETTER);
  const result = runPack(dir);
  assert.equal(result.code, 0, show(result.lines));
  writeFileSync(join(pack, mergedPdfName('Служба ИБ', 9)), 'старая склейка');
  const second = runPack(dir);
  assert.equal(second.code, 0, show(second.lines));
  assert.equal(existsSync(join(pack, mergedPdfName('Служба ИБ', 9))), false, 'the older merge is removed');
  assert.ok(existsSync(join(pack, mergedPdfName('Служба ИБ', 4))), 'the current merge stands');
});

test('pack leaves unrelated files beside the PDF report alone', pdfTest, (t) => {
  const dir = ready(t, 'sd-pack-report-notes-');
  const notes = join(pdfDir(dir), 'заметки.pdf');
  writeFileSync(notes, 'личные заметки');
  assert.equal(runPack(dir).code, 0);
  assert.equal(readFileSync(notes, 'utf8'), 'личные заметки');
});

test('a pdf-report without the manifest sheets refuses pack before anything is copied', pdfTest, (t) => {
  const dir = workingPackage(t, 'sd-pack-partial-');
  writeFileSync(join(dir, 'записка.txt'), LETTER);
  const saved = process.env['SD_DRAWIO'];
  process.env['SD_DRAWIO'] = '/nonexistent';
  try {
    assert.equal(runCli(['pdf', dir]).code, 2);
  } finally {
    if (saved === undefined) delete process.env['SD_DRAWIO'];
    else process.env['SD_DRAWIO'] = saved;
  }
  const result = runPack(dir);
  const out = show(result.lines);
  assert.equal(result.code, 2, out);
  assert.ok(out.includes('PDF не строен по листу: l1.drawio'), out);
  assert.equal(existsSync(packetDirOf(dir)), false, 'a half report assembles nothing');
});

test('a manifest that lists the same file twice is SD-E02', pdfTest, (t) => {
  const dir = workingPackage(t, 'sd-pack-double-');
  const path = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { sheets: unknown[] };
  manifest.sheets.push(manifest.sheets[0]);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  const result = runCli(['check', dir]);
  const out = show(result.lines);
  assert.equal(result.code, 65, out);
  assert.ok(out.includes('SD-E02') && out.includes('duplicate'), 'the second entry is named: ' + out);
});

test('the manifest sheet name in NFD still matches the NFC report: no false PDF-не-строен', pdfTest, (t) => {
  const dir = workingPackage(t, 'sd-pack-nfd-manifest-');
  const nfc = 'Карта сетевой фильтрации.drawio';
  const nfd = nfc.normalize('NFD');
  if (nfc === nfd) return;
  const path = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { sheets: Array<{ file: string }> };
  const entry = manifest.sheets.find((sheet) => sheet.file === nfc);
  assert.ok(entry !== undefined, 'the rules sheet is in the manifest');
  entry.file = nfd;
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  assert.equal(runPdf(dir, { exportSheet: (_source, outPath) => fakePdf(outPath) }).code, 0);
  writeFileSync(join(dir, 'записка.txt'), LETTER);
  assert.equal(runPack(dir).code, 0);
  assert.equal(existsSync(join(packetDirOf(dir), 'схемы', nfc)), false);
  const result = runPack(dir, { withRules: true });
  const out = show(result.lines);
  assert.equal(result.code, 0, out);
  assert.ok(existsSync(join(packetDirOf(dir), 'схемы', nfc)), 'the packed sheet keeps the manifest name');
});

test('pdf without draw.io ends with the person, not with pack', pdfTest, (t) => {
  const dir = workingPackage(t, 'sd-pack-nodrawio-');
  const saved = process.env['SD_DRAWIO'];
  process.env['SD_DRAWIO'] = '/nonexistent';
  try {
    const result = runPdf(dir);
    const out = show(result.lines);
    assert.equal(result.code, 2, out);
    assert.ok(out.includes('SD-P04'), out);
    assert.ok(!out.includes("'pack'"), 'the run never sends the agent to pack: ' + out);
    assert.ok(String(result.lines.at(-1)).startsWith('Человеку:'), 'the last line is the person: ' + out);
    assert.ok(String(result.lines.at(-1)).includes('PDF не проверен'), 'and says what is not checked: ' + out);
  } finally {
    if (saved === undefined) delete process.env['SD_DRAWIO'];
    else process.env['SD_DRAWIO'] = saved;
  }
});
