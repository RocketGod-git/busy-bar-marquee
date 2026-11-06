// Dev-only: runs the renderer on the PC at 15 fps, pushing frames to the bar, and snapshots each look.
// Usage: node preview.mts   (or LOOKS=fire,matrix node preview.mts)
import { execSync } from "node:child_process";
import { Renderer, type Look } from "./src/fx.ts";
const A = `http://${process.env.BUSY_ADDR || "10.0.4.20"}/api/display/draw`;
const looks: Record<string, Partial<Look>> = {
  plasma: { bg: "plasma", textFx: "chrome", motion: "static", text: "KNOCK FIRST" },
  fire: { bg: "fire", bgLevel: 70, textFx: "solid", motion: "static", text: "ON FIRE", size: "big" },
  matrix: { bg: "matrix", bgLevel: 60, textFx: "solid", color: "#B0FFC0", motion: "static", text: "BUSY BAR" },
  warp: { bg: "warp", bgColor: "#4080FF", bgLevel: 80, textFx: "gradient", color: "#FFFFFF", color2: "#40A0FF", motion: "static", text: "ENGAGE", size: "big" },
  rainbow: { bg: "rainbow", bgLevel: 35, textFx: "solid", motion: "wave", text: "GOOD VIBES ONLY" },
  aurora: { bg: "aurora", bgLevel: 70, textFx: "solid", motion: "static", text: "Deep work" },
  sparkle: { bg: "sparkle", bgColor: "#FFD040", bgLevel: 80, textFx: "rainbow", motion: "static", text: "PAYDAY", size: "big" },
  glitch: { bg: "none", textFx: "solid", color: "#FF2A3C", motion: "glitch", text: "SYSTEM ERROR", outline: false },
  firetext: { bg: "none", textFx: "fire", motion: "static", text: "HOT DEALS", size: "big" },
};
const pick = process.env.LOOKS ? process.env.LOOKS.split(",") : Object.keys(looks);
const r = new Renderer();
for (const name of pick) {
  r.set(looks[name]);
  let sent = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    const f0 = Date.now();
    const res = await fetch(A, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_name: "mq", priority: 60, elements: [{ id: "fx", type: "xpmbitmap", x: 0, y: 0, align: "top_left", data: r.frame() }] }) });
    if (!res.ok) { console.log(name, res.status, await res.text()); break; }
    sent++;
    await new Promise((ok) => setTimeout(ok, Math.max(0, 66 - (Date.now() - f0))));
  }
  execSync(`node ../tools/snap.mjs ../snaps/mq-${name}`);
  console.log(name, `${(sent / 2.5).toFixed(1)} fps`);
}
await fetch(A + "?application_name=mq", { method: "DELETE" });
