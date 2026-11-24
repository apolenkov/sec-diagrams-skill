/**
 * Core read/point-edit tests on synthetic sheets only (addresses from RFC 5737).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DrawioInputError,
  encodeDiagramPayload,
  parseDrawio,
  parseStyle,
  setCellValue,
  setCellStyle,
  setStyleKey,
  styleValue,
  type DrawioFile,
} from './drawio.ts';

const INNER_PAGE =
  '<mxGraphModel dx="800"><root>\n<mxCell id="0"/>\n<mxCell id="1" parent="0"/>\n' +
  '<mxCell id="u1" value="Пользователь" style="whiteSpace=wrap;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>\n' +
  '<mxCell id="e2" value="443 - https" style="edgeStyle=elbowEdgeStyle;" edge="1" parent="1" source="u1" target="s1">' +
  '<mxGeometry relative="1" as="geometry"/></mxCell>\n' +
  '<mxCell id="s1" value="Сервер 192.0.2.4" style="whiteSpace=wrap;" vertex="1" parent="1">' +
  '<mxGeometry x="320" y="40" width="120" height="60" as="geometry"/></mxCell>\n</root></mxGraphModel>';

const SHEET = `<mxfile host="app.diagrams.net" pages="3">
<diagram id="page-l1" name="L1"><mxGraphModel dx="1000"><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="c1" value="Сервер &amp; шлюз 192.0.2.10" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="80" y="40" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="e1" value="443 - https" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="c1" target="o1"><mxGeometry relative="1" as="geometry"/></mxCell>
<object id="o1" label="Доступ &#10;по порту"><mxCell style="shape=note;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="80" y="200" width="120" height="80" as="geometry"/></mxCell></object>
</root></mxGraphModel></diagram>
<diagram id="page-l2" name="L2">${encodeDiagramPayload(INNER_PAGE)}</diagram>
<diagram id="page-l3" name="L3"><mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<UserObject id="u3" label="Клиент"><mxCell style="whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="40" height="40" as="geometry"/></mxCell></UserObject>
</root></mxGraphModel></diagram>
</mxfile>`;

/** The raw source chunk of one `<diagram>` element, used for byte-identity comparisons. */
function diagramChunk(text: string, id: string): string {
  const start = text.indexOf(`<diagram id="${id}"`);
  const end = text.indexOf('</diagram>', start);
  assert.ok(start >= 0 && end > start, `diagram ${id} is missing`);
  return text.slice(start, end + '</diagram>'.length);
}

function cellOf(
  file: DrawioFile,
  pageName: string,
  cellId: string,
): { value: string; style: string; attrs: Record<string, string> } {
  const cell = file.pages.find((page) => page.name === pageName)?.cells.find((c) => c.id === cellId);
  assert.ok(cell !== undefined, `cell ${cellId} is missing on ${pageName}`);
  return cell;
}

const geometryList = (text: string): string[] => text.match(/<mxGeometry[^>]*>/gu) ?? [];

const expectInputError = (text: string): void => {
  assert.throws(
    () => parseDrawio(text),
    (error: unknown) => error instanceof DrawioInputError && error.code === 'SD-E01',
    `expected SD-E01 for: ${text.slice(0, 40)}`,
  );
};

test('reads uncompressed pages, compressed pages and object wrappers', () => {
  const file = parseDrawio(SHEET);
  assert.deepEqual(
    file.pages.map((page) => [page.name, page.compressed]),
    [
      ['L1', false],
      ['L2', true],
      ['L3', false],
    ],
  );
  assert.equal(cellOf(file, 'L1', 'c1').value, 'Сервер & шлюз 192.0.2.10');
  assert.equal(cellOf(file, 'L1', 'o1').value, 'Доступ \nпо порту', 'wrapper label with &#10;');
  const edge = file.pages[0]?.cells.find((cell) => cell.id === 'e1');
  assert.ok(edge !== undefined && edge.edge && !edge.vertex && edge.source === 'c1' && edge.target === 'o1');
  assert.equal(cellOf(file, 'L2', 'u1').value, 'Пользователь', 'compressed page cell');
  assert.equal(cellOf(file, 'L2', 'e2').style, 'edgeStyle=elbowEdgeStyle;');
  assert.equal(cellOf(file, 'L3', 'u3').value, 'Клиент', 'UserObject label');
  assert.equal(cellOf(file, 'L3', 'u3').style, 'whiteSpace=wrap;', 'style comes from the nested mxCell');
});

test('a bare mxGraphModel is one page', () => {
  const file = parseDrawio(INNER_PAGE);
  assert.equal(file.pages.length, 1);
  assert.equal(cellOf(file, '', 's1').value, 'Сервер 192.0.2.4');
});

test('the page size is read from pageWidth and pageHeight, the draw.io attributes', () => {
  const file = parseDrawio(
    '<mxfile><diagram name="P"><mxGraphModel page="1" pageWidth="1654" pageHeight="1169"><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',
  );
  assert.equal(file.pages[0]?.width, 1654, 'draw.io writes pageWidth, not width');
  assert.equal(file.pages[0]?.height, 1169);
});

test('a sheet stating only width and height keeps its declared size', () => {
  const file = parseDrawio(
    '<mxfile><diagram name="P"><mxGraphModel width="800" height="600"><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',
  );
  assert.equal(file.pages[0]?.width, 800);
  assert.equal(file.pages[0]?.height, 600);
});

test('setCellValue on an uncompressed page changes only the value range', () => {
  const file = parseDrawio(SHEET);
  const updated = setCellValue(file, 0, 'c1', 'Новое значение');
  assert.ok(updated.includes('value="Новое значение"'));
  assert.equal(updated.replace('Новое значение', 'Сервер &amp; шлюз 192.0.2.10'), SHEET, 'single point change');
  assert.deepEqual(geometryList(updated), geometryList(SHEET), 'every mxGeometry is byte-identical');
  assert.equal(diagramChunk(updated, 'page-l2'), diagramChunk(SHEET, 'page-l2'));
  assert.equal(diagramChunk(updated, 'page-l3'), diagramChunk(SHEET, 'page-l3'));
});

test('setCellValue on a compressed page rewrites only that page', () => {
  const file = parseDrawio(SHEET);
  const updated = setCellValue(file, 1, 'u1', 'Новый пользователь');
  assert.equal(diagramChunk(updated, 'page-l1'), diagramChunk(SHEET, 'page-l1'));
  assert.equal(diagramChunk(updated, 'page-l3'), diagramChunk(SHEET, 'page-l3'));
  const reread = parseDrawio(updated);
  assert.equal(cellOf(reread, 'L2', 'u1').value, 'Новый пользователь');
  const idsBefore = file.pages.map((page) => page.cells.map((cell) => cell.id).sort());
  const idsAfter = reread.pages.map((page) => page.cells.map((cell) => cell.id).sort());
  assert.deepEqual(idsAfter, idsBefore, 'the id set of every page is unchanged');
});

test('escapes & < > " and line breaks on write and decodes them on read', () => {
  const file = parseDrawio(SHEET);
  const value = 'A & B <C> "D"\nE &lt;F&gt; &#10; G';
  const updated = setCellValue(file, 0, 'c1', value);
  assert.ok(updated.includes('&#xa;'), 'line break written as a character reference');
  assert.equal(cellOf(parseDrawio(updated), 'L1', 'c1').value, value);
});

test('setCellStyle keeps the key order and appends a new key at the end', () => {
  const style = 'rounded=0;whiteSpace=wrap;html=1;';
  assert.deepEqual(parseStyle(style), [
    { key: 'rounded', value: '0' },
    { key: 'whiteSpace', value: 'wrap' },
    { key: 'html', value: '1' },
  ]);
  assert.equal(styleValue(style, 'html'), '1');
  assert.equal(styleValue(style, 'missing'), undefined);
  assert.equal(setStyleKey(style, 'rounded', '1'), 'rounded=1;whiteSpace=wrap;html=1;');
  assert.equal(setStyleKey(style, 'jumpStyle', 'arc'), 'rounded=0;whiteSpace=wrap;html=1;jumpStyle=arc;');
  assert.equal(setStyleKey('rounded=0', 'jumpSize', '12'), 'rounded=0;jumpSize=12');
  assert.equal(setStyleKey('', 'fontFamily', 'Arial'), 'fontFamily=Arial;');
  const file = parseDrawio(SHEET);
  const updated = setCellStyle(file, 1, 's1', setStyleKey(cellOf(file, 'L2', 's1').style, 'fontFamily', 'Arial'));
  assert.equal(cellOf(parseDrawio(updated), 'L2', 's1').style, 'whiteSpace=wrap;fontFamily=Arial;');
});

test('rejects DTD, duplicate ids, dangling source and broken XML with SD-E01', () => {
  expectInputError('<?xml version="1.0"?><!DOCTYPE mxfile SYSTEM "evil.dtd"><mxfile><diagram/></mxfile>');
  expectInputError(
    '<mxfile><diagram id="p" name="P"><mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="1" value="д" vertex="1" parent="1"/>' +
      '</root></mxGraphModel></diagram></mxfile>',
  );
  expectInputError(
    '<mxfile><diagram id="p" name="P"><mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="e" edge="1" parent="1" source="ghost" target="1"/>' +
      '</root></mxGraphModel></diagram></mxfile>',
  );
  expectInputError('<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>');
  expectInputError('<mxfile><broken><diagram/></broken></mxfile>');
});

test('text set on a bare object wrapper writes the label onto the wrapper, not the inner cell', () => {
  // A UserObject without label and value keeps its properties (link, tooltip) only while the
  // text lands on the wrapper: a value written into the inner mxCell replaces the whole
  // object on the next save in draw.io, and the properties vanish with it.
  const xml =
    '<mxfile><diagram id="d" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<UserObject id="u9" link="page.pdf"><mxCell style="whiteSpace=wrap;" vertex="1" parent="1">' +
    '<mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></UserObject>' +
    '</root></mxGraphModel></diagram></mxfile>';
  const written = setCellValue(parseDrawio(xml), 0, 'u9', 'T9');
  assert.ok(written.includes('<UserObject id="u9" link="page.pdf" label="T9">'), written);
  assert.ok(!written.includes('<mxCell style="whiteSpace=wrap;" vertex="1" parent="1" value='), written);
  assert.equal(cellOf(parseDrawio(written), 'P', 'u9').value, 'T9');
  assert.ok(written.includes('link="page.pdf"'), 'the wrapper keeps its properties');
});

test('a bare object wrapper still reads the value of its inner cell', () => {
  const xml =
    '<mxfile><diagram id="d" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<object id="o9"><mxCell value="Изнутри" style="whiteSpace=wrap;" vertex="1" parent="1">' +
    '<mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></object>' +
    '</root></mxGraphModel></diagram></mxfile>';
  assert.equal(cellOf(parseDrawio(xml), 'P', 'o9').value, 'Изнутри');
});

test('a page cell states visibility, and a hidden one says so', () => {
  const file = parseDrawio(
    '<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="L" visible="0" vertex="1" parent="0"/>' +
      '<mxCell id="c1" value="x" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>',
  );
  const cells = file.pages[0]?.cells ?? [];
  assert.equal(cells.find((cell) => cell.id === 'L')?.visible, false);
  assert.equal(cells.find((cell) => cell.id === 'c1')?.visible, true);
});

test('a wrapper cell keeps the attributes draw.io shows the reader', () => {
  // The Edit Data attributes of an object live next to the id on the wrapper: %имя% turns into
  // the attribute of the same name when placeholders="1", and tooltip hangs beside the label.
  const file = parseDrawio(
    '<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<object id="o1" label="Сборщик %ip%" placeholders="1" ip="192.0.2.10" tooltip="шлюз">' +
      '<mxCell vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></object>' +
      '</root></mxGraphModel></diagram></mxfile>',
  );
  const attrs = cellOf(file, 'P', 'o1').attrs;
  assert.equal(attrs['placeholders'], '1');
  assert.equal(attrs['ip'], '192.0.2.10');
  assert.equal(attrs['tooltip'], 'шлюз');
  assert.deepEqual(cellOf(file, 'P', 'o1').value, 'Сборщик %ip%');
  const plain = parseDrawio(
    '<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="c" value="x" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>',
  );
  assert.deepEqual(plain.pages[0]?.cells.find((cell) => cell.id === 'c')?.attrs, {});
});

test('adds a missing value or style attribute without dropping the rest of the file', () => {
  const xml =
    '<mxfile><diagram id="d" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="a" vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell>' +
    '<mxCell id="b" value="x" edge="1" parent="1"/></root></mxGraphModel></diagram></mxfile>';
  const file = parseDrawio(xml);
  const styled = setCellStyle(file, 0, 'a', 'fontFamily=Arial;');
  assert.equal(
    styled,
    xml.replace(
      '<mxCell id="a" vertex="1" parent="1">',
      '<mxCell id="a" vertex="1" parent="1" style="fontFamily=Arial;">',
    ),
  );
  const valued = setCellValue(file, 0, 'a', 'y');
  assert.ok(valued.endsWith('</mxfile>'));
  assert.equal(parseDrawio(valued).pages[0]?.cells.find((cell) => cell.id === 'a')?.value, 'y');
  const selfClosing = setCellStyle(file, 0, 'b', 'rounded=1;');
  assert.ok(selfClosing.includes('<mxCell id="b" value="x" edge="1" parent="1" style="rounded=1;"/>'));
  assert.ok(selfClosing.endsWith('</mxfile>'));
});
