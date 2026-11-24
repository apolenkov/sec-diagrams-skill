/**
 * Tests for the «Карта сетевой фильтрации» page: the template example builds a sheet that
 * `check` passes with nothing but the geometry note, every port and domain of the description
 * reaches a cell, a 60-row table overflows onto a second page with its header repeated and no
 * cell below the bottom margin, placeholders fill empty addresses, environments and FQDNs, a schema or a
 * text problem stops the command without writing anything, and the manifest prefix lands on the
 * title. Data is synthetic: example.org domains, github hosts, no addresses.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCheck } from './check.ts';
import { runCli } from './cli.ts';
import { parseDrawio, styleValue } from './drawio.ts';
import { buildModel } from './checks/model.ts';
import { loadProfile } from './profile.ts';
import { initFolder, TEMPLATE_DIR } from './templates.ts';
import { RULES_SHEET_FILE } from './rules-page.ts';

const PAGE_BOTTOM = 1169 - 20;

const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

const tempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

/** A one-sheet package folder: the rules page alone, so check reads exactly what rules wrote. */
function packageWith(poc: string, titlePrefix = ''): string {
  const dir = tempDir('sd-rules-');
  writeFileSync(join(dir, 'poc.yaml'), poc);
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      service: 'Служба ИБ',
      titlePrefix,
      sheets: [{ file: RULES_SHEET_FILE, level: '', topic: 'Карта сетевой фильтрации' }],
    }),
  );
  return dir;
}

const rulesOf = (dir: string, force = false): { code: number; lines: string[] } =>
  runCli(['rules', join(dir, 'poc.yaml'), ...(force ? ['--force'] : [])]);

const targetOf = (dir: string): string => join(dir, RULES_SHEET_FILE);

const sheetPages = (dir: string) => parseDrawio(readFileSync(targetOf(dir), 'utf8')).pages;

/** Raw cell values without the wrap marks: draw.io and the reader's checks both drop <wbr>. */
const cellValues = (dir: string): string[] =>
  sheetPages(dir)
    .map((page) => page.cells.map((cell) => cell.value.replaceAll('<wbr>', '')))
    .flat();

const templatePoc = readFileSync(join(TEMPLATE_DIR, 'poc.yaml'), 'utf8');

const SIMPLE_POC = [
  'sheet: "Карта сетевой фильтрации"',
  'tables:',
  '  - from: "Рабочий контур"',
  '    to: "Внешние репозитории"',
  '    rows:',
  '      - src: "Сборщик"',
  '        dst: "Реестр вендора"',
  '        port: "443"',
  '        proto: "TCP"',
  '        purpose: "Забор образов по белому списку"',
  'whitelist: []',
  'notes: []',
].join('\n');

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

const STUDY_MATERIALS_POC = `sheet: Карта сетевой фильтрации
tables:
  - from: Рабочие станции
    to: Каталог материалов
    rows:
      - {dst: Индекс, src: Просмотрщик, action: allow, port: '6080', proto: TCP, purpose: Чтение оглавления}
      - {dst: Архив, src: Просмотрщик, action: deny, port: '7443', proto: TCP, purpose: Доступ к архиву закрыт}
  - from: Пункт наблюдения
    to: Узлы измерения
    rows:
      - {dst: Датчик, src: Коллектор, action: allow, port: '9125', proto: UDP, purpose: Сбор показаний}
whitelist:
  - {purpose: Поиск материалов, name: index.study.test, requester: Просмотрщик}
  - {purpose: Резервное хранение, name: archive.example.net, requester: Архиватор}
  - {purpose: Сводка по датчикам, name: readings.example.org, requester: Коллектор}
notes:
  - Архив открывается через отдельный клиент.
`;

const STUDY_PORTS = ['6080/TCP', '7443/TCP', '9125/UDP'];
const STUDY_DOMAINS = ['index.study.test', 'archive.example.net', 'readings.example.org'];

test('the template example builds a sheet that check passes with only the geometry note', (t) => {
  const dir = tempDir('sd-rules-init-');
  t.after(() => rmDir(dir));
  assert.equal(initFolder(dir).code, 0);

  const rules = rulesOf(dir);
  assert.equal(rules.code, 0, rules.lines.join('\n'));
  assert.ok(rules.lines.includes('Таблиц: 4'), rules.lines.join('\n'));
  assert.ok(rules.lines.includes('Строк: 5'), rules.lines.join('\n'));
  assert.ok(rules.lines.includes('Страниц: 1'), rules.lines.join('\n'));
  assert.ok(
    rules.lines.at(-1)?.startsWith('Дальше: node ') && rules.lines.at(-1)?.includes("'check' '" + dir + "'"),
    rules.lines.at(-1) ?? '',
  );

  const plain = runCheck(dir, false);
  assert.equal(plain.code, 0, plain.lines.join('\n'));
  const json = runCheck(dir, true);
  assert.equal(json.code, 0, json.lines.join(''));
  const body = JSON.parse(json.lines.join('')) as { findings: unknown[]; notChecked: Array<{ code: string }> };
  assert.deepEqual(body.findings, []);
  assert.deepEqual(
    body.notChecked.map((entry) => entry.code),
    ['SD-G01'],
    'no legend-not-found on a rules sheet',
  );

  const values = cellValues(dir);
  assert.ok(values.includes('443/TCP'));
  assert.ok(values.includes('broker.example.org'));
  assert.ok(values.includes('L3-1:1'));
  for (const page of sheetPages(dir)) {
    for (const cell of page.cells.filter((one) => one.value !== '')) {
      assert.match(cell.id, /^rules-\d+$/u);
      const mark = styleValue(cell.style, 'sdRole');
      assert.ok(mark === 'rules' || mark === 'title', 'every rules-sheet cell is marked, found ' + cell.id);
    }
  }
});

test('tables for two directions and DNS preserve all services and names', (t) => {
  const dir = packageWith(STUDY_MATERIALS_POC);
  t.after(() => rmDir(dir));

  const rules = rulesOf(dir);
  assert.equal(rules.code, 0, rules.lines.join('\n'));
  assert.ok(rules.lines.includes('Таблиц: 3'), rules.lines.join('\n'));
  assert.ok(rules.lines.includes('Строк: 6'), rules.lines.join('\n'));

  const values = cellValues(dir);
  for (const port of STUDY_PORTS) assert.ok(values.includes(port), 'port ' + port + ' is missing');
  for (const domain of STUDY_DOMAINS) assert.ok(values.includes(domain), 'domain ' + domain + ' is missing');

  const check = runCheck(dir, false);
  assert.ok(check.lines.some(line => line.includes('NOT_CHECKED SD-R01')));
  assert.equal(check.code, 2, check.lines.join('\n'));
});

test('a 60-row table overflows to more pages, repeats the header and stays inside the page', (t) => {
  const dir = packageWith(pocWithRows(60));
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0);

  const pages = sheetPages(dir);
  assert.ok(pages.length >= 2, 'the table must continue on a second page');
  const second = pages[1] as (typeof pages)[number];
  assert.match(second.name, /лист 2 из \d+/u);
  assert.ok(
    second.cells.some((cell) => cell.value === 'Получатель' && styleValue(cell.style, 'fillColor') === '#F2F2F2'),
    'the header repeats on the continuation page',
  );

  const profile = loadProfile();
  for (const page of pages) {
    for (const cell of page.cells.filter((one) => one.value !== '')) {
      const size = styleValue(cell.style, 'fontSize');
      assert.ok(size !== undefined && Number(size) >= 12, cell.id + ' has no font of at least 12');
    }
    for (const cell of buildModel(RULES_SHEET_FILE, page, profile, []).allCells) {
      if (cell.box === null) continue;
      assert.ok(cell.box.y2 <= PAGE_BOTTOM, cell.id + ' stands below the bottom margin');
    }
  }
});

test('blank optional endpoint details stay out of the displayed text', (t) => {
  const poc = [
    'sheet: "Карта сетевой фильтрации"',
    'tables:',
    '  - from: "Рабочий контур"',
    '    to: "Внешние репозитории"',
    '    rows:',
    '      - src: "Сборщик"',
    '        dst: "Реестр вендора"',
    '        port: "443"',
    '        proto: "TCP"',
    '        purpose: "Забор образов"',
    '      - src: "Сборщик"',
    '        src_addr: ""',
    '        dst: "Зеркало"',
    '        dst_addr: "  "',
    '        port: "80"',
    '        proto: "TCP"',
    '        purpose: "Зеркало пакетов"',
    'whitelist: []',
    'notes: []',
  ].join('\n');
  const dir = packageWith(poc);
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0);

  const values = cellValues(dir);
  assert.ok(values.includes('Зеркало'));
  assert.ok(!values.some(value => /XX\.XX|\[поле\]/u.test(value)));
  const check = runCheck(dir, true);
  assert.equal(check.code, 2, check.lines.join('\n'));
  assert.deepEqual(JSON.parse(check.lines[0]!).notChecked.map((item: { code: string }) => item.code),
    ['SD-R01', 'SD-G01']);
});

test('a schema problem is SD-E02 with the field path and never the value', (t) => {
  const dir = packageWith(SIMPLE_POC.replace('port: "443"', 'port: 192'));
  t.after(() => rmDir(dir));

  const rules = rulesOf(dir);
  assert.equal(rules.code, 65);
  const joined = rules.lines.join('\n');
  assert.ok(joined.includes('SD-E02'), joined);
  assert.ok(joined.includes('tables.0.rows.0.port'), joined);
  assert.ok(!joined.includes('192'), 'the rejected value must not reach the output');
  assert.equal(existsSync(targetOf(dir)), false);
});

test('without --force an existing sheet keeps its bytes; with it the sheet is rebuilt', (t) => {
  const dir = packageWith(SIMPLE_POC);
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0);
  writeFileSync(targetOf(dir), 'sentinel');

  const again = rulesOf(dir);
  assert.equal(again.code, 64);
  assert.ok(again.lines.join('\n').includes('есть'), again.lines.join('\n'));
  assert.equal(readFileSync(targetOf(dir), 'utf8'), 'sentinel');

  assert.equal(rulesOf(dir, true).code, 0);
  assert.notEqual(readFileSync(targetOf(dir), 'utf8'), 'sentinel');
});

test('a purpose with a spaced dash or with ё stops the command before writing', (t) => {
  const cases: Array<[string, string]> = [
    ['Пакеты - по белому списку', 'Пакеты'],
    ['Сбор ёмкостей контейнеров', 'ёмкостей'],
  ];
  for (const [purpose, forbidden] of cases) {
    const dir = packageWith(
      SIMPLE_POC.replace('purpose: "Забор образов по белому списку"', 'purpose: "' + purpose + '"'),
    );
    t.after(() => rmDir(dir));

    const rules = rulesOf(dir);
    assert.equal(rules.code, 1, rules.lines.join('\n'));
    const joined = rules.lines.join('\n');
    assert.ok(joined.includes('SD-T01'), joined);
    assert.ok(joined.includes('таблица 1 строка 1'), joined);
    assert.ok(!joined.includes(forbidden), 'the value itself never reaches the output: ' + joined);
    assert.equal(existsSync(targetOf(dir)), false);
  }
});

test('a manifest titlePrefix opens the sheet title and SD-H01 stays quiet', (t) => {
  const dir = packageWith(templatePoc.replace(/^ *link:.*$/gmu, ''), 'Проверка сети. ');
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0);

  const title = sheetPages(dir)[0]?.cells.find((cell) => styleValue(cell.style, 'sdRole') === 'title');
  assert.ok(title !== undefined, 'the title cell exists');
  assert.ok(title.value.replaceAll('<wbr>', '').startsWith('Проверка сети. Карта сетевой фильтрации'), title.value);

  const check = runCheck(dir, false);
  assert.ok(!check.lines.some((line) => line.includes('SD-H01')), check.lines.join('\n'));
  assert.ok(check.lines.some(line => line.includes('NOT_CHECKED SD-R01')));
  assert.equal(check.code, 2, check.lines.join('\n'));
});
