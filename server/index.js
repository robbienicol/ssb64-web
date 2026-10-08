// Serves the web player, player profiles, lobby matchmaking and the EmulatorJS netplay signaling protocol.
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  createPlayer, playerByToken, playerById, updatePlayer, setAvatar, getAvatar, publicPlayer, recordMatch,
} from "./db.js";

const PORT = Number(process.env.PORT) || 8064;
const WEB_DIR = fileURLToPath(new URL("../web", import.meta.url));
const AVATAR_MAX_BYTES = 300 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const app = express();
app.use(express.static(WEB_DIR, { extensions: ["html"] }));
const http = createServer(app);
const io = new Server(http, { cors: { origin: true } });

// --- Profiles API ------------------------------------------------------------
const bearer = (req) => (req.get("authorization") || "").replace(/^Bearer\s+/i, "") || null;
function requirePlayer(req, res, next) {
  const row = playerByToken(bearer(req));
  if (!row) return res.status(401).json({ error: "Not signed in" });
  req.player = row;
  next();
}
const fail = (res, err, status = 400) => res.status(status).json({ error: err.message || String(err) });

app.post("/api/players", express.json(), (req, res) => {
  try {
    res.json(createPlayer(String(req.body?.gamertag || "").trim(), req.body?.avatarPreset));
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/me", requirePlayer, (req, res) => res.json(publicPlayer(req.player)));

app.patch("/api/me", requirePlayer, express.json(), (req, res) => {
  try {
    const { gamertag, avatarPreset } = req.body || {};
    res.json(publicPlayer(updatePlayer(req.player.id, {
      gamertag: gamertag === undefined ? undefined : String(gamertag).trim(),
      avatarPreset,
    })));
  } catch (err) {
    fail(res, err);
  }
});

app.put(
  "/api/me/avatar",
  requirePlayer,
  express.raw({ type: [...AVATAR_TYPES], limit: AVATAR_MAX_BYTES }),
  (req, res) => {
    const type = req.get("content-type");
    if (!AVATAR_TYPES.has(type) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return fail(res, new Error("Send a JPEG, PNG or WebP under 300 KB"));
    }
    res.json(publicPlayer(setAvatar(req.player.id, req.body, type)));
  }
);

app.get("/api/avatars/:id", (req, res) => {
  const row = getAvatar(req.params.id);
  if (!row?.avatar) return res.sendStatus(404);
  res.set({ "Content-Type": row.avatar_type, "Cache-Control": "public, max-age=31536000, immutable" });
  res.send(Buffer.from(row.avatar));
});

app.get("/api/players/:id", (req, res) => {
  const p = publicPlayer(playerById(req.params.id));
  p ? res.json(p) : res.sendStatus(404);
});

// --- EmulatorJS netplay rooms --------------------------------------------------
// rooms: sessionId -> { owner: socketId, players: { userid: extra }, roomName, gameId, domain, password, maxPlayers }
const rooms = new Map();
// socketId -> { sessionId, userid }
const membership = new Map();

const socketIdsOf = (room) => Object.values(room.players).map((p) => p.socketId);
const emitTo = (ids, event, payload) => ids.forEach((id) => io.to(id).emit(event, payload));
const normalizePassword = (p) => (!p || String(p).toLowerCase() === "none" ? null : String(p));

app.get("/list", (req, res) => {
  const { domain, game_id } = req.query;
  const out = {};
  for (const [sessionId, room] of rooms) {
    if (room.domain !== domain || String(room.gameId) !== String(game_id)) continue;
    const owner = Object.values(room.players).find((p) => p.socketId === room.owner);
    out[sessionId] = {
      room_name: room.roomName,
      current: Object.keys(room.players).length,
      max: room.maxPlayers,
      player_name: owner?.player_name || "Unknown",
      hasPassword: !!room.password,
      game_id: room.gameId,
    };
  }
  res.json(out);
});

function leaveRoom(socket) {
  const m = membership.get(socket.id);
  if (!m) return;
  membership.delete(socket.id);
  socket.leave(m.sessionId);
  const room = rooms.get(m.sessionId);
  if (!room) return;
  delete room.players[m.userid];
  const remaining = socketIdsOf(room);
  if (remaining.length === 0) {
    rooms.delete(m.sessionId);
    return;
  }
  if (room.owner === socket.id) room.owner = remaining[0];
  emitTo(remaining, "users-updated", room.players);
}

// --- Lobby matchmaking -------------------------------------------------------
// Players pick a match size (2-4) and wait in a lobby until it fills. The first
// member hosts: their browser runs the game and streams it to the others.
const LOBBY_SIZES = new Set([2, 3, 4]);
// lobbyId -> { id, size, members: [socket], status: "waiting" | "starting" | "playing",
//              password, roomName, sessionId?, netplayIds: Map<userid, playerId>, lastResultSeq }
const lobbies = new Map();
const lobbyOf = (socket) => lobbies.get(socket.data.lobbyId);
const memberView = (s) => publicPlayer(playerById(s.data.playerId));

function broadcastLobby(lobby) {
  const payload = {
    lobbyId: lobby.id,
    size: lobby.size,
    ranked: lobby.ranked,
    status: lobby.status,
    members: lobby.members.map(memberView),
  };
  lobby.members.forEach((s) => s.emit("mm-lobby", payload));
}

function findOpenLobby(size) {
  for (const lobby of lobbies.values()) {
    if (!lobby.ranked && lobby.size === size && lobby.status === "waiting" && lobby.members.length < size) return lobby;
  }
  return null;
}

const newLobby = (size, ranked) => {
  const lobby = { id: randomUUID(), size, ranked, members: [], status: "waiting", netplayIds: new Map(), lastResultSeq: -1 };
  lobbies.set(lobby.id, lobby);
  return lobby;
};

// --- Ranked 1v1 queue ----------------------------------------------------------
// Pairs the closest ratings first; each player's acceptable gap widens the longer they wait.
const rankedQueue = []; // { socket, mmr, since }
const searchRange = (entry, now) => Math.min(1000, 100 + Math.floor((now - entry.since) / 1000) * 20);

function leaveRankedQueue(socket) {
  const i = rankedQueue.findIndex((e) => e.socket === socket);
  if (i >= 0) rankedQueue.splice(i, 1);
}

setInterval(() => {
  const now = Date.now();
  rankedQueue.sort((a, b) => a.mmr - b.mmr);
  for (let i = 0; i + 1 < rankedQueue.length; i++) {
    const a = rankedQueue[i], b = rankedQueue[i + 1];
    const gap = Math.abs(a.mmr - b.mmr);
    if (a.socket.data.playerId === b.socket.data.playerId) continue;
    if (gap > searchRange(a, now) || gap > searchRange(b, now)) continue;
    rankedQueue.splice(i, 2);
    i--;
    const lobby = newLobby(2, true);
    for (const e of [a, b]) {
      lobby.members.push(e.socket);
      e.socket.data.lobbyId = lobby.id;
    }
    broadcastLobby(lobby);
    startLobby(lobby);
  }
  for (const e of rankedQueue) {
    e.socket.emit("mm-searching", { elapsed: Math.floor((now - e.since) / 1000), range: searchRange(e, now) });
  }
}, 1000);

function startLobby(lobby) {
  lobby.status = "starting";
  lobby.password = randomUUID().slice(0, 8);
  lobby.roomName = lobby.members.map((s) => playerById(s.data.playerId)?.gamertag).join(" vs ");
  const roster = lobby.members.map(memberView);
  lobby.members.forEach((s, slot) => {
    s.emit("mm-matched", {
      lobbyId: lobby.id,
      ranked: lobby.ranked,
      role: slot === 0 ? "host" : "guest",
      slot,
      roster,
      roomName: lobby.roomName,
      password: lobby.password,
    });
  });
}

function notifyGuests(lobby) {
  lobby.members.slice(1).forEach((s) =>
    s.emit("mm-join", { sessionId: lobby.sessionId, roomName: lobby.roomName, password: lobby.password })
  );
}

function leaveLobby(socket, reason) {
  leaveRankedQueue(socket);
  const lobby = lobbyOf(socket);
  socket.data.lobbyId = null;
  if (!lobby) return;
  lobby.members = lobby.members.filter((s) => s !== socket);
  if (lobby.members.length === 0) {
    lobbies.delete(lobby.id);
    return;
  }
  if (lobby.status === "waiting") {
    broadcastLobby(lobby);
    return;
  }
  // A match in progress can't continue without everyone; send the rest back to the menu.
  const name = playerById(socket.data.playerId)?.gamertag || "A player";
  lobby.members.forEach((s) => {
    s.data.lobbyId = null;
    s.emit("mm-ended", { reason: `${name} ${reason}` });
  });
  lobbies.delete(lobby.id);
}

io.on("connection", (socket) => {
  // EmulatorJS netplay protocol
  socket.on("open-room", (data, ack = () => {}) => {
    const extra = data?.extra && typeof data.extra === "object" ? data.extra : {};
    const sessionId = extra.sessionid && String(extra.sessionid);
    const userid = (extra.userid || extra.playerId) && String(extra.userid || extra.playerId);
    if (!sessionId || !userid) return ack("Invalid data: sessionId and playerId required");
    if (rooms.has(sessionId)) return ack("Room already exists");
    leaveRoom(socket);
    extra.socketId = socket.id;
    rooms.set(sessionId, {
      owner: socket.id,
      players: { [userid]: extra },
      roomName: extra.room_name || `Room ${sessionId}`,
      gameId: extra.game_id ?? "default",
      domain: extra.domain || "unknown",
      password: normalizePassword(data.password),
      maxPlayers: Number(data.maxPlayers) || 4,
    });
    membership.set(socket.id, { sessionId, userid });
    socket.join(sessionId);
    ack(null);
    socket.emit("users-updated", rooms.get(sessionId).players);

    for (const lobby of lobbies.values()) {
      if (lobby.sessionId === sessionId && lobby.status === "starting") notifyGuests(lobby);
    }
  });

  socket.on("join-room", (data, ack = () => {}) => {
    const extra = data?.extra && typeof data.extra === "object" ? data.extra : {};
    const sessionId = extra.sessionid && String(extra.sessionid);
    const userid = (extra.userid || extra.playerId) && String(extra.userid || extra.playerId);
    if (!sessionId || !userid) return ack("Invalid data: sessionId and playerId required");
    const room = rooms.get(sessionId);
    if (!room) return ack("Room not found");
    if (room.password && normalizePassword(data.password) !== room.password) return ack("Incorrect password");
    if (Object.keys(room.players).length >= room.maxPlayers) return ack("Room full");
    leaveRoom(socket);
    extra.socketId = socket.id;
    room.players[userid] = extra;
    membership.set(socket.id, { sessionId, userid });
    socket.join(sessionId);
    ack(null, room.players);
    emitTo(socketIdsOf(room), "users-updated", room.players);
  });

  socket.on("leave-room", () => leaveRoom(socket));

  socket.on("webrtc-signal", (data) => {
    if (!data?.target) return;
    const payload = { sender: socket.id };
    if (data.requestRenegotiate) payload.requestRenegotiate = true;
    if (data.candidate) payload.candidate = data.candidate;
    if (data.offer) payload.offer = data.offer;
    if (data.answer) payload.answer = data.answer;
    io.to(String(data.target)).emit("webrtc-signal", payload);
  });

  for (const event of ["data-message", "snapshot", "input"]) {
    socket.on(event, (data) => {
      const m = membership.get(socket.id);
      const room = m && rooms.get(m.sessionId);
      if (!room) return;
      emitTo(socketIdsOf(room).filter((id) => id !== socket.id), event, data);
    });
  }

  socket.on("chat-message", (data, ack = () => {}) => {
    const m = membership.get(socket.id);
    const room = m && rooms.get(m.sessionId);
    if (!room) return ack({ ok: false, error: "Not in a room" });
    const message = String(data?.message || "").slice(0, 300).trim();
    if (!message) return ack({ ok: false, error: "Empty message" });
    const player = room.players[m.userid];
    emitTo(socketIdsOf(room), "chat-message", {
      ts: Date.now(), to: "all", userid: m.userid, player_name: player?.player_name || "Player", message,
    });
    ack({ ok: true });
  });

  // Matchmaking
  socket.on("mm-queue", (data, ack = () => {}) => {
    const row = playerByToken(data?.token);
    if (!row) return ack({ error: "Create a profile first" });
    const ranked = data?.mode === "ranked";
    const size = ranked ? 2 : Number(data?.size);
    if (!LOBBY_SIZES.has(size)) return ack({ error: "Pick 2, 3 or 4 players" });
    leaveLobby(socket, "left");
    socket.data.playerId = row.id;

    if (ranked) {
      rankedQueue.push({ socket, mmr: row.mmr, since: Date.now() });
      ack({ ok: true });
      socket.emit("mm-searching", { elapsed: 0, range: 100 });
      return;
    }

    const lobby = findOpenLobby(size) || newLobby(size, false);
    lobby.members.push(socket);
    socket.data.lobbyId = lobby.id;
    ack({ ok: true });
    broadcastLobby(lobby);
    if (lobby.members.length === lobby.size) startLobby(lobby);
  });

  socket.on("mm-leave", () => leaveLobby(socket, "left the match"));

  // Each browser reports the EmulatorJS netplay user id it got, so results can be matched to profiles.
  socket.on("mm-netplay-id", (data) => {
    const lobby = lobbyOf(socket);
    if (!lobby || !data?.userid) return;
    lobby.netplayIds.set(String(data.userid), socket.data.playerId);
  });

  socket.on("mm-hosted", (data) => {
    const lobby = lobbyOf(socket);
    if (!lobby || lobby.members[0] !== socket || !data?.sessionId) return;
    lobby.sessionId = String(data.sessionId);
    if (rooms.has(lobby.sessionId)) notifyGuests(lobby);
  });

  socket.on("mm-playing", () => {
    const lobby = lobbyOf(socket);
    if (lobby && lobby.status === "starting") lobby.status = "playing";
  });

  // The host reads the finished VS battle out of game memory and reports it.
  // results: { seq, ports: [{ userid, won }] }
  socket.on("mm-result", (data) => {
    const lobby = lobbyOf(socket);
    if (!lobby || lobby.members[0] !== socket) return;
    const seq = Number(data?.seq);
    if (!Number.isInteger(seq) || seq <= lobby.lastResultSeq) return;
    const ports = Array.isArray(data?.ports) ? data.ports.slice(0, 4) : [];
    const results = [];
    ports.forEach((p, port) => {
      const playerId = lobby.netplayIds.get(String(p?.userid));
      if (playerId && !results.some((r) => r.playerId === playerId)) {
        results.push({ playerId, port, won: !!p.won });
      }
    });
    if (results.length < 2 || results.filter((r) => r.won).length !== 1) return;
    if (lobby.ranked && results.length !== 2) return;
    lobby.lastResultSeq = seq;
    const { deltas } = recordMatch(lobby.size, results, lobby.ranked);
    const roster = lobby.members.map(memberView);
    lobby.members.forEach((s) => s.emit("mm-recorded", {
      ranked: lobby.ranked,
      roster,
      deltas,
      winner: publicPlayer(playerById(results.find((r) => r.won).playerId)),
    }));
  });

  socket.on("disconnect", () => {
    leaveLobby(socket, "disconnected");
    leaveRoom(socket);
  });
});

http.listen(PORT, () => console.log(`ssb64-web listening on http://localhost:${PORT}`));
