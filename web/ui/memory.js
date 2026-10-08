// Reads the N64's RAM out of the emulator to detect finished VS battles.
// Addresses come from the decomp's US build map.
const ENTRY_WORDS = [0x3c088004, 0x3c090006, 0x2508fad0, 0x35291ea0]; // code at 0x80000400
const SCENE_DATA = 0x800a4ad0; // gSCManagerSceneData; first byte is scene_curr
const BATTLE_PTR = 0x800a50e8; // gSCManagerBattleState
const VS_BATTLE_STATE = 0x800a4ef8; // gSCManagerVSBattleState (what the results screen reads)
export const SCENE_VS_RESULTS = 24;
const PLAYERS_OFFSET = 0x20;
const PLAYER_SIZE = 0x74;
const PKIND_NONE = 2;
const PKIND_CPU = 1;
const RULE_STOCK = 0x2;

let base = null;

const heap = () => window.EJS_emulator?.gameManager?.Module?.HEAPU8 || null;
const words = () => { const h = heap(); return h ? new Uint32Array(h.buffer) : null; };

// RDRAM is stored as native 32-bit words, so bytes within a word are swapped.
export const read8 = (addr) => heap()[base + ((addr & 0x7fffff) ^ 3)];
export const read32 = (addr) => words()[(base + (addr & 0x7ffffc)) >>> 2];
const read32s = (addr) => read32(addr) | 0;

function looksLikeRdram(b) {
  const w = words();
  const at = (addr) => w[(b + (addr & 0x7ffffc)) >>> 2];
  const scene = at(SCENE_DATA) >>> 24;
  const battle = at(BATTLE_PTR);
  return scene < 64 && battle >= 0x80000000 && battle < 0x80800000;
}

// Scans the emulator heap for RDRAM in chunks so the page stays responsive.
export async function locateRdram() {
  if (base !== null && looksLikeRdram(base)) return true;
  base = null;
  const w = words();
  if (!w) return false;
  const CHUNK = 1 << 22;
  for (let start = 0; start < w.length - 4; start += CHUNK) {
    const end = Math.min(start + CHUNK, w.length - 4);
    for (let i = start; i < end; i++) {
      if (w[i] !== ENTRY_WORDS[0] || w[i + 1] !== ENTRY_WORDS[1] || w[i + 2] !== ENTRY_WORDS[2] || w[i + 3] !== ENTRY_WORDS[3]) continue;
      const candidate = i * 4 - 0x400;
      if (candidate >= 0 && looksLikeRdram(candidate)) { base = candidate; return true; }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return false;
}

export const currentScene = () => (base === null ? null : read8(SCENE_DATA));

// Returns { ports: [{ present, human, won }], valid } for the battle the results screen shows.
export function readBattleResult() {
  const state = VS_BATTLE_STATE;
  const isTeam = read8(state + 2) !== 0;
  const stockRules = (read8(state + 3) & RULE_STOCK) !== 0;
  const ports = [];
  for (let i = 0; i < 4; i++) {
    const p = state + PLAYERS_OFFSET + i * PLAYER_SIZE;
    const pkind = read8(p + 2);
    ports.push({
      present: pkind !== PKIND_NONE,
      human: pkind !== PKIND_NONE && pkind !== PKIND_CPU,
      place: read8(p + 0x0d),
      score: read32s(p + 0x14),
    });
  }
  const present = ports.filter((p) => p.present);
  let winners;
  if (stockRules) {
    winners = present.filter((p) => p.place === 0);
  } else {
    const top = Math.max(...present.map((p) => p.score));
    winners = present.filter((p) => p.score === top);
  }
  const valid = !isTeam && present.length >= 2 && winners.length === 1;
  return { valid, ports: ports.map((p) => ({ present: p.present, human: p.human, won: valid && winners[0] === p })) };
}
