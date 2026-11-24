/**
 * Shared helpers of the copy-for-sending tests: temp packages, the pen with which the test
 * (playing a person) fills a value straight into the XML, and the fixed texts the pack tests
 * look for. Nothing here checks behavior; every address is from RFC 5737.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from './cli.ts';
import { parseDrawio, setCellValue } from './drawio.ts';
import { loadProfile } from './profile.ts';
import { buildModel, type Finding } from './checks/model.ts';
import { checkFinal } from './checks/final.ts';
import { checkLines } from './checks/lines.ts';
import { checkNumbers } from './checks/numbers.ts';
import { checkSheet } from './checks/sheet.ts';
import { checkText, FOOTER_TEXT } from './checks/text.ts';
import { baseCells, LEGEND, TEXT_STYLE, vertex, wrap } from './sheet-fixtures.ts';
import { buildPdf } from './pdf-fixtures.ts';
import { templateFiles } from './templates.ts';

const profile = loadProfile();

/** The part of node:test context the package helpers need. */
export interface Testish {
  after: (fn: () => void) => void;
}

/** Strings a test would see in a leak: real-shape values the copy holds and a unique marker. */
export const VALUES = ['192.0.2.0', '192.0.2.10', '198.51.100.0', '198.51.100.10', '203.0.113.77', 'MARKER-7f3a'];
export const NL = String.fromCharCode(10);

export const show = (lines: string[]): string => lines.join(' | ');

export const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

export const manifestOf = (dir: string): string => readFileSync(join(dir, 'manifest.json'), 'utf8');

export function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** One temp package: init + rules, the working copy every route starts from. */
export function workingPackage(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = tempDir(prefix);
  t.after(() => rmDir(dir));
  assert.equal(runCli(['init', dir]).code, 0);
  assert.equal(runCli(['rules', join(dir, 'poc.yaml')]).code, 0);
  return dir;
}

/** final <pkg> <pkg>/copy: the sending copy of a working package, in a sibling temp folder. */
export function sendingCopyOfPackage(t: { after: (fn: () => void) => void }, dir: string, prefix: string): string {
  const parent = tempDir(prefix);
  t.after(() => rmDir(parent));
  const copy = join(parent, 'copy');
  assert.equal(runCli(['final', dir, copy]).code, 0);
  return copy;
}

/** The person's pen: the test edits a value straight in the XML, the way draw.io saves it. */
export function fillCell(path: string, id: string, value: string): void {
  const drawio = parseDrawio(readFileSync(path, 'utf8'));
  const pageIndex = drawio.pages.findIndex((page) => page.cells.some((cell) => cell.id === id));
  assert.ok(pageIndex >= 0, 'cell ' + id + ' is on the sheet');
  writeFileSync(path, setCellValue(drawio, pageIndex, id, value));
}

/** A case cell: the text a person leaves (or forgets to leave) in one box of the fixture sheet. */
interface Case {
  id: string;
  value: string;
  open?: boolean;
  legend?: boolean;
}

/** Legend children hang off the "lf" frame and must land inside it: coordinates are parent-relative. */
export const caseXY = (item: Case, index: number): [number, number] =>
  item.legend === true ? [30, 200 + index] : [100, 1100 + index * 45];

export const CASES: Case[] = [
  { id: 'host', value: 'Шлюз 192.0.2.10' },
  { id: 'net', value: 'Подсеть 198.51.100.0/24' },
  { id: 'rng', value: 'Пул 192.0.2.10-20' },
  { id: 'half', value: 'Подсеть 203.0.XX.10' },
  { id: 'over', value: 'Шлюз 192.0.2.300' },
  { id: 'wide', value: 'Подсеть 198.51.100.0/33' },
  { id: 'emptymask', value: 'Подсеть 192.0.2.0/' },
  { id: 'endlow', value: 'Пул 192.0.2.10-8' },
  { id: 'endbig', value: 'Пул 192.0.2.10-300' },
  { id: 'stub-net', value: 'XX.XX.XX.XX' },
  { id: 'stub-mask', value: 'XX.XX.XX.XX/24' },
  { id: 'stub-vlan', value: 'VLAN XX' },
  { id: 'stub-field', value: '[поле]' },
  { id: 'compound', value: 'аутентификация: [поле]' },
  { id: 'qmark', value: 'тип VPN: ?' },
  { id: 'qonly', value: '?' },
  { id: 'sample-host', value: 'уточним.example.org' },
  { id: 'choice', value: '[TLS: проверяется]' },
  { id: 'assume', value: 'Туннель IPsec?' },
  { id: 'footer', value: FOOTER_TEXT },
  { id: 'legend-stub', value: 'Подсеть XX.XX.XX.XX', legend: true },
  { id: 'legend-broken', value: 'Образец 192.0.2.300', legend: true },
  { id: 'open-stub', value: 'аутентификация: [поле]', open: true },
  { id: 'open-filled', value: 'аутентификация: сертификат датчика', open: true },
];

export const sheetXml = (): string =>
  wrap([
    ...baseCells(LEGEND),
    ...CASES.map((item, index) =>
      vertex(
        item.id,
        item.value,
        ...caseXY(item, index),
        280,
        30,
        TEXT_STYLE + (item.open === true ? 'sdRole=open;' : ''),
        item.legend === true ? 'lf' : '1',
      ),
    ),
  ]);

/** One fixture sheet, checked as a working copy or as a copy for sending. */
export function findingsOf(isFinal: boolean): Finding[] {
  const page = parseDrawio(sheetXml()).pages[0];
  if (page === undefined) throw new Error('the fixture has no page');
  const model = buildModel('sent.drawio', page, profile, [], isFinal);
  model.titlePrefix = '';
  return [
    ...checkNumbers(model),
    ...checkLines(model),
    ...checkText(model),
    ...checkFinal(model),
    ...checkSheet(model),
  ];
}

export const linesOf = (list: Finding[]): string[] => list.map((found) => found.code + ' ' + found.ids.join(','));
export const idsFor = (list: Finding[], code: string): string[] =>
  list.filter((found) => found.code === code).flatMap((found) => found.ids);

/** The free texts of poc.yaml carry a real address (valid) or a broken one; both are blind. */
export function pocWithPurpose(pocSource: string, purpose: string): string {
  return pocSource.replace('        purpose: "Передача показаний"', '        purpose: ' + JSON.stringify(purpose));
}
export const fakePdf = (outPath: string): void =>
  writeFileSync(outPath, buildPdf({ pages: [{ widthMm: 400, heightMm: 277, lines: [{ x: 50, y: 60, size: 8 }] }] }));

export const LETTER = [
  'Что проверено: Потоки показаний от датчиков до базы.',
  '',
  'Что изменилось: Обновлен лист приема телеметрии.',
  '',
  'Что приложено: Обзор, схема зон, два листа L3 и PDF.',
  '',
].join(NL);

/** The copy''s poc.yaml as a person writes it: one row filled, every left stub declared open. */
export const E2E_POC =
  [
    'sheet: "Карта сетевой фильтрации"',
    'tables:',
    '  - from: "Датчики"',
    '    to: "Прием телеметрии"',
    '    rows:',
    '      - src: "Датчик"',
    "        link: 'L3-1:1'",
    '        src_addr: "192.0.2.10"',
    '        dst: "Сборщик"',
    '        dst_addr: "198.51.100.0/24"',
    '        port: "443"',
    '        proto: "TCP"',
    '        purpose: "Передача показаний"',
    '        open: ["src_fqdn", "dst_fqdn"]',
    '      - src: "Шлюз датчиков"',
    '        dst: "Брокер сообщений"',
    '        port: "443"',
    '        proto: "TCP"',
    '        purpose: "Передача событий"',
    '        open: ["src_addr", "src_fqdn", "dst_addr", "dst_fqdn"]',
    'whitelist: []',
    'notes: []',
  ].join(NL) + NL;

/** A package of the four template sheets only: no rules page, so no stub is left on a sheet. */
export function stublessPackage(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = tempDir(prefix);
  t.after(() => rmDir(dir));
  for (const entry of templateFiles()) {
    const content =
      entry.name === 'manifest.json'
        ? JSON.stringify(
            {
              ...JSON.parse(entry.content),
              sheets: (JSON.parse(entry.content) as { sheets: Array<{ level: string }> }).sheets.filter(
                (sheet) => sheet.level !== '',
              ),
            },
            null,
            2,
          ) + NL
        : entry.content;
    writeFileSync(join(dir, entry.name), content);
  }
  return dir;
}
