/**
 * Hints in a copy for sending: the code and the cell id say what is
 * wrong, and the only hand named is the person's - no text set, no fix --safe over a copy whose
 * values a colleague has already written. On a retired sheet a resend never runs fix over the
 * whole folder either: references/resend.md explains the line-by-line route.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCheck } from './check.ts';
import { fillCell, sendingCopyOfPackage, show, stublessPackage, workingPackage } from './sending-fixtures.ts';

test('a copy run names the person, never text set or fix, on every code it prints', (t) => {
  const dir = stublessPackage(t, 'sd-hint-copy-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-hint-copy-to-');
  fillCell(join(copy, 'l1.drawio'), 'collector', 'Сборщик 192.0.2.10/33 Ёмкость «буфер»');
  const result = runCheck(copy, false);
  const out = show(result.lines);
  assert.equal(result.code, 1, out);
  assert.ok(out.includes('SD-T01') && out.includes('pool') === false, 'the line names the code: ' + out);
  for (const line of result.lines) {
    if (!line.startsWith('FAIL ')) continue;
    assert.ok(!line.includes('text set'), 'no text set in a copy: ' + line);
    assert.ok(!line.includes('fix --safe'), 'no fix over a copy: ' + line);
    assert.ok(!line.includes(' open '), 'no open command in a copy line: ' + line);
  }
  assert.ok(
    result.lines.filter((line) => line.startsWith('FAIL ')).every((line) => line.includes('человек')),
    'every finding says who fixes it: ' + out,
  );
  assert.ok(out.includes('адрес заполнен не до конца'), 'the address keeps its own reason: ' + out);
});

test('a working copy still gets the tool hints', (t) => {
  const dir = workingPackage(t, 'sd-hint-work-');
  fillCell(join(dir, 'l2.drawio'), 'sensor', 'Ёмкость «буфер»');
  const result = runCheck(dir, false);
  const out = show(result.lines);
  assert.ok(
    result.lines.some((line) => line.startsWith('FAIL SD-T01') && line.includes('fix --safe')),
    out,
  );
});

test('a T01 on a retired sheet sends the run to resend.md, not to fix over the folder', (t) => {
  const dir = workingPackage(t, 'sd-hint-retired-');
  const path = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    sheets: Array<{ file: string; retired?: Record<string, number[]> }>;
  };
  const l1 = manifest.sheets.find((sheet) => sheet.file === 'l1.drawio');
  assert.ok(l1 !== undefined);
  l1.retired = { L1: [3] };
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  fillCell(join(dir, 'l1.drawio'), 'collector', 'Сборщик ёмкость «буфер»');
  const result = runCheck(dir, false);
  const out = show(result.lines);
  assert.equal(result.code, 1, out);
  assert.ok(out.includes('resend.md'), 'the resend route is named: ' + out);
  assert.ok(!out.includes('Дальше: ' + 'node') || !out.includes('fix'), 'fix over the folder is not offered: ' + out);
  assert.ok(result.lines.at(-1)?.startsWith('Человеку:'), "the tail is the person's step: " + out);
});
