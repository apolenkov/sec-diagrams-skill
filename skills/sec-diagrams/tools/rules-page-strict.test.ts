/**
 * The strict poc.yaml contract of `rules`: unknown keys die with their path,
 * empty fields read as missing, the precheck sees the cell text the sheet will carry, ports are
 * tokens, long words wrap, and html cells escape twice. Data is synthetic; PRIVATE_MARKER must
 * never appear in command output.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCheck } from './check.ts';
import { runCli } from './cli.ts';
import { parseDrawio } from './drawio.ts';
import { RULES_SHEET_FILE } from './rules-page.ts';

const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

function packageWith(poc: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-rules-strict-'));
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
/** Raw cell values without the wrap marks: draw.io and the reader's checks both drop <wbr>. */
const cellValues = (dir: string): string[] =>
  parseDrawio(readFileSync(targetOf(dir), 'utf8'))
    .pages.map((page) => page.cells.map((cell) => cell.value.replaceAll('<wbr>', '')))
    .flat();

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

const withRow = (extra: string): string => SIMPLE_POC.replace('proto: "TCP"', 'proto: "TCP"\n        ' + extra);

test('an unknown key in poc.yaml is SD-E02 with its path and never its value', (t) => {
  const cases: Array<[string, string]> = [
    [withRow('prto: "PRIVATE_MARKER"'), 'tables.0.rows.0.prto'],
    [SIMPLE_POC.replace('notes: []', 'notes: []\nfooter: "PRIVATE_MARKER"'), 'footer'],
    [
      [
        'sheet: "x"',
        'whitelist:',
        '  - purpose: "Забор образов"',
        '    name: "a.example.org"',
        '    requester: "ADMIN"',
        '    resons: "PRIVATE_MARKER"',
        'notes: []',
      ].join('\n'),
      'whitelist.0.resons',
    ],
  ];
  for (const [poc, path] of cases) {
    const dir = packageWith(poc);
    t.after(() => rmDir(dir));
    const rules = rulesOf(dir);
    assert.equal(rules.code, 65, path + ': ' + rules.lines.join(' | '));
    assert.ok((rules.lines[0] ?? '').startsWith('SD-E02'), rules.lines[0] ?? '');
    assert.ok(rules.lines.join('\n').includes(path), path + ' missing in: ' + rules.lines.join(' | '));
    assert.ok(!rules.lines.join('\n').includes('PRIVATE_MARKER'), 'the value stays out of the report');
    assert.equal(existsSync(targetOf(dir)), false, 'nothing is written over a schema problem');
  }
});

test('an unknown key is named only when it reads as a field name', (t) => {
  // The report names the typo (tables.0.rows.0.prto), and a key is still text a
  // person typed: a slip like «dst_addr 198.51.100.77: TCP» hides a real address in the key
  // itself, and the error line would print it. Only a lowercase field-name shape is printed;
  // anything else becomes «?», the row path still points where to look.
  const cases: Array<[string, string]> = [
    ['"dst_addr 198.51.100.77"', '198.51.100.77'],
    ['registry-sekret.corp.test', 'registry-sekret.corp.test'],
  ];
  for (const [key, secret] of cases) {
    const dir = packageWith(withRow(key + ': "PRIVATE_MARKER"'));
    t.after(() => rmDir(dir));
    const rules = rulesOf(dir);
    assert.equal(rules.code, 65, key + ': ' + rules.lines.join(' | '));
    const out = rules.lines.join('\n');
    assert.ok((rules.lines[0] ?? '').startsWith('SD-E02'), out);
    assert.ok(!out.includes(secret), 'the key stays out of the report: ' + out);
    assert.ok(out.includes('tables.0.rows.0'), 'the place is still named: ' + out);
  }
});

test('yaml noise is reported by place only: a broken tag never quotes its value', (t) => {
  const noise: string[] = [];
  const realWarn = console.warn;
  const realError = console.error;
  console.warn = (...args: unknown[]): void => {
    noise.push(...args.map(String));
  };
  console.error = (...args: unknown[]): void => {
    noise.push(...args.map(String));
  };
  try {
    const dir = packageWith(withRow('purpose: "Забор PRIVATE_MARKER"'));
    t.after(() => rmDir(dir));
    const rules = rulesOf(dir);
    assert.equal(rules.code, 65, rules.lines.join(' | '));
    assert.ok(rules.lines.join('\n').includes('нечитаемый YAML'), rules.lines.join(' | '));
    assert.ok(!rules.lines.join('\n').includes('PRIVATE_MARKER'), 'the parser message is never echoed');
    assert.ok(!noise.join('\n').includes('PRIVATE_MARKER'), 'nothing leaks through the console: ' + noise.join(' '));
  } finally {
    console.warn = realWarn;
    console.error = realError;
  }
});

test('an empty field is the same as a missing one: a declared open null address gets a placeholder', (t) => {
  const dir = packageWith(withRow('src_addr:\n        open: [src_addr]'));
  t.after(() => rmDir(dir));
  const rules = rulesOf(dir);
  assert.equal(rules.code, 0, rules.lines.join(' | '));
  const values = cellValues(dir);
  assert.ok(values.some(value => value.includes('XX.XX.XX.XX')), 'the empty address reads as the hole the reviewer fills');
});

test('src, dst, port and proto alone are a complete row, and the sheet passes check', (t) => {
  const poc = SIMPLE_POC.replace('\n        purpose: "Забор образов по белому списку"', '');
  const dir = packageWith(poc);
  t.after(() => rmDir(dir));
  const rules = rulesOf(dir);
  assert.equal(rules.code, 0, rules.lines.join(' | '));
  assert.ok(
    cellValues(dir).includes('[поле]'),
    'the empty purpose starts with the hole',
  );
  const check = runCheck(dir, false);
  assert.ok(check.lines.some(line => line.includes('NOT_CHECKED SD-R01')));
  assert.equal(check.code, 2, check.lines.join('\n'));
});

test('the precheck reads the cells the sheet carries, not the raw keys', (t) => {
  const cases: Array<[string, string]> = [
    [SIMPLE_POC.replace('dst: "Реестр вендора"', 'dst: "Куда идет трафик?"'), 'таблица 1 строка 1'],
    [withRow('src_fqdn: "Нужен ли прокси?"'), 'таблица 1 строка 1'],
    [
      [
        'sheet: "x"',
        'tables: []',
        'whitelist:',
        '  - purpose: "Забор образов"',
        '    name: "Зачем нужен этот домен?"',
        '    requester: "ADMIN"',
        'notes: []',
      ].join('\n'),
      'белый список строка 1',
    ],
    [
      [
        'sheet: "x"',
        'tables:',
        '  - from: "Рабочий контур"',
        '    to: "Внешние репозитории"',
        '    rows:',
        '      - src: "Сборщик"',
        '        dst: "Реестр вендора"',
        '        port: "443"',
        '        proto: "TCP"',
        'whitelist: []',
        'notes:',
        '  - "Куда идет трафик?"',
      ].join('\n'),
      'заметка 1',
    ],
  ];
  for (const [poc, place] of cases) {
    const dir = packageWith(poc);
    t.after(() => rmDir(dir));
    const rules = rulesOf(dir);
    assert.equal(rules.code, 1, place + ': ' + rules.lines.join(' | '));
    assert.ok(
      rules.lines.some((line) => line.includes('SD-T07') && line.includes(place)),
      rules.lines.join(' | '),
    );
    assert.equal(existsSync(targetOf(dir)), false, 'the question never reaches the sheet');
  }
});

test('ports close spaced ranges, split on semicolons and never double a protocol', (t) => {
  const dir = packageWith(
    SIMPLE_POC.replace('port: "443"', 'port: "8000 - 8100; 443/TCP; 22"').replace('proto: "TCP"', 'proto: "tcp"'),
  );
  t.after(() => rmDir(dir));
  const rules = rulesOf(dir);
  assert.equal(rules.code, 0, rules.lines.join(' | '));
  assert.ok(cellValues(dir).includes('8000-8100/TCP, 443/TCP, 22/TCP'), cellValues(dir).join(' | '));
});

test('a port nobody can parse is SD-E02 with the field path', (t) => {
  const dir = packageWith(SIMPLE_POC.replace('port: "443"', 'port: "https"'));
  t.after(() => rmDir(dir));
  const rules = rulesOf(dir);
  assert.equal(rules.code, 65, rules.lines.join(' | '));
  assert.ok((rules.lines[0] ?? '').startsWith('SD-E02'), rules.lines[0] ?? '');
  assert.ok(rules.lines.join('\n').includes('tables.0.rows.0.port'), rules.lines.join(' | '));
});

test('a word longer than its column wraps and the row grows for it', (t) => {
  const long = 'abcdefghijklmnopqrstuvwxyz.abcdefghijklmnopqrstuvwxyz.very-long.example.org';
  const dir = packageWith(withRow('src_fqdn: "' + long + '"'));
  t.after(() => rmDir(dir));
  const rules = rulesOf(dir);
  assert.equal(rules.code, 0, rules.lines.join(' | '));
  const xml = readFileSync(targetOf(dir), 'utf8');
  const lines = xml.split('\n');
  const tag = lines.find((line) => line.includes('abcdefghijklmnopqrstuvwxyz')) ?? '';
  const height = Number(/height="(\d+)"/u.exec(tag)?.[1] ?? '0');
  assert.ok(height >= 42, 'the row grew past one line, got ' + String(height));
});

test('an html cell escapes its value as html and then as xml', (t) => {
  const dir = packageWith(
    SIMPLE_POC.replace('purpose: "Забор образов по белому списку"', 'purpose: "агрегатор <core> & резерв"'),
  );
  t.after(() => rmDir(dir));
  const rules = rulesOf(dir);
  assert.equal(rules.code, 0, rules.lines.join(' | '));
  const xml = readFileSync(targetOf(dir), 'utf8');
  assert.ok(xml.includes('&amp;lt;core&amp;gt;'), 'double escaping: the html tag survives as text, not markup');
});
