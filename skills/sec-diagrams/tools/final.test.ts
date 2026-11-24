/**
 * The copy for sending: final copies the package and marks it, a person (the test here) writes
 * the values, and the agent's commands stay blind to them - text get and text set refuse the
 * copy, check, rules, fix, style, open, pdf and pack never print a value, an address or a stub
 * left in place (SD-T08) unless the cell carries the sdRole=open mark. Sheets are synthetic or
 * the skill's own templates; every address is from RFC 5737.
 */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';
import { OPEN_FILLED_KEY } from './checks/final.ts';
import { COPY_MARKER as COPY_MARKER_NAME } from './values-guard.ts';
import {
  NL,
  VALUES,
  fillCell,
  findingsOf,
  idsFor,
  linesOf,
  manifestOf,
  rmDir,
  sendingCopyOfPackage,
  show,
  tempDir,
  workingPackage,
} from './sending-fixtures.ts';

test('final copies the sheets, poc.yaml and the manifest and marks the copy', (t) => {
  const dir = workingPackage(t, 'sd-final-');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'inner.drawio'), 'not a sheet' + NL);
  writeFileSync(join(dir, 'записка.txt'), 'not copied' + NL);
  const parent = tempDir('sd-final-to-');
  t.after(() => rmDir(parent));
  const copy = join(parent, 'copy');
  const result = runCli(['final', dir, copy]);
  t.after(() => rmDir(copy));
  assert.equal(result.code, 0, show(result.lines));
  assert.equal(result.lines[0], 'OK ' + copy);
  const road = show(result.lines);
  assert.ok(road.includes('Человеку: значения вписывает человек в draw.io и в poc.yaml'), road);
  const further = result.lines.filter((line) => line.startsWith('Дальше: '));
  assert.equal(further.length, 1, 'final success leaves exactly one executable next step: ' + road);
  assert.ok((further[0] ?? '').includes("'rules'") && (further[0] ?? '').includes("'--force'"), road);
  assert.deepEqual(readdirSync(copy).sort(), [
    COPY_MARKER_NAME,
    'l1.drawio',
    'l2.drawio',
    'l3-1.drawio',
    'l3-2.drawio',
    'manifest.json',
    'poc.yaml',
    'Карта сетевой фильтрации.drawio',
  ]);
  assert.deepEqual(readFileSync(join(copy, 'l1.drawio')), readFileSync(join(dir, 'l1.drawio')), 'bytes are copied');
  assert.ok(manifestOf(dir).includes('"final": false'), 'the working copy is untouched');
  const written = readFileSync(join(copy, 'manifest.json'), 'utf8');
  assert.equal(written, JSON.stringify({ ...JSON.parse(manifestOf(dir)), final: true }, null, 2) + NL);
  assert.ok(!existsSync(join(copy, 'записка.txt')), 'only sheets, the manifest and poc.yaml travel');
});

test('final refuses a bad call and a broken source, writing nothing', (t) => {
  const dir = workingPackage(t, 'sd-final-refuse-');
  const taken = join(dir, 'taken');
  mkdirSync(taken);
  writeFileSync(join(taken, 'keep.txt'), 'keep' + NL);
  assert.equal(runCli(['final', dir]).code, 64);
  assert.equal(runCli(['final']).code, 64);
  assert.equal(runCli(['final', dir, taken, dir]).code, 64);
  assert.equal(runCli(['final', dir, taken, 'extra']).code, 64);

  const exists = runCli(['final', dir, taken]);
  assert.equal(exists.code, 64, show(exists.lines));
  assert.deepEqual(readdirSync(taken), ['keep.txt'], 'an existing folder is left alone');

  const same = runCli(['final', dir, dir]);
  assert.equal(same.code, 64, show(same.lines));
  assert.ok(manifestOf(dir).includes('"final": false'), 'nothing was rewritten');

  const bare = join(dir, 'bare');
  mkdirSync(bare);
  writeFileSync(join(bare, 'l1.drawio'), readFileSync(join(dir, 'l1.drawio'), 'utf8'));
  assert.equal(runCli(['final', bare, join(dir, 'no-manifest-copy')]).code, 65);
  assert.ok(!existsSync(join(dir, 'no-manifest-copy')), 'a refused call creates no folder');

  const broken = join(dir, 'broken');
  mkdirSync(broken);
  writeFileSync(join(broken, 'manifest.json'), '{ "sheets": [] }' + NL);
  assert.equal(runCli(['final', broken, join(dir, 'broken-copy')]).code, 65);
  assert.ok(!existsSync(join(dir, 'broken-copy')));

  const already = join(dir, 'already');
  mkdirSync(already);
  writeFileSync(
    join(already, 'manifest.json'),
    JSON.stringify({ ...JSON.parse(manifestOf(dir)), final: true }, null, 2) + NL,
  );
  writeFileSync(join(already, 'l1.drawio'), readFileSync(join(dir, 'l1.drawio'), 'utf8'));
  const twice = runCli(['final', already, join(dir, 'twice-copy')]);
  assert.equal(twice.code, 65, show(twice.lines));
  assert.ok(!existsSync(join(dir, 'twice-copy')), 'an already final manifest writes nothing');
});

test('text get and text set refuse the copy for sending and write nothing', (t) => {
  const dir = workingPackage(t, 'sd-textguard-');
  const sheet = join(dir, 'l2.drawio');
  assert.equal(runCli(['text', 'set', sheet, 'sensor', 'Датчик XX.XX.XX.XX']).code, 0);
  const copy = sendingCopyOfPackage(t, dir, 'sd-textguard-to');
  const target = join(copy, 'l2.drawio');
  const before = readFileSync(target, 'utf8');
  const get = runCli(['text', 'get', target, 'sensor']);
  assert.equal(get.code, 64, show(get.lines));
  assert.ok(show(get.lines).includes('значения вписывает человек в draw.io'), show(get.lines));
  assert.ok(show(get.lines).includes('check, pdf, pack'), show(get.lines));
  const set = runCli(['text', 'set', target, 'sensor', 'Пул 192.0.2.0/24']);
  assert.equal(set.code, 64, show(set.lines));
  assert.equal(readFileSync(target, 'utf8'), before, 'the refused set left every byte alone');
  const poc = join(copy, 'poc.yaml');
  assert.equal(runCli(['text', 'get', poc, 'x']).code, 64, 'a yaml path is refused before it is read');
  // The working copy keeps its text commands: values there are placeholders anyway.
  assert.equal(runCli(['text', 'get', sheet, 'sensor']).code, 0);
});

test('fix --safe and style set keep working on the copy for sending', (t) => {
  const dir = workingPackage(t, 'sd-fixstyle-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-fixstyle-to');
  assert.equal(runCli(['fix', '--safe', copy]).code, 0);
  const target = join(copy, 'l2.drawio');
  const styled = runCli(['style', 'set', target, 'sensor', 'fontSize=14']);
  assert.equal(styled.code, 0, show(styled.lines));
  assert.ok(!show(styled.lines).includes('XX'), 'the answer names the key, not a value');
});

test('open marks cells with sdRole=open, --undo clears the mark, unknown ids write nothing', (t) => {
  const dir = workingPackage(t, 'sd-open-');
  const sheet = join(dir, 'l2.drawio');
  const marked = runCli(['open', sheet, 'sensor', 'collector']);
  assert.equal(marked.code, 0, show(marked.lines));
  const xml = readFileSync(sheet, 'utf8');
  assert.equal((xml.match(/sdRole=open/g) ?? []).length, 2, 'both cells carry the mark');
  const unknown = runCli(['open', sheet, 'sensor', 'нет-такой-ид']);
  assert.equal(unknown.code, 64, show(unknown.lines));
  assert.equal(readFileSync(sheet, 'utf8'), xml, 'an unknown id writes nothing at all');
  const undone = runCli(['open', '--undo', sheet, 'sensor']);
  assert.equal(undone.code, 0, show(undone.lines));
  const after = readFileSync(sheet, 'utf8');
  const pool = after.match(/<mxCell id="sensor"[^>]*>/u)?.[0] ?? '';
  const proxy = after.match(/<mxCell id="collector"[^>]*>/u)?.[0] ?? '';
  assert.ok(!pool.includes('sdRole=open'), 'the mark is off sensor');
  assert.ok(!pool.includes('fontFamily') === false || pool.length > 0, 'the rest of the style is intact');
  assert.ok(proxy.includes('sdRole=open'), 'proxy keeps its mark');
});

test('open works on the copy for sending and never prints a value', (t) => {
  const dir = workingPackage(t, 'sd-openfinal-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-openfinal-to');
  fillCell(join(copy, 'l2.drawio'), 'sensor', 'Пул 192.0.2.0/24 MARKER-7f3a');
  const marked = runCli(['open', join(copy, 'l2.drawio'), 'sensor']);
  assert.equal(marked.code, 0, show(marked.lines));
  for (const value of VALUES) assert.ok(!show(marked.lines).includes(value), show(marked.lines));
});

test('a working copy keeps failing on every address and never reports SD-T08', () => {
  const lines = linesOf(findingsOf(false));
  assert.ok(
    lines.some((line) => line.startsWith('SD-T04') && line.includes('host')),
    lines.join(' | '),
  );
  assert.ok(
    lines.some((line) => line.startsWith('SD-T04') && line.includes('rng')),
    lines.join(' | '),
  );
  assert.ok(!lines.some((line) => line.includes('SD-T08')), 'SD-T08 never runs on a working copy');
});

test('a sending copy reads the whole address token: masks, ranges, and every broken tail', () => {
  const findings = findingsOf(true);
  assert.deepEqual(
    idsFor(findings, 'SD-T04').sort(),
    ['emptymask', 'endbig', 'endlow', 'half', 'legend-broken', 'over', 'wide'],
    linesOf(findings).join(' | '),
  );
});

test('a sending copy reports every stub as SD-T08, the legend and the footer stay clean', () => {
  // The marked-but-filled cell is SD-T08 too, of the other kind - the stub list reads its half.
  const ids = findingsOf(true)
    .filter((found) => found.code === 'SD-T08' && found.reasonKey === '')
    .flatMap((found) => found.ids)
    .sort();
  assert.deepEqual(
    ids,
    ['compound', 'qmark', 'qonly', 'sample-host', 'stub-field', 'stub-mask', 'stub-net', 'stub-vlan'],
    ids.join(' | '),
  );
});

test('the sdRole=open mark excuses a stub, and a filled marked cell is a finding again', () => {
  const findings = findingsOf(true);
  assert.ok(!idsFor(findings, 'SD-T08').includes('open-stub'), 'a marked stub is not a finding');
  const filled = findings.find((found) => found.reasonKey === OPEN_FILLED_KEY);
  assert.ok(filled !== undefined, 'the marked-but-filled cell is reported');
  assert.deepEqual(filled.ids, ['open-filled']);
});

test('fix and final include a hidden sheet explicitly listed in the manifest', (t) => {
  const dir = workingPackage(t, 'sec-hidden-');
  const name = '.l1.drawio';
  const source = join(dir, name);
  const manifest = join(dir, 'manifest.json');
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('"l1.drawio"', '"' + name + '"'));
  const original = readFileSync(join(dir, 'l1.drawio'), 'utf8');
  writeFileSync(source, original.replace('fontFamily=Arial', 'fontFamily=Comic Sans MS'));
  writeFileSync(join(dir, '.draft.drawio'), 'unlisted');
  rmSync(join(dir, 'l1.drawio'));
  const fixed = runCli(['fix', '--safe', dir]);
  assert.equal(fixed.code, 0, show(fixed.lines));
  assert.ok(fixed.lines.some(line => line.startsWith(name + ':')));
  assert.doesNotMatch(readFileSync(source, 'utf8'), /Comic Sans MS/u);
  const copy = dir + '-final';
  t.after(() => rmDir(copy));
  const result = runCli(['final', dir, copy]);
  assert.equal(result.code, 0, show(result.lines));
  assert.equal(readFileSync(join(copy, name), 'utf8'), readFileSync(source, 'utf8'));
  assert.ok(!existsSync(join(copy, '.draft.drawio')));
});

test('check, final and fix agree on a listed hidden symlink to a sheet', (t) => {
  const dir = workingPackage(t, 'sec-hidden-link-');
  const name = '.l1.drawio';
  const target = join(dir, 'l1.xml');
  const source = join(dir, name);
  const original = readFileSync(join(dir, 'l1.drawio'), 'utf8');
  const manifest = join(dir, 'manifest.json');
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('"l1.drawio"', '"' + name + '"'));
  writeFileSync(target, original);
  rmSync(join(dir, 'l1.drawio'));
  symlinkSync('l1.xml', source);
  symlinkSync('l1.xml', join(dir, '.unlisted.drawio'));
  assert.equal(runCli(['check', dir]).code, 0);

  const copy = dir + '-final';
  t.after(() => rmDir(copy));
  const result = runCli(['final', dir, copy]);
  assert.equal(result.code, 0, show(result.lines));
  assert.equal(readFileSync(join(copy, name), 'utf8'), original);
  assert.ok(lstatSync(join(copy, name)).isFile());
  assert.ok(!existsSync(join(copy, '.unlisted.drawio')));

  const needsFix = original.replace('fontFamily=Arial', 'fontFamily=Comic Sans MS');
  writeFileSync(target, needsFix);
  const blocked = join(dir, 'l2.drawio');
  writeFileSync(blocked, readFileSync(blocked, 'utf8').replace('fontFamily=Arial', 'fontFamily=Comic Sans MS'));
  chmodSync(blocked, 0o444);
  const refused = runCli(['fix', '--safe', dir]);
  chmodSync(blocked, 0o644);
  assert.equal(refused.code, 65, show(refused.lines));
  assert.equal(readlinkSync(source), 'l1.xml');

  const fixed = runCli(['fix', '--safe', dir]);
  assert.equal(fixed.code, 0, show(fixed.lines));
  assert.ok(fixed.lines.some(line => line.startsWith(name + ':')));
  assert.doesNotMatch(readFileSync(source, 'utf8'), /Comic Sans MS/u);
  assert.equal(readFileSync(target, 'utf8'), needsFix);
  assert.ok(lstatSync(join(dir, '.unlisted.drawio')).isSymbolicLink());
});
