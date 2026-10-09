# SSB64 Web

Play Super Smash Bros. (N64) in the browser with online lobbies, ranked 1v1, profiles and controller-first menus.

**No game files are included or hosted.** Each player loads their own Super Smash Bros. (USA) ROM
(SHA-1 `e2929e10fccc0aa84e5776227e798abc07cedabf`). It stays in their browser and is never uploaded.

## What's here

- `web/` — the site: ROM import, retro controller-navigable menus, profiles, ranked/casual matchmaking, controller mapping.
  Local play runs in [EmulatorJS](https://emulatorjs.org); mods ship as a small BPS patch (`web/mod.bps`) applied in the browser.
- `web/engine/` — online matches: a WebAssembly build of [BattleShip](https://github.com/robbienicol/BattleShip/tree/rollback)
  (the native port of the decompilation) with rollback netcode (GekkoNet). Each player's browser runs the game and
  trades inputs peer to peer over WebRTC. Its game files are extracted from the player's own ROM in the browser
  (Torch, `engine/extract.js`). Rebuild with `tools/build-engine.sh`.
- `server/` — Node server: static site, profile API (SQLite), lobby/ranked matchmaking and netplay signaling.
- `tools/` — `build-engine.sh` packages the engine; `make-bps.mjs` builds the mod patch from a modded ROM built with the
  [ssb-decomp-re](https://github.com/VetriTheRetri/ssb-decomp-re) decompilation; `build-mod.sh` runs the whole build.
- `docker/` — x86-64 Linux image for building the decomp on Apple Silicon.

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:8064. Profiles are stored in `data/ssb64.db` (override with `DB_PATH`).

## Status

Online matches (ranked 1v1, casual 2-4 players) use rollback netcode. Players behind very strict NATs may not be
able to connect yet (no TURN relay).
