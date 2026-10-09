// Web Worker: turns the player's own ROM into the engine's game files
// (BattleShip.o2r) with Torch, entirely in this browser.
importScripts("torch_runner.js");

onmessage = async ({ data: { rom, build } }) => {
  const logs = [];
  try {
    const recipe = await (await fetch(`recipe.json?v=${build}`)).json();
    const torch = await createTorchRunner({
      locateFile: (path) => `${path}?v=${build}`,
      print: (s) => logs.push(s),
      printErr: (s) => logs.push(s),
    });
    const { FS } = torch;
    for (const [path, text] of Object.entries(recipe.files)) {
      FS.mkdirTree(`/src/${path.slice(0, path.lastIndexOf("/"))}`);
      FS.writeFile(`/src/${path}`, text);
    }
    FS.mkdirTree("/rom");
    FS.mkdirTree("/out");
    FS.writeFile("/rom/baserom.z64", rom);
    const rc = torch.ccall("torch_extract_o2r", "number", ["string", "string", "string"], ["/rom/baserom.z64", "/src", "/out"]);
    if (rc !== 0) {
      const why = logs.filter((l) => /torch:|error/i.test(l)).slice(-2).join(" ");
      throw new Error(`Couldn't prepare the game files (${rc}). ${why}`);
    }
    const o2r = FS.readFile("/out/BattleShip.o2r");
    postMessage({ ok: true, o2r }, [o2r.buffer]);
  } catch (err) {
    postMessage({ ok: false, error: String(err?.message || err) });
  }
};
