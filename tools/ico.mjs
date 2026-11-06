// Writes widget/marquee.ico: a 64x64 LED-style rendering of the word "HI" on a rainbow bar,
// stored as a PNG inside an ICO container (supported by Windows Vista and later).
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 64;
const px = Buffer.alloc(S * S * 4); // RGBA, transparent
const grid = [
  "........",
  ".#..#.#.",
  ".#..#.#.",
  ".####.#.",
  ".#..#.#.",
  ".#..#.#.",
  "........",
  "rogybpvr",
];
const pal = { "#": [255, 255, 255], r: [255, 40, 90], o: [255, 140, 0], g: [255, 230, 0], y: [43, 255, 106], b: [0, 229, 255], p: [60, 90, 255], v: [190, 60, 255] };
// Rounded dark tile.
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const dx = Math.max(0, Math.abs(x - 31.5) - 22), dy = Math.max(0, Math.abs(y - 31.5) - 22);
  if (dx * dx + dy * dy <= 100) { const o = (y * S + x) * 4; px[o] = 14; px[o + 1] = 16; px[o + 2] = 24; px[o + 3] = 255; }
}
// LED dots, 7px pitch.
for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
  const c = pal[grid[gy][gx]] || [34, 38, 52];
  const cx = 4 + gx * 7 + 3.5, cy = 4 + gy * 7 + 3.5;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= 7.5) { const o = (y * S + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; }
  }
}
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const ih = Buffer.alloc(13); ih.writeUInt32BE(S, 0); ih.writeUInt32BE(S, 4); ih[8] = 8; ih[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = S; head[7] = S; head[8] = 0; head[9] = 0; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
writeFileSync(new URL("../widget/marquee.ico", import.meta.url), Buffer.concat([head, png]));
console.log("wrote widget/marquee.ico");
