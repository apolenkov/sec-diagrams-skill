import { pdfTestOptions } from './pdf-fixtures.ts';
import assert from 'node:assert/strict';
import fs, { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { runCli } from './cli.ts';
import { l3 } from './checks.test/support.ts';
import { fakePdf, GOOD_LETTER, readyPackage, rmDir, tempDir } from './pack-fixtures.ts';
import { packetDirOf, runPack } from './pack.ts';
import { fittedPdfName, pdfDir, pdfReportPath, runPdf } from './pdf.ts';
import { resolveDirectoryName } from './profile.ts';
import { RULES_SHEET_FILE } from './rules-page.ts';

const sheet = 'Край.drawio';
const fitted = 'Край.pdf';
const exportSheet = (_source: string, out: string): void => fakePdf(out);
const conflict = /SD-K01.*форм[а-я]* Unicode/u;

function folder(t: TestContext): string {
  const dir = tempDir('sd-unicode-');
  t.after(() => [dir, pdfDir(dir), packetDirOf(dir)].forEach(rmDir));
  return dir;
}

function withAlternate(t: TestContext, dir: string, name: string, run: () => void): void {
  const nfd = name.normalize('NFD');
  try {
    writeFileSync(join(dir, nfd), readFileSync(join(dir, name)), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // A normalization-insensitive volume aliases the two names. Inject the missing entry.
    assert.throws(() => resolveDirectoryName([name, nfd], name), conflict);
    const alternate = readdirSync(dir).includes(name) ? nfd : name;
    const readDirectory = readdirSync;
    const listing = ((path: fs.PathLike, options?: { withFileTypes?: boolean }) => {
      if (path !== dir) return Reflect.apply(readDirectory, fs, [path, options]);
      return options?.withFileTypes
        ? [...readDirectory(dir, { withFileTypes: true }), { name: alternate, isFile: () => true }]
        : [...readDirectory(dir), alternate];
    }) as typeof readdirSync;
    const mocked = t.mock.method(fs, 'readdirSync', listing);
    syncBuiltinESMExports();
    try {
      run();
    } finally {
      mocked.mock.restore();
      syncBuiltinESMExports();
    }
    return;
  }
  run();
}

const pdfTest = await pdfTestOptions();

test('check, pack --with-rules and pdf reject two canonically equivalent sheet names', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-unicode-sheets-');
  const name = RULES_SHEET_FILE;
  const report = readFileSync(pdfReportPath(dir));
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  withAlternate(t, dir, name, () => {
    let exports = 0;
    for (const result of [
      runCli(['check', dir, '--json']),
      runPack(dir, { withRules: true }),
      runPdf(dir, { exportSheet: () => { exports += 1; } }),
    ]) {
      assert.equal(result.code, 65, result.lines.join('\n'));
      assert.equal(result.lines.length, 1);
      assert.match(result.lines[0]!, conflict);
      assert.equal(result.lines[0]!.split(name).length - 1, 2);
    }
    assert.equal(exports, 0);
  });
  assert.ok(!existsSync(packetDirOf(dir)));
  assert.deepEqual(readFileSync(pdfReportPath(dir)), report);
});

test('pdf and pack refuse ambiguous fitted names before writing output', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-unicode-pdfs-');
  const out = pdfDir(dir);
  const name = fittedPdfName(RULES_SHEET_FILE);
  withAlternate(t, out, name, () => {
    const before = readdirSync(out).sort().map(file => [file, readFileSync(join(out, file))]);
    let exports = 0;
    for (const result of [
      runPdf(dir, { exportSheet: () => { exports += 1; } }),
      runPdf(dir, { env: { SD_DRAWIO: '/nonexistent' } }),
      runPack(dir, { withRules: true }),
    ]) {
      assert.equal(result.code, 65, result.lines.join('\n'));
      assert.equal(result.lines.length, 1);
      assert.match(result.lines[0]!, conflict);
      assert.equal(result.lines[0]!.split(name).length - 1, 2);
    }
    assert.equal(exports, 0);
    const after = readdirSync(out).sort().map(file => [file, readFileSync(join(out, file))]);
    assert.deepEqual(after, before);
  });
  assert.ok(!existsSync(join(dir, 'записка.txt')));
  assert.ok(!existsSync(packetDirOf(dir)));
});

test('check JSON uses the directory entry in findings, warnings and skipped checks', (t) => {
  const dir = folder(t);
  const nfd = sheet.normalize('NFD');
  const xml = l3()
    .replace('value="Сборщик"', 'value="Сборщик ещё"')
    .replace('pageWidth="1654"', 'pageWidth="1700"')
    .replace('sdRole=legend;', '')
    .replace('value="Легенда"', 'value=""')
    .replace(/(<mxCell id="n(\d)"[^>]*?)parent="e\2"/gu, '$1parent="1"');
  writeFileSync(join(dir, nfd), xml);
  assert.ok(readdirSync(dir).includes(nfd));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    service: 'Служба ИБ', titlePrefix: '', final: false,
    sheets: [{ file: sheet, level: 'L3-1', topic: 'Доступ' }],
  }));

  const result = runCli(['check', dir, '--json']);
  assert.equal(result.code, 1, result.lines.join('\n'));
  const report = JSON.parse(result.lines[0]!) as Record<
    'findings' | 'warnings' | 'notChecked', Array<{ code: string; file?: string; ids?: string[] }>
  >;
  const finding = report.findings.find(entry => entry.code === 'SD-T01');
  assert.equal(finding?.file, nfd);
  assert.equal(report.warnings.find(entry => entry.code === 'SD-P02')?.file, nfd);
  assert.equal(report.notChecked.find(entry => entry.code === 'SD-N01')?.file, nfd);
  const path = join(dir, finding.file);
  const id = finding.ids?.[0];
  assert.ok(id);
  assert.equal(runCli(['text', 'get', path, id]).code, 0);
  assert.equal(runCli(['text', 'set', path, id, 'Сборщик']).code, 0);
  assert.equal(runCli(['open', path, id]).code, 0);
});

test('pdf-report.json names the fitted PDF exactly as written', pdfTest, (t) => {
  const dir = folder(t);
  const out = pdfDir(dir);
  mkdirSync(out);
  const nfd = fitted.normalize('NFD');
  writeFileSync(join(dir, sheet), l3());
  writeFileSync(join(out, nfd), 'previous content');
  assert.ok(readdirSync(out).includes(nfd));

  const result = runPdf(dir, { exportSheet });
  assert.equal(result.code, 0, result.lines.join('\n'));
  const report = JSON.parse(readFileSync(pdfReportPath(dir), 'utf8')) as { files: { pdf: string }[] };
  assert.equal(report.files[0]?.pdf, nfd);
  assert.equal(readFileSync(join(out, report.files[0].pdf)).subarray(0, 5).toString(), '%PDF-');
});
