import { hasStub } from './checks/final.ts';
import { textHitCodes } from './checks/text.ts';
import { ProfileError } from './profile.ts';
import { WHITELIST_FIELDS, type Poc, type PocRow, type PocWhite } from './rules-page-schema.ts';

const EMPTY_FIELD = '[поле]';
const UNKNOWN_ADDRESS = 'XX.XX.XX.XX';

export const RULES_COLUMNS = ['Связь L3', 'Политика', 'Служба', 'Получатель', 'Источник', 'Обоснование'];
export const RULES_WIDTHS = [156, 140, 216, 342, 342, 418];

export const WHITE_COLUMNS = ['Цель доступа', 'Имя DNS', 'Инициатор'];
export const WHITE_WIDTHS = [660, 510, 444];

const filled = (value: string | undefined, fallback: string): string => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? fallback : trimmed;
};

/**
 * One token of the port field: a port or a dash range, optionally already carrying its protocol
 * ("443/TCP"). Spaces around the dash are readable YAML ("8000 - 8100"): they close up
 *. Anything else is not a port, and the field path says where.
 */
const PORT_TOKEN = /^(\d+)(?:-(\d+))?$/u;
/** The protocols the sheet knows; the row's proto, and a port's own suffix in a smaller set. */
const PROTOCOLS = ['TCP', 'UDP', 'TCP/UDP', 'ICMP'];
const PORT_PROTOS = ['TCP', 'UDP'];

/** The protocol set is closed, ports live in 1-65535 and ranges run upward. */
function checkPortBounds(lo: number, hi: number | undefined, place: string): void {
  const out = (value: number): boolean => !Number.isInteger(value) || value < 1 || value > 65535;
  if (out(lo) || (hi !== undefined && out(hi)))
    throw new ProfileError('poc.yaml: ' + place + '.port: порт вне 1-65535');
  if (hi !== undefined && hi < lo) throw new ProfileError('poc.yaml: ' + place + '.port: диапазон не по возрастанию');
}

/**
 * "22" with "tcp" reads "22/TCP"; "80, 443" reads "80/TCP, 443/TCP"; a range stays one token.
 * "53" with "TCP/UDP" reads "53/TCP, 53/UDP" - both protocols on one port.
 * Tokens split on comma and semicolon only - a space inside "8000 - 8100" belongs to the range,
 * not to a separator. A token that already names the protocol does not name it
 * twice; a token that names another protocol keeps its own: the port line knows better than the
 * row default. ICMP has no ports at all and reads as the single word.
 */
export function portsCell(port: string, proto: string, place: string): string {
  const wanted = proto.trim().toUpperCase();
  if (wanted === '') throw new ProfileError('poc.yaml: ' + place + '.proto пустой');
  if (!PROTOCOLS.includes(wanted))
    throw new ProfileError('poc.yaml: ' + place + '.proto: протокол не из набора TCP, UDP, TCP/UDP, ICMP');
  const parts = port
    .split(/[;,]+/u)
    .map((token) => token.trim().replace(/\s*-\s*/gu, '-'))
    .filter((token) => token !== '');
  if (wanted === 'ICMP') {
    if (parts.length > 0) throw new ProfileError('poc.yaml: ' + place + '.port: у ICMP порта нет');
    return 'ICMP';
  }
  if (parts.length === 0) throw new ProfileError('poc.yaml: ' + place + '.port пустой');
  return parts
    .flatMap((token) => {
      const [value, ...named] = token.split('/');
      const portValue = (value ?? '').trim();
      const bounds = PORT_TOKEN.exec(portValue);
      if (bounds === null) throw new ProfileError('poc.yaml: ' + place + '.port: не порт и не диапазон');
      const lo = Number(bounds[1]);
      const hi = bounds[2] === undefined ? undefined : Number(bounds[2]);
      checkPortBounds(lo, hi, place);
      const protocols = named.map((name) => name.trim().toUpperCase());
      const protocol = protocols.join('/');
      if (protocol === '')
        return wanted === 'TCP/UDP' ? [portValue + '/TCP', portValue + '/UDP'] : [portValue + '/' + wanted];
      // "53/TCP/UDP" names both protocols of one port; any other second name is a slip.
      const both = protocols.length === 2 && protocols.includes('TCP') && protocols.includes('UDP');
      if (both) return [portValue + '/TCP', portValue + '/UDP'];
      if (protocols.length !== 1 || !PORT_PROTOS.includes(protocol))
        throw new ProfileError('poc.yaml: ' + place + '.port: протокол у порта не из набора TCP, UDP');
      return [portValue + '/' + protocol];
    })
    .join(', ');
}

function endpoint(row: PocRow, side: 'src' | 'dst') {
  const open = new Set(row.open);
  const parts = [
    { text: row[side], open: false },
    { text: row[`${side}_fqdn`] ?? (open.has(`${side}_fqdn`) ? EMPTY_FIELD : ''),
      open: open.has(`${side}_fqdn`) },
    { text: row[`${side}_addr`] ?? (open.has(`${side}_addr`) ? UNKNOWN_ADDRESS : ''),
      open: open.has(`${side}_addr`) },
  ];
  const marked = parts.some(part => part.open);
  return {
    value: parts.map(part => part.text).filter(Boolean).join('\n'),
    marked,
    // A cell-level mark must not hide a second, undeclared hole in the same endpoint.
    invalid: marked && parts.some(part => part.open !== hasStub(part.text)),
  };
}

export function whiteRowValues(entry: PocWhite): string[] {
  return WHITELIST_FIELDS.map(field => filled(entry[field], EMPTY_FIELD));
}

export function whiteRowOpenFlags(entry: PocWhite): boolean[] {
  const open = new Set(entry.open);
  return WHITELIST_FIELDS.map(field => open.has(field));
}

export function ruleLinkText(link: PocRow['link']): string {
  return Array.isArray(link) ? link.join(', ') : link ?? 'Без ссылки';
}

export function ruleRow(row: PocRow, place: string) {
  const src = endpoint(row, 'src');
  const dst = endpoint(row, 'dst');
  return {
    values: [
      ruleLinkText(row.link),
      row.action === 'deny' ? 'Запретить' : 'Разрешить',
      portsCell(row.port ?? '', row.proto, place),
      dst.value,
      src.value,
      filled(row.purpose, EMPTY_FIELD),
    ],
    marks: [false, false, false, dst.marked, src.marked, false],
    invalidOpen: src.invalid || dst.invalid,
  };
}

/** Check the text that will appear on the sheet. Diagnostics identify the row without its values. */
export function pocTextProblems(poc: Poc, masks: string[], isFinal: boolean): string[] {
  const problems: string[] = [];
  const add = (place: string, texts: string[]): void => {
    for (const code of [...new Set(texts.flatMap((text) => textHitCodes(text, masks, isFinal)))]) {
      problems.push(code + ' ' + place);
    }
  };
  poc.tables.forEach((table, ti) => {
    const caption = 'Из зоны "' + table.from + '" в зону "' + table.to + '"';
    add('таблица ' + (ti + 1), [caption]);
    table.rows.forEach((row, ri) => {
      const place = 'таблица ' + (ti + 1) + ' строка ' + (ri + 1);
      const rendered = ruleRow(row, 'tables.' + ti + '.rows.' + ri);
      add(place, rendered.values);
      if (isFinal && rendered.invalidOpen) problems.push('SD-T08 ' + place);
    });
  });
  poc.whitelist.forEach((entry, index) => {
    add('белый список строка ' + (index + 1), whiteRowValues(entry));
  });
  poc.notes.forEach((note, index) => {
    add('заметка ' + (index + 1), [note.text]);
  });
  return problems;
}
