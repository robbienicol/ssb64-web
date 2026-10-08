// Online lobbies: queue for a 2/3/4 player match, wait for it to fill, then hand the
// group to EmulatorJS netplay. The host's browser runs the game and streams it;
// it also reads finished battles out of game memory and reports W/L.
import { getToken } from "./api.js";
import { playerCardHtml } from "./avatars.js";
import { rankFor } from "./ranks.js";
import { locateRdram, currentScene, readBattleResult, SCENE_VS_RESULTS } from "./memory.js";
import { sfx } from "./sfx.js";

const SIZE_NAMES = { 2: "1 vs 1", 3: "3-player free-for-all", 4: "4-player free-for-all" };

let socket = null;
let hooks = {};
let state = "idle"; // idle | waiting | starting | playing
let lobby = null; // last mm-lobby payload
let match = null; // mm-matched payload
let resultTimer = null;
let liveTimer = null;
let countdownTimer = null;
let search = null; // { elapsed, range } while in the ranked queue

export function initOnline(h) {
  hooks = h;
}

export const isInMatch = () => state === "starting" || state === "playing";
export const inLobby = () => state !== "idle";

function loadSocketIo() {
  if (window.io) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/socket.io/socket.io.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't reach the matchmaking server."));
    document.head.append(s);
  });
}

async function connect() {
  await loadSocketIo();
  if (socket) return;
  socket = window.io(location.origin);
  socket.on("mm-lobby", (payload) => {
    const grew = lobby && payload.members.length > lobby.members.length;
    lobby = payload;
    if (grew) sfx("join");
    renderLobby();
  });
  socket.on("mm-searching", (info) => {
    search = info;
    renderLobby();
  });
  socket.on("mm-matched", onMatched);
  socket.on("mm-join", (j) => {
    try {
      const np = netplay();
      np.joinRoom(j.sessionId, j.roomName, match.roster.length, j.password);
      socket.emit("mm-netplay-id", { userid: np.playerID });
    } catch (err) {
      abort(err.message);
    }
  });
  socket.on("mm-ended", ({ reason }) => finish(reason));
  socket.on("mm-recorded", async ({ winner, ranked, deltas }) => {
    const before = hooks.me?.();
    const after = await hooks.refreshProfile?.();
    if (!ranked || !before || !after || deltas?.[after.id] === undefined) {
      hooks.toast?.(`${winner.gamertag} wins! Record updated.`);
      return;
    }
    const delta = deltas[after.id];
    const was = rankFor(before.mmr, before.rankedWins + before.rankedLosses);
    const now = rankFor(after.mmr, after.rankedWins + after.rankedLosses);
    let msg = `${delta >= 0 ? "+" : ""}${delta} MMR`;
    if (!was.placed && now.placed) msg = `Placed in ${now.label}!`;
    else if (now.index > was.index) msg = `Promoted to ${now.label}! ${msg}`;
    else if (now.index < was.index) msg = `Demoted to ${now.label}. ${msg}`;
    else if (!now.placed) msg = `Placement ${after.rankedWins + after.rankedLosses}/5 · ${msg}`;
    hooks.toast?.(msg);
  });
  socket.on("disconnect", () => {
    if (state !== "idle") finish("Lost connection to the server.");
  });
}

function netplay() {
  const np = window.EJS_emulator?.netplay;
  if (!np) throw new Error("Online play isn't ready yet. Try again in a moment.");
  np.name = hooks.gamertag?.() || "Player";
  if (!np.updateList) np.defineNetplayFunctions();
  return np;
}

export async function queue(mode, size) {
  await connect();
  const ranked = mode === "ranked";
  const res = await new Promise((resolve) =>
    socket.emit("mm-queue", { token: getToken(), mode, size }, resolve)
  );
  if (res?.error) throw new Error(res.error);
  state = "waiting";
  match = null;
  search = ranked ? { elapsed: 0, range: 100 } : null;
  lobby = { size: ranked ? 2 : size, ranked, members: ranked ? [hooks.me?.()].filter(Boolean) : [], status: "waiting" };
  renderLobby();
}

export function leave() {
  socket?.emit("mm-leave");
  finish(null);
}

function onMatched(m) {
  match = m;
  state = "starting";
  sfx("go");
  renderLobby();
  let n = 3;
  const tick = () => {
    const el = document.getElementById("lobby-countdown");
    if (el) el.textContent = n > 0 ? String(n) : "GO!";
    if (n-- > 0) countdownTimer = setTimeout(tick, 700);
  };
  tick();
  try {
    if (m.role === "host") {
      const np = netplay();
      np.openRoom(m.roomName, m.roster.length, m.password);
      socket.emit("mm-netplay-id", { userid: np.playerID });
      socket.emit("mm-hosted", { sessionId: np.extra.sessionid });
    }
  } catch (err) {
    abort(err.message);
    return;
  }
  // Live once the host sees everyone joined, or a guest receives the stream.
  liveTimer = setInterval(() => {
    const np = window.EJS_emulator?.netplay;
    if (!np) return;
    const live = np.owner ? Object.keys(np.players || {}).length >= m.roster.length : np._gotVideoEver;
    if (!live) return;
    clearInterval(liveTimer);
    liveTimer = null;
    state = "playing";
    socket.emit("mm-playing");
    hooks.enterGame?.();
    if (np.owner) watchResults();
  }, 300);
}

// Host only: report each finished VS battle once, when the results screen appears.
async function watchResults() {
  if (!(await locateRdram())) return;
  let prevScene = currentScene();
  let seq = 0;
  resultTimer = setInterval(() => {
    const scene = currentScene();
    if (scene === SCENE_VS_RESULTS && prevScene !== SCENE_VS_RESULTS) {
      const result = readBattleResult();
      const userids = Object.keys(window.EJS_emulator?.netplay?.players || {});
      if (result.valid) {
        socket.emit("mm-result", {
          seq: seq++,
          ports: result.ports.map((p, i) => (p.human && userids[i] ? { userid: userids[i], won: p.won } : null)),
        });
      }
    }
    prevScene = scene;
  }, 500);
}

function leaveNetplay() {
  const emu = window.EJS_emulator;
  if (emu?.isNetplay) emu.netplay.leaveRoom();
}

function abort(message) {
  socket?.emit("mm-leave");
  finish(message);
}

function finish(message) {
  clearTimeout(countdownTimer);
  clearInterval(liveTimer);
  clearInterval(resultTimer);
  liveTimer = resultTimer = null;
  const wasActive = state !== "idle";
  state = "idle";
  lobby = null;
  match = null;
  search = null;
  leaveNetplay();
  if (wasActive) hooks.exitToMenu?.(message);
}

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function renderLobby() {
  const root = document.getElementById("lobby-body");
  if (!root || !lobby) return;
  const ranked = match ? match.ranked : lobby.ranked;
  const size = match ? match.roster.length : lobby.size;
  const members = match ? match.roster : lobby.members;
  const slots = [];
  for (let i = 0; i < size; i++) {
    slots.push(members[i]
      ? `<div class="lobby-slot filled">${playerCardHtml(members[i], { slot: i, showRank: ranked })}${match && i === 0 ? '<span class="host-tag">HOST</span>' : ""}</div>`
      : `<div class="lobby-slot empty p${i + 1}"><span class="slot-tag p${i + 1}">P${i + 1}</span><div class="searching">Searching<span class="dots"></span></div></div>`);
  }
  const title = match ? "MATCH FOUND" : ranked ? "SEARCHING" : "FINDING PLAYERS";
  let sub;
  if (match) sub = '<div class="countdown" id="lobby-countdown">3</div>';
  else if (ranked) sub = `<div class="lobby-count">${clock(search?.elapsed || 0)}</div><div class="lobby-note">Search range ±${search?.range || 100} MMR</div>`;
  else sub = `<div class="lobby-count">${members.length} / ${size}</div>`;
  root.innerHTML = `
    <div class="lobby-head">
      <div class="eyebrow">${ranked ? "Ranked · 1 vs 1" : `Casual · ${SIZE_NAMES[size] || ""}`}</div>
      <h2>${title}</h2>
      ${sub}
    </div>
    <div class="lobby-grid size-${size}">${slots.join("")}</div>`;
  document.getElementById("lobby-leave").textContent = match ? "Cancel match" : "Leave lobby";
}
