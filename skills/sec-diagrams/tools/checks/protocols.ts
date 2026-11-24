import type { DrawioPage } from '../drawio.ts';
import { finding, type Finding, type PageModel } from './model.ts';

// Compare explicit protocol labels only. Free-standing labels, shared branches and
// compound descriptions need a reader to resolve the endpoints and the context.
const protocol = /^[\w.+-]+\s*\(\d+(?:[-–]\d+)?\/(?:TCP|UDP)\)(?:\s+(?:via TLS|no TLS))?$/iu;
export function checkProtocols(model: PageModel, page: DrawioPage): Finding[] {
  const ids: string[] = [];
  const parent = new Map(page.cells.map(cell => [cell.id, cell.parent]));
  for (const badge of model.badges) {
    if (badge.edges.length !== 1 || model.legend === 'none') continue;
    const edge = badge.edges[0];
    const items = model.listItems.filter(item => item.value === badge.value);
    const labels = model.labels.filter(cell => (cell.id === edge || parent.get(cell.id) === edge) && protocol.test(cell.visible));
    if (items.length !== 1 || labels.length !== 1) continue;
    const tail = items[0]!.line.split(/\s+[-–—]\s+/u).at(-1)?.trim() ?? '';
    if (protocol.test(tail) && tail.toUpperCase() !== labels[0]!.visible.toUpperCase())
      ids.push(labels[0]!.id, items[0]!.cellId);
  }
  return ids.length ? [finding('SD-L06', model, ids)] : [];
}
