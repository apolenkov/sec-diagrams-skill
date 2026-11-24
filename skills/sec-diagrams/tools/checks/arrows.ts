/** Read arrow styles and paired source and target geometry. */
import { styleValue } from '../drawio.ts';

const NONE_ARROWS = new Set(['none', 'open', 'oval', 'none;']);

/** Whether the edge ends in an arrow head. */
export function hasArrow(style: string): boolean {
  const end = styleValue(style, 'endArrow');
  if (end === undefined) return true;
  return !NONE_ARROWS.has(end.toLowerCase());
}
