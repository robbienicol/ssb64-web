// Screen switching and controller-style spatial focus for the menus.
import { onAction } from "./input.js";
import { sfx } from "./sfx.js";

const screens = new Map(); // id -> { el, onEnter, onLeave, onAction }
let current = null;
let focused = null;
let layerVisible = true;

export function registerScreen(id, handlers = {}) {
  const el = document.getElementById(`screen-${id}`);
  screens.set(id, { el, ...handlers });
  el.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-focus]");
    if (target && !target.disabled) focus(target, false);
  });
}

export function currentScreen() {
  return current;
}

export function go(id, params) {
  const prev = screens.get(current);
  prev?.onLeave?.();
  prev?.el.classList.remove("active");
  current = id;
  const next = screens.get(id);
  next.el.classList.add("active");
  focused = null;
  next.onEnter?.(params);
  if (!focused) focus(next.el.querySelector("[data-autofocus]") || focusables()[0], false);
}

export function showMenuLayer(visible, overlay = false) {
  layerVisible = visible;
  const layer = document.getElementById("menu-layer");
  layer.hidden = !visible;
  layer.classList.toggle("overlay", overlay);
}

export function focus(el, sound = true) {
  if (!el || el === focused) return;
  focused?.classList.remove("focused");
  focused = el;
  el.classList.add("focused");
  el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  if (sound) sfx("move");
}

export function focusedElement() {
  return focused;
}

function focusables() {
  const el = screens.get(current)?.el;
  if (!el) return [];
  return [...el.querySelectorAll("[data-focus]")].filter((n) => !n.disabled && n.offsetParent !== null);
}

// Picks the nearest focusable in the pressed direction, favouring ones in line with the current item.
function move(dir) {
  const items = focusables();
  if (!focused || !items.includes(focused)) return focus(items[0]);
  const a = focused.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const item of items) {
    if (item === focused) continue;
    const b = item.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    const main = { up: -dy, down: dy, left: -dx, right: dx }[dir];
    if (main <= 1) continue;
    const cross = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    const score = main + cross * 2.5;
    if (score < bestScore) { bestScore = score; best = item; }
  }
  if (best) focus(best);
}

onAction((action) => {
  if (!layerVisible) return;
  const screen = screens.get(current);
  if (screen?.onAction?.(action, focused) === true) return;
  if (action === "up" || action === "down" || action === "left" || action === "right") move(action);
  else if (action === "confirm" && focused) {
    sfx("select");
    focused.click();
  } else if (action === "back") {
    sfx("back");
    screen?.onBack?.();
  }
});
