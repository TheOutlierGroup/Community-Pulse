import { useEffect, useRef, useState } from 'react';
import api from '../../services/api.js';
import { UserCircle } from 'lucide-react';

export default function PlatformUserAvatar({ userId, hasProfileAvatar, rev = 0 }) {
  const [src, setSrc] = useState(null);
  const urlRef = useRef(null);

  useEffect(() => {
    if (!hasProfileAvatar || !userId) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    api
      .get(`/api/platform/users/${userId}/avatar`, {
        responseType: 'arraybuffer',
        params: { v: rev },
      })
      .then((res) => {
        if (res.status !== 200 || !(res.data instanceof ArrayBuffer) || res.data.byteLength < 4) {
          throw new Error('bad');
        }
        const buf = new Uint8Array(res.data);
        const looksImage =
          (buf[0] === 0xff && buf[1] === 0xd8) ||
          (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
          (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46);
        if (!looksImage) throw new Error('bad');
        const ct = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
        const blob = new Blob([res.data], { type: ct });
        const u = URL.createObjectURL(blob);
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
  }, [userId, hasProfileAvatar, rev]);

  if (!src) {
    return (
      <UserCircle
        className="platform-user-avatar platform-user-avatar--placeholder"
        strokeWidth={1.5}
        aria-hidden
      />
    );
  }
  return <img src={src} alt="" className="platform-user-avatar" />;
}
