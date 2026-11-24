/** Build a firewall review sheet from YAML, repeating the header on continuation pages. */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { DirectoryNameConflict, ProfileError, listDrawio, loadManifestOrNull, loadProfile, resolveDirectoryName, rulesSheetName } from './profile.ts';
import { writeSheet } from './write.ts';
import { nodeCommand, shellQuote } from './shell.ts';
import { loadPoc, type Poc } from './rules-page-schema.ts';
import {
  BOTTOM,
  CAPTION_SPACE,
  CELL_PX,
  CONTENT_TOP,
  CONTENT_W,
  LINE_HEIGHT,
  MARGIN,
  NOTE_PAD,
  NOTE_PX,
  ROW_PAD,
  TITLE_H,
  TITLE_STYLE,
  TITLE_Y,
  WRAP_PAD,
  fileXml,
  layoutBlocks,
  pageSuffix,
  type Block,
  type HeadCell,
  type NoteBlock,
  type TableBlock,
} from './rules-page-render.ts';
import {
  RULES_COLUMNS,
  RULES_WIDTHS,
  WHITE_COLUMNS,
  WHITE_WIDTHS,
  pocTextProblems,
  ruleRow,
  whiteRowOpenFlags,
  whiteRowValues,
} from './rules-page-columns.ts';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

export { RULES_SHEET_FILE } from './profile.ts';
const SHEET_TITLE = 'Карта сетевой фильтрации';
const WHITE_CAPTION = 'Доступ по DNS-именам';

/**
 * Reference lines(): wrapped-line estimate of a text in the box of the given width. draw.io may
 * end a line after every dot and dash - the writer plants <wbr> at exactly those places, and
 * html=1 cells break there. A piece longer than the column still hard-breaks
 * at the edge, so the row grows instead of the cell clipping the text.
 */
function countLines(text: string, width: number, px: number): number {
  const usable = Math.max(px, width - WRAP_PAD);
  let n = 0;
  for (const para of text.split('\n')) {
    n += 1;
    let cur = 0;
    let needGap = false;
    for (const word of para.split(' ')) {
      for (const piece of word.split(/(?<=[.-])/u)) {
        let run = piece.length * px;
        const gap = needGap ? px : 0;
        if (cur !== 0 && cur + gap + Math.min(run, usable) > usable) {
          n += 1;
          cur = 0;
        } else if (cur !== 0) {
          cur += gap;
        }
        while (run > usable - cur) {
          run -= usable - cur;
          n += 1;
          cur = 0;
        }
        cur += run;
        needGap = true;
      }
    }
  }
  return n;
}

const rowHeight = (values: string[], widths: number[]): number =>
  Math.max(...values.map((value, index) => countLines(value, widths[index] ?? 0, CELL_PX))) * LINE_HEIGHT + ROW_PAD;

const columnX = (widths: number[], index: number): number =>
  MARGIN + widths.slice(0, index).reduce((total, width) => total + width, 0);

function headCells(columns: string[], widths: number[]): { cells: HeadCell[]; height: number } {
  const height = rowHeight(columns, widths);
  const cells = columns.map((value, index) => ({
    value,
    x: columnX(widths, index),
    w: widths[index] ?? 0,
    h: height,
  }));
  return { cells, height };
}

const assertWidths = (widths: number[]): void => {
  if (widths.reduce((total, width) => total + width, 0) !== CONTENT_W)
    throw new Error('column widths must fill the content width');
};

/** A row taller than the space below a repeated header would split into an endless page loop. */
function assertFits(block: TableBlock | NoteBlock): void {
  const limit = BOTTOM - CONTENT_TOP;
  if (block.kind === 'note') {
    if (block.height > limit) throw new ProfileError('poc.yaml: ' + block.place + ' не помещается на страницу');
    return;
  }
  block.heights.forEach((height, index) => {
    if (CAPTION_SPACE + block.headerH + height > limit) {
      throw new ProfileError('poc.yaml: ' + block.place + ' строка ' + (index + 1) + ' не помещается на страницу');
    }
  });
}

function tableBlock(
  caption: string,
  widths: number[],
  head: { cells: HeadCell[]; height: number },
  rows: string[][],
  marks: boolean[][],
  place: string,
  linkColumn?: number,
): TableBlock {
  const block: TableBlock = {
    kind: 'table',
    caption,
    widths,
    headCells: head.cells,
    headerH: head.height,
    rows,
    marks,
    heights: rows.map((row) => rowHeight(row, widths)),
    place,
    ...(linkColumn === undefined ? {} : { linkColumn }),
  };
  assertFits(block);
  return block;
}

function buildBlocks(poc: Poc): Block[] {
  assertWidths(RULES_WIDTHS);
  assertWidths(WHITE_WIDTHS);
  const rulesHead = headCells(RULES_COLUMNS, RULES_WIDTHS);
  const blocks: Block[] = poc.tables.map((table, index) => {
    const rows = table.rows.map((row, ri) => ruleRow(row, 'tables.' + index + '.rows.' + ri));
    return tableBlock(
      'Из зоны "' + table.from + '" в зону "' + table.to + '"',
      RULES_WIDTHS,
      rulesHead,
      rows.map(row => row.values),
      rows.map(row => row.marks),
      'таблица ' + (index + 1),
      RULES_COLUMNS.indexOf('Связь L3'),
    );
  });
  if (poc.whitelist.length > 0) {
    blocks.push(
      tableBlock(
        WHITE_CAPTION,
        WHITE_WIDTHS,
        headCells(WHITE_COLUMNS, WHITE_WIDTHS),
        poc.whitelist.map((entry) => whiteRowValues(entry)),
        poc.whitelist.map((entry) => whiteRowOpenFlags(entry)),
        'белый список',
      ),
    );
  }
  poc.notes.forEach((note, index) => {
    const block: NoteBlock = {
      kind: 'note',
      text: note.text,
      open: note.open,
      height: countLines(note.text, CONTENT_W, NOTE_PX) * LINE_HEIGHT + NOTE_PAD,
      place: 'заметка ' + (index + 1),
    };
    assertFits(block);
    blocks.push(block);
  });
  return blocks;
}

export interface BuiltSheet {
  xml: string;
  tables: number;
  rows: number;
  pages: number;
}

/** The whole sheet as uncompressed mxfile XML: every page carries its own title cell. */
export function renderSheet(poc: Poc, titlePrefix: string): BuiltSheet {
  const placed = layoutBlocks(buildBlocks(poc));
  const total = placed.length;
  const pages = placed.map((cells, index) => ({
    name: poc.sheet + pageSuffix(index, total),
    cells: [
      {
        value: titlePrefix + SHEET_TITLE + pageSuffix(index, total),
        style: TITLE_STYLE,
        x: MARGIN,
        y: TITLE_Y,
        w: CONTENT_W,
        h: TITLE_H,
      },
      ...cells,
    ],
  }));
  return {
    xml: fileXml(pages),
    tables: poc.tables.length + (poc.whitelist.length > 0 ? 1 : 0),
    rows: poc.tables.reduce((sum, table) => sum + table.rows.length, 0) + poc.whitelist.length,
    pages: total,
  };
}

export interface RulesResult {
  code: number;
  lines: string[];
}

/**
 * rules <poc.yaml> [--force]: build the sheet next to the yaml. An existing file is rewritten
 * only with --force; a text problem in the yaml stops the command with the code and the place,
 * never the value, and the file is not written.
 */
export function runRules(pocPath: string, force: boolean): RulesResult {
  const file = resolve(pocPath);
  const dir = dirname(file);
  try {
    const poc = loadPoc(file);
    const manifest = loadManifestOrNull(dir);
    const name = resolveDirectoryName(listDrawio(dir, manifest), rulesSheetName(manifest));
    const target = join(dir, name);
    const problems = pocTextProblems(poc, loadProfile().masks, manifest?.final === true);
    if (problems.length > 0) {
      return {
        code: 1,
        lines: [
          ...problems,
          'Поправь ' + shellQuote(file) + ' по references/fw-rules.md: это тот же текст, что уходит на лист.',
          'Дальше: ' + nodeCommand(CLI_PATH, 'rules', file),
        ],
      };
    }
    if (existsSync(target) && !force) {
      return {
        code: 64,
        lines: [
          'Файл есть: ' + name + ' - перезапись только с --force',
          'Дальше: ' + nodeCommand(CLI_PATH, 'rules', file, '--force'),
        ],
      };
    }
    const prefix = manifest?.titlePrefix ?? '';
    const built = renderSheet(poc, prefix);
    if (existsSync(target)) writeSheet(target, built.xml);
    else writeFileSync(target, built.xml, { flag: 'wx' });
    return {
      code: 0,
      lines: [
        'Таблиц: ' + built.tables,
        'Строк: ' + built.rows,
        'Страниц: ' + built.pages,
        'Дальше: ' + nodeCommand(CLI_PATH, 'check', dir),
      ],
    };
  } catch (error) {
    if (error instanceof DirectoryNameConflict) return { code: 65, lines: [error.message] };
    if (error instanceof ProfileError) {
      return {
        code: 65,
        lines: [
          error.code + ': ' + error.message,
          'Исправь poc.yaml по названному пути поля и повтори сборку.',
          'Дальше: ' + nodeCommand(CLI_PATH, 'rules', file),
        ],
      };
    }
    throw error;
  }
}
