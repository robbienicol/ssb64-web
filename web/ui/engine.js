// The BattleShip engine (rollback netcode) for online matches: prepares its
// game files from the player's own ROM once, then runs each match in a fresh
// iframe (web/engine/play.html) that is removed when the match ends.
import { loadAsset, saveAsset } from "../rom.js";

let manifest = null;
let preparing = null;

async function getManifest() {
  if (!manifest) {
    const res = await fetch("engine/manifest.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("The game engine isn't available right now.");
    manifest = await res.json();
  }
  return manifest;
}

function extract(rom, build) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`engine/extract.js?v=${build}`);
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.ok) resolve(data.o2r);
      else reject(new Error(data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Couldn't prepare the game files."));
    };
    worker.postMessage({ rom: rom.slice(), build });
  });
}

// Resolves with BattleShip.o2r, extracting it on first use (a few seconds).
export function ensureEngineFiles(rom, onStatus) {
  preparing ??= (async () => {
    const { hash, build } = await getManifest();
    const key = `o2r:${hash}`;
    const saved = await loadAsset(key);
    if (saved) return saved;
    if (!rom) throw new Error("Load your ROM first.");
    onStatus?.("Preparing game files from your ROM…");
    const o2r = await extract(rom, build);
    await saveAsset(key, o2r);
    return o2r;
  })().catch((err) => {
    preparing = null;
    throw err;
  });
  return preparing;
}

// Warms the browser cache with the engine so a match starts quickly.
let prefetched = false;
export async function prefetchEngine() {
  if (prefetched) return;
  prefetched = true;
  try {
    const { build } = await getManifest();
    await Promise.all(["BattleShip.wasm", "BattleShip.js"].map((f) => fetch(`engine/${f}?v=${build}`).then((r) => r.arrayBuffer())));
  } catch {
    prefetched = false;
  }
}

// Starts one match. Returns { deliver(peerId, bytes), close() }.
export async function startEngine({ container, o2r, env, net, onEvent }) {
  const { build } = await getManifest();
  const frame = document.createElement("iframe");
  frame.className = "engine-frame";
  frame.allow = "gamepad; autoplay; fullscreen";
  frame.src = `engine/play.html?v=${build}`;
  container.append(frame);
  try {
    await new Promise((resolve, reject) => {
      frame.addEventListener("load", resolve, { once: true });
      frame.addEventListener("error", () => reject(new Error("Couldn't load the game engine.")), { once: true });
    });
    const match = await frame.contentWindow.startMatch({
      o2r,
      env,
      net,
      build,
      onEvent,
      onMenu: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
      onLog: (line) => { if (/Rollback|Netplay|ERROR|abort/i.test(line)) console.log("[engine]", line); },
    });
    frame.focus();
    return { deliver: match.deliver, focus: () => frame.focus(), close: () => frame.remove() };
  } catch (err) {
    frame.remove();
    throw err;
  }
}
