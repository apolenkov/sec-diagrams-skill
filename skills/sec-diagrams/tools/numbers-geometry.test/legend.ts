/**
 * How the legend is found, or not: a frame big enough to be the sheet is not a legend, a box
 * holding a real connection is not a legend, an area without either reading - by the mark or
 * by the search - turns the legend-dependent codes into NOT_CHECKED, and what the legend text
 * itself owes the rules (an address is an address inside the frame too). Synthetic sheets
 * from sheet-fixtures; codes, ids and counts only, never label texts.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCheck } from '../check.ts';
import {
  analyse,
  baseCells,
  BLOCKS,
  BOX_STYLE,
  CONNECTIONS,
  freeEdge,
  LEGEND,
  LIST,
  NUMBERS,
  sentSheet,
  TEXT_STYLE,
  TITLE,
  vertex,
  wrap,
} from '../sheet-fixtures.ts';

test('a heading area over a third of the page is the sheet, not a legend: the rules go NOT_CHECKED', () => {
  // The frame of the whole sheet parented the heading; the old search called the page a legend
  // and quietly freed every number and line on it. Now the area is dropped and the legend is
  // treated as not found: the legend-dependent codes go NOT_CHECKED instead of passing.
  const frame = vertex('page-frame', '', 20, 20, 1614, 1129, BOX_STYLE);
  const heading = vertex('legend-head', 'Обозначения линий', 40, 40, 540, 30, TEXT_STYLE, 'page-frame');
  const analysis = analyse(wrap([TITLE, ...BLOCKS, ...CONNECTIONS, ...NUMBERS, LIST, frame, heading]));
  assert.ok(analysis.codes.includes('SD-N01:NOT_CHECKED'), analysis.codes.join(','));
  assert.ok(!analysis.codes.some((code) => code.endsWith(':PASS') || code.endsWith(':FAIL')), analysis.codes.join(','));
});

test('a frame over a third of the page hides nothing: its free-ended line still reaches the rules', () => {
  // draw.io declares the sheet size with pageWidth and pageHeight. When the parser misses them,
  // the size guard never fires and a frame around the legend heading swallows the whole sheet:
  // here the free line inside the frame would read as a notation sample and the run would pass.
  const frame = vertex('legend-frame', '', 40, 90, 1400, 700, BOX_STYLE);
  const heading = vertex('legend-head', 'Обозначения линий', 60, 100, 500, 30, TEXT_STYLE, 'legend-frame');
  const stray = freeEdge('s1', 100, 500, 1100, 500, '#ad3b31');
  const analysis = analyse(wrap([TITLE, frame, heading, stray]));
  for (const code of ['SD-N01', 'SD-L01', 'SD-L02', 'SD-L05']) {
    assert.ok(
      analysis.codes.includes(code + ':NOT_CHECKED'),
      code + ' must go NOT_CHECKED with the legend dropped: ' + analysis.codes.join(','),
    );
  }
  assert.ok(!analysis.codes.some((code) => code.endsWith(':FAIL')), analysis.codes.join(','));
});

test('an area around the heading that holds a real connection is the sheet, not a legend', () => {
  // A small box does not pass the size guard, but it contains the connection between the first
  // two blocks with both ends named: a legend of samples has no connections with ends.
  const frame = vertex('legend-frame', '', 80, 90, 740, 100, BOX_STYLE);
  const heading = vertex('legend-head', 'Обозначения линий', 20, 5, 500, 30, TEXT_STYLE, 'legend-frame');
  const analysis = analyse(wrap([TITLE, ...BLOCKS, ...CONNECTIONS, ...NUMBERS, LIST, frame, heading]));
  assert.ok(analysis.codes.includes('SD-N01:NOT_CHECKED'), analysis.codes.join(','));
});

test('a real address inside the legend still fails SD-T04, a masked sample stays clean', () => {
  const address = vertex('legend-addr', 'Прокси 198.51.100.7', 20, 200, 540, 30, TEXT_STYLE, 'lf');
  const analysis = analyse(wrap(baseCells([...LEGEND, address])));
  assert.deepEqual(analysis.codes, ['SD-T04:FAIL']);
  const masked = vertex('legend-addr', 'Прокси XX.XX.XX.XX', 20, 200, 540, 30, TEXT_STYLE, 'lf');
  assert.deepEqual(analyse(wrap(baseCells([...LEGEND, masked]))).codes, []);
});

test('a heading without a frame around it is not a legend to read', () => {
  // when no frame contained the heading, the search returned the heading
  // box itself as the legend - a region holding nothing, and every line outside it was judged
  // as a line of a fully checked sheet. Without a container the legend is not found, and the
  // legend-dependent codes must say NOT_CHECKED instead of passing or failing silently.
  const heading = vertex('legend-head', 'Обозначения линий', 950, 120, 540, 30, TEXT_STYLE);
  const analysis = analyse(wrap([...baseCells([]), heading]));
  assert.ok(!analysis.codes.some((code) => code.endsWith(':FAIL')), analysis.codes.join(','));
  for (const code of ['SD-N01', 'SD-L01', 'SD-L02', 'SD-L05']) {
    assert.ok(
      analysis.codes.includes(code + ':NOT_CHECKED'),
      code + ' must go NOT_CHECKED without a framed legend: ' + analysis.codes.join(','),
    );
  }
});

test('a list line inside the legend still answers for its number', () => {
  // colleagues of the old sheets put the connection list right into the
  // legend block. Items there were skipped, and the number whose only item stood inside the
  // frame failed SD-N01 as "no list line".
  const content = sentSheet()
    .replace('&#10;2. HTTPS (443/TCP) - доступ блока три к блоку четыре', '')
    .replace(
      '</root>',
      vertex(
        'legend-list',
        '2. HTTPS (443/TCP) - доступ блока три к блоку четыре',
        20,
        200,
        540,
        30,
        TEXT_STYLE,
        'lf',
      ) + '</root>',
    );
  assert.ok(content.includes('id="legend-list"'), 'the item must stand inside the legend frame');
  assert.deepEqual(analyse(content).codes, []);
});

test('a legend definition line may carry " - ", the same words outside the legend may not', () => {
  const definition = vertex('legend-def', 'Запрет - серый крест', 20, 200, 540, 30, TEXT_STYLE, 'lf');
  assert.deepEqual(analyse(wrap(baseCells([...LEGEND, definition]))).codes, []);
  const outside = vertex('note-def', 'Запрет - серый крест', 950, 700, 540, 30, TEXT_STYLE);
  const analysis = analyse(wrap(baseCells([...LEGEND, outside])));
  assert.deepEqual(analysis.codes, ['SD-T01:FAIL']);
});

test('a sheet with no legend reports NOT_CHECKED with legend-not-found on the four codes and exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-nolegend-'));
  writeFileSync(join(dir, 'sheet.drawio'), wrap(baseCells([])));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ service: 'С', titlePrefix: '', sheets: [{ file: 'sheet.drawio', level: 'L3', topic: 'Лист' }] }),
  );
  const result = runCheck(dir, false);
  const text = result.lines.join('\n');
  assert.equal(result.code, 2, text);
  for (const code of ['SD-N01', 'SD-L01', 'SD-L02', 'SD-L05']) {
    assert.ok(
      result.lines.includes(
        'NOT_CHECKED ' + code + ' sheet.drawio "Лист" - легенда не найдена: номера и линии проверь глазами',
      ),
      code + ' must be NOT_CHECKED: ' + text,
    );
  }
  assert.ok(!result.lines.some((line) => line.startsWith('FAIL')), text);
  const json = JSON.parse(runCheck(dir, true).lines.join('')) as {
    notChecked: Array<{ code: string; reason: string }>;
  };
  for (const code of ['SD-N01', 'SD-L01', 'SD-L02', 'SD-L05']) {
    assert.equal(json.notChecked.find((item) => item.code === code)?.reason, 'legend-not-found');
  }
});

/** Table cells only: the rules-sheet layout minus the sdRole=rules mark, no legend and no line. */
const tableOnly = (extra: string[] = []): string =>
  wrap([
    TITLE,
    vertex('r1', '22/TCP', 100, 120, 200, 40),
    vertex('r2', 'Правило одно', 400, 120, 300, 40),
    vertex('r3', 'срок проверки', 100, 200, 200, 40),
    ...extra,
  ]);

test('a sheet of tables only and no legend: the line and number rules report nothing at all', () => {
  // Not marked sdRole=rules, yet there is no line to read: SD-N01 and SD-L01, L02, L05 have
  // nothing to subtract the legend from, so they stay silent like on a rules sheet - no FAIL
  // and no NOT_CHECKED for a legend a sheet of tables never owes.
  const analysis = analyse(tableOnly());
  assert.equal(analysis.model.edges.length, 0);
  assert.deepEqual(
    analysis.codes.filter((code) => /^SD-(N01|L01|L02|L05):/u.test(code)),
    [],
  );
});

test('a single line on a sheet of tables restores the legend-not-found NOT_CHECKED', () => {
  const analysis = analyse(tableOnly([freeEdge('e1', 100, 300, 600, 300, '#ad3b31')]));
  for (const code of ['SD-N01', 'SD-L01', 'SD-L02', 'SD-L05']) {
    assert.ok(
      analysis.codes.includes(code + ':NOT_CHECKED'),
      code + ' must be NOT_CHECKED again: ' + analysis.codes.join(','),
    );
  }
  assert.deepEqual(
    [...new Set(analysis.findings.map((found) => found.reasonKey))],
    ['legend-not-found'],
    analysis.codes.join(','),
  );
});

test('sent sheets accept both framed status headings', () => {
  for (const heading of ['Условные обозначения', 'Заливка узлов']) {
    assert.deepEqual(analyse(sentSheet().replace('Обозначения линий', heading)).codes, [], heading);
  }
});
