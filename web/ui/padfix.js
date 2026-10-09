// Makes N64-to-USB adapters (raphnet) look like a standard gamepad, so they
// work with the default mapping everywhere (menus, local play, online):
// - raphnet reports N64 order (A, B, Z, Start, L, R, C-up, C-down, C-left,
//   C-right, D-pad); here that is rearranged into the standard layout our
//   defaults use (C-up/C-left on the face buttons, C-down/C-right on the right
//   stick, Z on the left trigger, R on the right trigger);
// - an N64 stick only reaches about ±80 of ±127, so the stick is rescaled to
//   full range (learning the real maximum as the player pushes it).
const N64_ADAPTER = /raphnet|vendor: 289b/i;
const learned = new Map(); // pad index -> largest stick deflection seen

const btn = (b) => (b ? { pressed: !!b.pressed, touched: !!b.pressed, value: b.value ?? (b.pressed ? 1 : 0) } : { pressed: false, touched: false, value: 0 });
const on = (b) => !!(b && (b.pressed || b.value > 0.5));

export function normalizePad(pad) {
  if (!pad || pad.mapping === "standard" || !N64_ADAPTER.test(pad.id)) return pad;
  const raw = pad.buttons;
  const buttons = Array.from({ length: 17 }, () => btn(null));
  // standard index <- raphnet index
  [[0, 0], [1, 1], [2, 8], [3, 6], [4, 4], [6, 2], [7, 5], [9, 3], [12, 10], [13, 11], [14, 12], [15, 13]]
    .forEach(([std, r]) => { buttons[std] = btn(raw[r]); });
  const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
  const full = Math.max(0.66, learned.get(pad.index) || 0, Math.abs(x), Math.abs(y));
  learned.set(pad.index, Math.min(1, full));
  const scale = (v) => Math.max(-1, Math.min(1, v / full));
  const axes = [scale(x), scale(y), (on(raw[9]) ? 1 : 0), (on(raw[7]) ? 1 : 0)];
  return { id: pad.id, index: pad.index, connected: pad.connected, mapping: "standard", timestamp: pad.timestamp, buttons, axes };
}

// Wraps win.navigator.getGamepads so everything on that page sees normalized pads.
export function installPadFix(win = window) {
  const nav = win.navigator;
  if (!nav?.getGamepads || nav.getGamepads.__padfix) return;
  const original = nav.getGamepads.bind(nav);
  const wrapped = () => Array.from(original() || [], (p) => (p ? normalizePad(p) : p));
  wrapped.__padfix = true;
  try {
    nav.getGamepads = wrapped;
  } catch {}
}
