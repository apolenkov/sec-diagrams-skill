/** Evaluator-side only. Compare an isolated model output with the original case fixture. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve } from 'node:path';
import { parseDrawio, styleValue } from '../tools/drawio.ts';
import { isRulesSheet, packageFileName, loadManifest, loadProfile } from '../tools/profile.ts';
import { loadPoc } from '../tools/rules-page-schema.ts';
import { RULES_SHEET_FILE, renderSheet } from '../tools/rules-page.ts';
import { boxCentre, polylineDistance } from '../tools/checks/geometry.ts';
import { buildModel } from '../tools/checks/model.ts';
import { labelText } from '../tools/label.ts';
import { LETTER_FILE } from '../tools/letter.ts';
import { SHEETS_DIR, mergedPdfName, packetDirOf } from '../tools/pack-names.ts';
import { COPY_MARKER } from '../tools/values-guard.ts';

const [name = '', output = '', one] = process.argv.slice(2);
const original = join(import.meta.dirname, name, 'files');
const dir = resolve(output);
const read = (file: string) => readFileSync(file, 'utf8');
const results = new Map<number, boolean>();
function score(n: number, pass: boolean) {
  results.set(n, pass);
}
const ip = /\b\d{1,3}(?:\.\d{1,3}){3}\b/u;
function sheets() {
  const file = loadManifest(original).sheets[0]!.file;
  return [parseDrawio(read(join(original, file))), parseDrawio(read(join(dir, file)))] as const;
}

function diagrams() {
  const [before, after] = sheets();
  const page = after.pages[0]!;
  const orig = before.pages[0]!;
  const current = new Map(page.cells.map(cell => [cell.id, cell]));
  const originalIds = new Set(orig.cells.map(cell => cell.id));
  const geometry = (sheet: typeof page, id: string) => {
    const el = sheet.source.targets.get(id)?.styleHost.children.find(child => child.name === 'mxGeometry');
    return el ? sheet.source.text.slice(el.tagStart, el.selfClosing ? el.tagEnd : sheet.source.text.indexOf('>', el.innerEnd) + 1) : '';
  };
  const oldIds = orig.cells.every(cell => current.has(cell.id));
  const sameGeometry = oldIds && orig.cells.every(cell => geometry(orig, cell.id) === geometry(page, cell.id));
  const edges = page.cells.filter(cell => cell.edge);
  const values = page.cells.map(cell => labelText(cell.value));
  const jumps = (style: string) => ['rounded', 'jumpStyle', 'jumpSize'].every((key, i) =>
    styleValue(style, key) === ['1', 'arc', '12'][i]);
  if (name === 'fix-seeded-defects') {
    score(1, oldIds && current.size === originalIds.size && after.pages.length === before.pages.length);
    score(2, sameGeometry);
    score(3, values.every(value => !/[ёЁ«»—–]/u.test(value)));
    score(4, values.every(value => !ip.test(value)));
    score(6, edges.every(edge => /^#(?:ad3b31|237a53|754bb0|2867a6|000000|64748b)$/iu.test(styleValue(edge.style, 'strokeColor') ?? '#000000')));
    score(7, edges.every(edge => jumps(edge.style)) && page.cells.filter(cell => cell.value).every(cell =>
      ['Arial', 'Times New Roman'].includes(styleValue(cell.style, 'fontFamily') ?? '')));
    return;
  }
  const added = edges.filter(cell => !originalIds.has(cell.id));
  const edge = added[0];
  const model = buildModel('L3', page, loadProfile(), [3, 4]);
  score(1, sameGeometry);
  score(2, added.length === 1 && current.get(edge!.source)?.value === 'Шлюз датчиков' &&
    current.get(edge!.target)?.value === 'Сборщик');
  const style = edge?.style ?? '';
  const arrows = ['startArrow', 'endArrow'].map(key => styleValue(style, key) ?? 'none').filter(value => value !== 'none');
  score(3, added.length === 1 && jumps(style) && styleValue(style, 'strokeColor')?.toLowerCase() === '#2867a6' && arrows.length === 1);
  score(4, !!edge && !values.includes('3') && !values.includes('4') && model.badges.some(b => b.value === 6 && b.edges.includes(edge.id)));
  const route = edge && model.polylines.get(edge.id);
  const firstId = model.badges.find(b => b.value === 1)?.edges[0];
  const first = firstId && model.polylines.get(firstId);
  score(6, !!route && model.labels.some(label => label.visible === 'HTTPS (9443/TCP)' &&
    (current.get(label.id)?.parent === edge?.id || (label.box !== null && polylineDistance(boxCentre(label.box), route) <= 20))));
  // Positive length on the same horizontal line is an overlap; a shared endpoint is fine.
  const overlaps = route && first && route.slice(1).some((b, i) => first.slice(1).some((d, j) => {
    const a = route[i]!, c = first[j]!;
    return a.y === b.y && a.y === c.y && c.y === d.y &&
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
  }));
  const anchors = ['exitX', 'exitY', 'entryX', 'entryY'].every(key => {
    const value = styleValue(style, key);
    return value !== undefined && value.trim() !== '' && Number(value) >= 0 && Number(value) <= 1;
  });
  score(9, !!route && route.length > 2 && !!first && anchors && !overlaps);
}

function rules() {
  const path = join(dir, RULES_SHEET_FILE);
  score(1, existsSync(path));
  if (!existsSync(path)) {
    for (const n of [2, 3, 4, 5]) score(n, false);
    return;
  }
  const poc = loadPoc(join(original, 'poc.yaml'));
  const actual = parseDrawio(read(path));
  const values = actual.pages.flatMap(page => page.cells.map(cell => labelText(cell.value).replaceAll('\u200b', '')));
  const ports = poc.tables.flatMap(table => table.rows.map(row => row.port!));
  score(2, ports.every(port => values.some(value => new RegExp('\\b' + port + '\\b').test(value))));
  score(3, poc.whitelist.every(entry => values.some(value => value.includes(entry.name!))));
  score(4, values.every(value => !ip.test(value)));
  // Compare the grid on each physical page. Captions alone, missing body cells or a
  // continuation without its header give a different signature.
  const profile = loadProfile();
  const grid = (sheet: typeof actual) => sheet.pages.map(page =>
    buildModel(RULES_SHEET_FILE, page, profile, []).allCells
      .filter(cell => {
        const fill = styleValue(cell.style, 'fillColor');
        return styleValue(cell.style, 'strokeColor') === '#000000' &&
          (fill === '#F2F2F2' || fill === '#FFFFFF');
      })
      .map(cell => [cell.box, cell.text, styleValue(cell.style, 'fillColor')]));
  const expected = parseDrawio(renderSheet(poc, loadManifest(original).titlePrefix).xml);
  score(5, expected.pages.length > 1 && isDeepStrictEqual(grid(actual), grid(expected)));
}

function firewallLink() {
  const files = ['l3.drawio', 'manifest.json'];
  const unchanged = files.every(file => read(join(dir, file)) === read(join(original, file)));
  const expected = loadPoc(join(original, 'poc.yaml'));
  const actual = loadPoc(join(dir, 'poc.yaml'));
  const awaitingClarification = isDeepStrictEqual(actual, expected);
  expected.tables[0]!.rows[0]!.link = 'L3-1:2'; // Gateway events are carried by MQTT.
  const row = actual.tables[0]?.rows[0];
  if (row && Array.isArray(row.link) && row.link.length === 1) row.link = row.link[0]!;
  score(1, unchanged && (awaitingClarification || isDeepStrictEqual(actual, expected)));
}

function packet() {
  const packet = packetDirOf(dir);
  const manifest = loadManifest(original);
  const included = manifest.sheets.filter(sheet => !isRulesSheet(sheet));
  const draw = join(packet, SHEETS_DIR);
  const names = existsSync(draw) ? readdirSync(draw).map(n => n.normalize('NFC')).sort() : [];
  const title = mergedPdfName(manifest.service, included.length);
  const expected = included.map(packageFileName).sort();
  const note = join(dir, LETTER_FILE);
  const entries = existsSync(packet) ? readdirSync(packet).filter(n => n !== COPY_MARKER).sort() : [];
  score(1, isDeepStrictEqual(entries, [SHEETS_DIR, title].sort()) && isDeepStrictEqual(names, expected));
  score(2, names.length === included.length && names.every(n => /.+__L(?:[12]|3(?:-\d+)?)\.drawio$/u.test(n)));
  score(3, !existsSync(join(packet, LETTER_FILE)) && existsSync(note) &&
    readFileSync(note).equals(readFileSync(join(original, LETTER_FILE))));
  const path = dir + '-pdf/чек-лист.md';
  const checklist = existsSync(path) ? read(path) : '';
  score(5, checklist.includes('## Состав пакета') && !checklist.includes(LETTER_FILE) &&
    /NIST SP 800-41 Rev\. 1, §/u.test(checklist) && /RFC 3022, §/u.test(checklist));
  score(7, isDeepStrictEqual(names, expected) && included.every(sheet =>
    readFileSync(join(draw, packageFileName(sheet))).equals(readFileSync(join(original, sheet.file)))));
}

try {
  if (!output) throw Error('expected case and output folder');
  if (name === 'package-for-review') packet();
  else if (name === 'rules-page-from-yaml') rules();
  else if (name === 'firewall-link-dangling') firewallLink();
  else if (name === 'fix-seeded-defects' || name === 'resend-new-connection') diagrams();
  else throw Error('unknown case');
  if (one && !results.has(Number(one))) throw Error('unknown assertion');
  for (const [id, pass] of results) {
    if (one && Number(one) !== id) continue;
    console.log(String(id).padStart(2, '0'), pass ? 'PASS' : 'FAIL');
    if (!pass) process.exitCode = 1;
  }
} catch {
  console.error('FAIL: missing or unreadable case input or output');
  process.exitCode = 1;
}
