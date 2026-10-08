// Ranked tiers. Shared by the browser and the server.
export const START_MMR = 1000;
export const PLACEMENT_GAMES = 5;

// Each tier has three divisions; Legend is a single top rank.
const TIERS = [
  { name: "Bronze", color: "#c9834a", from: 0 },
  { name: "Silver", color: "#c4cfdb", from: 800 },
  { name: "Gold", color: "#ffc93c", from: 1025 },
  { name: "Platinum", color: "#4fe0c8", from: 1250 },
  { name: "Diamond", color: "#59a8ff", from: 1475 },
  { name: "Master", color: "#c06bff", from: 1700 },
];
const LEGEND_FROM = 1925;
const DIVISIONS = ["I", "II", "III"];

export function rankFor(mmr, rankedGames) {
  if (rankedGames < PLACEMENT_GAMES) {
    return { placed: false, label: "Unranked", tier: "Unranked", color: "#8d95b8", index: -1, progress: rankedGames / PLACEMENT_GAMES };
  }
  if (mmr >= LEGEND_FROM) {
    return { placed: true, label: "Legend", tier: "Legend", division: null, color: "#ff4d5e", index: TIERS.length * 3, progress: 1 };
  }
  let t = 0;
  while (t + 1 < TIERS.length && mmr >= TIERS[t + 1].from) t++;
  const tier = TIERS[t];
  const next = t + 1 < TIERS.length ? TIERS[t + 1].from : LEGEND_FROM;
  const span = (next - tier.from) / 3;
  const floor = t === 0 ? 600 : tier.from; // Bronze I covers everything below 700
  const d = Math.min(2, Math.max(0, Math.floor((mmr - (t === 0 ? 600 : tier.from)) / (t === 0 ? (next - 600) / 3 : span))));
  const divFrom = floor + d * (t === 0 ? (next - 600) / 3 : span);
  const divTo = divFrom + (t === 0 ? (next - 600) / 3 : span);
  return {
    placed: true,
    label: `${tier.name} ${DIVISIONS[d]}`,
    tier: tier.name,
    division: DIVISIONS[d],
    color: tier.color,
    index: t * 3 + d,
    progress: Math.max(0, Math.min(1, (mmr - divFrom) / (divTo - divFrom))),
  };
}

// Elo update for a 1v1. Placement games move rating faster.
export function eloChange(winnerMmr, loserMmr, winnerGames, loserGames) {
  const expected = 1 / (1 + 10 ** ((loserMmr - winnerMmr) / 400));
  const k = (games) => (games < PLACEMENT_GAMES ? 64 : 32);
  return {
    winner: Math.round(k(winnerGames) * (1 - expected)),
    loser: -Math.round(k(loserGames) * (1 - expected)),
  };
}

// Original emblem: a shield with one chevron per division, colored by tier.
export function rankBadgeSvg(rank) {
  const c = rank.color;
  const chevrons = rank.placed && rank.division ? DIVISIONS.indexOf(rank.division) + 1 : 0;
  let marks = "";
  for (let i = 0; i < chevrons; i++) {
    const y = 58 - i * 11;
    marks += `<path d="M30 ${y} L50 ${y - 9} L70 ${y} L70 ${y + 6} L50 ${y - 3} L30 ${y + 6} Z" fill="#0b0b1e"/>`;
  }
  const center = !rank.placed
    ? '<text x="50" y="58" text-anchor="middle" font-size="30" font-weight="900" fill="#0b0b1e">?</text>'
    : rank.tier === "Legend"
      ? '<path d="M50 26 L57 42 L74 43 L61 54 L65 71 L50 62 L35 71 L39 54 L26 43 L43 42 Z" fill="#0b0b1e"/>'
      : marks;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 6 L88 18 L84 60 Q78 84 50 96 Q22 84 16 60 L12 18 Z" fill="#0b0b1e"/>
    <path d="M50 12 L82 22 L78 58 Q73 79 50 89 Q27 79 22 58 L18 22 Z" fill="${c}"/>
    <path d="M50 12 L82 22 L80 36 Q50 26 20 36 L18 22 Z" fill="#fff" opacity="0.35"/>
    ${center}
  </svg>`;
}
