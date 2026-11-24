/**
 * Reading and writing values is allowed only where a working copy is confirmed : realpath of the sheet, the nearest manifest.json up the tree passes the
 * manifest schema and carries "final": false explicitly, no copy marker and no manifest whose
 * final differs from false stands in any folder above. Everything else - no manifest, a broken
 * one, one off schema, a final that is not a boolean, a marker above - is a refusal 64 ending
 * with "Человеку:" or "Дальше:". The cases cover a
 * manifest deleted, a "final": "true" string, a subfolder of the copy, a symlink, the схемы/
 * folder copied out of a packet. Every address is from RFC 5737.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';
import { confirmWorkingFolder, COPY_MARKER } from './values-guard.ts';
import { rmDir, sendingCopyOfPackage, show, tempDir, workingPackage } from './sending-fixtures.ts';

const sheetOf = (dir: string): string => join(dir, 'l1.drawio');

test('a confirmed working copy (manifest "final": false) opens its values to text get and set', (t) => {
  const dir = workingPackage(t, 'sd-confirm-');
  const sheet = sheetOf(dir);
  assert.equal(runCli(['text', 'get', sheet, 'collector']).code, 0, 'init has written final: false');
  assert.equal(runCli(['text', 'set', sheet, 'collector', 'Сборщик']).code, 0);
});

test('check under the packet marker: no manifest advice, no edits there, json names the packet', (t) => {
  const dir = workingPackage(t, 'sd-markcheck-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-markcheck-to');
  const packet = copy + '-обзор';
  mkdirSync(join(packet, 'схемы'), { recursive: true });
  writeFileSync(join(packet, COPY_MARKER), '');
  writeFileSync(join(packet, 'схемы', 'loose.drawio'), readFileSync(join(copy, 'l1.drawio'), 'utf8'));

  const root = runCli(['check', packet]);
  const rootOut = show(root.lines);
  assert.ok(root.code !== 0, 'the packet root is not a clean package: ' + rootOut);
  assert.ok(!rootOut.includes('init создаст пакет') && !rootOut.includes('init положит'), 'no init advice: ' + rootOut);
  assert.ok(
    !rootOut.includes('init создаст') && !rootOut.includes('manifest.json нет'),
    'no manifest advice: ' + rootOut,
  );
  assert.ok(
    rootOut.includes('правит человек в draw.io'),
    'the text hint sends edits to the person in draw.io: ' + rootOut,
  );
  const tail = root.lines.at(-1) ?? '';
  assert.ok(tail.startsWith('Человеку: ') || tail.startsWith('Дальше: '), rootOut);
  assert.ok(!tail.includes(join(packet, 'схемы')), 'the tail does not lead into схемы/ for edits: ' + tail);

  const json = JSON.parse(runCli(['check', packet, '--json']).lines[0] ?? '{}') as {
    findings: unknown[];
    notChecked: Array<{ code: string; reason: string; file?: string }>;
  };
  const packetEntry = json.notChecked.find((entry) => entry.reason === 'packet-copy-root');
  assert.ok(packetEntry !== undefined, 'json names the packet root: ' + JSON.stringify(json));
  assert.ok((packetEntry.file ?? '').endsWith('-обзор'), 'and carries its path: ' + JSON.stringify(packetEntry));

  const sheets = runCli(['check', join(packet, 'схемы')]);
  const sheetsOut = show(sheets.lines);
  assert.ok(!sheetsOut.includes('создай manifest.json'), 'no create-manifest advice under the marker: ' + sheetsOut);
  assert.ok(sheetsOut.includes('правит человек в draw.io'), 'the person edits in draw.io: ' + sheetsOut);
});

test('text get masks every IPv4 in its answer: plain, with a mask, with a range', (t) => {
  // Defense in depth: a working copy holds no real addresses, so masking the printout costs
  // nothing, and a stray real address can never leave through the console.
  const dir = workingPackage(t, 'sd-mask-');
  const sheet = sheetOf(dir);
  const written = 'Шлюз 203.0.113.77, сеть 198.51.100.0/24, пул 192.0.2.10-20, маска 198.51.100.8/255.255.255.0';
  assert.equal(runCli(['text', 'set', sheet, 'collector', written]).code, 0);
  const get = runCli(['text', 'get', sheet, 'collector']);
  assert.equal(get.code, 0, show(get.lines));
  const printed = get.lines[0] ?? '';
  assert.ok(!printed.includes('203.0.113.77'), printed);
  assert.ok(!printed.includes('198.51.100.0'), printed);
  assert.ok(!printed.includes('192.0.2.10'), printed);
  assert.ok(!printed.includes('255.255.255.0'), printed);
  assert.ok(
    printed.includes('Шлюз') && printed.includes('сеть') && printed.includes('пул'),
    'the words stay: ' + printed,
  );
  assert.ok(printed.includes('XX.XX.XX.XX'), printed);
  // The bytes on disk are untouched: masking reads only the printout.
  assert.ok(readFileSync(sheet, 'utf8').includes('203.0.113.77'), 'the sheet keeps the value');
});

test('a copy without the final field is an old working copy: refused with the hint to add it', (t) => {
  const dir = workingPackage(t, 'sd-nofinal-');
  const path = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  delete manifest['final'];
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  const result = runCli(['text', 'get', sheetOf(dir), 'collector']);
  assert.equal(result.code, 64, show(result.lines));
  const out = show(result.lines);
  assert.ok(out.includes(String.fromCharCode(34) + 'final' + String.fromCharCode(34)), out);
  const tail = result.lines.at(-1) ?? '';
  assert.ok(tail.startsWith('Человеку: ') || tail.startsWith('Дальше: '), out);
});

test('every bypass of the mark search is refused: missing, broken, off-schema, string true', (t) => {
  const dir = workingPackage(t, 'sd-bypass-');
  const sheet = sheetOf(dir);
  const path = join(dir, 'manifest.json');
  const original = readFileSync(path, 'utf8');
  const good = runCli(['text', 'get', sheet, 'collector']);
  assert.equal(good.code, 0, show(good.lines));

  rmSync(join(dir, 'manifest.json'), { force: true });
  const missing = runCli(['text', 'get', sheet, 'collector']);
  assert.equal(missing.code, 64, 'a deleted manifest is not a working copy: ' + show(missing.lines));
  writeFileSync(path, original);

  writeFileSync(path, '{ "service": ' + String.fromCharCode(34) + 'Служба ИБ' + String.fromCharCode(34) + ', ');
  assert.equal(runCli(['text', 'get', sheet, 'collector']).code, 64, 'a broken manifest is refused');
  writeFileSync(path, JSON.stringify({ service: 'Служба ИБ', titlePrefix: '', unknownTop: 1, sheets: [] }));
  assert.equal(runCli(['text', 'get', sheet, 'collector']).code, 64, 'a manifest off the schema is refused');
  const parsed = JSON.parse(original) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...parsed, final: 'true' }, null, 2));
  const stringTrue = runCli(['text', 'get', sheet, 'collector']);
  assert.equal(stringTrue.code, 64, 'a "final": "true" string is refused: ' + show(stringTrue.lines));
  writeFileSync(path, JSON.stringify({ ...parsed, final: 0 }, null, 2));
  assert.equal(runCli(['text', 'set', sheet, 'collector', 'Сборщик']).code, 64, 'a final that is not a boolean is refused');
});

test('a subfolder of the copy, a symlink and the draw.io folder out of a packet stay closed', (t) => {
  const dir = workingPackage(t, 'sd-bypass2-');
  const copy = sendingCopyOfPackage(t, dir, 'sd-bypass2-to');
  fillCopyManifest(copy);

  const sub = join(copy, 'bkp');
  mkdirSync(sub);
  writeFileSync(join(sub, 'l1.drawio'), readFileSync(join(copy, 'l1.drawio'), 'utf8'));
  assert.equal(runCli(['text', 'get', join(sub, 'l1.drawio'), 'collector']).code, 64, 'a subfolder of the copy');

  const root = tempDir('sd-bypass2-lnk');
  t.after(() => rmDir(root));
  const dirLink = join(root, 'link');
  symlinkSync(copy, dirLink);
  assert.equal(runCli(['text', 'get', join(dirLink, 'l1.drawio'), 'collector']).code, 64, 'a directory symlink');
  const fileLink = join(root, 'sheet.drawio');
  symlinkSync(join(copy, 'l1.drawio'), fileLink);
  assert.equal(runCli(['text', 'get', fileLink, 'collector']).code, 64, 'a file symlink');

  const lonely = tempDir('sd-bypass2-lonely');
  t.after(() => rmDir(lonely));
  writeFileSync(join(lonely, 'l1.drawio'), readFileSync(join(copy, 'l1.drawio'), 'utf8'));
  assert.equal(
    runCli(['text', 'get', join(lonely, 'l1.drawio'), 'collector']).code,
    64,
    'a sheet copied out with no manifest anywhere',
  );
});

function fillCopyManifest(copy: string): void {
  const path = join(copy, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  assert.equal(manifest['final'], true, 'final wrote the mark');
}

test('final puts the copy marker into the copy itself; init writes "final": false', (t) => {
  const dir = workingPackage(t, 'sd-marks-');
  const manifest = readFileSync(join(dir, 'manifest.json'), 'utf8');
  assert.ok(manifest.includes(String.fromCharCode(34) + 'final' + String.fromCharCode(34) + ': false'), manifest);
  const copy = sendingCopyOfPackage(t, dir, 'sd-marks-to');
  assert.ok(existsSync(join(copy, COPY_MARKER)), 'the copy carries the marker itself');
  assert.ok(readFileSync(join(copy, 'manifest.json'), 'utf8').includes(': true'), 'and the final mark');
});

test('a marker or a final manifest above closes every folder under it', (t) => {
  const dir = workingPackage(t, 'sd-above-');
  const sheet = sheetOf(dir);
  assert.equal(runCli(['text', 'get', sheet, 'collector']).code, 0);
  writeFileSync(join(dir, COPY_MARKER), '');
  const marked = runCli(['text', 'get', sheet, 'collector']);
  assert.equal(marked.code, 64, 'a marker standing on the folder itself: ' + show(marked.lines));
  rmSync(join(dir, COPY_MARKER), { force: true });

  const root = tempDir('sd-above2-');
  t.after(() => rmDir(root));
  const inner = join(root, 'work');
  mkdirSync(inner);
  writeFileSync(join(inner, 'l1.drawio'), readFileSync(join(dir, 'l1.drawio'), 'utf8'));
  writeFileSync(
    join(inner, 'manifest.json'),
    JSON.stringify(
      { service: 'Служба ИБ', titlePrefix: '', final: false, sheets: [{ file: 'l1.drawio', level: 'L1', topic: 'Т' }] },
      null,
      2,
    ),
  );
  assert.equal(runCli(['text', 'get', join(inner, 'l1.drawio'), 'collector']).code, 0, 'confirmed on its own');
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify(
      { service: 'Служба ИБ', titlePrefix: '', final: true, sheets: [{ file: 'l1.drawio', level: 'L1', topic: 'Т' }] },
      null,
      2,
    ),
  );
  const under = runCli(['text', 'get', join(inner, 'l1.drawio'), 'collector']);
  assert.equal(under.code, 64, 'a manifest with final true above closes the folder: ' + show(under.lines));
});

test('working-folder confirmation requires every ancestor manifest to confirm its state', (t) => {
  const root = tempDir('sd-confirm-tree-');
  t.after(() => rmDir(root));
  const dir = join(root, 'project');
  assert.equal(runCli(['init', dir]).code, 0);
  const manifest = readFileSync(join(dir, 'manifest.json'), 'utf8');
  const path = join(root, 'manifest.json');
  writeFileSync(path, manifest);
  assert.ok(confirmWorkingFolder(dir).allowed);
  for (const final of ['true', undefined]) {
    writeFileSync(path, JSON.stringify({ ...JSON.parse(manifest), final }));
    assert.equal(confirmWorkingFolder(dir).allowed, false, 'an unconfirmed ancestor closes values');
  }
});

test('folder confirmation follows the real directory of the sheets', (t) => {
  const root = tempDir('sd-confirm-path-');
  t.after(() => rmDir(root));
  const marked = join(root, 'copy');
  mkdirSync(marked);
  writeFileSync(join(marked, COPY_MARKER), '');
  const dir = join(marked, 'sheets');
  assert.equal(runCli(['init', dir]).code, 0);
  const link = join(root, 'linked-sheets');
  symlinkSync(dir, link);
  assert.equal(confirmWorkingFolder(dir).allowed, false);
  assert.equal(confirmWorkingFolder(link).allowed, false);
});

test('check keeps manual guidance in marked folders with sheets or an empty subfolder', (t) => {
  const root = tempDir('sd-check-marker-');
  t.after(() => rmDir(root));
  writeFileSync(join(root, COPY_MARKER), '');
  const dir = join(root, 'sheets');
  assert.equal(runCli(['init', dir]).code, 0);
  assert.equal(runCli(['rules', join(dir, 'poc.yaml')]).code, 0);
  const empty = join(root, 'empty');
  mkdirSync(empty);
  for (const folder of [dir, empty]) {
    const result = runCli(['check', folder]);
    assert.match(result.lines.at(-1) ?? '', /^Человеку: .*draw\.io/u);
  }
});
