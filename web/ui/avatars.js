// Built-in profile pictures: simple geometric badges, plus the player profile card.
import { rankFor, rankBadgeSvg } from "./ranks.js";
export const PRESET_COUNT = 12;

const COLORS = ["#ff4d5e", "#3d8bff", "#ffc93c", "#2ed47a", "#b26bff", "#ff8a3d", "#20c9d6", "#ff5fb4", "#8bd450", "#6d7cff", "#e8e8e8", "#ff3d3d"];
const SHAPES = [
  '<circle cx="50" cy="50" r="24"/>',
  '<polygon points="50,22 78,74 22,74"/>',
  '<rect x="27" y="27" width="46" height="46" rx="6"/>',
  '<polygon points="50,20 80,50 50,80 20,50"/>',
  '<polygon points="50,18 59,40 82,40 63,54 70,77 50,63 30,77 37,54 18,40 41,40"/>',
  '<polygon points="56,16 30,54 48,54 42,84 72,44 54,44"/>',
  '<polygon points="50,20 76,35 76,65 50,80 24,65 24,35"/>',
  '<circle cx="50" cy="50" r="26" fill="none" stroke-width="12"/>',
  '<path d="M24 50 L50 24 L76 50 L63 50 L63 76 L37 76 L37 50 Z"/>',
  '<path d="M30 30 L70 70 M70 30 L30 70" stroke-width="14" stroke-linecap="round" fill="none"/>',
  '<path d="M50 78 C20 58 22 30 38 28 C46 27 50 34 50 38 C50 34 54 27 62 28 C78 30 80 58 50 78 Z"/>',
  '<path d="M22 60 Q36 30 50 60 T78 60" stroke-width="12" stroke-linecap="round" fill="none"/>',
];

export function presetSvg(index) {
  const i = Math.abs(index | 0) % PRESET_COUNT;
  const color = COLORS[i];
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="${color}"/>` +
    `<g fill="#0d0f1a" stroke="#0d0f1a">${SHAPES[i]}</g></svg>`;
}

export function avatarHtml(player) {
  if (player?.avatarUrl) return `<img src="${player.avatarUrl}" alt="">`;
  return presetSvg(player?.avatarPreset ?? 0);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function recordText(p) {
  const games = (p?.wins || 0) + (p?.losses || 0);
  const pct = games ? Math.round((p.wins / games) * 100) : 0;
  return `${p?.wins || 0}W – ${p?.losses || 0}L${games ? ` · ${pct}%` : ""}`;
}

export const playerRank = (p) => rankFor(p?.mmr ?? 1000, (p?.rankedWins || 0) + (p?.rankedLosses || 0));

export function rankChipHtml(player) {
  const rank = playerRank(player);
  return `<span class="rank-chip" style="--rank:${rank.color}"><span class="rank-badge">${rankBadgeSvg(rank)}</span>${rank.label}</span>`;
}

export function playerCardHtml(player, { slot = null, compact = false, showRank = false } = {}) {
  const slotTag = slot === null ? "" : `<span class="slot-tag p${slot + 1}">P${slot + 1}</span>`;
  return `<div class="pcard${compact ? " compact" : ""}${slot === null ? "" : ` p${slot + 1}`}">
    ${slotTag}
    <div class="avatar">${avatarHtml(player)}</div>
    <div class="pcard-info">
      <div class="gamertag">${esc(player?.gamertag)}</div>
      ${showRank ? rankChipHtml(player) : `<div class="record">${recordText(player)}</div>`}
    </div>
  </div>`;
}
