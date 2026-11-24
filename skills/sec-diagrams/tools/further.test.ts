import { pdfTestOptions } from './pdf-fixtures.ts';
/**
 * The "Дальше:" protocol: every run ends with one clean command, notes live above it, and the
 * command runs identically in an interactive zsh (comments off) and in zsh -c. Sheets are
 * synthetic; addresses are from RFC 5737.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli, type CliResult } from './cli.ts';
import { runPdf } from './pdf.ts';
import { fakePdf, LETTER } from './sending-fixtures.ts';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');
const rmDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });
function tempDir(prefix: string): string {
  // macOS resolves /var to /private/var in a child process cwd; compare canonical paths.
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

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

/** One zsh run of a command line; interactive zsh (-f -i) has comments OFF by default. */
function zshStdout(args: string[], input?: string): string {
  return spawnSync('/bin/zsh', args, { input, encoding: 'utf8' }).stdout;
}

const SIMPLE_POC = [
  'sheet: "Карта сетевой фильтрации"',
  'tables:',
  '  - from: "Рабочий контур"',
  '    to: "Мониторинг"',
  '    rows:',
  '      - src: "Узел"',
  '        dst: "Приемник"',
  '        port: "443"',
  '        proto: "TCP"',
  '        purpose: "Сбор ёмкостей мониторинга"',
  'whitelist: []',
  'notes: []',
].join('\n');

async function collectPackageSteps(pkg: string, dir: string, collect: (result: CliResult) => void): Promise<void> {
  const yaml = join(pkg, 'poc.yaml');
  collect(runCli(['rules', yaml]));
  const pdf = runPdf(pkg, { exportSheet: (_source, output) => fakePdf(output) });
  assert.equal(pdf.code, 0, pdf.lines.join('\n'));
  collect(pdf);
  writeFileSync(join(pkg, 'записка.txt'), LETTER);
  const packed = runCli(['pack', pkg, '--with-letter']);
  assert.equal(packed.code, 0, packed.lines.join('\n'));
  collect(packed);

  const sheet = join(pkg, 'l1.drawio');
  const copy = join(dir, 'copy');
  for (const args of [
    ['text', 'get', sheet, 'zone-devices'],
    ['text', 'set', sheet, 'zone-devices', 'Сеть'],
    ['style', 'set', sheet, 'zone-devices', 'fontFamily=Arial'],
    ['open', sheet, 'zone-devices'],
    ['open', '--undo', sheet, 'zone-devices'],
    ['final', pkg, copy],
  ]) {
    const result = runCli(args);
    assert.equal(result.code, 0, result.lines.join('\n'));
    collect(result);
  }
  collect(runCli(['final', pkg, copy]));
}

test('every Дальше: line is one clean command and survives an interactive zsh', { skip: (await pdfTestOptions()).skip || process.platform === 'win32' || !existsSync('/bin/zsh') }, async (t) => {
  const savedDrawio = process.env['SD_DRAWIO'];
  process.env['SD_DRAWIO'] = '/nonexistent';
  t.after(() => {
    if (savedDrawio === undefined) delete process.env['SD_DRAWIO'];
    else process.env['SD_DRAWIO'] = savedDrawio;
  });
  const dir = tempDir('sd-further-');
  t.after(() => rmDir(dir));
  const collected: CliResult[] = [];
  const collect = (result: CliResult): void => {
    const last = result.lines.at(-1) ?? '';
    // A run ends with one executable "Дальше:" or with the person's
    // manual step under its own label - never with a fake command.
    assert.ok(last.startsWith('Дальше: ') || last.startsWith('Человеку: '), JSON.stringify(result.lines));
    collected.push(result);
  };

  writeFileSync(join(dir, 'sheet.drawio'), FIX_SHEET);
  collect(runCli(['check', dir]));
  collect(runCli(['fix', '--safe', dir]));

  const broken = tempDir('sd-further-broken-');
  t.after(() => rmDir(broken));
  writeFileSync(join(broken, 'broken.drawio'), `<!DOCTYPE mxfile>${TWO_PAGES}`);
  collect(runCli(['check', broken]));

  const pkg = join(dir, "pkg's! (1)");
  collect(runCli(['init', pkg]));
  collect(runCli(['check', pkg]));
  collect(runCli(['pdf', pkg]));
  collect(runCli(['pack', pkg, '--with-letter']));

  const bad = tempDir('sd-further-rules-');
  t.after(() => rmDir(bad));
  writeFileSync(join(bad, 'poc.yaml'), SIMPLE_POC);
  collect(runCli(['rules', join(bad, 'poc.yaml')]));
  writeFileSync(join(bad, 'poc2.yaml'), SIMPLE_POC.replace('port: "443"', 'port: 443'));
  collect(runCli(['rules', join(bad, 'poc2.yaml')]));

  await collectPackageSteps(pkg, dir, collect);
  collect(runCli(['nope']));
  collect(runCli(['check']));

  const further = collected.flatMap((result) => result.lines.filter((line) => line.startsWith('Дальше:')));
  assert.ok(further.length >= 9, 'every runnable scenario earned its Дальше: line');
  for (const line of further) {
    const command = line.slice('Дальше: '.length);
    const parsed = spawnSync('/bin/zsh', ['-f', '-n', '-c', command], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, command + ': ' + parsed.stderr);
    assert.ok(command.startsWith('node '), 'expected a CLI command: ' + command);
    assert.ok(!line.includes(' #'), 'no comment tail in ' + line);
    assert.ok(!line.includes(' ; '), 'one step per line in ' + line);
  }

  const t01 = collected[0];
  assert.ok(t01 !== undefined);
  const warning = t01.lines.findIndex((line) => line.includes('уже отправлялся на проверку'));
  const command = t01.lines.findIndex((line) => line.startsWith('Дальше: '));
  assert.ok(
    warning >= 0 && warning < command,
    'the resend warning comes before the fix command: ' + t01.lines.join('\n'),
  );

  for (const line of [...new Set(further)]) {
    const command = line.slice('Дальше: '.length);
    // Only the read-only commands run for real: pack, rules and init would change the folder
    // between the two shells and the comparison would measure the change, not the parsing.
    if (!command.startsWith('node ') || !/'(check|pdf)'/.test(command)) continue;
    assert.equal(
      zshStdout(['-f', '-i'], command + '\n'),
      zshStdout(['-c', command]),
      'interactive zsh must parse the Дальше line like zsh -c: ' + command,
    );
  }

  // The probe proves the check bites: a `# хвост` would reach interactive zsh as arguments.
  const probe = `node '${CLI_PATH}' 'check' '${dir}' # хвост`;
  assert.notEqual(
    zshStdout(['-f', '-i'], probe + '\n'),
    zshStdout(['-c', probe]),
    'a comment tail is not transparent to interactive zsh',
  );
});
