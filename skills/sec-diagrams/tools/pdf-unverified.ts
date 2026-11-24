/**
 * The person's step for an UNVERIFIED pdf run whose cause is the sheet, not the missing app
 *: a page with no text at all (gate code 101) is a sheet problem - an empty or
 * all-vector page - and the advice to install draw.io Desktop would send the person away from
 * it. The line names every such page by file and page number and nothing from the document.
 */
export interface UnverifiedEntry {
  file: string;
  pages: ReadonlyArray<{ page: number; errors: readonly number[] }>;
}

/** The pages the gate found without text: «l1.drawio стр 1», in file and page order. */
export function noTextPages(entries: readonly UnverifiedEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.pages.filter((page) => page.errors.includes(101)).map((page) => entry.file + ' стр ' + page.page),
  );
}

/** «Человеку: ...» for the pages without text, or null when no page lacks text. */
export function noTextStep(entries: readonly UnverifiedEntry[]): string | null {
  const pages = noTextPages(entries);
  if (pages.length === 0) return null;
  return (
    'Человеку: на странице без текста PDF не проверить (' +
    pages.join(', ') +
    '): добавь на нее подписи в draw.io или убери пустую страницу, затем прогони pdf снова.'
  );
}
