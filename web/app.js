import { applyBps } from "./bps.js";
import { readRom, loadSavedRom, saveRom } from "./rom.js";
import { onAction, setMode, captureNext, cancelCapture, connectedPads } from "./ui/input.js";
import { registerScreen, go, showMenuLayer, focus, currentScreen } from "./ui/nav.js";
import { sfx, unlockAudio } from "./ui/sfx.js";
import * as api from "./ui/api.js";
import { PRESET_COUNT, avatarHtml, playerCardHtml, recordText, presetSvg, playerRank } from "./ui/avatars.js";
import { rankBadgeSvg, PLACEMENT_GAMES } from "./ui/ranks.js";
import { mountKeyboard } from "./ui/keyboard.js";
import { N64_INPUTS, DEFAULT_MAP, loadMaps, saveMaps, applyMaps, prettyBinding, syncGamepads, patchGamepadHandler } from "./ui/controls.js";
import { initOnline, queue, leave } from "./ui/online.js";
import { ensureEngineFiles } from "./ui/engine.js";
import { FIGHTERS, savedFighter, saveFighter } from "./ui/fighters.js";

const EJS_CDN = "https://cdn.emulatorjs.org/4.3.0-pre";

// Keep every fighter, stage and feature unlocked, including on saves made
// before the mod: constant writes to the save data's unlock masks
// (gSCManagerBackupData + 0x457 unlock_mask, + 0x458 fighter_mask).
const UNLOCK_ALL_CHEATS = ["800A4937 007F", "810A4938 0FFF"];
const GAMERTAG_RE = /^[A-Za-z0-9_]{3,15}$/;
const $ = (id) => document.getElementById(id);

let me = null;
let baseRom = null;
let emulatorStarted = false;
let emulatorReady = false;
let playing = null; // null | "local" | "online"

// ---------- shared UI ----------------------------------------------------------
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  $("toasts").append(el);
  setTimeout(() => el.remove(), 4200);
}

function setStatus(id, message, isError = false) {
  const el = $(id);
  el.textContent = message || "";
  el.classList.toggle("error", isError);
}

function statsHtml(p) {
  const games = (p?.wins || 0) + (p?.losses || 0);
  const pct = games ? Math.round((p.wins / games) * 100) : 0;
  return `<div class="stat"><b>${p?.wins || 0}</b><span>Wins</span></div>
    <div class="stat"><b>${p?.losses || 0}</b><span>Losses</span></div>
    <div class="stat"><b>${games ? pct + "%" : "–"}</b><span>Win rate</span></div>`;
}

function renderMe() {
  const chip = $("me-chip");
  chip.hidden = !me;
  if (!me) return;
  chip.innerHTML = `<div class="avatar">${avatarHtml(me)}</div><div><div class="chip-tag"></div><div class="chip-rec">${recordText(me)}</div></div>`;
  chip.querySelector(".chip-tag").textContent = me.gamertag;
  $("main-card").innerHTML = `${playerCardHtml(me)}<div class="rank-block">${rankBlockHtml(me)}</div>`;
}

async function refreshProfile() {
  me = (await api.loadMe()) || me;
  renderMe();
  if (currentScreen() === "profile") renderProfile();
  return me;
}

function rankBlockHtml(p) {
  const rank = playerRank(p);
  const games = (p?.rankedWins || 0) + (p?.rankedLosses || 0);
  const meta = rank.placed
    ? `${p.mmr} MMR · ${p.rankedWins}W ${p.rankedLosses}L ranked`
    : `${games}/${PLACEMENT_GAMES} placement matches played`;
  return `<span class="rank-badge">${rankBadgeSvg(rank)}</span>
    <div class="rank-name" style="--rank:${rank.color}">${rank.label}</div>
    <div class="rank-bar" style="--rank:${rank.color}"><i style="width:${Math.round(rank.progress * 100)}%"></i></div>
    <div class="rank-meta">${meta}</div>`;
}

// ---------- emulator -----------------------------------------------------------
const emu = () => window.EJS_emulator;
const pauseGame = () => { try { if (emu() && !emu().paused) emu().pause(); } catch {} };
const resumeGame = () => { try { if (emu()?.paused) emu().play(); } catch {} };

async function bootEmulator() {
  if (emulatorStarted) return;
  emulatorStarted = true;
  const patch = new Uint8Array(await (await fetch("mod.bps", { cache: "no-cache" })).arrayBuffer());
  const rom = applyBps(baseRom, patch);
  Object.assign(window, {
    EJS_player: "#game",
    EJS_core: "n64",
    EJS_gameName: "ssb64-web",
    EJS_gameUrl: URL.createObjectURL(new Blob([rom])),
    EJS_gameID: 1,
    EJS_pathtodata: `${EJS_CDN}/data/`,
    EJS_startOnLoaded: true,
    EJS_netplayUrl: location.origin,
    EJS_netplayICEServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
    EJS_Buttons: { netplay: false },
    EJS_onGameStart: () => {
      emulatorReady = true;
      UNLOCK_ALL_CHEATS.forEach((code, i) => emu().gameManager.setCheat(i, 1, code));
      applyMaps();
      patchGamepadHandler();
      setInterval(syncGamepads, 1000);
      if (!playing) pauseGame();
    },
  });
  const script = document.createElement("script");
  script.src = `${EJS_CDN}/data/loader.js`;
  document.body.append(script);
}

function requireGame() {
  if (emulatorReady) return true;
  sfx("error");
  toast("The game is still loading. One moment…");
  return false;
}

// Online matches run in the rollback engine's iframe; local play in EmulatorJS.
function enterGame(kind) {
  playing = kind;
  showMenuLayer(false);
  setMode("game");
  $("game-layer").classList.toggle("engine", kind === "online");
  if (kind === "local") resumeGame();
  else pauseGame();
}

function exitToMenu(message) {
  playing = null;
  pauseGame();
  $("game-layer").classList.remove("engine");
  showMenuLayer(true);
  setMode("menu");
  go("main");
  if (message) toast(message);
}

function openPause() {
  showMenuLayer(true, true);
  setMode("menu");
  if (playing === "local") pauseGame();
  go("pause");
}

function closePause() {
  showMenuLayer(false);
  setMode("game");
  if (playing === "local") resumeGame();
  document.querySelector(".engine-frame")?.focus();
}

onAction((action) => {
  if (action !== "menu" || !playing) return;
  if ($("menu-layer").hidden) openPause();
  else if (currentScreen() === "pause") closePause();
});

// ---------- title & import ---------------------------------------------------------
// The online engine's game files come from the ROM; prepare them early so the
// first match doesn't wait.
const prepareEngine = () => ensureEngineFiles(baseRom).catch((err) => console.warn(err));

function afterTitle() {
  unlockAudio();
  bootEmulator();
  prepareEngine();
  go(me ? "main" : "create", { mode: "create" });
}

registerScreen("title", {
  onAction: (action) => {
    if (action === "start") { sfx("select"); afterTitle(); return true; }
  },
});
$("press-start").addEventListener("click", afterTitle);

registerScreen("import");
async function importRom(file) {
  if (!file) return;
  try {
    setStatus("import-status", "Checking ROM…");
    baseRom = await readRom(file);
    await saveRom(baseRom);
    setStatus("import-status", "");
    sfx("go");
    afterTitle();
  } catch (err) {
    sfx("error");
    setStatus("import-status", err.message, true);
  }
}
$("rom-file").addEventListener("change", (e) => importRom(e.target.files[0]));
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("focused"); });
drop.addEventListener("dragleave", () => drop.classList.remove("focused"));
drop.addEventListener("drop", (e) => { e.preventDefault(); importRom(e.dataTransfer.files[0]); });

// ---------- profile creation / editing ----------------------------------------------
let createMode = "create"; // create | tag | avatar
let pendingTag = "";

function showTagStep(error) {
  $("create-tag").hidden = false;
  $("create-avatar").hidden = true;
  $("create-eyebrow").textContent = createMode === "create" ? "New profile" : "Edit profile";
  $("tag-input").value = createMode === "create" ? pendingTag : me?.gamertag || "";
  setStatus("tag-status", error || "3-15 letters, numbers or _", !!error);
  focus(document.querySelector("#keyboard [data-autofocus]"), false);
}

function showAvatarStep() {
  $("create-tag").hidden = true;
  $("create-avatar").hidden = false;
  setStatus("avatar-status", "");
  const current = me?.avatarUrl ? -1 : me?.avatarPreset ?? 0;
  const grid = $("avatar-grid");
  grid.innerHTML = "";
  for (let i = 0; i < PRESET_COUNT; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `avatar-choice${i === current ? " current" : ""}`;
    b.dataset.focus = "";
    b.innerHTML = `<div class="avatar">${presetSvg(i)}</div>`;
    b.addEventListener("click", () => choosePreset(i));
    grid.append(b);
  }
  focus(grid.children[Math.max(current, 0)], false);
}

function finishProfileChange(message) {
  renderMe();
  if (createMode === "create") {
    if (message) toast(message);
    go("main");
  } else {
    go("profile");
  }
}

async function choosePreset(index) {
  try {
    if (createMode === "create") {
      me = await api.createProfile(pendingTag, index);
      return finishProfileChange(`Welcome, ${me.gamertag}!`);
    }
    me = await api.updateMe({ avatarPreset: index });
    finishProfileChange();
  } catch (err) {
    sfx("error");
    if (/gamertag/i.test(err.message)) return showTagStep(err.message);
    setStatus("avatar-status", err.message, true);
  }
}

$("avatar-upload").addEventListener("click", () => $("avatar-file").click());
$("avatar-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    setStatus("avatar-status", "Uploading…");
    const blob = await api.squareAvatar(file);
    if (createMode === "create" && !me) me = await api.createProfile(pendingTag, 0);
    me = await api.uploadAvatar(blob);
    finishProfileChange(`Welcome, ${me.gamertag}!`);
  } catch (err) {
    sfx("error");
    if (/gamertag/i.test(err.message)) return showTagStep(err.message);
    setStatus("avatar-status", err.message, true);
  }
});

async function submitTag() {
  const tag = $("tag-input").value.trim();
  if (!GAMERTAG_RE.test(tag)) {
    sfx("error");
    return setStatus("tag-status", "Use 3-15 letters, numbers or _", true);
  }
  if (createMode === "create") {
    pendingTag = tag;
    return showAvatarStep();
  }
  try {
    me = await api.updateMe({ gamertag: tag });
    finishProfileChange();
  } catch (err) {
    sfx("error");
    setStatus("tag-status", err.message, true);
  }
}

mountKeyboard($("keyboard"), $("tag-input"), { onDone: submitTag });
$("tag-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitTag(); } });

registerScreen("create", {
  onEnter: ({ mode } = {}) => {
    createMode = mode || "create";
    if (createMode === "avatar") showAvatarStep();
    else showTagStep();
  },
  onBack: () => {
    if (createMode === "create") {
      if (!$("create-avatar").hidden) showTagStep();
    } else {
      go("profile");
    }
  },
});

// ---------- main menu ---------------------------------------------------------------
registerScreen("main", { onEnter: renderMe });
document.querySelectorAll("#screen-main [data-go]").forEach((b) =>
  b.addEventListener("click", () => {
    const target = b.dataset.go;
    if (target === "online") {
      go("mode"); // online matches use the rollback engine, not the emulator
    } else if (target === "local") {
      if (requireGame()) enterGame("local");
    } else if (target === "controls") {
      go("controls", { from: "main" });
    } else {
      go("profile");
    }
  })
);

// ---------- online --------------------------------------------------------------------
initOnline({
  toast,
  refreshProfile,
  me: () => me,
  gamertag: () => me?.gamertag,
  ensureFiles: () => ensureEngineFiles(baseRom, toast),
  container: () => $("game-layer"),
  enterGame: () => enterGame("online"),
  exitToMenu,
});

// Ranked or a casual size picks a fighter next, then queues.
let pendingQueue = null;
function pickFighterThen(mode, size) {
  pendingQueue = { mode, size };
  go("fighter", { from: mode === "ranked" ? "mode" : "size" });
}

registerScreen("mode", {
  onEnter: () => {
    setStatus("mode-status", "");
    const rank = playerRank(me);
    $("mode-rank-badge").innerHTML = rankBadgeSvg(rank);
    $("mode-rank-label").textContent = rank.label;
  },
  onBack: () => go("main"),
});
document.querySelectorAll("#screen-mode [data-mode]").forEach((tile) =>
  tile.addEventListener("click", async () => {
    if (tile.dataset.mode === "casual") return go("size");
    pickFighterThen("ranked");
  })
);

registerScreen("size", {
  onEnter: () => setStatus("size-status", ""),
  onBack: () => go("mode"),
});
document.querySelectorAll("#screen-size [data-size]").forEach((tile) =>
  tile.addEventListener("click", () => pickFighterThen("casual", Number(tile.dataset.size)))
);

let fighterFrom = "mode";
registerScreen("fighter", {
  onEnter: ({ from } = {}) => {
    fighterFrom = from || "mode";
    setStatus("fighter-status", "");
    const grid = $("fighter-grid");
    const current = savedFighter();
    grid.innerHTML = "";
    for (const f of FIGHTERS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `fighter-tile${f.id === current ? " current" : ""}`;
      b.dataset.focus = "";
      b.style.setProperty("--fighter", f.color);
      b.innerHTML = `<span class="fighter-name"></span>`;
      b.querySelector(".fighter-name").textContent = f.name;
      b.addEventListener("click", () => chooseFighter(f.id));
      grid.append(b);
    }
    focus(grid.children[Math.max(0, FIGHTERS.findIndex((f) => f.id === current))], false);
  },
  onBack: () => go(fighterFrom),
});

async function chooseFighter(id) {
  saveFighter(id);
  if (!pendingQueue) return go("mode");
  try {
    setStatus("fighter-status", "Connecting…");
    await queue(pendingQueue.mode, pendingQueue.size, id);
    go("lobby");
  } catch (err) {
    sfx("error");
    setStatus("fighter-status", err.message, true);
  }
}

registerScreen("lobby", { onBack: () => leave() });
$("lobby-leave").addEventListener("click", () => leave());

// ---------- controls --------------------------------------------------------------------
let controlsFrom = "main";
let controlsPlayer = 0;
let maps = loadMaps();
let capturing = false;

function renderControls(focusId) {
  const tabs = $("player-tabs");
  tabs.innerHTML = [0, 1, 2, 3]
    .map((p) => `<button type="button" class="tab${p === controlsPlayer ? " selected" : ""}" data-focus data-player="${p}">P${p + 1}</button>`)
    .join("");
  tabs.querySelectorAll("[data-player]").forEach((t) =>
    t.addEventListener("click", () => { controlsPlayer = Number(t.dataset.player); renderControls(); })
  );
  const pad = connectedPads()[controlsPlayer];
  $("pad-name").textContent = pad
    ? `Controller: ${pad.id.replace(/\s*\(.*$/, "")} · LB/RB to switch player`
    : `No controller found for P${controlsPlayer + 1} yet. Press a button on it.`;
  const grid = $("bind-grid");
  grid.innerHTML = "";
  for (const input of N64_INPUTS) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bind-row";
    row.dataset.focus = "";
    row.dataset.id = input.id;
    row.innerHTML = `<span>${input.name}</span><span class="bind">${prettyBinding(maps[controlsPlayer][input.id])}</span>`;
    row.addEventListener("click", () => bind(row, input.id));
    grid.append(row);
  }
  const target = focusId === undefined ? grid.firstElementChild : grid.querySelector(`[data-id="${focusId}"]`);
  focus(target, false);
}

async function bind(row, id) {
  if (capturing) return;
  capturing = true;
  row.classList.add("capturing");
  row.querySelector(".bind").textContent = "Press a button…";
  const timeout = setTimeout(cancelCapture, 6000);
  const label = await captureNext();
  clearTimeout(timeout);
  capturing = false;
  if (label !== null) {
    maps[controlsPlayer][id] = label;
    saveMaps(maps);
    sfx("select");
  }
  renderControls(id);
}

registerScreen("controls", {
  onEnter: ({ from } = {}) => {
    controlsFrom = from || "main";
    maps = loadMaps();
    renderControls();
  },
  onAction: (action) => {
    if (action === "tabPrev" || action === "tabNext") {
      controlsPlayer = (controlsPlayer + (action === "tabNext" ? 1 : 3)) % 4;
      sfx("move");
      renderControls();
      return true;
    }
  },
  onBack: () => go(controlsFrom),
});
$("controls-reset").addEventListener("click", () => {
  maps[controlsPlayer] = { ...DEFAULT_MAP };
  saveMaps(maps);
  renderControls();
  toast(`P${controlsPlayer + 1} controls reset`);
});
$("controls-done").addEventListener("click", () => go(controlsFrom));

// ---------- profile --------------------------------------------------------------------
function renderProfile() {
  $("profile-card").innerHTML = playerCardHtml(me);
  $("profile-rank").innerHTML = rankBlockHtml(me);
  $("profile-stats").innerHTML = statsHtml(me);
}
registerScreen("profile", { onEnter: renderProfile, onBack: () => go("main") });
$("profile-tag").addEventListener("click", () => go("create", { mode: "tag" }));
$("profile-avatar").addEventListener("click", () => go("create", { mode: "avatar" }));
$("profile-back").addEventListener("click", () => go("main"));

// ---------- in-game menu ----------------------------------------------------------------
registerScreen("pause", {
  onEnter: () => {
    $("pause-title").textContent = playing === "online" ? "Match menu" : "Paused";
    $("pause-quit").textContent = playing === "online" ? "Leave match" : "Quit to menu";
  },
  onBack: closePause,
});
$("pause-resume").addEventListener("click", closePause);
$("pause-controls").addEventListener("click", () => go("controls", { from: "pause" }));
$("pause-quit").addEventListener("click", () => (playing === "online" ? leave() : exitToMenu()));

// ---------- start -----------------------------------------------------------------------
baseRom = await loadSavedRom();
me = await api.loadMe();
renderMe();
go(baseRom ? "title" : "import");
