import { MANUAL_FIX, CAUSES, HINTS, REASON_HINTS } from './check-hints.ts';
import type { Finding } from './checks/model.ts';
import { FINAL_ADDRESS_KEY } from './checks/text.ts';
import { OPEN_FILLED_KEY } from './checks/final.ts';

/** Wording of one finding for the check report, split out of check.ts for the size cap. */

/**
 * Advice in a copy for sending: the agent names no editor command - values are a person's pen,
 * no fix runs over the folder, and "open" is the agent's command too.
 * A reason with its own copy wording keeps it; everything else ends with the person's hand.
 */
const COPY_REASONS: Record<string, string> = {
  [FINAL_ADDRESS_KEY]:
    'адрес заполнен не до конца или с ошибкой: значения в копии для отправки правит человек в draw.io',
  [OPEN_FILLED_KEY]: 'значение заполнено, а отметка осталась: отметку снимает человек в draw.io',
};

export function adviceFor(found: Finding, copy: boolean, rulesFile: string): string {
  // The rules sheet is not drawn by hand: its cells come from poc.yaml, so both the hole and its
  // open mark are closed in the yaml and the sheet is rebuilt.
  if (found.file === rulesFile && found.code === 'SD-T08') {
    return copy
      ? 'значение или поле open в poc.yaml копии, затем rules --force'
      : 'значение или поле open в poc.yaml, затем rules --force';
  }
  if (found.code === 'SD-R01') return found.reason;
  if (copy) {
    if (found.reasonKey !== '' && COPY_REASONS[found.reasonKey] !== undefined)
      return COPY_REASONS[found.reasonKey] as string;
    const cause = found.reasonKey === '' ? undefined : CAUSES[found.reasonKey];
    return (cause === undefined ? '' : cause.word + ': ') + 'правит человек в draw.io (references/resend.md)';
  }
  const cause = found.reasonKey === '' ? undefined : CAUSES[found.reasonKey];
  return cause === undefined
    ? (REASON_HINTS[found.reasonKey] ?? HINTS[found.code] ?? 'смотри references/rules.md')
    : cause.word + ': ' + cause.hint;
}

export function printFinding(found: Finding, copy: boolean, canFix: boolean, rulesFile: string): string {
  const hint = found.status === 'WARN' && found.code === 'SD-L02' && !copy
    ? 'запрещенную связь можно обозначить крестом без номера'
    : ((!copy && !canFix ? MANUAL_FIX[found.code] : undefined) ?? adviceFor(found, copy, rulesFile));
  const advice = found.status === 'WARN' ? found.reason + '. ' + hint : hint;
  const ids = found.ids.length > 0 ? found.ids : ['-'];
  const file = found.file.normalize('NFC');
  return ids
    .map((id) => found.status + ' ' + found.code + ' ' + file + ' "' + found.page + '" id=' + id + ' - ' + advice)
    .join('\n');
}

export function printNotChecked(found: Finding): string {
  // The line carries its own reason and the cells it speaks about: the reader needs no other
  // hint to find them.
  const ids = found.ids.length > 0 ? ' id=' + found.ids.join(',') : '';
  return 'NOT_CHECKED ' + found.code + ' ' + found.file.normalize('NFC') + ' "' + found.page + '"' + ids + ' - ' + found.reason;
}
