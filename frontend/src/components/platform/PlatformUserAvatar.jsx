import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api.js';
import { UserCircle } from 'lucide-react';

const avatarCache = new Map();
const MAX_AVATAR_CACHE = 400;

function cacheAvatar(key, objectUrl) {
  avatarCache.set(key, objectUrl);
  if (avatarCache.size <= MAX_AVATAR_CACHE) return;
  const oldestKey = avatarCache.keys().next().value;
  if (!oldestKey) return;
  const oldUrl = avatarCache.get(oldestKey);
  avatarCache.delete(oldestKey);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
}

function useInViewport(enabled) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(!enabled);

  useEffect(() => {
    if (!enabled) {
      setVisible(true);
      return undefined;
    }
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setVisible(true);
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [enabled]);

  return { ref, visible };
}

export default function PlatformUserAvatar({ userId, hasProfileAvatar, rev = 0, organizationId, lazy = true }) {
  const [src, setSrc] = useState(null);
  const avatarPath = useMemo(
    () =>
      organizationId
        ? `/api/platform/organizations/${organizationId}/users/${userId}/avatar`
        : `/api/platform/users/${userId}/avatar`,
    [organizationId, userId]
  );
  const cacheKey = `${avatarPath}?v=${rev}`;
  const { ref, visible } = useInViewport(Boolean(lazy && hasProfileAvatar && userId));

  useEffect(() => {
    if (!hasProfileAvatar || !userId || !visible) {
      setSrc(null);
      return;
    }
    if (avatarCache.has(cacheKey)) {
      setSrc(avatarCache.get(cacheKey));
      return;
    }
    let cancelled = false;
    api
      .get(avatarPath, {
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
        cacheAvatar(cacheKey, u);
        setSrc(u);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [avatarPath, cacheKey, hasProfileAvatar, rev, userId, visible]);

  if (!src) {
    return (
      <span ref={ref}>
        <UserCircle
          className="platform-user-avatar platform-user-avatar--placeholder"
          strokeWidth={1.5}
          aria-hidden
        />
      </span>
    );
  }
  return <img ref={ref} src={src} alt="" className="platform-user-avatar" loading="lazy" decoding="async" />;
}
