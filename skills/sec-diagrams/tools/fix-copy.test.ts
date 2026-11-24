/**
 * fix --safe in a copy for sending edits styles apart from text: a cell whose label
 * needs a person's pen still gets its font fixed, and the cells it has handled are remembered by
 * page and id, so one id standing on two pages is two cells. Sheets are synthetic.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDrawio } from './drawio.ts';
import { fixContext, fixFile } from './fix.ts';

const cell = (id: string, value: string, style: string): string =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="1" y="2" width="9" height="9" as="geometry"/></mxCell>`;

const page = (name: string, ...cells: string[]): string =>
  `<diagram id="${name}" name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram>`;

const file = (...pages: string[]): string => '<mxfile host="app">' + pages.join('') + '</mxfile>';

test('in a copy the font is fixed apart from the text that stays for the person', () => {
  // The label carries ё, a text fix a person makes; the style names Courier, which fix repairs.
  const source = file(page('L1', cell('k1', 'Шлюз ёж', 'whiteSpace=wrap;fontFamily=Courier;')));
  const result = fixFile(parseDrawio(source), fixContext(), false);
  assert.ok(!result.text.includes('Courier'), 'the font is repaired: ' + result.text);
  assert.ok(result.text.includes('Шлюз ёж'), 'the text is left as the person wrote it');
  assert.deepEqual(result.manual, ['k1'], 'and the text is reported as the person’s step');
  assert.ok((result.counts.get('SD-F01') ?? 0) >= 1, 'the font fix is counted');
});

test('the handled cells are kept by page and id: one id on two pages is two cells', () => {
  const source = file(
    page('L1', cell('k1', 'Шлюз ёж', 'whiteSpace=wrap;fontFamily=Arial;')),
    page('L2', cell('k1', 'Сервер', 'whiteSpace=wrap;fontFamily=Courier;')),
  );
  const result = fixFile(parseDrawio(source), fixContext(), false);
  assert.ok(!result.text.includes('Courier'), 'the second page k1 is not skipped by the first: ' + result.text);
  assert.deepEqual(result.manual, ['k1'], 'the person is told once, for the first page only');
});
