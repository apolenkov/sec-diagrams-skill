import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from './cli.ts';
import { l1 } from './checks.test/support.ts';
import { COPY_MARKER } from './values-guard.ts';

test('an archived submission requires evidence for holes, retired numbers and ambiguous questions', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-submitted-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const xml = l1().replace('id="n2" value="2"', 'id="n2" value="4"')
    .replace('value="Сборщик"', 'value="Сервер площадки?&lt;br&gt;XX.XX.XX.XX"')
    .replace('value="Хранение измерений"', 'value="Какой адрес нужен?"');
  writeFileSync(join(dir, 'legacy.drawio'), xml);
  const check = () => JSON.parse(runCli(['check', dir, '--submitted', '--json']).lines[0] as string);
  const archived = check();
  for (const reason of ['n01-retirement-unknown', 't07-assumption-or-question', 't08-letter-needed'])
    assert.ok(archived.notChecked.some((entry: {reason: string, ids: string[]}) => entry.reason === reason && entry.ids.length));
  assert.ok(archived.findings.some((f: {code: string}) => f.code === 'SD-T07'));
  writeFileSync(join(dir, 'legacy.drawio'), xml.replace('XX.XX.XX.XX', 'node.example.invalid'));
  assert.ok(check().findings.some((f: {code: string}) => f.code === 'SD-T08'));
  writeFileSync(join(dir, 'legacy.drawio'), xml);
  writeFileSync(join(dir, COPY_MARKER), '');
  assert.ok(check().findings.some((f: {code: string}) => f.code === 'SD-T08'));
});
