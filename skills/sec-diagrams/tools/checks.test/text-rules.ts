/**
 * Text-rule cases that need a whole sheet: the markup a cell carries (a font in quotes, an
 * HTML list) and the region a cell stands in (the legend) answer the rules like the plain
 * words do. One code per test, judged over the clean l1 template.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { codesOf, l1, l3, PROXY, proxyObject, sub } from './support.ts';

test('a quoted family and a fallback stack read as the font the page renders', () => {
  // A pasted Word label keeps its quotes as character references, a browser writes a family
  // with spaces in quotes, and a stack names fallbacks after a comma. None of these may fail
  // SD-F01 while the first family is the allowed one; only the mutant with an alien family
  // fails.
  const quoted = codesOf(
    'l1.drawio',
    sub(
      'value="Сборщик"',
      'value="&lt;span style=&quot;font-family: &amp;quot;Arial&amp;quot;;&quot;&gt;Сборщик&lt;/span&gt;"',
    )(l1()),
  );
  assert.deepEqual(quoted, []);
  const stack = codesOf(
    'l1.drawio',
    sub(
      'value="Сборщик"',
      'value="&lt;span style=&quot;font-family: Arial, sans-serif&quot;&gt;Сборщик&lt;/span&gt;"',
    )(l1()),
  );
  assert.deepEqual(stack, []);
});

test('the legend text answers the text rules too', () => {
  // every text rule skipped the legend, so a date, a page reference, an
  // unknown mask and a question hidden in a legend row passed silently. The legend holds
  // free-worded footnotes, not only notation samples; the samples themselves are exempt by
  // name (the footer line) or by their form, not by the whole region.
  const legend = codesOf(
    'mutant.drawio',
    sub(
      'id="legend-row-4-text" value="Существующий объект"',
      'id="legend-row-4-text" value="Существующий объект с 17.08.2032, см. лист 3, {NET}. Какой порт нужен?"',
    )(l1()),
  );
  assert.deepEqual(legend, ['SD-T03', 'SD-T05', 'SD-T06', 'SD-T07']);
});

test('an ordered list drawn as HTML markup is a list for the dash rule', () => {
  // "<ol><li>" items carry no visible number in the text, but each of them
  // is a list item, and " - " separates the purpose from the protocol inside one.
  const ordered = codesOf(
    'mutant.drawio',
    sub('value="Сборщик"', 'value="&lt;ol&gt;&lt;li&gt;Доступ админа - SSH (22/TCP)&lt;/li&gt;&lt;/ol&gt;"')(l1()),
  );
  assert.deepEqual(ordered, []);
});

test('what an object wrapper carries is on the sheet', () => {
  // with placeholders="1" draw.io replaces %имя% by the attribute of the
  // same name before it draws the label, and the tooltip is one Edit Data click away from the
  // reader. A checker that reads only the stored label misses the address the reader sees in
  // the box and the date hidden in the tooltip.
  const filled = codesOf(
    'mutant.drawio',
    sub(
      PROXY,
      proxyObject('label="Сборщик %ip%" placeholders="1" ip="192.0.2.10" tooltip="шлюз 192.0.2.1, заведен 17.08.2032"'),
    )(l1()),
  );
  assert.deepEqual(filled, ['SD-T03', 'SD-T04']);
  const literal = codesOf('mutant.drawio', sub(PROXY, proxyObject('label="Сборщик %ip%" ip="192.0.2.10"'))(l1()));
  // attributes the wrapper carries are text the reader reaches through Edit Data
  // even without the substitution - the stored address in "ip" answers to the address rule now.
  assert.deepEqual(literal, ['SD-T04'], 'wrapper attributes are sheet text even without placeholders');
});

test('cyrillic word boundaries keep lookalikes clean', () => {
  const listing = codesOf('l1.drawio', sub('value="Внешние репозитории"', 'value="Листинг 3"')(l1()));
  assert.deepEqual(listing, []);
  const slash = codesOf('l3-1.drawio', sub('value="PostgreSQL (5432/TCP)"', 'value="SMB (445/TCP)"')(l3()));
  assert.deepEqual(slash, []);
  const address = codesOf('l1.drawio', sub('value="Сборщик"', 'value="192.0.2.10"')(l1()));
  assert.ok(address.includes('SD-T04'));
  assert.ok(!address.includes('SD-T03'), 'an address must not read as a date');
});
