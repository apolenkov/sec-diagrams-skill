/**
 * Numbers and geometry on sheets drawn before the skill, against the geometry the checker now
 * reads. Everything here is synthetic: the base sheet copies how a sent sheet stands -
 * connections with exit/entry anchors and kink points, numbers as separate white cells 24x24
 * with a border whose centre sits on the line, a connection list, and a legend drawn as a plain
 * frame with the heading «Обозначения линий» and sample lines inside. The tests assert
 * codes, cell ids and counts only; a label from the sheet never enters an assertion message.
 * How the legend itself is found - or not - lives in numbers-geometry.test/legend.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { anchorPoint, edgePolyline, headAt } from './checks/geometry.ts';
import './numbers-geometry.test/legend.ts';
import './numbers-geometry.test/routes.ts';
import {
  analyse,
  baseCells,
  connection,
  edgeStyle,
  freeEdge,
  idsOf,
  kinks,
  LEGEND,
  numberCell,
  NUMBER_STYLE,
  sentSheet,
  trunkSheet,
  TEXT_STYLE,
  TITLE,
  vertex,
  wrap,
} from './sheet-fixtures.ts';

test('numbering that starts at 2 is a gap: retired [1] closes it, nothing else excuses it', () => {
  const shifted = (content: string): string =>
    content
      .replace('id="n1" value="1"', 'id="n1" value="2"')
      .replace('id="n2" value="2"', 'id="n2" value="3"')
      .replace('id="n3" value="3"', 'id="n3" value="4"')
      .replace('id="n4" value="4"', 'id="n4" value="5"')
      .replace('4. SSH (22/TCP) - доступ блока семь', '5. SSH (22/TCP) - доступ блока семь')
      .replace('3. HTTPS (443/TCP) - доступ блока пять', '4. HTTPS (443/TCP) - доступ блока пять')
      .replace('2. HTTPS (443/TCP) - доступ блока три', '3. HTTPS (443/TCP) - доступ блока три')
      .replace('1. SSH (22/TCP) - доступ блока один', '2. SSH (22/TCP) - доступ блока один');
  const analysis = analyse(shifted(sentSheet()));
  // The old gap rule had no previous number for the smallest one, so 2, 3, 4, 5 passed.
  assert.deepEqual(analysis.codes, ['SD-N01:FAIL']);
  assert.deepEqual(
    analysis.findings.map((found) => found.reasonKey),
    ['n01-gap'],
  );
  assert.deepEqual(analyse(shifted(sentSheet()), [1]).codes, []);
});

test('a retired number does not hide the hole before the numbering starts', () => {
  // The walk over gaps compared neighbours only, so 3, 4, 5 with 2
  // retired passed silently - nobody asked where 1 went. The walk now counts from 1 to the
  // largest number, and every number neither used nor retired is a hole; the first badge
  // above the hole answers for it.
  const startAtThree = (content: string): string =>
    content
      .replace('id="n1" value="1"', 'id="n1" value="3"')
      .replace('id="n2" value="2"', 'id="n2" value="4"')
      .replace('id="n3" value="3"', 'id="n3" value="5"')
      .replace('id="n4" value="4"', 'id="n4" value="6"')
      .replace('4. SSH (22/TCP) - доступ блока семь', '6. SSH (22/TCP) - доступ блока семь')
      .replace('3. HTTPS (443/TCP) - доступ блока пять', '5. HTTPS (443/TCP) - доступ блока пять')
      .replace('2. HTTPS (443/TCP) - доступ блока три', '4. HTTPS (443/TCP) - доступ блока три')
      .replace('1. SSH (22/TCP) - доступ блока один', '3. SSH (22/TCP) - доступ блока один');
  const analysis = analyse(startAtThree(sentSheet()), [2]);
  assert.deepEqual(
    analysis.findings.map((found) => found.reasonKey),
    ['n01-gap'],
  );
  assert.deepEqual(analysis.findings[0]?.ids, ['n1'], 'the badge above the hole answers');
  assert.deepEqual(analyse(startAtThree(sentSheet()), [1, 2]).codes, [], 'retired 1 closes it');
});

test('a circle at one end and a head at the other point the same way wherever they stand', () => {
  // №13 and №14 of the review: hasArrowEnd counted the initiator's circle as a head, and
  // isTwoWay excused it only at the start. A line drawn from the receiver back to the
  // initiator (head at the start, circle at the end) looked two-way and failed L05, and
  // two meeting lines with circles failed the reverse pair as a double number. The head
  // predicate now knows the mark at both ends.
  assert.equal(headAt('startArrow=oval;endArrow=classic', 'A', 'B'), 'B');
  assert.equal(headAt('startArrow=classic;endArrow=oval', 'A', 'B'), 'A');
  assert.equal(headAt('startArrow=classic;endArrow=classic', 'A', 'B'), null);
});

test('a red line whose only mark is the initiator circle still lacks an arrow', () => {
  // c12 of the review: the palette asks a red line for a head; the circle names the
  // initiator and is not one. The old hasArrowEnd let the line pass L02 with endArrow=none.
  const circled = sentSheet().replace('#ad3b31;endArrow=classic', '#ad3b31;startArrow=oval;endArrow=none');
  assert.notEqual(circled, sentSheet());
  const analysis = analyse(circled);
  assert.ok(analysis.codes.includes('SD-L02:FAIL'), analysis.codes.join(','));
  assert.ok(idsOf(analysis).includes('e1'), analysis.codes.join(','));
  assert.ok(!analysis.codes.includes('SD-L05:FAIL'), analysis.codes.join(','));
});

test('a connection drawn from the receiver to the initiator is not two-way', () => {
  // №14: same picture, opposite draw order - the head sits at the start, the circle at
  // the end. L05 reported it two-way and its hint told the author to delete the only head.
  const reversed = sentSheet().replace('endArrow=classic', 'startArrow=classic;endArrow=oval');
  assert.notEqual(reversed, sentSheet());
  assert.deepEqual(analyse(reversed).codes, []);
});

test('the initiator mark at the start of a line is not an arrow head', () => {
  const oval = sentSheet().replace('endArrow=classic', 'startArrow=oval;endArrow=classic');
  assert.ok(oval.includes('startArrow=oval'), 'the substitution must have landed on a line');
  assert.deepEqual(analyse(oval).codes, []);
  const both = sentSheet().replace('endArrow=classic', 'startArrow=classic;endArrow=classic');
  assert.deepEqual(analyse(both).codes, ['SD-L05:FAIL']);
});

test('a sdRole=rules cell excuses its own subtree, not the page', () => {
  // One cell marked sdRole=rules turned the number and line rules off
  // for the whole page - a stray rules table next to a real scheme hid a foreign line color.
  // The mark now excuses the cells under it; the page around it stays under the rules.
  const foreign = sentSheet().replace('#ad3b31;endArrow=classic', '#123456;endArrow=classic');
  const withTable = foreign.replace(
    '</root>',
    vertex('rules-note', '443/TCP', 950, 1000, 200, 30, 'rounded=0;html=1;sdRole=rules;') + '</root>',
  );
  assert.notEqual(withTable, foreign);
  const analysis = analyse(withTable);
  assert.ok(
    analysis.codes.includes('SD-L02:FAIL'),
    'the stray table must not silence the line: ' + analysis.codes.join(','),
  );
  assert.ok(idsOf(analysis).includes('e1'), analysis.codes.join(','));
});

test('a line inside a marked rules table is a row of the table, not a connection', () => {
  // The generated rules page marks every cell sdRole=rules; with the subtree excused the page
  // holds no line for the notation rules at all, and stays silent the way it was silent
  // under the whole-page switch.
  const withTable = sentSheet().replace(
    '</root>',
    vertex('rules-frame', '', 60, 950, 760, 150, 'rounded=0;html=1;sdRole=rules;') +
      freeEdge('e-tab', 100, 1000, 700, 1000, '#123456', 'rules-frame') +
      '</root>',
  );
  assert.ok(withTable.includes('parent="rules-frame"'));
  const analysis = analyse(withTable);
  assert.deepEqual(analysis.codes, [], analysis.codes.join(','));
});

test('a hidden layer and its cells take part in no rule', () => {
  // A colleague hides the draft layer in draw.io instead of deleting it: layer visible="0",
  // a dashed frame and notes inside it. They are invisible on the sheet and in the PDF, so no
  // rule may report them - not even the width vote of the lines on the page.
  const layer =
    '<mxCell id="layer" visible="0" vertex="1" parent="0"' +
    ' style="rounded=0;html=1;dashed=1;strokeColor=#ad3b31;fontFamily=Arial;fontSize=14;">' +
    '<mxGeometry x="1300" y="850" width="300" height="200" as="geometry"/></mxCell>';
  const draft =
    '<mxCell id="draft" value="Сборщик ё" vertex="1" parent="layer" style="' +
    TEXT_STYLE +
    '"><mxGeometry x="10" y="10" width="200" height="40" as="geometry"/></mxCell>';
  const draftNumber =
    '<mxCell id="n9" value="9" vertex="1" parent="layer" style="' +
    NUMBER_STYLE +
    '">' +
    '<mxGeometry x="30" y="120" width="24" height="24" as="geometry"/></mxCell>';
  const analysis = analyse(sentSheet().replace('</root>', layer + draft + draftNumber + '</root>'));
  assert.deepEqual(analysis.codes, [], analysis.codes.join(','));
});

test('a sent-style sheet: numbers bound by geometry, legend found, no findings', () => {
  const analysis = analyse(sentSheet());
  assert.deepEqual(analysis.codes, []);
  assert.equal(analysis.model.legend, 'found');
  assert.deepEqual(
    analysis.model.badges.map((badge) => badge.edges),
    [['e1'], ['e2'], ['e3'], ['e4']],
  );
});

test('a legend sample of a foreign color is notation, not a connection', () => {
  const analysis = analyse(sentSheet());
  assert.ok(!analysis.model.connections.some((cell) => cell.id === 'legend-line-2'));
  assert.ok(!analysis.codes.includes('SD-L02:FAIL') && !analysis.codes.includes('SD-L05:FAIL'));
});

test('a number shifted 20 px off its line is reported by its own id', () => {
  const analysis = analyse(sentSheet().replace('<mxGeometry x="348" y="318"', '<mxGeometry x="348" y="338"'));
  // One finding per reason now: the line lost its number, and the shifted number stands on nothing.
  assert.deepEqual(analysis.codes, ['SD-N01:FAIL', 'SD-N01:FAIL']);
  assert.ok(idsOf(analysis).includes('n2'), 'the shifted number itself must be named');
  assert.deepEqual(analysis.model.badges.find((badge) => badge.cellId === 'n2')?.edges, []);
});

test('two numbers 3 are reported', () => {
  const analysis = analyse(sentSheet().replace('id="n4" value="4"', 'id="n4" value="3"'));
  // Two reasons now: the duplicate itself, and the line that stands without its number.
  assert.deepEqual(analysis.codes, ['SD-N01:FAIL', 'SD-N01:FAIL']);
  assert.ok(idsOf(analysis).includes('n3') && idsOf(analysis).includes('n4'));
});

test('a number 5 with no list line is reported by its own id', () => {
  const withoutLine = sentSheet().replace('&#10;4. SSH (22/TCP) - доступ блока семь к блоку восемь', '');
  const analysis = analyse(withoutLine.replace('id="n4" value="4"', 'id="n4" value="5"'));
  // Two reasons name the same cell: the missing list line, and the gap of 4 before 5.
  assert.deepEqual(analysis.codes, ['SD-N01:FAIL', 'SD-N01:FAIL']);
  assert.deepEqual([...new Set(idsOf(analysis))], ['n4']);
});

test('a number between two parallel lines, 4 px from both, is reported as standing on two', () => {
  const crowded = sentSheet().replace(
    '</root>',
    freeEdge('e-a', 300, 850, 700, 850, '#ad3b31') +
      freeEdge('e-b', 300, 858, 700, 858, '#ad3b31') +
      numberCell('n5', '5', 500, 854) +
      '</root>',
  );
  const analysis = analyse(crowded);
  // Two reasons name the same cell: the number stands on two lines, and no list line carries it.
  assert.deepEqual(analysis.codes, ['SD-N01:FAIL', 'SD-N01:FAIL']);
  assert.deepEqual(analysis.model.badges.find((badge) => badge.cellId === 'n5')?.edges, ['e-a', 'e-b']);
  assert.deepEqual([...new Set(idsOf(analysis))], ['n5']);
});

test('a number painted green breaks the number style', () => {
  const green = 'rounded=0;html=1;fillColor=#237a53;strokeColor=#000000;fontFamily=Arial;fontSize=14;';
  const analysis = analyse(
    sentSheet().replace(
      'id="n3" value="3" vertex="1" parent="1" style="' + NUMBER_STYLE + '"',
      'id="n3" value="3" vertex="1" parent="1" style="' + green + '"',
    ),
  );
  assert.deepEqual(analysis.codes, ['SD-N01:FAIL']);
  assert.deepEqual(idsOf(analysis), ['n3']);
});

test('a number on the shared trunk of two lines is not a defect when the line names both targets', () => {
  const branch = wrap([
    TITLE,
    vertex('src', 'Блок один', 100, 300, 200, 60),
    vertex('t1', 'Сервер А', 700, 150, 200, 60),
    vertex('t2', 'Сервер Б', 700, 450, 200, 60),
    connection('e1', 'src', 't1', '#ad3b31', kinks([450, 330])),
    connection('e2', 'src', 't2', '#ad3b31', kinks([450, 330])),
    numberCell('n1', '1', 375, 330),
    vertex('list', '1. HTTPS (443/TCP) - доступ к серверам Сервер А и Сервер Б', 100, 940, 700, 60, TEXT_STYLE),
    ...LEGEND,
  ]);
  assert.deepEqual(analyse(branch).codes, []);
});

test('a shared trunk to numbered targets passes when the line enumerates them compactly', () => {
  const sheet = trunkSheet(['ВМ 1', 'ВМ 2'], '1. SSH (22/TCP) - доступ к ВМ 1 или 2');
  assert.deepEqual(analyse(sheet).codes, []);
});

test('a shared trunk whose line names only one numbered target is an ambiguous number', () => {
  const analysis = analyse(trunkSheet(['ВМ 1', 'ВМ 2'], '1. SSH (22/TCP) - доступ к ВМ 1'));
  assert.ok(analysis.codes.includes('SD-N01:FAIL'));
  assert.ok(idsOf(analysis).includes('n1'));
});

test('a shared trunk passes when a target is named without its trailing product word', () => {
  const sheet = trunkSheet(
    ['Узел сбора Prometheus', 'Хранилище образов'],
    '1. HTTPS (443/TCP) - Узел сбора и Хранилище образов',
  );
  assert.deepEqual(analyse(sheet).codes, []);
});

test('black is an existing connection: an arrow is optional, a red line still needs one', () => {
  const blackArrow = sentSheet().replace(
    'strokeColor=#2867a6;endArrow=classic;exitX=1;exitY=0.5;entryX=0;entryY=0.5;"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>',
    'strokeColor=#000000;endArrow=classic;exitX=1;exitY=0.5;entryX=0;entryY=0.5;"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>',
  );
  assert.notEqual(blackArrow, sentSheet());
  assert.ok(!analyse(blackArrow).codes.includes('SD-L02:FAIL'));
  const redBare = sentSheet().replace('strokeColor=#ad3b31;endArrow=classic;', 'strokeColor=#ad3b31;endArrow=none;');
  assert.notEqual(redBare, sentSheet());
  const red = analyse(redBare);
  assert.ok(red.codes.includes('SD-L02:FAIL'));
  assert.ok(idsOf(red).includes('e1'));
});

test('a dashed frame passes while the legend holds a dashed frame sample', () => {
  const dashed = 'rounded=0;html=1;dashed=1;fillColor=none;strokeColor=#000000;fontFamily=Arial;fontSize=14;';
  const frame = vertex('grp', '', 80, 100, 760, 300, dashed);
  const sample = vertex('legend-frame', '', 30, 200, 80, 40, dashed, 'lf');
  const withSample = analyse(wrap([...baseCells([...LEGEND, sample]), frame]));
  assert.ok(!withSample.codes.includes('SD-L01:WARN'));
  const without = analyse(wrap([...baseCells(LEGEND), frame]));
  assert.ok(without.codes.includes('SD-L01:WARN'));
  assert.ok(idsOf(without).includes('grp'));
});

test('reverse arrows between two blocks carry one number each and one line without a finding', () => {
  const twins = wrap([
    TITLE,
    vertex('bx', 'Блок один', 100, 120, 200, 60),
    vertex('by', 'Блок два', 600, 120, 200, 60),
    '<mxCell id="e1" value="" edge="1" parent="1" source="bx" target="by" style="' +
      edgeStyle('#ad3b31', 'exitX=1;exitY=0.4;entryX=0;entryY=0.4;') +
      '"><mxGeometry relative="1" as="geometry"/></mxCell>',
    '<mxCell id="e2" value="" edge="1" parent="1" source="by" target="bx" style="' +
      edgeStyle('#ad3b31', 'exitX=0;exitY=0.6;entryX=1;entryY=0.6;') +
      '"><mxGeometry relative="1" as="geometry"/></mxCell>',
    numberCell('na', '1', 450, 144),
    numberCell('nb', '1', 450, 156),
    vertex('list', '1. HTTPS (443/TCP) - обмен между блоками один и два', 100, 940, 700, 60, TEXT_STYLE),
    ...LEGEND,
  ]);
  const analysis = analyse(twins);
  assert.deepEqual(analysis.codes, []);
});

test('a point with exitX=1,exitY=0.5 sits on the right middle of its frame', () => {
  assert.deepEqual(anchorPoint({ x1: 10, y1: 20, x2: 110, y2: 70 }, 'exitX=1;exitY=0.5;', 'exit'), { x: 110, y: 45 });
});

test('kink points shift with a vertex parent and the ends stay absolute', () => {
  assert.deepEqual(edgePolyline({ x: 110, y: 45 }, { x: 200, y: 45 }, [{ x: 150, y: 40 }], { x: 10, y: 10 }), [
    { x: 110, y: 45 },
    { x: 160, y: 50 },
    { x: 200, y: 45 },
  ]);
});

test('a free edge inside a vertex reads its polyline in absolute coordinates', () => {
  const content = wrap([
    vertex('v', '', 100, 100, 100, 40, 'rounded=0;html=1;fillColor=none;strokeColor=#000000;'),
    '<mxCell id="e" value="" edge="1" parent="v" style="' +
      edgeStyle('#ad3b31', '') +
      '">' +
      '<mxGeometry relative="1" as="geometry"><mxPoint x="0" y="20" as="sourcePoint"/><mxPoint x="60" y="20" as="targetPoint"/>' +
      '<Array as="points"><mxPoint x="20" y="10"/><mxPoint x="40" y="10"/></Array></mxGeometry></mxCell>',
  ]);
  const { model } = analyse(content);
  assert.deepEqual(model.polylines.get('e'), [
    { x: 100, y: 120 },
    { x: 120, y: 110 },
    { x: 140, y: 110 },
    { x: 160, y: 120 },
  ]);
});

test('a shared branch can start between the other route’s stored waypoints', () => {
  const sheet = trunkSheet(['Узел А', 'Узел Б'], '1. SSH (22/TCP) - Узел А и Узел Б');
  const uneven = sheet.replace(kinks([450, 330]), kinks([400, 330.002], [450, 330]));
  assert.notEqual(uneven, sheet);
  assert.deepEqual(analyse(uneven).codes, []);
  const divergent = uneven.replace(kinks([400, 330.002], [450, 330]), kinks([355, 280], [375, 330]));
  assert.ok(analyse(divergent).findings.some(f => f.reasonKey === 'n01-number-on-two-lines'));
});
