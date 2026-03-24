import { useEffect, useRef, useState } from 'react';
import api from '../../services/api.js';

/**
 * Loads an image URL with Bearer auth (localStorage axios) and shows it as a blob URL.
 */
export default function AuthenticatedBlobImage({ path, alt = '', className }) {
  const [src, setSrc] = useState(null);
  const urlRef = useRef(null);

  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    api
      .get(path, { responseType: 'blob' })
      .then((res) => {
        if (cancelled || res.status !== 200 || !(res.data instanceof Blob)) return;
        const u = URL.createObjectURL(res.data);
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = u;
        setSrc(u);
      })
      .catch(() => {
        if (!cancelled) {
          if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
          }
          setSrc(null);
        }
      });
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [path]);

  if (!src) return null;
  return <img src={src} alt={alt} className={className} />;
}
