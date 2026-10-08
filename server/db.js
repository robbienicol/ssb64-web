// Player profiles and match records, stored in SQLite.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { START_MMR, eloChange } from "../web/ui/ranks.js";

const DB_PATH = process.env.DB_PATH || new URL("../data/ssb64.db", import.meta.url).pathname;
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    gamertag TEXT NOT NULL UNIQUE COLLATE NOCASE,
    avatar_preset INTEGER NOT NULL DEFAULT 0,
    avatar BLOB,
    avatar_type TEXT,
    avatar_version INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    winner_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL REFERENCES matches(id),
    player_id TEXT NOT NULL REFERENCES players(id),
    port INTEGER NOT NULL,
    won INTEGER NOT NULL,
    PRIMARY KEY (match_id, player_id)
  );
`);

// Columns added after the first release.
function addColumn(table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}
addColumn("players", "mmr", `INTEGER NOT NULL DEFAULT ${START_MMR}`);
addColumn("players", "peak_mmr", `INTEGER NOT NULL DEFAULT ${START_MMR}`);
addColumn("players", "ranked_wins", "INTEGER NOT NULL DEFAULT 0");
addColumn("players", "ranked_losses", "INTEGER NOT NULL DEFAULT 0");
addColumn("matches", "ranked", "INTEGER NOT NULL DEFAULT 0");
addColumn("match_players", "mmr_delta", "INTEGER");

const hashToken = (token) => createHash("sha256").update(token).digest("hex");

export const GAMERTAG_RE = /^[A-Za-z0-9_]{3,15}$/;
export const AVATAR_PRESETS = 12;

export function publicPlayer(row) {
  if (!row) return null;
  return {
    id: row.id,
    gamertag: row.gamertag,
    wins: row.wins,
    losses: row.losses,
    avatarPreset: row.avatar_preset,
    mmr: row.mmr,
    peakMmr: row.peak_mmr,
    rankedWins: row.ranked_wins,
    rankedLosses: row.ranked_losses,
    avatarUrl: row.avatar_type ? `/api/avatars/${row.id}?v=${row.avatar_version}` : null,
  };
}

const q = {
  byToken: db.prepare("SELECT * FROM players WHERE token_hash = ?"),
  byId: db.prepare("SELECT * FROM players WHERE id = ?"),
  byTag: db.prepare("SELECT id FROM players WHERE gamertag = ?"),
  insert: db.prepare(
    "INSERT INTO players (id, token_hash, gamertag, avatar_preset, created_at) VALUES (?, ?, ?, ?, ?)"
  ),
  setTag: db.prepare("UPDATE players SET gamertag = ? WHERE id = ?"),
  setPreset: db.prepare(
    "UPDATE players SET avatar_preset = ?, avatar = NULL, avatar_type = NULL, avatar_version = avatar_version + 1 WHERE id = ?"
  ),
  setAvatar: db.prepare(
    "UPDATE players SET avatar = ?, avatar_type = ?, avatar_version = avatar_version + 1 WHERE id = ?"
  ),
  avatar: db.prepare("SELECT avatar, avatar_type FROM players WHERE id = ?"),
  insertMatch: db.prepare("INSERT INTO matches (id, size, winner_id, created_at, ranked) VALUES (?, ?, ?, ?, ?)"),
  insertMatchPlayer: db.prepare(
    "INSERT INTO match_players (match_id, player_id, port, won, mmr_delta) VALUES (?, ?, ?, ?, ?)"
  ),
  applyRanked: db.prepare(`UPDATE players SET mmr = mmr + ?, peak_mmr = MAX(peak_mmr, mmr + ?),
    ranked_wins = ranked_wins + ?, ranked_losses = ranked_losses + ? WHERE id = ?`),
  addWin: db.prepare("UPDATE players SET wins = wins + 1 WHERE id = ?"),
  addLoss: db.prepare("UPDATE players SET losses = losses + 1 WHERE id = ?"),
};

export function createPlayer(gamertag, avatarPreset) {
  if (!GAMERTAG_RE.test(gamertag)) throw new Error("Gamertag must be 3-15 letters, numbers or _");
  if (q.byTag.get(gamertag)) throw new Error("That gamertag is taken");
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const preset = Number.isInteger(avatarPreset) ? Math.abs(avatarPreset) % AVATAR_PRESETS : 0;
  q.insert.run(id, hashToken(token), gamertag, preset, Date.now());
  return { token, player: publicPlayer(q.byId.get(id)) };
}

export const playerByToken = (token) => (token ? q.byToken.get(hashToken(token)) : undefined);
export const playerById = (id) => q.byId.get(id);

export function updatePlayer(id, { gamertag, avatarPreset }) {
  if (gamertag !== undefined) {
    if (!GAMERTAG_RE.test(gamertag)) throw new Error("Gamertag must be 3-15 letters, numbers or _");
    const taken = q.byTag.get(gamertag);
    if (taken && taken.id !== id) throw new Error("That gamertag is taken");
    q.setTag.run(gamertag, id);
  }
  if (avatarPreset !== undefined) q.setPreset.run(Math.abs(Number(avatarPreset) | 0) % AVATAR_PRESETS, id);
  return q.byId.get(id);
}

export function setAvatar(id, bytes, type) {
  q.setAvatar.run(bytes, type, id);
  return q.byId.get(id);
}

export const getAvatar = (id) => q.avatar.get(id);

// results: [{ playerId, port, won }]. Ranked matches are 1v1 and also move MMR.
// Returns { matchId, deltas: { playerId: mmrDelta } }.
export function recordMatch(size, results, ranked = false) {
  const matchId = randomUUID();
  const winner = results.find((r) => r.won);
  const deltas = {};
  if (ranked) {
    const loser = results.find((r) => !r.won);
    const w = q.byId.get(winner.playerId);
    const l = q.byId.get(loser.playerId);
    const change = eloChange(w.mmr, l.mmr, w.ranked_wins + w.ranked_losses, l.ranked_wins + l.ranked_losses);
    deltas[w.id] = change.winner;
    deltas[l.id] = Math.max(change.loser, -l.mmr);
  }
  db.exec("BEGIN");
  try {
    q.insertMatch.run(matchId, size, winner ? winner.playerId : null, Date.now(), ranked ? 1 : 0);
    for (const r of results) {
      q.insertMatchPlayer.run(matchId, r.playerId, r.port, r.won ? 1 : 0, deltas[r.playerId] ?? null);
      (r.won ? q.addWin : q.addLoss).run(r.playerId);
      if (ranked) {
        const d = deltas[r.playerId];
        q.applyRanked.run(d, d, r.won ? 1 : 0, r.won ? 0 : 1, r.playerId);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { matchId, deltas };
}
