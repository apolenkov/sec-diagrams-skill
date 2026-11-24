/** Read the visible fill and stroke from draw.io style strings. */
import { styleValue } from '../drawio.ts';
import type { PageLabel } from './model.ts';

/** A style that ends in the bare "text" shape: such a cell has no frame and no fill of its own. */
const hasTextToken = (style: string): boolean => style.split(';').some((segment) => segment.trim() === 'text');

/** An unset fill is white, the fill of a text shape is transparent. */
export const isWhiteFill = (style: string): boolean => {
  const raw = styleValue(style, 'fillColor') ?? (hasTextToken(style) ? 'none' : '#ffffff');
  const fill = raw.toLowerCase();
  return fill === '#ffffff' || fill === '#fff' || fill === 'white' || fill === '';
};

/** a stroke that is neither "" nor none, with a positive width. */
export const hasVisibleBorder = (style: string): boolean => {
  const color = styleValue(style, 'strokeColor');
  if (color === undefined && hasTextToken(style)) return false;
  if (color !== undefined && (color === '' || color.toLowerCase() === 'none')) return false;
  const width = Number(styleValue(style, 'strokeWidth') ?? '1');
  return !Number.isFinite(width) || width > 0;
};

/** Number marker style: 1..99 in at most two digits, white fill, visible border. */
export const isNumberStyle = (label: PageLabel, text: string): boolean =>
  label.box !== null &&
  Number(text) >= 1 &&
  Number(text) <= 99 &&
  text.length <= 2 &&
  isWhiteFill(label.style) &&
  hasVisibleBorder(label.style);

const WHITE = new Set(['#ffffff', '#fff', 'white']);

/**
 * A number typed into a line : a double click in draw.io stores it as the
 * value of the edge and paints a white plate with a border under it. Without that paint a
 * stray digit on a line is not a number a reader trusts - it stays a label.
 */
export const isEdgeNumberLabel = (style: string, text: string): boolean => {
  const plate = styleValue(style, 'labelBackgroundColor') ?? '';
  const border = styleValue(style, 'labelBorderColor') ?? '';
  return (
    Number(text) >= 1 &&
    Number(text) <= 99 &&
    text.length <= 2 &&
    WHITE.has(plate.toLowerCase()) &&
    border !== '' &&
    border.toLowerCase() !== 'none'
  );
};
