# SSB64 Web

Play Super Smash Bros. (N64) in the browser with online lobbies, ranked 1v1, profiles and controller-first menus.

**No game files are included or hosted.** Each player loads their own Super Smash Bros. (USA) ROM
(SHA-1 `e2929e10fccc0aa84e5776227e798abc07cedabf`). It stays in their browser and is never uploaded.

## What's here

- `web/` — the site: ROM import, retro controller-navigable menus, profiles, ranked/casual matchmaking, controller mapping.
  The game runs in [EmulatorJS](https://emulatorjs.org); mods ship as a small BPS patch (`web/mod.bps`) applied in the browser.
- `server/` — Node server: static site, profile API (SQLite), lobby/ranked matchmaking and netplay signaling.
- `tools/` — `make-bps.mjs` builds the mod patch from a modded ROM built with the
  [ssb-decomp-re](https://github.com/VetriTheRetri/ssb-decomp-re) decompilation; `build-mod.sh` runs the whole build.
- `docker/` — x86-64 Linux image for building the decomp on Apple Silicon.

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:8064. Profiles are stored in `data/ssb64.db` (override with `DB_PATH`).

## Status

Online play currently streams the host's game to the other players. Rollback netcode on a native WebAssembly
build of the game is in progress.
