/**
 * The final line of each command: a run ends with one executable
 * "Дальше:" or with the person's step under "Человеку:"; NOT_CHECKED lines carry their own reason
 * and cell ids, "manifest.json нет" is said only when the manifest is really missing, a clean
 * working copy with an existing sending copy sends the agent to check that copy - and the final
 * refusal "копия уже существует" ends with the very same command. Quoting is single-quote style,
 * so a folder named it's! parses everywhere. Data is synthetic, addresses come from RFC 5737.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { runCheck } from './check.ts';
import { runCli } from './cli.ts';
import { shellQuote } from './shell.ts';
import { rmDir, show, tempDir, workingPackage } from './sending-fixtures.ts';
import { l1, sub } from './checks.test/support.ts';

const EMPTY_SHEET =
  '<mxfile><diagram name="S"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root>' +
  '</mxGraphModel></diagram></mxfile>';

test('a NOT_CHECKED line names its cells, and the manifest story is only for the manifestless', (t) => {
  // An orthogonal line without kink points excuses the number position: the excuse line itself
  // carries the edge ids, and nothing here may claim the manifest is missing - it is not.
  const dir = tempDir('sd-next-nc-');
  t.after(() => rmDir(dir));
  const xml = sub('entryX=0;entryY=0.5;', 'entryX=0.5;entryY=1;')(l1());
  writeFileSync(join(dir, 'l1.drawio'), xml);
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ service: 'Служба ИБ', titlePrefix: '', sheets: [{ file: 'l1.drawio', level: 'L1', topic: 'Тест' }] }),
  );
  const lines = runCheck(dir, false).lines;
  const blind = lines.filter((line) => line.startsWith('NOT_CHECKED SD-N01'));
  assert.ok(
    blind.some((line) => line.includes(' id=')),
    'the excuse names the edges: ' + show(lines),
  );
  assert.ok(!lines.some((line) => line.includes('manifest.json нет')), show(lines));

  const bare = tempDir('sd-next-manifestless-');
  t.after(() => rmDir(bare));
  writeFileSync(join(bare, 's.drawio'), EMPTY_SHEET);
  const orphan = runCheck(bare, false).lines;
  assert.ok(
    orphan.some((line) => line.includes('manifest.json нет')),
    show(orphan),
  );
  assert.ok(
    orphan.some((line) => line.startsWith('NOT_CHECKED SD-H01')),
    show(orphan),
  );
});

test('a clean working copy with an existing sending copy leads there, and final says the same', (t) => {
  const dir = workingPackage(t, 'sd-next-copy-');
  const copy = dir + '-отправка';
  t.after(() => rmDir(copy));
  assert.equal(runCli(['final', dir, copy]).code, 0);
  const check = runCheck(dir, false);
  const tail = check.lines.at(-1) ?? '';
  assert.ok(tail.startsWith('Дальше: ') && tail.includes("'check'"), show(check.lines));
  assert.ok(tail.includes(copy), 'the next step is the copy: ' + tail);
  const again = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'final', dir, copy], {
    encoding: 'utf8',
  });
  assert.equal(again.status, 64, again.stdout + again.stderr);
  const lines = again.stdout.trimEnd().split('\n');
  assert.ok(
    lines.some((line) => line.startsWith('usage:')),
    again.stdout,
  );
  assert.equal(lines.at(-1), tail, 'the refusal ends with the same command the check offers');
});

test('the usage answer prints usage and never fakes a command', () => {
  const result = runCli(['check']);
  assert.equal(result.code, 64);
  assert.ok(
    result.lines.some((line) => line.includes('text get')),
    'usage is printed',
  );
  assert.ok(result.lines.some(line => line.includes('check <folder>')));
  assert.doesNotMatch(result.lines.at(-1)!, /'check' /u);
  assert.equal(result.lines.filter(line => line.startsWith('Дальше: ')).length, 1);
});

test('shellQuote survives an apostrophe and a bang through the shell', { skip: process.platform === 'win32' || !existsSync('/bin/sh') }, () => {
  assert.equal(shellQuote("it's!"), "'it'\\''s!'");
  const proc = spawnSync('/bin/sh', ['-c', 'printf %s ' + shellQuote("it's! x(1)")], { encoding: 'utf8' });
  assert.equal(proc.status, 0);
  assert.equal(proc.stdout, "it's! x(1)");
});

test('every Дальше line parses in zsh unchanged, a folder with ! included', { skip: process.platform === 'win32' || !existsSync('/bin/zsh') }, (t) => {
  const root = tempDir('sd-next-zsh-');
  t.after(() => rmDir(root));
  const dir = join(root, "pa!ck 'name (x)");
  mkdirSync(dir);
  writeFileSync(join(dir, 'l1.drawio'), l1());
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ service: 'Служба ИБ', titlePrefix: '', sheets: [{ file: 'l1.drawio', level: 'L1', topic: 'Тест' }] }),
  );
  const scenarios = [runCheck(dir, false), runCli(['open', join(dir, 'l1.drawio'), 'нет-такого'])];
  const further = scenarios.flatMap((result) => result.lines.filter((line) => line.startsWith('Дальше: ')));
  assert.ok(further.length > 0);
  for (const line of further) {
    const command = line.slice('Дальше: '.length);
    const proc = spawnSync('/bin/zsh', ['-f', '-n'], { encoding: 'utf8', input: command + '\n' });
    assert.equal(proc.status, 0, 'zsh must parse "' + command + '": ' + proc.stderr);
  }
  // The open refusal of an unknown id still ends with a next step and names the resolved file.
  const refused = scenarios[1];
  assert.ok((refused?.lines.at(-1) ?? '').startsWith('Дальше: '), show(refused?.lines ?? []));
  assert.ok(refused?.lines.some((line) => line.includes(resolve(dir))) === true, show(refused?.lines ?? []));
});

test('pack rejects an unknown flag and keeps both known flags in its retry', t => {
  const dir = tempDir('sd-pack-usage-');
  t.after(() => rmDir(dir));
  const result = runCli(['pack', dir, '--with-rules', '--x', '--with-letter']);
  assert.equal(result.code, 64);
  assert.ok(result.lines.some(line => line.includes('pack <folder> [--with-letter] [--with-rules]')));
  assert.equal(result.lines.at(-1), "Дальше: node " + shellQuote(join(import.meta.dirname, 'cli.ts')) +
    " 'pack' " + shellQuote(dir) + " '--with-letter' '--with-rules'");
});

test('style set repairs the three SD-L04 keys on one sent edge', t => {
  const dir = workingPackage(t, 'sd-sent-style-');
  const manifestFile = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.sheets.find((sheet: { level: string }) => sheet.level === 'L3-1').retired = { 'Прием телеметрии': [5] };
  writeFileSync(manifestFile, JSON.stringify(manifest));
  const file = join(dir, 'l3-1.drawio');
  const before = readFileSync(file, 'utf8');
  const invalid = before.replace('rounded=1;jumpStyle=arc;jumpSize=12;', 'rounded=0;jumpStyle=none;jumpSize=3;');
  assert.notEqual(invalid, before);
  writeFileSync(file, invalid);
  const checked = runCli(['check', dir]);
  assert.ok(checked.lines.at(-1)?.startsWith('Человеку:'));
  const hint = checked.lines.find(line => line.startsWith('FAIL SD-L04') && line.includes('id=e1'));
  assert.match(hint ?? '', /style set/u);
  assert.match(hint ?? '', /fix --safe/u);
  for (const wrong of ['rounded=0', 'jumpStyle=none', 'jumpSize=3']) {
    assert.equal(runCli(['style', 'set', file, 'e1', wrong]).code, 64);
  }
  for (const pair of ['rounded=1', 'jumpStyle=arc', 'jumpSize=12']) {
    assert.equal(runCli(['style', 'set', file, 'e1', pair]).code, 0, pair);
  }
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(runCli(['check', dir]).code, 0);
});

test('style set refuses each SD-L04 key on a vertex without editing it', t => {
  const dir = workingPackage(t, 'sd-vertex-style-');
  const file = join(dir, 'l3-1.drawio');
  const before = readFileSync(file, 'utf8');
  for (const pair of ['rounded=1', 'jumpStyle=arc', 'jumpSize=12']) {
    const result = runCli(['style', 'set', file, 'n1', pair]);
    assert.equal(result.code, 64, pair);
    assert.ok(result.lines[0]?.includes(pair.split('=')[0]!));
    assert.match(result.lines[0]!, /только для стрелок/u);
    assert.equal(readFileSync(file, 'utf8'), before);
  }
  assert.equal(runCli(['style', 'set', file, 'n1', 'fillColor=#abcdef']).code, 0);
  assert.ok(readFileSync(file, 'utf8').includes('fillColor=#abcdef'));
});
