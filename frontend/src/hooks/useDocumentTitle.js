import { useEffect } from 'react';

const DEFAULT_TAB = 'Outlier';

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
