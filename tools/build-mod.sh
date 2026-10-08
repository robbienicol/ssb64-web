#!/bin/bash
# Builds the modded ROM from the decomp and writes web/mod.bps.
set -euo pipefail
cd "$(dirname "$0")/.."
docker run --rm --platform linux/amd64 -v "$PWD/ssb-decomp-re:/ssb" ssb64-build make -j8 | tail -3
node tools/make-bps.mjs ssb-decomp-re/baserom.us.z64 ssb-decomp-re/build/smashbrothers.us.z64 web/mod.bps
