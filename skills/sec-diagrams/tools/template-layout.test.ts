/**
 * The layout contract of the four template sheets, read from the data the generator produces.
 * Run as one suite: the parts below register the tests against the shared harness.
 *
 * routes.ts (R1-R6): a polyline stays inside the band the zones draw - never up in the sheet
 * title, never down in the list or the legend; every line whose ends stand on opposite sides of
 * the МЭ (the corporate network or the Internet against the contour) cuts the firewall band
 * across on exactly one horizontal segment, from its left edge to its right one; no segment runs along the
 * side of a zone, band or block frame; the corridor between two neighbouring frames is crossed,
 * not followed; no segment touches the МЭ glyph and its 4 px guard; two parallel segments of
 * different lines whose projections overlap by more than 20 px keep 40 px between them, the
 * gray denied line included - only a fan of short stubs at one side of one block comes closer.
 *
 * pairs.ts (P2-P4): the number hangs on a piece of the polyline cut at every frame it crosses,
 * and that piece lies whole in one zone or whole outside all of them, off the band and off the
 * blocks; both labels keep CLEARANCE from every frame side, caption, sheet frame, corridor,
 * line, number and label; with no such piece the generator names the sheet and the connection
 * and stops.
 *
 * export.ts: the sheet furniture stays on the canvas, and draw.io itself - labels are centered
 * on the point their offset names, so a real SVG export lands where the plan says. That check
 * runs with SD_DRAWIO_IT=1 (SD_DRAWIO points at the binary) and measures the painted pair
 * against the planned one, the bordered frame of the number included: it must be the size the
 * placer sizes clear, keep 4 px from the protocol text and never sit on a frame.
 */
import './template-layout.test/routes.ts';
import './template-layout.test/pairs.ts';
import './template-layout.test/export.ts';
