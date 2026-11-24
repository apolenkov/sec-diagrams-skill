/**
 * Print checks (SD-P01, SD-P02) run through `check` against the sheet itself: the page format
 * and the кегль that reaches the printed A3 are decided by the source file, before any PDF.
 * Sheets are synthetic; nothing here loads the PDF engine.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCheck } from './check.ts';

const PAGE_NAME = 'L1 (Общая схема)';

function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

const cell = (id: string, style: string, value: string): string =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="10" y="10" width="140" height="40" as="geometry"/></mxCell>`;

const row = (cells: string[]): string => cells.join(String.fromCharCode(10));

/** A sheet whose page declares the given size; an empty width leaves the attributes off. */
const sheet = (width: string, height: string, cells: string[]): string =>
  row([
    `<mxfile host="app"><diagram id="p1" name="${PAGE_NAME}"><mxGraphModel page="1"${
      width === '' ? '' : ` pageWidth="${width}" pageHeight="${height}"`
    }><root>`,
    '<mxCell id="0"/><mxCell id="1" parent="0"/>',
    ...cells,
    '</root></mxGraphModel></diagram></mxfile>',
  ]) + String.fromCharCode(10);

const a3 = (cells: string[]): string => sheet('1654', '1169', cells);

const checkLines = (dir: string, files: Record<string, string>): string => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return runCheck(dir, false).lines.join(String.fromCharCode(10));
};

const linesOf = (out: string, code: string): string[] =>
  out.split(String.fromCharCode(10)).filter((line) => line.includes(code));

test('check names every cell whose font prints below 8 pt (SD-P01)', (t) => {
  const dir = tempDir('sd-print-p01-');
  t.after(() => rmDir(dir));
  // The fit leaves 10 mm margins on A3 landscape: a 1654-wide page prints at 1133.85/1654 = 0.6855.
  // 11 pt on it is 7.54 pt on paper, 12 pt is 8.23 - the border between FAIL and PASS.
  const out = checkLines(dir, {
    'l1.drawio': a3([
      cell('small10', 'whiteSpace=wrap;fontSize=10;', 'Узел сборки'),
      cell('small11', 'whiteSpace=wrap;fontSize=11;', 'Портал'),
      cell('big12', 'whiteSpace=wrap;fontSize=12;', 'Сборщик'),
      cell('big14', 'whiteSpace=wrap;fontSize=14;', 'Шлюз'),
      cell('bigDefault', 'whiteSpace=wrap;', 'Без размера, по умолчанию 12'),
    ]),
  });
  const p01 = linesOf(out, 'FAIL SD-P01');
  assert.ok(
    p01.some((line) => line.includes('FAIL SD-P01 l1.drawio "' + PAGE_NAME + '" id=small10')),
    out,
  );
  assert.ok(
    p01.some((line) => line.includes('id=small11')),
    '11 pt prints as 7.9 pt: ' + out,
  );
  assert.equal(p01.length, 2, '12 pt and the default print above 8 pt: ' + out);
  assert.ok(
    p01.every((line) => line.includes('style set')),
    'the hint names the command that raises the font: ' + out,
  );
});

test('a cell asking for a smaller inline size prints small too (SD-P01)', (t) => {
  const dir = tempDir('sd-print-inline-');
  t.after(() => rmDir(dir));
  const lt = '&lt;';
  const gt = '&gt;';
  const quot = '&quot;';
  const html = (size: string): string => `${lt}div style=${quot}font-size: ${size}px;${quot}${gt}текст${lt}/div${gt}`;
  // After fitting this drawing, 7 CSS px is below the paper threshold and 16 px is above it.
  const out = checkLines(dir, {
    'l1.drawio': a3([
      cell('inline7', 'html=1;whiteSpace=wrap;fontSize=14;', html('7')),
      cell('inline16', 'html=1;whiteSpace=wrap;fontSize=14;', html('16')),
    ]),
  });
  assert.ok(out.includes('FAIL SD-P01 l1.drawio "' + PAGE_NAME + '" id=inline7'), out);
  assert.equal(linesOf(out, 'FAIL SD-P01').length, 1, out);
});

test('every page answers for its own size and scale', (t) => {
  const dir = tempDir('sd-print-multipage-');
  t.after(() => rmDir(dir));
  // The second page is A4-portrait and carries the small cell. Reading the model tag of the
  // first page for both (the old regex over the whole-file source) hid P02 and mis-scaled P01.
  const twoPages =
    row([
      '<mxfile host="app"><diagram id="p1" name="Первая"><mxGraphModel page="1" pageWidth="1654" pageHeight="1169"><root>',
      '<mxCell id="0"/><mxCell id="1" parent="0"/>',
      cell('fine12', 'whiteSpace=wrap;fontSize=12;', 'Как надо'),
      '</root></mxGraphModel></diagram>',
      '<diagram id="p2" name="Вторая"><mxGraphModel page="1" pageWidth="827" pageHeight="1169"><root>',
      '<mxCell id="0"/><mxCell id="1" parent="0"/>',
      cell('small6', 'whiteSpace=wrap;fontSize=6;', 'Мельче некуда'),
      '</root></mxGraphModel></diagram></mxfile>',
    ]) + String.fromCharCode(10);
  const out = checkLines(dir, { 'l1.drawio': twoPages });
  assert.ok(
    linesOf(out, 'WARN SD-P02').some((line) => line.includes('"Вторая"')),
    'the second page is not A3: ' + out,
  );
  assert.ok(!linesOf(out, 'WARN SD-P02').some((line) => line.includes('"Первая"')), 'the first page is A3: ' + out);
  assert.ok(
    linesOf(out, 'FAIL SD-P01').some((line) => line.includes('"Вторая"') && line.includes('id=small6')),
    'the second page scales by its own height too: ' + out,
  );
});

test('the кегль is asked of visible glyphs only: an empty span decides nothing', (t) => {
  const dir = tempDir('sd-print-empty-span-');
  t.after(() => rmDir(dir));
  const lt = '&lt;';
  const gt = '&gt;';
  const quot = '&quot;';
  const out = checkLines(dir, {
    'l1.drawio': a3([
      cell(
        'quiet',
        'html=1;whiteSpace=wrap;fontSize=12;',
        'видимый текст' + lt + 'span style=' + quot + 'font-size: 4pt;' + quot + gt + lt + '/span' + gt,
      ),
      cell(
        'loud',
        'html=1;whiteSpace=wrap;fontSize=12;',
        lt + 'span style=' + quot + 'font-size: 4pt;' + quot + gt + 'видный текст' + lt + '/span' + gt,
      ),
    ]),
  });
  const p01 = linesOf(out, 'FAIL SD-P01');
  assert.ok(
    p01.some((line) => line.includes('id=loud')),
    'a visible 4 pt span decides: ' + out,
  );
  assert.ok(!p01.some((line) => line.includes('quiet')), 'the empty span prints nothing: ' + out);
});

test('a page taller than A3 scales the print by height, not by width alone', (t) => {
  const dir = tempDir('sd-print-tall-');
  t.after(() => rmDir(dir));
  // 1654 wide passes the width fit at 0.68, but 2000 tall only lands at 785/2000 = 0.39 once
  // the pdf-fit margins are taken off the paper: 12 pt prints at 4.7, the fitter never grows.
  const out = checkLines(dir, {
    'l1.drawio': sheet('1654', '2000', [cell('tall12', 'whiteSpace=wrap;fontSize=12;', 'Страница выше A3')]),
  });
  assert.ok(
    linesOf(out, 'FAIL SD-P01').some((line) => line.includes('id=tall12')),
    'height caps the fit: ' + out,
  );
});

test('check warns on a sheet whose page is not landscape A3 (SD-P02)', (t) => {
  const dir = tempDir('sd-print-p02-');
  t.after(() => rmDir(dir));
  const out = checkLines(dir, {
    'a4.drawio': sheet('827', '1169', [
      cell('ok6', 'whiteSpace=wrap;fontSize=6;', 'На книжной странице 6 pt печатается 8.6'),
      cell('low5', 'whiteSpace=wrap;fontSize=5;', 'А 5 pt уже 7.2'),
    ]),
    'tall.drawio': sheet('1654', '1170', [cell('ok14', 'whiteSpace=wrap;fontSize=14;', 'Размер вышел за A3')]),
    'a3.drawio': a3([cell('ok14b', 'whiteSpace=wrap;fontSize=14;', 'Как надо')]),
    'bare.drawio': sheet('', '', [cell('ok14c', 'whiteSpace=wrap;fontSize=14;', 'Размер не объявлен')]),
  });
  const p02 = linesOf(out, 'WARN SD-P02');
  assert.ok(
    p02.some((line) => line.includes('a4.drawio "' + PAGE_NAME + '" id=-')),
    out,
  );
  assert.ok(
    p02.some((line) => line.includes('tall.drawio')),
    '1654x1170 is not A3 either: ' + out,
  );
  assert.equal(p02.length, 2, 'a3 passes, an undeclared page stays with the print gate: ' + out);
  const p01 = linesOf(out, 'FAIL SD-P01');
  // The fit puts every page on landscape A3 and takes the smaller of the width and the height
  // fit: the 827x1169 page is cut to 0.67 by its height, so even 6 pt prints at 4.
  assert.equal(p01.length, 2, 'P01 measures against the declared size: ' + out);
  assert.ok(p01.some((line) => line.includes('id=low5')) && p01.some((line) => line.includes('id=ok6')), out);
  assert.ok(out.includes('1654x1169'), 'the hint names the size to set: ' + out);
});

test('inline CSS pixels shrink in the same coordinates as the drawing', t => {
  const dir = tempDir('sd-css-fit-');
  t.after(() => rmDir(dir));
  const span = (size: number) => `&lt;span style=&quot;font-size:${size}px&quot;&gt;узел&lt;/span&gt;`;
  const result = checkLines(dir, {'fit.drawio': sheet('2400', '1700', [
    cell('fits', 'html=1;fontSize=18;', span(18)),
    cell('tiny', 'html=1;fontSize=18;', span(16)),
  ])});
  assert.deepEqual(linesOf(result, 'FAIL SD-P01').map(line => line.match(/id=(\w+)/u)?.[1]), ['tiny']);
});

test('style fontSize=9 and inline 9px both fail on a small sheet', t => {
  const dir = tempDir('sd-print-unit-');
  t.after(() => rmDir(dir));
  const out = checkLines(dir, { 'small.drawio': sheet('600', '400', [
    cell('styled', 'fontSize=9;', 'Узел'),
    cell('size11', 'fontSize=11;', 'Узел'),
    cell('px11', 'html=1;fontSize=14;', '&lt;span style=&quot;font-size:11px&quot;&gt;Узел&lt;/span&gt;'),
    cell('size12', 'fontSize=12;', 'Узел'),
    cell('inline', 'html=1;fontSize=14;', '&lt;span style=&quot;font-size:9px&quot;&gt;Узел&lt;/span&gt;'),
  ]) });
  assert.deepEqual(linesOf(out, 'FAIL SD-P01').map(line => line.match(/id=(\w+)/u)?.[1]).sort(),
    ['inline', 'px11', 'size11', 'styled']);
});
