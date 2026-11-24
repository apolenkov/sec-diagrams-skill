/** Report unresolved placeholders or obsolete open marks in copies for sending. */
import { finding, notCheckedFinding, type Finding, type PageModel } from './model.ts';
import { FOOTER_TEXT } from './text.ts';

/**
 * A hole a service still has to fill: XX, a dotted mask of them with an optional mask length, a
 * bracketed field, a "?" standing in for a value, and a reserved example host. Boundaries are
 * explicit: JS \b does not see Cyrillic, and the dot is named too, so a part of a half-filled
 * address («203.0.XX.10») stays the business of SD-T04 and only a hole of its own reads as one
 * here. The question mark keeps its own lookbehind: «IPsec?» is an assumption, «тип VPN: ?» is
 * a hole; after a "?" no letter may stand, so a lone mark and a mark in a phrase both count.
 */
const STUB = /(?<![\p{L}\p{N}._])X{2}(?:\.X{2})*(?![\p{L}\p{N}._])|(?<![\p{L}\p{N})\]])\?(?![\p{L}\p{N}_])/iu;
// Inventory worksheets put the field name in brackets until the service supplies its value.
const INVENTORY_FIELDS = new Set([
  'поле', 'имя', 'имена', 'имя пула', 'имя группы', 'имена пулов', 'имена сборки', 'домен',
  'адрес', 'адреса и маски', 'подсеть', 'маска', 'шлюз', 'порт', 'порт хоста', 'порт коммутатора',
  'порт контроллера', 'порт мэ', 'коммутатор:порт', 'хост:порт', 'коммутаторы сети хранения',
  'модель', 'версия', 'версии', 'название', 'номер', 'номера', 'номер заявки', 'id', 'id управления',
  'тип', 'тип шлюза', 'зона', 'протокол', 'протокол vdi', 'объем', 'место и способ', 'срок', 'число',
  'перечень адресов', 'количество', 'параметры', 'перечень', 'белый список', 'где', 'устройство',
  'механизм', 'путь', 'система', 'консоль', 'идентификатор', 'способ', 'компоненты',
]);
const BRACKET_FIELD = /\[([^\[\]\n]+)\]/gu;
/**
 * Reserved example hosts left over from a template. The name is read as a whole label and case
 * does not matter: "REGISTRY.EXAMPLE.ORG" is the template host in caps, while
 * "archive.example.org.test" is a different suffix, used to test the label boundary.
 */
const STUB_HOST = /(?<![\p{L}\p{N}_-])example\.(?:org|com|net|invalid)(?![\p{L}\p{N}_-])(?!\.[\p{L}\p{N}])/iu;

/** The second kind of SD-T08: a cell marked open that no longer holds a hole. */
export const OPEN_FILLED_KEY = 't08-open-filled';

export const hasStub = (text: string): boolean => STUB.test(text) || STUB_HOST.test(text) ||
  [...text.matchAll(BRACKET_FIELD)].some(match => INVENTORY_FIELDS.has((match[1] ?? '').trim().toLowerCase()));

/** Cells outside the legend that hold a hole, by id; the footer line explains holes, it is not one. */
const stubIds = (model: PageModel): Set<string> =>
  new Set(
    model.labels
      .filter((cell) => !cell.inLegend && cell.text !== FOOTER_TEXT && hasStub(cell.text))
      .map((cell) => cell.id),
  );

/**
 * Both halves of SD-T08 over one page, and nothing at all on a working copy: there every address
 * fails SD-T04 and a hole is the form the sheet is meant to keep. The "sdRole=open" mark excuses a
 * hole - the value is named in the letter instead - but it never excuses a broken address, which
 * is SD-T04's alone.
 */
export function checkFinal(model: PageModel): Finding[] {
  if (!model.final) return [];
  const holes = stubIds(model);
  const open = [...model.open].sort();
  const closed = [...holes].filter((id) => !model.open.has(id));
  const filled = open.filter((id) => !holes.has(id));
  const findings: Finding[] = [];
  // A reserved example host is a template artifact even in an old submission.
  // Only unknowns a service can fill later need documentary evidence from the letter.
  const examples = new Set(model.labels.filter(cell => STUB_HOST.test(cell.text)).map(cell => cell.id));
  const review = model.legacySubmission ? closed.filter(id => !examples.has(id)) : [];
  const failures = model.legacySubmission ? closed.filter(id => examples.has(id)) : closed;
  if (failures.length) findings.push(finding('SD-T08', model, failures));
  if (review.length) findings.push(notCheckedFinding('SD-T08', model, 't08-letter-needed',
    'сверь каждое поле с письмом: кто даст значение и когда; без основания это дефект', review));
  if (filled.length > 0) findings.push({ ...finding('SD-T08', model, filled), reasonKey: OPEN_FILLED_KEY });
  return findings;
}
