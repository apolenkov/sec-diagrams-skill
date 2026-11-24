import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CONTENT_REVIEW_FILES } from './pack-checklist.ts';
import { loadProfile, manifestSchema } from './profile.ts';

const SKILL = 'SKILL.md';
const FINAL = 'tools/final.ts';
const readme = (p: string): string => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

test('guidance and references carry no yo or long dash outside the literal typography examples', () => {
  const references = readdirSync(join(import.meta.dirname, '../references'))
    .filter(name => name.endsWith('.md') && !['letter.md', 'rules-text.md'].includes(name));
  for (const path of [SKILL, FINAL, ...references.map(name => 'references/' + name)]) {
    const text = readme(path);
    assert.ok(!/[ёЁ]/u.test(text), path + ': no ё, the sheets forbid it themselves');
    assert.ok(!/[—–]/u.test(text), path + ': no long dash');
  }
});

test('the unused profile flag is gone from the profile and the schema', () => {
  for (const path of [
    'config/profiles/default.json',
    'tools/profile.ts',
  ]) {
    assert.ok(!readme(path).includes('innercheck'), path + ': the code never read it');
  }
});

test('the resend route puts the agent in the working copy and the person in the sending copy', () => {
  const text = readme('references/resend.md');
  assert.ok(text.split(/\n\s*\n/u).some(p => /агент/iu.test(p) && /рабочей копии/iu.test(p) && /правк/iu.test(p)));
  assert.match(text, /копи[^.]*отправки[^.]*человек|человек[^.]*копи[^.]*отправки/u, 'the copy is the person');
});

test('SKILL.md matches the code: G01 is not promised on every exit, rules ids are rebuilt', () => {
  const text = readme(SKILL) + readme('references/copies.md');
  assert.match(text, /NOT_CHECKED SD-G01[^.]{0,80}/u);
  assert.ok(!/SD-G01.{0,3}всегда/u.test(text), 'the static line is not printed over refusals and empty folders');
  assert.match(text, /пересборке id|id[^.]*пересборк/u, 'the rules page ids are rebuilt on every rules run');
});

test('sending-copy documentation directs marked-sheet edits to the person', () => {
  const skill = readme(SKILL) + readme('references/copies.md');
  assert.ok(skill.includes('.sending-copy'), 'the copy marker is documented');
  assert.match(skill, /человек[^\n]{0,100}draw\.io/u, 'the person edits marked sheets in draw.io');
  assert.ok(skill.split(/\n\s*\n/u).some(p => ['notChecked', 'file', 'причин'].every(word => p.includes(word))));
  assert.ok(skill.split(/\n\s*\n/u).some(p => /отсутств|пропущ|нет/iu.test(p) && /лист[а-я]* правил/u.test(p) && p.includes('`rules`') && p.includes('манифест')));
  assert.match(readme('references/fw-rules.md'), /человек[^\n]{0,100}draw\.io/u);
  assert.match(readme('references/fw-rules.md'), /`rules --force <копия>\/poc\.yaml`/u);
});

test('SKILL.md documents both final-line markers and shell parsing', () => {
  const text = readme(SKILL);
  assert.match(text, /`Дальше:`[\s\S]{0,100}`Человеку:`/u);
  assert.match(readme('README.md'), /zsh -f -n -c/u);
  assert.match(text, /\[человек\][\s\S]*чек-лист/u);
  const sample = text.match(/```json\n([\s\S]*?)\n\s*```/u);
  assert.ok(sample, 'the manifest example exists');
  assert.ok(manifestSchema.safeParse(JSON.parse(sample[1] as string)).success, 'the sample passes the manifest schema');
});

test('SKILL.md follows the typography rules for Russian sheet guidance', () => {
  assert.ok(!/[ёЁ—–«»]/u.test(readme(SKILL)), 'no ё, long dashes or guillemets');
});

test('each public review item cites a document section', () => {
  const files = [...CONTENT_REVIEW_FILES, 'rules.md', 'rules-network.md', 'rules-text.md'];
  for (const name of new Set(files)) {
    const reference = readme('references/' + name);
    for (const item of reference.split(/^[-] /mu).slice(1)) {
      assert.match(item, /\[[^\]]+(?:§|раздел)[^\]]*\]\(https:\/\//u, name);
    }
  }
});

test('the public evaluation rubrics refer to the published review criteria', {
  skip: !existsSync(join(import.meta.dirname, '../evals')) && 'evals/ is omitted from the installed skill',
}, () => {
  assert.match(readme('evals/review-firewall-scope/graders/01-scope.md'), /NIST SP 800-41[^\n]*§/u);
  assert.match(readme('evals/review-documentation/graders/01-documentation.md'), /RFC 8446[^\n]*§/u);
});

test('the skill file table links every reference', () => {
  const table = readme(SKILL).split('## Файлы навыка')[1]!.split(/\n## /u)[0]!;
  const linked = [...table.matchAll(/\]\(references\/([^)]+)\)/gu)].map(match => match[1]);
  assert.deepEqual(linked.sort(), readdirSync(join(import.meta.dirname, '../references')).sort());
});

test('firewall examples use a reserved DNS domain', () => {
  assert.match(readme('references/fw-rules.md'), /name: 'ingest\.example\.org'/u);
});

test('notation documents the palette in profile order', () => {
  const profile = loadProfile();
  const colors = [...readme('references/notation.md').matchAll(/^\| `(#[0-9a-f]{6})`/gmu)]
    .map(match => match[1]);
  assert.deepEqual(colors, [...profile.edgePalette.map(entry => entry.color), profile.denyColor]);
});
