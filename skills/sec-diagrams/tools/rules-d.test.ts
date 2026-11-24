/**
 * Rules sheet layout and validation: a long name without
 * spaces wraps on dots and dashes and is still read whole; the protocol set is TCP, UDP, TCP/UDP
 * and ICMP, ports live in 1-65535 and ranges run upward; SD-E02 names the kind of a schema slip
 * without the value; an empty notes or whitelist section is an empty list; the open mark belongs
 * to the field that declared it, and a hole on the rules sheet is closed in poc.yaml, not with
 * open <file> <id>. Data is synthetic, addresses come from RFC 5737.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { runCheck } from './check.ts';
import { runCli } from './cli.ts';
import { parseDrawio, styleValue } from './drawio.ts';
import { buildModel, type PageLabel } from './checks/model.ts';
import { loadProfile } from './profile.ts';
import { RULES_SHEET_FILE } from './rules-page.ts';
import { portsCell } from './rules-page-columns.ts';
import { rmDir, sendingCopyOfPackage, tempDir } from './sending-fixtures.ts';

function packageWith(poc: string, final = false): string {
  const dir = tempDir('sd-rules-d-');
  writeFileSync(join(dir, 'poc.yaml'), poc);
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      service: 'Служба ИБ',
      titlePrefix: '',
      ...(final ? { final: true } : {}),
      sheets: [{ file: RULES_SHEET_FILE, level: '', topic: 'Карта сетевой фильтрации' }],
    }),
  );
  return dir;
}

const rulesOf = (dir: string): { code: number; lines: string[] } => runCli(['rules', join(dir, 'poc.yaml')]);
const shown = (result: { lines: string[] }): string => result.lines.join(' | ');
const pageCells = (dir: string): PageLabel[] =>
  parseDrawio(readFileSync(join(dir, RULES_SHEET_FILE), 'utf8')).pages.flatMap((page) => [
    ...buildModel(RULES_SHEET_FILE, page, loadProfile(), []).allCells,
  ]);

const POC = (extra: string): string =>
  [
    'sheet: "Карта сетевой фильтрации"',
    'tables:',
    '  - from: "Контур А"',
    '    to: "Контур Б"',
    '    rows:',
    '      - src: "Узел"',
    '        dst: "Приемник"',
    '        port: "443"',
    '        proto: "TCP"',
    '        purpose: "Соединение по заявке"',
    '        ' + extra,
    'whitelist: []',
    'notes: []',
  ].join('\n');

/** A final-copy row with every hole closed or declared, plus the caller's extra fields. */
const FINAL_POC = (extra: string): string =>
  [
    'sheet: "Карта сетевой фильтрации"',
    'tables:',
    '  - from: "Контур А"',
    '    to: "Контур Б"',
    '    rows:',
    '      - src: "Узел"',
    '        dst: "Приемник"',
    '        src_fqdn: "sensor-a.telemetry.test"',
    '        src_addr: "192.0.2.6"',
    '        dst_fqdn: "receiver-b.telemetry.test"',
    '        dst_addr: "192.0.2.7"',
    '        port: "443"',
    '        proto: "TCP"',
    '        ' + extra,
    'whitelist: []',
    'notes: []',
  ].join('\n');

test('a long name wraps on dots and dashes and the checker reads it whole', (t) => {
  const dir = packageWith(POC('src_fqdn: "collector-node-01.telemetry.example.org"'));
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0, shown(rulesOf(dir)));
  const cells = pageCells(dir);
  const fqdn = cells.find((cell) => cell.text.includes('collector-node-01.telemetry.example.org'));
  assert.ok(
    fqdn !== undefined,
    'the label holds the name without the wrap marks: ' + cells.map((c) => c.text).join('|'),
  );
  const raw = parseDrawio(readFileSync(join(dir, RULES_SHEET_FILE), 'utf8')).pages[0]?.cells ?? [];
  const stored = raw.find((cell) => cell.value.includes('collector-') && cell.value.includes('example'));
  assert.ok(stored !== undefined && stored.value.includes('<wbr>'), 'the cell carries wrap marks');
  assert.equal(stored.value.split('<wbr>').length, 6, 'a mark after each of the two dashes and three dots');
  assert.ok(fqdn.text.includes('Узел\n'), 'name accompanies the endpoint label');
});

test('a wrapped address in the copy still reads as one whole address', (t) => {
  const dir = packageWith(FINAL_POC('purpose: "Проверка доступности"'), true);
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0, shown(rulesOf(dir)));
  const xml = readFileSync(join(dir, RULES_SHEET_FILE), 'utf8');
  assert.ok(xml.includes('&lt;wbr&gt;'), 'the stored sheet really wraps');
  const check = runCheck(dir, false);
  assert.ok(
    !check.lines.some((line) => line.includes('SD-T04')),
    'no broken address out of a wrapped one: ' + shown(check),
  );
});

test('portsCell speaks the protocol set and the port bounds', () => {
  assert.equal(portsCell('53', 'TCP/UDP', 'x'), '53/TCP, 53/UDP');
  assert.equal(portsCell('80,443', 'tcp/udp', 'x'), '80/TCP, 80/UDP, 443/TCP, 443/UDP');
  assert.equal(portsCell('53, 443/udp', 'TCP/UDP', 'x'), '53/TCP, 53/UDP, 443/UDP');
  assert.equal(portsCell('8000 - 8100', 'udp', 'x'), '8000-8100/UDP');
  assert.equal(portsCell('', 'ICMP', 'x'), 'ICMP');
  assert.equal(portsCell('22', 'tcp', 'x'), '22/TCP');
  assert.throws(() => portsCell('443', 'ICMP', 'x'), /у ICMP порта нет/u);
  assert.throws(() => portsCell('70000', 'TCP', 'x'), /порт вне 1-65535/u);
  assert.throws(() => portsCell('0', 'TCP', 'x'), /порт вне 1-65535/u);
  assert.throws(() => portsCell('8100-8000', 'TCP', 'x'), /не по возрастанию/u);
  assert.throws(() => portsCell('443', 'GRE', 'x'), /не из набора/u);
  assert.throws(() => portsCell('https', 'TCP', 'x'), /не порт и не диапазон/u);
});

test('the sheet carries ICMP and both protocols on one port', (t) => {
  const dir = packageWith(
    [
      'sheet: "Карта сетевой фильтрации"',
      'tables:',
      '  - from: "Контур А"',
      '    to: "Контур Б"',
      '    rows:',
      '      - src: "Узел"',
      '        dst: "Приемник"',
      '        proto: "icmp"',
      '        purpose: "Диагностика сети"',
      '      - src: "Резолвер"',
      '        dst: "ДНС"',
      '        port: "53"',
      '        proto: "TCP/UDP"',
      '        purpose: "Разрешение имен"',
      'whitelist: []',
      'notes: []',
    ].join('\n'),
  );
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0, shown(rulesOf(dir)));
  const texts = pageCells(dir).map((cell) => cell.text);
  assert.ok(texts.includes('ICMP'), texts.join('|'));
  assert.ok(texts.includes('53/TCP, 53/UDP'), texts.join('|'));
});

test('SD-E02 names the kind of a schema slip, never the value', (t) => {
  const cases: Array<[string, RegExp, string]> = [
    [POC('src_fqdn: "a"').replace('port: "443"', 'port: 8080'), /ожидалась строка, получено число/u, '8080'],
    [POC('src_fqdn: "a"').replace('proto: "TCP"', 'proto: "TCP"\n        prto: GRE'), /неизвестный ключ/u, 'GRE'],
    [POC('src_fqdn: "a"').replace('port: "443"', 'port: "70000"'), /порт вне 1-65535/u, '70000'],
    [POC('src_fqdn: "a"').replace('proto: "TCP"', 'proto: "GRE"'), /не из набора/u, 'GRE'],
  ];
  for (const [poc, kind, value] of cases) {
    const dir = packageWith(poc);
    t.after(() => rmDir(dir));
    const rules = rulesOf(dir);
    assert.equal(rules.code, 65, shown(rules));
    const out = shown(rules);
    assert.match(out, kind, out);
    assert.ok(!out.includes(value), 'the refused value stays out of the report: ' + out);
  }
});

test('an empty notes and whitelist section is an empty list', (t) => {
  const dir = packageWith(
    POC('src_fqdn: "a.example.org"').replace('whitelist: []', 'whitelist:').replace('notes: []', 'notes:'),
  );
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0, shown(rulesOf(dir)));
});

test('a whitelist row and a note can keep their hole open', (t) => {
  const dir = packageWith(
    [
      'sheet: "Карта сетевой фильтрации"',
      'tables: []',
      'whitelist:',
      '  - purpose: "Образы контейнеров"',
      '    requester: "Сервер сборки"',
      '    open: [name]',
      'notes:',
      '  - text: "Адреса уточним позже"',
      '    open: true',
    ].join('\n'),
  );
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0, shown(rulesOf(dir)));
  const cells = pageCells(dir);
  const open = cells.filter((cell) => styleValue(cell.style, 'sdRole') === 'open').map((cell) => cell.text);
  assert.ok(open.includes('[поле]'), 'the declared hole is marked: ' + open.join('|'));
  assert.ok(open.includes('Адреса уточним позже'), open.join('|'));
  assert.ok(!open.includes('Сервер сборки'), 'the filled cell keeps no mark: ' + open.join('|'));
});

test('an open endpoint field cannot hide a second undeclared placeholder', (t) => {
  const poc = FINAL_POC('purpose: "Проверка связи"\n        open: [src_addr]')
    .replace('src_fqdn: "sensor-a.telemetry.test"', 'src_fqdn: "unit.example.org"')
    .replace('src_addr: "192.0.2.6"', 'src_addr:');
  const dir = packageWith(poc, true);
  t.after(() => rmDir(dir));
  const built = rulesOf(dir);
  assert.equal(built.code, 1, shown(built));
  assert.match(shown(built), /SD-T08.*таблица 1 строка 1/u);
  assert.doesNotMatch(shown(built), /unit\.example\.org/u);
});

test('a T08 on the rules sheet sends the person to poc.yaml, not to open <file> <id>', (t) => {
  const dir = packageWith(POC('src_fqdn: "a.example.org"'));
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0, shown(rulesOf(dir)));
  const copy = sendingCopyOfPackage(t, dir, 'sd-rules-d-copy-');
  const check = runCheck(copy, false);
  const t08 = check.lines.filter((line) => line.startsWith('FAIL SD-T08') && line.includes(RULES_SHEET_FILE));
  assert.ok(t08.length > 0, 'the copy really shows the holes: ' + shown(check));
  for (const line of t08) {
    assert.ok(line.includes('poc.yaml копии') && line.includes('rules --force'), line);
    assert.ok(!line.includes('open <файл>') && !line.includes('text set'), line);
  }
});
