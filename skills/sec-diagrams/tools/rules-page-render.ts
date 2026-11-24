/**
 * The page layout and the XML writer of the «Карта сетевой фильтрации» sheet, split out of
 * rules-page.ts (the file-size cap): geometry constants, cell styles, the page planner and the
 * mxfile printer. rules-page.ts builds the blocks; this file puts them on pages.
 *
 * Reference canvas 2480x1754, this sheet 1654x1169 (A3 landscape); every reference size comes
 * through scaled().
 */
import { setStyleKey } from './drawio.ts';
import { ProfileError } from './profile.ts';

export const PAGE_W = 1654;
const PAGE_H = 1169;
const SCALE = PAGE_W / 2480;
const scaled = (value: number): number => Math.round(value * SCALE);
export const MARGIN = scaled(30);
export const CONTENT_W = PAGE_W - 2 * MARGIN;
export const TITLE_Y = scaled(14);
export const TITLE_H = scaled(43);
export const CONTENT_TOP = scaled(80);
const CAPTION_H = scaled(26);
export const CAPTION_SPACE = scaled(32);
const TABLE_GAP = scaled(16);
const NOTE_GAP = scaled(8);
export const NOTE_PAD = scaled(4);
export const WRAP_PAD = scaled(14);
export const BOTTOM = PAGE_H - 20;

export const TITLE_FONT = 20;
const CAPTION_FONT = 14;
export const CELL_FONT = 13;
export const LINE_HEIGHT = Math.round(1.25 * CELL_FONT);
export const CELL_PX = (10.2 * CELL_FONT) / 18;
export const NOTE_PX = (9.4 * CELL_FONT) / 18;
export const ROW_PAD = 10;
const textBase = (size: number): string => 'html=1;fontFamily=Arial;fontColor=#000000;fontSize=' + size + ';';
const CELL_BASE =
  'rounded=0;whiteSpace=wrap;' +
  textBase(CELL_FONT) +
  'strokeColor=#000000;strokeWidth=1;align=left;verticalAlign=middle;spacing=4;sdRole=rules;';
const HEAD_STYLE = CELL_BASE + 'fillColor=#F2F2F2;fontStyle=1;';
const BODY_STYLE = CELL_BASE + 'fillColor=#FFFFFF;';
const CAPTION_STYLE =
  'text;whiteSpace=wrap;strokeColor=none;fillColor=none;align=left;verticalAlign=top;spacing=0;fontStyle=1;' +
  textBase(CAPTION_FONT) +
  'sdRole=rules;';
const NOTE_STYLE =
  'text;whiteSpace=wrap;strokeColor=none;fillColor=none;align=left;verticalAlign=top;spacing=0;' +
  textBase(CELL_FONT) +
  'sdRole=rules;';
export const TITLE_STYLE =
  'text;whiteSpace=wrap;align=center;verticalAlign=top;strokeColor=none;fillColor=none;fontStyle=1;sdRole=title;' +
  textBase(TITLE_FONT);

export interface HeadCell {
  value: string;
  x: number;
  w: number;
  h: number;
}

export interface Placed {
  value: string;
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TableBlock {
  kind: 'table';
  caption: string;
  headCells: HeadCell[];
  headerH: number;
  widths: number[];
  rows: string[][];
  /** Per row and column: put the sdRole=open mark on this cell (poc.yaml row "open"). */
  marks: boolean[][];
  linkColumn?: number;
  heights: number[];
  place: string;
}

export interface NoteBlock {
  kind: 'note';
  text: string;
  /** The note declares itself open in poc.yaml: the cell carries the sdRole=open mark. */
  open?: boolean;
  height: number;
  place: string;
}

export type Block = TableBlock | NoteBlock;

/** Places blocks on pages: whole tables first, splitting only tables longer than a page. */
export function layoutBlocks(blocks: Block[]): Placed[][] {
  const pages: Placed[][] = [];
  let cells: Placed[] = [];
  let y = CONTENT_TOP;
  const newPage = (): void => {
    pages.push(cells);
    cells = [];
    y = CONTENT_TOP;
  };
  const add = (value: string, style: string, x: number, w: number, h: number): void => {
    cells.push({ value, style, x, y, w, h });
  };
  // The open mark replaces the page's own sdRole=rules pair on that one cell: the page keeps its
  // rules mark on every other cell, and SD-T08 reads the mark from the cell it stands on.
  const addRow = (values: string[], widths: number[], h: number, marks: boolean[], linkColumn?: number): void => {
    let x = MARGIN;
    values.forEach((value, index) => {
      const w = widths[index] ?? 0;
      let style = marks[index] === true ? setStyleKey(BODY_STYLE, 'sdRole', 'open') : BODY_STYLE;
      if (index === linkColumn) style += 'ruleColumn=link;';
      add(value, style, x, w, h);
      x += w;
    });
  };
  for (const block of blocks) {
    if (block.kind === 'note') {
      if (y + block.height > BOTTOM) newPage();
      // A note that poc.yaml declared open carries the mark the letter lists.
      add(
        block.text,
        block.open === true ? setStyleKey(NOTE_STYLE, 'sdRole', 'open') : NOTE_STYLE,
        MARGIN,
        CONTENT_W,
        block.height,
      );
      y += block.height + NOTE_GAP;
      continue;
    }
    const total = CAPTION_SPACE + block.headerH + block.heights.reduce((sum, height) => sum + height, 0);
    if (y + total > BOTTOM && CONTENT_TOP + total <= BOTTOM) newPage();
    let i = 0;
    while (i < block.rows.length) {
      if (y + CAPTION_SPACE + block.headerH + (block.heights[i] ?? 0) > BOTTOM) {
        if (y === CONTENT_TOP) throw new ProfileError('poc.yaml: ' + block.place + ' не помещается на страницу');
        newPage();
      }
      add(block.caption, CAPTION_STYLE, MARGIN, CONTENT_W, CAPTION_H);
      y += CAPTION_SPACE;
      for (const head of block.headCells) {
        cells.push({
          value: head.value,
          style: HEAD_STYLE,
          x: head.x,
          y,
          w: head.w,
          h: head.h,
        });
      }
      y += block.headerH;
      while (i < block.rows.length && y + (block.heights[i] ?? 0) <= BOTTOM) {
        addRow(block.rows[i] ?? [], block.widths, block.heights[i] ?? 0, block.marks[i] ?? [], block.linkColumn);
        y += block.heights[i] ?? 0;
        i += 1;
      }
      if (i < block.rows.length) newPage();
    }
    y += TABLE_GAP;
  }
  newPage();
  return pages;
}

export const escapeAttr = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#10;');

/**
 * Cell values land in html=1 cells: draw.io reads the attribute back as HTML, so a '<' in the
 * text must survive two readings - HTML first, then XML. Escaping the html-escaped
 * text for the attribute is exactly the second escape. In an html=1 cell a <wbr> is planted after
 * every dot and dash: draw.io then ends the line there, and a 37-letter FQDN stays inside its
 * column; the reader's checks strip the mark the same way they strip a <br>.
 */
const escapeCellValue = (text: string, htmlCell: boolean): string => {
  const html = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const wrapped = htmlCell ? html.replaceAll('.', '.<wbr>').replaceAll('-', '-<wbr>') : html;
  return escapeAttr(wrapped);
};

export const pageSuffix = (index: number, total: number): string =>
  index === 0 ? '' : ', лист ' + (index + 1) + ' из ' + total;

export function fileXml(pages: Array<{ name: string; cells: Placed[] }>): string {
  let n = 0;
  const cellXml = (cell: Placed): string => {
    n += 1;
    return (
      '<mxCell id="rules-' +
      n +
      '" value="' +
      escapeCellValue(cell.value, cell.style.includes('html=1')) +
      '" style="' +
      escapeAttr(cell.style) +
      '" vertex="1" parent="1"><mxGeometry x="' +
      cell.x +
      '" y="' +
      cell.y +
      '" width="' +
      cell.w +
      '" height="' +
      cell.h +
      '" as="geometry"/></mxCell>'
    );
  };
  const diagrams = pages.map((page) =>
    [
      '<diagram name="' + escapeAttr(page.name) + '">',
      '<mxGraphModel page="1" pageWidth="' + PAGE_W + '" pageHeight="' + PAGE_H + '" grid="0">',
      '<root>',
      '<mxCell id="0" />',
      '<mxCell id="1" parent="0" />',
      ...page.cells.map(cellXml),
      '</root>',
      '</mxGraphModel>',
      '</diagram>',
    ].join('\n'),
  );
  return ['<mxfile host="sec-diagrams" type="device">', ...diagrams, '</mxfile>'].join('\n') + '\n';
}
