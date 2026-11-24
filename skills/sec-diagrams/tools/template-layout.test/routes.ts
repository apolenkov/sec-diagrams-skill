import assert from 'node:assert/strict';
import test from 'node:test';

import { connectionPolyline, frameOf, fwIconFrame, type EdgeSpec, type SheetSpec } from '../template-cells.ts';
import { CORRIDOR, corridors, overlaps, segmentFrames, type Point, type Rect } from '../template-geometry.ts';
import { EPS, at, bands, forEachSheet, geometryOf, onFrame } from './support.ts';

test('routes repeat the data: orthogonal, on the anchors, same points as the specs', () => {
  forEachSheet((data) => {
    for (const edge of data.spec.edges) {
      const id = edge.n === undefined ? 'e-deny' : 'e' + edge.n;
      assert.deepEqual(
        geometryOf(data.page, id).points,
        (edge.points ?? []).map(([x, y]) => ({ x, y })),
        at(data, edge) + ': the file route differs from the data route',
      );
      const line = connectionPolyline(data.spec, edge);
      assert.ok(
        onFrame(line[0] as Point, frameOf(data.spec, edge.from)),
        at(data, edge) + ': the line does not start on the source frame',
      );
      assert.ok(
        onFrame(line[line.length - 1] as Point, frameOf(data.spec, edge.to)),
        at(data, edge) + ': the line does not end on the target frame',
      );
      for (let index = 1; index < line.length; index += 1) {
        const from = line[index - 1] as Point;
        const to = line[index] as Point;
        assert.ok(
          Math.abs(from.x - to.x) < 1e-6 || Math.abs(from.y - to.y) < 1e-6,
          at(data, edge) + ': the route is not orthogonal',
        );
      }
    }
  });
});

/** The band of height the zones draw: every line stays inside it. */
const zoneBand = (spec: SheetSpec): [number, number] => [
  Math.min(...spec.zones.map((zone) => zone.y)),
  Math.max(...spec.zones.map((zone) => zone.y + zone.h)),
];

test('R1 no line leaves the band the zones draw', () => {
  forEachSheet((data) => {
    const [top, bottom] = zoneBand(data.spec);
    for (const edge of data.spec.edges) {
      for (const point of connectionPolyline(data.spec, edge)) {
        assert.ok(
          point.y >= top - EPS && point.y <= bottom + EPS,
          at(data, edge) + ': the line leaves the zone band for the title, the list or the legend',
        );
      }
    }
  });
});

test('a connection crosses each intervening firewall once, from one side to the other', () => {
  forEachSheet((data) => {
    for (const edge of data.spec.edges) {
      const line = connectionPolyline(data.spec, edge);
      const source = line[0]!.x;
      const target = line.at(-1)!.x;
      for (const band of bands(data.spec)) {
        const inner = { x1: band.x1 + 1, y1: band.y1 + 1, x2: band.x2 - 1, y2: band.y2 - 1 };
        const crossings = segmentFrames([line]).filter((segment) => overlaps(segment, inner));
        const crosses = Math.min(source, target) < band.x1 && Math.max(source, target) > band.x2;
        assert.equal(crossings.length, Number(crosses), at(data, edge));
        for (const segment of crossings) {
          assert.ok(Math.abs(segment.y1 - segment.y2) <= EPS, at(data, edge));
          assert.ok(segment.x1 <= band.x1 + EPS && segment.x2 >= band.x2 - EPS, at(data, edge));
        }
      }
    }
  });
});

/**
 * Why a segment does not merely cross the sheet: it hugs a frame side (parallel, nearer than
 * 6 px, sharing a stretch of axis) or it rests in a corridor (parallel to a strip of frames
 * nearer than CORRIDOR, inside it along its whole length). Empty means the line only crosses.
 */
function runsAlong(line: Point[], frames: Rect[], strips: Rect[]): string {
  for (const segment of segmentFrames([line])) {
    const flat = segment.y1 === segment.y2;
    const held = flat ? segment.y1 : segment.x1;
    const [from, to] = flat ? [segment.x1, segment.x2] : [segment.y1, segment.y2];
    for (const frame of frames) {
      const sides = flat ? [frame.y1, frame.y2] : [frame.x1, frame.x2];
      const [near, far] = [Math.max(from, flat ? frame.x1 : frame.y1), Math.min(to, flat ? frame.x2 : frame.y2)];
      if (far - near > 0 && sides.some((side) => Math.abs(held - side) < 6)) return 'along a frame';
    }
    for (const strip of strips) {
      const [lo, hi, span, alongFrom, alongTo] = flat
        ? [strip.y1, strip.y2, strip.y2 - strip.y1, strip.x1, strip.x2]
        : [strip.x1, strip.x2, strip.x2 - strip.x1, strip.y1, strip.y2];
      if (span < CORRIDOR && held > lo && held < hi && Math.min(to, alongTo) > Math.max(from, alongFrom)) {
        return 'in the slit between two frames';
      }
    }
  }
  return '';
}

test('R3 R4 no segment runs along a frame, a corridor is only crossed', () => {
  forEachSheet((data) => {
    const strips = corridors([...data.zones, ...bands(data.spec)]);
    assert.ok(strips.length > 0, data.name + ': the sheet has no corridor to keep clear of');
    for (const edge of data.spec.edges) {
      const line = connectionPolyline(data.spec, edge);
      const reason = runsAlong(line, [...data.zones, ...bands(data.spec), ...data.solids], strips);
      assert.equal(reason, '', at(data, edge) + ': the line runs ' + reason + ' instead of crossing it');
    }
  });
});

/** How far a line must keep off the МЭ glyph: the glyph frame widened by this is off limits. */
const ICON_GUARD = 4;

const iconGuard = (icon: Rect): Rect => ({
  x1: icon.x1 - ICON_GUARD,
  y1: icon.y1 - ICON_GUARD,
  x2: icon.x2 + ICON_GUARD,
  y2: icon.y2 + ICON_GUARD,
});

test('R5 no segment of any line touches a firewall glyph', () => {
  forEachSheet((data) => {
    const guards = data.spec.firewalls.map(fwIconFrame).map(iconGuard);
    for (const edge of data.spec.edges) {
      for (const segment of segmentFrames([connectionPolyline(data.spec, edge)])) {
        assert.ok(guards.every((guard) => !overlaps(segment, guard)), at(data, edge));
      }
    }
  });
});

/** Two parallel segments overlap further than this on the shared axis and so must keep their distance. */
const PARALLEL_OVERLAP = 20;
/** The least distance two such segments may stand at. */
const PARALLEL_APART = 40;
/** A stub no longer than this, hanging on one side of one frame, is a fan at the block. */
const FAN_STUB = 80;

interface Part {
  edge: EdgeSpec;
  frame: Rect;
  length: number;
  /** Tags like 'cluster y2' of the frame sides this segment hangs on at the line's ends. */
  sides: string[];
}

/** The sides of its anchor frame a line endpoint stands on: where a fan stub leaves the block. */
const sidesOn = (point: Point, frame: Rect): string[] =>
  (['x1', 'x2', 'y1', 'y2'] as const)
    .filter((side) => Math.abs((side[0] === 'x' ? point.x : point.y) - frame[side]) <= EPS)
    .map((side) => side + ':' + Math.round(frame[side]));

/** Every segment of one line as a zero-thickness frame, tagged with the anchor sides it hangs on. */
function partsOf(spec: SheetSpec, edge: EdgeSpec): Part[] {
  const line = connectionPolyline(spec, edge);
  const source = frameOf(spec, edge.from);
  const target = frameOf(spec, edge.to);
  return line.slice(1).map((to, index) => {
    const from = line[index] as Point;
    const sides = [
      ...(index === 0 ? sidesOn(from, source).map((side) => edge.from + ' ' + side) : []),
      ...(index === line.length - 2 ? sidesOn(to, target).map((side) => edge.to + ' ' + side) : []),
    ];
    const frame = {
      x1: Math.min(from.x, to.x),
      y1: Math.min(from.y, to.y),
      x2: Math.max(from.x, to.x),
      y2: Math.max(from.y, to.y),
    };
    return { edge, frame, length: frame.x2 - frame.x1 + frame.y2 - frame.y1, sides };
  });
}

test('R6 parallel segments of different lines keep their distance, the gray line included', () => {
  forEachSheet((data) => {
    const parts = data.spec.edges.flatMap((edge) => partsOf(data.spec, edge));
    for (let index = 0; index < parts.length; index += 1) {
      const first = parts[index] as Part;
      for (const second of parts.slice(index + 1)) {
        if (first.edge === second.edge) continue;
        const flat = first.frame.y1 === first.frame.y2;
        if (flat !== (second.frame.y1 === second.frame.y2)) continue;
        const distance = flat ? Math.abs(first.frame.y1 - second.frame.y1) : Math.abs(first.frame.x1 - second.frame.x1);
        if (distance >= PARALLEL_APART - EPS) continue;
        const overlap = flat
          ? Math.min(first.frame.x2, second.frame.x2) - Math.max(first.frame.x1, second.frame.x1)
          : Math.min(first.frame.y2, second.frame.y2) - Math.max(first.frame.y1, second.frame.y1);
        if (overlap <= PARALLEL_OVERLAP + EPS) continue;
        const fan =
          first.length < FAN_STUB &&
          second.length < FAN_STUB &&
          first.sides.some((side) => second.sides.includes(side));
        if (fan) continue;
        assert.fail(
          at(data, first.edge) +
            ' and ' +
            at(data, second.edge) +
            ': the two lines run parallel for ' +
            overlap +
            ' px only ' +
            distance +
            ' px apart',
        );
      }
    }
  });
});

test('R7 a live connection ends on a block, the zone frame is only for the denied line', () => {
  forEachSheet((data) => {
    const nodes = new Set(data.spec.nodes.map((node) => node.id));
    for (const edge of data.spec.edges) {
      if (edge.n === undefined) continue;
      for (const end of [edge.from, edge.to]) {
        assert.ok(nodes.has(end), at(data, edge) + ' ends on ' + end + ': a numbered line must end on a block');
      }
    }
  });
});
