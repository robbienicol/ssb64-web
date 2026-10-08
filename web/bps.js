// Applies a BPS patch (Uint8Array) to a source ROM (Uint8Array).
export function applyBps(source, patch) {
  let p = 0;
  const readVarint = () => {
    let data = 0, shift = 1;
    for (;;) {
      const x = patch[p++];
      data += (x & 0x7f) * shift;
      if (x & 0x80) return data;
      shift *= 128;
      data += shift;
    }
  };
  const magic = String.fromCharCode(...patch.subarray(0, 4));
  if (magic !== "BPS1") throw new Error("Not a BPS patch");
  p = 4;
  const sourceSize = readVarint();
  const targetSize = readVarint();
  const metadataSize = readVarint();
  p += metadataSize;
  if (sourceSize !== source.length) throw new Error("Patch is for a different ROM");

  const target = new Uint8Array(targetSize);
  const end = patch.length - 12;
  let out = 0, srcRel = 0, tgtRel = 0;
  while (p < end) {
    const data = readVarint();
    const mode = data & 3;
    let len = Math.floor(data / 4) + 1;
    if (mode === 0) {
      target.set(source.subarray(out, out + len), out);
      out += len;
    } else if (mode === 1) {
      target.set(patch.subarray(p, p + len), out);
      p += len;
      out += len;
    } else {
      const off = readVarint();
      const rel = (off & 1 ? -1 : 1) * Math.floor(off / 2);
      if (mode === 2) {
        srcRel += rel;
        target.set(source.subarray(srcRel, srcRel + len), out);
        srcRel += len;
        out += len;
      } else {
        tgtRel += rel;
        while (len--) target[out++] = target[tgtRel++];
      }
    }
  }
  const view = new DataView(patch.buffer, patch.byteOffset + end, 12);
  if (crc32(target) !== view.getUint32(4, true)) throw new Error("Patched ROM failed its checksum");
  return target;
}

const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
