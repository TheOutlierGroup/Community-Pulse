import { useEffect } from 'react';
import { IS_RHYTHM_ENGINE_SURFACE } from '../config/appSurface.js';

// RED-069: pages on the Rhythm Engine site must never title the tab
// "Outlier"; the CRM keeps its own name.
const DEFAULT_TAB = IS_RHYTHM_ENGINE_SURFACE ? 'Rhythm Engine' : 'Outlier';

/**
 * Sets document.title while mounted; restores the previous title on unmount.
 * @param {string | null | undefined} title — omit or pass null/empty to leave title unchanged
 */
export function useDocumentTitle(title) {
  useEffect(() => {
    if (title == null || String(title).trim() === '') return undefined;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export { DEFAULT_TAB };
