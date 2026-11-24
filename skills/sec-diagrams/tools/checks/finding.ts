/**
 * What a check reports: a FAIL with the ids of the cells that broke the rule, and a NOT_CHECKED
 * with a machine reason for a rule that could not read what it needs. A reason is static text;
 * a label from the sheet is never quoted in it, only its id is named - check prints blind.
 */
import type { PageModel } from './model.ts';

export interface Finding {
  code: string;
  file: string;
  page: string;
  ids: string[];
  count: number;
  status: 'FAIL' | 'WARN' | 'NOT_CHECKED';
  /** Machine-readable cause for --json, e.g. "legend-not-found". */
  reasonKey: string;
  /** Static reason text; a label from the sheet never enters it. */
  reason: string;
}

export const finding = (code: string, model: PageModel, ids: string[], count?: number): Finding => ({
  code,
  file: model.file,
  page: model.page,
  ids: [...new Set(ids)].sort(),
  count: count ?? new Set(ids).size,
  status: 'FAIL',
  reasonKey: '',
  reason: '',
});

export const AUTHOR_ADVICE = 'рекомендация по оформлению';

export const authorAdvice = (issue: Finding): Finding => ({
  ...issue,
  status: 'WARN',
  reason: AUTHOR_ADVICE,
});

/** Machine-readable reasons for --json. */
export const LEGEND_NOT_FOUND_KEY = 'legend-not-found';
export const NO_MANIFEST_KEY = 'no-manifest';
/** The reason text the legend-dependent codes carry when the sheet holds no legend to read. */
export const LEGEND_NOT_FOUND_REASON = 'легенда не найдена: номера и линии проверь глазами';
/** The reason text SD-H01 carries when the package has no manifest.json. */
export const NO_MANIFEST_REASON = 'нет manifest.json: префикс заголовка неизвестен';

export const notCheckedFinding = (
  code: string,
  model: PageModel,
  reasonKey: string,
  reason: string,
  ids: string[] = [],
): Finding => ({
  code,
  file: model.file,
  page: model.page,
  ids: [...new Set(ids)].sort(),
  count: new Set(ids).size === 0 ? 1 : new Set(ids).size,
  status: 'NOT_CHECKED',
  reasonKey,
  reason,
});
