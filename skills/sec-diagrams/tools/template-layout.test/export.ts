/**
 * The sheet as a whole, and the claim the whole placement work rests on: draw.io paints the
 * pair exactly where the plan says.
 *
 * Every frame stays inside the canvas with its 20 px margin; the work station reads as a
 * monitor. Then the real export: draw.io cuts the page and shifts it, but an html label whose
 * div centers both ways comes out centered on the point path+offset names. The check sets
 * SD_DRAWIO_IT=1 and points SD_DRAWIO at the binary (the name the pdf command uses),
 * exports every template to SVG, reads each label back by its data-cell-id, and compares
 * the painted pair with the pair the file planned - the bordered frame of the number
 * included, so the frame the placer sizes on cannot drift away from the frame draw.io paints.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { styleValue } from '../drawio.ts';
import { loadProfile } from '../profile.ts';
import { buildModel } from '../checks/model.ts';
import { SHAPES, type ZoneSpec } from '../template-cells.ts';
import { NUMBER_H, NUMBER_W, gap, type Point, type Rect } from '../template-geometry.ts';
import { EPS, at, distanceToLine, forEachSheet, geometryOf, inMargin, sheetsData, type SheetData } from './support.ts';

const profile = loadProfile();

test('every frame stays inside the canvas with its 20 px margin', () => {
  forEachSheet((data) => {
    const model = buildModel(data.name, data.page, profile, []);
    const edgeIds = new Set(data.page.cells.filter((cell) => cell.edge).map((cell) => cell.id));
    const parents = new Map(data.page.cells.map((cell) => [cell.id, cell.parent]));
    for (const cell of model.allCells) {
      if (cell.box === null || !cell.vertex || edgeIds.has(parents.get(cell.id) ?? '')) continue;
      assert.ok(inMargin(cell.box), data.name + ': a frame sits outside the canvas margin');
    }
  });
});

test('servers use the network server glyph', () => {
  forEachSheet((data) => {
    for (const node of data.spec.nodes) {
      if (node.icon !== 'server') continue;
      const target = data.page.source.targets.get(node.id + '-icon');
      if (target === undefined) throw new Error('no icon for ' + node.id);
      assert.equal(styleValue(target.cell.style, 'shape'), SHAPES.server, data.name + ': the wrong server glyph');
    }
  });
});

const drawioBin = process.env['SD_DRAWIO'] ?? '/Applications/draw.io.app/Contents/MacOS/draw.io';

/** The export crops the page: every coordinate of the sheet comes out shifted by the same amount. */
function exportShift(svg: string, band: ZoneSpec): Point {
  const group = svg.slice(svg.indexOf('data-cell-id="' + band.id + '"'));
  const frame = /<rect x="([-\d.]+)" y="([-\d.]+)"/u.exec(group);
  if (frame === null) throw new Error('the export shows no firewall frame');
  return { x: band.x - Number(frame[1]), y: band.y - Number(frame[2]) };
}

/** The box draw.io painted for a label: the raster image of its group, in sheet coordinates. */
function exportedBox(svg: string, id: string, shift: Point): Rect {
  const group = svg.slice(svg.indexOf('data-cell-id="' + id + '"'));
  const image = /<image x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/u.exec(group);
  if (image === null) throw new Error('the export shows no painted label ' + id);
  const x = Number(image[1]);
  const y = Number(image[2]);
  const w = Number(image[3]);
  const h = Number(image[4]);
  return { x1: x + shift.x, y1: y + shift.y, x2: x + w + shift.x, y2: y + h + shift.y };
}

/** Whether the box crosses the side of a frame rather than lying whole to one side of it. */
const straddles = (box: Rect, side: number, along: 'x' | 'y', from: number, to: number): boolean => {
  const near = along === 'x' ? box.x1 : box.y1;
  const far = along === 'x' ? box.x2 : box.y2;
  const spanFrom = along === 'x' ? box.y1 : box.x1;
  const spanTo = along === 'x' ? box.y2 : box.x2;
  return near < side - 1 && far > side + 1 && Math.min(spanTo, to) > Math.max(spanFrom, from);
};

/** The least distance the painted protocol text may stand from the painted number frame. */
const PAINTED_FRAME_GAP = 4;

/** The center draw.io paints an html label at: the div anchor, which is the center when both alignments center. */
function exportedCenter(svg: string, id: string): Point {
  const group = svg.slice(svg.indexOf('data-cell-id="' + id + '"'));
  const div = /<div[^>]*style="([^"]*)"/u.exec(group);
  if (div === null) throw new Error('the export shows no label ' + id);
  const style = div[1] ?? '';
  for (const key of ['align-items', 'justify-content']) {
    assert.match(style, new RegExp(key + ': unsafe center', 'u'), 'the exported label ' + id + ' is not centered');
  }
  return {
    x: Number(/margin-left: ([-\d.]+)px/u.exec(style)?.[1] ?? 'NaN'),
    y: Number(/padding-top: ([-\d.]+)px/u.exec(style)?.[1] ?? 'NaN'),
  };
}

test('draw.io puts every label exactly where the plan says', (t) => {
  if (process.env['SD_DRAWIO_IT'] !== '1') {
    t.skip('set SD_DRAWIO_IT=1 to check the templates against a real draw.io export');
    return;
  }
  if (!existsSync(drawioBin)) {
    t.skip('draw.io is not at ' + drawioBin + ': set SD_DRAWIO to its binary');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'sd-layout-'));
  try {
    for (const data of sheetsData()) {
      const sheet = join(dir, data.name);
      writeFileSync(sheet, data.content);
      const svgPath = join(dir, data.name.replace('.drawio', '.svg'));
      const run = spawnSync(drawioBin, ['-x', '-f', 'svg', '-o', svgPath, sheet], { encoding: 'utf8' });
      assert.equal(run.status, 0, data.name + ': draw.io could not export the sheet');
      const svg = readFileSync(svgPath, 'utf8');
      const shift = exportShift(svg, data.spec.firewalls[0]!);
      for (const item of data.routed) {
        const badge = item.edge.n as number;
        const number = exportedCenter(svg, 'n' + badge);
        const label = exportedCenter(svg, 'p' + badge);
        const offset = geometryOf(data.page, 'p' + badge).offset;
        assert.ok(
          Math.abs(label.x - number.x - offset.x) <= 2 && Math.abs(label.y - number.y - offset.y) <= 2,
          at(data, item.edge) + ': the exported label is not labelOffset away from its number',
        );
        const onLine = distanceToLine({ x: number.x + shift.x, y: number.y + shift.y }, [item.line]);
        assert.ok(onLine <= 2, at(data, item.edge) + ': the exported number is off its line');
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Export one sheet with the configured draw.io: its SVG and the shift the crop applied. */
function exportedSheet(data: SheetData, dir: string): { svg: string; shift: Point } {
  const sheet = join(dir, data.name);
  writeFileSync(sheet, data.content);
  const svgPath = join(dir, data.name.replace('.drawio', '.svg'));
  const run = spawnSync(drawioBin, ['-x', '-f', 'svg', '-o', svgPath, sheet], { encoding: 'utf8' });
  assert.equal(run.status, 0, data.name + ': draw.io could not export the sheet');
  const svg = readFileSync(svgPath, 'utf8');
  return { svg, shift: exportShift(svg, data.spec.firewalls[0]!) };
}

test('draw.io paints the number frame the size the placer keeps clear, and clear itself', (t) => {
  if (process.env['SD_DRAWIO_IT'] !== '1') {
    t.skip('set SD_DRAWIO_IT=1 to check the templates against a real draw.io export');
    return;
  }
  if (!existsSync(drawioBin)) {
    t.skip('draw.io is not at ' + drawioBin + ': set SD_DRAWIO to its binary');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'sd-number-'));
  try {
    for (const data of sheetsData()) {
      const { svg, shift } = exportedSheet(data, dir);
      for (const item of data.routed) {
        const badge = item.edge.n as number;
        const frame = exportedBox(svg, 'n' + badge, shift);
        const label = exportedBox(svg, 'p' + badge, shift);
        assert.ok(
          gap(label, frame) >= PAINTED_FRAME_GAP - EPS,
          at(data, item.edge) +
            ': the protocol label stands nearer than ' +
            PAINTED_FRAME_GAP +
            ' px to the number frame',
        );
        assert.ok(
          Math.abs(frame.x2 - frame.x1 - NUMBER_W) <= 1 && Math.abs(frame.y2 - frame.y1 - NUMBER_H) <= 1,
          at(data, item.edge) + ': the number frame is not the size the placer sizes clear',
        );
        const center = { x: (frame.x1 + frame.x2) / 2, y: (frame.y1 + frame.y2) / 2 };
        // The export rounds the anchor to whole pixels and the raster hangs the font's descent
        // below it: four px is the slack of paint, four more would be the placer being wrong.
        assert.ok(
          Math.abs(center.x - (item.numberBox.x1 + item.numberBox.x2) / 2) <= 4 &&
            Math.abs(center.y - (item.numberBox.y1 + item.numberBox.y2) / 2) <= 4,
          at(data, item.edge) + ': the painted number frame is not where the placer put it',
        );
        for (const solid of data.solids) {
          assert.ok(
            gap(frame, solid) >= 2,
            at(data, item.edge) + ': the number frame sits on a block, the band or the МЭ glyph',
          );
        }
        for (const zone of data.zones) {
          assert.ok(
            !straddles(frame, zone.x1, 'x', zone.y1, zone.y2) &&
              !straddles(frame, zone.x2, 'x', zone.y1, zone.y2) &&
              !straddles(frame, zone.y1, 'y', zone.x1, zone.x2) &&
              !straddles(frame, zone.y2, 'y', zone.x1, zone.x2),
            at(data, item.edge) + ': the number frame crosses a zone frame',
          );
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
