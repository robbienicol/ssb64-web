// The engine's fighter and stage ids (decomp nFTKind / nGRKind).
export const FIGHTERS = [
  { id: 0, name: "Mario", color: "#e4312b" },
  { id: 4, name: "Luigi", color: "#2fa84f" },
  { id: 2, name: "Donkey Kong", color: "#8a5a2b" },
  { id: 5, name: "Link", color: "#3d9a3a" },
  { id: 3, name: "Samus", color: "#e07b22" },
  { id: 7, name: "Captain Falcon", color: "#3a4bb8" },
  { id: 11, name: "Ness", color: "#d8392e" },
  { id: 6, name: "Yoshi", color: "#55b947" },
  { id: 8, name: "Kirby", color: "#f48fb1" },
  { id: 1, name: "Fox", color: "#c9a25b" },
  { id: 9, name: "Pikachu", color: "#f5c518" },
  { id: 10, name: "Jigglypuff", color: "#f7a8c8" },
];

export const fighterName = (id) => FIGHTERS.find((f) => f.id === id)?.name || "?";

export const STAGES = [
  "Peach's Castle", "Sector Z", "Kongo Jungle", "Planet Zebes", "Hyrule Castle",
  "Yoshi's Island", "Dream Land", "Saffron City", "Mushroom Kingdom",
];

const KEY = "ssb64-web:fighter";
export function savedFighter() {
  try {
    const id = Number(localStorage.getItem(KEY));
    return FIGHTERS.some((f) => f.id === id) && localStorage.getItem(KEY) !== null ? id : 0;
  } catch {
    return 0;
  }
}
export function saveFighter(id) {
  try { localStorage.setItem(KEY, String(id)); } catch {}
}
