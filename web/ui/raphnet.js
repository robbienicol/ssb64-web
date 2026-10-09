// Exact N64 input from raphnet adapters over WebHID (Chrome/Edge). The
// adapter's raw mode passes N64 controller commands through (the same
// interface raphnet's raphnetraw Mupen64plus plugin uses), so online matches
// get the controller's own button bits and stick values, as an N64 reads them.
// The adapter keeps working as a normal gamepad (menus, local play) meanwhile.
const VENDOR = 0x289b; // raphnet technologies
const RQ_RAW_SI_COMMAND = 0x80; // [0x80, channel, tx_len, tx...] -> [0x80, channel, rx_len, rx...]
const N64_GET_STATUS = 0x01; // -> buttons hi, buttons lo, stick x, stick y
const STALE_MS = 100;

let device = null;
let reportSize = 63;
let latest = null;
let loopId = 0;
const listeners = new Set();

export const supported = () => !!navigator.hid;
export const isConnected = () => !!device;
export const deviceName = () => device?.productName || "";
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

// Latest controller state { buttons, x, y } in N64 terms, or null.
export function rawState() {
  return latest && performance.now() - latest.at < STALE_MS ? latest : null;
}

// The adapter's command interface is the one with feature reports.
const isCommandInterface = (d) =>
  d.vendorId === VENDOR && d.collections.some((c) => (c.featureReports || []).length > 0);

function featureReportBytes(d) {
  for (const c of d.collections) {
    for (const r of c.featureReports || []) {
      const bits = (r.items || []).reduce((sum, it) => sum + (it.reportSize || 0) * (it.reportCount || 0), 0);
      if (bits > 0) return Math.ceil(bits / 8);
    }
  }
  return 63;
}

async function exchange(cmd) {
  const out = new Uint8Array(reportSize);
  out.set(cmd);
  await device.sendFeatureReport(0, out);
  // The answer is polled (it may not be ready on the first read).
  for (let tries = 0; tries < 20; tries++) {
    const view = await device.receiveFeatureReport(0);
    const b = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    // Some platforms prefix the (zero) report id.
    const off = b[0] === cmd[0] ? 0 : b[1] === cmd[0] ? 1 : -1;
    if (off >= 0) return b.subarray(off);
  }
  return null;
}

// Lets the page run between reads without a timer's minimum delay.
const yieldChannel = new MessageChannel();
const yieldToPage = () => new Promise((resolve) => {
  yieldChannel.port1.onmessage = () => resolve();
  yieldChannel.port2.postMessage(0);
});

async function poll(id) {
  while (device && loopId === id) {
    await yieldToPage();
    if (!device || loopId !== id) break; // disconnected meanwhile
    try {
      const rep = await exchange([RQ_RAW_SI_COMMAND, 0, 1, N64_GET_STATUS]);
      if (rep && rep[2] >= 4) {
        latest = {
          at: performance.now(),
          buttons: ((rep[3] << 8) | rep[4]) & 0xff3f, // drop the reset/unused bits
          x: (rep[5] << 24) >> 24,
          y: (rep[6] << 24) >> 24,
        };
      } else {
        latest = null; // no controller in the adapter
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (err) {
      console.warn("[raphnet] read failed", err);
      latest = null;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function use(d) {
  if (!d.opened) await d.open();
  device = d;
  reportSize = featureReportBytes(d);
  const id = ++loopId;
  poll(id);
  notify();
}

// prompt: show Chrome's device picker (needs a click); otherwise reconnect to
// an adapter this site was already allowed to use.
export async function connect(prompt = false) {
  if (!supported()) throw new Error("This browser can't read the adapter directly. Use Chrome or Edge.");
  let candidates = (await navigator.hid.getDevices()).filter(isCommandInterface);
  if (!candidates.length && prompt) {
    const picked = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR }] });
    candidates = picked.filter(isCommandInterface);
    if (picked.length && !candidates.length) throw new Error("That adapter doesn't offer direct reads (old firmware?).");
  }
  if (!candidates.length) return false;
  await use(candidates[0]);
  return true;
}

export async function disconnect() {
  loopId++;
  const d = device;
  device = null;
  latest = null;
  try { await d?.close(); } catch {}
  notify();
}

if (supported()) {
  navigator.hid.addEventListener("disconnect", (e) => { if (e.device === device) disconnect(); });
  navigator.hid.addEventListener("connect", () => { if (!device) connect(false).catch(() => {}); });
}
