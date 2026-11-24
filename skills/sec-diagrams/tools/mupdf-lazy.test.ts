import { spawnSync } from 'node:child_process';

/**
 * The lazy-engine contract: shipped sources must not pull mupdf in at import time, so `check`
 * works without the module and `pdf`/`pack` answer NOT_CHECKED with exit 2 instead of a stack.
 * This file never calls loadMupdf(), so its own process really runs without an engine - unlike
 * the files that exercise the gate, which load it up front.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';
import { mupdfLoaded } from './pdf-gate.ts';

const SHEET =
  '<mxfile host="app"><diagram name="L1"><mxGraphModel page="1" grid="0"><root></root></mxGraphModel></diagram></mxfile>';

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name === 'pdf-fixtures.ts') return [];
    return [path];
  });
}

test('no shipped source imports mupdf at module load', () => {
  const offenders: string[] = [];
  for (const path of sourcesUnder(import.meta.dirname)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const importsEngine = /from 'mupdf'/u.test(line);
      const lazy = line.trimStart().startsWith('import type');
      if (importsEngine && !lazy) offenders.push(path.slice(import.meta.dirname.length) + ': ' + line.trim());
    }
  }
  assert.deepEqual(offenders, []);
});

test('pdf and pack answer NOT_CHECKED with exit 2 while the engine is not loaded', (t) => {
  assert.equal(mupdfLoaded(), false, 'this file must never load the engine');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sd-noengine-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'l1.drawio'), SHEET);

  const pdf = runCli(['pdf', dir]);
  assert.equal(pdf.code, 2, pdf.lines.join('\n'));
  assert.ok(pdf.lines.join('\n').includes('mupdf'), 'the line names the module that is missing');
  assert.ok((pdf.lines.at(-1) ?? '').startsWith('Дальше: '), pdf.lines.join('\n'));

  const pack = runCli(['pack', dir]);
  assert.equal(pack.code, 2, pack.lines.join('\n'));
  assert.ok(pack.lines.join('\n').includes('mupdf'), pack.lines.join('\n'));

  // check needs no engine and stays usable.
  const checked = runCli(['check', dir]);
  assert.ok(checked.code < 64, 'check survives without the engine: ' + checked.lines.join('\n'));
});

test('the CLI gives offline installation instructions for the optional PDF engine', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sec-diagrams-no-engine-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(import.meta.dirname, 'cli.ts');
  const call = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SEC_DIAGRAMS_NO_MUPDF: '1', SEC_DIAGRAMS_HOME: '' },
  });
  assert.equal(call('init', dir).status, 0);
  assert.equal(call('rules', join(dir, 'poc.yaml')).status, 0);
  assert.equal(call('check', dir).status, 0);
  assert.equal(call('letter', dir).status, 1);
  writeFileSync(join(dir, 'записка.txt'), 'Что проверено: Потоки.\nЧто изменилось: Нет изменений.\nЧто приложено: Схема.\n');
  assert.equal(call('letter', dir).status, 0);
  for (const command of ['pdf', 'pack']) {
    const result = call(command, dir);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /NOT_CHECKED SD-P04/u);
    assert.match(result.stdout, /npm install --prefix ~\/\.sec-diagrams mupdf@1\.28\.6/u);
    assert.match(result.stdout, /AGPL-3\.0-or-later/u);
    assert.equal(result.stderr, '');
  }
});

test('an explicit PDF prefix rejects ancestor lookup, symlink escapes and incomplete exports', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sec-mupdf-prefix-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'isolated prefix');
  const ancestor = join(root, 'node_modules', 'mupdf');
  const local = join(home, 'node_modules', 'mupdf');
  mkdirSync(ancestor, { recursive: true });
  mkdirSync(join(home, 'node_modules'), { recursive: true });
  writeFileSync(join(ancestor, 'package.json'), '{"name":"mupdf","type":"module","exports":"./dist/mupdf.js"}');
  mkdirSync(join(ancestor, 'dist'));
  const marker = join(ancestor, 'dist', 'executed');
  writeFileSync(join(ancestor, 'dist', 'mupdf.js'),
    "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('./executed', import.meta.url), '');");
  const cli = join(import.meta.dirname, 'cli.ts');
  const env = { ...process.env, SEC_DIAGRAMS_HOME: home, SEC_DIAGRAMS_NO_MUPDF: '' };
  const assertUnavailable = () => {
    const result = spawnSync(process.execPath, [cli, 'pdf', home], { encoding: 'utf8', env });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /NOT_CHECKED SD-P04 PDF-движок/u);
    assert.ok(result.stdout.includes("npm install --prefix '" + home + "' mupdf@1.28.6"), result.stdout);
  };
  assertUnavailable();
  symlinkSync(ancestor, local, 'dir');
  assertUnavailable();
  assert.equal(existsSync(marker), false);
  rmSync(local);
  mkdirSync(join(local, 'dist'), { recursive: true });
  writeFileSync(join(local, 'package.json'), '{"name":"mupdf","type":"module","exports":"./dist/mupdf.js"}');
  writeFileSync(join(local, 'dist', 'mupdf.js'), 'export const setLog = () => {};');
  assertUnavailable();
});
