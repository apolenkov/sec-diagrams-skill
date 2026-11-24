/**
 * The sending copy reads a whole address generously
 * (short masks, dot masks, address-to-address ranges, URLs) and still refuses the broken ones
 * (five parts, /33, a bare slash); the sheet counter is exempt only in the title; a choice is
 * not a question and a bare Cyrillic word before "?" is; "iSCSI (3260/TCP)?" keeps its
 * assumption mark, "REGISTRY.EXAMPLE.ORG" is a leftover template host; wrapper attributes read
 * as sheet text. Addresses come from RFC 5737, hosts from RFC 2606.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { textHitCodes } from './checks/text.ts';
import { codesOf, l1, PROXY, proxyObject, sub } from './checks.test/support.ts';
import { buildModel } from './checks/model.ts';
import { checkFinal } from './checks/final.ts';
import { parseDrawio } from './drawio.ts';
import { loadProfile } from './profile.ts';

const profile = loadProfile();

/** The code list of one label in the copy for sending; masks of the default profile are enough. */
const finalCodes = (text: string): string[] => textHitCodes(text, profile.masks, true);

test('a whole address in the copy: short and dotted masks, ranges and URLs are alone', () => {
  for (const text of [
    'Пул 192.0.2.0/24',
    // Negative fixtures: these prefixes extend outside the documentation block.
    'Пул 192.0.2.0/8',
    'Пул 192.0.2.0/0',
    'Пул 192.0.2.0/32',
    'Пул 192.0.2.0/255.255.255.0',
    'Пул 192.0.2.0/255.255.128.0',
    'Диапазон 192.0.2.10-20',
    'Диапазон 192.0.2.10-192.0.2.20',
    'Правило http://filter.example.org/rules/192.0.2.10/',
    'Правило https://filter.example.org/ui?dst=192.0.2.10',
  ]) {
    assert.deepEqual(finalCodes(text), [], text);
  }
});

test('a broken address in the copy stays a finding: /33, five parts, a bare slash, 256', () => {
  for (const text of [
    'Пул 192.0.2.0/33',
    'Пул 192.0.2.256',
    'Сеть 198.51.100.0.1',
    'Пул 192.0.2.10/',
    'Диапазон 192.0.2.10-8',
    'Диапазон 192.0.2.10-192.0.2.8',
    'Маска 192.0.2.0/255.255.999.0',
  ]) {
    assert.ok(finalCodes(text).includes('SD-T04'), text);
  }
});

test('a five-part address is a finding in the working copy too', () => {
  assert.ok(textHitCodes('Сеть 198.51.100.0.1', profile.masks).includes('SD-T04'));
});

test('a dotted mask must be a run of ones: 255.0.255.0 asks for a re-check', () => {
  // The second octet comes back to ones after zeros - no such net mask exists, and the reviewer reads
  // the value as broken. Continuity belongs to wholeness: a discontinuous mask stays on the
  // line, where hasAddress reports it (text.ts, maskHolds).
  assert.ok(finalCodes('Маска 192.0.2.0/255.0.255.0').includes('SD-T04'), '255.0.255.0');
  assert.ok(finalCodes('Маска 192.0.2.0/255.255.0.255').includes('SD-T04'), '255.255.0.255');
  // The valid ones stay clean: continuity holds from the left edge.
  assert.ok(!finalCodes('Маска 192.0.2.0/255.255.252.0').includes('SD-T04'), '255.255.252.0');
  assert.ok(!finalCodes('Маска 192.0.2.0/255.255.255.128').includes('SD-T04'), '255.255.255.128');
});

test('a label with a value behind the colon ends its question mark as an assumption', () => {
  // «Шлюз: МЭ?» states what the gateway is, with the notation's assumption mark on the value;
  // BARE_QUESTION must not read the last Cyrillic word as a question to the reader. Verbs and
  // choice words behind the colon still ask - those branches answer above BARE_QUESTION.
  for (const text of ['Шлюз: МЭ?', 'Антивирус: Касперский?', 'ОС: Альт?', 'Статус: существующий?', 'Носитель: медь?'])
    assert.ok(!textHitCodes(text, profile.masks).includes('SD-T07'), text);
  // The questions stay questions.
  for (const text of ['Согласуете?', 'Это отдельный VPN?', 'Шлюз: куда?', 'Шлюз: согласовать или нет?'])
    assert.ok(textHitCodes(text, profile.masks).includes('SD-T07'), text);
});

test('the sheet counter is exempt in the title and a finding in an ordinary cell', () => {
  assert.ok(!textHitCodes('L3, лист 1 из 2: Прием телеметрии', profile.masks, false, true).includes('SD-T06'));
  assert.ok(textHitCodes('лист 2 из 3', profile.masks).includes('SD-T06'), 'a bare counter line refers to a sheet');
});

test('a choice is not a question, a bare Cyrillic word ending the line is', () => {
  for (const text of ['Доступ или вход: [поле]', 'ВМ 1 или ВМ 2: [поле]', 'Туннель IPsec?', 'версия: ?']) {
    assert.ok(!textHitCodes(text, profile.masks).includes('SD-T07'), text);
  }
  for (const text of ['Это отдельный VPN?', 'Согласуете?', 'Подключим позже?']) {
    assert.ok(textHitCodes(text, profile.masks).includes('SD-T07'), text);
  }
  assert.ok(
    textHitCodes('Стойка (B12)\nСвязь 4', profile.masks, false).includes('SD-T07'),
    'the rack marker stays as it is',
  );
});

/** The ids SD-T08 names in the copy for sending over a one-cell sheet of the l1 template. */
function stubIds(text: string): Set<string> {
  const drawio = parseDrawio(sub(PROXY, sub('value="Сборщик"', 'value="' + text + '"')(PROXY))(l1()));
  const page = drawio.pages[0] as Parameters<typeof buildModel>[1];
  const model = buildModel('copy.drawio', page, profile, [], true);
  const findings = checkFinal(model);
  const holes = findings.find((found) => found.reasonKey === '');
  return new Set(holes === undefined ? [] : holes.ids);
}

test('SD-T08: the mark after a bracket is an assumption, reserved hosts read case-insensitively', () => {
  assert.ok(!stubIds('Диск iSCSI (3260/TCP)?').has('collector'), 'the bracket closes the assumption mark');
  assert.ok(stubIds('Репозиторий REGISTRY.EXAMPLE.ORG').has('collector'), 'the reserved host in caps is a leftover');
  assert.ok(!stubIds('Файлы archive.example.org.test').has('collector'), "a real .ru host is nobody's example");
  assert.ok(stubIds('Портал portal.example.com').has('collector'));
});

test('wrapper attributes are sheet text: ip and note answer to T03..T08', () => {
  // №17: draw.io paints the wrapper's own attributes as the label; only "label" was checked,
  // so a date or a half address hidden in "note" walked into the copy untouched.
  const codes = codesOf(
    'mutant.drawio',
    sub(
      PROXY,
      proxyObject('label="Сборщик %ip%" placeholders="1" ip="192.0.2.10" note="шлюз заведен 17.08.2032"'),
    )(l1()),
  );
  assert.ok(codes.includes('SD-T03'), 'the date in note reads as a date: ' + codes.join(','));
});

test('wrapper attributes reach the sending rules too: a stub in a wrapper is SD-T08', () => {
  const drawio = parseDrawio(sub(PROXY, proxyObject('label="Пул %ip%" ip="XX.XX.XX.XX"'))(l1()));
  const page = drawio.pages[0] as Parameters<typeof buildModel>[1];
  const model = buildModel('copy.drawio', page, profile, [], true);
  const ids = new Set(checkFinal(model).flatMap((found) => found.ids));
  assert.ok(ids.has('collector'), 'the hole the wrapper paints is a hole');
});

test('named inventory holes and reserved example.invalid hosts remain open in the final copy', () => {
  for (const value of ['Узел [имя].[домен]', 'Экран [модель]', 'Граница [зона]', 'Доступ [срок]', 'Интерфейс [порт хоста]', 'Версия [ID управления]', 'Сервер api.example.invalid']) {
    assert.ok(stubIds(value).has('collector'));
  }
  for (const value of ['[access или trunk]', '[TLS: проверяется]', 'HTTPS (443/TCP)?']) {
    assert.ok(!stubIds(value).has('collector'));
  }
});
