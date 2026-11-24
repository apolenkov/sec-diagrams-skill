/** Check label text and the different address conventions of working and sending copies. */
import { type Finding, type PageModel, finding, notCheckedFinding } from './model.ts';
import { styleValue } from '../drawio.ts';
import { hasAddress, PATHS, withoutWhole } from './addresses.ts';

/** A line of the connection list: "14. доступ ..."; the number reaches 999. */
const LIST_LINE = /^\d{1,3}\. /u;
/** A list drawn as HTML markup: the items carry no visible number in the plain text. */
const LIST_MARKUP = /<(?:ol|ul|li)\b/iu;
/** A placeholder mask of addresses and nets: XX, XX.XX, up to XX.XX.XX.XX. */
const MASK_DOTTED = /(?<![\p{L}\p{N}_])X{2}(?:\.X{2}){1,3}(?![\p{L}\p{N}_])/gu;
/** A lone XX: one hole for a value the services fill in. */
const MASK_SINGLE = /(?<![\p{L}\p{N}_])X{2}(?![\p{L}\p{N}_])/gu;
/** A bracketed hole "[уточнить]": the text inside is nobody's answer yet. */
const BRACKETED = /\[[^\]]*\]/gu;
/** In the title the counter stands inside the text ("L3, лист 1 из 2: Доступ"), and only there. */
const PAGE_COUNTER_ANY = /лист\s+\d+\s+из\s+\d+/giu;
/** The footer line that explains the notation; SD-T07 exempts it. */
export const FOOTER_TEXT =
  'Владельцы данных заменяют [поле] и XX.XX.XX.XX перед отправкой. Знак ? рядом со значением отмечает допущение.';

const BEFORE = '(?<![.\\p{L}\\p{N}_])';
/** A sentence dot may close a date or a reference; a dot with a digit after it continues a version or an address. */
const AFTER = '(?![\\p{L}\\p{N}_])(?!\\.\\d)';
const START = '(?<![\\p{L}\\p{N}_])';
const END = '(?![\\p{L}\\p{N}_])';
const DAY = '(?:0?[1-9]|[12]\\d|3[01])';
const MONTH = '(?:0?[1-9]|1[0-2])';
/**
 * A date is a real day, a real month and a full four-digit year: versions like "Nexus 3.76.10"
 * and "Keycloak 26.0.12" carry a two-digit part or no valid month, and "4 узла 6443" names no
 * month at all. The year may close with "г." the way a Russian sheet writes it.
 */
const YEAR_SUFFIX = '(?:\\s*г(?:од|\\.))?';
const dateDots = new RegExp(BEFORE + DAY + '\\.' + MONTH + '\\.\\d{4}' + YEAR_SUFFIX + AFTER, 'gu');
const dateSlash = new RegExp(BEFORE + DAY + '/' + MONTH + '/\\d{4}' + YEAR_SUFFIX + AFTER, 'gu');
const dateIso = new RegExp(BEFORE + '\\d{4}-(?:0[1-9]|1[0-2])-' + DAY + YEAR_SUFFIX + AFTER, 'gu');
/** Month names: the genitive case a Russian date uses, and the dotted abbreviations. */
const MONTH_NAME =
  'январ[яя]|феврал[яя]|марта|апрел[яя]|мая|июня|июл[яя]|августа|сентябр[яя]|октябр[яя]|ноябр[яя]|декабр[яя]';
const MONTH_ABBR = 'янв\\.|февр\\.|феврал\\.|мар\\.|апр\\.|июн\\.|июл\\.|авг\\.|сент\\.|окт\\.|нояб\\.|дек\\.';
const dateWords = new RegExp(
  BEFORE + DAY + '\\s+(?:' + MONTH_NAME + '|' + MONTH_ABBR + ')\\s+\\d{4}' + YEAR_SUFFIX + AFTER,
  'giu',
);
/** A page reference in any case it is written: "лист 3", "на листе 3", "листа 2", "лист №2". */
const pageRef = new RegExp(
  BEFORE + '(?:лист(?:а|у|е|ов|ах|ами|ы)?|стр(?:\\.|ица|ицы|ице))\\s+№?\\s*\\d+' + AFTER,
  'giu',
);
/** A value mask "{ИМЯ}": the package builder fills only the masks the profile lists. */
const MASK_TEXT = /\{[^{}\n]+\}/gu;

/** Characters flagged by the default label check. */
const FORBIDDEN_CHARS = /[ёЁ—–−«»·①②③④⑤✦]/u;
const DASH_SPACED = / - /u;
const PORTS_AND_NETS =
  /(?<![\p{L}\p{N}_])\d+\/(?:tcp|udp)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:\d{1,3}|X{1,2})(?:\.(?:\d{1,3}|X{1,2})){3}\/(?:\d{1,2}|N{1,2}|X{1,2})(?![\p{L}\p{N}_])/giu;
const WORD_SLASH = /[A-Za-zА-Яа-яЁё]+\s*\/\s*[A-Za-zА-Яа-яЁё]+/gu;

const QUESTION_MARKERS = new RegExp(START + 'вопрос(?:а|у|е|ы)?\\s*\\d+|\\([ВB]\\d+\\)|уточняется|\\?{2,}', 'iu');
/** A choice between two names is a note about the setup, it asks the reader nothing. */
const CHOICE_QUESTION = new RegExp(START + 'или' + END + '.*\\?', 'iu');
/**
 * Words that ask: any case of them anywhere in the line counts, but only together with the
 * closing "?" - a label like "Как сейчас" or "Что согласуем" names nothing to answer. "Это"
 * asks the same way: "Это отдельный VPN?" waits for a yes.
 */
const QUESTION_WORDS =
  'зачем|почему|кто|что|чем|где|куда|откуда|когда|сколько|верно|чей|чья|чьи|чье|как[а-яё]{0,4}|это';
const QUESTION_FORM = new RegExp(START + '(?:' + QUESTION_WORDS + ')' + END, 'iu');
/** "Кто: администраторы" names the reader's group, it asks nothing even with a "?" around. */
const LABEL_COLON = new RegExp('^\\s*(?:\\d+\\.\\s*)?(?:' + QUESTION_WORDS + ')\\s*:', 'iu');
const ASK_VERBS =
  'уточните|подтвердите|нужно|нужен|нужна|нужны|можно|следует|использовать|включать|открывать|' +
  'разрешить|согласовать|добавить|удалить|выбрать|должен|должны';
const ASK_VERB = new RegExp(START + '(?:' + ASK_VERBS + ')' + END, 'iu');
/** The particle "ли" asks by itself; inside "или" the leading letter keeps it silent. */
const PARTICLE_LI = /(?<![\p{L}])ли(?![\p{L}])/iu;
/**
 * A bare Cyrillic word closing the line on the mark asks the reader: "Согласуете?", "Подключим
 * позже?". A latin token before the mark is the notation's own assumption ("Туннель IPsec?"),
 * and a value before the mark is an assumption too - the space form is cut above.
 */
const BARE_QUESTION = /(?:\p{sc=Cyrillic}[\p{sc=Cyrillic}]+)\?\s*$/u;
/**
 * «Шлюз: МЭ?» - за двоеточием стоит значение, и знак в конце такой строки отметка допущения
 * про это значение, а не вопрос читателю. Вопросами остаются строки, на которые
 * отвечает одна из веток выше: вопросительный оборот, глагол или «или» за двоеточием.
 */
const LABEL_VALUE_QUESTION =
  /^[\p{L}][\p{L}\p{N} ._#-]*:\s*[\p{L}][\p{L}\p{N}._-]*(?:\s+[\p{L}][\p{L}\p{N}._-]*)*\?\s*$/u;

const tested = (pattern: RegExp, line: string): boolean => ((pattern.lastIndex = 0), pattern.test(line));

function lineAsks(line: string, includeBare = true): boolean {
  const plain = line.replace(/\[[^\]]*\]/gu, '[поле]');
  const trimmed = plain.trim();
  if (trimmed === '' || trimmed === '?') return false;
  // A label opening with the mark asks about its value: "? порт".
  if (trimmed.startsWith('?')) return true;
  // "метка: ?" and "значение ?" are the assumption marks the notation allows after a value.
  if (/[:;,]\s*\?\s*$/u.test(trimmed) || /\s\?\s*$/u.test(trimmed)) return false;
  // A list line is "purpose - protocol" (or the other way round on older sheets): a choice
  // question counts only inside one side, so "к ВМ 1 или 2 - SSH (22/TCP)?" asks nothing.
  const sides = LIST_LINE.test(plain) ? plain.split(' - ') : [plain];
  if (sides.some(side => CHOICE_QUESTION.test(side) && (includeBare || /\?\s*$/u.test(side)))) return true;
  if (LABEL_COLON.test(trimmed)) return false;
  if (PARTICLE_LI.test(trimmed)) return true;
  // Everything else needs the mark at the end of the very line: never of the joined cell.
  if (!/\?\s*$/u.test(trimmed)) return false;
  // A list line splits into sides above: its tail "N. purpose - назначение?" is the notation's
  // assumption about the purpose, never a question to the reader.
  if (LIST_LINE.test(plain)) return false;
  return (
    tested(QUESTION_FORM, trimmed) ||
    tested(ASK_VERB, trimmed) ||
    /(?:^|\s)(?:согласуете|подтвердите|пришлете|пришлёте|разрешите)\?$/iu.test(trimmed) ||
    (includeBare && BARE_QUESTION.test(trimmed) && !LABEL_VALUE_QUESTION.test(trimmed))
  );
}

/** Word slashes "прокси/МЭ" in a whole label. */
export function slashCount(text: string): number {
  const plain = text.replaceAll(PATHS, ' ').replaceAll(PORTS_AND_NETS, ' ');
  return [...plain.matchAll(WORD_SLASH)].filter((match) => match[0].toLowerCase().replaceAll(' ', '') !== 'tcp/udp')
    .length;
}

/** a question to the reader, judged line by line, not an assumption marked with "?". */
export function asksReader(text: string): boolean {
  if (QUESTION_MARKERS.test(text)) return true;
  return text.split('\n').some(line => lineAsks(line));
}

/** The line without its placeholder holes: masks, lone XX and bracketed notes are cut out. */
const withoutMasks = (line: string): string =>
  line.replaceAll(MASK_DOTTED, ' ').replaceAll(MASK_SINGLE, ' ').replaceAll(BRACKETED, ' ');

/** Per-line verdict for one code. Dates and page references read the line with holes cut out. */
function lineHit(code: string, line: string, masks: string[], isFinal: boolean, isTitle = false): boolean {
  switch (code) {
    case 'SD-T01':
      return tested(FORBIDDEN_CHARS, line) || tested(DASH_SPACED, line);
    case 'SD-T03': {
      const rest = withoutMasks(line);
      return tested(dateDots, rest) || tested(dateSlash, rest) || tested(dateIso, rest) || tested(dateWords, rest);
    }
    case 'SD-T04':
      return hasAddress(isFinal ? withoutWhole(line.replaceAll(PATHS, ' ')) : line);
    case 'SD-T05':
      return [...line.matchAll(MASK_TEXT)].some((match) => !masks.includes(match[0]));
    case 'SD-T06': {
      // Only the title may carry the sheet's own counter: «лист 2 из 3» standing in ordinary
      // body text reads as a reference to another sheet, and the reader takes it for one
      //.
      const cleared = withoutMasks(line).replace(isTitle ? PAGE_COUNTER_ANY : /^$/, ' ');
      return tested(pageRef, cleared);
    }
    default:
      return false;
  }
}

const CODES = ['SD-T01', 'SD-T02', 'SD-T03', 'SD-T04', 'SD-T05', 'SD-T06', 'SD-T07'];

/**
 * The reason key SD-T04 carries in a copy for sending: there the code no longer says "an address
 * on a sheet that only models read", it says "this address is not filled in or is wrong".
 */
export const FINAL_ADDRESS_KEY = 't04-final-address';
/** SD-T05 in its NOT_CHECKED form: a "%имя%" substitution the wrapper cannot resolve. */
export const PLACEHOLDER_UNRESOLVED_KEY = 'placeholder-unresolved';
const PLACEHOLDER_UNRESOLVED_REASON = 'подстановка %имя% не найдена в атрибутах: текст не проверен';

function hasHit(
  code: string,
  text: string,
  masks: string[],
  inLegend: boolean,
  isFinal: boolean,
  listLike = false,
  isTitle = false,
): boolean {
  if (code === 'SD-T07') return text !== FOOTER_TEXT && asksReader(text);
  if (code === 'SD-T02') return slashCount(text) > 0;
  if (code === 'SD-T01') {
    // " - " is allowed on a list line, on the continuation of a wrapped item (draw.io wraps a
    // long "N. purpose - protocol" at any width), on a line of an HTML list and on a legend
    // definition line - nowhere else. Once a list has started, every later line belongs to it.
    let inList = listLike;
    return text.split('\n').some((line) => {
      const numbered = LIST_LINE.test(line);
      const bad = !(inLegend || numbered || inList) && tested(DASH_SPACED, line);
      inList = numbered || inList;
      return tested(FORBIDDEN_CHARS, line) || bad;
    });
  }
  return text.split('\n').some((line) => lineHit(code, line, masks, isFinal, isTitle));
}

/**
 * Cells a code looks at: every text cell of the page. The legend holds free-worded footnotes
 * (references/notation.md), so a date, a page reference, an unknown mask or a question inside
 * it is as real as anywhere else; notation samples are exempt by their own form (a value with
 * "?", the footer line explaining "?"), not by living inside the legend frame.
 */

/**
 * The codes T01..T07 that hit one text, judged exactly as checkText judges a cell. The `rules`
 * command pre-checks the free texts of poc.yaml with it, so a bad value stops the build instead
 * of surfacing later as a finding on a sheet nobody wrote by hand.
 */
export function textHitCodes(text: string, masks: string[], isFinal = false, isTitle = false): string[] {
  return CODES.filter((code) => hasHit(code, text, masks, false, isFinal, false, isTitle));
}

/** Runs T01..T07 over one page. */
export function checkText(model: PageModel): Finding[] {
  const findings: Finding[] = [];
  for (const code of CODES) {
    const ids = model.labels
      .filter((cell) =>
        hasHit(
          code,
          cell.text,
          model.profile.masks,
          cell.inLegend,
          model.final,
          LIST_MARKUP.test(cell.raw),
          cell.id === model.title?.id || styleValue(cell.style, 'sdRole') === 'title',
        ),
      )
      .map((cell) => cell.id);
    if (ids.length === 0) continue;
    if (code === 'SD-T07' && model.legacySubmission) {
      // Old sheets use a trailing question mark on unconfirmed values, even on
      // whole noun phrases. Only wording that actually asks the reader is conclusive.
      const ambiguous = new Set(model.labels.filter(cell => !QUESTION_MARKERS.test(cell.text) &&
        !cell.text.split('\n').some(line => lineAsks(line, false))).map(cell => cell.id));
      const review = ids.filter(id => ambiguous.has(id));
      if (review.length) findings.push(notCheckedFinding(code, model, 't07-assumption-or-question',
        'сверь со смыслом подписи: вопрос перенеси в письмо, предположение после значения допускается', review));
      const questions = ids.filter(id => !ambiguous.has(id));
      if (questions.length) findings.push(finding(code, model, questions));
      continue;
    }
    const found = finding(code, model, ids);
    // In a copy for sending SD-T04 no longer means "an address here", it means "a broken one".
    // The reason belongs to T04 alone: the other codes keep their own reason and the person's
    // hand.
    if (model.final && code === 'SD-T04') found.reasonKey = FINAL_ADDRESS_KEY;
    findings.push(found);
  }
  // A "%имя%" without the attribute of that name stands on the sheet as draw.io drew it, and
  // nobody knows what text the reader ends up reading: the value-mask code says it out loud
  // as NOT_CHECKED instead of letting the other text rules judge a text that is not final.
  if (model.unresolvedPlaceholders.length > 0) {
    findings.push(
      notCheckedFinding(
        'SD-T05',
        model,
        PLACEHOLDER_UNRESOLVED_KEY,
        PLACEHOLDER_UNRESOLVED_REASON,
        model.unresolvedPlaceholders,
      ),
    );
  }
  return findings;
}
