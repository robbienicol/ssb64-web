// Short synthesized menu sounds.
let ctx = null;
const TONES = {
  move: [[660, 0.04]],
  select: [[880, 0.05], [1320, 0.07]],
  back: [[440, 0.05], [330, 0.07]],
  join: [[523, 0.06], [659, 0.06], [784, 0.1]],
  go: [[392, 0.08], [523, 0.08], [784, 0.16]],
  error: [[220, 0.12]],
};

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
  } catch {}
}

export function sfx(name) {
  if (!ctx || ctx.state !== "running") return;
  let t = ctx.currentTime;
  for (const [freq, dur] of TONES[name] || []) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
    t += dur * 0.8;
  }
}
