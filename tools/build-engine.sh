#!/usr/bin/env bash
# Copies the browser build of BattleShip into web/engine/: the engine, the
# in-browser asset extractor (Torch) and its recipe, the renderer's shaders and
# fonts. No game assets: those are extracted from each player's own ROM.
#
# Build first (see vendor/BattleShip/docs/web_port_status.md):
#   build-web (the game) and build-torch-web (tools/web_torch).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BS=$ROOT/vendor/BattleShip
OUT=$ROOT/web/engine

HASH=$(grep -o 'SSB64_ASSET_RECIPE_HASH=[^0-9a-f]*[0-9a-f]\{40\}' "$BS/build-web/build.ninja" | head -1 | grep -o '[0-9a-f]\{40\}$' || true)
[ -n "$HASH" ] || { echo "no recipe hash in build-web"; exit 1; }

mkdir -p "$OUT/fonts"
cp "$BS/build-web/BattleShip.js" "$BS/build-web/BattleShip.wasm" "$OUT/"
cp "$BS/build-torch-web/torch_runner.js" "$BS/build-torch-web/torch_runner.wasm" "$OUT/"
cp "$BS/f3d.o2r" "$BS/gamecontrollerdb.txt" "$OUT/"
cp "$BS/assets/custom/fonts/"*.ttf "$BS/assets/custom/fonts/"*-OFL.txt "$OUT/fonts/"
node "$ROOT/tools/make-recipe.mjs" "$BS" "$HASH"
BUILD=$(cat "$OUT/BattleShip.wasm" "$OUT/BattleShip.js" "$OUT/torch_runner.wasm" | shasum | cut -c1-12)
printf '{"hash":"%s","build":"%s"}\n' "$HASH" "$BUILD" > "$OUT/manifest.json"
echo "engine $BUILD (recipe $HASH) -> web/engine"
