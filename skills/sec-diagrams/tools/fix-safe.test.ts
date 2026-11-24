/**
 * fix --safe and the text commands: planning happens before the first byte is written, the plan
 * reads the sheet the way check reads it (legend, <font face>, markup), and escapes in text set
 * survive in one pass. Sheets are synthetic; addresses are from RFC 5737.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';

const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** Text is rewritten only in a confirmed working copy: the fix fixtures carry such a manifest. */
function confirm(dir: string): void {
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      { service: 'Служба ИБ', titlePrefix: '', final: false, sheets: [{ file: 's.drawio', level: 'L1', topic: 'Т' }] },
      null,
      2,
    ),
  );
}

const sheetWith = (...cells: string[]): string =>
  '<mxfile host="app"><diagram id="p1" name="L1"><mxGraphModel><root>' +
  '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
  cells.join('') +
  '</root></mxGraphModel></diagram></mxfile>';

const box = (id: string, value: string, style = 'whiteSpace=wrap;fontFamily=Arial;', parent = '1'): string =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="1" y="2" width="9" height="9" as="geometry"/></mxCell>`;

const edge = (id: string, parent = '1'): string =>
  `<mxCell id="${id}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;jumpStyle=none;" edge="1" parent="${parent}" source="bad" target="bad"><mxGeometry relative="1" as="geometry"/></mxCell>`;

test('fix --safe plans every sheet first: a broken sheet later in the folder writes nothing', (t) => {
  const dir = tempDir('sd-fix-twophase-');
  t.after(() => rmDir(dir));
  const fixable = join(dir, 'a.drawio');
  writeFileSync(fixable, sheetWith(box('bad', 'Сервер 100—200', 'whiteSpace=wrap;fontFamily=Courier;')));
  const before = readFileSync(fixable, 'utf8');
  writeFileSync(join(dir, 'b.drawio'), 'это не mxfile вообще');
  const result = runCli(['fix', '--safe', dir]);
  assert.equal(result.code, 65, result.lines.join(' | '));
  assert.equal(readFileSync(fixable, 'utf8'), before, 'no half-fixed package: planning failed, nothing was written');
});

test('fix --safe takes the list dashes from every line of a <br>-list in one run', (t) => {
  const dir = tempDir('sd-fix-br-');
  t.after(() => rmDir(dir));
  confirm(dir);
  const file = join(dir, 's.drawio');
  const value = '1. Первый&lt;br&gt;2. Второй — связь 100—200&lt;br&gt;3. Третий — ещё одна';
  writeFileSync(file, sheetWith(box('list', value)));
  const result = runCli(['fix', '--safe', dir]);
  assert.equal(result.code, 0, result.lines.join(' | '));
  const after = readFileSync(file, 'utf8');
  assert.ok(!after.includes('—'), 'no long dash survives on any line: ' + after);
  assert.ok(after.includes('2. Второй - связь 100-200'), after);
  assert.ok(after.includes('3. Третий - еще одна'), after);
  assert.ok(after.includes('&lt;br&gt;'), 'the separators themselves stay as they were: ' + after);
});

test('fix leaves the legend edge notation alone but still fixes fonts everywhere', (t) => {
  const dir = tempDir('sd-fix-legend-');
  t.after(() => rmDir(dir));
  const file = join(dir, 's.drawio');
  const legend = box('legend', '', 'rounded=0;sdRole=legend;');
  const inside = edge('legend-edge', 'legend');
  writeFileSync(file, sheetWith(legend, inside, box('bad', 'Узел', 'whiteSpace=wrap;fontFamily=Courier;')));
  const result = runCli(['fix', '--safe', dir]);
  assert.equal(result.code, 0, result.lines.join(' | '));
  const after = readFileSync(file, 'utf8');
  assert.ok(after.includes('jumpStyle=none'), 'the legend sample keeps its own notation: ' + after);
  assert.ok(after.includes('fontFamily=Courier') === false, 'the plain cell got its font');
});

test('a font written in the label markup is not answered with a style rewrite', () => {
  const value = 'Сборщик &lt;font face=&quot;Arial&quot;&gt;внешний&lt;/font&gt; 198.51.100.10';
  const dir = tempDir('sd-fix-markup-');
  try {
    const file = join(dir, 's.drawio');
    writeFileSync(file, sheetWith(box('m', value, 'text;html=1;')));
    const before = readFileSync(file, 'utf8');
    const result = runCli(['fix', '--safe', dir]);
    assert.equal(result.code, 0, result.lines.join(' | '));
    assert.equal(readFileSync(file, 'utf8'), before, 'markup carries the font: the style stays as it is');
  } finally {
    rmDir(dir);
  }
});

test('fix edits label text, never the HTML inside it', (t) => {
  const dir = tempDir('sd-fix-href-');
  t.after(() => rmDir(dir));
  confirm(dir);
  const file = join(dir, 's.drawio');
  const value = '&lt;a href=&quot;https://example—corp.test/заявка&quot;&gt;Заявка 100—200&lt;/a&gt;';
  writeFileSync(file, sheetWith(box('link', value)));
  assert.equal(runCli(['fix', '--safe', dir]).code, 0);
  const after = readFileSync(file, 'utf8');
  assert.ok(after.includes('https://example—corp.test/заявка'), 'the attribute is byte-identical: ' + after);
  assert.ok(after.includes('Заявка 100-200'), after);
});

test('text set: backslash-n becomes a newline, double backslash one backslash, in one pass', (t) => {
  const dir = tempDir('sd-fix-escapes-');
  t.after(() => rmDir(dir));
  confirm(dir);
  const file = join(dir, 's.drawio');
  const BS = String.fromCharCode(92);
  writeFileSync(file, sheetWith(box('k1', 'старое')));
  assert.equal(runCli(['text', 'set', file, 'k1', 'строка1' + BS + 'nстрока2']).code, 0);
  assert.ok(readFileSync(file, 'utf8').includes('строка1&#xa;строка2'), 'backslash-n becomes a newline');
  assert.equal(runCli(['text', 'set', file, 'k1', 'путь C:' + BS + BS + 'tools']).code, 0);
  assert.ok(readFileSync(file, 'utf8').includes('путь C:' + BS + 'tools'), 'double backslash becomes one');
  assert.equal(runCli(['text', 'set', file, 'k1', 'A' + BS + 'n' + BS + BS + 'B']).code, 0);
  assert.ok(
    readFileSync(file, 'utf8').includes('A&#xa;' + BS + 'B'),
    'one pass: the newline does not re-freeze the next backslash',
  );
});

test('fix --safe leaves hidden cells alone, counting them as check does not', (t) => {
  // №15: check hides visible="0" cells, fix planned them anyway - it rewrote a draft nobody
  // sees and reported SD-T01 counts that check never confirmed.
  const dir = tempDir('sd-fix-hidden-');
  t.after(() => rmDir(dir));
  confirm(dir);
  const file = join(dir, 's.drawio');
  const hidden =
    '<mxCell id="h" value="Ёмкость «буфер» 100—200" style="whiteSpace=wrap;fontFamily=Arial;" visible="0" vertex="1" parent="1">' +
    '<mxGeometry x="5" y="5" width="9" height="9" as="geometry"/></mxCell>';
  writeFileSync(file, sheetWith(hidden));
  const before = readFileSync(file, 'utf8');
  const result = runCli(['fix', '--safe', dir]);
  assert.equal(result.code, 0, result.lines.join(' | '));
  assert.ok(result.lines[0]?.includes('SD-T01=0'), 'a hidden cell is not counted: ' + result.lines.join(' | '));
  assert.equal(readFileSync(file, 'utf8'), before, 'the draft layer keeps every byte');
});

test('fix --safe reads a legend found by its frame, without the sdRole=legend mark', (t) => {
  // №22: check finds the legend by geometry too; fix only knew the mark, so it restyled the
  // notation sample and counted an L04 that check never reported.
  const dir = tempDir('sd-fix-frame-');
  t.after(() => rmDir(dir));
  const file = join(dir, 's.drawio');
  const frame =
    '<mxCell id="lf" value="" style="rounded=0;html=1;fillColor=none;strokeColor=#000000;fontFamily=Arial;fontSize=14;" vertex="1" parent="1">' +
    '<mxGeometry x="950" y="120" width="600" height="420" as="geometry"/></mxCell>';
  const heading =
    '<mxCell id="lh" value="Обозначения линий" style="text;align=left;fontFamily=Arial;fontSize=14;" vertex="1" parent="lf">' +
    '<mxGeometry x="20" y="20" width="540" height="30" as="geometry"/></mxCell>';
  const sample =
    '<mxCell id="ls" value="" edge="1" parent="lf" style="edgeStyle=orthogonalEdgeStyle;rounded=0;jumpStyle=none;strokeColor=#ad3b31;endArrow=classic;">' +
    '<mxGeometry relative="1" as="geometry"><mxPoint x="30" y="80" as="sourcePoint"/><mxPoint x="110" y="80" as="targetPoint"/></mxGeometry></mxCell>';
  writeFileSync(
    file,
    '<mxfile host="test"><diagram name="Лист"><mxGraphModel page="1" pageWidth="1654" pageHeight="1169"><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      frame +
      heading +
      sample +
      '</root></mxGraphModel></diagram></mxfile>',
  );
  const before = readFileSync(file, 'utf8');
  const result = runCli(['fix', '--safe', dir]);
  assert.equal(result.code, 0, result.lines.join(' | '));
  assert.ok(
    result.lines[0]?.includes('SD-L04=0'),
    'the sample is notation, not a fixable edge: ' + result.lines.join(' | '),
  );
  assert.equal(readFileSync(file, 'utf8'), before, 'the sample keeps its own notation bytes');
});
