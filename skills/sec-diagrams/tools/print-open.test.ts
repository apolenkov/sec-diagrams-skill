/**
 * The print rules read the page the way the exporter does, style set stops a
 * size the paper will not carry (C21), open refuses to guess a page and the checklist hides
 * nothing that hides on the sheet (C22), and an orthogonal line only excuses the number
 * position, never the whole N01 (C18). Addresses come from RFC 5737.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { runCli } from './cli.ts';
import { buildModel } from './checks/model.ts';
import { checkNumbers } from './checks/numbers.ts';
import { checkPrint } from './checks/print.ts';
import { loadProfile } from './profile.ts';
import { parseDrawio } from './drawio.ts';
import { l1, sub } from './checks.test/support.ts';
import { openValueLines } from './pack-open.ts';
import { rmDir, show, tempDir } from './sending-fixtures.ts';

const profile = loadProfile();

/** Codes and reason keys of checkNumbers over one sheet, the way check walks it. */
function numberFindings(xml: string) {
  const file = parseDrawio(xml);
  return file.pages.flatMap((page) => {
    const model = buildModel('m.drawio', page, profile, []);
    return checkNumbers(model).map((found) => found.status + ':' + found.reasonKey);
  });
}

function printCodes(xml: string): string[] {
  const file = parseDrawio(xml);
  return file.pages.flatMap((page) => {
    const model = buildModel('m.drawio', page, profile, []);
    return checkPrint(model, page).map((found) => found.code);
  });
}

test('an orthogonal line without kinks excuses only the number position', () => {
  const xml = sub('entryX=0;entryY=0.5;', 'entryX=0.5;entryY=1;')(l1());
  const clean = numberFindings(xml);
  assert.ok(clean.includes('NOT_CHECKED:n01-orthogonal-route'), 'the route excuse stays: ' + clean.join(','));
  assert.ok(!clean.some((line) => line.startsWith('FAIL')), 'the clean sheet still has no FAIL: ' + clean.join(','));
  const gapped = numberFindings(sub('id="n2" value="2"', 'id="n2" value="4"')(xml));
  assert.ok(gapped.includes('NOT_CHECKED:n01-orthogonal-route'), gapped.join(','));
  assert.ok(gapped.includes('FAIL:n01-gap'), 'a gap is still a gap under an orthogonal line: ' + gapped.join(','));
  const doubled = numberFindings(sub('id="n2" value="2"', 'id="n2" value="1"')(xml));
  assert.ok(doubled.includes('FAIL:n01-duplicate'), 'a duplicate is still a duplicate: ' + doubled.join(','));
});

test('single-quoted page sizes are read, not missed', () => {
  const ok = l1().replace(
    '<mxGraphModel page="1" pageWidth="1654" pageHeight="1169"',
    "<mxGraphModel page='1' pageWidth='1654' pageHeight='1169'",
  );
  assert.ok(ok.includes("pageWidth='1654'"), 'the mutant really quotes with ticks');
  assert.ok(!printCodes(ok).includes('SD-P02'), 'a single-quoted A3 is still A3');
  const wrong = l1().replace(
    '<mxGraphModel page="1" pageWidth="1654" pageHeight="1169"',
    "<mxGraphModel page='1' pageWidth='1000' pageHeight='700'",
  );
  assert.ok(printCodes(wrong).includes('SD-P02'), 'a single-quoted A4 must not read as no size at all');
});

/** One more label on the first page of l1, drawn at the given style and value. */
function withLabel(id: string, style: string, value: string): (xml: string) => string {
  const cell =
    '<mxCell id="' +
    id +
    '" value="' +
    value +
    '" style="' +
    style +
    '" vertex="1" parent="1"><mxGeometry x="60" y="1000" width="200" height="40" as="geometry"/></mxCell>';
  return (xml) => xml.replace('</root>', cell + '</root>');
}

test('a css size in markup counts in pt and px, and only where the text is visible', () => {
  const small = withLabel(
    'tiny',
    'text;html=1;fontFamily=Arial;fontSize=14;',
    'зона &lt;span style=&quot;font-size:6pt&quot;&gt;6pt&lt;/span&gt;',
  )(l1());
  assert.ok(printCodes(small).includes('SD-P01'), '6pt is 4.3 pt on the paper');
  const px = withLabel(
    'tiny',
    'text;html=1;fontFamily=Arial;fontSize=14;',
    'зона &lt;span style=&quot;font-size:10px&quot;&gt;10px&lt;/span&gt;',
  )(l1());
  assert.ok(printCodes(px).includes('SD-P01'), '10px is 7.5 pt, not 10');
  const hidden = withLabel(
    'tiny',
    'text;html=1;fontFamily=Arial;fontSize=14;',
    'зона &lt;div style=&quot;display:none&quot;&gt;&lt;span style=&quot;font-size:6px&quot;&gt;х&lt;/span&gt;&lt;/div&gt;',
  )(l1());
  assert.ok(!printCodes(hidden).includes('SD-P01'), 'hidden markup prints nothing');
});

test('an edge label without a size is eleven, not twelve', () => {
  const xml = l1().replace(
    '</root>',
    '<mxCell id="el" value="метка" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="e1"><mxGeometry x="0.2" y="2" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell></root>',
  );
  assert.ok(printCodes(xml).includes('SD-P01'), '11 pt lands under 8 on the A3 scale');
});

test('a drawing wider than the page scales the whole sheet down', () => {
  const xml = l1().replace(
    '</root>',
    '<mxCell id="wide" value="подпись" style="text;html=1;fontFamily=Arial;fontSize=12;" vertex="1" parent="1">' +
      '<mxGeometry x="1700" y="100" width="400" height="40" as="geometry"/></mxCell></root>',
  );
  assert.ok(printCodes(xml).includes('SD-P01'), 'the fit scales the export to the drawing, not the page');
});

test('style set refuses a font the paper will not carry', (t) => {
  const dir = tempDir('sd-print-min-');
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 'l1.drawio'), l1());
  const refused = runCli(['style', 'set', join(dir, 'l1.drawio'), 'collector', 'fontSize=11']);
  const out = show(refused.lines);
  assert.equal(refused.code, 64, out);
  assert.ok(/минимум \d+ на этом листе/u.test(out), 'the line names the minimum: ' + out);
  const ok = runCli(['style', 'set', join(dir, 'l1.drawio'), 'collector', 'fontSize=12']);
  assert.equal(ok.code, 0, show(ok.lines));
});

test('style set counts the same print scale as check: a tall page raises the floor', (t) => {
  const dir = tempDir('sd-print-min-tall-');
  t.after(() => rmDir(dir));
  const tall = l1().replace('pageHeight="1169"', 'pageHeight="2000"');
  assert.ok(tall.includes('pageHeight="2000"'), 'the mutant really changes the height');
  writeFileSync(join(dir, 'l1.drawio'), tall);
  // 785 / 2000 = 0.39: the height fit, not the width fit, decides the paper, and 8 pt on paper
  // needs a 21 pt font here; the width alone would have let 12 through.
  const refused = runCli(['style', 'set', join(dir, 'l1.drawio'), 'collector', 'fontSize=12']);
  assert.equal(refused.code, 64, show(refused.lines));
  assert.ok(show(refused.lines).includes('минимум 21 на этом листе'), show(refused.lines));
  const ok = runCli(['style', 'set', join(dir, 'l1.drawio'), 'collector', 'fontSize=21']);
  assert.equal(ok.code, 0, show(ok.lines));
});

test('open refuses an id that lives on two pages until --page names one', (t) => {
  const dir = tempDir('sd-open-page-');
  t.after(() => rmDir(dir));
  const file = join(dir, 'two.drawio');
  const cell =
    '<mxCell id="k1" value="узел" style="whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
    '<mxGeometry x="10" y="10" width="9" height="9" as="geometry"/></mxCell>';
  writeFileSync(
    file,
    '<mxfile><diagram name="P1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      cell +
      '</root></mxGraphModel></diagram><diagram name="P2"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      cell +
      '</root></mxGraphModel></diagram></mxfile>',
  );
  const ambiguous = runCli(['open', file, 'k1']);
  assert.equal(ambiguous.code, 64, show(ambiguous.lines));
  assert.ok(show(ambiguous.lines).includes('--page'), 'the hint names the remedy: ' + show(ambiguous.lines));
  assert.equal(runCli(['open', file, 'k1', '--page', 'P2']).code, 0);
});

test('open --page judges and writes the cell of that page, not the first one by id', (t) => {
  const dir = tempDir('sd-open-pair-');
  t.after(() => rmDir(dir));
  const frame = (id: string, style: string): string =>
    '<mxCell id="' +
    id +
    '" value="узел" style="' +
    style +
    '" vertex="1" parent="1"><mxGeometry x="10" y="10" width="9" height="9" as="geometry"/></mxCell>';
  const page = (name: string, style: string): string =>
    '<diagram name="' +
    name +
    '"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    frame('k1', style) +
    '</root></mxGraphModel></diagram>';
  const write = (file: string, first: string, second: string): string => {
    const path = join(dir, file);
    writeFileSync(path, '<mxfile>' + page('P1', first) + page('P2', second) + '</mxfile>');
    return path;
  };
  // The title of the first page must not stop the value of the second ...
  const titled = write('a.drawio', 'whiteSpace=wrap;html=1;sdRole=title;', 'whiteSpace=wrap;html=1;');
  const marked = runCli(['open', titled, 'k1', '--page', 'P2']);
  assert.equal(marked.code, 0, show(marked.lines));
  const after = readFileSync(titled, 'utf8');
  assert.ok(after.includes('sdRole=title;'), 'the title of P1 is untouched');
  assert.equal(after.split('sdRole=open').length - 1, 1, 'exactly the cell of P2 is marked: ' + after);
  assert.ok(after.indexOf('sdRole=open') > after.indexOf('name="P2"'), 'the mark stands on P2');
  // ... and the plain cell of the first page must not let the legend of the second be marked.
  const framed = write('b.drawio', 'whiteSpace=wrap;html=1;', 'whiteSpace=wrap;html=1;sdRole=legend;');
  const refused = runCli(['open', framed, 'k1', '--page', 'P2']);
  assert.equal(refused.code, 64, show(refused.lines));
  assert.ok(!readFileSync(framed, 'utf8').includes('sdRole=open'), 'nothing is written');
});

test('a hidden open cell never reaches the checklist', (t) => {
  const dir = tempDir('sd-open-hidden-');
  t.after(() => rmDir(dir));
  mkdirSync(dir, { recursive: true });
  const hidden =
    '<mxCell id="h1" value="запас" style="whiteSpace=wrap;html=1;sdRole=open;" visible="0" vertex="1" parent="1">' +
    '<mxGeometry x="1" y="1" width="9" height="9" as="geometry"/></mxCell>';
  writeFileSync(
    join(dir, 's.drawio'),
    '<mxfile><diagram name="S"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="v1" value="узел" style="whiteSpace=wrap;html=1;sdRole=open;" vertex="1" parent="1">' +
      '<mxGeometry x="20" y="20" width="9" height="9" as="geometry"/></mxCell>' +
      hidden +
      '</root></mxGraphModel></diagram></mxfile>',
  );
  const manifest = { service: 'Служба ИБ', final: true, sheets: [{ file: 's.drawio', level: 'L1', topic: 'Проверка' }] };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const loaded = JSON.parse(JSON.stringify(manifest)) as Parameters<typeof openValueLines>[1];
  const lines = openValueLines(dir, loaded).join(' ');
  assert.ok(lines.includes('v1'), 'the visible open value is named');
  assert.ok(!lines.includes('h1'), 'the hidden draft layer stays out of the letter: ' + lines);
});
