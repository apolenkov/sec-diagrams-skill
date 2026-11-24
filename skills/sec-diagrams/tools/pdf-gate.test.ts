import { pdfTestOptions } from './pdf-fixtures.ts';
/**
 * Exercise the PDF geometry and fit checks with synthetic pages.
 * Fixtures are built in memory; no PDF files are written.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRINTABLE_AREA_MM2,
  PT_PER_MM,
  checkPdf,
  isA3,
  isA3Landscape,
  isPageMetrics,
  mupdfEngine,
  silenceBackendDiagnostics,
  unionArea,
  type GateReport,
  type PageMetrics,
} from './pdf-gate.ts';
import { fitPdfA3 } from './pdf-fit.ts';
import { FIXTURES, TOKEN, buildPdf } from './pdf-fixtures.ts';
import type { FixtureName } from './pdf-fixtures.ts';

// The unreadable-file fixture is deliberately malformed; keep the engine quiet, as the
// Python tool does with `mupdf_display_errors(False)`.
silenceBackendDiagnostics();

// The gate reads its engine through the lazy backend; load it once for the whole file.

function bytesOf(name: FixtureName): Uint8Array {
  return FIXTURES[name]();
}

function metricsAt(report: GateReport, index: number): PageMetrics {
  const metrics = report.pages[index]?.metrics;
  if (metrics === undefined || !isPageMetrics(metrics)) throw new Error('page has no metrics');
  return metrics;
}

function errorsAt(report: GateReport, index: number): number[] {
  const errors = report.pages[index]?.errors;
  if (errors === undefined) throw new Error('page is missing');
  return errors;
}

function pageTexts(bytes: Uint8Array): string[] {
  const document = mupdfEngine().Document.openDocument(bytes, 'application/pdf');
  const texts: string[] = [];
  for (let index = 0; index < document.countPages(); index += 1) {
    texts.push(document.loadPage(index).toStructuredText('preserve-whitespace').asText().trim());
  }
  return texts;
}

const almostEqual = (value: number, expected: number, tolerance = 5e-8): void => {
  assert.ok(Math.abs(value - expected) < tolerance, `${value} is not close to ${expected}`);
};

const pdfTest = await pdfTestOptions();

test('test_empty_and_zero_area', () => {
  assert.equal(unionArea([]), 0);
  assert.equal(unionArea([[0, 0, 0, 10]]), 0);
});

test('test_overlap', () => {
  assert.equal(
    unionArea([
      [0, 0, 10, 10],
      [5, 5, 15, 15],
    ]),
    175,
  );
});

test('test_nested_and_duplicate', () => {
  assert.equal(
    unionArea([
      [0, 0, 10, 10],
      [2, 2, 8, 8],
      [0, 0, 10, 10],
    ]),
    100,
  );
});

test('test_touching', () => {
  assert.equal(
    unionArea([
      [0, 0, 10, 10],
      [10, 0, 20, 10],
    ]),
    200,
  );
});

test('test_disjoint_and_same_x_events', () => {
  assert.equal(
    unionArea([
      [0, 0, 2, 3],
      [2, 0, 4, 3],
      [0, 4, 4, 5],
    ]),
    16,
  );
});

test('test_invalid_rectangle', () => {
  for (const rectangle of [
    [1, 0, 0, 1],
    [0, 0, Number.POSITIVE_INFINITY, 1],
  ] as const) {
    assert.throws(() => unionArea([rectangle]), RangeError);
  }
});

test('test_portrait_landscape_printable_area', () => {
  assert.ok(isA3(297, 420));
  assert.ok(isA3(420, 297));
  assert.ok(!isA3(210, 297));
  for (const [width, height] of [
    [400, 277],
    [277, 400],
  ] as const) {
    almostEqual(unionArea([[0, 0, width * PT_PER_MM, height * PT_PER_MM]]) / PT_PER_MM ** 2, PRINTABLE_AREA_MM2, 1e-9);
    almostEqual(unionArea([[0, 0, width, height / 2]]) / PRINTABLE_AREA_MM2, 0.5);
  }
});

test('test_eight_pt_passes_exact', pdfTest, () => {
  const result = checkPdf(bytesOf('eight_pt_passes_exact'));
  assert.equal(result.status, 'PASS', JSON.stringify(result));
  assert.equal(metricsAt(result, 0).minimum_font_pt, 8);
});

test('test_seven_pt_fails', pdfTest, () => {
  const result = checkPdf(bytesOf('seven_pt_fails'));
  assert.equal(result.status, 'FAIL');
  assert.ok(errorsAt(result, 0).includes(3));
});

test('test_fractional_below_eight_fails_without_integer_rounding', pdfTest, () => {
  const result = checkPdf(bytesOf('fractional_below_eight_fails_without_integer_rounding'));
  assert.ok(errorsAt(result, 0).includes(3));
  assert.ok((metricsAt(result, 0).minimum_font_pt ?? 8) < 8);
});

test('test_all_physical_pages_and_rotation', pdfTest, () => {
  const result = checkPdf(bytesOf('all_physical_pages_and_rotation'));
  assert.deepEqual(
    result.pages.map((page) => page.page),
    [1, 2],
  );
  assert.deepEqual(
    result.pages.map((page) => page.status),
    ['PASS', 'FAIL'],
  );
});

test('test_margin_failure', pdfTest, () => {
  assert.ok(checkPdf(bytesOf('margin_failure')).pages[0]?.warnings.includes(2));
});

test('test_off_page_text_not_clipped_away', pdfTest, () => {
  const report = checkPdf(bytesOf('off_page_text_not_clipped_away'));
  assert.equal(report.status, 'FAIL');
  assert.ok(errorsAt(report, 0).includes(5));
});

test('test_wrong_sheet', pdfTest, () => {
  assert.ok(checkPdf(bytesOf('wrong_sheet')).pages[0]?.warnings.includes(1));
});

test('test_crop_is_unverified', pdfTest, () => {
  const result = checkPdf(bytesOf('crop_is_unverified'));
  assert.equal(result.status, 'UNVERIFIED');
  assert.ok(errorsAt(result, 0).includes(105));
});

test('test_no_text_vector_only_unverified', pdfTest, () => {
  const result = checkPdf(bytesOf('no_text_vector_only_unverified'));
  assert.equal(result.status, 'UNVERIFIED');
  assert.ok(errorsAt(result, 0).includes(101));
});

test('test_raster_with_extracted_text_unverified', pdfTest, () => {
  const result = checkPdf(bytesOf('raster_with_extracted_text_unverified'));
  assert.equal(result.status, 'UNVERIFIED');
  assert.ok(errorsAt(result, 0).includes(104));
});

test('a measured violation stays FAIL on a page that also carries raster', pdfTest, () => {
  // a raster must not launder a 7 pt cell into UNVERIFIED - the reviewer sees both defects.
  const bytes = buildPdf({
    pages: [
      {
        widthMm: 420,
        heightMm: 297,
        lines: [{ x: 50, y: 60, size: 7 }],
        image: { x: 150, y: 120, width: 50, height: 50 },
      },
    ],
  });
  const result = checkPdf(bytes);
  assert.equal(result.status, 'FAIL', JSON.stringify(result));
  assert.ok(errorsAt(result, 0).includes(3), 'the кегль code survives');
  assert.ok(errorsAt(result, 0).includes(104), 'the raster code is still reported');
});

test('test_hidden_text_unverified', pdfTest, () => {
  const result = checkPdf(bytesOf('hidden_text_unverified'));
  assert.equal(result.status, 'UNVERIFIED');
  assert.ok(errorsAt(result, 0).includes(102));
});

test('test_zero_opacity_unverified', pdfTest, () => {
  assert.ok(errorsAt(checkPdf(bytesOf('zero_opacity_unverified')), 0).includes(102));
});

test('test_density_over_half', pdfTest, () => {
  const result = checkPdf(bytesOf('density_over_half'));
  const metrics = metricsAt(result, 0);
  assert.ok(metrics.text_area_fraction > 0.5);
  assert.equal(metrics.outside_margin_line_count, 0);
  assert.equal(result.status, 'PASS');
  assert.ok(result.pages[0]?.warnings.includes(4));
});

test('test_duplicate_lines_count_union_once', pdfTest, () => {
  const duplicated = metricsAt(checkPdf(bytesOf('duplicate_lines_count_union_once')), 0);
  const single = metricsAt(checkPdf(bytesOf('single_line_union_reference')), 0);
  almostEqual(single.line_rectangle_union_mm2, duplicated.line_rectangle_union_mm2, 1e-6);
});

test('test_cli_json_and_no_text_or_path', pdfTest, () => {
  const json = JSON.stringify(checkPdf(bytesOf('cli_json_and_no_text_or_path')));
  assert.equal(json.includes('"status":"PASS"'), true);
  assert.equal(json.includes(TOKEN), false);
  assert.equal(json.includes('/tmp/pdf-gate-synthetic/synthetic.pdf'), false);
});

test('test_unreadable_file_no_details', pdfTest, () => {
  assert.deepEqual(checkPdf(bytesOf('unreadable_file_no_details')), {
    status: 'UNVERIFIED',
    errors: [106],
    pages: [],
  });
});

test('test_source_bytes_unchanged', pdfTest, () => {
  const bytes = bytesOf('source_bytes_unchanged');
  const before = Uint8Array.from(bytes);
  checkPdf(bytes);
  assert.deepEqual(bytes, before);
});

test('test_vector_fit_fits_every_page_into_landscape_a3', pdfTest, () => {
  const source = bytesOf('vector_fit_preserves_multiple_pages_and_orientations');
  const before = Uint8Array.from(source);
  const fitted = fitPdfA3(source, 'auto');
  assert.deepEqual(source, before, 'fitting must not touch the source bytes');

  const result = checkPdf(fitted);
  assert.equal(result.status, 'PASS', JSON.stringify(result));
  assert.equal(result.pages.length, 2);
  // The fitter uses landscape A3 on every sheet (SD-P02): the tall page goes onto a landscape sheet too.
  for (const page of result.pages) {
    assert.ok(metricsAt(result, page.page - 1).width_mm > 400, 'page ' + page.page + ' is landscape A3');
    assert.equal(metricsAt(result, page.page - 1).image_count, 0);
  }
  assert.deepEqual(pageTexts(fitted), pageTexts(source));
});

test('test_mixed_sizes_still_fail_after_fitting_in_any_order', pdfTest, () => {
  for (const order of [
    [20, 6, 12],
    [6, 20, 12],
    [12, 6, 20],
  ] as const) {
    const source = buildPdf({
      pages: [
        {
          widthMm: 400,
          heightMm: 277,
          lines: [
            { x: 50, y: 60, size: order[0] },
            { x: 50, y: 120, size: order[1] },
            { x: 50, y: 180, size: order[2] },
          ],
        },
      ],
    });
    const result = checkPdf(fitPdfA3(source, 'auto'));
    assert.equal(result.status, 'FAIL', 'the 6 pt span must survive fitting: ' + order.join('/'));
    assert.ok(errorsAt(result, 0).includes(3));
    almostEqual(metricsAt(result, 0).minimum_font_pt ?? Number.POSITIVE_INFINITY, 6);
  }
});

test('portrait A3 passes with a landscape warning', pdfTest, () => {
  const bytes = buildPdf({ pages: [{ widthMm: 297, heightMm: 420, lines: [{ x: 50, y: 60, size: 8 }] }] });
  const result = checkPdf(bytes);
  assert.equal(result.status, 'PASS', 'landscape A3 is author advice');
  assert.ok(result.pages[0]?.warnings.includes(1));
});

test('test_only_landscape_a3_is_the_print_sheet', pdfTest, () => {
  assert.ok(isA3Landscape(420, 297));
  assert.ok(!isA3Landscape(297, 420), 'a portrait page is not the sheet the reviewer prints');
  assert.ok(isA3(297, 420), 'the paper may be A3 turned: the rotation test proves it prints');
});

test('test_vector_fit_refuses_in_place_edit', pdfTest, () => {
  const bytes = bytesOf('eight_pt_passes_exact');
  assert.throws(() => fitPdfA3(bytes, 'auto', bytes), RangeError);
});
