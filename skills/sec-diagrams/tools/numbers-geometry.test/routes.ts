/**
 * Where a number may stand and how its line is read: a number typed into the line itself
 * (the label of the edge) and a line drawn without kink points in the
 * orthogonal style, whose route draw.io picks and the checker cannot reproduce (№11).
 * Synthetic sheets from sheet-fixtures; codes, ids and counts only, never label texts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { analyse, idsOf, numberCell, sentSheet, vertex } from '../sheet-fixtures.ts';

test('a number typed into the line itself counts as the number of that line', () => {
  // a double click on a line in draw.io stores the number as the value of
  // the edge and paints it with labelBackgroundColor and labelBorderColor. The checker read
  // vertex badges only, so the sheet lost its number 1 and the advice chain called the live
  // number retired and told the author to delete the list line.
  const relabeled = sentSheet()
    .replace('id="e1" value="" edge="1"', 'id="e1" value="1" edge="1"')
    .replace(
      'strokeColor=#ad3b31;endArrow=classic;exitX=1',
      'strokeColor=#ad3b31;endArrow=classic;fontFamily=Arial;fontSize=14;labelBackgroundColor=#FFFFFF;labelBorderColor=#000000;exitX=1',
    )
    .replace('id="n1" value="1"', 'id="n-void" value=""');
  assert.ok(relabeled.includes('value="1" edge="1"'), 'the number must stand on the line');
  assert.notEqual(relabeled, sentSheet());
  assert.deepEqual(analyse(relabeled).codes, []);
});

test('a number without the label paint of draw.io is not a badge yet', () => {
  // The bare value of a line carries no white square the reader could trust as a number;
  // guessing it would let any stray "1" on a line excuse the line from being numbered.
  const bare = sentSheet()
    .replace('id="e1" value="" edge="1"', 'id="e1" value="1" edge="1"')
    .replace('id="n1" value="1"', 'id="n-void" value=""');
  const analysis = analyse(bare);
  assert.ok(analysis.codes.includes('SD-N01:FAIL'), analysis.codes.join(','));
});

const orthoEdge = (id: string, source: string, target: string, color: string): string =>
  '<mxCell id="' +
  id +
  '" value="" edge="1" parent="1" source="' +
  source +
  '" target="' +
  target +
  '" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;jumpStyle=arc;jumpSize=12;strokeWidth=2;strokeColor=' +
  color +
  ';endArrow=classic;exitX=1;exitY=0.5;entryX=0.5;entryY=0;"><mxGeometry relative="1" as="geometry"></mxGeometry></mxCell>';

test('a line drawn without kinks in the orthogonal style takes the numbers out of the check', () => {
  // draw.io bends an orthogonal line without points around a right angle,
  // the checker reads the straight chord between the anchors, and a number standing on the
  // drawn line fails as "not on the line" while the line fails as "unnumbered". The route is
  // not reproducible here, so SD-N01 says NOT_CHECKED instead of judging placements by a
  // line the sheet does not hold the same way as draw.io does.
  const added = sentSheet().replace(
    '</root>',
    vertex('bx', 'Узел икс', 100, 200, 200, 80) +
      vertex('by', 'Узел игрек', 700, 500, 200, 80) +
      orthoEdge('e-ortho', 'bx', 'by', '#237a53') +
      '</root>',
  );
  const analysis = analyse(added);
  assert.ok(analysis.codes.includes('SD-N01:NOT_CHECKED'), analysis.codes.join(','));
  assert.ok(
    analysis.findings.some((found) => found.ids.includes('e-ortho')),
    analysis.codes.join(','),
  );
  assert.ok(!analysis.codes.some((code) => code.endsWith(':FAIL')), analysis.codes.join(','));
});

test('an orthogonal line whose ends stand on one straight keeps the numbers checked', () => {
  // The exclusion is for routes the checker cannot read: an orthogonal line between ends on
  // one horizontal is drawn straight, the polyline the model reads is the drawn route, and
  // the numbers stay under the rule. The sent sheet already proves this for its own lines.
  const added = sentSheet().replace(
    '</root>',
    vertex('bx', 'Узел икс', 100, 200, 200, 80) +
      vertex('by', 'Узел игрек', 700, 200, 200, 80) +
      orthoEdge('e-ortho', 'bx', 'by', '#237a53').replace('entryX=0.5;entryY=0;', 'entryX=0;entryY=0.5;') +
      '</root>',
  );
  const analysis = analyse(added);
  assert.ok(!analysis.codes.includes('SD-N01:NOT_CHECKED'), analysis.codes.join(','));
  assert.ok(analysis.codes.includes('SD-N01:FAIL'), 'the new line is unnumbered and must say so');
  assert.ok(idsOf(analysis).includes('e-ortho'), analysis.codes.join(','));
});

const withOrtho = (content: string): string =>
  content.replace(
    '</root>',
    vertex('bx', 'Узел икс', 100, 200, 200, 80) +
      vertex('by', 'Узел игрек', 700, 500, 200, 80) +
      orthoEdge('e-ortho', 'bx', 'by', '#237a53') +
      '</root>',
  );

test('the paint of a number badge is checked even when an orthogonal route blinds the positions', () => {
  // The route says nothing about the plate: a number painted blue is a finding wherever the
  // line finally bends. Only the POSITION groups take the detour into NOT_CHECKED.
  const repainted = withOrtho(sentSheet()).replace(
    /(<mxCell id="n1"[^>]*style=")[^"]*(")/,
    '$1rounded=0;html=1;fillColor=#DAE8FC;strokeColor=#000000;fontFamily=Arial;fontSize=14;$2',
  );
  assert.notEqual(repainted, withOrtho(sentSheet()));
  const analysis = analyse(repainted);
  assert.ok(analysis.codes.includes('SD-N01:NOT_CHECKED'), analysis.codes.join(','));
  assert.ok(analysis.codes.includes('SD-N01:FAIL'), analysis.codes.join(','));
  assert.ok(
    analysis.findings.some((found) => found.reasonKey === 'n01-badge-style' && found.ids.includes('n1')),
    analysis.findings.map((found) => found.reasonKey).join(','),
  );
});

test('an unbound number is not a duplicate while an orthogonal route blinds the positions', () => {
  // A second plate "1" far from every line is a duplicate the moment positions are judged -
  // but with the route unreadable it may be the number of the rerouted line, standing where
  // draw.io will bend it. Position questions go to NOT_CHECKED together, no fake duplicate.
  const twin = (content: string): string => content.replace('</root>', numberCell('n1c', '1', 950, 640) + '</root>');
  const duplicateReason = 'n01-duplicate';
  const clean = analyse(twin(sentSheet()));
  assert.ok(
    clean.findings.some((found) => found.reasonKey === duplicateReason),
    'without the blind route the twin is a duplicate: ' + clean.codes.join(','),
  );
  const blind = analyse(withOrtho(twin(sentSheet())));
  assert.ok(blind.codes.includes('SD-N01:NOT_CHECKED'), blind.codes.join(','));
  assert.ok(
    !blind.findings.some((found) => found.reasonKey === duplicateReason),
    'no duplicate when the position is unreadable: ' + blind.findings.map((found) => found.reasonKey).join(','),
  );
  assert.ok(!blind.codes.some((code) => code.endsWith(':FAIL')), blind.codes.join(','));
});

/** The badge plate of the sent sheet wrapped in an <object> the way draw.io's Edit Data does. */
const wrapNumber = (content: string, attrs: string): string =>
  content
    .replace('<mxCell id="n1" value="1"', '<object id="n1" ' + attrs + '><mxCell value="1"')
    .replace(
      '</mxCell>' + String.fromCharCode(10) + '<mxCell id="n2"',
      '</mxCell></object>' + String.fromCharCode(10) + '<mxCell id="n2"',
    );

test('a note attribute on the number cell does not eat the number', () => {
  // draw.io keeps Edit Data ("note", "ip") on the wrapper, and those values join the sheet for
  // the text rules - but the number is what the reader sees on the plate: recognition takes the
  // visible label, not the joined attribute text.
  const noted = wrapNumber(sentSheet(), 'note="проверка"');
  assert.ok(noted.includes('<object id="n1"'), 'the wrapper stands');
  const analysis = analyse(noted);
  assert.deepEqual(analysis.codes, [], analysis.codes.join(','));
  // And the attribute is not invisible for the text rules: a question in it is a question.
  const asking = wrapNumber(sentSheet(), 'note="Согласуете?"');
  const asked = analyse(asking);
  assert.ok(asked.codes.includes('SD-T07:FAIL'), asked.codes.join(','));
  assert.ok(!asked.codes.includes('SD-N01:FAIL'), 'the number itself is still read: ' + asked.codes.join(','));
});
