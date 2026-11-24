import { pdfTestOptions } from './pdf-fixtures.ts';
/**
 * pdf <folder> tests: an injected exporter puts ready fixture PDFs where draw.io Desktop would
 * write them, so the unit tests never spawn the app. The last test spawns it for real and only
 * when SD_DRAWIO_IT=1 says so. Fixture pages are the size of the A3 printable area, so the
 * fitter scales them by exactly 1 and the fixture font is the font the gate measures.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';
import { findDrawio } from './drawio-path.ts';
import { buildPdf, TOKEN, type FixtureLine, type FixturePage } from './pdf-fixtures.ts';
import {
  pdfDir,
  pdfReportPath,
  pdfReportSchema,
  runPdf,
  type PdfReport,
  type SheetExporter,
} from './pdf.ts';
import { initFolder } from './templates.ts';
import { runRules } from './rules-page.ts';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

// The engine loads on demand: this file exercises the real gate, so it loads it up front.

const SHEET = '<mxfile host="sec-diagrams"><diagram name="L1"><mxGraphModel/></diagram></mxfile>';

const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A fixture page sized like the printable area: the fitter scales it by exactly 1. */
function printablePage(lines: FixtureLine[], over: Partial<FixturePage> = {}): Uint8Array {
  return buildPdf({ pages: [{ widthMm: 400, heightMm: 277, lines, ...over }] });
}

function exporting(bytes: Uint8Array): SheetExporter {
  return (_sourcePath, outPath) => writeFileSync(outPath, bytes);
}

function sheetDir(prefix: string, t: { after: (fn: () => void) => void }): string {
  const dir = tempDir(prefix);
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 'l1.drawio'), SHEET);
  return dir;
}

/** The report written next to the folder, validated by the very schema pack reads it with. */
const reportOf = (dir: string): PdfReport =>
  pdfReportSchema.parse(JSON.parse(readFileSync(pdfReportPath(dir), 'utf8')));

function withEnv<T>(name: string, value: string, body: () => T): T {
  const saved = process.env[name];
  process.env[name] = value;
  try {
    return body();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

const pdfTest = await pdfTestOptions();

test('pdf without draw.io: NOT_CHECKED with a hint, exit 2, no word PASS', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-missing-', t);
  const result = withEnv('SD_DRAWIO', '/nonexistent', () => runCli(['pdf', dir]));
  const out = result.lines.join('\n');
  assert.equal(result.code, 2, out);
  assert.ok(
    result.lines.includes('NOT_CHECKED SD-P04 draw.io Desktop не найден - PDF не проверен'),
    'the exact NOT_CHECKED line',
  );
  assert.ok(out.includes('jgraph/drawio-desktop') && out.includes('SD_DRAWIO'), 'the install hint names both ways');
  assert.ok(out.includes('Проверенные пути: /nonexistent'));
  assert.ok(!out.includes('PASS'), 'the word PASS never appears');
  assert.equal(reportOf(dir).status, 'NOT_CHECKED');
  // without draw.io the run must not walk the agent into pack - the person
  // installs it, and until then there is no next command, only the person's step.
  assert.ok(result.lines.at(-1)?.startsWith('Человеку:') && result.lines.at(-1)?.includes('PDF не проверен'));
  assert.ok(!result.lines.some((line) => line.startsWith('Дальше:')), 'no executable next step exists yet');
});

test('pdf gates a fitted 8 pt page PASS and keeps the output blind', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-pass-', t);
  const result = runPdf(dir, { exportSheet: exporting(printablePage([{ x: 50, y: 60, size: 8 }])) });
  const out = result.lines.join('\n');
  assert.equal(result.code, 0, out);
  assert.match(out, /PASS l1\.drawio стр 1: кегль 8\.00 пт, текст \d+\.\d%/);
  assert.ok(out.includes('ИТОГ: PASS'));
  assert.ok(!out.includes('код'), 'a clean page prints no codes');
  assert.ok(!out.includes(TOKEN), 'no PDF text in the output');
  assert.ok(result.lines.at(-1)?.startsWith(`Дальше: node '${CLI_PATH}' 'pack' '${dir}'`));
  const report = reportOf(dir);
  assert.equal(report.status, 'PASS');
  assert.equal(report.files[0]?.file, 'l1.drawio');
  assert.equal(report.files[0]?.sha256, createHash('sha256').update(SHEET).digest('hex'));
  assert.ok(existsSync(join(pdfDir(dir), 'l1.pdf')), 'the fitted PDF sits next to the folder');
});

test('pdf fails a 7 pt page with SD-P01 and exit 1', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-small-', t);
  const result = runPdf(dir, { exportSheet: exporting(printablePage([{ x: 50, y: 60, size: 7 }])) });
  const out = result.lines.join('\n');
  assert.equal(result.code, 1, out);
  assert.match(out, /FAIL l1\.drawio стр 1: кегль 7\.00 пт, текст \d+\.\d% код SD-P01/);
  assert.ok(out.includes('ИТОГ: FAIL'));
  assert.ok(result.lines.at(-1)?.includes('check'));
  assert.equal(reportOf(dir).files[0]?.status, 'FAIL');
  assert.deepEqual(reportOf(dir).files[0]?.pages[0]?.errors, [3]);
});

test('pdf warns on a text-heavy page and keeps the fitted PDF', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-dense-', t);
  const dense = Array.from({ length: 62 }, (_, index) => ({
    x: 50,
    y: 50 + index * 12,
    size: 8,
    body: 'M'.repeat(110),
  }));
  const result = runPdf(dir, { exportSheet: exporting(printablePage(dense)) });
  const out = result.lines.join('\n');
  assert.equal(result.code, 0, out);
  assert.match(out, /WARN SD-P03 - рекомендация по оформлению/);
  assert.deepEqual(reportOf(dir).files[0]?.pages[0]?.warnings, [4]);
  assert.equal(reportOf(dir).status, 'PASS');
  assert.ok(existsSync(join(pdfDir(dir), 'l1.pdf')));
});

test('pdf keeps a raster page UNVERIFIED with the gate code in parentheses', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-raster-', t);
  const raster = printablePage([{ x: 50, y: 60, size: 8 }], { image: { x: 150, y: 120, width: 50, height: 50 } });
  const result = runPdf(dir, { exportSheet: exporting(raster) });
  const out = result.lines.join('\n');
  assert.equal(result.code, 2, out);
  assert.ok(out.includes('UNVERIFIED l1.drawio стр 1'), out);
  assert.ok(out.includes('код 104 растровая картинка'), out);
  assert.ok(out.includes('ИТОГ: UNVERIFIED'));
  assert.ok(
    result.lines.some((line) => line.includes('PDF не проверен') && !line.startsWith('Дальше: ')),
    'the person is told the PDF is unchecked',
  );
});

test('a page without text names the page and does not send the person to install draw.io', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-notext-', t);
  const result = runPdf(dir, { exportSheet: exporting(printablePage([], { vectorOnly: true })) });
  const out = result.lines.join('\n');
  assert.equal(result.code, 2, out);
  assert.ok(out.includes('код 101 нет текста'), out);
  const last = result.lines.at(-1) ?? '';
  assert.ok(last.startsWith('Человеку: '), last);
  assert.ok(last.includes('l1.drawio') && last.includes('стр 1'), 'the page is named: ' + last);
  assert.ok(!/draw\.io Desktop|SD_DRAWIO/u.test(last), 'no advice to install the app: ' + last);
});

test('a failed export is NOT_CHECKED without the engine message', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-broken-', t);
  const result = runPdf(dir, {
    exportSheet: () => {
      throw new Error('drawio exploded: ' + TOKEN);
    },
  });
  const out = result.lines.join('\n');
  assert.equal(result.code, 2, out);
  assert.ok(out.includes('NOT_CHECKED SD-P04 l1.drawio - экспорт не удался'), out);
  assert.ok(!out.includes(TOKEN), 'the exporter error text never leaks');
  assert.equal(reportOf(dir).files[0]?.status, 'NOT_CHECKED');
});

/** Two printable pages under one exporter call: what draw.io used to do with a wide drawing. */
const twoPrintablePages = (): Uint8Array =>
  buildPdf({
    pages: [
      { widthMm: 400, heightMm: 277, lines: [{ x: 50, y: 60, size: 8 }] },
      { widthMm: 400, heightMm: 277, lines: [{ x: 50, y: 60, size: 8 }] },
    ],
  });

test('an export with more PDF pages than diagram pages FAILs and drops the old render', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-tiled-', t);
  const first = runPdf(dir, { exportSheet: exporting(printablePage([{ x: 50, y: 60, size: 8 }])) });
  assert.equal(first.code, 0, first.lines.join('\n'));
  const result = runPdf(dir, { exportSheet: exporting(twoPrintablePages()) });
  const out = result.lines.join('\n');
  assert.equal(result.code, 1, out);
  assert.ok(out.includes('FAIL SD-P04 l1.drawio - страниц PDF 2, страниц листа 1'), out);
  assert.ok(!out.includes('PASS'), 'a tiled sheet never passes');
  assert.ok(!existsSync(join(pdfDir(dir), 'l1.pdf')), 'the stale fitted PDF is removed');
  assert.equal(reportOf(dir).files[0]?.status, 'FAIL');
});

test('a two-diagram sheet matches a two-page export and passes', pdfTest, (t) => {
  const dir = tempDir('sd-pdf-twopages-');
  t.after(() => rmDir(dir));
  const twoDiagrams =
    '<mxfile host="sec-diagrams"><diagram name="A"><mxGraphModel/></diagram>' +
    '<diagram name="B"><mxGraphModel/></diagram></mxfile>';
  writeFileSync(join(dir, 'l1.drawio'), twoDiagrams);
  const result = runPdf(dir, { exportSheet: exporting(twoPrintablePages()) });
  const out = result.lines.join('\n');
  assert.equal(result.code, 0, out);
  assert.ok(out.includes('ИТОГ: PASS'));
});

test('a gated FAIL leaves no fitted PDF behind for pack to merge', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-failcleanup-', t);
  const result = runPdf(dir, { exportSheet: exporting(printablePage([{ x: 50, y: 60, size: 7 }])) });
  assert.equal(result.code, 1, result.lines.join('\n'));
  assert.ok(!existsSync(join(pdfDir(dir), 'l1.pdf')), 'the FAILed sheet keeps no render');
});

test('a failed re-export removes the previous fitted PDF of the sheet', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-failedcleanup-', t);
  assert.equal(runPdf(dir, { exportSheet: exporting(printablePage([{ x: 50, y: 60, size: 8 }])) }).code, 0);
  assert.ok(existsSync(join(pdfDir(dir), 'l1.pdf')));
  const result = runPdf(dir, {
    exportSheet: () => {
      throw new Error('drawio exploded');
    },
  });
  assert.equal(result.code, 2);
  assert.ok(!existsSync(join(pdfDir(dir), 'l1.pdf')), 'the render of the old bytes is gone');
});

test('a кегль FAIL names the reason word and sends to check for the cell ids', pdfTest, (t) => {
  const dir = sheetDir('sd-pdf-p01hint-', t);
  const result = runPdf(dir, { exportSheet: exporting(printablePage([{ x: 50, y: 60, size: 7 }])) });
  const out = result.lines.join('\n');
  assert.ok(out.includes('код SD-P01 (кегль)'), out);
  assert.ok(
    out.includes(
      'Подсказка: id назовет check кодом SD-P01; подними кегль командой style set <файл> <id> fontSize=<число>, или раздели лист на два',
    ),
    out,
  );
});

test('pdf.ts exports through the local binary only: no fetch, no http client', () => {
  const source = readFileSync(join(import.meta.dirname, 'pdf.ts'), 'utf8');
  assert.ok(!source.includes('fetch('), 'no online export');
  assert.ok(!source.includes('node:http'), 'no http module');
  assert.ok(!source.includes('node:https'), 'no https module');
});

const itRequested = process.env['SD_DRAWIO_IT'] === '1' && findDrawio() !== null;

/** One A4-portrait draw.io page whose drawing reaches 1540 px to the right: it used to tile. */
const WIDE_PROBE =
  '<mxfile host="probe" type="device"><diagram name="Wide">' +
  '<mxGraphModel page="1" pageWidth="827" pageHeight="1169" grid="0"><root>' +
  '<mxCell id="0" /><mxCell id="1" parent="0" />' +
  '<mxCell id="a" value="Узел слева" vertex="1" parent="1" ' +
  'style="whiteSpace=wrap;fillColor=#FFFFFF;fontFamily=Arial;fontSize=9;html=1;">' +
  '<mxGeometry x="100" y="300" width="240" height="80" as="geometry"/></mxCell>' +
  '<mxCell id="c" value="Узел справа" vertex="1" parent="1" ' +
  'style="whiteSpace=wrap;fillColor=#FFFFFF;fontFamily=Arial;fontSize=9;html=1;">' +
  '<mxGeometry x="1300" y="900" width="240" height="80" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram></mxfile>';

test(
  'integration: a drawing wider than its draw.io page never passes the print gate',
  {
    skip: pdfTest.skip || (itRequested ? false : 'нужен SD_DRAWIO_IT=1 и установленный draw.io Desktop'),
  },
  (t) => {
    const dir = tempDir('sd-pdf-wide-');
    t.after(() => rmDir(dir));
    writeFileSync(join(dir, 'wide.drawio'), WIDE_PROBE);
    const result = runPdf(dir);
    const out = result.lines.join('\n');
    assert.notEqual(result.code, 0, 'cropping or the page-count match must stop a PASS: ' + out);
    assert.ok(!out.includes('ИТОГ: PASS'), out);
    assert.ok(!out.includes('PASS wide.drawio'), 'the sheet itself never reads PASS: ' + out);
  },
);

test(
  'integration: real draw.io exports every init sheet PASS',
  {
    skip: pdfTest.skip || (itRequested ? false : 'нужен SD_DRAWIO_IT=1 и установленный draw.io Desktop'),
  },
  (t) => {
    const dir = tempDir('sd-pdf-it-');
    t.after(() => rmDir(dir));
    assert.equal(initFolder(dir).code, 0);
    assert.equal(runRules(join(dir, 'poc.yaml'), false).code, 0);
    const result = runPdf(dir);
    const out = result.lines.join('\n');
    assert.equal(result.code, 0, out);
    const pages = result.lines.filter((line) => line.includes(' стр '));
    assert.ok(pages.length >= 5, 'every template sheet exported at least one page');
    assert.ok(
      pages.every((line) => line.startsWith('PASS ')),
      out,
    );
    assert.ok(out.includes('ИТОГ: PASS'));
  },
);
