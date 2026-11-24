import { pdfTestOptions } from './pdf-fixtures.ts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';
import { GOOD_LETTER, MERGED_PDF, fakePdf, readyPackage, rmDir, tempDir } from './pack-fixtures.ts';
import { packetDirOf, runPack } from './pack.ts';
import { buildPdf } from './pdf-fixtures.ts';
import { pdfDir, runPdf } from './pdf.ts';
import { runRules } from './rules-page.ts';
import { initFolder } from './templates.ts';

const pdfTest = await pdfTestOptions();

test('pack accepts author warnings and still rejects a two-way arrow', pdfTest, (t) => {
  const dir = readyPackage(t);
  const sheet = join(dir, 'l1.drawio');
  const original = readFileSync(sheet, 'utf8');
  const changed = original.replace('strokeColor=#2867a6', 'dashed=1;strokeColor=#2867a6')
    .replace('pageWidth="1654"', 'pageWidth="1653"');
  writeFileSync(sheet, changed);
  const denySheet = join(dir, 'l3-1.drawio');
  const denyNumber = '<mxCell id="deny-number" value="9" vertex="1" parent="e-deny" ' +
    'style="edgeLabel;fontFamily=Arial;fontSize=14;"><mxGeometry relative="1" as="geometry"/></mxCell>';
  writeFileSync(denySheet, readFileSync(denySheet, 'utf8')
    .replace('strokeColor=#64748b;endArrow=cross', 'strokeColor=#64748b;endArrow=none')
    .replace('</root>', denyNumber + '</root>'));
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  const check = runCli(['check', dir, '--json']);
  assert.equal(check.code, 0);
  const report = JSON.parse(check.lines[0]!);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.warnings.map((w: { code: string }) => w.code).sort(), ['SD-L01', 'SD-L02', 'SD-P02']);
  assert.ok(report.warnings.some((w: { ids: string[] }) => w.ids.includes('deny-number')));
  const dense = Array.from({ length: 62 }, (_, index) => ({
    x: 50, y: 50 + index * 12, size: 8, body: 'M'.repeat(110),
  }));
  const pdf = runPdf(dir, { exportSheet: (src, out) => {
    if (src === sheet) writeFileSync(out, buildPdf({ pages: [{ widthMm: 400, heightMm: 277, lines: dense }] }));
    else fakePdf(out);
  } });
  assert.equal(pdf.code, 0);
  const pack = runPack(dir);
  assert.equal(pack.code, 0, pack.lines.join('\n'));
  for (const code of ['SD-L01', 'SD-L02', 'SD-P02']) {
    assert.ok(pack.lines.some(line => line.startsWith('WARN ' + code) && line.includes('рекомендация по оформлению')));
  }
  assert.ok(pack.lines.some(line => line.includes('WARN SD-P03 - рекомендация по оформлению')));
  assert.ok(existsSync(join(packetDirOf(dir), 'записка.txt')));
  writeFileSync(sheet, changed.replace('dashed=1;', 'startArrow=classic;dashed=1;'));
  const blocked = runPack(dir);
  assert.equal(blocked.code, 1);
  assert.ok(blocked.lines.some(line => line.startsWith('FAIL SD-L05')));
});

test('a sheet edited after pdf is stale: exit 2, the packet is not assembled', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-stale-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  writeFileSync(join(dir, 'l1.drawio'), readFileSync(join(dir, 'l1.drawio'), 'utf8') + '<!-- правка -->\n');
  const result = runPack(dir);
  const out = result.lines.join('\n');
  assert.equal(result.code, 2, out);
  assert.ok(out.includes('PDF устарел: l1.drawio'), out);
  assert.ok(!existsSync(packetDirOf(dir)), 'stale pdf never assembles a packet');
  assert.ok(result.lines.at(-1)?.includes("'pdf'"), 'Дальше names the pdf command');
});

test('a NOT_CHECKED report assembles nothing: no merge, no packet, exit 2', pdfTest, (t) => {
  const dir = tempDir('sd-pack-notchecked-');
  t.after(() => rmDir(dir));
  assert.equal(initFolder(dir).code, 0);
  assert.equal(runRules(join(dir, 'poc.yaml'), false).code, 0);
  const saved = process.env['SD_DRAWIO'];
  process.env['SD_DRAWIO'] = '/nonexistent';
  try {
    assert.equal(runCli(['pdf', dir]).code, 2);
  } finally {
    if (saved === undefined) delete process.env['SD_DRAWIO'];
    else process.env['SD_DRAWIO'] = saved;
  }
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  const result = runPack(dir);
  const out = result.lines.join('\n');
  assert.equal(result.code, 2, out);
  assert.ok(!existsSync(packetDirOf(dir)), 'nothing to merge means no packet');
  // a report without the manifest sheets is not a basis at all - pack refuses
  // before copying anything, naming every sheet the PDF stage skipped.
  assert.ok(out.includes('PDF не строен по листу: l1.drawio'), out);
  assert.ok(result.lines.at(-1)?.includes("'pdf'"), 'Дальше names the pdf command');
});

/** The reviewer's p2 scenario: after an edited sheet and a failed re-export, no old render may pass. */
test('pack does not merge stale PDFs after a failed re-export: no packet PASS', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-stale-merge-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  writeFileSync(join(dir, 'l1.drawio'), readFileSync(join(dir, 'l1.drawio'), 'utf8') + '<!-- правка -->\n');
  const saved = process.env['SD_DRAWIO'];
  process.env['SD_DRAWIO'] = '/usr/bin/false';
  try {
    assert.equal(runCli(['pdf', dir]).code, 2);
  } finally {
    if (saved === undefined) delete process.env['SD_DRAWIO'];
    else process.env['SD_DRAWIO'] = saved;
  }
  const result = runPack(dir);
  const out = result.lines.join('\n');
  assert.equal(result.code, 2, out);
  assert.ok(!out.includes('PASS ' + MERGED_PDF), 'old renders never produce a PASS: ' + out);
  assert.ok(out.includes('пройди pdf'), 'the line points the person back at pdf');
  assert.ok(!existsSync(packetDirOf(dir)), 'no merged packet is written');
});

test('a touched sheet is not falsely stale: freshness is the content, not the mtime', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-fresh-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  const future = new Date(Date.now() + 60_000);
  utimesSync(join(dir, 'l1.drawio'), future, future);
  const result = runPack(dir);
  const out = result.lines.join('\n');
  assert.equal(result.code, 0, out);
  assert.ok(out.includes('PASS ' + MERGED_PDF + ': стр 4'), out);
});

test('a stale rerun drops the merged PDF the previous pack left, and keeps the rest', pdfTest, (t) => {
  // the reviewer must never find an old merged PDF in the packet of a new round.
  const dir = readyPackage(t, 'sd-pack-drop-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  assert.equal(runPack(dir).code, 0);
  const merged = join(packetDirOf(dir), MERGED_PDF);
  assert.ok(existsSync(merged), 'the first pack left the merged file');
  writeFileSync(join(dir, 'l1.drawio'), readFileSync(join(dir, 'l1.drawio'), 'utf8') + '<!-- правка -->\n');
  const result = runPack(dir);
  assert.equal(result.code, 2, result.lines.join('\n'));
  assert.ok(!existsSync(merged), 'the previous merged PDF is gone');
  assert.ok(existsSync(join(packetDirOf(dir), 'записка.txt')), 'the skill deletes nothing else');
});
