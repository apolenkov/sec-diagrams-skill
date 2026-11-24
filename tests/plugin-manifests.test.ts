import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const skillPath = 'skills/sec-diagrams/SKILL.md';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
}

interface PluginManifest {
  name: string;
  version: string;
}

interface Marketplace<Source> {
  name: string;
  plugins: { name: string; source: Source }[];
}

const pluginPaths = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'plugin.json',
];
const claudeMarketplacePath = '.claude-plugin/marketplace.json';
const codexMarketplacePath = '.agents/plugins/marketplace.json';
const packagePaths = ['package.json', 'skills/sec-diagrams/package.json'];
const lockfilePaths = ['package-lock.json', 'skills/sec-diagrams/package-lock.json'];

test('plugin identifiers agree across the manifests', () => {
  for (const path of pluginPaths) {
    assert.equal(readJson<PluginManifest>(path).name, 'sec-diagrams', path);
  }
});

test('the root plugin manifest declares the only schema accepted by Codex 0.171.0', () => {
  const { $schema } = readJson<{ $schema: string }>('plugin.json');
  assert.equal($schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
});

test('plugin, package and skill versions agree', () => {
  const { version } = readJson<PluginManifest>('package.json');
  assert.match(version, /^\d+\.\d+\.\d+(?:[-+].+)?$/u);
  for (const path of [...pluginPaths, ...packagePaths.slice(1)]) {
    assert.equal(readJson<PluginManifest>(path).version, version, path);
  }
  for (const path of lockfilePaths) {
    const lock = readJson<{ version: string; packages: Record<string, { version: string }> }>(path);
    assert.equal(lock.version, version, path);
    assert.equal(lock.packages['']?.version, version, path + ' packages[""]');
  }
  const skill = readFileSync(join(root, skillPath), 'utf8');
  const frontmatter = skill.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n/u)?.[1];
  assert.ok(frontmatter, skillPath + ': frontmatter');
  assert.equal(parse(frontmatter)?.metadata?.version, version, skillPath);
});

function marketplaceSource<Source>(path: string): Source {
  const marketplace = readJson<Marketplace<Source>>(path);
  assert.equal(marketplace.name, 'sec-tools', path);
  const entries = marketplace.plugins.filter(plugin => plugin.name === 'sec-diagrams');
  assert.equal(entries.length, 1, path + ': expected exactly one sec-diagrams entry');
  const [entry] = entries;
  assert.ok(entry, path);
  return entry.source;
}

test('each marketplace points sec-diagrams at the repository root', () => {
  const claude = marketplaceSource<string>(claudeMarketplacePath);
  assert.equal(claude, './', claudeMarketplacePath);
  assert.equal(resolve(root, claude), root, claudeMarketplacePath);

  const codex = marketplaceSource<{ source: string; path: string }>(codexMarketplacePath);
  assert.equal(codex.source, 'local', codexMarketplacePath);
  assert.equal(codex.path, './', codexMarketplacePath);
  assert.equal(resolve(root, codex.path), root, codexMarketplacePath);
  assert.ok(statSync(join(root, skillPath), { throwIfNoEntry: false })?.isFile(), skillPath);
});

interface NpmSpec {
  type: string;
  registry?: boolean;
  subSpec?: NpmSpec;
}

const npa = createRequire(import.meta.url)('npm-package-arg') as {
  resolve(name: string, spec: string): NpmSpec;
};

function isRegistrySpec(name: string, spec: string): boolean {
  try {
    const result = npa.resolve(name, spec);
    return (result.subSpec ?? result).registry === true;
  } catch {
    return false;
  }
}

test('npm classifies dependency specifiers using the same parser as npm install', () => {
  const specs = new Map([
    ['1.2.3', 'version'], ['^1.2.3', 'range'], ['next', 'tag'], ['npm:other@latest', 'alias'],
    ['git+ssh://host/repo', 'git'], ['file:../pkg', 'directory'], ['file:../pkg.tgz', 'file'],
    ['https://example.test/pkg.tgz', 'remote'],
  ]);
  for (const [spec, type] of specs) {
    assert.equal(npa.resolve('sample', spec).type, type, spec);
    assert.equal(isRegistrySpec('sample', spec), ['version', 'range', 'tag', 'alias'].includes(type), spec);
  }
  for (const spec of ['workspace:*', 'npm:pkg@file:pkg', '^latest']) {
    assert.equal(isRegistrySpec('sample', spec), false, spec);
  }
});

test('each npm package has a v2 or v3 lockfile and registry dependency specs', () => {
  for (const path of lockfilePaths) {
    const { lockfileVersion } = readJson<{ lockfileVersion: number }>(path);
    assert.ok(lockfileVersion === 2 || lockfileVersion === 3, path);
  }
  const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
  type DependencySpecs = Partial<Record<(typeof fields)[number], Record<string, string>>>;
  for (const path of packagePaths) {
    const pkg = readJson<DependencySpecs>(path);
    for (const field of fields) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        assert.ok(isRegistrySpec(name, spec), path + ': ' + name + ': ' + spec);
      }
    }
  }
});
