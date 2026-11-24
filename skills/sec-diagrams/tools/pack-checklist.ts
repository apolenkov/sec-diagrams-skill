/** Manual checks included next to the generated PDF report. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gateCodes, gateWarnings, pdfDir, type PdfReport, type ReportStatus } from './pdf.ts';
import { openValueLines } from './pack-open.ts';
import type { Manifest } from './profile.ts';
import { LETTER_FILE } from './letter.ts';

export const CONTENT_REVIEW_FILES = [
  'rules-author.md',
  'content-review-conditional.md',
  'content-review.md',
  'content-review-package.md',
] as const;

export const CHECKLIST_FILE = 'чек-лист.md';

/** The merged file of the packet: where it landed, its name, its summary line, its status. */
export interface PacketPdf {
  path: string | null;
  name: string;
  line: string;
  status: ReportStatus;
}

/** A check skip: file, page, code and the machine reason, as check --json prints them. */
export interface ChecklistSkip {
  code: string;
  file: string;
  page: string;
  reason: string;
  ids: string[];
}

/** Pages the gate did not pass, with their codes; never label text, never sheet titles. */
function nonPassPages(report: PdfReport): string[] {
  const lines: string[] = [];
  for (const file of report.files) {
    if (file.status === 'NOT_CHECKED') {
      lines.push('- ' + file.file + ': PDF не экспортирован (NOT_CHECKED)');
      continue;
    }
    const pages = file.pages.filter((page) => page.status !== 'PASS');
    if (file.status !== 'PASS' && pages.length === 0) {
      lines.push('- ' + file.file + ': страница не прочитана (' + file.status + ')');
      continue;
    }
    for (const page of pages) {
      lines.push(
        '- ' + file.file + ' стр ' + page.page + ': ' + page.status + ' (' + gateCodes(page.errors).join(' ') + ')',
      );
    }
  }
  return lines;
}

/** The checklist a person walks with eyes, written as markdown next to the PDFs. */
export function writeChecklist(
  dir: string,
  manifest: Manifest,
  skips: ChecklistSkip[],
  warnings: string[],
  report: PdfReport,
  packet: PacketPdf,
  { unreferencedLinks = [], withLetter = false }: { unreferencedLinks?: string[]; withLetter?: boolean } = {},
): string {
  const advice = [...warnings, ...report.files.flatMap(file => file.pages.flatMap(page =>
    gateWarnings(page.warnings).map(w => `${w} (${file.file} стр ${page.page})`)))];
  const pdfLines = nonPassPages(report);
  if (packet.path === null) pdfLines.push('- склейка не собрана: сначала pdf');
  const contentReview = CONTENT_REVIEW_FILES.map(name =>
    readFileSync(join(import.meta.dirname, '../references', name), 'utf8').trim().replace(/^# /gm, '## '))
    .join('\n\n');
  const lines = [
    '# Чек-лист ручных проверок пакета для службы ИБ',
    '',
    '## Состав пакета',
    '',
    '- [ ] Сверьте листы в общем PDF с исходниками в папке `схемы/`.',
    ...(withLetter ? ['- [ ] Сверьте список вложений в `' + LETTER_FILE + '` с файлами пакета.'] : []),
    '',
    '## Схемы и печать',
    '',
    '- [ ] SD-G01. Проверьте наложения линий, подписей и узлов, а также изломы маршрутов на отрисованном листе. ' +
      '[Документация draw.io, Work with waypoints on connectors](https://www.drawio.com/docs/manual/connectors/waypoints-connectors/)',
    '',
    ...(pdfLines.length > 0 ? ['## Страницы PDF для проверки', '', ...pdfLines, ''] : []),
    '## Открытые значения',
    '',
    ...openValueLines(dir, manifest),
    '',
    ...(skips.length > 0 ? [
      '## Пропуски автоматической проверки',
      '',
      ...skips.map(s => '- ' + s.file + ' "' + s.page + '" ' + s.code + ' (' + s.reason + ')' +
        (s.ids.length > 0 ? (s.code === 'SD-R01' ? ', поля YAML ' : ', ячейки ') +
          s.ids.map(id => '`' + id + '`').join(', ') : '')),
      '',
    ] : []),
    ...(unreferencedLinks.length > 0 ? [
      '## Связи L3 без строки правил',
      '',
      ...unreferencedLinks.map(link => '- [ ] ' + link + '. Подтвердите по схеме, что связь не пересекает МЭ. ' +
        'Это правило инструмента: каждая связь L3 сверяется со строкой правил или подтверждается вручную.'),
      '',
    ] : []),
    contentReview,
    '',
    ...(advice.length ? ['## Рекомендации автора', '', ...advice.map(line => '- ' + line), ''] : []),
    '',
  ];
  mkdirSync(pdfDir(dir), { recursive: true });
  const path = join(pdfDir(dir), CHECKLIST_FILE);
  writeFileSync(path, lines.join('\n'));
  return path;
}
