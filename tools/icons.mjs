// Writes Marquee's app icons: 8x8 color PNG for the front menu, 11x11 grayscale PNG for the back.
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
function png(rows, pal, gray) {
  const w = rows[0].length, h = rows.length, bpp = gray ? 1 : 3, raw = Buffer.alloc((w * bpp + 1) * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { const c = pal[ch] ?? [0, 0, 0]; const o = y * (w * bpp + 1) + 1 + x * bpp; if (gray) raw[o] = c[0]; else { raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; } }));
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = gray ? 0 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const out = (app, front, fpal, back) => {
  writeFileSync(`${app}/src/appmeta/icon_front_8x8.png`, png(front, fpal, false));
  writeFileSync(`${app}/src/appmeta/icon_back_11x11.png`, png(back, { "#": [255], "+": [120] }, true));
};
// Marquee: a lit sign with a rainbow underline.
out("marquee", [
  "########",
  "#......#",
  "#.w..w.#",
  "#.wwww.#",
  "#......#",
  "########",
  "........",
  "rogybpvr",
], { "#": [255, 176, 0], w: [255, 255, 255], r: [255, 40, 60], o: [255, 140, 0], g: [255, 230, 0], y: [43, 255, 106], b: [0, 229, 255], p: [60, 90, 255], v: [190, 60, 255] }, [
  "###########",
  "#.........#",
  "#.#.#.###.#",
  "#.###..#..#",
  "#.#.#.###.#",
  "#.........#",
  "###########",
  "...........",
  "+.+.+.+.+.+",
  "...........",
  "...........",
]);
