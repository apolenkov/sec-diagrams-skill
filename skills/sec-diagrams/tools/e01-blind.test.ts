/**
 * The blindener of SD-E01 keeps its shapes honest: the line and column position
 * survives, a real sheet name - with commas, №, underscores, brackets and spaces - survives too,
 * and the refusal of a point edit ("правка отклонена, файл не изменен") is not flattened into
 * "лист не читается". Anything unshaped, and every value inside it, still collapses to the one
 * blind sentence. Addresses are from RFC 5737.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLIND_E01, blindMessage } from './e01-blind.ts';

test('the position of a parse error survives the blindening', () => {
  for (const message of [
    'page "L1 (Общая схема)": 12:5: unexpected token.',
    'file: 3:1: text outside elements.',
    'page "L2": 7:14: attribute is repeated.',
  ])
    assert.equal(blindMessage(message), message, message);
});

test('a sheet name of any real shape opens the wrapper, the file part stays readable', () => {
  for (const name of [
    'Общая схема__L1.drawio',
    'L3-1, доступ администраторов_2.drawio',
    'Карта сетевой фильтрации.drawio',
    'лист №3 (черновик), новый.drawio',
  ]) {
    for (const inner of ['no such file', 'лист не читается']) {
      const message = name + ': ' + inner;
      assert.equal(blindMessage(message), message, message);
    }
    const wrapped = name + ': page "L1": 4:2: attribute is repeated.';
    assert.equal(blindMessage(wrapped), wrapped, wrapped);
  }
});

test('the refusal of a point edit is not flattened into an unreadable sheet', () => {
  const message = 'правка отклонена, файл не изменен: лист после правки не читается (page "L1": 3:9: unclosed token.)';
  assert.equal(blindMessage(message), message);
  // The lead of the sentence alone is also a known shape: the reader must see what happened.
  const bare = 'правка отклонена, файл не изменен: лист после правки не читается (malformed XML)';
  assert.equal(blindMessage(bare), bare);
});

test('anything unshaped, and every value inside it, collapses to the blind sentence', () => {
  for (const message of [
    'unexpected at 198.51.100.7 in draft',
    'l1.drawio: 192.0.2.10 is not a cell',
    'page "L1": value "шлюз 203.0.113.5" repeated',
  ])
    assert.equal(blindMessage(message), BLIND_E01, message);
});
