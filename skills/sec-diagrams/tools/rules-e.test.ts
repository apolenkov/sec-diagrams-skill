/**
 * Rules sheet edge cases: a port token that names both
 * protocols reads as two ports and one that names a stranger is SD-E02; an open mark belongs to
 * the field that declared it - a hole spelled out in the purpose is not laundered by an open
 * authentication - and an open note or field is judged by the text rules exactly as the copy's
 * check judges it later. Data is synthetic, addresses come from RFC 5737.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { runCheck } from './check.ts';
import { runCli } from './cli.ts';
import { parseDrawio, styleValue } from './drawio.ts';
import { buildModel, type PageLabel } from './checks/model.ts';
import { loadProfile, ProfileError } from './profile.ts';
import { RULES_SHEET_FILE } from './rules-page.ts';
import { portsCell } from './rules-page-columns.ts';
import { rmDir, tempDir } from './sending-fixtures.ts';

function packageWith(poc: string, final = false): string {
  const dir = tempDir('sd-rules-e-');
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

const POC = (rowExtra: string, notes = 'notes: []'): string =>
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
    '        ' + rowExtra,
    'whitelist: []',
    notes,
  ].join('\n');

test('53/TCP/UDP reads as two ports and a stranger protocol is SD-E02', () => {
  assert.equal(portsCell('53/TCP/UDP', 'TCP', 't'), '53/TCP, 53/UDP');
  assert.equal(portsCell('53/UDP/TCP', 'TCP/UDP', 't'), '53/TCP, 53/UDP');
  assert.equal(portsCell('53/TCP/UDP, 443', 'TCP', 't'), '53/TCP, 53/UDP, 443/TCP');
  for (const bad of ['53/TCP/XXX', '53/TCP/TCP', '53/TCP/UDP/ICMP']) {
    assert.throws(
      () => portsCell(bad, 'TCP', 'tables.0.rows.0'),
      (error: unknown) => error instanceof ProfileError && error.code === 'SD-E02' && !error.message.includes('XXX'),
      bad,
    );
  }
});

test('a purpose spelled as a hole is not laundered by an open endpoint', (t) => {
  const dir = packageWith(POC('purpose: "[поле]"\n        open: [src_addr]').replace('src_addr: "192.0.2.6"', 'src_addr:'), true);
  t.after(() => rmDir(dir));
  assert.equal(rulesOf(dir).code, 0, shown(rulesOf(dir)));
  const open = pageCells(dir).filter((cell) => styleValue(cell.style, 'sdRole') === 'open');
  assert.equal(open.length, 1, 'the open mark applies only to the endpoint');
  const check = runCheck(dir, false);
  assert.ok(
    check.lines.some((line) => line.startsWith('FAIL SD-T08') && line.includes(RULES_SHEET_FILE)),
    shown(check),
  );
});

test('an open note with a date stops `rules` as the copy check would stop it', (t) => {
  const notes = 'notes:\n  - text: "Срок согласован до 04.09.2032"\n    open: true';
  const dir = packageWith(POC('purpose: "Соединение по заявке"', notes), true);
  t.after(() => rmDir(dir));
  const built = rulesOf(dir);
  assert.notEqual(built.code, 0, shown(built));
  assert.ok(shown(built).includes('SD-T03'), shown(built));
});

test('an open field is read by the text rules in its own place', (t) => {
  const row = 'purpose: "Соединение по заявке"\n        open: [src_addr]';
  const dir = packageWith(POC(row).replace('src_addr: "192.0.2.6"', 'src_addr: "до 04.09.2032"'), true);
  t.after(() => rmDir(dir));
  const built = rulesOf(dir);
  assert.notEqual(built.code, 0, shown(built));
  assert.ok(shown(built).includes('SD-T03'), shown(built));
});
