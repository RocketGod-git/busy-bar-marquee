// Renders Marquee looks into animated PNGs (APNG) with an LED-matrix look, for the README.
// Uses the same renderer the BUSY Bar runs. Usage: node tools/demo.mts [name...]
import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { Renderer, W, H, type Look } from "../marquee/src/fx.ts";

const PITCH = 6;
const FRAMES = 45; // three seconds at 15 fps
const OUT = new URL("../docs/", import.meta.url);

const DEMOS: Record<string, Partial<Look>> = {
  "marquee-friday": { text: "IT'S FRIDAY!", size: "big", motion: "scroll", textFx: "rainbow", bg: "sparkle", bgColor: "#FFD040", bgLevel: 80, speed: 6 },
  "marquee-fire": { text: "ON FIRE", size: "big", motion: "static", textFx: "solid", bg: "fire", bgLevel: 70 },
  "marquee-matrix": { text: "Hello, Neo", motion: "typewriter", textFx: "solid", color: "#B0FFC0", bg: "matrix", bgLevel: 60, speed: 7 },
  "marquee-plasma": { text: "COME IN", size: "big", motion: "static", textFx: "chrome", bg: "plasma", bgLevel: 45 },
  "marquee-warp": { text: "ENGAGE", size: "big", motion: "static", textFx: "gradient", color: "#FFFFFF", color2: "#40A0FF", bg: "warp", bgColor: "#4080FF", bgLevel: 80, speed: 8 },
  "marquee-glitch": { text: "DO NOT DISTURB", motion: "glitch", textFx: "solid", color: "#FF2A3C", bg: "none", outline: false },
  "marquee-wave": { text: "GOOD VIBES ONLY", motion: "wave", textFx: "solid", bg: "rainbow", bgLevel: 35, speed: 5 },
  "marquee-aurora": { text: "Deep work", motion: "static", textFx: "solid", bg: "aurora", bgLevel: 70 },
  "marquee-emoji": { text: "SHIP IT :rocket:", motion: "static", textFx: "chrome", bg: "warp", bgColor: "#FF8C40", bgLevel: 70, speed: 8 },
  "marquee-pizza": { text: "LUNCH :pizza:", size: "big", motion: "static", textFx: "solid", color: "#FFE08A", bg: "sparkle", bgColor: "#FF8C40", bgLevel: 70 },
  "marquee-love": { text: ":heart: FRIDAY :party:", motion: "static", textFx: "rainbow", bg: "plasma", bgLevel: 30 },
};
const ONLY = process.argv.slice(2);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function frame(r: Renderer): Buffer {
  const w = W * PITCH;
  const h = H * PITCH;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0);
  const rad2 = (PITCH * 0.42) ** 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hex = r.color(r.fb[y * W + x]);
      const c = hex ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : [18, 20, 26];
      for (let dy = 0; dy < PITCH; dy++) {
        for (let dx = 0; dx < PITCH; dx++) {
          const ox = dx + 0.5 - PITCH / 2;
          const oy = dy + 0.5 - PITCH / 2;
          if (ox * ox + oy * oy > rad2) continue;
          const o = (y * PITCH + dy) * (w * 3 + 1) + 1 + (x * PITCH + dx) * 3;
          raw[o] = c[0];
          raw[o + 1] = c[1];
          raw[o + 2] = c[2];
        }
      }
    }
  }
  return deflateSync(raw, { level: 9 });
}

function apng(r: Renderer): Buffer {
  const w = W * PITCH;
  const h = H * PITCH;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(FRAMES, 0);
  actl.writeUInt32BE(0, 4); // loop forever
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("acTL", actl)];
  let seq = 0;
  for (let f = 0; f < FRAMES; f++) {
    r.step();
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(w, 4);
    fctl.writeUInt32BE(h, 8);
    fctl.writeUInt16BE(1, 20); // 1/15 s per frame
    fctl.writeUInt16BE(15, 22);
    parts.push(chunk("fcTL", fctl));
    const data = frame(r);
    if (f === 0) {
      parts.push(chunk("IDAT", data));
    } else {
      const s = Buffer.alloc(4);
      s.writeUInt32BE(seq++);
      parts.push(chunk("fdAT", Buffer.concat([s, data])));
    }
  }
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

mkdirSync(OUT, { recursive: true });
for (const [name, look] of Object.entries(DEMOS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const r = new Renderer(look);
  // Let backgrounds like fire and matrix settle before recording.
  for (let i = 0; i < 20; i++) r.step();
  const png = apng(r);
  writeFileSync(new URL(`${name}.png`, OUT), png);
  console.log(`${name}.png ${(png.length / 1024).toFixed(0)} KB`);
}
