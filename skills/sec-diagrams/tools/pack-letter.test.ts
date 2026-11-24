import { pdfTestOptions } from './pdf-fixtures.ts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';

import { checkLetter, letterSkeleton } from './letter.ts';
import { GOOD_LETTER, MERGED_PDF, readyPackage, rmDir, tempDir } from './pack-fixtures.ts';
import { packetDirOf, runPack } from './pack.ts';
import { pdfDir } from './pdf.ts';
import { CLI_PATH } from './cli-common.ts';
import { nodeCommand } from './shell.ts';

const pdfTest = await pdfTestOptions();

test('pack --with-letter leaves the skeleton when the note is missing and retries with the flag', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-noletter-');
  const result = runCli(['pack', dir, '--with-letter']);
  const out = result.lines.join('\n');
  assert.equal(result.code, 1, out);
  assert.ok(out.includes('TODO записка.txt: каркас создан, заполни по references/letter.md'));
  const skeleton = readFileSync(join(dir, 'записка.txt'), 'utf8');
  assert.equal(skeleton, letterSkeleton());
  assert.deepEqual(checkLetter(skeleton, []), [{ code: 'SD-W02', lines: [1, 3, 5] }]);
  assert.ok(!existsSync(packetDirOf(dir)), 'no package directory');
  assert.ok(!existsSync(join(pdfDir(dir), 'чек-лист.md')), 'no checklist either');
  assert.equal(result.lines.at(-1), 'Дальше: ' + nodeCommand(CLI_PATH, 'pack', dir, '--with-letter'));
});

test('pack ignores a draft, while --with-letter rejects it without quoting the text', pdfTest, (t) => {
  const dir = readyPackage(t);
  const path = join(dir, 'записка.txt');
  const draft = GOOD_LETTER + '\nУТОЧНЕНИЕ_ТОКЕН [Что проверено]\n';
  writeFileSync(path, draft);
  const plain = runCli(['pack', dir]);
  assert.equal(plain.code, 0, plain.lines.join('\n'));
  assert.ok(!existsSync(join(packetDirOf(dir), 'записка.txt')));
  assert.equal(readFileSync(path, 'utf8'), draft);
  const result = runCli(['pack', dir, '--with-rules', '--with-letter']);
  const out = result.lines.join('\n');
  assert.equal(result.code, 1, out);
  assert.match(out, /FAIL SD-W02.*строка/u);
  assert.doesNotMatch(out, /УТОЧНЕНИЕ_ТОКЕН/u);
  assert.ok(existsSync(join(packetDirOf(dir), MERGED_PDF)), 'the existing packet remains');
  assert.equal(result.lines.at(-1), 'Дальше: ' + nodeCommand(CLI_PATH, 'pack', dir, '--with-letter', '--with-rules'));
});

test('a mask unknown to the default profile gets SD-W05', pdfTest, (t) => {
  const dir = readyPackage(t, 'sd-pack-mask-');
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER + '\nХост {DB_HOST} согласовать.\n');
  const result = runPack(dir, { withLetter: true });
  const out = result.lines.join('\n');
  assert.equal(result.code, 1, out);
  assert.ok(out.includes('FAIL SD-W05'), out);
  assert.ok(!out.includes('{DB_HOST}'), 'the mask itself is not printed either');
});

test('letter accepts ordinary punctuation, lists and bracketed names in a finished note', () => {
  assert.deepEqual(checkLetter('Что проверено: Два листа.\nЧто изменилось: Нет изменений.\nЧто приложено: Приложение [схема]\n' + 'а'.repeat(1600), []), []);
  assert.deepEqual(checkLetter(' ', []), [{ code: 'SD-W02', lines: [1] }]);
});

test('letter requires all three fields even in a nonempty file', () => {
  for (const text of [
    'Сопроводительное письмо\n\n[заполнить после проверки]\n',
    'Что проверено: Схема\nЧто изменилось: Нет изменений\nЧто приложено: \n',
    'Что проверено: Схема\nЧто приложено: Два листа\n',
  ]) assert.ok(checkLetter(text, []).some(issue => issue.code === 'SD-W02'));
});

test('letter creates and validates its note in a folder without a diagram manifest', (t) => {
  const dir = tempDir('sec-letter-only-');
  t.after(() => rmDir(dir));
  const draft = runCli(['letter', dir]);
  assert.equal(draft.code, 1);
  assert.equal(readFileSync(join(dir, 'записка.txt'), 'utf8'), letterSkeleton());
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  assert.equal(runCli(['letter', dir]).code, 0);
});
