/**
 * What the reader really sees of a wrapper cell: draw.io replaces "%имя%" in the label and in
 * the tooltip by the attribute of the same name when the wrapper says placeholders="1", and the
 * tooltip is one hover away from the reader anyway. A name with no attribute of that name stays
 * on the sheet exactly as draw.io draws it; the cell is then noted as unresolved, so the text
 * rules report NOT_CHECKED instead of guessing an unknown label.
 */
import type { Cell } from '../drawio.ts';

/** A substitution name: like draw.io, we take a word starting with a letter between two "%". */
const PLACEHOLDER = /%([\p{L}][\p{L}\p{N}_.-]*)%/gu;

/**
 * The label plus the tooltip of a cell, with the wrapper's own attributes substituted in. The
 * ids of cells whose substitution could not be made are pushed onto `unresolved`.
 */
/** The substitution name of the label itself and the wrapper's plumbing: not free text. */
const SERVICE_ATTRS = new Set(['label', 'placeholders', 'id', 'link', 'tooltip']);

/**
 * The label plus the tooltip plus the wrapper's own free attributes, with the wrapper's own
 * attributes substituted in. draw.io keeps Edit Data attributes like "ip" or "note" on the
 * wrapper, and the reader reaches them the same way as the tooltip, so they join the sheet text
 * for the text rules. The ids of cells whose substitution could not be made are
 * pushed onto `unresolved`.
 */
export function wrapperText(cell: Cell, unresolved: string[]): string {
  const attrs = cell.attrs;
  const shown = [cell.value];
  if (attrs['tooltip'] !== undefined && attrs['tooltip'] !== '') shown.push(attrs['tooltip']);
  for (const name of Object.keys(attrs).sort()) {
    if (SERVICE_ATTRS.has(name)) continue;
    const value = attrs[name];
    if (value !== undefined && value !== '') shown.push(value);
  }
  if (attrs['placeholders'] !== '1') return shown.join('\n');
  const missing = new Set<string>();
  const text = shown
    .map((part) =>
      part.replaceAll(PLACEHOLDER, (whole: string, name: string): string => {
        const value = attrs[name];
        if (value !== undefined) return value;
        missing.add(name);
        return whole;
      }),
    )
    .join('\n');
  if (missing.size > 0) unresolved.push(cell.id);
  return text;
}

/**
 * What the reader sees on the plate: the label with the wrapper's placeholders substituted, and
 * nothing else. A number is recognized by this text - an Edit Data attribute may say anything,
 * the plate says one digit; the text rules keep reading the whole wrapperText, where
 * the same attributes join the sheet.
 */
export function visibleLabel(cell: Cell): string {
  const attrs = cell.attrs;
  if (attrs['placeholders'] !== '1') return cell.value;
  return cell.value.replaceAll(PLACEHOLDER, (whole: string, name: string): string => attrs[name] ?? whole);
}
