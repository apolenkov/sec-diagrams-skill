import { pdfTestOptions } from './pdf-fixtures.ts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from './cli.ts';
import { fakePdf, GOOD_LETTER, readyPackage } from './pack-fixtures.ts';
import { runPdf } from './pdf.ts';
import { openPdfDocument } from './pdf-gate.ts';
import { connection, numberCell, sentSheet, trunkSheet } from './sheet-fixtures.ts';
import { tempDir, rmDir, sendingCopyOfPackage, workingPackage } from './sending-fixtures.ts';
import { RULES_SHEET_FILE } from './rules-page.ts';

const pdfTest = await pdfTestOptions();

test('check resolves lists and reports a missing L3 number by YAML path without its value', t => {
  const dir = workingPackage(t, 'sd-firewall-');
  const path = join(dir, 'poc.yaml');
  const yaml = readFileSync(path, 'utf8');
  writeFileSync(path, yaml.replace('"L3-1:1"', "['L3-1:1', 'internal.example.invalid']"));
  const failed = runCli(['check', dir, '--json']);
  assert.equal(failed.code, 1);
  assert.deepEqual(JSON.parse(failed.lines[0]!).findings[0].ids, ['tables.0.rows.0.link.1']);
  assert.ok(!failed.lines.join('').includes('internal.example.invalid'));
  const guidance = runCli(['check', dir]).lines.join('\n');
  assert.match(guidance, /Исправь ссылку в poc\.yaml/u);
  assert.doesNotMatch(guidance, /text set|style set/u);
  const copy = dir + '-final';
  const final = runCli(['final', dir, copy]);
  assert.equal(final.code, 1);
  assert.match(final.lines.at(-1)!, /^Дальше: .*'check'/u);
  assert.equal(existsSync(copy), false);
  writeFileSync(path, yaml.replace('"L3-1:1"', "['L3-1:1', 'L3-1:3']"));
  assert.equal(runCli(['rules', path, '--force']).code, 0);
  const ok = runCli(['check', dir, '--json']);
  assert.equal(ok.code, 0);
  assert.deepEqual(JSON.parse(ok.lines[0]!).unreferencedLinks, ['L3-1:4', 'L3-2:3']);
  writeFileSync(path, yaml.replace(/^ *link:.*$/gmu, ''));
  assert.equal(runCli(['rules', path, '--force']).code, 0);
  const absent = runCli(['check', dir, '--json']);
  assert.equal(absent.code, 2);
  assert.ok(JSON.parse(absent.lines[0]!).notChecked.some((item: { reason: string }) => item.reason === 'no-link-references'));
});

test('a number on a sheet with an unreadable legend needs manual verification', t => {
  const dir = workingPackage(t, 'sd-firewall-');
  const file = join(dir, 'l3-1.drawio');
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('sdRole=legend', 'sdRole=other').replaceAll('Легенда', 'Образцы'));
  const checked = JSON.parse(runCli(['check', dir, '--json']).lines[0]!);
  assert.ok(checked.notChecked.some((item: { reason: string }) => item.reason === 'link-legend-unknown'));
  assert.ok(!checked.findings.some((item: { code: string }) => item.code === 'SD-R01'));
});

test('pack switches both the PDF and its editable sheets and lists unreferenced links outside the packet', pdfTest, t => {
  const dir = readyPackage(t);
  const packet = dir + '-обзор';
  for (const withRules of [false, true, false]) {
    const result = runCli(['pack', dir, ...(withRules ? ['--with-rules'] : [])]);
    assert.equal(result.code, 0, result.lines.join('\n'));
    assert.equal(existsSync(join(packet, 'схемы', RULES_SHEET_FILE)), withRules);
    const merged = readdirSync(packet).filter(file => file.endsWith('.pdf'));
    assert.equal(merged.length, 1);
    assert.equal(openPdfDocument(readFileSync(join(packet, merged[0]!)))?.countPages(), withRules ? 5 : 4);
    const checklist = readFileSync(join(dir + '-pdf', 'чек-лист.md'), 'utf8');
    assert.match(checklist, /^- \[ \] L3-1:3\. Подтвердите по схеме, что связь не пересекает МЭ\./mu);
    assert.ok(!checklist.includes('- [ ] L3-1:1'));
    assert.match(checklist, /SD-G01.*наложения.*изломы/u);
  }
});

test('a residual typography finding does not offer a safe fix that makes no edits', t => {
  const dir = workingPackage(t, 'sd-firewall-');
  const file = join(dir, 'l1.drawio');
  writeFileSync(file, readFileSync(file, 'utf8').replace('value="Сборщик"', 'value="Сборщик · сеть"'));
  const fix = runCli(['fix', '--safe', dir]);
  assert.equal(fix.code, 0);
  const checked = runCli(['check', dir]);
  assert.equal(checked.code, 1);
  assert.match(checked.lines.join('\n'), /SD-T01/u);
  assert.ok(!checked.lines.join('\n').includes('fix --safe'));
  assert.ok(!checked.lines.at(-1)?.includes("'fix'"));
});

test('an attached L3 protocol label that contradicts the numbered list fails blind', t => {
  const dir = workingPackage(t, 'sd-firewall-');
  const file = join(dir, 'l3-1.drawio');
  writeFileSync(file, readFileSync(file, 'utf8').replace('value="HTTPS (443/TCP)"', 'value="HTTPS (444/TCP)"'));
  const checked = runCli(['check', dir, '--json']);
  assert.equal(checked.code, 1);
  assert.deepEqual(JSON.parse(checked.lines[0]!).findings.find((f: { code: string }) => f.code === 'SD-L06').ids, ['list', 'p1']);
  assert.ok(!checked.lines[0]!.includes('444/TCP'));
});

test('invalid XML retains its parser coordinates and hides the offending bytes', t => {
  const dir = workingPackage(t, 'sd-firewall-');
  writeFileSync(join(dir, 'l1.drawio'), '<mxfile>\n<broken internal.example.invalid></mxfile>');
  const result = runCli(['check', dir]);
  assert.equal(result.code, 65);
  assert.match(result.lines[0]!, /SD-E01: l1\.drawio: file: 2:\d+:/u);
  assert.ok(!result.lines.join('').includes('internal.example.invalid'));
});

type LinkFinding = { code: string; reason: string; ids: string[] };
const readLinks = (dir: string) => {
  const body = JSON.parse(runCli(['check', dir, '--json']).lines[0]!);
  const rule = (item: LinkFinding) => item.code === 'SD-R01';
  return { fails: body.findings.filter(rule), skipped: body.notChecked.filter(rule), unmatched: body.unreferencedLinks };
};

test('one badge on a shared trunk resolves the firewall link', t => {
  const dir = workingPackage(t, 'sd-links-');
  const path = join(dir, 'l3-1.drawio');
  writeFileSync(path, trunkSheet(['ВМ 1', 'ВМ 2'], '1. SSH (22/TCP) - доступ к ВМ 1 или 2'));
  const yaml = join(dir, 'poc.yaml');
  writeFileSync(yaml, readFileSync(yaml, 'utf8').replace('link: "L3-1:2"', "link: 'L3-1:1'"));
  assert.equal(runCli(['rules', yaml, '--force']).code, 0);
  assert.deepEqual(readLinks(dir), { fails: [], skipped: [], unmatched: ['L3-2:3'] });
});

for (const layout of ['one page', 'two pages', 'two sheets']) {
  test('ambiguous links stay referenced across ' + layout, t => {
    const dir = tempDir('sd-level-');
    t.after(() => rmDir(dir));
    const sheets = [{ file: 'a.drawio', level: 'L3-2', topic: 'Связи' }];
    const first = sentSheet();
    const second = first.replace('name="Лист"', 'name="Продолжение"').replace('id="n2" value="2"', 'id="n2" value="5"');
    if (layout === 'two pages') {
      writeFileSync(join(dir, 'a.drawio'), first.replace('</mxfile>', second.slice(second.indexOf('<diagram'))));
    } else if (layout === 'two sheets') {
      sheets.push({ file: 'b.drawio', level: 'L3-2', topic: 'Продолжение' });
      writeFileSync(join(dir, 'a.drawio'), first);
      writeFileSync(join(dir, 'b.drawio'), second);
    } else {
      writeFileSync(join(dir, 'a.drawio'), first.replace('id="n4" value="4"', 'id="n4" value="1"'));
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ service: 'Служба ИБ', titlePrefix: '', sheets }));
    writeFileSync(join(dir, 'poc.yaml'), [
      'sheet: Правила', 'tables:', '  - from: А', '    to: Б', '    rows:',
      '      - {src: А, dst: Б, proto: TCP, port: "22", link: ["L3-2:2", "L3-2:1"]}', 'whitelist: []', 'notes: []',
    ].join('\n'));
    const review = readLinks(dir);
    assert.deepEqual(review.fails, []);
    assert.deepEqual(review.skipped.map((item: LinkFinding) => [item.reason, item.ids]),
      [['ambiguous-link', ['tables.0.rows.0.link.1']]]);
    assert.ok(!review.unmatched.includes('L3-2:2'));
    assert.ok(!review.unmatched.includes('L3-2:1'));
    assert.match(runCli(['check', dir]).lines.join('\n'), /NOT_CHECKED SD-R01.*неоднозначно.*номер повторяется на уровне L3-2: проверь правило глазами или разнеси номера/iu);
  });
}

test('an unreadable legend defers even an unbound number and retains candidates for the checklist', t => {
  const dir = workingPackage(t, 'sd-links-');
  const file = join(dir, 'l3-1.drawio');
  writeFileSync(file, sentSheet().replace('Обозначения линий', 'Образцы')
    .replace(numberCell('n1', '1', 450, 150), numberCell('n1', '7', 100, 850))
    .replace('</root>', numberCell('quantity', '350', 100, 880) + '</root>'));
  const review = readLinks(dir);
  assert.deepEqual(review.fails, []);
  assert.deepEqual(review.skipped.map((item: LinkFinding) => item.ids), [['tables.0.rows.0.link'], ['tables.0.rows.1.link']]);
  assert.ok(review.skipped.every((item: LinkFinding) => item.reason === 'link-legend-unknown'));
  assert.deepEqual(review.unmatched, ['L3-1:2', 'L3-1:3', 'L3-1:4', 'L3-1:7', 'L3-2:3']);
});

test('missing poc.yaml reports R01 only with L3 and preserves final and pdf steps', t => {
  const dir = workingPackage(t, 'sd-links-');
  unlinkSync(join(dir, 'poc.yaml'));
  const checked = runCli(['check', dir]);
  assert.equal(checked.code, 2);
  assert.match(checked.lines.join('\n'), /NOT_CHECKED SD-R01.*нет poc\.yaml/iu);
  assert.doesNotMatch(checked.lines.at(-1)!, /названные ячейки/u);
  const single = tempDir('sd-l1-only-');
  t.after(() => rmDir(single));
  writeFileSync(join(single, 'l1.drawio'), readFileSync(join(dir, 'l1.drawio')));
  assert.deepEqual(readLinks(single).skipped, []);
  writeFileSync(join(single, 'manifest.json'), JSON.stringify({
    service: 'Служба ИБ', titlePrefix: '', sheets: [{ file: 'l1.drawio', level: 'L1', topic: 'Общая схема' }],
  }));
  const work = runCli(['check', single]);
  assert.equal(work.code, 0, work.lines.join('\n'));
  assert.match(work.lines.at(-1)!, /^Дальше: .*'final'/u);
  const sent = runCli(['check', sendingCopyOfPackage(t, single, 'sd-l1-copy-')]);
  assert.equal(sent.code, 0, sent.lines.join('\n'));
  assert.match(sent.lines.at(-1)!, /^Дальше: .*'pdf'/u);
});

test('opposite arrows between the same nodes resolve one firewall link', t => {
  const dir = workingPackage(t, 'sd-links-');
  const reverse = connection('back', 'b2', 'b1', '#ad3b31')
    .replace('exitX=1;exitY=0.5;entryX=0;entryY=0.5;', 'exitX=0;exitY=0.8;entryX=1;entryY=0.8;');
  writeFileSync(join(dir, 'l3-1.drawio'), sentSheet().replace('</root>',
    reverse + numberCell('back-number', '1', 450, 168) + '</root>'));
  const review = readLinks(dir);
  assert.deepEqual(review.fails, []);
  assert.deepEqual(review.skipped, []);
  assert.deepEqual(review.unmatched, ['L3-1:3', 'L3-1:4', 'L3-2:3']);
});

test('a detached number badge resolves by number while N01 flags its position', t => {
  const dir = workingPackage(t, 'sd-detached-');
  const shifted = sentSheet().replace(numberCell('n1', '1', 450, 150), numberCell('n1', '1', 450, 210));
  writeFileSync(join(dir, 'l3-1.drawio'), shifted);
  const review = readLinks(dir);
  assert.deepEqual(review.fails, []);
  assert.deepEqual(review.skipped, []);
  const checked = runCli(['check', dir]).lines.join('\n');
  assert.match(checked, /FAIL SD-N01.*id=n1/u);
});

test('check fails when a valid L3 reference in YAML disagrees with the rendered rule', t => {
  const dir = workingPackage(t, 'sec-stale-rule-');
  const yaml = join(dir, 'poc.yaml');
  writeFileSync(yaml, readFileSync(yaml, 'utf8').replace('"L3-1:1"', '"L3-1:3"'));
  const checked = runCli(['check', dir, '--json']);
  assert.equal(checked.code, 1);
  assert.ok(JSON.parse(checked.lines[0]!).findings.some((f: { ids: string[] }) =>
    f.ids.includes('tables.0.rows.0.link')));
  assert.equal(runCli(['rules', yaml, '--force']).code, 0);
  assert.equal(runCli(['check', dir]).code, 0);
});

test('check and rules use the renamed source of the filter map from the manifest', t => {
  const dir = workingPackage(t, 'sec-renamed-rule-');
  const renamed = 'фильтры.drawio';
  const manifest = join(dir, 'manifest.json');
  const yaml = join(dir, 'poc.yaml');
  renameSync(join(dir, RULES_SHEET_FILE), join(dir, renamed));
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(RULES_SHEET_FILE, renamed));
  writeFileSync(yaml, readFileSync(yaml, 'utf8').replace('"L3-1:1"', '"L3-1:3"'));

  const checked = runCli(['check', dir, '--json']);
  assert.equal(checked.code, 1, checked.lines.join('\n'));
  assert.deepEqual(JSON.parse(checked.lines[0]!).findings, [{
    code: 'SD-R01', file: renamed, page: '-', ids: ['tables.0.rows.0.link'], reason: 'stale-rules-links',
  }]);
  assert.equal(runCli(['rules', yaml, '--force']).code, 0);
  assert.equal(existsSync(join(dir, RULES_SHEET_FILE)), false);
  assert.equal(runCli(['check', dir]).code, 0);
});

test('the manual checklist includes YAML field paths for unverified links', pdfTest, t => {
  const dir = readyPackage(t);
  const sheet = join(dir, 'l3-1.drawio');
  writeFileSync(sheet, readFileSync(sheet, 'utf8').replaceAll('sdRole=legend', 'sdRole=other').replaceAll('Легенда', 'Образцы'));
  assert.equal(runPdf(dir, { exportSheet: (_source, target) => fakePdf(target) }).code, 0);
  writeFileSync(join(dir, 'записка.txt'), GOOD_LETTER);
  const result = runCli(['pack', dir, '--with-letter']);
  assert.equal(result.code, 2, result.lines.join('\n'));
  const checklist = readFileSync(join(dir + '-pdf', 'чек-лист.md'), 'utf8');
  assert.match(checklist, /poc\.yaml.*SD-R01.*tables\.0\.rows\.0\.link/u);
});
