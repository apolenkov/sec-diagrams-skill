import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCheck } from './check.ts';
import { runCli } from './cli.ts';
import { parseDrawio, styleValue } from './drawio.ts';
import { buildModel, type PageLabel } from './checks/model.ts';
import { loadProfile } from './profile.ts';
import { RULES_SHEET_FILE } from './rules-page.ts';

const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

/** A one-sheet package folder: the rules page alone, so check reads exactly what rules wrote. */
function packageWith(poc: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-columns-'));
  writeFileSync(join(dir, 'poc.yaml'), poc);
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      service: 'Служба ИБ',
      titlePrefix: '',
      sheets: [{ file: RULES_SHEET_FILE, level: '', topic: 'Карта сетевой фильтрации' }],
    }),
  );
  return dir;
}

const rulesOf = (dir: string): { code: number; lines: string[] } => runCli(['rules', join(dir, 'poc.yaml')]);

const targetOf = (dir: string): string => join(dir, RULES_SHEET_FILE);

const sheetPages = (dir: string) => parseDrawio(readFileSync(targetOf(dir), 'utf8')).pages;

/** Raw cell values without the wrap marks: draw.io and the reader's checks both drop <wbr>. */
const cellValues = (dir: string): string[] =>
  sheetPages(dir)
    .map((page) => page.cells.map((cell) => cell.value.replaceAll('<wbr>', '')))
    .flat();

/** Modelled cells of one page: text, box and style as the checker sees them. */
const modelCells = (dir: string, pageIndex: number): PageLabel[] => {
  const page = sheetPages(dir)[pageIndex];
  if (page === undefined) throw new Error('the sheet has no page ' + pageIndex);
  return buildModel(RULES_SHEET_FILE, page, loadProfile(), []).allCells;
};

const HEAD_FILL = '#F2F2F2';
const isHead = (cell: PageLabel): boolean => styleValue(cell.style, 'fillColor') === HEAD_FILL;

const rowBlock = (index: number): string =>
  [
    '      - src: "Узел ' + index + '"',
    '        dst: "Приемник ' + index + '"',
    '        port: "' + (15000 + index) + '"',
    '        proto: "TCP"',
    '        purpose: "Соединение ' + index + ' по заявке"',
  ].join('\n');

const pocWithRows = (count: number): string =>
  ['sheet: "Карта сетевой фильтрации"', 'tables:', '  - from: "Рабочий контур"', '    to: "Мониторинг"', '    rows:']
    .concat(
      Array.from({ length: count }, (_, i) => rowBlock(i + 1)),
      ['whitelist: []', 'notes: []'],
    )
    .join('\n');

/** One table with two rows; the environment fields come from the caller. */
const twoRowPoc = (rowExtra: string[] = [], tableExtra: string[] = []): string =>
  [
    'sheet: "Карта сетевой фильтрации"',
    'tables:',
    '  - from: "Рабочий контур"',
    ...tableExtra,
    '    to: "Внешние репозитории"',
    '    rows:',
    '      - src: "Сборщик"',
    '        dst: "Реестр вендора"',
    '        port: "443"',
    '        proto: "TCP"',
    '        purpose: "Забор образов по белому списку"',
    '      - src: "Сборщик"',
    ...rowExtra,
    '        dst: "Зеркало"',
    '        port: "80"',
    '        proto: "TCP"',
    '        purpose: "Зеркало пакетов"',
    'whitelist: []',
    'notes: []',
  ].join('\n');

const HEADERS = ['Связь L3', 'Политика', 'Служба', 'Получатель', 'Источник', 'Обоснование'];

test('rendered rules use one header row and preserve action and link', (t) => {
  const dir = packageWith(twoRowPoc(['        action: "deny"', '        link: "L3-2:4"']));
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0);

  const headers = modelCells(dir, 0).filter(isHead);
  assert.deepEqual(headers.map(cell => cell.text), HEADERS);
  assert.equal(new Set(headers.map(cell => cell.box?.y1)).size, 1);
  for (const value of ['Разрешить', 'Запретить', '443/TCP', 'Без ссылки', 'L3-2:4'])
    assert.ok(cellValues(dir).includes(value), value);
});

test('fields outside the public YAML schema are rejected before rendering', (t) => {
  const dir = packageWith(twoRowPoc(
    ['        extra_a: "value"'],
    ['    extra_b: "value"'],
  ));
  t.after(() => rmDir(dir));
  const result = rulesOf(dir);
  const lines = result.lines.join('\n');
  assert.equal(result.code, 65, lines);
  for (const field of ['extra_a', 'extra_b'])
    assert.ok(lines.includes('.' + field), field);
  assert.ok(!existsSync(targetOf(dir)));
});

test('a list of ports becomes one protocol column and a range stays one token', (t) => {
  const poc = [
    'sheet: "Карта сетевой фильтрации"',
    'tables:',
    '  - from: "Рабочий контур"',
    '    to: "Мониторинг"',
    '    rows:',
    '      - src: "Монитор"',
    '        dst: "Приемник метрик"',
    '        port: "80, 443"',
    '        proto: "TCP"',
    '        purpose: "Метрики состояния по HTTP"',
    '      - src: "Монитор"',
    '        dst: "Приемник потоков"',
    '        port: "8000-8010"',
    '        proto: "udp"',
    '        purpose: "Поток метрик"',
    'whitelist: []',
    'notes: []',
  ].join('\n');
  const dir = packageWith(poc);
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0);

  const values = cellValues(dir);
  assert.ok(values.includes('80/TCP, 443/TCP'), 'two ports with one protocol read 80/TCP, 443/TCP');
  assert.ok(values.includes('8000-8010/UDP'), 'the range stays one token and the protocol turns uppercase');
  const check = runCheck(dir, true);
  assert.equal(check.code, 2, check.lines.join('\n'));
  assert.deepEqual(JSON.parse(check.lines[0]!).notChecked.map((item: { code: string }) => item.code),
    ['SD-R01', 'SD-G01']);
});

test('an unknown key on the second row is SD-E02 with the field path', (t) => {
  const dir = packageWith(twoRowPoc(['        extra_label: "live"']));
  t.after(() => rmDir(dir));

  const rules = rulesOf(dir);
  assert.equal(rules.code, 65);
  const joined = rules.lines.join('\n');
  assert.ok(joined.includes('SD-E02'), joined);
  assert.ok(joined.includes('tables.0.rows.1.extra_label'), joined);
  assert.ok(!joined.includes('live'), 'the rejected value must not reach the output');
  assert.equal(existsSync(targetOf(dir)), false);
});

test('the single header repeats on each continuation page', (t) => {
  const dir = packageWith(pocWithRows(60));
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0);

  const pages = sheetPages(dir);
  assert.ok(pages.length > 1);
  pages.forEach((_, index) => {
    const headers = modelCells(dir, index).filter(isHead);
    assert.deepEqual(headers.map(cell => cell.text), HEADERS);
    assert.equal(new Set(headers.map(cell => cell.box?.y1)).size, 1);
  });
  assert.equal(cellValues(dir).filter(value => /^15\d{3}\/TCP$/u.test(value)).length, 60);
});
