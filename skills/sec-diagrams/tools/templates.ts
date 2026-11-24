/**
 * Synthetic A3 templates for init, and the init command itself.
 *
 * The templates are the sample an agent repeats: every sheet is marked (the legend carries
 * "sdRole=legend") so that check can tell a skill sheet from one drawn by hand. The drawing
 * primitives live in template-cells.ts, the four sheets as data in template-sheets.ts. The
 * generator is deterministic: regenerating must give byte-identical files, so a template edit
 * is a visible diff. The manifest lists the filter map, which the rules command generates
 * from the sample YAML.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { sheetCells, sheetXml } from './template-cells.ts';
import { SHEETS } from './template-sheets.ts';

import { nodeCommand, shellQuote } from './shell.ts';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

export interface TemplateFile {
  name: string;
  content: string;
}

const MANIFEST = {
  service: 'Служба ИБ',
  titlePrefix: '',
  // The field confirms the working copy to the value guard: text reads and writes happen only
  // where the manifest passes the schema and says "final": false.
  final: false,
  sheets: [
    // The rules page goes first when the packet includes it. The rules command builds it.
    { file: 'Карта сетевой фильтрации.drawio', level: '', topic: 'Карта сетевой фильтрации' },
    { file: 'l1.drawio', level: 'L1', topic: 'Общая схема' },
    { file: 'l2.drawio', level: 'L2', topic: 'Зоны и узлы' },
    { file: 'l3-2.drawio', level: 'L3-2', topic: 'Хранение измерений' },
    { file: 'l3-1.drawio', level: 'L3-1', topic: 'Прием телеметрии' },
  ],
};

const EXAMPLE_YAML = `# Пример для команды rules.
sheet: "Карта сетевой фильтрации"
tables:
  - from: "Датчики"
    to: "Прием телеметрии"
    rows:
      - action: allow
        link: "L3-1:1"
        proto: "TCP"
        port: "443"
        dst: "Сборщик"
        dst_fqdn: "ingest.example.org"
        src: "Датчик"
        src_fqdn: "sensor.example.org"
        purpose: "Передача показаний"
      - src: "Шлюз датчиков"
        dst: "Брокер сообщений"
        src_fqdn: "bridge.example.org"
        dst_fqdn: "broker.example.org"
        link: "L3-1:2"
        port: "8883"
        proto: "TCP"
        purpose: "Передача событий датчиков"
  - from: "Прием телеметрии"
    to: "Хранение измерений"
    rows:
      - src: "Сборщик"
        dst: "База измерений"
        src_fqdn: "ingest.example.org"
        dst_fqdn: "store.example.org"
        link: "L3-2:1"
        port: "5432"
        proto: "TCP"
        purpose: "Запись измерений"
  - from: "Хранение измерений"
    to: "Прием телеметрии"
    rows:
      - src: "Монитор"
        dst: "Брокер сообщений"
        src_fqdn: "observer.example.org"
        dst_fqdn: "broker.example.org"
        link: "L3-2:2"
        port: "443"
        proto: "TCP"
        purpose: "Чтение метрик брокера"
whitelist:
  - purpose: "Запрос метрик"
    name: "broker.example.org"
    requester: "Монитор"
notes:
  - "Проверьте адреса узлов по конфигурации фильтра."
`;

/** Every file init copies, in write order. Deterministic: same code, same bytes. */
export function templateFiles(): TemplateFile[] {
  return [
    ...SHEETS.map((sheet, index) => ({
      name: ['l1.drawio', 'l2.drawio', 'l3-1.drawio', 'l3-2.drawio'][index] ?? 'l' + index + '.drawio',
      content: sheetXml(sheet.pageName, sheetCells(sheet)),
    })),
    { name: 'poc.yaml', content: EXAMPLE_YAML },
    { name: 'manifest.json', content: JSON.stringify(MANIFEST, null, 2) + '\n' },
  ];
}

export const TEMPLATE_DIR = join(import.meta.dirname, '..', 'content', 'templates');

/** Writes the templates into content/templates; --write only, never implicitly. */
export function writeTemplates(): string[] {
  mkdirSync(TEMPLATE_DIR, { recursive: true });
  const written: string[] = [];
  for (const file of templateFiles()) {
    writeFileSync(join(TEMPLATE_DIR, file.name), file.content);
    written.push(file.name);
  }
  return written;
}

export interface InitResult {
  code: number;
  lines: string[];
}

/**
 * init <folder>: copy the templates in, keep every file that is already there - unless the
 * folder already holds .drawio sheets. Those are someone's work: a package of its own sheets
 * needs a manifest.json, not four templates it never asked for.
 */
export function initFolder(folder: string): InitResult {
  const dir = resolve(folder);
  mkdirSync(dir, { recursive: true });
  const hasSheets = readdirSync(dir, { withFileTypes: true }).some(
    (entry) => entry.isFile() && entry.name.endsWith('.drawio') && !entry.name.startsWith('.'),
  );
  if (hasSheets) {
    return {
      code: 64,
      lines: [
        'init не кладет шаблоны в папку, где уже есть листы .drawio',
        'Создай manifest.json по образцу из SKILL.md (service, titlePrefix, sheets[]: file, level, topic, retired); ' +
          'для уже отправленного пакета - references/resend.md.',
        'Дальше: ' + nodeCommand(CLI_PATH, 'check', dir),
      ],
    };
  }
  const lines: string[] = [];
  for (const file of templateFiles()) {
    const path = join(dir, file.name);
    if (existsSync(path)) {
      lines.push('SKIP ' + file.name);
      continue;
    }
    writeFileSync(path, file.content);
    lines.push('COPY ' + file.name);
  }
  const poc = join(dir, 'poc.yaml');
  lines.push(
    'Сначала заполни ' +
      shellQuote(poc) +
      ' по references/fw-rules.md; затем rules построит лист правил, check перечитает пакет.',
    'Дальше: ' + nodeCommand(CLI_PATH, 'rules', poc),
  );
  return { code: 0, lines };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === join(import.meta.dirname, 'templates.ts')) {
  if (process.argv.includes('--write')) {
    for (const name of writeTemplates()) process.stdout.write('WROTE ' + name + '\n');
  } else {
    process.stdout.write('usage: node templates.ts --write\n');
    process.exitCode = 64;
  }
}
