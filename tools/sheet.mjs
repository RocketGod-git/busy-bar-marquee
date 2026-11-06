// Stacks several front PNG snaps (same width) into one contact sheet.
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
const [out, ...files] = process.argv.slice(2);
function read(f) {
  const b = readFileSync(f); let p = 8, w, h, idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p), t = b.toString("ascii", p + 4, p + 8);
    if (t === "IHDR") { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); }
    if (t === "IDAT") idat.push(b.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  return { w, h, raw: inflateSync(Buffer.concat(idat)) };
}
const imgs = files.map(read), w = imgs[0].w, gap = 12, rowLen = w * 3 + 1;
const H = imgs.reduce((s, i) => s + i.h + gap, 0);
const raw = Buffer.alloc(rowLen * H, 40); let y = 0;
for (const i of imgs) { for (let r = 0; r < i.h; r++) i.raw.copy(raw, (y + r) * rowLen, r * rowLen, (r + 1) * rowLen);
  for (let r = 0; r < gap; r++) raw[(y + i.h + r) * rowLen] = 0; y += i.h + gap; }
for (let r = 0; r < H; r++) raw[r * rowLen] = 0;
const { crc32 } = await import("node:zlib");
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
