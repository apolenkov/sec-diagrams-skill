/**
 * The "Дальше:" lines must be pasteable and runnable in a POSIX shell even when the folder name
 * carries spaces, parentheses or shell metacharacters. Every quoted word goes through a real
 * `sh -c` round trip: a path that survives expansion unchanged is a path the user can run.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './cli.ts';
import { nodeCommand, shellQuote } from './shell.ts';
import { initFolder } from './templates.ts';

const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

/** The words a folder path on macOS or a hand-named package can actually contain. */
const NASTY = ['a b', 'rs sp', 'we (ird)', 'dollar$bill', 'tick`tock', 'quote"inside', 'back\\slash', 'brak[et]'];

test('shellQuote keeps every word unchanged through sh expansion', { skip: process.platform === 'win32' || !existsSync('/bin/sh') }, () => {
  for (const word of NASTY) {
    const proc = spawnSync('/bin/sh', ['-c', 'printf %s ' + shellQuote(word)], { encoding: 'utf8' });
    assert.equal(proc.error, undefined, 'sh must start');
    assert.equal(proc.status, 0, 'sh must accept the quoting for: ' + word);
    assert.equal(proc.stdout, word, 'the word must survive the shell: ' + word);
  }
});

test('nodeCommand quotes the CLI path and every argument for the shell', () => {
  const line = nodeCommand('/tmp/a b/cli.ts', 'check', '/tmp/rs sp');
  assert.equal(line, "node '/tmp/a b/cli.ts' 'check' '/tmp/rs sp'");
});

test('the Дальше line of check runs in sh -c from a folder with a space and parentheses', { skip: process.platform === 'win32' || !existsSync('/bin/sh') }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sd-sp-'));
  t.after(() => rmDir(root));
  const dir = join(root, 'rs sp');
  mkdirSync(dir);
  assert.equal(initFolder(dir).code, 0);

  const check = runCli(['check', dir]);
  const further = check.lines.at(-1) ?? '';
  assert.ok(further.startsWith('Дальше: '), further);
  const command = further.slice('Дальше: '.length);

  // Re-run the printed command through the shell: it must reach the CLI, not fail the call.
  // Trailing prose words after the command are not shell words and only print 127 noise; the
  // proof the command itself ran is its side effect and its own exit, never a 64 bad call.
  const proc = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
  assert.notEqual(proc.status, 64, 'the printed command must not be a bad call: ' + proc.stdout + proc.stderr);
  assert.ok(proc.stdout.includes('Таблиц:'), 'the printed rules command must have run: ' + proc.stdout + proc.stderr);
});
