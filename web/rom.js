// Turns a user-supplied file (.z64/.n64/.v64, optionally zipped) into a verified big-endian US ROM.
export const US_SHA1 = "e2929e10fccc0aa84e5776227e798abc07cedabf";

export async function readRom(file) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) bytes = await unzipRom(bytes);
  bytes = toBigEndian(bytes);
  const sha1 = await sha1Hex(bytes);
  if (sha1 !== US_SHA1) {
    throw new Error("That isn't the Super Smash Bros. (USA) ROM. Other regions and hacks won't work.");
  }
  return bytes;
}

function toBigEndian(b) {
  const out = new Uint8Array(b);
  if (b[0] === 0x80) return out;
  if (b[0] === 0x37) {
    for (let i = 0; i < out.length; i += 2) [out[i], out[i + 1]] = [b[i + 1], b[i]];
  } else if (b[0] === 0x40) {
    for (let i = 0; i < out.length; i += 4) {
      out[i] = b[i + 3]; out[i + 1] = b[i + 2]; out[i + 2] = b[i + 1]; out[i + 3] = b[i];
    }
  } else {
    throw new Error("That doesn't look like an N64 ROM.");
  }
  return out;
}

async function sha1Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Reads the first .z64/.n64/.v64 entry from a zip via its central directory.
async function unzipRom(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("Couldn't read that zip file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(z64|n64|v64)$/i.test(name)) continue;
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(dataStart, dataStart + compSize);
    if (method === 0) return data;
    if (method !== 8) throw new Error("Unsupported zip compression.");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error("No N64 ROM found inside that zip.");
}

// Keeps the player's ROM in this browser so they only import it once.
const DB = "ssb64-web", STORE = "rom", KEY = "base";
const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
export const loadSavedRom = () => tx("readonly", (s) => s.get(KEY)).catch(() => undefined);
export const saveRom = (bytes) => tx("readwrite", (s) => s.put(bytes, KEY)).catch(() => undefined);
export const forgetRom = () => tx("readwrite", (s) => s.delete(KEY)).catch(() => undefined);
