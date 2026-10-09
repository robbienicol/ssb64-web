// One online match of the BattleShip engine (rollback netcode), inside an
// iframe the site creates per match and removes afterwards.
//
// The parent calls startMatch({ o2r, env, net, onEvent, onLog, build }):
//   o2r      game files extracted from the player's own ROM (never hosted)
//   env      engine settings: SSB64_ROLLBACK*, SSB64_NETPLAY_BATTLE, ...
//   net      { send(peerId, bytes) } — the parent's WebRTC links
//   onEvent  (type, detail) from the engine: session-start, stats,
//            player-disconnected, desync, battle-over
// and pushes received packets with the returned deliver(peerId, bytes).
const FILES = [
  ["f3d.o2r", "/f3d.o2r"],
  ["gamecontrollerdb.txt", "/gamecontrollerdb.txt"],
  ["fonts/Montserrat-Regular.ttf", "/assets/custom/fonts/Montserrat-Regular.ttf"],
  ["fonts/Inconsolata-Regular.ttf", "/assets/custom/fonts/Inconsolata-Regular.ttf"],
];

window.startMatch = async ({ o2r, env, net, onEvent, onLog = () => {}, build = "" }) => {
  const v = build ? `?v=${build}` : "";
  const files = await Promise.all(
    FILES.map(async ([url, path]) => {
      const res = await fetch(url + v);
      if (!res.ok) throw new Error(`Couldn't load ${url}`);
      return [path, new Uint8Array(await res.arrayBuffer())];
    })
  );
  const inbox = [];
  const canvas = document.getElementById("canvas");
  window.Module = {
    canvas,
    locateFile: (path) => path + v,
    print: onLog,
    printErr: onLog,
    ssbNet: { inbox, send: net.send },
    onGameEvent: onEvent,
    preRun: [() => {
      Object.assign(ENV, env);
      FS.writeFile("/BattleShip.o2r", o2r);
      for (const [path, bytes] of files) {
        FS.mkdirTree(path.slice(0, path.lastIndexOf("/")) || "/");
        FS.writeFile(path, bytes);
      }
    }],
  };
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "BattleShip.js" + v;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Couldn't load the game engine."));
    document.body.append(script);
  });
  canvas.focus();
  return { deliver: (from, data) => inbox.push({ from, data }) };
};
