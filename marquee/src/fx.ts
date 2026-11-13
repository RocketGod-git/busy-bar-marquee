// A tiny software renderer for the 72x16 front screen: an animated background plus styled text,
// composed into one framebuffer and emitted as an XPM bitmap.
// Pure TypeScript with no imports beyond the font, so the BUSY Bar app and the desktop widget's
// live preview run the exact same code.
//
// Written for JerryScript on the bar, which manages only ~150k simple operations per second.
// So per-frame work avoids touching every pixel in script:
// - plasma, rainbow and aurora are fields computed once; frames slide them with native
//   typed-array copies and animate by rotating the palette (classic color cycling);
// - matrix, warp and sparkle clear natively and draw only their lit pixels;
// - fire is simulated at half resolution and expanded with native row copies;
// - text and its outline are precomputed pixel lists, and only on-screen columns are visited;
// - the framebuffer holds XPM character codes, so each output row is one fromCharCode call.
import { normal, big, type PixelFont } from "./font.ts";
import { CODE, emoji } from "./emoji.ts";

export const W = 72;
export const H = 16;
const N = W * H;
/** Width of the precomputed scrolling fields; every wave in them is periodic over it. */
const FW = 128;

export type TextFx = "solid" | "rainbow" | "gradient" | "fire" | "chrome";
export type Motion = "scroll" | "wave" | "static" | "blink" | "glitch" | "typewriter";
export type Bg = "none" | "solid" | "plasma" | "fire" | "matrix" | "warp" | "rainbow" | "sparkle" | "aurora";

export interface Look {
  text: string;
  color: string;
  color2: string;
  textFx: TextFx;
  motion: Motion;
  size: "normal" | "big";
  speed: number; // 1..10
  bg: Bg;
  bgColor: string;
  bgLevel: number; // 0..100
  outline: boolean;
}

export const DEFAULT_LOOK: Look = {
  text: "WELCOME IN",
  color: "#FFFFFF",
  color2: "#00E5FF",
  textFx: "chrome",
  motion: "scroll",
  size: "normal",
  speed: 5,
  bg: "plasma",
  bgColor: "#FF2A3C",
  bgLevel: 45,
  outline: true,
};

// Palette slots: 1-16 background ramp, 17-24 text ramp, 25 outline (black), 26 white,
// 27-30 emoji yellow, orange, red, green.
// The framebuffer stores XPM codes: EMPTY ('.') or 96 + slot ('a'...'~').
const NCOL = 31;
export const EMPTY = 46;
const BG = 97; // code of background level 0; level n is BG + n
const TX = 96 + 17;
const NTX = 8;
const OUTLINE = 96 + 25;
const WHITE = 96 + 26;
const ART: Record<string, number> = { k: OUTLINE, w: WHITE, y: 96 + 27, o: 96 + 28, r: 96 + 29, g: 96 + 30 };
const ART_RGB = ["#000000", "#FFFFFF", "#FFD21E", "#FF8C00", "#FF2A3C", "#2EDB4B"];

type RGB = [number, number, number];

function hex(c: string): RGB {
  const s = /^#?[0-9a-fA-F]{6}/.test(c) ? c.replace("#", "") : "FFFFFF";
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function toHex(c: RGB): string {
  let s = "#";
  for (let i = 0; i < 3; i++) s += Math.max(0, Math.min(255, Math.round(c[i]))).toString(16).padStart(2, "0");
  return s;
}
function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function scale(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}
function hue(h: number): RGB {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return 255 * (1 - Math.max(0, Math.min(1, Math.min(k, 4 - k))));
  };
  return [f(5), f(3), f(1)];
}
function ramp(stops: RGB[], n: number): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i / (n - 1)) * (stops.length - 1);
    const j = Math.min(stops.length - 2, Math.floor(p));
    out.push(lerp(stops[j], stops[j + 1], p - j));
  }
  return out;
}

// Integer sine table, 256 steps, -127..127.
const SIN = new Int16Array(256);
for (let i = 0; i < 256; i++) SIN[i] = Math.round(Math.sin((i / 256) * Math.PI * 2) * 127);

let seed = 1234567;
/** Integer xorshift, 0..32767. */
function rnd(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed & 32767;
}

interface TextLayout {
  width: number;
  capTop: number;
  capH: number;
  /** (column, row) pairs in column order; rows are in font space. */
  px: Int16Array<ArrayBuffer>;
  /** Per pixel: a fixed emoji color code, or 0 for the text style. */
  code: Uint8Array<ArrayBuffer>;
  /** First pair index per column, plus the end. */
  start: Int16Array<ArrayBuffer>;
  /** Which character or emoji each column belongs to. */
  colChar: Int16Array<ArrayBuffer>;
  /** Per column, the lit rows as bit (row + 4). */
  masks: number[];
}

/** Lays out text with :name: emoji codes. Emoji sit centered on the capitals. */
function layoutText(s: string, font: PixelFont, caps: boolean): TextLayout {
  const g = font.g;
  let top = 16;
  let bot = 0;
  for (const m of g.H[1]) for (let y = 0; y < 16; y++) if ((m >> y) & 1) {
    top = Math.min(top, y);
    bot = Math.max(bot, y);
  }
  const capH = bot - top + 1;
  const tp: number[] = [];
  const tc: number[] = [];
  const st: number[] = [];
  const cc: number[] = [];
  const masks: number[] = [];
  let n = 0;
  const glyphs = (part: string) => {
    if (caps) part = part.toUpperCase(); // the big font is capitals only
    for (let i = 0; i < part.length; i++, n++) {
      const gl = g[part[i]] || g["?"];
      for (let k = 0; k < gl[0]; k++) {
        const m = gl[1][k] || 0;
        st.push(tp.length);
        for (let y = 0; y < 16; y++) if ((m >> y) & 1) {
          tp.push(masks.length, y);
          tc.push(0);
        }
        masks.push(m << 4);
        cc.push(n);
      }
    }
  };
  CODE.lastIndex = 0;
  let at0 = 0;
  for (let m = CODE.exec(s); m; m = CODE.exec(s)) {
    const e = emoji(m[1]);
    if (!e) continue;
    glyphs(s.slice(at0, m.index));
    at0 = m.index + m[0].length;
    // With a blank column after.
    const y0 = top + ((capH - e.art.length) >> 1);
    for (let x = 0; x <= e.art[0].length; x++) {
      st.push(tp.length);
      let mask = 0;
      for (let y = 0; y < e.art.length; y++) {
        const code = ART[e.art[y].charAt(x)];
        if (!code) continue;
        tp.push(masks.length, y0 + y);
        tc.push(code);
        mask |= 1 << (y0 + y + 4);
      }
      masks.push(mask);
      cc.push(n);
    }
    n++;
  }
  glyphs(s.slice(at0));
  st.push(tp.length);
  return {
    width: masks.length, capTop: top, capH,
    px: new Int16Array(tp), code: new Uint8Array(tc), start: new Int16Array(st), colChar: new Int16Array(cc), masks,
  };
}

/**
 * The message as one line for the back screen, in the bar's extra-large font (the same font as
 * "big"), with emoji. Rows match a native text element drawn at the same position.
 */
export class Banner {
  readonly width: number;
  readonly height = 16;
  private buf: Uint8Array;
  private header = "";
  private shown = -1;

  constructor(text: string) {
    const t = layoutText(String(text || " ").replace(/[^\x20-\x7E]/g, ""), big, true);
    this.width = Math.max(1, t.width);
    this.buf = new Uint8Array(this.width * this.height).fill(EMPTY);
    for (let i = 0, k = 0; k < t.px.length; i++, k += 2) {
      const y = t.px[k + 1];
      if (y >= 0 && y < this.height) this.buf[y * this.width + t.px[k]] = t.code[i] || WHITE;
    }
  }

  /** A window `w` columns wide starting at column `off`, as XPM2. */
  xpm(off: number, w: number): string {
    w = Math.min(w, this.width);
    off = Math.max(0, Math.min(off, this.width - w));
    if (w !== this.shown) {
      this.shown = w;
      const lines = ["! XPM2", `${w} ${this.height} 7 1`, ". c none"];
      for (let i = 0; i < ART_RGB.length; i++) lines.push(`${String.fromCharCode(OUTLINE + i)} c ${ART_RGB[i]}`);
      this.header = lines.join("\n");
    }
    let out = this.header;
    for (let y = 0; y < this.height; y++) {
      const o = y * this.width + off;
      out += "\n" + String.fromCharCode.apply(null, this.buf.subarray(o, o + w) as unknown as number[]);
    }
    return out;
  }
}

export class Renderer {
  look: Look = DEFAULT_LOOK;
  /** Palette by slot (index 0 unused); background slots are before rotation. */
  readonly pal: string[] = new Array(NCOL).fill("#000000");
  /** XPM codes, row-major. */
  readonly fb = new Uint8Array(N);
  private t = 0;
  /** Current palette rotation of the background ramp, 0..15. */
  private rot = 0;
  private cycles = false;
  private headers: string[] = [];
  private font: PixelFont = normal;
  // Text, precomputed per message, in column order: (column, row) pairs.
  private tpx = new Int16Array(0);
  private tStart = new Int16Array(1); // first pair index per text column
  private tCode = new Uint8Array(0); // per text pixel: a fixed emoji color code, or 0 for text style
  private opx = new Int16Array(0); // outline pixels; columns offset by +1
  private oStart = new Int16Array(1);
  private colChar = new Int16Array(0);
  private textW = 0;
  private yBase = 0;
  private capH = 7;
  // Background state.
  private field = new Uint8Array(FW * H);
  private heat = new Uint8Array(36 * 11);
  private row = new Uint8Array(W);
  private drops = new Int16Array(W); // fixed point, 1/16 px
  private stars: number[] = [];
  private sparks = new Int16Array(120); // index, life pairs

  constructor(look?: Partial<Look>) {
    for (let x = 0; x < W; x++) this.drops[x] = -(rnd() % 400);
    this.set(look ?? {});
  }

  /** Applies a new look. Background state carries over when only the text changes. */
  set(look: Partial<Look>): void {
    const prev = this.look;
    this.look = { ...DEFAULT_LOOK, ...look };
    const l = this.look;
    l.speed = Math.max(1, Math.min(10, Number(l.speed) || 5));
    l.bgLevel = Math.max(0, Math.min(100, Number(l.bgLevel) || 0));
    this.font = l.size === "big" ? big : normal;
    const s = String(l.text || " ").replace(/[^\x20-\x7E]/g, "");
    this.layout(s, l.size === "big");
    this.palette();
    this.makeField();
    if (prev.text !== l.text || prev.motion !== l.motion || prev.size !== l.size) this.t = 0;
  }

  private layout(s: string, caps: boolean): void {
    const t = layoutText(s, this.font, caps);
    this.capH = t.capH;
    this.yBase = ((H - t.capH) >> 1) - t.capTop;
    const tw = t.width;
    const masks = t.masks;
    this.textW = tw;
    this.colChar = t.colChar;
    this.tStart = t.start;
    this.tpx = t.px;
    this.tCode = t.code;
    // Outline: pixels next to text that are not text, in a space one column wider on each side.
    const at = (x: number, y: number) => x >= 0 && x < tw && y >= -4 && y < 20 && ((masks[x] >> (y + 4)) & 1) === 1;
    const op: number[] = [];
    this.oStart = new Int16Array(tw + 3);
    for (let ox = 0; ox < tw + 2; ox++) {
      this.oStart[ox] = op.length;
      const x = ox - 1;
      for (let y = -3; y < 19; y++) {
        if (at(x, y)) continue;
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) op.push(ox, y);
      }
    }
    this.oStart[tw + 2] = op.length;
    this.opx = new Int16Array(op);
  }

  private palette(): void {
    const l = this.look;
    const k = l.bgLevel / 100;
    const tint = hex(l.bgColor);
    let bg: RGB[];
    this.cycles = false;
    switch (l.bg) {
      case "plasma":
      case "rainbow":
        bg = [];
        for (let i = 0; i < 16; i++) bg.push(hue(i / 16));
        this.cycles = true;
        break;
      case "fire":
        bg = ramp([[0, 0, 0], [90, 0, 0], [255, 30, 0], [255, 140, 0], [255, 230, 60], [255, 255, 220]], 16);
        break;
      case "matrix":
        bg = ramp([[0, 0, 0], [0, 50, 10], [0, 170, 40], [60, 255, 90], [210, 255, 220]], 16);
        break;
      case "aurora":
        bg = ramp([[0, 0, 0], [0, 40, 60], [0, 200, 120], [80, 255, 160], [170, 60, 255]], 16);
        break;
      case "warp":
      case "sparkle":
        bg = ramp([[0, 0, 0], scale(tint, 0.5), tint, [255, 255, 255]], 16);
        break;
      default:
        bg = ramp([scale(tint, 0.15), tint], 16);
    }
    for (let i = 0; i < 16; i++) this.pal[1 + i] = toHex(scale(bg[i], k));

    const c1 = hex(l.color);
    const c2 = hex(l.color2);
    let tx: RGB[];
    switch (l.textFx) {
      case "rainbow":
        tx = [];
        for (let i = 0; i < NTX; i++) tx.push(hue(i / NTX));
        break;
      case "gradient":
        tx = ramp([c1, c2], NTX);
        break;
      case "fire":
        tx = ramp([[255, 255, 200], [255, 220, 40], [255, 120, 0], [230, 20, 0]], NTX);
        break;
      case "chrome":
        tx = ramp([c1, lerp(c1, [255, 255, 255], 0.6), [255, 255, 255]], NTX);
        break;
      default:
        tx = ramp([c1, c1], NTX);
    }
    for (let i = 0; i < NTX; i++) this.pal[17 + i] = toHex(tx[i]);
    for (let i = 0; i < ART_RGB.length; i++) this.pal[25 + i] = ART_RGB[i];

    // One XPM header per palette rotation, built now so frames only pick one.
    const rest: string[] = [];
    for (let i = 17; i < NCOL; i++) rest.push(`${String.fromCharCode(96 + i)} c ${this.pal[i]}`);
    const tail = rest.join("\n");
    this.headers = [];
    for (let r = 0; r < (this.cycles ? 16 : 1); r++) {
      const lines = ["! XPM2", `${W} ${H} ${NCOL} 1`, ". c none"];
      for (let i = 0; i < 16; i++) lines.push(`${String.fromCharCode(97 + i)} c ${this.pal[1 + ((i + r) & 15)]}`);
      lines.push(tail);
      this.headers.push(lines.join("\n"));
    }
  }

  /** Precomputes the scrolling field for plasma, rainbow and aurora (codes, FW x H). */
  private makeField(): void {
    const f = this.field;
    const bg = this.look.bg;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < FW; x++) {
        let v = 0;
        if (bg === "plasma") {
          // Multiples of 2 in x keep every term periodic over FW = 128.
          const s = SIN[(x * 2) & 255] + SIN[(y * 10 + 64) & 255] + SIN[(x * 2 + y * 8) & 255] + SIN[(x * 4 - y * 6 + 32) & 255];
          v = (s + 508) >> 6;
        } else if (bg === "rainbow") {
          v = (x + y * 2) >> 1;
        } else if (bg === "aurora") {
          const edge = 3 + ((SIN[(x * 4) & 255] + SIN[(x * 10) & 255]) >> 6);
          const glow = 10 + (SIN[(x * 2) & 255] >> 5) + (SIN[(x * 14 + 40) & 255] >> 6);
          const d = y - edge;
          v = d < 0 ? 0 : glow - ((d * 21) >> 4) + (SIN[(y * 30 + x * 6) & 255] >> 6);
          if (v > 15) v = 15;
          if (v < 1) {
            f[y * FW + x] = EMPTY;
            continue;
          }
        }
        f[y * FW + x] = BG + (v & 15);
      }
    }
  }

  // ---- Backgrounds -----------------------------------------------------------

  /** Copies the field into the screen, scrolled left by `off` columns (native copies only). */
  private slide(off: number): void {
    const f = this.field;
    const fb = this.fb;
    off %= FW;
    const first = Math.min(W, FW - off);
    for (let y = 0; y < H; y++) {
      const src = y * FW;
      fb.set(f.subarray(src + off, src + off + first), y * W);
      if (first < W) fb.set(f.subarray(src, src + W - first), y * W + first);
    }
  }

  private background(): void {
    const fb = this.fb;
    const t = this.t;
    const l = this.look;
    this.rot = 0;
    if (l.bg === "none" || l.bgLevel === 0) {
      fb.fill(EMPTY);
      return;
    }
    switch (l.bg) {
      case "solid": {
        for (let x = 0; x < W; x++) this.row[x] = BG + 15 - ((x * 15) / W | 0);
        for (let y = 0; y < H; y++) fb.set(this.row, y * W);
        return;
      }
      case "plasma":
        this.slide(t >> 1);
        this.rot = (t >> 1) & 15;
        return;
      case "rainbow":
        this.slide(0);
        this.rot = t & 15;
        return;
      case "aurora":
        this.slide(t >> 1);
        return;
      case "fire": {
        // 36x9 visible heat cells (+2 seed rows), each drawn as a 2x2 block.
        const h = this.heat;
        const CW = 36;
        const R = 11;
        for (let x = 0; x < CW; x++) {
          const s = SIN[(x * 18 + t * 7) & 255] + SIN[(x * 8 - t * 5) & 255];
          h[(R - 1) * CW + x] = s > 40 ? 240 + (rnd() & 15) : rnd() & 63;
          if ((rnd() & 15) === 0) h[(R - 2) * CW + x] = 255;
        }
        for (let y = 0; y < R - 2; y++) {
          const o = y * CW;
          for (let x = 0; x < CW; x++) {
            const b = o + CW + x;
            const v = ((h[b - (x > 0 ? 1 : 0)] + h[b] + h[b + (x < CW - 1 ? 1 : 0)] + h[b + CW]) >> 2) - 30;
            h[o + x] = v > 0 ? v : 0;
          }
        }
        const row = this.row;
        for (let y = 0; y < 8; y++) {
          const o = (y + 1) * CW;
          for (let x = 0; x < CW; x++) {
            const v = h[o + x] >> 4;
            const c = v ? BG + v : EMPTY;
            row[x * 2] = c;
            row[x * 2 + 1] = c;
          }
          fb.set(row, y * 2 * W);
          fb.set(row, (y * 2 + 1) * W);
        }
        return;
      }
      case "matrix": {
        // Each column is a falling head with a fading trail behind it.
        fb.fill(EMPTY);
        for (let x = 0; x < W; x++) {
          const head = this.drops[x] >> 4;
          this.drops[x] += 5 + ((x * 37) % 11);
          if (head > H + 10) this.drops[x] = -(rnd() % 300);
          for (let k = 0; k < 8; k++) {
            const y = head - k;
            if (y >= 0 && y < H) fb[y * W + x] = BG + 15 - k * 2;
          }
        }
        return;
      }
      case "warp": {
        fb.fill(EMPTY);
        if (this.stars.length !== 60) {
          this.stars = [];
          for (let i = 0; i < 20; i++) this.stars.push(rnd() / 16384 - 1, rnd() / 16384 - 1, rnd() / 32768);
        }
        const dz = 0.02 * (0.5 + l.speed / 10);
        for (let i = 0; i < 60; i += 3) {
          let z = this.stars[i + 2] - dz;
          if (z <= 0.03) {
            this.stars[i] = rnd() / 16384 - 1;
            this.stars[i + 1] = rnd() / 16384 - 1;
            z = 1;
          }
          this.stars[i + 2] = z;
          const sx = (W / 2 + (this.stars[i] / z) * 18) | 0;
          const sy = (H / 2 + (this.stars[i + 1] / z) * 4) | 0;
          if (sy < 0 || sy >= H) continue;
          // A streak pointing back toward the center, longer as the star gets closer.
          const len = 1 + (((1 - z) * 6) | 0);
          const dir = sx < W / 2 ? 1 : -1;
          for (let k = 0; k < len; k++) {
            const x = sx + k * dir;
            if (x >= 0 && x < W) fb[sy * W + x] = BG + 15 - ((k * 12) / len | 0);
          }
        }
        return;
      }
      case "sparkle": {
        fb.fill(EMPTY);
        const sp = this.sparks;
        for (let i = 0; i < sp.length; i += 2) {
          if (sp[i + 1] <= 0) {
            if ((rnd() & 3) === 0) {
              sp[i] = rnd() % N;
              sp[i + 1] = 15;
            }
            continue;
          }
          fb[sp[i]] = BG + sp[i + 1];
          sp[i + 1] -= 1;
        }
        return;
      }
    }
  }

  // ---- Text --------------------------------------------------------------------

  private text(): void {
    const l = this.look;
    const t = this.t;
    const tw = this.textW;
    const fits = tw <= W - 2;
    let motion = l.motion;
    if (!fits && (motion === "static" || motion === "blink")) motion = "scroll";
    if (motion === "blink" && ((t / 9) | 0) % 2 === 1) return;

    let x0: number;
    let visCols = tw;
    let cursor = -1;
    if (motion === "scroll" || motion === "wave" || (motion === "glitch" && !fits)) {
      // Speed 1..10 maps to 0.5..2.2 px per frame, in 1/16 px steps.
      x0 = W - ((((t * (5 + l.speed * 3)) >> 4) % (tw + W)));
    } else if (motion === "typewriter") {
      const n = this.colChar.length ? this.colChar[tw - 1] + 1 : 0;
      const per = Math.max(1, 8 - (l.speed >> 1));
      const shown = (((t % (n * per + 45)) / per) | 0);
      visCols = 0;
      while (visCols < tw && this.colChar[visCols] < shown) visCols++;
      x0 = fits ? (W - tw) >> 1 : Math.min(1, W - 4 - visCols);
      if (((t >> 2) & 1) === 0) cursor = x0 + visCols + 1;
    } else {
      x0 = (W - tw) >> 1;
    }

    const fb = this.fb;
    const yb = this.yBase;
    const wave = motion === "wave";
    const glitch = motion === "glitch" && (t % 23 < 4 || (rnd() & 15) === 0);
    // On-screen text columns only.
    const c0 = Math.max(0, -x0);
    const c1 = Math.min(visCols, W - x0);
    if (c1 <= c0 && cursor < 0) return;

    if (l.outline) {
      const op = this.opx;
      const end = this.oStart[Math.min(c1 + 2, tw + 2)];
      for (let k = this.oStart[c0]; k < end; k += 2) {
        const x = x0 + op[k] - 1;
        if (x < 0 || x >= W) continue;
        const y = op[k + 1] + yb + (wave ? SIN[(x * 12 + t * 10) & 255] >> 6 : 0);
        if (y >= 0 && y < H) fb[y * W + x] = OUTLINE;
      }
    }
    const tp = this.tpx;
    const tcode = this.tCode;
    const fx = l.textFx;
    const glint = (t * 3) % (W + 120);
    const gh = this.capH;
    const end = this.tStart[c1 > c0 ? c1 : c0];
    for (let k = this.tStart[c0]; k < end; k += 2) {
      let x = x0 + tp[k];
      const y = tp[k + 1] + yb + (wave ? SIN[(x * 12 + t * 10) & 255] >> 6 : 0);
      if (y < 0 || y >= H) continue;
      if (glitch && (y + t) % 5 === 0) {
        x += rnd() & 1 ? -2 : 2;
        if (x < 0 || x >= W) continue;
      }
      if (glitch && rnd() % 7 === 0) {
        fb[y * W + x] = WHITE;
        continue;
      }
      const fixed = tcode[k >> 1];
      if (fixed) {
        fb[y * W + x] = fixed;
        continue;
      }
      let c = 0;
      if (fx === "rainbow") c = ((x + t) >> 2) % NTX;
      else if (fx === "gradient") {
        c = (((y - yb - 2) * NTX) / gh) | 0;
        c = c < 0 ? 0 : c > NTX - 1 ? NTX - 1 : c;
      } else if (fx === "fire") {
        c = y - yb + ((SIN[(x * 40 + t * 25) & 255] + 127) >> 6) - 2;
        c = c < 0 ? 0 : c > NTX - 1 ? NTX - 1 : c;
      } else if (fx === "chrome") {
        let d = x + y * 2 - glint + 40;
        if (d < 0) d = -d;
        c = d < 3 ? NTX - 1 : d < 6 ? NTX >> 1 : 0;
      }
      fb[y * W + x] = TX + c;
    }
    if (cursor >= 0 && cursor < W) {
      const top = yb + 2;
      for (let y = top; y < top + gh && y < H; y++) if (y >= 0) fb[y * W + cursor] = TX;
    }
  }

  /** Renders the next frame into `fb` (15 frames per second of animation time). */
  step(): void {
    this.background();
    this.text();
    this.t += 1;
  }

  /** Row views into `fb`, made once so frames allocate no typed-array views. */
  private rowViews: Uint8Array[] = [];

  /** The current frame as XPM2. */
  xpm(): string {
    if (!this.rowViews.length) for (let y = 0; y < H; y++) this.rowViews.push(this.fb.subarray(y * W, y * W + W));
    let out = this.headers[this.cycles ? this.rot : 0];
    for (let y = 0; y < H; y++) out += "\n" + String.fromCharCode.apply(null, this.rowViews[y] as unknown as number[]);
    return out;
  }

  /** Advances one frame and returns it as XPM2. */
  frame(): string {
    this.step();
    return this.xpm();
  }

  /** RGB hex of a framebuffer code in the current frame, for previews. */
  color(code: number): string | null {
    if (code === EMPTY) return null;
    if (this.cycles && code >= BG && code < BG + 16) return this.pal[1 + (((code - BG) + this.rot) & 15)];
    return this.pal[code - 96];
  }
}
