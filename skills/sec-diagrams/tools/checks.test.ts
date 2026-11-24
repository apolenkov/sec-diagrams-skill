/**
 * Mutant tests for every ported code: the clean template passes, and one targeted defect makes
 * exactly its code appear. Output blindness is asserted too - a label that produced a finding
 * must never show up in the console lines or the JSON. A sheet whose legend can be found
 * nowhere, by the mark or by the search, turns the legend-dependent codes into NOT_CHECKED,
 * and a folder without manifest.json reports the title rule as NOT_CHECKED instead of failing
 * it. Sheet-wide text cases live in checks.test/text-rules.ts on the shared harness of
 * checks.test/support.ts.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCheck } from './check.ts';
import { templateFiles } from './templates.ts';
import { parseDrawio } from './drawio.ts';
import { loadProfile } from './profile.ts';
import { buildModel } from './checks/model.ts';
import { checkSheet } from './checks/sheet.ts';
import { codesOf, l1, l3, PROXY, proxyObject, sub, template } from './checks.test/support.ts';
import './checks.test/text-rules.ts';

const profile = loadProfile();
const CLI_PATH = join(import.meta.dirname, 'cli.ts');

const cleanRun = (name: string): string[] => codesOf(name, template(name));

test('clean templates have no findings', () => {
  for (const name of ['l1.drawio', 'l2.drawio', 'l3-1.drawio', 'l3-2.drawio']) {
    assert.deepEqual(cleanRun(name), [], 'findings on ' + name);
  }
});

const cases: Array<{ name: string; code: string; base: () => string; xml: string }> = [
  {
    name: 'edge without a number',
    code: 'SD-N01',
    base: l1,
    xml: sub('id="n2" value="2"', 'id="n2" value=""')(l1()),
  },
  { name: 'gap in numbers', code: 'SD-N01', base: l1, xml: sub('id="n2" value="2"', 'id="n2" value="4"')(l1()) },
  { name: 'reused retired number', code: 'SD-N01', base: l1, xml: l1() },
  {
    name: 'dashed line outside the legend',
    code: 'SD-L01',
    base: l1,
    xml: sub('strokeColor=#2867a6', 'dashed=1;strokeColor=#2867a6')(l1()),
  },
  {
    name: 'color outside the palette',
    code: 'SD-L02',
    base: l1,
    xml: sub('strokeColor=#2867a6', 'strokeColor=#123456')(l1()),
  },
  {
    name: 'deny line without an arrow',
    code: 'SD-L02',
    base: l3,
    xml: sub('strokeColor=#64748b;endArrow=cross', 'strokeColor=#64748b;endArrow=none')(l3()),
  },
  {
    name: 'thicker line',
    code: 'SD-L03',
    base: l1,
    xml: sub('strokeWidth=2;strokeColor=#2867a6', 'strokeWidth=3;strokeColor=#2867a6')(l1()),
  },
  {
    name: 'one thin line among three of width 2',
    code: 'SD-L03',
    base: l1,
    xml: sub('strokeWidth=2;strokeColor=#2867a6', 'strokeWidth=1;strokeColor=#2867a6')(l1()),
  },
  { name: 'no arc jump', code: 'SD-L04', base: l1, xml: sub('jumpStyle=arc', 'jumpStyle=none')(l1()) },
  {
    name: 'square corners',
    code: 'SD-L04',
    base: l1,
    xml: sub('rounded=1;jumpStyle=arc', 'rounded=0;jumpStyle=arc')(l1()),
  },
  {
    name: 'two-way arrow',
    code: 'SD-L05',
    base: l1,
    xml: sub('strokeColor=#2867a6', 'startArrow=classic;strokeColor=#2867a6')(l1()),
  },
  { name: 'forbidden characters', code: 'SD-T01', base: l1, xml: sub('value="Сборщик"', 'value="«Сборщик»"')(l1()) },
  {
    name: 'space dash outside a list',
    code: 'SD-T01',
    base: l1,
    xml: sub('value="Хранение измерений"', 'value="Хранение - измерений"')(l1()),
  },
  {
    name: 'slash between words',
    code: 'SD-T02',
    base: l1,
    xml: sub('value="Хранение измерений"', 'value="Хранение/измерений"')(l1()),
  },
  {
    name: 'calendar date',
    code: 'SD-T03',
    base: l1,
    xml: sub('value="Сборщик"', 'value="Сборщик 13.07.2032"')(l1()),
  },
  {
    name: 'date word form',
    code: 'SD-T03',
    base: l1,
    xml: sub('value="Сборщик"', 'value="Сборщик 5 мая 2026"')(l1()),
  },
  {
    name: 'ipv4 address',
    code: 'SD-T04',
    base: l1,
    xml: sub('value="Сборщик"', 'value="Сборщик 192.0.2.10"')(l1()),
  },
  {
    name: 'value mask left on the sheet',
    code: 'SD-T05',
    base: l1,
    xml: sub('value="Сборщик"', 'value="Сборщик {PROXY_HOST}"')(l1()),
  },
  {
    name: 'reference to a sheet',
    code: 'SD-T06',
    base: l1,
    xml: sub('value="HTTPS (443/TCP)"', 'value="см. лист 5"')(l1()),
  },
  {
    name: 'question to the reader',
    code: 'SD-T07',
    base: l1,
    xml: sub('value="Сборщик"', 'value="Какой порт нужен?"')(l1()),
  },
  {
    name: 'wrong title',
    code: 'SD-H01',
    base: l1,
    xml: sub('value="L1: Общая схема"', 'value="Схема без префикса"')(l1()),
  },
  {
    name: 'missing font',
    code: 'SD-F01',
    base: l1,
    xml: sub(
      'edgeLabel;html=1;align=center;verticalAlign=middle;fontFamily=Arial;fontSize=14',
      'edgeLabel;html=1;align=center;verticalAlign=middle;fontSize=14',
    )(l1()),
  },
  {
    name: 'alien family quoted in the markup',
    code: 'SD-F01',
    base: l1,
    xml: sub(
      'value="Сборщик"',
      'value="&lt;span style=&quot;font-family: &#39;Courier New&#39;;&quot;&gt;Сборщик&lt;/span&gt;"',
    )(l1()),
  },
];

for (const item of cases) {
  test(item.name, () => {
    const retired = item.name === 'reused retired number' ? [2] : [];
    const codes = codesOf('mutant.drawio', item.xml, retired);
    assert.ok(codes.includes(item.code), 'expected ' + item.code + ' in ' + codes.join(','));
    const others = codes.filter((code) => code !== item.code);
    assert.deepEqual(others, [], 'unexpected extra codes: ' + others.join(','));
  });
}

function packageDir(changes: Array<[string, (content: string) => string]> = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-check-'));
  for (const entry of templateFiles()) {
    let content = entry.content;
    for (const [name, change] of changes) {
      if (name === entry.name) content = change(content);
    }
    writeFileSync(join(dir, entry.name), content);
  }
  // The rules page is built by the rules command; these tests look at the template sheets only.
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sheets: Array<{ level: string }> };
  manifest.sheets = manifest.sheets.filter((sheet) => sheet.level !== '');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return dir;
}

/** The legend out of reach: the mark gone and the heading «Легенда» erased, so no search finds it. */
const unmark = (content: string): string =>
  content
    .replace('sdRole=legend;', '')
    .replace('value="Легенда"', 'value=""')
    .replace(/(<mxCell id="n(\d)"[^>]*?)parent="e\2"/gu, '$1parent="1"');

test('check prints blind lines, counts, NOT_CHECKED and the next step', () => {
  const dir = packageDir([['l1.drawio', sub('value="Сборщик"', 'value="токенXYZё"')]]);
  const result = runCheck(dir, false);
  assert.equal(result.code, 1);
  const text = result.lines.join('\n');
  assert.ok(!text.includes('токен'), 'output must be blind: ' + text);
  assert.ok(text.includes('FAIL SD-T01 l1.drawio "Общая схема" id=collector'), text);
  assert.ok(text.includes('SD-T01: 1'), text);
  assert.ok(text.includes('NOT_CHECKED SD-G01'), text);
  assert.ok(result.lines.at(-1)?.startsWith('Дальше:'), text);
});

test('check --json returns the same content without texts', () => {
  const dir = packageDir([['l1.drawio', sub('strokeColor=#2867a6', 'strokeColor=#123456')]]);
  const result = runCheck(dir, true);
  assert.equal(result.code, 1);
  const body = JSON.parse(result.lines.join('')) as { findings: Array<{ code: string; ids: string[] }> };
  assert.deepEqual(
    body.findings.map((found) => found.code),
    ['SD-L02'],
  );
  assert.deepEqual(body.findings[0]?.ids, ['e1']);
});

test('check of the untouched package exits 0', () => {
  const result = runCheck(packageDir(), false);
  assert.equal(result.code, 0);
  assert.equal(result.lines[0], 'NOT_CHECKED SD-G01 (наложения и изломы: проверь глазами)');
  assert.ok(result.lines.at(-1)?.includes("'final'"), result.lines.join('\n'));
});

test('unreadable data is SD-E01 or SD-E02 with exit 65', () => {
  const broken = packageDir();
  writeFileSync(join(broken, 'l2.drawio'), 'not xml at all');
  assert.equal(runCheck(broken, false).code, 65);
  assert.ok(runCheck(broken, false).lines.join('').startsWith('SD-E01'));
  const extra = packageDir();
  writeFileSync(join(extra, 'левый.drawio'), templateFiles()[0]?.content ?? '');
  const result = runCheck(extra, false);
  assert.equal(result.code, 65);
  assert.ok(result.lines.join('').startsWith('SD-E02'), result.lines.join(''));
});

test('a broken manifest.json is still SD-E02', () => {
  const dir = packageDir();
  writeFileSync(join(dir, 'manifest.json'), 'not json at all');
  const result = runCheck(dir, false);
  assert.equal(result.code, 65);
  assert.ok(result.lines.join('').startsWith('SD-E02'), result.lines.join(''));
});

test('a wrong title falls back to the topmost label and reports its id', () => {
  const dir = packageDir([['l1.drawio', sub('value="L1: Общая схема"', 'value=""')]]);
  const result = runCheck(dir, false);
  assert.ok(
    // In the shipped layout the top of the left column is the Internet zone.
    result.lines.some((line) => line.includes('SD-H01') && line.includes('id=zone-devices')),
    result.lines.join('\n'),
  );
});

test('a sheet without any title cell reports id=-', () => {
  const empty = parseDrawio(
    '<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',
  );
  const page = empty.pages[0];
  const findings = page === undefined ? [] : checkSheet(buildModel('empty.drawio', page, profile, []));
  assert.deepEqual(
    findings.map((found) => [found.code, found.ids]),
    [['SD-H01', ['-']]],
  );
});

test('a sheet with no legend to find reports NOT_CHECKED SD-N01 instead of FAIL and exits 2', () => {
  const dir = packageDir([['l3-1.drawio', unmark]]);
  const result = runCheck(dir, false);
  const text = result.lines.join('\n');
  assert.equal(result.code, 2, text);
  assert.ok(
    result.lines.includes(
      'NOT_CHECKED SD-N01 l3-1.drawio "Прием телеметрии" - легенда не найдена: номера и линии проверь глазами',
    ),
    text,
  );
  assert.ok(!result.lines.some((line) => line.startsWith('FAIL')), text);
  assert.ok(
    result.lines.some((line) => /легенда на листе не найдена/i.test(line)),
    text,
  );
  assert.ok((result.lines.at(-1) ?? '').startsWith('Дальше: '), text);
});

test('--json marks the sheet with no legend NOT_CHECKED with the reason legend-not-found', () => {
  const dir = packageDir([['l3-1.drawio', unmark]]);
  const result = runCheck(dir, true);
  assert.equal(result.code, 2);
  const body = JSON.parse(result.lines.join('')) as {
    findings: unknown[];
    notChecked: Array<{ code: string; status: string; reason: string }>;
  };
  assert.deepEqual(body.findings, []);
  const entry = body.notChecked.find((item) => item.code === 'SD-N01');
  assert.equal(entry?.status, 'NOT_CHECKED');
  assert.equal(entry?.reason, 'legend-not-found');
});

test('a sheet with no legend to find still fails the typography rules', () => {
  const dir = packageDir([
    ['l3-1.drawio', (content) => sub('value="Брокер сообщений"', 'value="Брокер сообщений ещё"')(unmark(content))],
  ]);
  const result = runCheck(dir, false);
  const text = result.lines.join('\n');
  assert.equal(result.code, 1, text);
  assert.ok(
    result.lines.some((line) => line.startsWith('FAIL SD-T01 l3-1.drawio')),
    text,
  );
  assert.ok(
    result.lines.some((line) => line.startsWith('NOT_CHECKED SD-N01 l3-1.drawio')),
    text,
  );
});

test('a marked sheet with a duplicate number still fails SD-N01', () => {
  const dir = packageDir([['l3-1.drawio', sub('id="n2" value="2"', 'id="n2" value="1"')]]);
  const result = runCheck(dir, false);
  const text = result.lines.join('\n');
  assert.equal(result.code, 1, text);
  assert.ok(
    result.lines.some((line) => line.startsWith('FAIL SD-N01 l3-1.drawio')),
    text,
  );
});

test('a placeholder the wrapper cannot resolve reports NOT_CHECKED, not silence', () => {
  // "%имя%" without an attribute of that name stays on the sheet exactly as
  // draw.io draws it. Nobody knows what text the reader ends up reading, so the text rules
  // step aside out loud and the run ends on exit 2.
  const dir = packageDir([['l1.drawio', sub(PROXY, proxyObject('label="Сборщик %addr%" placeholders="1"'))]]);
  const result = runCheck(dir, false);
  const text = result.lines.join('\n');
  assert.equal(result.code, 2, text);
  assert.ok(
    result.lines.some((line) => line.startsWith('NOT_CHECKED SD-T05')),
    text,
  );
  assert.ok(!result.lines.some((line) => line.startsWith('FAIL')), text);
});

test('a line with XX no longer buys the rest of the line out of the rules', () => {
  // A mask does not exempt the rest of the line, which
  // still answers every rule T03..T07.
  const proxy = (value: string): string[] => codesOf('mutant.drawio', sub('value="Сборщик"', value)(l1()));
  assert.deepEqual(proxy('value="Сборщик 198.51.100.7 (шлюз XX.XX.XX.XX)"'), ['SD-T04']);
  assert.deepEqual(proxy('value="Сборщик 192.0.2.40."'), ['SD-T04'], 'a sentence dot after an address is allowed');
  assert.deepEqual(proxy('value="Сборщик 192.0.2.XX"'), ['SD-T04'], 'three real octets and a hole is an address');
  assert.deepEqual(proxy('value="Сборщик 13.07.2032 XX"'), ['SD-T03'], 'the date behind the hole still reads');
  const reference = codesOf('mutant.drawio', sub('value="HTTPS (443/TCP)"', 'value="см. лист 3 XX"')(l1()));
  assert.deepEqual(reference, ['SD-T06'], 'the page reference behind the hole still reads');
  assert.deepEqual(proxy('value="Сборщик XX.XX.XX.XX"'), [], 'the fully unknown address stays the allowed hole');
});

test('every SD-N01 reason says its own word, and only the gap talks about retired', () => {
  const dup = packageDir([['l1.drawio', sub('id="n2" value="2"', 'id="n2" value="1"')]]);
  const dupText = runCheck(dup, false).lines.join('\n');
  const dupLine = runCheck(dup, false).lines.find((line) => line.includes('дубль'));
  assert.ok(dupLine !== undefined, dupText);
  assert.ok(!dupLine.includes('retired'), 'the retired hint belongs to the gap only: ' + dupLine);

  const gap = packageDir([['l1.drawio', sub('id="n2" value="2"', 'id="n2" value="4"')]]);
  const gapResult = runCheck(gap, false);
  const gapText = gapResult.lines.join('\n');
  assert.ok(gapText.includes('FAIL SD-N01 l1.drawio "Общая схема" id=n2 - пропуск:'), gapText);
  assert.ok(gapText.includes('manifest.json'), gapText);
});

test('each hint names the command and the key that really cure the defect', () => {
  // A hint a model cannot run is no hint: every line names text set / style set / fix with real keys.
  const issueLines = (change: (content: string) => string): string =>
    runCheck(packageDir([['l1.drawio', change]]), false)
      .lines.filter((line) => /^(FAIL|WARN) /.test(line))
      .join('\n');
  const dashed = issueLines(sub('strokeColor=#2867a6', 'dashed=1;strokeColor=#2867a6'));
  assert.ok(/WARN SD-L01.*рекомендация по оформлению.*style set <файл> <id> dashed=0/u.test(dashed), dashed);
  const thick = issueLines(sub('strokeWidth=2;strokeColor=#2867a6', 'strokeWidth=3;strokeColor=#2867a6'));
  assert.ok(/FAIL SD-L03.*style set <файл> <id> strokeWidth=/u.test(thick), thick);
  const arrow = issueLines(sub('strokeColor=#2867a6', 'startArrow=classic;strokeColor=#2867a6'));
  assert.ok(/FAIL SD-L05.*style set <файл> <id> startArrow=none/u.test(arrow), arrow);
  const font = issueLines(sub('fontFamily=Arial', 'fontFamily=Courier New'));
  assert.ok(/FAIL SD-F01.*text set без разметки шрифта/u.test(font), font);
});

test('the next step offers fix --safe only when it really cures a failing code', () => {
  // An N01 gap is nobody's typographic error: fix --safe would only rename the number.
  const gap = packageDir([['l1.drawio', sub('id="n2" value="2"', 'id="n2" value="4"')]]);
  const gapRun = runCheck(gap, false);
  assert.equal(gapRun.code, 1);
  const gapFurther = gapRun.lines.at(-1) ?? '';
  assert.ok(gapFurther.startsWith('Дальше: node '), gapFurther);
  assert.ok(gapFurther.includes("'check'"), gapFurther);
  assert.ok(!gapFurther.includes(' #'), 'the Дальше line stays a bare command: ' + gapFurther);
  assert.ok(
    gapRun.lines.some((line) => line.includes('Правь по подсказке в строках выше') && !line.startsWith('Дальше: ')),
    gapRun.lines.join('|'),
  );
  assert.ok(!gapFurther.includes("'fix' '--safe'"), gapFurther);

  const typo = packageDir([['l1.drawio', sub('value="Сборщик"', 'value="value=Сборщик ё"')]]);
  const typoRun = runCheck(typo, false);
  const typoFurther = typoRun.lines.at(-1) ?? '';
  assert.equal(typoFurther, `Дальше: node '${CLI_PATH}' 'fix' '--safe' '${typo}'`);
  const warningAt = typoRun.lines.findIndex((line) => line.includes('если пакет уже отправлялся на проверку'));
  assert.ok(warningAt >= 0 && warningAt < typoRun.lines.length - 1, typoRun.lines.join('|'));
});

test('a folder without sheets is NOT_CHECKED with a next step, not a silent zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-no-sheets-'));
  const result = runCheck(dir, false);
  const text = result.lines.join('\n');
  assert.equal(result.code, 2, text);
  assert.ok(text.includes('в папке нет листов'), text);
  assert.ok(text.includes("'init'"), 'the next step says how to make a package: ' + text);
});

test('a folder without manifest.json gives NOT_CHECKED SD-H01 and no FAIL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-nomanifest-'));
  writeFileSync(join(dir, 'l1.drawio'), l1());
  const result = runCheck(dir, false);
  const text = result.lines.join('\n');
  assert.equal(result.code, 2, text);
  assert.ok(
    result.lines.includes(
      'NOT_CHECKED SD-H01 l1.drawio "Общая схема" - нет manifest.json: префикс заголовка неизвестен',
    ),
    text,
  );
  assert.ok(!result.lines.some((line) => line.startsWith('FAIL')), text);
});
