// On-screen keyboard for typing a gamertag with a controller. Physical typing also works.
const ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL_", "ZXCVBNM"];

export function mountKeyboard(container, input, { onDone, maxLength = 15 } = {}) {
  container.innerHTML = "";
  const key = (label, cls, onPress) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `key ${cls || ""}`;
    b.textContent = label;
    b.dataset.focus = "";
    b.addEventListener("click", onPress);
    return b;
  };
  const type = (ch) => {
    if (input.value.length < maxLength) input.value += ch;
    input.dispatchEvent(new Event("input"));
  };
  for (const row of ROWS) {
    const r = document.createElement("div");
    r.className = "key-row";
    for (const ch of row) r.append(key(ch, "", () => type(ch)));
    if (row === ROWS[ROWS.length - 1]) {
      r.append(key("⌫", "wide", () => { input.value = input.value.slice(0, -1); input.dispatchEvent(new Event("input")); }));
      const done = key("OK", "wide accent", () => onDone?.());
      done.dataset.autofocus = "";
      r.append(done);
    }
    container.append(r);
  }
  // Physical typing goes into the box even while an on-screen key has focus.
  window.addEventListener("keydown", (e) => {
    if (container.offsetParent === null || e.target === input || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[A-Za-z0-9_]$/.test(e.key)) type(e.key);
    else if (e.key === "Backspace") {
      input.value = input.value.slice(0, -1);
      input.dispatchEvent(new Event("input"));
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  input.maxLength = maxLength;
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, maxLength);
  });
}
