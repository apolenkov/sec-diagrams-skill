import assert from 'node:assert/strict';
import { test } from 'node:test';

import { drawioCandidates, findDrawio } from './drawio-path.ts';

test('draw.io candidates use the selected OS paths and preserve override priority', () => {
  const env = {
    ProgramFiles: 'C:\\Program Files',
    LOCALAPPDATA: 'D:\\Local AppData',
    PATH: '/custom/bin:/usr/bin',
  };
  assert.deepEqual(drawioCandidates(env, 'win32'), [
    'C:\\Program Files\\draw.io\\draw.io.exe',
    'D:\\Local AppData\\Programs\\draw.io\\draw.io.exe',
  ]);
  assert.deepEqual(drawioCandidates({ PATH: '/custom/bin' }, 'linux'),
    ['/custom/bin/drawio', '/opt/drawio/drawio', '/usr/bin/drawio']);
  assert.deepEqual(drawioCandidates(env, 'darwin'),
    ['/Applications/draw.io.app/Contents/MacOS/draw.io', '/custom/bin/drawio', '/usr/bin/drawio']);
  assert.deepEqual(drawioCandidates({ ...env, SD_DRAWIO: 'custom' }, 'win32'), ['custom']);
});

test('findDrawio: a set SD_DRAWIO is the whole answer', () => {
  assert.equal(findDrawio({ SD_DRAWIO: '/nonexistent', PATH: process.env['PATH'] ?? '' }), null);
  assert.equal(findDrawio({ SD_DRAWIO: process.execPath }), process.execPath);
});
