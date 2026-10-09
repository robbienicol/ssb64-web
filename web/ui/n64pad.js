// Player 1's controller in N64 terms ({ buttons, x, y }) for online matches:
// the gamepad through the mapping on the Controls screen, plus a fixed
// keyboard layout. The engine reads this every frame.
import { loadMaps } from "./controls.js";
import { buttonLabel } from "./input.js";

// N64 controller bits (PR/os_cont.h).
const BIT = {
  0: 0x8000, // A
  1: 0x4000, // B
  12: 0x2000, // Z
  3: 0x1000, // Start
  4: 0x0800, 5: 0x0400, 6: 0x0200, 7: 0x0100, // D-pad up, down, left, right
  10: 0x0020, // L
  11: 0x0010, // R
  23: 0x0008, 22: 0x0004, 21: 0x0002, 20: 0x0001, // C up, down, left, right
};
const STICK = { right: 16, left: 17, down: 18, up: 19 };
const AXES = ["LEFT_STICK_X", "LEFT_STICK_Y", "RIGHT_STICK_X", "RIGHT_STICK_Y"];
const STICK_MAX = 80; // full tilt on a real N64 stick
const DEADZONE = 0.15;

// Same layout the engine uses by default: WASD stick, X/C = A/B, arrows = C.
const KEYS = {
  KeyX: 0, KeyC: 1, KeyZ: 12, Enter: 3, KeyE: 10, KeyR: 11,
  ArrowUp: 23, ArrowDown: 22, ArrowLeft: 21, ArrowRight: 20,
  KeyT: 4, KeyG: 5, KeyF: 6, KeyH: 7,
};
const KEY_STICK = { KeyD: "right", KeyA: "left", KeyS: "down", KeyW: "up" };

// How far an EmulatorJS-style binding ("BUTTON_3", "LEFT_STICK_X:-1") is pressed, 0..1.
function amount(pad, label) {
  if (!pad || label === undefined || label === null || label === "") return 0;
  const axis = /^([A-Z_]+):([+-])1$/.exec(String(label));
  if (axis) {
    const i = AXES.indexOf(axis[1]);
    const v = (pad.axes[i] || 0) * (axis[2] === "+" ? 1 : -1);
    return v > 0 ? v : 0;
  }
  for (let i = 0; i < pad.buttons.length; i++) {
    if (buttonLabel(i) === label || String(i) === String(label)) {
      const b = pad.buttons[i];
      return b && (b.pressed || b.value > 0.5) ? 1 : 0;
    }
  }
  return 0;
}

export function makeN64Reader() {
  let map = loadMaps()[0];
  let reads = 0;

  // keys: Set of KeyboardEvent.code held in the game frame; pads: gamepads.
  function read(keys, pads) {
    if (++reads % 60 === 0) map = loadMaps()[0]; // picks up remaps from the match menu
    const pad = [...(pads || [])].filter(Boolean).sort((a, b) => a.index - b.index)[0];
    let buttons = 0;
    for (const [id, bit] of Object.entries(BIT)) {
      if (amount(pad, map[id]) > 0.5) buttons |= bit;
    }
    let x = amount(pad, map[STICK.right]) - amount(pad, map[STICK.left]);
    let y = amount(pad, map[STICK.up]) - amount(pad, map[STICK.down]);
    const mag = Math.hypot(x, y);
    if (mag < DEADZONE) {
      x = y = 0;
    } else if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    if (keys) {
      for (const code of keys) {
        if (KEYS[code] !== undefined) buttons |= BIT[KEYS[code]];
        const dir = KEY_STICK[code];
        if (dir === "right") x = 1;
        else if (dir === "left") x = -1;
        else if (dir === "up") y = 1;
        else if (dir === "down") y = -1;
      }
    }
    return { buttons, x: Math.round(x * STICK_MAX), y: Math.round(y * STICK_MAX) };
  }
  return { read };
}
