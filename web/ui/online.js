// Online matches: queue for ranked 1v1 or a 2/3/4 player casual lobby, then
// play with rollback netcode. Every player's browser runs the game (the
// BattleShip engine) and exchanges inputs directly with the others over
// WebRTC; the server only matches players, relays signaling and records
// results, which every engine reports when the battle ends.
import { getToken } from "./api.js";
import { playerCardHtml } from "./avatars.js";
import { rankFor } from "./ranks.js";
import { createMesh } from "./rtc.js";
import { startEngine, prefetchEngine } from "./engine.js";
import { fighterName, STAGES } from "./fighters.js";
import { sfx } from "./sfx.js";

const SIZE_NAMES = { 2: "1 vs 1", 3: "3-player free-for-all", 4: "4-player free-for-all" };
const CONNECT_TIMEOUT_MS = 25000; // WebRTC links to every player
const START_TIMEOUT_MS = 90000; // engine download/boot and rollback sync
// Networks that block direct WebRTC links fall back to relaying the engine's
// packets through our server (more latency, but the match still happens).
const RELAY_AFTER_MS = 6000;
const forceRelay = () => { try { return localStorage.getItem("ssb64-web:relay") === "1"; } catch { return false; } };
const RESULTS_HOLD_MS = 7000;

let socket = null;
let hooks = {};
let state = "idle"; // idle | waiting | starting | playing | over
let lobby = null; // last mm-lobby payload
let match = null; // mm-matched payload
let search = null; // { elapsed, range } while in the ranked queue
let status = ""; // connection progress shown in the lobby
let mesh = null;
let engine = null;
let early = []; // packets that arrive before the engine is up
let connectTimer = null;
let overTimer = null;
let reported = false;
let relaying = false;
let perf = null; // match performance, reported to the server for tuning

export function initOnline(h) {
  hooks = h;
}

export const isInMatch = () => state === "starting" || state === "playing" || state === "over";
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
  socket.on("mm-signal", ({ from, data }) => mesh?.signal(from, data));
  socket.on("mm-relay", ({ from, data }) => receive(from, data));
  socket.on("mm-ended", ({ reason }) => {
    console.warn("[online] match ended by server:", reason);
    if (state !== "over") finish(reason);
  });
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
    let msg = `${winner.gamertag} wins · ${delta >= 0 ? "+" : ""}${delta} MMR`;
    if (!was.placed && now.placed) msg = `Placed in ${now.label}!`;
    else if (now.index > was.index) msg = `Promoted to ${now.label}! ${delta >= 0 ? "+" : ""}${delta} MMR`;
    else if (now.index < was.index) msg = `Demoted to ${now.label}. ${delta} MMR`;
    else if (!now.placed) msg = `Placement ${after.rankedWins + after.rankedLosses}/5 · ${msg}`;
    hooks.toast?.(msg);
  });
  socket.on("disconnect", () => {
    if (state !== "idle" && state !== "over") finish("Lost connection to the server.");
  });
}

// mode: "ranked" | "casual"; size: 2-4 for casual; fighter: engine fighter id.
export async function queue(mode, size, fighter) {
  await hooks.ensureFiles?.();
  prefetchEngine(); // download the engine while waiting for players
  await connect();
  const ranked = mode === "ranked";
  const res = await new Promise((resolve) =>
    socket.emit("mm-queue", { token: getToken(), mode, size, fighter }, resolve)
  );
  if (res?.error) throw new Error(res.error);
  state = "waiting";
  match = null;
  status = "";
  search = ranked ? { elapsed: 0, range: 100 } : null;
  lobby = { size: ranked ? 2 : size, ranked, members: ranked ? [hooks.me?.()].filter(Boolean) : [], status: "waiting" };
  renderLobby();
}

// The player chose to leave (from the lobby or the match menu). Quitting a
// ranked match that is underway counts as a loss.
export function leave() {
  socket?.emit("mm-leave", { quit: true });
  finish(null);
}

export const inRankedMatch = () => !!match?.ranked && state === "playing";

function setStatus(text) {
  status = text;
  const el = document.getElementById("lobby-status");
  if (el) el.textContent = text;
}

function receive(slot, data) {
  if (engine) engine.deliver(`p${slot}`, data);
  else if (early.length < 256) early.push([slot, data]);
}

// Direct link when it's up, else through the server once relaying.
function sendTo(slot, bytes) {
  if (mesh?.isOpen(slot) && !forceRelay()) mesh.send(slot, bytes);
  else if (relaying) socket.emit("mm-relay", { to: slot, data: new Uint8Array(bytes).buffer });
}

async function onMatched(m) {
  match = m;
  state = "starting";
  reported = false;
  relaying = false;
  early = [];
  perf = { start: 0, samples: [], last: null };
  sfx("go");
  renderLobby();
  const count = m.roster.length;

  // Created right away: offers from other players may already be on their way.
  mesh = createMesh({
    self: m.slot,
    count,
    signal: (to, data) => socket.emit("mm-signal", { to, data }),
    onMessage: receive,
    // A direct link that drops mid-match: carry on through the server.
    onLost: () => { relaying = true; },
  });
  connectTimer = setTimeout(() => abort("Couldn't connect to every player. Try again."), CONNECT_TIMEOUT_MS);

  try {
    setStatus("Connecting to players…");
    const linked = Promise.race([
      mesh.ready.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, RELAY_AFTER_MS)),
    ]).then(() => {
      if (!mesh?.isOpen(m.slot === 0 ? 1 : 0) || forceRelay()) {
        relaying = true;
        console.warn("[online] no direct link; relaying through the server");
      }
    });
    const [o2r] = await Promise.all([hooks.ensureFiles(), linked]);
    if (match !== m) return;
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => abort("The match took too long to start. Try again."), START_TIMEOUT_MS);
    setStatus("Loading the game…");
    const peers = m.roster.map((_, i) => `p${i}`).join(",");
    hooks.enterGame?.();
    engine = await startEngine({
      container: hooks.container(),
      o2r,
      env: {
        SSB64_ROLLBACK: "1",
        SSB64_ROLLBACK_PLAYERS: String(count),
        SSB64_ROLLBACK_LOCAL: String(m.slot),
        SSB64_ROLLBACK_PEERS: peers,
        SSB64_ROLLBACK_DELAY: "2",
        SSB64_NETPLAY_BATTLE: m.battle.spec,
      },
      net: { send: (peer, bytes) => sendTo(Number(peer.slice(1)), bytes) },
      onEvent,
    });
    if (match !== m) return;
    for (const [slot, data] of early.splice(0)) engine.deliver(`p${slot}`, data);
  } catch (err) {
    console.error("[online] match start failed", err);
    if (match === m) abort(err.message);
  }
}

// stats every 120 frames: { frame, ping, rollbacks, stalls, ahead, work, skipped }
function onStats(detail) {
  const now = performance.now();
  if (perf.last) {
    const fps = ((detail.frame - perf.last.frame) * 1000) / (now - perf.lastAt);
    perf.samples.push({ fps, ping: detail.ping, work: detail.work, skipped: detail.skipped, ahead: detail.ahead });
  }
  perf.last = detail;
  perf.lastAt = now;
  hooks.showPing?.(detail.ping, relaying);
}

function sendTelemetry(outcome) {
  if (!perf?.samples.length || perf.sent) return;
  perf.sent = true;
  const s = perf.samples;
  const avg = (k) => Math.round((s.reduce((a, x) => a + x[k], 0) / s.length) * 10) / 10;
  const min = (k) => Math.round(Math.min(...s.map((x) => x[k])) * 10) / 10;
  const max = (k) => Math.round(Math.max(...s.map((x) => x[k])) * 10) / 10;
  socket?.emit("mm-telemetry", {
    outcome,
    relaying,
    fps: { avg: avg("fps"), min: min("fps") },
    ping: { avg: avg("ping"), max: max("ping") },
    workMs: { avg: avg("work"), max: max("work") },
    skipped: s.reduce((a, x) => a + x.skipped, 0),
    ahead: avg("ahead"),
    rollbacks: perf.last?.rollbacks,
    stalls: perf.last?.stalls,
    frames: perf.last?.frame,
    cores: navigator.hardwareConcurrency,
    ua: navigator.userAgent,
  });
}

function onEvent(type, detail) {
  if (type === "stats") {
    onStats(detail);
  } else if (type === "session-start") {
    clearTimeout(connectTimer);
    state = "playing";
    socket.emit("mm-playing");
  } else if (type === "battle-over") {
    if (!reported) {
      reported = true;
      state = "over";
      socket.emit("mm-battle", detail);
      sendTelemetry("finished");
      const winner = detail?.players?.find((p) => p.place === 0);
      if (winner) hooks.toast?.(`${match?.roster[winner.slot]?.gamertag || "?"} wins!`);
      overTimer = setTimeout(() => {
        socket.emit("mm-leave");
        finish(null);
      }, RESULTS_HOLD_MS);
    }
  } else if (type === "player-disconnected") {
    if (state !== "over") abort(`${match?.roster[detail?.slot]?.gamertag || "A player"} disconnected.`);
  } else if (type === "desync") {
    console.warn("[engine] desync at frame", detail?.frame);
  }
}

function abort(message) {
  console.warn("[online] match aborted:", message);
  socket?.emit("mm-leave");
  finish(message);
}

function finish(message) {
  sendTelemetry(message ? "aborted" : "left");
  hooks.showPing?.(null);
  clearTimeout(connectTimer);
  clearTimeout(overTimer);
  engine?.close();
  mesh?.close();
  engine = mesh = null;
  early = [];
  const wasActive = state !== "idle";
  state = "idle";
  lobby = null;
  match = null;
  search = null;
  status = "";
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
    const fighter = match ? `<span class="slot-fighter">${fighterName(match.battle.fighters[i])}</span>` : "";
    slots.push(members[i]
      ? `<div class="lobby-slot filled">${playerCardHtml(members[i], { slot: i, showRank: ranked })}${fighter}</div>`
      : `<div class="lobby-slot empty p${i + 1}"><span class="slot-tag p${i + 1}">P${i + 1}</span><div class="searching">Searching<span class="dots"></span></div></div>`);
  }
  const title = match ? "MATCH FOUND" : ranked ? "SEARCHING" : "FINDING PLAYERS";
  let sub;
  if (match) sub = `<div class="lobby-note">${STAGES[match.battle.stage] || ""}</div><div class="lobby-note" id="lobby-status">${status}</div>`;
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
