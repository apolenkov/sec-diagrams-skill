import { loadMupdf } from './pdf-gate.ts';
/**
 * CLI tests: `fix --safe` through the exported run function, `text get|set` through the
 * real entry point spawned as a child process from a temporary directory outside the repository.
 * Sheets are synthetic; addresses are from RFC 5737.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseDrawio } from './drawio.ts';
import { loadProfile } from './profile.ts';
import { fixContext, planCell, runCli } from './cli.ts';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

// pack loads its engine on demand; this file exercises pack's filesystem failures, so load it.

const FIX_SHEET = `<mxfile host="app">
<diagram id="f1" name="L1"><mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="k1" value="Ёмкость «буфер» 100—200" style="rounded=0;whiteSpace=wrap;fontFamily=Courier;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="140" height="40" as="geometry"/></mxCell>
<mxCell id="k2" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="k1" target="k3"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="k3" value="Сервер 192.0.2.20" style="whiteSpace=wrap;fontFamily=Helvetica;" vertex="1" parent="1"><mxGeometry x="320" y="10" width="120" height="40" as="geometry"/></mxCell>
</root></mxGraphModel></diagram>
</mxfile>`;

const TWO_PAGES = `<mxfile host="app">
<diagram id="pa" name="L1"><mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="a1" value="Узел &amp; 192.0.2.1" style="whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell>
<mxCell id="shared" value="one" style="whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="5" y="6" width="7" height="8" as="geometry"/></mxCell>
</root></mxGraphModel></diagram>
<diagram id="pb" name="L2"><mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="shared" value="two" style="whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="9" y="9" width="9" height="9" as="geometry"/></mxCell>
</root></mxGraphModel></diagram>
</mxfile>`;

const geometryList = (text: string): string[] => text.match(/<mxGeometry[^>]*>/gu) ?? [];

const cellIds = (text: string): string[] =>
  parseDrawio(text)
    .pages.map((page) => page.cells.map((cell) => cell.id).sort())
    .flat();

function tempDir(prefix: string): string {
  // macOS resolves /var to /private/var in a child process cwd; compare canonical paths.
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A manifest that confirms a working copy: the value commands open only where this stands. */
const WORK_MANIFEST = (files: string[]): string =>
  JSON.stringify(
    {
      service: 'Служба ИБ',
      titlePrefix: '',
      final: false,
      sheets: files.map((file) => ({ file, level: 'L1', topic: 'Тест' })),
    },
    null,
    2,
  );

function spawnCli(args: string[], cwd: string): { status: number | null; output: string } {
  const proc = spawnSync(process.execPath, ['--experimental-strip-types', CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return { status: proc.status, output: `${proc.stdout}${proc.stderr}` };
}

test('fix --safe repairs the seeded sheet and keeps geometry byte-identical', (t) => {
  const dir = tempDir('sd-fix-');
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 'sheet.drawio'), FIX_SHEET);
  writeFileSync(join(dir, 'manifest.json'), WORK_MANIFEST(['sheet.drawio']));
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'inner.drawio'), FIX_SHEET);
  writeFileSync(join(dir, '.hidden.drawio'), FIX_SHEET);

  const result = runCli(['fix', '--safe', dir]);
  assert.equal(result.code, 0, result.lines.join('\n'));
  assert.equal(result.lines[0], 'sheet.drawio: SD-T01=1 SD-F01=2 SD-L04=1');
  const joined = result.lines.join('\n');
  assert.ok(result.lines.at(-1)?.startsWith(`Дальше: node '${CLI_PATH}' 'check' '${dir}'`));
  for (const label of ['Ёмкость', 'буфер', 'Сервер', 'Клиент']) {
    assert.ok(!joined.includes(label), `output must not contain label text: ${label}`);
  }

  const fixed = readFileSync(join(dir, 'sheet.drawio'), 'utf8');
  assert.ok(!/[ёЁ«»]/u.test(fixed), 'forbidden characters are gone');
  assert.ok(!/[0-9][—–]/u.test(fixed), 'dashes between digits are gone');
  assert.ok(fixed.includes('100-200'));
  assert.ok(!fixed.includes('Courier') && !fixed.includes('Helvetica'), 'disallowed fonts are gone');
  assert.equal(fixed.match(/fontFamily=Arial;/gu)?.length, 2);
  assert.ok(fixed.includes('rounded=1') && fixed.includes('jumpStyle=arc') && fixed.includes('jumpSize=12'));
  assert.deepEqual(geometryList(fixed), geometryList(FIX_SHEET));
  assert.deepEqual(cellIds(fixed), cellIds(FIX_SHEET));
  assert.equal(readFileSync(join(dir, 'sub', 'inner.drawio'), 'utf8'), FIX_SHEET, 'subfolders are skipped');
  assert.equal(readFileSync(join(dir, '.hidden.drawio'), 'utf8'), FIX_SHEET, 'hidden files are skipped');
});

test('fix --safe on an empty folder only prints the next step', (t) => {
  const dir = tempDir('sd-fix-empty-');
  t.after(() => rmDir(dir));
  const result = runCli(['fix', '--safe', dir]);
  assert.equal(result.code, 0);
  assert.deepEqual(result.lines, [`Дальше: node '${CLI_PATH}' 'check' '${dir}'`]);
});

test('a numbering gap points at retired in manifest.json, and a declared retired number clears it', (t) => {
  const dir = tempDir('sd-gap-');
  t.after(() => rmDir(dir));
  assert.equal(runCli(['init', dir]).code, 0);
  const sheet = join(dir, 'l2.drawio');
  // Line 4 becomes 5, as on a sent sheet where connection 4 was taken off.
  assert.equal(runCli(['text', 'set', sheet, 'n4', '5']).code, 0);
  // text get prints the value with real line breaks; text set takes them as "\n" in its argument.
  const list = runCli(['text', 'get', sheet, 'list']).lines.slice(0, -1).join('\n').replaceAll('\n', '\\n');
  assert.ok(list.includes('\\n4. '), list);
  assert.equal(runCli(['text', 'set', sheet, 'list', list.replace('\\n4. ', '\\n5. ')]).code, 0);

  const gap = runCli(['check', dir]);
  assert.equal(gap.code, 1, gap.lines.join('\n'));
  const line = gap.lines.find((text) => text.startsWith('FAIL SD-N01 l2.drawio')) ?? '';
  assert.ok(line.includes('не исправляй перенумерацией') && line.includes('"retired"'), line);

  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    sheets: Array<{ file: string; retired?: Record<string, number[]> }>;
  };
  const entry = manifest.sheets.find((item) => item.file === 'l2.drawio');
  assert.ok(entry);
  entry.retired = { 'Зоны и узлы': [4] };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const declared = runCli(['check', dir]);
  assert.ok(!declared.lines.some((text) => text.startsWith('FAIL')), declared.lines.join('\n'));
});

test('fix takes --safe on either side of the folder, and check prints a runnable fix line', (t) => {
  const dir = tempDir('sd-fix-order-');
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 'sheet.drawio'), FIX_SHEET);

  const failing = runCli(['check', dir]);
  const further = failing.lines.at(-1) ?? '';
  assert.equal(further, `Дальше: node '${CLI_PATH}' 'fix' '--safe' '${dir}'`);

  assert.equal(runCli(['fix', dir, '--safe']).code, 0);
  assert.equal(runCli(['fix', '--safe', dir]).code, 0);
  assert.equal(runCli(['fix', dir]).code, 64);
  assert.equal(runCli(['fix', '--safe', dir, dir]).code, 64);
});

test('fix --safe turns the long dash of a list line into " - " and leaves other dashes to a person', (t) => {
  const dir = tempDir('sd-fix-list-');
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 'manifest.json'), WORK_MANIFEST(['sheet.drawio']));
  const list = '1. Доступ к серверу — SSH (22/TCP)&#10;2. Доступ к порталу – HTTPS (443/TCP)&#10;Сеть — внешняя';
  const sheet = FIX_SHEET.replace('Сервер 192.0.2.20', list);
  writeFileSync(join(dir, 'sheet.drawio'), sheet);

  assert.equal(runCli(['fix', '--safe', dir]).code, 0);
  const value = parseDrawio(readFileSync(join(dir, 'sheet.drawio'), 'utf8')).pages[0]?.cells.find(
    (cell) => cell.id === 'k3',
  )?.value;
  assert.equal(value, '1. Доступ к серверу - SSH (22/TCP)\n2. Доступ к порталу - HTTPS (443/TCP)\nСеть — внешняя');
});

test('style set changes one allowed key of one cell and nothing else', (t) => {
  const dir = tempDir('sd-style-');
  t.after(() => rmDir(dir));
  const file = join(dir, 'sheet.drawio');
  writeFileSync(file, FIX_SHEET);

  const result = runCli(['style', 'set', file, 'k2', 'strokeColor=#754bb0']);
  assert.equal(result.code, 0, result.lines.join('\n'));
  assert.equal(result.lines[0], `OK ${file} k2 strokeColor`);
  const after = readFileSync(file, 'utf8');
  assert.equal(
    after,
    FIX_SHEET.replace('edgeStyle=orthogonalEdgeStyle;"', 'edgeStyle=orthogonalEdgeStyle;strokeColor=#754bb0;"'),
  );

  assert.equal(runCli(['style', 'set', file, 'k2', 'strokeColor=#754bb0']).code, 0, 'setting it again is a no-op');
  assert.equal(readFileSync(file, 'utf8'), after);
  for (const bad of ['exitX=0.5', 'strokeColor=#000;dashed=1', 'strokeColor=', 'strokeColor']) {
    assert.equal(runCli(['style', 'set', file, 'k2', bad]).code, 64, bad);
  }
  assert.equal(runCli(['style', 'get', file, 'k2']).code, 64);
  assert.equal(readFileSync(file, 'utf8'), after, 'a refused call writes nothing');
});

test('fix --safe reports SD-E01 without label text', (t) => {
  const dir = tempDir('sd-fix-broken-');
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 'broken.drawio'), `<!DOCTYPE mxfile>${FIX_SHEET}`);
  const result = runCli(['fix', '--safe', dir]);
  assert.equal(result.code, 65);
  assert.ok(result.lines.join('\n').includes('SD-E01: broken.drawio'));
  assert.ok(!result.lines.join('\n').includes('Сервер'));
});

const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

test('text get|set run as a child process from a directory outside the repository', (t) => {
  const dir = tempDir('sd-cli-');
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 's.drawio'), TWO_PAGES);
  writeFileSync(join(dir, 'manifest.json'), WORK_MANIFEST(['s.drawio']));

  const got = spawnCli(['text', 'get', 's.drawio', 'a1'], dir);
  assert.equal(got.status, 0, got.output);
  const gotLines = got.output.split('\n').filter((line) => line !== '');
  // the printout masks IPv4 even in a working copy; the words of the label stay.
  assert.equal(gotLines[0], 'Узел & XX.XX.XX.XX', 'the address is masked in the answer');
  assert.equal(gotLines.at(-1), `Дальше: node '${CLI_PATH}' 'check' '${dir}'`);

  const ambiguous = spawnCli(['text', 'get', 's.drawio', 'shared'], dir);
  assert.equal(ambiguous.status, 64, ambiguous.output);
  assert.ok(ambiguous.output.includes('"L1"') && ambiguous.output.includes('"L2"'), 'the pages are listed');
  const scoped = spawnCli(['text', 'get', 's.drawio', 'shared', '--page', 'L2'], dir);
  assert.equal(scoped.status, 0, scoped.output);
  assert.equal(scoped.output.split('\n')[0], 'two');

  const set = spawnCli(['text', 'set', 's.drawio', 'a1', 'first\\nsecond'], dir);
  assert.equal(set.status, 0, set.output);
  assert.equal(set.output.split('\n')[0], 'OK s.drawio a1');
  const raw = readFileSync(join(dir, 's.drawio'), 'utf8');
  assert.ok(raw.includes('value="first&#xa;second"'), 'the line break is stored as a character reference');
  assert.deepEqual(geometryList(raw), geometryList(TWO_PAGES));
  const back = spawnCli(['text', 'get', 's.drawio', 'a1'], dir);
  assert.equal(
    back.output.split('\n').slice(0, 2).join('\n'),
    'first\nsecond',
    'the value comes back with a real line break',
  );
});

test('the entry point runs when the skill is reached through a symlink, as .agents/skills does', (t) => {
  const dir = tempDir('sd-cli-link-');
  t.after(() => rmDir(dir));
  symlinkSync(join(import.meta.dirname, '..'), join(dir, 'sec-diagrams'));
  const proc = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(dir, 'sec-diagrams', 'tools', 'cli.ts')],
    {
      cwd: dir,
      encoding: 'utf8',
    },
  );
  assert.equal(proc.status, 64, 'a call without a command is a usage error, not a silent exit');
  assert.ok(proc.stdout.includes('usage:'), proc.stdout + proc.stderr);
});

test('exit codes: 64 for a bad call and 65 for SD-E01', (t) => {
  const dir = tempDir('sd-cli-codes-');
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 'broken.drawio'), `<!DOCTYPE mxfile>${TWO_PAGES}`);
  writeFileSync(join(dir, 'manifest.json'), WORK_MANIFEST(['broken.drawio']));

  assert.equal(spawnCli(['nope'], dir).status, 64);
  assert.equal(spawnCli(['text', 'get'], dir).status, 64);
  assert.equal(spawnCli(['fix', 'folder'], dir).status, 64);
  assert.equal(spawnCli(['text', 'get', 'missing.drawio', 'a1'], dir).status, 64);

  const broken = spawnCli(['text', 'get', 'broken.drawio', 'a1'], dir);
  assert.equal(broken.status, 65, broken.output);
  assert.ok(broken.output.includes('SD-E01'));
  assert.ok(!broken.output.includes('Узел'), 'the error does not quote cell values');
});

test('symlinks to a folder and a sheet are followed, missing paths stay a 64 call error', (t) => {
  const root = tempDir('sd-sym-');
  t.after(() => rmDir(root));
  const real = join(root, 'real');
  mkdirSync(real);
  writeFileSync(join(real, 'sheet.drawio'), FIX_SHEET);
  writeFileSync(join(real, 'manifest.json'), WORK_MANIFEST(['sheet.drawio']));
  const linkDir = join(root, 'link');
  const linkFile = join(root, 'link.drawio');
  symlinkSync(real, linkDir, 'dir');
  symlinkSync(join(real, 'sheet.drawio'), linkFile, 'file');

  assert.equal(runCli(['check', linkDir]).code, 1, 'a real folder behind a symlink is checkable');
  assert.equal(runCli(['text', 'get', linkFile, 'k3']).code, 0, 'a real sheet behind a symlink is readable');

  for (const args of [
    ['check', join(root, 'gone')],
    ['pdf', join(root, 'gone')],
    ['pack', join(root, 'gone')],
  ]) {
    const result = runCli(args);
    assert.equal(result.code, 64, args.join(' '));
    assert.ok(!result.lines.join(' ').includes(' at '), 'no Node stack for a missing path');
  }
});

test('a folder the process may not read answers SD-E01 with exit 65, not a stack', async (t) => {
  if (process.getuid?.() === 0) return; // root ignores the mode bits.
  const root = tempDir('sd-eacces-');
  const locked = join(root, 'locked');
  mkdirSync(locked);
  writeFileSync(join(locked, 'sheet.drawio'), FIX_SHEET);
  chmodSync(locked, 0o000);
  t.after(() => {
    chmodSync(locked, 0o755);
    rmDir(root);
  });
  for (const args of [
    ['check', locked],
    ['fix', '--safe', locked],
    ...(await loadMupdf() ? [['pack', locked]] : []),
  ]) {
    const result = runCli(args);
    assert.equal(result.code, 65, args.join(' ') + ': ' + result.lines.join(' | '));
    assert.ok(result.lines[0]?.startsWith('SD-E01'), args.join(' '));
    assert.ok(!result.lines.join(' ').includes(' at '), 'no Node stack: ' + args.join(' '));
  }
});

test('init refuses a folder that already holds sheets and points at the manifest recipe', (t) => {
  const dir = tempDir('sd-init-sheets-');
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 'sheet.drawio'), FIX_SHEET);
  const result = runCli(['init', dir]);
  assert.equal(result.code, 64, result.lines.join(' | '));
  assert.ok(
    result.lines.some((line) => line.includes('manifest.json') && line.includes('SKILL.md')),
    result.lines.join(' | '),
  );
  assert.ok((result.lines.at(-1) ?? '').startsWith('Дальше: '), result.lines.join(' | '));
  assert.ok(!existsSync(join(dir, 'manifest.json')), 'not one template slipped in');
});

test('a folder command handed a file answers a call error, not a Node stack', (t) => {
  const dir = tempDir('sd-kind-');
  t.after(() => rmDir(dir));
  const file = join(dir, 'sheet.drawio');
  writeFileSync(file, FIX_SHEET);

  for (const args of [
    ['check', file],
    ['fix', '--safe', file],
    ['pdf', file],
    ['pack', file],
    ['init', file],
  ]) {
    const result = runCli(args);
    assert.equal(result.code, 64, args.join(' '));
    assert.ok(result.lines[0]?.startsWith('ожидается папка: ' + file), args.join(' ') + ': ' + result.lines[0]);
  }
  for (const args of [
    ['text', 'get', dir, 'k1'],
    ['style', 'set', dir, 'k1', 'dashed=0'],
  ]) {
    const result = runCli(args);
    assert.equal(result.code, 64, args.join(' '));
    assert.ok(result.lines[0]?.startsWith('ожидается файл .drawio: ' + dir), args.join(' ') + ': ' + result.lines[0]);
  }
  const rules = runCli(['rules', dir]);
  assert.equal(rules.code, 64);
  assert.ok(rules.lines[0]?.startsWith('ожидается файл: ' + dir), rules.lines[0] ?? '');
});

test('text set into a single-quoted attribute escapes the apostrophe and keeps the sheet readable', (t) => {
  const dir = tempDir('sd-apos-');
  t.after(() => rmDir(dir));
  writeFileSync(join(dir, 'manifest.json'), WORK_MANIFEST(['sheet.drawio']));
  const file = join(dir, 'sheet.drawio');
  const quoted = FIX_SHEET.replace('value="Сервер 192.0.2.20"', "value='old'");
  assert.ok(quoted.includes("value='old'"), 'draw.io writes some attributes with single quotes');
  writeFileSync(file, quoted);

  const result = runCli(['text', 'set', file, 'k3', "it's"]);
  assert.equal(result.code, 0, result.lines.join('\n'));
  const after = readFileSync(file, 'utf8');
  assert.ok(after.includes("value='it&apos;s'"), 'only the delimiter quote gets the entity: ' + after);
  const value = parseDrawio(after).pages[0]?.cells.find((cell) => cell.id === 'k3')?.value;
  assert.equal(value, "it's", 'the edited file must still parse back to the value');
});

test('style set takes fontSize in the printable 8 to 72 and refuses the rest', (t) => {
  const dir = tempDir('sd-size-');
  t.after(() => rmDir(dir));
  const file = join(dir, 'sheet.drawio');
  writeFileSync(file, FIX_SHEET);

  assert.equal(runCli(['style', 'set', file, 'k1', 'fontSize=14']).code, 0);
  assert.ok(readFileSync(file, 'utf8').includes('fontSize=14'));
  for (const bad of ['fontSize=7', 'fontSize=73', 'fontSize=0', 'fontSize=1.5']) {
    assert.equal(runCli(['style', 'set', file, 'k1', bad]).code, 64, bad);
  }
  assert.equal(readFileSync(file, 'utf8').includes('fontSize=14'), true, 'a refused size writes nothing else');
});

test('fix takes the jump size and the replacement font from the profile, not from the code', () => {
  const edge = parseDrawio(FIX_SHEET).pages[0]?.cells.find((cell) => cell.id === 'k2');
  assert.ok(edge !== undefined && edge.edge, 'the fixture edge is there');
  const wide = planCell(edge, fixContext({ ...loadProfile(), jumpSize: 16 }));
  assert.ok(wide !== undefined && wide.kind === 'style', JSON.stringify(wide));
  assert.ok(wide.next.includes('jumpSize=16'), wide.next);

  const labelled = parseDrawio(FIX_SHEET).pages[0]?.cells.find((cell) => cell.id === 'k3');
  assert.ok(labelled !== undefined, 'the labelled vertex is there');
  const fonted = planCell(labelled, fixContext({ ...loadProfile(), fonts: ['Verdana'] }));
  assert.ok(fonted !== undefined && fonted.kind === 'style', JSON.stringify(fonted));
  assert.ok(fonted.next.includes('fontFamily=Verdana'), 'the first profile font replaces: ' + fonted.next);
});
