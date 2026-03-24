export function sniffImageMime(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const n = buf.byteLength;
  if (n < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function jsonErrorFromBuffer(arrayBuffer) {
  const head = new TextDecoder()
    .decode(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 2048)))
    .trim();
  if (!head.startsWith('{')) return null;
  try {
    const j = JSON.parse(head);
    return typeof j.error === 'string' ? j.error : null;
  } catch {
    return null;
  }
}
