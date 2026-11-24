// Both launchers use the same file and conflict handling on every supported OS.
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, statSync, symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';

const source = realpathSync(join(import.meta.dirname, '..'));
const installed = join(homedir(), '.agents', 'skills', 'sec-diagrams');
const claude = join(homedir(), '.claude', 'skills', 'sec-diagrams');
const force = process.argv[2] === '--force';
const windows = process.platform === 'win32';
const ignore = new Set(['node_modules', '.DS_Store', 'evals']);

function sameFiles(a, b) {
  const left = lstatSync(a);
  const right = lstatSync(b);
  if (left.isFile() && right.isFile()) return readFileSync(a).equals(readFileSync(b));
  if (!left.isDirectory() || !right.isDirectory()) return false;
  const names = dir => readdirSync(dir).filter(name => !ignore.has(name)).sort();
  const expected = names(a);
  const actual = names(b);
  return expected.length === actual.length && expected.every((name, i) =>
    name === actual[i] && sameFiles(join(a, name), join(b, name)));
}

function checkConflict(path, entry) {
  if (entry && !entry.isSymbolicLink() && !force) {
    throw new Error(`Already exists: ${path}. To replace it, use ${windows ? '-Force' : '--force'}.`);
  }
}

function ensureDependencies(dir) {
  if (statSync(join(dir, 'node_modules'), { throwIfNoEntry: false })?.isDirectory()) {
    console.log(`Dependencies already installed in ${dir}`);
    return;
  }
  console.log(`Installing dependencies in ${dir}`);
  const options = { cwd: dir, stdio: 'inherit' };
  try {
    if (windows) execFileSync('cmd.exe', ['/d', '/c', 'npm.cmd ci --omit=dev'], options);
    else execFileSync('npm', ['ci', '--omit=dev'], options);
  } catch (error) {
    // A partial node_modules must not make a retry skip the installation.
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
    throw error;
  }
}

// Prepare the replacement before moving the previous target. Renaming a link
// moves the link itself, including a Windows junction, never its contents.
function replace(path, entry, prepare, finish) {
  const tmp = mkdtempSync(join(dirname(path), '.sec-diagrams-'));
  const next = join(tmp, 'new');
  const backup = join(tmp, 'previous');
  let backedUp = false;
  let moved = false;
  try {
    prepare(next);
    if (entry) {
      renameSync(path, backup);
      backedUp = true;
    }
    renameSync(next, path);
    moved = true;
    finish?.(path);
  } catch (error) {
    if (moved) rmSync(path, { recursive: true, force: true });
    if (backedUp) renameSync(backup, path);
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  rmSync(tmp, { recursive: true, force: true });
}

function install() {
  if (process.argv.length > (force ? 3 : 2)) throw new Error('Usage: install [--force]');
  mkdirSync(dirname(installed), { recursive: true });
  mkdirSync(dirname(claude), { recursive: true });
  const sharedParent = relative(realpathSync(dirname(installed)), realpathSync(dirname(claude))) === '';
  const dest = lstatSync(installed, { throwIfNoEntry: false });
  const link = lstatSync(claude, { throwIfNoEntry: false });
  const alreadyInstalled = dest?.isDirectory() &&
    (relative(realpathSync(installed), source) === '' || (!existsSync(join(installed, 'evals')) && sameFiles(source, installed)));
  const alreadyLinked = link?.isSymbolicLink() && existsSync(claude) && existsSync(installed) &&
    relative(realpathSync(claude), realpathSync(installed)) === '';
  if (!alreadyInstalled && dest?.isDirectory() && source.startsWith(realpathSync(installed) + sep)) {
    throw new Error(`Cannot replace a directory containing the installer: ${installed}`);
  }
  if (!alreadyInstalled) checkConflict(installed, dest);
  if (!sharedParent && !alreadyLinked) checkConflict(claude, link);
  if (alreadyInstalled) {
    console.log(`Skill already installed in ${installed}`);
    ensureDependencies(installed);
  } else {
    replace(installed, dest, next => {
      cpSync(source, next, { recursive: true, filter: path => !ignore.has(basename(path)) });
    }, ensureDependencies);
    console.log(`Installed skill in ${installed}`);
  }
  if (sharedParent) {
    console.log(`Claude already uses the same skills directory: ${dirname(claude)}`);
    return;
  }
  if (alreadyLinked && existsSync(claude) && relative(realpathSync(claude), realpathSync(installed)) === '') {
    console.log(`Claude link already installed at ${claude}`);
  } else {
    replace(claude, link, next => symlinkSync(installed, next, windows ? 'junction' : 'dir'));
    console.log(`Linked ${claude} to ${installed}`);
  }
}

try {
  install();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
