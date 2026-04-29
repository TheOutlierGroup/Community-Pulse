import { lazy } from 'react';

const CHUNK_LOAD_ERROR_RE = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\d]+ failed/i;

export function lazyWithReload(importer, key) {
  const cacheKey = `lazy-reload:${String(key || 'route')}`;
  return lazy(async () => {
    const canUseStorage =
      typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
    const didReload = canUseStorage && window.sessionStorage.getItem(cacheKey) === '1';
    try {
      const mod = await importer();
      if (canUseStorage) window.sessionStorage.removeItem(cacheKey);
      return mod;
    } catch (err) {
      const message = String(err?.message || '');
      const isChunkLoadError = CHUNK_LOAD_ERROR_RE.test(message);
      if (isChunkLoadError && canUseStorage && !didReload) {
        window.sessionStorage.setItem(cacheKey, '1');
        window.location.reload();
        return new Promise(() => {});
      }
      if (canUseStorage) window.sessionStorage.removeItem(cacheKey);
      throw err;
    }
  });
}
