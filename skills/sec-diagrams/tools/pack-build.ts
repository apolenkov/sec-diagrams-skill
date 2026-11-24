/**
 * The build half of pack: the temp folder beside the packet where the new
 * assembly is written - the copy marker first - the sheets hashed from the very bytes that
 * get written, the Visio folder carried across, and the cleanup that a refusal does with the
 * previous build by the names saved on the last success. Split out of pack.ts for the size
 * cap.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { pdfDir, sha256, type PdfReport } from './pdf.ts';
import { packageFileName, resolveDirectoryName, type Manifest } from './profile.ts';
import { SHEETS_DIR, MERGED_RE, VISIO_DIR, packetDirOf } from './pack-names.ts';
import { LETTER_FILE } from './letter.ts';
import type { PackDeps } from './pack.ts';

/**
 * Copy the sheets under profile names into схемы/ and the letter as записка.txt -
 * into the TEMP build folder, which is renamed over the packet whole. Each sheet
 * is read once and the hash is taken from the very bytes that get written: a sheet
 * edited between the report check and this copy stops the build instead of smuggling a packet
 * whose merge and sheets come from different moments. When the folder is a copy for sending,
 * the temp build carries the copy marker from its first file: the sheets under схемы/ hold
 * the real values, and from now on text get and text set must refuse them exactly as they
 * refuse the copy itself. The marker is a hidden empty file, it carries no
 * value and no listing of pack names it; a working packet never gets one.
 */
export function copyIntoBuild(
  build: string,
  dir: string,
  manifest: Manifest,
  files: readonly string[],
  report: PdfReport,
  deps: PackDeps,
): number {
  const sheetDir = join(build, SHEETS_DIR);
  mkdirSync(sheetDir, { recursive: true });
  const hashes = new Map(report.files.map((entry) => [entry.file.normalize('NFC'), entry.sha256]));
  let copied = 0;
  for (const sheet of manifest.sheets) {
    const name = sheet.file.normalize('NFC');
    const actualName = resolveDirectoryName(files, sheet.file);
    deps.beforeSheetCopy?.(actualName);
    const bytes = readFileSync(join(dir, actualName));
    const sha = sha256(new Uint8Array(bytes));
    const want = hashes.get(name);
    if (sha !== want)
      throw new Error('лист ' + name + ' изменился после pdf: сборка остановлена, прогони pdf заново');
    writeFileSync(join(sheetDir, packageFileName(sheet)), bytes);
    copied += 1;
  }
  copyFileSync(join(dir, LETTER_FILE), join(build, LETTER_FILE));
  return copied;
}

/** The names pack wrote into the packet last time: pack's own manifest of its outputs. */
interface BuildList {
  merged: string;
  sheets: string[];
}

const buildListPath = (dir: string): string => join(pdfDir(dir), 'pack-build.json');

export function loadBuildList(dir: string): BuildList | null {
  let text: string;
  try {
    text = readFileSync(buildListPath(dir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PacketCleanupError('Не удалось прочитать pack-build.json', { cause: error });
  }
  let data: Partial<BuildList> | null;
  try {
    data = JSON.parse(text) as Partial<BuildList> | null;
  } catch (error) {
    throw new PacketCleanupError('Не удалось разобрать pack-build.json', { cause: error });
  }
  if (!data || typeof data.merged !== 'string' || !Array.isArray(data.sheets)) {
    throw new PacketCleanupError('pack-build.json: ожидаются имена PDF и листов');
  }
  const fileName = (name: unknown): string => {
    if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || /[\\/:\u0000]/u.test(name)) {
      throw new PacketCleanupError('pack-build.json: укажи имена файлов без пути');
    }
    return name.normalize('NFC');
  };
  const merged = fileName(data.merged);
  const sheets = data.sheets.map(fileName);
  if (!MERGED_RE.test(merged) || sheets.some(name => !name.endsWith('.drawio'))) {
    throw new PacketCleanupError('pack-build.json: ожидается имя склейки PDF и имена листов .drawio');
  }
  return { merged, sheets };
}

export function saveBuildList(dir: string, merged: string, sheets: string[]): void {
  writeFileSync(buildListPath(dir), JSON.stringify({ merged, sheets }, null, 1) + '\n');
}

export class PacketCleanupError extends Error {}

function packetDirectoryExists(path: string): boolean {
  try {
    if (lstatSync(path).isDirectory()) return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new PacketCleanupError('Не удалось прочитать каталог ' + path, { cause: error });
  }
  throw new PacketCleanupError('Путь каталога занят файлом или ссылкой: ' + path);
}

export function validatePacketDirectories(dir: string): boolean {
  const packet = packetDirOf(dir);
  if (!packetDirectoryExists(packet)) return false;
  packetDirectoryExists(join(packet, SHEETS_DIR));
  return true;
}

/**
 * The parts an older assembly left in the packet: the merge and sheet copies the build list
 * names, plus any merge name an older skill version used. A refusal removes
 * them, so the packet never keeps sheets older than the report that refused; the letter and
 * the Visio folder stay - a person wrote or filled them.
 */
export function dropPacketParts(dir: string, manifest: Manifest, except: string | null = null): void {
  const packDir = packetDirOf(dir);
  if (!validatePacketDirectories(dir)) return;
  const mine = new Set<string>(manifest.sheets.map((sheet) => packageFileName(sheet)));
  const list = loadBuildList(dir);
  if (list !== null) {
    for (const name of list.sheets) mine.add(name);
  }
  const sheetDir = join(packDir, SHEETS_DIR);
  let sheets: string[] = [];
  try {
    sheets = readdirSync(sheetDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new PacketCleanupError('Не удалось прочитать каталог ' + sheetDir + ' (' + (code ?? 'ошибка ввода-вывода') + ')', {
        cause: error,
      });
    }
  }
  for (const entry of readdirSync(packDir)) {
    if (MERGED_RE.test(entry) && entry !== except) rmSync(join(packDir, entry), { force: true });
  }
  for (const name of mine) {
    if (!sheets.some(entry => entry.normalize('NFC') === name)) continue;
    try {
      rmSync(join(sheetDir, resolveDirectoryName(sheets, name)), { force: true });
    } catch {
      // A name that became a directory stays: only known files are eligible for cleanup.
    }
  }
}

/** the reviewer keeps .vsdx copies in a Visio subfolder: a rebuild carries it into the new build. */
export function moveVisio(packDir: string, build: string): void {
  const from = join(packDir, VISIO_DIR);
  try {
    if (existsSync(from) && statSync(from).isDirectory()) renameSync(from, join(build, VISIO_DIR));
  } catch {
    // A Visio folder nobody may move stays put; the rename over the packet will report the cost.
  }
}
