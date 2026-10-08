// Usage: node make-bps.mjs <original.z64> <modified.z64> <out.bps>
// Creates a BPS patch that only carries bytes not found in the original ROM.
import { readFileSync, writeFileSync } from "node:fs";

const [src, tgt, outPath] = process.argv.slice(2).map((p, i) => (i < 2 ? readFileSync(p) : p));
const out = [];
const varint = (n) => {
  for (;;) {
    const x = n % 128;
    n = Math.floor(n / 128);
    if (n === 0) { out.push(0x80 | x); return; }
    out.push(x);
    n--;
  }
};
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32 = (n) => out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);

// Index the source by 8-byte blocks at 4-byte alignment.
const BITS = 22, MASK = (1 << BITS) - 1, BLOCK = 8, MIN = 16, CHAIN = 64;
const hashAt = (b, i) => (Math.imul(b.readUInt32BE(i), 0x9e3779b1) ^ Math.imul(b.readUInt32BE(i + 4), 0x85ebca6b)) >>> (32 - BITS);
const head = new Int32Array(1 << BITS).fill(-1);
const next = new Int32Array(Math.ceil(src.length / 4)).fill(-1);
for (let i = 0; i + BLOCK <= src.length; i += 4) {
  const h = hashAt(src, i);
  next[i >> 2] = head[h];
  head[h] = i;
}

out.push(...Buffer.from("BPS1"));
varint(src.length);
varint(tgt.length);
varint(0);

let t = 0, literalStart = -1, srcRel = 0;
const flushLiteral = () => {
  if (literalStart < 0) return;
  const len = t - literalStart;
  varint(((len - 1) << 2) | 1);
  for (let i = literalStart; i < t; i++) out.push(tgt[i]);
  literalStart = -1;
};
const sameRun = (a, b) => {
  let n = 0;
  while (b + n < tgt.length && a + n < src.length && src[a + n] === tgt[b + n]) n++;
  return n;
};

while (t < tgt.length) {
  const inPlace = t < src.length ? sameRun(t, t) : 0;
  if (inPlace >= MIN || (inPlace > 0 && t + inPlace === tgt.length)) {
    flushLiteral();
    varint(((inPlace - 1) << 2) | 0);
    t += inPlace;
    continue;
  }
  let best = 0, bestAt = 0;
  if (t + BLOCK <= tgt.length) {
    let c = head[hashAt(tgt, t)];
    for (let k = 0; c >= 0 && k < CHAIN; k++, c = next[c >> 2]) {
      const n = sameRun(c, t);
      if (n > best) { best = n; bestAt = c; }
    }
  }
  if (best >= MIN) {
    flushLiteral();
    varint(((best - 1) << 2) | 2);
    const rel = bestAt - srcRel;
    varint((Math.abs(rel) << 1) | (rel < 0 ? 1 : 0));
    srcRel = bestAt + best;
    t += best;
    continue;
  }
  if (literalStart < 0) literalStart = t;
  t++;
}
flushLiteral();

u32(crc32(src));
u32(crc32(tgt));
u32(crc32(Buffer.from(out)));
writeFileSync(outPath, Buffer.from(out));
console.log(`wrote ${outPath} (${out.length} bytes)`);
