// Packs Torch's extraction recipe (config.yml + yamls/us — asset descriptions,
// no game data) into web/engine/recipe.json for the in-browser extractor.
// Usage: node tools/make-recipe.mjs <BattleShip dir> <recipe hash>
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [dir, hash] = process.argv.slice(2);
const files = { "config.yml": readFileSync(join(dir, "config.yml"), "utf8") };
const walk = (d) => {
  for (const name of readdirSync(d).sort()) {
    const full = join(d, name);
    if (statSync(full).isDirectory()) walk(full);
    else files[relative(dir, full)] = readFileSync(full, "utf8");
  }
};
walk(join(dir, "yamls/us"));
writeFileSync(new URL("../web/engine/recipe.json", import.meta.url), JSON.stringify({ hash, files }));
console.log(`recipe ${hash}: ${Object.keys(files).length} files`);
