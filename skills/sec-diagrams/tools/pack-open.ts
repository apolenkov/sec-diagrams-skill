/**
 * The open values of a copy for sending, as the pack checklist sees them: the cells whose own
 * style carries the sdRole=open mark, listed per sheet with their ids.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseDrawio, styleValue, type Cell } from './drawio.ts';
import { shownIds } from './checks/visibility.ts';
import { listDrawio, resolveDirectoryName, type Manifest } from './profile.ts';

function openIdsOf(path: string): string[] {
  const drawio = parseDrawio(readFileSync(path, 'utf8'));
  const ids: string[] = [];
  for (const page of drawio.pages) {
    // A hidden draft layer is nobody's open value: the letter would name a hole the reader
    // cannot find on the sheet.
    const parentOf = new Map<string, string>(page.cells.map((cell: Cell) => [cell.id, cell.parent]));
    const shown = shownIds(page.cells, parentOf);
    for (const cell of page.cells) {
      if (shown.has(cell.id) && styleValue(cell.style, 'sdRole') === 'open') ids.push(cell.id);
    }
  }
  return ids;
}

export function openValueLines(dir: string, manifest: Manifest): string[] {
  if (manifest.final !== true) return ['- рабочая копия: на проверку отправляй копию с настоящими значениями (final)'];
  const files = listDrawio(dir, manifest);
  const rows = manifest.sheets.map((sheet) => ({
    file: sheet.file.normalize('NFC'),
    ids: openIdsOf(join(dir, resolveDirectoryName(files, sheet.file))),
  }));
  const total = rows.reduce((sum, row) => sum + row.ids.length, 0);
  const lines = rows
    .filter((row) => row.ids.length > 0)
    .map((row) => '- ' + row.file + ': открытых значений ' + row.ids.length + ' (id: ' + row.ids.join(', ') + ')');
  lines.push(
    total === 0
      ? '- открытых значений нет'
      : '- всего открытых значений ' +
          total +
          ': сверь отмеченные ячейки с записью о проверке',
  );
  return lines;
}
