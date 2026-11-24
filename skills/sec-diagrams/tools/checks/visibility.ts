/**
 * Which cells the page shows: draw.io keeps a draft by hiding its layer, not by deleting it,
 * so a cell is out of every rule and every count when it carries visible="0" itself or stands
 * under a cell that does.
 */
import type { Cell } from '../drawio.ts';

/** Ids of the cells that are visible - themselves and through their whole parent chain. */
export function shownIds(cells: Cell[], parentOf: Map<string, string>): Set<string> {
  const visibleById = new Map<string, boolean>(cells.map((cell) => [cell.id, cell.visible]));
  const cache = new Map<string, boolean>();
  const shown = (id: string, trail: Set<string>): boolean => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const parent = parentOf.get(id) ?? '';
    const result =
      (visibleById.get(id) ?? false) && (parent === '' || parent === id || shown(parent, new Set(trail).add(id)));
    cache.set(id, result);
    return result;
  };
  return new Set(cells.filter((cell) => shown(cell.id, new Set())).map((cell) => cell.id));
}

/**
 * Ids of the marked cells and of everything standing under them. A page section marked out of
 * the notation rules (the "sdRole=rules" tables) excuses its whole subtree, not the page around
 * it (one marked cell used to switch the number and line rules off for the
 * entire sheet, hiding real findings next to the table).
 */
export function descendantsOf<T extends { id: string }>(
  cells: T[],
  parentOf: Map<string, string>,
  isMarked: (cell: T) => boolean,
): Set<string> {
  const children = new Map<string, T[]>();
  for (const cell of cells) {
    const parent = parentOf.get(cell.id) ?? '';
    if (parent === cell.id) continue;
    const list = children.get(parent) ?? [];
    list.push(cell);
    children.set(parent, list);
  }
  const marked = new Set<string>();
  const queue = cells.filter(isMarked).map((cell) => cell.id);
  for (const id of queue) {
    if (marked.has(id)) continue;
    marked.add(id);
    for (const child of children.get(id) ?? []) queue.push(child.id);
  }
  return marked;
}
