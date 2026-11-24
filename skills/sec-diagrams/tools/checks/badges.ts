/** Identify numbered markers and associate them with connection edges. */
import { normalize } from '../label.ts';
import { boxCentre, polylineDistance, type Point } from './geometry.ts';
import { isEdgeNumberLabel, isNumberStyle } from './cell-style.ts';
import type { PageLabel } from './model.ts';

export interface NumberBadge {
  cellId: string;
  value: number;
  /** the value is 1..99 and the cell is white with a visible border. */
  valid: boolean;
  /** Connections the number stands on; a child label stands on its parent edge. */
  edges: string[];
}

export interface ListItem {
  cellId: string;
  value: number;
  line: string;
}

export const LIST_ITEM = /^(\d{1,2})\. (.*)$/u;
/** A digit vertex is a number candidate whatever its style; validity is checked separately. */
export const NUMBER_TEXT = /^\d+$/u;
/** the centre of a number stands at most this far from the polyline. */
export const NUMBER_TOLERANCE = 6;

const attachedEdges = (label: PageLabel, connections: PageLabel[], polylines: Map<string, Point[]>): string[] => {
  if (label.box === null) return [];
  const centre = boxCentre(label.box);
  return connections
    .filter((edge) => {
      const line = polylines.get(edge.id);
      return line !== undefined && polylineDistance(centre, line) <= NUMBER_TOLERANCE;
    })
    .map((edge) => edge.id);
};

/**
 * Every digit cell outside the legend is a number, the
 * well-styled ones are numbers a reader trusts - a plate on a line counts too (№10). A number
 * of a child label stands on its parent edge; a free number stands on every connection whose
 * polyline passes within the tolerance.
 */
export function numberBadges(
  labels: PageLabel[],
  parentOf: Map<string, string>,
  connections: PageLabel[],
  polylines: Map<string, Point[]>,
): NumberBadge[] {
  const connectionIds = new Set(connections.map((edge) => edge.id));
  const badges: NumberBadge[] = [];
  for (const label of labels) {
    // The number is what stands on the plate: the visible label, free Edit Data aside.
    const text = normalize(label.visible);
    if (label.inLegend || !NUMBER_TEXT.test(text)) continue;
    if (label.edge) {
      // a double click on a line in draw.io puts the number on the line
      // itself - value with a white plate and a border. It numbers exactly its own line.
      if (isEdgeNumberLabel(label.style, text) && connectionIds.has(label.id)) {
        badges.push({ cellId: label.id, value: Number(text), valid: true, edges: [label.id] });
      }
      continue;
    }
    const parent = parentOf.get(label.id) ?? '';
    badges.push({
      cellId: label.id,
      value: Number(text),
      valid: isNumberStyle(label, text),
      edges: label.onEdge ? (connectionIds.has(parent) ? [parent] : []) : attachedEdges(label, connections, polylines),
    });
  }
  return badges;
}

export function listItemsOf(labels: PageLabel[]): ListItem[] {
  const items: ListItem[] = [];
  for (const label of labels) {
    // an old sheet may keep its connection list inside the legend block -
    // an item there answers for its number like anywhere else. A digit-only cell (the number
    // badge) and a label riding a line are still not list items.
    if (label.edge || NUMBER_TEXT.test(label.text)) continue;
    for (const line of label.text.split('\n')) {
      const match = LIST_ITEM.exec(line);
      if (match !== null) items.push({ cellId: label.id, value: Number(match[1]), line });
    }
  }
  return items;
}
