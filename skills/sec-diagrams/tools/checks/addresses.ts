/**
 * Address rules of SD-T04 (split out of text.ts for the size of the file): what counts as an
 * address in either copy, and what a whole address token is in a copy for sending. The reading
 * is described in the header of text.ts.
 */

/** Paths and URLs are opaque for the address and slash rules alike. */
export const PATHS = /(?<![\p{L}\p{N}_.])(?:https?:\/\/|[A-Za-z]:[\\/]|\/)[^\s<>"']+/gu;

/**
 * One part of an address: digits, a latin or Cyrillic XX hole, a single x, an asterisk, a
 * bracketed field or a "?" - the spellings of "services fill this in" on a real sheet.
 */
const ADDRESS_PART = '(?:\\d{1,3}|X{2}|[xX*]|[Хх]{1,2}|\\[[^\\]]*\\]|\\?)';
/**
 * An address: four parts, dots between, at least one part with digits (the fully unknown
 * XX.XX.XX.XX is the hole the rule wants). A part may not continue into digits, letters or
 * another XX; a dot at the end is a sentence dot while no digits follow it.
 */
const address = new RegExp(
  '(?<![\\p{N}._X])(' +
    ADDRESS_PART +
    '(?:\\.' +
    ADDRESS_PART +
    '){3})(?![\\p{L}\\p{N}_X])(?!\\.(?:\\d|X{2}[\\p{N}_]))',
  'gu',
);
/** One part of a whole address: 0 to 255, no leading garbage and no digit left after it. */
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d{2}|[0-9]?\\d)';
/** A whole mask: /0 to /32, and no digit left after it. */
const MASK = '(?:3[0-2]|[12]?\\d)';
/** A mask written as a dotted netmask: «/255.255.255.0»; the octets are read for size below. */
const NETMASK_DOTTED = '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}';
/** A range end: one octet or a second whole address, «192.0.2.10-20» and «192.0.2.10-192.0.2.20». */
const RANGE_END = '(' + OCTET + '(?:\\.' + OCTET + '){3}|' + OCTET + ')';
/**
 * A whole address token, the form the reviewer asks for in a copy for sending: four parts of 0 to 255, an
 * optional mask (short or dotted) and an optional range end. The tail guard refuses any mask or
 * range the pattern above did not swallow - «/», «/33», «-8» after «.10» never leave a "valid"
 * address behind - and refuses the tail of a five-part address («198.51.100.0.1» is nobody's
 * quarter of a network), so withoutWhole strips whole tokens only and every broken one stays on
 * the line for hasAddress to report.
 */
const wholeToken = new RegExp(
  '(?<![\\p{N}._X])(' +
    OCTET +
    '(?:\\.' +
    OCTET +
    '){3})(?:/(?:(' +
    NETMASK_DOTTED +
    ')|(' +
    MASK +
    ')))?(?:-(' +
    RANGE_END +
    '))?(?![\\p{L}\\p{N}_X-])(?!\\.(?:\\d|X))(?!/)',
  'gu',
);
/** Five dot-separated parts of digits: neither an address nor a version the reviewer draws; always T04. */
const FIVE_PART = new RegExp('(?<![\\p{N}._X-])(?:\\d{1,3}\\.){4}\\d{1,3}(?![\\p{L}\\p{N}_])', 'gu');

/**
 * In a copy for sending the whole addresses are what the sheet must show: only those are cut
 * out, and a token whose mask or range does not hold is not whole either. Everything broken - a
 * half-filled address, a part over 255, an empty or oversized mask, a range end over 255 or
 * below its start, digits mixed into XX parts - stays on the line, where hasAddress reports it
 * as SD-T04.
 */
const asNumber = (dotted: string): number => dotted.split('.').reduce((total, part) => total * 256 + Number(part), 0);

const maskHolds = (dotted: string): boolean => {
  const parts = dotted.split('.');
  if (!parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)) return false;
  // a mask is a run of ones from the left edge, nothing after the first zero.
  // 255.0.255.0 has ones again after a zero - no such mask exists, and the value reads broken.
  return /^1*0*$/u.test(parts.map((part) => Number(part).toString(2).padStart(8, '0')).join(''));
};

export function withoutWhole(line: string): string {
  return line.replaceAll(wholeToken, (whole, ...rest) => {
    const source = rest[0] as string;
    const dottedMask = rest[1] as string | undefined;
    const plainMask = rest[2] as string | undefined;
    const end = rest[3] as string | undefined;
    if (dottedMask !== undefined && !maskHolds(dottedMask)) return whole;
    if (plainMask !== undefined && Number(plainMask) > 32) return whole;
    if (end === undefined) return ' ';
    const endValue = asNumber(end.includes('.') ? end : source.slice(0, source.lastIndexOf('.')) + '.' + end);
    return endValue >= asNumber(source) ? ' ' : whole;
  });
}

/**
 * An address is a hit only while at least one of its parts carries digits. A URL is opaque for
 * this rule in both copies: «http://filter.example.org/rules/192.0.2.10/» is a configuration string
 * the services write whole, its address is not a value the reviewer fills in. A run of
 * five parts reads as an address anywhere: it is broken in either copy.
 */
export const hasAddress = (line: string): boolean => {
  const plain = line.replaceAll(PATHS, ' ');
  address.lastIndex = 0;
  FIVE_PART.lastIndex = 0;
  if (FIVE_PART.test(plain)) return true;
  return [...plain.matchAll(address)].some((match) => /\d/u.test(match[0] ?? ''));
};
