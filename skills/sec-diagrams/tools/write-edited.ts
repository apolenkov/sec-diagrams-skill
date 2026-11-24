/**
 * Refuse to write an edit the parser does not accept back: the sheet on disk stays untouched,
 * the caller sees SD-E01. Every write of a point-edit or fix goes through here, and through
 * writeSheet: a unique temporary file in the same folder, so a crash or a full disk leaves the
 * old sheet intact, a stranger's l1.drawio.tmp is never overwritten or removed, and a read-only
 * file is refused, not forced.
 */
import { DrawioInputError, parseDrawio } from './drawio.ts';
import { writeSheet } from './write.ts';

export function writeEdited(path: string, draft: string): void {
  try {
    parseDrawio(draft);
  } catch (error) {
    const detail = error instanceof DrawioInputError ? error.message : 'malformed XML';
    throw new DrawioInputError('правка отклонена, файл не изменен: лист после правки не читается (' + detail + ')');
  }
  writeSheet(path, draft);
}
