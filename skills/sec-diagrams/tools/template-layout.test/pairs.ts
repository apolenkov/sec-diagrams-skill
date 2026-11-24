/**
 * The pair of labels of every numbered connection, read from the data the generator produces.
 *
 * P2: the number hangs on a piece of the polyline cut at every frame it crosses, and that piece
 * lies whole in one zone or whole outside all of them, off the band and off the blocks. P3: both
 * labels keep CLEARANCE from every frame side, caption, sheet frame, corridor, line, number and
 * label, the label lies whole in one zone or outside all, and the number stands on its line.
 * P4: with no such piece the generator names the sheet and the connection and stops. The label
 * style centers the text on the point its offset names - the export part measures that for real.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { styleValue } from '../drawio.ts';
import { PAGE_FRAME, type SheetSpec } from '../template-cells.ts';
import {
  CLEARANCE,
  gap,
  pieceCarries,
  piecesOf,
  planConnection,
  segmentFrames,
  toFrame,
  type Point,
} from '../template-geometry.ts';
import { SHEETS } from '../template-sheets.ts';
import { EPS, at, dot, forEachSheet, frameOfPiece, framesOf, holds, inMargin, singleZone } from './support.ts';

test('P2 the number hangs on a piece whole in one zone or outside all of them', () => {
  forEachSheet((data) => {
    for (const item of data.routed) {
      const carrier = piecesOf(item.line, data.cuts).find(
        (piece) => piece.length > 0 && gap(frameOfPiece(piece), item.numberBox) <= 1,
      );
      if (carrier === undefined) assert.fail(at(data, item.edge) + ': the number hangs between two frames');
      assert.ok(
        pieceCarries(carrier, data.zones, data.solids),
        at(data, item.edge) + ': the number stands on the band, a block or across a zone frame',
      );
      assert.ok(singleZone(item.labelBox, data.zones), at(data, item.edge) + ': the label is torn across a zone frame');
    }
  });
});

test('P3 number and label keep their clearance from every frame, line and label', () => {
  forEachSheet((data) => {
    for (const item of data.routed) {
      const off = Math.min(...data.segments.map((frame) => gap(dot(item.numberCenter), frame)));
      assert.ok(off <= 2, at(data, item.edge) + ': the number is off its polyline');
      for (const box of [item.numberBox, item.labelBox]) {
        assert.ok(inMargin(box), at(data, item.edge) + ': the pair leaves the canvas margin');
        for (const frame of data.keepOut) {
          assert.ok(
            holds(box, frame),
            at(data, item.edge) + ': the pair touches a block, the band, a caption or the furniture',
          );
        }
        for (const zone of data.zones) {
          assert.ok(toFrame(box, zone) >= CLEARANCE - EPS, at(data, item.edge) + ': the pair sits on a zone frame');
        }
        for (const strip of data.strips) {
          assert.ok(holds(box, strip), at(data, item.edge) + ': the pair stands in a corridor between frames');
        }
      }
      for (const segment of data.segments) {
        assert.ok(holds(item.labelBox, segment), at(data, item.edge) + ': the label lies on a line');
      }
      assert.ok(holds(item.labelBox, item.numberBox), at(data, item.edge) + ': the label lies under its own number');
      for (const other of data.routed) {
        if (other === item) continue;
        for (const segment of segmentFrames([other.line])) {
          assert.ok(holds(item.numberBox, segment), at(data, item.edge) + ': the number stands on another line');
        }
        for (const box of [other.numberBox, other.labelBox]) {
          assert.ok(holds(item.numberBox, box), at(data, item.edge) + ': the pair collides with another pair');
          assert.ok(holds(item.labelBox, box), at(data, item.edge) + ': the pair collides with another pair');
        }
      }
    }
  });
});

/** The whole input of the placer for a route that is not on any sheet - the P4 case. */
const placeInput = (spec: SheetSpec, connectionName: string, polyline: Point[], text: string) => ({
  connectionName,
  polyline,
  text,
  own: segmentFrames([polyline]),
  others: [],
  page: PAGE_FRAME,
  ...framesOf(spec),
});

test('P4 a route with no place names the sheet and the connection only', () => {
  const spec = SHEETS[1] as SheetSpec;
  const buried = [
    { x: 550, y: 120 },
    { x: 550, y: 660 },
  ];
  const connectionName = spec.title + ' связь 7';
  assert.throws(
    () => planConnection(placeInput(spec, connectionName, buried, 'SSH (22/TCP)')),
    (error: Error) => {
      assert.match(error.message, new RegExp('^' + connectionName, 'u'), error.message);
      for (const node of spec.nodes) assert.ok(!error.message.includes(node.id), error.message);
      return true;
    },
  );
});

test('every protocol label is centered on the point its offset names', () => {
  forEachSheet((data) => {
    for (const item of data.routed) {
      const style = data.page.source.targets.get('p' + (item.edge.n as number))?.cell.style ?? '';
      assert.match(style, /align=center/u, at(data, item.edge) + ': the label is not centered horizontally');
      assert.match(style, /verticalAlign=middle/u, at(data, item.edge) + ': the label is not centered vertically');
      assert.equal(
        styleValue(style, 'labelBackgroundColor'),
        'none',
        at(data, item.edge) + ': a label background would hide the line under it',
      );
    }
  });
});
