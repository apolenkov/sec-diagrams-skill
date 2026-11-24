/**
 * The templates are the definition of "clean": init must produce a package that check passes
 * with zero findings, regeneration must be byte-identical to what is committed under
 * content/templates, and no template may carry a real IPv4 address. The layout tests read the
 * geometry the generator produced: everything inside the canvas and its parent, nodes apart
 * inside their zone, every connection with its own anchors, no style with a repeated key and
 * no font below 14 - the sample an agent repeats must itself repeat cleanly.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCheck } from './check.ts';
import { parseDrawio, parseStyle, styleValue } from './drawio.ts';
import { loadProfile } from './profile.ts';
import { workingPackage } from './sending-fixtures.ts';
import { buildModel, type PageLabel } from './checks/model.ts';
import { initFolder, TEMPLATE_DIR, templateFiles } from './templates.ts';

const profile = loadProfile();

const PAGE_W = 1654;
const PAGE_H = 1169;

const drawioTemplates = (): Array<{ name: string; content: string }> =>
  templateFiles().filter((file) => file.name.endsWith('.drawio'));

/** An init folder without the rules page in manifest.json: the sheets alone must be clean. */
function initWithoutRulesPage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-init-'));
  initFolder(dir);
  const path = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { sheets: Array<{ file: string }> };
  manifest.sheets = manifest.sheets.filter((sheet) => sheet.file !== RULES_FILE);
  writeFileSync(path, JSON.stringify(manifest));
  return dir;
}

const RULES_FILE = 'Карта сетевой фильтрации.drawio';

test('init lists the rules page that rules builds later, and check says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-init-'));
  const init = initFolder(dir);
  assert.equal(init.code, 0);
  assert.equal(init.lines.filter((line) => line.startsWith('COPY')).length, templateFiles().length);
  const result = runCheck(dir, false);
  assert.equal(result.code, 2, result.lines.join('\n'));
  assert.ok(
    result.lines.every((line) => !line.startsWith('FAIL')),
    result.lines.join('\n'),
  );
  assert.ok(result.lines.some((line) => line.startsWith('NOT_CHECKED SD-K01 ' + RULES_FILE)));
  assert.ok(result.lines.at(-1)?.includes("'rules'"), result.lines.join('\n'));
});

test('a sheet name typo in manifest.json is never silent', (t) => {
  const dir = workingPackage(t, 'sd-check-missing-');
  const path = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    sheets: Array<{ file: string; level?: string; topic?: string }>;
  };
  manifest.sheets.push({ ...manifest.sheets[0], file: 'l9.drawio', level: '', topic: 'Девятый лист' });
  writeFileSync(path, JSON.stringify(manifest));
  const result = runCheck(dir, false);
  assert.equal(result.code, 2);
  assert.ok(result.lines.some((line) => line.startsWith('NOT_CHECKED SD-K01 l9.drawio')));
  assert.equal(result.lines.at(-1), 'Человеку: поправь имя в manifest.json');
  assert.ok(
    result.lines.every((line) => !line.includes('rules')),
    result.lines.join('\n'),
  );
});

test('init sheets pass check once the rules page is out of the way', () => {
  const result = runCheck(initWithoutRulesPage(), false);
  assert.equal(result.code, 0, result.lines.join('\n'));
  assert.equal(result.lines[0], 'NOT_CHECKED SD-G01 (наложения и изломы: проверь глазами)');
  // A clean working copy is sent by its copy for sending, so the road points at final.
  assert.ok(result.lines.at(-1)?.includes("'final'"), result.lines.join('\n'));
});

test('init refuses a folder whose templates became sheets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-init-'));
  initFolder(dir);
  const again = initFolder(dir);
  assert.equal(again.code, 64, again.lines.join(' | '));
  assert.ok(
    again.lines.some((line) => line.includes('manifest.json') && line.includes('SKILL.md')),
    again.lines.join(' | '),
  );
  assert.ok(
    again.lines.every((line) => !line.startsWith('SKIP') && !line.startsWith('COPY')),
    'not one line of work',
  );
});

test('init names one next step: rules by poc.yaml, with poc.yaml filled first named above it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-init-'));
  const lines = initFolder(dir).lines;
  const line = lines.at(-1) ?? '';
  assert.ok(line.startsWith('Дальше:'), line);
  // One command per Дальше: line, no chain and no comment tail.
  assert.ok(!line.includes(' ; ') && !line.includes(' #'), 'one clean command: ' + line);
  const poc = line.indexOf('poc.yaml');
  const rules = line.indexOf("'rules'");
  assert.ok(0 <= rules && rules < poc, line);
  assert.ok(
    lines.some((text) => text.includes('poc.yaml') && text.includes('fw-rules.md') && !text.startsWith('Дальше:')),
    'the note line names poc.yaml and fw-rules.md: ' + lines.join('\n'),
  );
});

test('the rules page is not a template but stays listed in the manifest', () => {
  const rulesName = 'Карта сетевой фильтрации.drawio';
  assert.equal(
    templateFiles().some((file) => file.name === rulesName),
    false,
    'the rules command builds that sheet, a stub would block it',
  );
  const manifest = templateFiles().find((file) => file.name === 'manifest.json');
  const listed = JSON.parse(manifest?.content ?? '{}') as { sheets: Array<{ file: string }> };
  assert.ok(
    listed.sheets.some((sheet) => sheet.file === rulesName),
    'the manifest line must stay',
  );
});

test('regeneration is byte-identical to the committed templates', () => {
  for (const file of templateFiles()) {
    const committed = readFileSync(join(TEMPLATE_DIR, file.name), 'utf8');
    assert.equal(file.content, committed, 'regenerated bytes differ for ' + file.name);
  }
});

test('no template carries a real IPv4 address', () => {
  const ipv4 = /(?<![\d.XX])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\d.])/u;
  for (const file of drawioTemplates()) {
    assert.equal(ipv4.test(file.content), false, 'found an address in ' + file.name);
  }
  const schema = templateFiles().find((file) => file.name === 'l1.drawio');
  assert.ok((schema?.content ?? '').includes('XX.XX.XX.XX'), 'the placeholder must appear instead');
});

test('templates are A3 landscape with arial everywhere', () => {
  for (const file of drawioTemplates()) {
    assert.ok(file.content.includes('page="1"'), file.name);
    assert.ok(file.content.includes('pageWidth="' + PAGE_W + '" pageHeight="' + PAGE_H + '"'), file.name);
    for (const line of file.content.split('\n')) {
      if (line.includes('value="') && !line.includes('value=""')) {
        assert.ok(line.includes('fontFamily=Arial'), 'label without an explicit font in ' + file.name);
      }
    }
  }
});

const badStyleKeys = (content: string): string[] => {
  const bad: string[] = [];
  for (const match of content.matchAll(/style="([^"]*)"/gu)) {
    const seen = new Set<string>();
    for (const pair of parseStyle(match[1] ?? '')) {
      if (seen.has(pair.key)) bad.push(pair.key);
      seen.add(pair.key);
    }
  }
  return bad;
};

test('no style key repeats and no font is smaller than 14', () => {
  for (const file of drawioTemplates()) {
    assert.deepEqual(badStyleKeys(file.content), [], 'repeated style key in ' + file.name);
    for (const match of file.content.matchAll(/fontSize=(\d+)/gu)) {
      assert.ok(Number(match[1]) >= 14, 'font below 14 in ' + file.name);
    }
  }
});

interface Probe {
  name: string;
  parentOf: Map<string, string>;
  isEdge: Set<string>;
  byId: Map<string, PageLabel>;
  cells: PageLabel[];
  vertices: PageLabel[];
  edges: PageLabel[];
}

function probe(file: { name: string; content: string }): Probe[] {
  return parseDrawio(file.content).pages.map((page) => {
    const model = buildModel(file.name, page, profile, []);
    return {
      name: file.name,
      parentOf: new Map(page.cells.map((cell) => [cell.id, cell.parent])),
      isEdge: new Set(page.cells.filter((cell) => cell.edge).map((cell) => cell.id)),
      byId: new Map(model.allCells.map((cell) => [cell.id, cell])),
      cells: model.allCells,
      vertices: model.vertices,
      edges: model.edges,
    };
  });
}

const layoutVertex = (probeItem: Probe, cell: PageLabel): boolean =>
  cell.vertex && cell.box !== null && !probeItem.isEdge.has(probeItem.parentOf.get(cell.id) ?? '1');

test('every vertex sits on the canvas and inside its parent', () => {
  for (const file of drawioTemplates()) {
    for (const item of probe(file)) {
      for (const cell of item.cells) {
        if (!layoutVertex(item, cell)) continue;
        const box = cell.box as NonNullable<PageLabel['box']>;
        assert.ok(
          box.x1 >= 0 && box.y1 >= 0 && box.x2 <= PAGE_W && box.y2 <= PAGE_H,
          item.name + ' ' + cell.id + ' is off the canvas',
        );
        const parent = item.parentOf.get(cell.id) ?? '1';
        if (parent === '1') continue;
        const outer = item.byId.get(parent)?.box;
        if (outer === undefined || outer === null) {
          assert.fail(item.name + ' ' + cell.id + ' has a parent without geometry');
        }
        assert.ok(
          box.x1 >= outer.x1 && box.y1 >= outer.y1 && box.x2 <= outer.x2 && box.y2 <= outer.y2,
          item.name + ' ' + cell.id + ' sticks out of its parent',
        );
      }
    }
  }
});

const overlaps = (a: PageLabel, b: PageLabel): boolean => {
  const x = a.box as NonNullable<PageLabel['box']>;
  const y = b.box as NonNullable<PageLabel['box']>;
  return x.x1 < y.x2 && y.x1 < x.x2 && x.y1 < y.y2 && y.y1 < x.y2;
};

test('labels and nodes that share a parent do not overlap', () => {
  for (const file of drawioTemplates()) {
    for (const item of probe(file)) {
      const groups = new Map<string, PageLabel[]>();
      for (const cell of item.vertices) {
        const parent = item.parentOf.get(cell.id) ?? '1';
        if (parent === '1' || item.isEdge.has(parent)) continue;
        groups.set(parent, [...(groups.get(parent) ?? []), cell]);
      }
      for (const [parent, group] of groups) {
        for (let i = 0; i < group.length; i += 1) {
          for (let j = i + 1; j < group.length; j += 1) {
            assert.ok(!overlaps(group[i] as PageLabel, group[j] as PageLabel), item.name + ' overlap under ' + parent);
          }
        }
      }
    }
  }
});

const anchor = (cell: PageLabel, key: string): string => styleValue(cell.style, key) ?? '';

test('every connection carries explicit anchors and anchors are not shared on a node', () => {
  for (const file of drawioTemplates()) {
    for (const item of probe(file)) {
      const real = item.edges.filter((edge) => edge.source !== '' && edge.target !== '');
      for (const edge of real) {
        for (const key of ['exitX', 'exitY', 'entryX', 'entryY']) {
          assert.ok(styleValue(edge.style, key) !== undefined, item.name + ' ' + edge.id + ' has no ' + key);
        }
      }
      const pair = new Map<string, PageLabel[]>();
      for (const edge of real) {
        pair.set('s:' + edge.source, [...(pair.get('s:' + edge.source) ?? []), edge]);
        pair.set('t:' + edge.target, [...(pair.get('t:' + edge.target) ?? []), edge]);
      }
      for (const [group, edges] of pair) {
        for (let i = 0; i < edges.length; i += 1) {
          for (let j = i + 1; j < edges.length; j += 1) {
            const a = edges[i] as PageLabel;
            const b = edges[j] as PageLabel;
            const exitsDiffer = anchor(a, 'exitX') + anchor(a, 'exitY') !== anchor(b, 'exitX') + anchor(b, 'exitY');
            const entriesDiffer =
              anchor(a, 'entryX') + anchor(a, 'entryY') !== anchor(b, 'entryX') + anchor(b, 'entryY');
            if (group.startsWith('s:')) {
              assert.ok(exitsDiffer || entriesDiffer, item.name + ' two lines share an exit on ' + group);
            } else {
              assert.ok(entriesDiffer, item.name + ' two lines share an entry on ' + group);
            }
          }
        }
      }
    }
  }
});

test('check --json over the init sheets finds nothing but the geometry note', () => {
  const result = runCheck(initWithoutRulesPage(), true);
  assert.equal(result.code, 0, result.lines.join(''));
  const body = JSON.parse(result.lines.join('')) as { findings: unknown[]; notChecked: Array<{ code: string }> };
  assert.deepEqual(body.findings, []);
  assert.deepEqual(
    body.notChecked.map((entry) => entry.code),
    ['SD-G01'],
  );
});

test('the skill practices what it preaches: no ё or long dash in fw-rules.md or check hints', () => {
  const guide = readFileSync(join(TEMPLATE_DIR, '..', '..', 'references', 'fw-rules.md'), 'utf8');
  for (const line of guide.split('\n')) {
    assert.ok(!/[ёЁ—–]/u.test(line), 'fw-rules.md must write like a sheet: ' + line.trim());
  }
  const check = readFileSync(join(import.meta.dirname, 'check.ts'), 'utf8');
  for (const line of check.split('\n')) {
    if (!/[ёЁ—–]/u.test(line)) continue;
    assert.ok(line.includes('SD-T01'), 'only the T01 hint may name the forbidden signs: ' + line.trim());
  }
  assert.ok(!check.includes('стоить'), 'a hint with a typo reads as generated text');
});
