import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sweepExpiredExports } from './retentionPolicy.js';

test('sweepExpiredExports skips when storage directory is unwritable', async () => {
  const originalStoragePath = process.env.STORAGE_PATH;
  const originalMkdirSync = fs.mkdirSync;
  const tempStoragePath = path.join(os.tmpdir(), `retention-policy-test-${Date.now()}`);
  process.env.STORAGE_PATH = tempStoragePath;

  fs.mkdirSync = function mkdirSyncWithEacces(dirPath, options) {
    if (String(dirPath).includes(path.join(tempStoragePath, 'exports'))) {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    }
    return originalMkdirSync.call(fs, dirPath, options);
  };

  try {
    const result = await sweepExpiredExports();
    assert.deepEqual(result, { deleted: 0, skipped: true, reason: 'storage_unwritable' });
  } finally {
    fs.mkdirSync = originalMkdirSync;
    if (originalStoragePath === undefined) {
      delete process.env.STORAGE_PATH;
    } else {
      process.env.STORAGE_PATH = originalStoragePath;
    }
    await fs.promises.rm(tempStoragePath, { recursive: true, force: true });
  }
});
