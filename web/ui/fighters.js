// The engine's fighter and stage ids (decomp nFTKind / nGRKind).
// colors: the 4 VS costumes in the game's order (C-button colors on the CSS).
const C = {
  red: ["Red", "#d33a3a"], blue: ["Blue", "#3a5bd9"], green: ["Green", "#3f9a4b"], yellow: ["Yellow", "#f1c94b"],
  black: ["Black", "#34343a"], white: ["White", "#e8e8ee"], pink: ["Pink", "#ea7fb4"], brown: ["Brown", "#7a4a2a"],
};
const colors = (...list) => list.map((c) => (Array.isArray(c) ? c : C[c])).map(([name, hex]) => ({ name, hex }));

export const FIGHTERS = [
  { id: 0, name: "Mario", color: "#e4312b", colors: colors("red", ["Wario", "#f1c94b"], "brown", "blue") },
  { id: 4, name: "Luigi", color: "#2fa84f", colors: colors("green", "white", "blue", "pink") },
  { id: 2, name: "Donkey Kong", color: "#8a5a2b", colors: colors("brown", "black", "red", "blue") },
  { id: 5, name: "Link", color: "#3d9a3a", colors: colors("green", "red", "blue", ["Purple", "#9b7fd4"]) },
  { id: 3, name: "Samus", color: "#e07b22", colors: colors(["Orange", "#e07b22"], "pink", "black", "green") },
  { id: 7, name: "Captain Falcon", color: "#3a4bb8", colors: colors("blue", "black", "pink", "white") },
  { id: 11, name: "Ness", color: "#d8392e", colors: colors("red", "yellow", "blue", "green") },
  { id: 6, name: "Yoshi", color: "#55b947", colors: colors("green", "red", ["Light blue", "#4ab0e0"], "yellow") },
  { id: 8, name: "Kirby", color: "#f48fb1", colors: colors("pink", "yellow", ["Light blue", "#8fc8f0"], "red") },
  { id: 1, name: "Fox", color: "#c9a25b", colors: colors(["Default", "#c9a25b"], "red", "blue", "green") },
  { id: 9, name: "Pikachu", color: "#f5c518", colors: colors(["Default", "#f5c518"], ["Red cap", "#d33a3a"], ["Blue hat", "#3a5bd9"], ["Green hat", "#3f9a4b"]) },
  { id: 10, name: "Jigglypuff", color: "#f7a8c8", colors: colors(["Default", "#f7a8c8"], ["Red bow", "#d33a3a"], ["Blue bow", "#3a5bd9"], ["Green bow", "#3f9a4b"]) },
];

export const fighterName = (id) => FIGHTERS.find((f) => f.id === id)?.name || "?";

export const STAGES = [
  "Peach's Castle", "Sector Z", "Kongo Jungle", "Planet Zebes", "Hyrule Castle",
  "Yoshi's Island", "Dream Land", "Saffron City", "Mushroom Kingdom",
];

// Stage select tiles (engine stage ids); -1 = random.
export const STAGE_CHOICES = [
  { id: 6, color: "#6cc4ff" }, { id: 0, color: "#e7a23c" }, { id: 4, color: "#8a7f9b" },
  { id: 2, color: "#3f9a4b" }, { id: 3, color: "#b84e7e" }, { id: 1, color: "#3b4aa8" },
  { id: 5, color: "#f1c94b" }, { id: 7, color: "#d06a3a" }, { id: 8, color: "#d83b3b" },
  { id: -1, color: "#5b5f7a" },
].map((s) => ({ ...s, name: s.id < 0 ? "Random" : STAGES[s.id] }));

const STAGE_KEY = "ssb64-web:stage";
export function savedStage() {
  try {
    const raw = localStorage.getItem(STAGE_KEY);
    const id = Number(raw);
    return raw !== null && STAGE_CHOICES.some((s) => s.id === id) ? id : 6;
  } catch {
    return 6;
  }
}
export function saveStage(id) {
  try { localStorage.setItem(STAGE_KEY, String(id)); } catch {}
}

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

// Last color picked per fighter.
const COSTUME_KEY = "ssb64-web:costumes";
export function savedCostume(fighter) {
  try {
    const c = Number(JSON.parse(localStorage.getItem(COSTUME_KEY) || "{}")[fighter]);
    return c >= 0 && c < 4 ? c : 0;
  } catch {
    return 0;
  }
}
export function saveCostume(fighter, costume) {
  try {
    const all = JSON.parse(localStorage.getItem(COSTUME_KEY) || "{}");
    all[fighter] = costume;
    localStorage.setItem(COSTUME_KEY, JSON.stringify(all));
  } catch {}
}
