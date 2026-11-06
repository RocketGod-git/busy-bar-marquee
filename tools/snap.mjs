// Captures the BUSY Bar front and back screens into upscaled PNGs.
// Usage: node tools/snap.mjs [outPrefix] [scale]
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const ADDR = process.env.BUSY_ADDR || "10.0.4.20";
const prefix = process.argv[2] || "snap";
const SCALE = Number(process.argv[3] || 10);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
// LED-style upscale: each pixel becomes a dot with a dark gap, like the real matrix.
function upscale(w, h, px, s) {
  const W = w * s, H = h * s, out = Buffer.alloc(W * H * 3, 8);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = px(x, y);
    for (let dy = 1; dy < s - 1; dy++) for (let dx = 1; dx < s - 1; dx++) {
      const o = ((y * s + dy) * W + x * s + dx) * 3;
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
    }
  }
  return png(W, H, out);
}

async function grab(display) {
  const res = await fetch(`http://${ADDR}/api/screen?display=${display}`);
  return Buffer.from(await res.text(), "base64");
}

const front = await grab(0); // 72x16 BGR888
writeFileSync(`${prefix}-front.png`, upscale(72, 16, (x, y) => {
  const o = (y * 72 + x) * 3; return [front[o + 2], front[o + 1], front[o]];
}, SCALE));

const back = await grab(1); // 160x80 L4
const bw = 160, bh = (back.length * 2) / bw;
writeFileSync(`${prefix}-back.png`, upscale(bw, bh, (x, y) => {
  const i = y * bw + x, byte = back[i >> 1];
  const v = (i & 1 ? byte >> 4 : byte & 0x0f) * 17; return [v, v, v];
}, 4));
console.log(`saved ${prefix}-front.png and ${prefix}-back.png (back ${bw}x${bh})`);
