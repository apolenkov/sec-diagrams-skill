import { accessSync, constants, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';

const DRAWIO_APP = '/Applications/draw.io.app/Contents/MacOS/draw.io';
export const DRAWIO_MISSING_LINE = 'NOT_CHECKED SD-P04 draw.io Desktop не найден - PDF не проверен';
const DRAWIO_HINT = 'поставь draw.io Desktop с релизов jgraph/drawio-desktop или задай путь в SD_DRAWIO';

const isExecutable = (path: string): boolean => {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export type ExportEnv = Readonly<Record<string, string | undefined>>;

export function drawioCandidates(env: ExportEnv, platform: NodeJS.Platform): string[] {
  if (env.SD_DRAWIO) return [env.SD_DRAWIO];
  if (platform === 'win32') {
    const paths = [];
    if (env.ProgramFiles) paths.push(win32.join(env.ProgramFiles, 'draw.io', 'draw.io.exe'));
    if (env.LOCALAPPDATA) paths.push(win32.join(env.LOCALAPPDATA, 'Programs', 'draw.io', 'draw.io.exe'));
    return paths;
  }
  const onPath = (env.PATH ?? '').split(':').filter(Boolean).map(dir => posix.join(dir, 'drawio'));
  if (platform === 'darwin') return [DRAWIO_APP, ...onPath];
  return [...new Set([...onPath, '/opt/drawio/drawio', '/usr/bin/drawio'])];
}

export function findDrawio(env: ExportEnv = process.env, platform = process.platform): string | null {
  return drawioCandidates(env, platform).find(isExecutable) ?? null;
}

export function drawioMissingLines(env: ExportEnv): string[] {
  return [
    DRAWIO_MISSING_LINE,
    'Проверенные пути: ' + (drawioCandidates(env, process.platform).join(', ') || 'нет доступных путей'),
    `Подсказка: ${DRAWIO_HINT}`,
  ];
}
