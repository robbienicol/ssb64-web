// Controller mapping: N64 inputs -> browser gamepad inputs, per player, applied to EmulatorJS.
const STORAGE_KEY = "ssb64-web:controls";

// EmulatorJS's N64 input ids.
export const N64_INPUTS = [
  { id: 0, name: "A" },
  { id: 1, name: "B" },
  { id: 12, name: "Z" },
  { id: 10, name: "L" },
  { id: 11, name: "R" },
  { id: 3, name: "Start" },
  { id: 19, name: "Stick ↑" },
  { id: 18, name: "Stick ↓" },
  { id: 17, name: "Stick ←" },
  { id: 16, name: "Stick →" },
  { id: 23, name: "C ↑" },
  { id: 22, name: "C ↓" },
  { id: 21, name: "C ←" },
  { id: 20, name: "C →" },
  { id: 4, name: "D-pad ↑" },
  { id: 5, name: "D-pad ↓" },
  { id: 6, name: "D-pad ←" },
  { id: 7, name: "D-pad →" },
];

// Standard (Xbox-style) layout: jump on X/Y, shield on the triggers, C-buttons on the right stick.
export const DEFAULT_MAP = {
  0: "BUTTON_1", 1: "BUTTON_2", 12: "LEFT_BOTTOM_SHOULDER", 10: "LEFT_TOP_SHOULDER", 11: "RIGHT_BOTTOM_SHOULDER",
  3: "START", 19: "LEFT_STICK_Y:-1", 18: "LEFT_STICK_Y:+1", 17: "LEFT_STICK_X:-1", 16: "LEFT_STICK_X:+1",
  23: "BUTTON_4", 22: "RIGHT_STICK_Y:+1", 21: "BUTTON_3", 20: "RIGHT_STICK_X:+1",
  4: "DPAD_UP", 5: "DPAD_DOWN", 6: "DPAD_LEFT", 7: "DPAD_RIGHT",
};

const PRETTY = {
  BUTTON_1: "A", BUTTON_2: "B", BUTTON_3: "X", BUTTON_4: "Y", LEFT_TOP_SHOULDER: "LB", RIGHT_TOP_SHOULDER: "RB",
  LEFT_BOTTOM_SHOULDER: "LT", RIGHT_BOTTOM_SHOULDER: "RT", SELECT: "Select", START: "Start",
  LEFT_STICK: "L3", RIGHT_STICK: "R3", DPAD_UP: "D-pad ↑", DPAD_DOWN: "D-pad ↓", DPAD_LEFT: "D-pad ←", DPAD_RIGHT: "D-pad →",
};

export function prettyBinding(label) {
  if (label === undefined || label === null || label === "") return "—";
  if (PRETTY[label]) return PRETTY[label];
  const m = /^(LEFT|RIGHT)_STICK_([XY]):([+-])1$/.exec(String(label));
  if (m) {
    const arrow = m[2] === "X" ? (m[3] === "+" ? "→" : "←") : (m[3] === "+" ? "↓" : "↑");
    return `${m[1] === "LEFT" ? "L" : "R"}-stick ${arrow}`;
  }
  return `Button ${label}`;
}

export function loadMaps() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
  const maps = {};
  for (let p = 0; p < 4; p++) maps[p] = { ...DEFAULT_MAP, ...(saved[p] || {}) };
  return maps;
}

export function saveMaps(maps) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(maps)); } catch {}
  applyMaps(maps);
}

// Writes the gamepad bindings into the running emulator, keeping its keyboard keys.
export function applyMaps(maps = loadMaps()) {
  const emu = window.EJS_emulator;
  if (!emu?.controls) return;
  for (let p = 0; p < 4; p++) {
    emu.controls[p] ??= {};
    for (const { id } of N64_INPUTS) {
      emu.controls[p][id] = { ...(emu.controls[p][id] || {}), value2: maps[p][id] };
    }
  }
  emu.saveSettings?.();
}

// EmulatorJS only gives a controller to a player when the controller connects
// after its settings menu exists, so a pad already in use on our menus never
// reached the game. Hand connected pads to players 1-4 in connection order
// (the same order the controls screen shows) and free slots of unplugged ones.
export function syncGamepads() {
  const emu = window.EJS_emulator;
  if (!emu?.gamepad || !Array.isArray(emu.gamepadSelection)) return;
  const connected = (emu.gamepad.gamepads || []).filter(Boolean).map((g) => `${g.id}_${g.index}`);
  const selection = emu.gamepadSelection;
  while (selection.length < 4) selection.push("");
  let changed = false;
  for (let p = 0; p < selection.length; p++) {
    if (selection[p] && !connected.includes(selection[p])) { selection[p] = ""; changed = true; }
  }
  for (const id of connected) {
    if (selection.includes(id)) continue;
    const free = selection.indexOf("");
    if (free < 0) break;
    selection[free] = id;
    changed = true;
  }
  if (changed && emu.gamepadLabels) emu.updateGamepadLabels?.();
}
