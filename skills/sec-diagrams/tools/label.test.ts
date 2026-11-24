import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelText, labelFonts, cleanFont, firstFamily } from './label.ts';
import { asksReader, slashCount, textHitCodes } from './checks/text.ts';

test('block tags split a label into lines, inline tags vanish', () => {
  assert.equal(
    labelText('1. HTTPS (443/TCP) - доступ<br>2. SSH (22/TCP) - вход'),
    '1. HTTPS (443/TCP) - доступ\n2. SSH (22/TCP) - вход',
  );
  assert.equal(labelText('<div>Сервер</div><div><b>сборки</b></div>'), 'Сервер\nсборки');
  assert.equal(labelText('<br/>Сборщик<br />'), 'Сборщик');
  assert.equal(labelText('<span style="font-weight:bold">МЭ</span>'), 'МЭ');
});

test('hidden runs stay out and character references decode once', () => {
  assert.equal(labelText('видно<span style="display:none">скрыто</span>'), 'видно');
  assert.equal(labelText('a&amp;lt;b'), 'a&lt;b');
  assert.equal(labelText('&laquo;x&raquo;'), '«x»');
  assert.equal(labelText('a < b'), 'a < b');
});

test('fonts come from face, font-family and the font shorthand', () => {
  assert.deepEqual(labelFonts('<font face="Courier New">x</font>').map(cleanFont), ['courier new']);
  assert.deepEqual(labelFonts('<span style="font-family: Arial !important">x</span>').map(cleanFont), ['arial']);
});

test('a font name survives quotes, stacks and character references', () => {
  // Browsers serialize a family with spaces in quotes, and inside an attribute the quotes are
  // character references; a stack lists alternatives after a comma. The first family is the one
  // the page really renders, so a quoted Arial must not look alien and a quoted Courier must.
  const stack = (value: string): string[] => labelFonts(value).map(firstFamily);
  assert.deepEqual(stack('<span style="font-family: &quot;Times New Roman&quot;;">x</span>'), ['times new roman']);
  assert.deepEqual(stack('<span style="font-family: \'Courier New\';">x</span>'), ['courier new']);
  assert.deepEqual(stack('<span style="font-family: Arial, sans-serif">x</span>'), ['arial']);
  assert.deepEqual(stack('<font face="Courier New">x</font>'), ['courier new']);
});

test('a value with "?" is an assumption, a question to the reader is not', () => {
  // a bare Cyrillic word closing the line on the mark asks the reader, the way
  // "Согласуете?" does - "Веб-сервер?" waits for a yes or a no just the same.
  for (const text of [
    'Citrix?',
    '?',
    'HTTPS (443/TCP)?',
    '1. SSH (22/TCP) - вход администратора?',
    '1. Доступ к ВМ 1 или 2 - SSH (22/TCP)?',
    '1. SSH (22/TCP)? - доступ к ВМ 1 или 2',
  ]) {
    assert.equal(asksReader(text), false, text);
  }
  assert.equal(asksReader('Веб-сервер?'), true, 'a bare Cyrillic word on the mark is a question');
  for (const text of ['1. Доступ к ВМ 1 или 2? - SSH (22/TCP)', '1. SSH (22/TCP) - доступ к ВМ 1 или 2?']) {
    assert.equal(asksReader(text), true, text);
  }
  for (const text of [
    'Какой порт нужен?',
    'вопрос 3',
    'Сервер (В2)',
    'адрес уточняется',
    'порт??',
    'TLS или нет?',
    'Нужен ли прокси',
    'Подтвердите порт 443?',
    '? порт',
  ]) {
    assert.equal(asksReader(text), true, text);
  }
});

test('a question is judged line by line, by its mark or its word', () => {
  // №2 and №6 of the review: words only at the line start missed real questions, and the
  // joined cell made a statement line answer to a "?" standing in another line. A question is
  // now a line that ends with "?" and carries a question word (or the particle "ли", which
  // asks by itself), plus the old markers. "Это отдельный VPN?" stays unseen: without any
  // mark the rule would start erasing ordinary labels, and the miss is the accepted price.
  for (const text of [
    'Внешние репозитории\nКакого типа VPN?',
    'Датчик\nТребуется ли PAM?',
    'Шлюз датчиков\nЧерез какой МЭ идет трафик?',
    'Какую подсеть выделит площадка?',
    'В каком сегменте стоит PAM?',
    'Используется ли TLS?',
    'Чей МЭ?',
    'Через МЭ-1, верно?',
    'Это VPN или нет?',
  ]) {
    assert.equal(asksReader(text), true, text);
  }
  for (const text of [
    'Как сейчас',
    'Сколько ВМ: 4',
    'PAM: использовать штатный, модель: ?',
    'Сборщик,\nчто пускает в Интернет',
    'Не больше,\nчем 2 узла',
    'Кто: администраторы',
    'Где: ЦОД',
    'Что согласуем',
    '1. Доступ администратора к рабочему\nконтуру - SSH (22/TCP)\n2. нужен для работы в среде\n3. HTTPS (443/TCP)?',
  ]) {
    assert.equal(asksReader(text), false, text);
  }
});

test('versions and volumes are not dates; written dates are, to the end of the sentence', () => {
  // №1 and №4 of the review: "Nexus 3.76.10" read as a date, "4 узла 6443" read as "day month
  // year", while "доступ до 31.08.2032." hid behind the sentence dot and the sheet knew only
  // the dotted form. A real date is a valid day, a valid month and a full four-digit year -
  // versions (two-digit year) and "99.99.9999" have none of this.
  for (const text of [
    'Nexus 3.76.10',
    'Deckhouse 1.67.10',
    'Keycloak 26.0.12',
    'k8s 1.31.10',
    'Nexus 3.10.12',
    '2 диска 1920 ГБ',
    '4 узла 6443',
    '8 ядер 2400 МГц',
    '99.99.9999',
  ]) {
    assert.ok(!textHitCodes(text, []).includes('SD-T03'), text);
  }
  for (const text of [
    'доступ до 31.08.2032.',
    'с 2026-11-20',
    'до 31.08.2032 г.',
    'отчет 20/11/2026',
    'с 20 нояб. 2026',
    '31.08.2032',
    'срок 25 декабря 2026',
  ]) {
    assert.ok(textHitCodes(text, []).includes('SD-T03'), text);
  }
  assert.ok(!textHitCodes('Пул 192.0.2.10', []).includes('SD-T03'), 'an address is not a date');
});

test('a page reference is seen in any case and before the sentence dot', () => {
  // only the bare "лист N" was known, and a dot after the number hid the
  // reference. The sheet's own counter "Лист 2 из 3" stays allowed when it is the whole line.
  for (const text of [
    'подробнее см. лист 3.',
    'связь 14 на листе 3',
    'связь 5 листа 2',
    'см. листы 2 и 3',
    'см. лист №2',
    'см. L3, лист 2 из 3',
    'см. стр. 5.',
  ]) {
    assert.ok(textHitCodes(text, []).includes('SD-T06'), text);
  }
  // a bare counter line in an ordinary cell refers to another sheet; only the
  // title counts the sheet's own pages.
  assert.ok(textHitCodes('лист 2 из 3', []).includes('SD-T06'), 'a bare counter line refers to a sheet');
  assert.ok(
    !textHitCodes('L3, лист 1 из 2: Доступ', [], false, true).includes('SD-T06'),
    'the title carries the counter',
  );
  assert.ok(!textHitCodes('Листинг 3', []).includes('SD-T06'));
});

test('a half-open address hides behind any spelling of the hole', () => {
  // "192.0.2.x", "192.0.2.*", a Cyrillic ХХ, a bracketed field or "?" all
  // left the three real octets unreported, while the latin "XX" was caught.
  for (const text of [
    '192.0.2.x',
    '192.0.2.X',
    '192.0.2.*',
    '198.51.100.X',
    '192.0.2.ХХ',
    '192.0.2.[поле]',
    '192.0.2.?',
    '192.0.2.XX',
  ]) {
    assert.ok(textHitCodes(text, []).includes('SD-T04'), text);
  }
  for (const text of ['XX.XX.XX.XX', 'x.x.x.x', '[поле] [поле]', '192.0.2.x86']) {
    assert.deepEqual(textHitCodes(text, []), [], text);
  }
});

test('a wrapped list item may keep " - " in its continuation', () => {
  // draw.io wraps "1. длинный доступ - SSH (22/TCP)" at any width, and the
  // tail with " - " failed SD-T01 although the number is on the first fragment. A line right
  // after a list line continues it; the number reaches three digits.
  const list =
    '1. Доступ администратора к рабочему\nконтуру - SSH (22/TCP)\n2. Доступ пула - HTTPS (443/TCP)' +
    '\n300. Длинный перечень - RDP (3389/TCP)';
  assert.deepEqual(textHitCodes(list, []), []);
  assert.ok(textHitCodes('Заметка - пояснение', []).includes('SD-T01'));
});

test('word slashes count, ports, networks, paths and TCP/UDP do not', () => {
  assert.equal(slashCount('прокси/МЭ'), 1);
  assert.equal(slashCount('чтение / запись'), 1);
  for (const text of ['443/TCP', 'XX.XX.XX.XX/24', 'TCP/UDP', 'https://registry.example.org/v2/', '/var/lib/data']) {
    assert.equal(slashCount(text), 0, text);
  }
});
