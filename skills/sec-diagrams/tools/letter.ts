/** Cover note and diagnostics that identify unfinished fields without printing their values. */
export const LETTER_FILE = 'записка.txt';

const PROMPTS = ['Что проверено', 'Что изменилось', 'Что приложено'];
const placeholders = PROMPTS.map(prompt => '[' + prompt + ']');
const MASK_TEXT = /\{[^{}\n]+\}/gu;

export interface LetterIssue {
  code: 'SD-W02' | 'SD-W05';
  lines: number[];
}

export function checkLetter(text: string, masks: readonly string[]): LetterIssue[] {
  const missing = new Set<number>();
  const fields = new Set<string>();
  const unknownMasks: number[] = [];
  const known = new Set(masks);
  text.split('\n').forEach((line, index) => {
    const field = PROMPTS.find(prompt => line.startsWith(prompt + ':'));
    const value = field === undefined ? '' : line.slice(field.length + 1).trim();
    const placeholder = line.includes('[поле]') || placeholders.some(token => line.includes(token));
    if (placeholder || (field !== undefined && (value === '' || /^\[[^\]]+\]$/u.test(value) || fields.has(field)))) {
      missing.add(index + 1);
    } else if (field !== undefined) {
      fields.add(field);
    }
    if ([...line.matchAll(MASK_TEXT)].some(match => !known.has(match[0]))) unknownMasks.push(index + 1);
  });
  if (fields.size < PROMPTS.length && missing.size === 0) missing.add(1);
  const issues: LetterIssue[] = [];
  if (missing.size > 0) issues.push({ code: 'SD-W02', lines: [...missing] });
  if (unknownMasks.length > 0) issues.push({ code: 'SD-W05', lines: unknownMasks });
  return issues;
}

export function letterIssueLine(issue: LetterIssue): string {
  const hint = issue.code === 'SD-W02' ? 'заполни три поля по references/letter.md' : 'проверь маску по профилю';
  return 'FAIL ' + issue.code + ' ' + LETTER_FILE + ': строка ' + issue.lines.join(', ') + ' - ' + hint;
}

export function letterSkeleton(): string {
  return PROMPTS.map(prompt => prompt + ': [поле]').join('\n\n') + '\n';
}
