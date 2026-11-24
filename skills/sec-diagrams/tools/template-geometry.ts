/**
 * Placement of the connection number and protocol label, computed from the routed polyline.
 *
 * A route is a polyline in page coordinates: it starts on the source frame at the exit anchor,
 * runs through the explicit points the sheet declares and ends on the target frame at the entry
 * anchor. Both labels stay children of the connection, and draw.io places a relative edge label
 * the way mxGraphView.getPoint does: the geometry coordinate `x` is read as
 * `dist = (x / 2 + 0.5) * length` along the whole polyline - x=-1 stands at the source end,
 * x=+1 at the target end. The generator writes `y="0"` on both labels and moves them through the
 * absolute `<mxPoint as="offset">` only, and it writes both of them `align=center;verticalAlign=
 * middle`: with that pairing the exported centre of a label is exactly the point of the path plus
 * the offset, which is what the layout tests and the draw.io check compare. Any other alignment
 * makes draw.io anchor a corner of the text instead, so the export drifts by half the label width
 * and by 6 px down - the label of a vertical line slides half a label to the right.
 *
 * The carrier of the pair is a piece, not a whole segment: the polyline is cut wherever it
 * crosses the frame of a zone, of the firewall band or of a block, and a piece carries the pair
 * only when it lies whole inside one zone or whole outside all of them, off the band and off the
 * blocks, and far enough from everything else - the badge and the text keep CLEARANCE from every
 * frame side, caption, sheet frame, other line, number and label, and from the narrow corridor
 * between two neighbouring frames. The longest piece that fits wins; when none does the
 * generator names the sheet and the connection and stops, instead of dropping a label on a frame.
 * Sizes follow the A3 metrics the layout tests use: the label is `0.6 * font` per character and
 * `1.25 * font` tall, the number the frame draw.io actually paints for it - NUMBER_W x NUMBER_H,
 * a digit plus labelPadding=4 and its border, measured from the export.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const PROTOCOL_FONT = 14;
export const labelWidth = (text: string): number => text.length * 0.6 * PROTOCOL_FONT;
export const LABEL_HEIGHT = 1.25 * PROTOCOL_FONT;
/**
 * The painted frame of the number: a digit of Arial 14 bold plus labelPadding=4 and its 1 px
 * border. Measured from a real draw.io SVG export (the IT in export.ts re-reads the rectangle
 * of the frame and fails when these numbers no longer match what draw.io paints), not counted
 * on paper - the border is what the reader sees, and the placer must keep off it.
 */
export const NUMBER_W = 18;
export const NUMBER_H = 30.5;
/** Nothing but its own line comes nearer than this to the number or to the label. */
export const CLEARANCE = 4;
/**
 * The badge covers half its own size on each side of the line, so the label stands further out.
 * Eight, not four: the exported rasters include the font's ascent and descent around both boxes,
 * and with the label this far out the painted frame and the painted text keep over 4 px.
 */
const LABEL_AIR = 8;
export const LABEL_GAP_X = NUMBER_W / 2 + LABEL_AIR;
export const LABEL_GAP_Y = NUMBER_H / 2 + LABEL_AIR;
/** A strip between two neighbouring frames narrower than this is a corridor: lines only cross it. */
export const CORRIDOR = 60;
/** Touching a frame is not entering it, so an interior is read this much narrower. */
const INSIDE_EDGE = 1;

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x1: x, y1: y, x2: x + w, y2: y + h });

export const anchorPoint = (frame: Rect, at: [number, number]): Point => ({
  x: frame.x1 + (frame.x2 - frame.x1) * at[0],
  y: frame.y1 + (frame.y2 - frame.y1) * at[1],
});

export const overlaps = (a: Rect, b: Rect): boolean => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/** Shortest distance between two frames; 0 when they touch or overlap. */
export const gap = (a: Rect, b: Rect): number =>
  Math.hypot(Math.max(a.x1 - b.x2, b.x1 - a.x2, 0), Math.max(a.y1 - b.y2, b.y1 - a.y2, 0));

/**
 * Distance from a box to the border of a frame: the distance to the frame when the box stands
 * outside it, the distance to the nearest side when the box sits inside it, 0 when it straddles
 * it. A label inside a zone is far from the zone by this measure, which is what a reader needs:
 * the zone itself is not an obstacle, its frame is.
 */
export const toFrame = (box: Rect, frame: Rect): number => {
  if (!overlaps(box, frame)) return gap(box, frame);
  const within = box.x1 >= frame.x1 && box.y1 >= frame.y1 && box.x2 <= frame.x2 && box.y2 <= frame.y2;
  if (!within) return 0;
  return Math.min(box.x1 - frame.x1, frame.x2 - box.x2, box.y1 - frame.y1, frame.y2 - box.y2);
};

const legLength = (from: Point, to: Point): number => Math.abs(to.x - from.x) + Math.abs(to.y - from.y);

export const polylineLength = (points: Point[]): number =>
  points.slice(1).reduce((sum, point, index) => sum + legLength(point, points[index] as Point), 0);

/** Every axis-aligned segment of every polyline, as a zero-thickness frame. */
export const segmentFrames = (lines: Point[][]): Rect[] =>
  lines.flatMap((line) =>
    line.slice(1).map((to, index) => {
      const from = line[index] as Point;
      return {
        x1: Math.min(from.x, to.x),
        y1: Math.min(from.y, to.y),
        x2: Math.max(from.x, to.x),
        y2: Math.max(from.y, to.y),
      };
    }),
  );

const pushStrip = (strips: Rect[], near: number, far: number, from: number, to: number, vertical: boolean): void => {
  const [lo, hi] = near < far ? [near, far] : [far, near];
  if (hi - lo <= 0 || hi - lo >= CORRIDOR || to - from <= 0) return;
  strips.push(vertical ? rect(lo, from, hi - lo, to - from) : rect(from, lo, to - from, hi - lo));
};

/**
 * Strips between two facing sides of the zone and band frames that stand nearer than CORRIDOR:
 * the slit between the corporate zone and the band, the one between the band and the contour, the
 * shelf between the Internet zone and the contour top. A segment parallel to a strip may not rest
 * in it, only cross it, and neither badge nor label may stand in one either, so a pair is never
 * squeezed into a 40 px corridor where the text does not fit anyway.
 */
export function corridors(frames: Rect[]): Rect[] {
  const strips: Rect[] = [];
  frames.forEach((first, index) => {
    for (const second of frames.slice(index + 1)) {
      for (const xa of [first.x1, first.x2]) {
        for (const xb of [second.x1, second.x2]) {
          pushStrip(strips, xa, xb, Math.max(first.y1, second.y1), Math.min(first.y2, second.y2), true);
        }
      }
      for (const ya of [first.y1, first.y2]) {
        for (const yb of [second.y1, second.y2]) {
          pushStrip(strips, ya, yb, Math.max(first.x1, second.x1), Math.min(first.x2, second.x2), false);
        }
      }
    }
  });
  return strips;
}

export const inside = (page: Rect, box: Rect): boolean =>
  box.x1 >= page.x1 && box.y1 >= page.y1 && box.x2 <= page.x2 && box.y2 <= page.y2;

/**
 * The draw.io position formula, the single place it lives: relative coordinate `x` becomes
 * `dist = (x / 2 + 0.5) * total` along the polyline (endpoints on the frames included), the
 * point at that distance is the label center before the absolute offset. With `y` pinned to 0
 * no perpendicular shift of its own is applied, so the sign of the segment direction cannot
 * flip the label to the wrong side.
 */
export function pointOnPolyline(points: Point[], x: number): Point {
  let rest = (x / 2 + 0.5) * polylineLength(points);
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index] as Point;
    const to = points[index + 1] as Point;
    const length = legLength(from, to);
    if (rest <= length || index === points.length - 2) {
      const ratio = length === 0 ? 0 : Math.min(rest / length, 1);
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    }
    rest -= length;
  }
  return { ...(points[points.length - 1] as Point) };
}

export interface Piece {
  from: Point;
  to: Point;
  /** Distance along the polyline where the piece begins. */
  start: number;
  length: number;
  horizontal: boolean;
}

const along = (from: Point, to: Point, horizontal: boolean, distance: number): Point =>
  horizontal
    ? { x: from.x + Math.sign(to.x - from.x) * distance, y: from.y }
    : { x: from.x, y: from.y + Math.sign(to.y - from.y) * distance };

/** Where a segment crosses a side of a frame, counted from its start. */
function cutDistances(from: Point, to: Point, cuts: Rect[]): number[] {
  const horizontal = from.y === to.y;
  /* The coordinate the segment holds, and the one it moves along. */
  const held = horizontal ? from.y : from.x;
  const begin = horizontal ? from.x : from.y;
  const direction = Math.sign((horizontal ? to.x : to.y) - begin);
  const span = legLength(from, to);
  const out: number[] = [];
  for (const frame of cuts) {
    const [near, far] = horizontal ? [frame.y1, frame.y2] : [frame.x1, frame.x2];
    if (held <= near || held >= far) continue;
    for (const side of horizontal ? [frame.x1, frame.x2] : [frame.y1, frame.y2]) {
      const distance = (side - begin) * direction;
      if (distance > 0 && distance < span) out.push(distance);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** The polyline cut where it crosses a frame: the pieces a number and a label may live on. */
export function piecesOf(points: Point[], cuts: Rect[]): Piece[] {
  const out: Piece[] = [];
  let start = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as Point;
    const to = points[index] as Point;
    const horizontal = from.y === to.y;
    const span = legLength(from, to);
    const stops = [0, ...cutDistances(from, to, cuts), span];
    stops.slice(1).forEach((stop, position) => {
      const begin = stops[position] as number;
      if (stop <= begin) return;
      out.push({
        from: along(from, to, horizontal, begin),
        to: along(from, to, horizontal, stop),
        start: start + begin,
        length: stop - begin,
        horizontal,
      });
    });
    start += span;
  }
  return out;
}

const midOf = (piece: Piece): Point => ({
  x: (piece.from.x + piece.to.x) / 2,
  y: (piece.from.y + piece.to.y) / 2,
});

const covers = (point: Point, frame: Rect): boolean =>
  point.x > frame.x1 + INSIDE_EDGE &&
  point.x < frame.x2 - INSIDE_EDGE &&
  point.y > frame.y1 + INSIDE_EDGE &&
  point.y < frame.y2 - INSIDE_EDGE;

/** A piece carries the pair when it lies whole in one zone or whole outside all, off band and blocks. */
export const pieceCarries = (piece: Piece, zones: Rect[], solids: Rect[]): boolean => {
  const mid = midOf(piece);
  if (solids.some((frame) => covers(mid, frame))) return false;
  return zones.filter((zone) => covers(mid, zone)).length <= 1;
};

export interface PlaceInput {
  /** Sheet title and connection number: all the error message is allowed to name. */
  connectionName: string;
  polyline: Point[];
  text: string;
  /** Frames the polyline is cut by: the zones, the band, the blocks. */
  cuts: Rect[];
  zones: Rect[];
  /** The band and the blocks: a piece lying on one of them carries nothing. */
  solids: Rect[];
  /** Blocks, band, captions, title, list, legend, footnote: everything the pair keeps CLEARANCE from. */
  keepOut: Rect[];
  /** Strips between neighbouring frames narrower than CORRIDOR: neither badge nor label stands in one. */
  strips: Rect[];
  /** Segments of this line: the label keeps CLEARANCE from them, the number stands on them. */
  own: Rect[];
  /** Segments of every other line, plus every number and label already placed on the sheet. */
  others: Rect[];
  page: Rect;
}

export interface ConnectionPlan {
  /** Relative coordinate both labels carry: the point of the polyline they hang on. */
  x: number;
  /** Shift of the label center from that point; the number itself stands on the line. */
  labelOffset: Point;
  numberBox: Rect;
  labelBox: Rect;
}

const numberRect = (center: Point): Rect => rect(center.x - NUMBER_W / 2, center.y - NUMBER_H / 2, NUMBER_W, NUMBER_H);

/** Above a horizontal line, to the right of a vertical one, to its left when the right is taken. */
function labelBoxes(center: Point, horizontal: boolean, text: string): Rect[] {
  const width = labelWidth(text);
  if (horizontal) return [rect(center.x - width / 2, center.y - LABEL_GAP_Y - LABEL_HEIGHT, width, LABEL_HEIGHT)];
  return [
    rect(center.x + LABEL_GAP_X, center.y - LABEL_HEIGHT / 2, width, LABEL_HEIGHT),
    rect(center.x - LABEL_GAP_X - width, center.y - LABEL_HEIGHT / 2, width, LABEL_HEIGHT),
  ];
}

/** Everything the badge and the text share as obstacles, plus the zones, whose sides count too. */
interface Room {
  zones: Rect[];
  shared: Rect[];
  own: Rect[];
  page: Rect;
}

const fits = (box: Rect, room: Room, extra: Rect[]): boolean =>
  inside(room.page, box) &&
  room.zones.every((zone) => toFrame(box, zone) >= CLEARANCE) &&
  [...room.shared, ...extra].every((frame) => gap(box, frame) >= CLEARANCE);

/** Badge at the middle of the piece, label beside it: the first arrangement that fits wins. */
function place(piece: Piece, text: string, room: Room): { center: Point; box: Rect } | undefined {
  const center = midOf(piece);
  const badge = numberRect(center);
  if (!fits(badge, room, [])) return undefined;
  const near = [...room.own, badge];
  const box = labelBoxes(center, piece.horizontal, text).find((candidate) => fits(candidate, room, near));
  return box === undefined ? undefined : { center, box };
}

/**
 * Number and label for one routed connection: the longest piece of the polyline that carries
 * both, the badge at its middle, the text next to it. Without such a piece the generator stops -
 * a label put on a frame or in a corridor reads as access that is not there.
 */
export function planConnection(input: PlaceInput): ConnectionPlan {
  const { connectionName, polyline, text, cuts, zones, solids, keepOut, strips, own, others, page } = input;
  const room: Room = { zones, shared: [...keepOut, ...strips, ...others], own, page };
  const candidates = piecesOf(polyline, cuts)
    .filter((piece) => piece.length > 0 && pieceCarries(piece, zones, solids))
    .sort((a, b) => b.length - a.length || a.start - b.start);
  const placed = candidates.map((piece) => ({ piece, spot: place(piece, text, room) })).find((item) => item.spot);
  if (placed === undefined || placed.spot === undefined) {
    throw new Error(connectionName + ': no stretch of the line carries the number and the protocol label');
  }
  const { piece, spot } = placed;
  const distance = piece.start + piece.length / 2;
  const box = spot.box;
  return {
    x: (distance * 2) / polylineLength(polyline) - 1,
    labelOffset: { x: (box.x1 + box.x2) / 2 - spot.center.x, y: (box.y1 + box.y2) / 2 - spot.center.y },
    numberBox: numberRect(spot.center),
    labelBox: box,
  };
}
