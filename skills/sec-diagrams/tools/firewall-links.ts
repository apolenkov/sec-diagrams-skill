import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, NumberBadge, PageLabel, PageModel } from './checks/model.ts';
import { loadPoc, type Poc } from './rules-page-schema.ts';
import { parseDrawio, styleValue } from './drawio.ts';
import { ruleLinkText } from './rules-page-columns.ts';
import { labelText } from './label.ts';
import { shownIds } from './checks/visibility.ts';

function staleRulesLinks(dir: string, file: string, poc: Poc): Finding[] {
  const path = join(dir, file);
  if (!existsSync(path)) return [];
  const drawio = parseDrawio(readFileSync(path, 'utf8'));
  const actual = drawio.pages.flatMap(page => {
    const visible = shownIds(page.cells, new Map(page.cells.map(cell => [cell.id, cell.parent])));
    return page.cells
      .filter(cell => visible.has(cell.id) && styleValue(cell.style, 'ruleColumn') === 'link')
      .map(cell => labelText(cell.value));
  });
  const expected = poc.tables.flatMap((table, ti) => table.rows.map((row, ri) => ({
    text: ruleLinkText(row.link),
    id: 'tables.' + ti + '.rows.' + ri + '.link',
  })));
  const ids = expected.filter((row, index) => row.text !== actual[index]).map(row => row.id);
  if (ids.length === 0 && actual.length === expected.length) return [];
  return [{
    code: 'SD-R01', status: 'FAIL', file, page: '-', count: Math.max(ids.length, 1), ids,
    reasonKey: 'stale-rules-links',
    reason: 'Ссылки на листе правил расходятся с poc.yaml. Пересобери лист командой rules с --force.',
  }];
}

/** Endpoint ids are local to a page. A badge on a shared trunk still counts as one on its own. */
function sameNodePair(badges: NumberBadge[], edges: ReadonlyMap<string, PageLabel>): boolean {
  const first = edges.get(badges[0]?.edges[0] ?? '');
  if (!first?.source || !first.target || first.source === first.target) return false;
  return badges.every(badge => badge.edges.length > 0 && badge.edges.every(id => {
    const edge = edges.get(id);
    return edge !== undefined && (
      (edge.source === first.source && edge.target === first.target) ||
      (edge.source === first.target && edge.target === first.source)
    );
  }));
}

// YAML identifies the manifest level and badge number, independent of file or page name.
export function collectLinks(links: Map<string, number>, unreadable: Set<string>, level: string, model: PageModel): void {
  const unknown = model.legend === 'none';
  if (unknown) unreadable.add(level);
  const byNumber = new Map<number, NumberBadge[]>();
  for (const badge of model.badges) {
    // Without a legend an unattached digit may still be a number. Only 1..99 are sheet numbers.
    if (badge.value < 1 || badge.value > 99) continue;
    if (!unknown && !badge.valid && badge.edges.length === 0) continue;
    const group = byNumber.get(badge.value);
    if (group) group.push(badge);
    else byNumber.set(badge.value, [badge]);
  }
  const edges = new Map(model.connections.map(edge => [edge.id, edge]));
  for (const [number, badges] of byNumber) {
    const key = level + ':' + number;
    const count = badges.length > 1 && sameNodePair(badges, edges) ? 1 : badges.length;
    links.set(key, (links.get(key) ?? 0) + (unknown ? 0 : count));
  }
}

export function firewallReview(dir: string, links: Map<string, number>, unreadable: Set<string>, hasL3: boolean, rulesFile: string) {
  const path = join(dir, 'poc.yaml');
  const findings: Finding[] = [];
  const unmatched = new Set(links.keys());
  const base = { code: 'SD-R01', file: 'poc.yaml', page: '-', count: 1 };
  let hasReference = false;
  const hasPoc = existsSync(path);
  if (hasPoc) {
    const poc = loadPoc(path);
    poc.tables.forEach((table, ti) => table.rows.forEach((row, ri) => {
      if (row.link === undefined) return;
      hasReference = true;
      const list = Array.isArray(row.link) ? row.link : [row.link];
      list.forEach((key, index) => {
        const ids = ['tables.' + ti + '.rows.' + ri + '.link' + (Array.isArray(row.link) ? '.' + index : '')];
        const count = links.get(key) ?? 0;
        const level = key.split(':')[0]!;
        if (count > 1) {
          unmatched.delete(key);
          findings.push({
            ...base, status: 'NOT_CHECKED', reasonKey: 'ambiguous-link', ids,
            reason: 'Неоднозначно. Номер повторяется на уровне ' + level + ': проверь правило глазами или разнеси номера.',
          });
        } else if (unreadable.has(level)) findings.push({
          ...base, status: 'NOT_CHECKED', reasonKey: 'link-legend-unknown', ids,
          reason: 'На листе L3 не удалось отделить связи от образцов легенды. Сверь номер глазами.',
        });
        else if (count === 1) unmatched.delete(key);
        else findings.push({
          ...base, status: 'FAIL', reasonKey: 'unknown-or-ambiguous-link',
          reason: 'Исправь ссылку в poc.yaml по согласованному листу L3 или уточни номер у владельца.',
          ids,
        });
      });
    }));
    findings.push(...staleRulesLinks(dir, rulesFile, poc));
  }
  if (!hasReference && (hasPoc || hasL3)) findings.push({
    ...base, status: 'NOT_CHECKED', ids: [], reasonKey: hasPoc ? 'no-link-references' : 'missing-poc',
    reason: hasPoc ? 'В правилах нет ссылок link на связи L3.' : 'нет poc.yaml',
  });
  return { findings, unmatched: [...unmatched].sort() };
}
