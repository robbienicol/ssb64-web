// Controller + keyboard input for the menus. Emits navigation actions and,
// while remapping, the raw gamepad input in EmulatorJS's label format.
const BUTTON_LABELS = [
  "BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "LEFT_TOP_SHOULDER", "RIGHT_TOP_SHOULDER",
  "LEFT_BOTTOM_SHOULDER", "RIGHT_BOTTOM_SHOULDER", "SELECT", "START", "LEFT_STICK", "RIGHT_STICK",
  "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT",
];
const AXIS_NAMES = ["LEFT_STICK_X", "LEFT_STICK_Y", "RIGHT_STICK_X", "RIGHT_STICK_Y"];
const BUTTON_ACTIONS = { 0: "confirm", 1: "back", 9: "start", 8: "menu", 4: "tabPrev", 5: "tabNext", 12: "up", 13: "down", 14: "left", 15: "right" };
const KEY_ACTIONS = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  Enter: "confirm", " ": "confirm", Escape: "back", Backspace: "back", PageUp: "tabPrev", PageDown: "tabNext",
};
const REPEATABLE = new Set(["up", "down", "left", "right"]);
const AXIS_THRESHOLD = 0.6;
const REPEAT_DELAY = 380;
const REPEAT_RATE = 110;

const listeners = new Set();
let mode = "menu"; // "menu" | "game" (only the menu button gets through)
let capture = null;

export const buttonLabel = (index) => BUTTON_LABELS[index] ?? index;

export function onAction(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setMode(next) {
  mode = next;
}

// Resolves with the next gamepad button/axis pressed, in EmulatorJS label form, or null on cancel.
export function captureNext() {
  return new Promise((resolve) => {
    capture = resolve;
    // Ignore whatever is already held (e.g. the A press that started the capture).
    held.clear();
    for (const pad of pads()) snapshot(pad).forEach((k) => held.add(k));
  });
}

export function cancelCapture() {
  if (capture) { capture(null); capture = null; }
}

function emit(action, source) {
  if (mode === "game" && action !== "menu") return;
  listeners.forEach((fn) => fn(action, source));
}

// --- keyboard ---------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (capture) {
    if (e.key === "Escape") { e.preventDefault(); cancelCapture(); }
    return;
  }
  if (mode === "game") {
    if (e.key === "Escape") emit("menu", "keyboard");
    return;
  }
  const typing = e.target instanceof HTMLInputElement && e.target.type === "text";
  if (typing && e.key !== "Enter" && e.key !== "Escape" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  const action = KEY_ACTIONS[e.key];
  if (!action) return;
  e.preventDefault();
  emit(action, "keyboard");
});

// --- gamepads ---------------------------------------------------------------
const pads = () => [...(navigator.getGamepads?.() || [])].filter(Boolean);
const held = new Set(); // "padIndex:b3", "padIndex:a1+" etc.
const repeatAt = new Map(); // action -> next repeat time

function snapshot(pad) {
  const keys = [];
  pad.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) keys.push(`${pad.index}:b${i}`); });
  pad.axes.forEach((v, i) => {
    if (v > AXIS_THRESHOLD) keys.push(`${pad.index}:a${i}+`);
    else if (v < -AXIS_THRESHOLD) keys.push(`${pad.index}:a${i}-`);
  });
  return keys;
}

function actionFor(key) {
  const [, input] = key.split(":");
  if (input[0] === "b") return BUTTON_ACTIONS[Number(input.slice(1))];
  const axis = Number(input.slice(1, -1));
  const plus = input.endsWith("+");
  if (axis === 0) return plus ? "right" : "left";
  if (axis === 1) return plus ? "down" : "up";
  return null;
}

function captureLabel(key) {
  const [, input] = key.split(":");
  if (input[0] === "b") return buttonLabel(Number(input.slice(1)));
  const axis = Number(input.slice(1, -1));
  return `${AXIS_NAMES[axis] ?? `AXIS_${axis}`}:${input.endsWith("+") ? "+1" : "-1"}`;
}

function poll(now) {
  const current = new Set();
  for (const pad of pads()) snapshot(pad).forEach((k) => current.add(k));

  for (const key of current) {
    if (held.has(key)) continue;
    if (capture) {
      const done = capture;
      capture = null;
      done(captureLabel(key));
      continue;
    }
    const action = actionFor(key);
    if (!action) continue;
    emit(action, "gamepad");
    if (REPEATABLE.has(action)) repeatAt.set(action, now + REPEAT_DELAY);
  }

  // Held directions repeat so long lists scroll.
  const heldActions = new Set([...current].map(actionFor).filter((a) => REPEATABLE.has(a)));
  for (const [action, at] of repeatAt) {
    if (!heldActions.has(action)) repeatAt.delete(action);
    else if (now >= at && !capture) {
      emit(action, "gamepad");
      repeatAt.set(action, now + REPEAT_RATE);
    }
  }

  held.clear();
  current.forEach((k) => held.add(k));
  requestAnimationFrame(poll);
}
requestAnimationFrame(poll);

export function connectedPads() {
  return pads().map((p) => ({ index: p.index, id: p.id }));
}
