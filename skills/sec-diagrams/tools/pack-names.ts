/** Names of the review folder, its editable diagrams and the merged PDF. */
import { resolve } from 'node:path';

export const SHEETS_DIR = 'схемы';
export const VISIO_DIR = 'Visio';
export const packetDirOf = (folder: string): string => resolve(folder) + '-обзор';

const UNSAFE_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]+/gu;

export function mergedPdfName(service: string, count: number): string {
  const label = service.normalize('NFC').trim().replace(UNSAFE_FILENAME_CHARS, '-');
  return 'Обзор__' + label + '__' + count + '.pdf';
}

export const MERGED_RE = /^Обзор__[^<>:"/\\|?*\u0000-\u001f\u007f]+__\d+\.pdf$/u;
