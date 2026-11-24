/**
 * The advice tables of check, split out of check.ts (the size cap): what a code means and what
 * the fix is, kept one screen away from the walk. A reason key can send a code to its own
 * advice; the static per-code line is the last word. Only commands that exist may be named.
 */
import { OPEN_FILLED_KEY } from './checks/final.ts';
import { FINAL_ADDRESS_KEY } from './checks/text.ts';

export const CAUSES: Record<string, { word: string; hint: string }> = {
  'n01-line-without-number': {
    word: 'стрелка без номера',
    hint: 'на каждую стрелку свой номер 1..99: знак числа рисует человек (draw.io), строку «N. ...» в перечень добавит text set',
  },
  'n01-duplicate': {
    word: 'дубль',
    hint: 'у одной связи один номер: убери лишний знак через text set или верни номер второй линии',
  },
  'n01-badge-style': {
    word: 'стиль номера',
    hint: 'номер рисуют белым квадратом с видимой рамкой: поправь стиль знака (style set fillColor, strokeColor)',
  },
  'n01-number-off-line': {
    word: 'номер не на линии',
    hint: 'центр знака должен стоять на линии: подвинь знак в draw.io',
  },
  'n01-number-on-two-lines': {
    word: 'номер на двух линиях',
    hint: 'один номер не может стоять на двух линиях: разведи знаки по линиям в draw.io',
  },
  'n01-gap': {
    word: 'пропуск',
    hint: 'пропуск в номерах не исправляй перенумерацией: снятый номер впиши в manifest.json, в лист sheets[] поле "retired": {"<страница>": [<номер>]} (references/resend.md); снятый номер не занимай, новая связь берет следующий после последнего',
  },
  'n01-retired-taken': {
    word: 'снятый номер занят',
    hint: 'номер из retired в manifest.json не ставь на новую связь: новая связь берет следующий за максимальным (references/resend.md)',
  },
  'n01-no-list-line': {
    word: 'нет строки перечня',
    hint: 'на каждую линию строка перечня «N. ...»: добавь строку через text set',
  },
  'n01-list-line-without-line': {
    word: 'строка перечня без линии',
    hint: 'строка перечня без линии на листе: убери строку (text set) или дорисуй линию (draw.io)',
  },
};

/**
 * A reason key can send a code to its own advice: the same code means something else in a copy
 * for sending, and only the key tells the two apart. Checked before HINTS, after CAUSES.
 */
export const REASON_HINTS: Record<string, string> = {
  [FINAL_ADDRESS_KEY]:
    'адрес заполнен не до конца или с ошибкой: значения в копии для отправки правит человек в draw.io',
  [OPEN_FILLED_KEY]: 'значение заполнено, а отметка осталась: сними отметку командой open --undo <файл> <id>',
};

/** Static per code; only commands that exist may be named as a fix. */
export const HINTS: Record<string, string> = {
  'SD-N01': 'сверь номера связей с перечнем (references/rules.md)',
  'SD-L01':
    'линии сплошные: пунктир убирает style set <файл> <id> dashed=0; пунктир только у рамки статуса с образцом в легенде',
  'SD-L02':
    'style set <файл> <id> strokeColor=<цвет палитры профиля по смыслу связи из легенды>',
  'SD-L03': 'толщина одинаковая, статус показывает заливка: style set <файл> <id> strokeWidth=<как у остальных линий>',
  'SD-L04': 'до первой отправки: fix --safe; после отправки: style set <файл> <id> по одному ключу (rounded=1, jumpStyle=arc, jumpSize=12 для default)',
  'SD-L06': 'сверь подпись протокола на линии и в перечне связей',
  'SD-L05': 'стрелка односторонняя: style set <файл> <id> startArrow=none; обмен в обе стороны рисуют две стрелки',
  'SD-T01': 'ё, «ёлочки» и тире между цифр поправит fix --safe, остальное правь через text set',
  'SD-T02': 'убери косую черту между словами (text set)',
  'SD-T03': 'убери дату (text set)',
  'SD-T04': 'неизвестный адрес закрывает XX.XX.XX.XX (text set)',
  'SD-T05': 'маски только из набора профиля (text set)',
  'SD-T06': 'убери ссылку «лист N» (text set)',
  'SD-T07': 'на листе не спрашивай: неизвестное значение знаком ? ("версия: ?"), сам вопрос в письмо (text set)',
  'SD-T08':
    'значение не заполнено: впиши его в draw.io (значения в копии вписывает человек) или отметь открытым: open <файл> <id>, и внеси в запись о проверке',
  'SD-H01': 'заголовок по шаблону профиля (text set)',
  'SD-P01':
    'кегль на печати A3 выйдет ниже 8 пт: подними fontSize командой style set <файл> <id> fontSize=<число>, или раздели лист',
  'SD-P02': 'страница листа не альбомный A3 1654x1169: задай размер страницы листа в draw.io (references/rules.md)',
  'SD-F01':
    'fix --safe допишет шрифт из профиля; если шрифт править не надо, перепиши подпись через text set без разметки шрифта',
};

/** A remaining issue whose safe edit plan is empty needs a targeted change. */
export const MANUAL_FIX: Record<string, string> = {
  'SD-T01': 'поправь знаки в подписи через text set',
  'SD-F01': 'проверь шрифт и разметку подписи в draw.io',
  'SD-L04': 'примени style set <файл> <id> по одному ключу: rounded=1, jumpStyle=arc, jumpSize=12 для default',
};
