// Pixel-art emoji for the front screen.
// The bar's settings and fonts are plain ASCII, so a message carries emoji as :name: codes.
// The widget turns typed emoji into codes before sending, and back into emoji when it loads.
// Art colors: k black, w white, y yellow, o orange, r red, g green.

export interface Emoji {
  name: string;
  /** Code points that map to this emoji. */
  u: number[];
  art: string[];
}

const FACE_TOP = ["...yyyyy...", "..yyyyyyy..", ".yyyyyyyyy."];
const FACE_END = [".yyyyyyyyy.", "..yyyyyyy..", "...yyyyy..."];

export const EMOJI: Emoji[] = [
  {
    name: "grin",
    u: [0x1f600, 0x1f603, 0x1f604, 0x1f601, 0x1f606, 0x1f602, 0x1f923],
    art: [...FACE_TOP, "yyykyyykyyy", "yyykyyykyyy", "yyyyyyyyyyy", "yykkkkkkkyy", "yykwwwwwkyy", ".yykkkkkyy.", "..yyyyyyy..", "...yyyyy..."],
  },
  {
    name: "smile",
    u: [0x1f642, 0x263a, 0x1f60a, 0x1f607],
    art: [...FACE_TOP, "yyykyyykyyy", "yyykyyykyyy", "yyyyyyyyyyy", "yykyyyyykyy", "yyykkkkkyyy", ...FACE_END],
  },
  {
    name: "wink",
    u: [0x1f609, 0x1f61c],
    art: [...FACE_TOP, "yyykyyyyyyy", "yyykyykkkyy", "yyyyyyyyyyy", "yykyyyyykyy", "yyykkkkkyyy", ...FACE_END],
  },
  {
    name: "cool",
    u: [0x1f60e],
    art: [...FACE_TOP, "kkkkkkkkkkk", "ykwkkykwkky", "yykkkykkkyy", "yyyyyyyyyyy", "yykyyyyykyy", ".yykkkkkyy.", "..yyyyyyy..", "...yyyyy..."],
  },
  {
    name: "love",
    u: [0x1f60d, 0x1f970, 0x1f618],
    art: [...FACE_TOP.slice(0, 2), ".yryryryry.", "yyrrryrrryy", "yyyryyyryyy", "yyyyyyyyyyy", "yykyyyyykyy", "yyykkkkkyyy", ...FACE_END],
  },
  {
    name: "sad",
    u: [0x1f622, 0x1f641, 0x2639, 0x1f61e, 0x1f62d],
    art: [...FACE_TOP, "yyykyyykyyy", "yyykyyykyyy", "yyyyyyyyyyy", "yyykkkkkyyy", "yykyyyyykyy", ...FACE_END],
  },
  {
    name: "heart",
    u: [0x2764, 0x2665, 0x1f496, 0x1f497, 0x1f493, 0x1f495, 0x1f49e, 0x1f9e1],
    art: [".rrr...rrr.", "rrrrr.rrrrr", "rwwrrrrrrrr", "rwrrrrrrrrr", "rrrrrrrrrrr", ".rrrrrrrrr.", "..rrrrrrr..", "...rrrrr...", "....rrr....", ".....r....."],
  },
  {
    name: "thumbsup",
    u: [0x1f44d],
    art: ["....kk....", "...kyyk...", "...kyyk...", "..kyyyk...", "kkkyyyykkk", "kyykyyyyyk", "kyykkkkkyk", "kyykyyyyyk", "kyykkkkkyk", "kyykyyyyk.", "kkkkkkkkk."],
  },
  {
    name: "rock",
    u: [0x1f918],
    art: [".kk...kk.", "kyyk.kyyk", "kyyk.kyyk", "kyykkkyyk", "kyykykyyk", "kyyyyyyyk", "kyyyyyyyk", "kkyyyyykk", ".kyyyyyk.", ".kyyyyyk.", ".kkkkkkk."],
  },
  {
    name: "wave",
    u: [0x1f44b],
    art: ["..k.k.k...", ".kykykyk..", ".kykykyk..", ".kykykyk.k", ".kyyyyykyk", ".kyyyyyyk.", "kyyyyyyyk.", "kyyyyyyk..", ".kyyyyyk..", "..kyyyk...", "...kkk...."],
  },
  {
    name: "fire",
    u: [0x1f525],
    art: ["....r......", "....rr.....", "...rrr..r..", "..rrorr.rr.", "..rroorrrr.", ".rrooorrrr.", ".rrooyoorrr", "rrooyyyoorr", "rrooyyyoorr", ".rroyyyorr.", "..rrrrrrr.."],
  },
  {
    name: "star",
    u: [0x2b50, 0x1f31f, 0x2728, 0x1f4ab],
    art: [".....y.....", "....yyy....", "....yyy....", "yyyyyyyyyyy", ".yyyyyyyyy.", "..yyyyyyy..", "..yyyyyyy..", ".yyyy.yyyy.", ".yyy...yyy.", "yy.......yy"],
  },
  {
    name: "party",
    u: [0x1f389, 0x1f973, 0x1f38a],
    art: ["......g..r.", ".y..r....y.", ".....y.g...", "...o...r..g", "..ooo.y....", "..oyoo..r..", ".ooyooo....", ".oyoooo.y..", "oooyoo.....", "ooyoo......", "ooo........"],
  },
  {
    name: "cake",
    u: [0x1f382, 0x1f9c1],
    art: ["..y..y..y..", "..o..o..o..", "..w..w..w..", ".wwwwwwwww.", ".wrwwrwwrw.", ".rrrrrrrrr.", ".ooooooooo.", ".wwwwwwwww.", ".ooooooooo.", "rrrrrrrrrrr"],
  },
  {
    name: "coffee",
    u: [0x2615],
    art: ["..w..w.....", "...w..w....", "..w..w.....", "...........", "wwwwwwww...", "woooooowww.", "woooooow.w.", "woooooowww.", ".wooooow...", "..wwwww....", "wwwwwwwww.."],
  },
  {
    name: "beer",
    u: [0x1f37a, 0x1f37b],
    art: [".wwwwwww...", "wwwwwwwww..", "wyyyyyyw...", "wyyyyyywww.", "wyyyyyyw.w.", "wyyyyyyw.w.", "wyyyyyywww.", "wyyyyyyw...", "wyyyyyyw...", "wwwwwwww..."],
  },
  {
    name: "pizza",
    u: [0x1f355],
    art: ["ooooooooooo", "oyyyyyyyyyo", ".yryyyyyry.", ".yyyyryyyy.", "..yyyyyyy..", "..yyryyyy..", "...yyyyy...", "...yyyry...", "....yyy....", ".....y....."],
  },
  {
    name: "check",
    u: [0x2705, 0x2714, 0x2611],
    art: [".ggggggggg.", "gggggggggwg", "ggggggggwwg", "gggggggwwgg", "gwggggwwggg", "gwwggwwgggg", "ggwwwwggggg", "gggwwgggggg", "ggggggggggg", ".ggggggggg."],
  },
  {
    name: "x",
    u: [0x274c, 0x2716, 0x274e],
    art: ["rr.......rr", "rrr.....rrr", ".rrr...rrr.", "..rrr.rrr..", "...rrrrr...", "....rrr....", "...rrrrr...", "..rrr.rrr..", ".rrr...rrr.", "rrr.....rrr", "rr.......rr"],
  },
  {
    name: "stop",
    u: [0x1f6d1, 0x26d4, 0x1f6ab],
    art: ["...rrrrr...", "..rrrrrrr..", ".rrrrrrrrr.", "rrrrrrrrrrr", "rrrrrrrrrrr", "rwwwwwwwwwr", "rrrrrrrrrrr", "rrrrrrrrrrr", ".rrrrrrrrr.", "..rrrrrrr..", "...rrrrr..."],
  },
  {
    name: "warning",
    u: [0x26a0],
    art: [".....y.....", "....yyy....", "....yky....", "...yykyy...", "...yykyy...", "..yyykyyy..", "..yyykyyy..", ".yyyyyyyyy.", ".yyyykyyyy.", "yyyyyyyyyyy"],
  },
  {
    name: "rocket",
    u: [0x1f680],
    art: ["....w....", "...www...", "..wwwww..", "..wwkww..", "..wkkkw..", "..wwkww..", ".rwwwwwr.", "rrwwwwwrr", "rr.ooo.rr", "...yoy...", "....y...."],
  },
  {
    name: "zap",
    u: [0x26a1],
    art: [".....yyyy", "....yyyy.", "...yyyy..", "..yyyy...", ".yyyyyyy.", "....yyy..", "...yyy...", "..yyy....", ".yy......", "yy......."],
  },
  {
    name: "sun",
    u: [0x2600, 0x1f31e, 0x1f324],
    art: [".....y.....", ".y...y...y.", "..y.....y..", "....yyy....", "...yyyyy...", "yy.yyyyy.yy", "...yyyyy...", "....yyy....", "..y.....y..", ".y...y...y.", ".....y....."],
  },
  {
    name: "trophy",
    u: [0x1f3c6, 0x1f947],
    art: ["yyyyyyyyyyy", "y.yyyyyyy.y", "y.yyyyyyy.y", ".yyyyyyyyy.", "..yyyyyyy..", "...yyyyy...", "....yyy....", ".....y.....", ".....y.....", "...ooooo...", "..ooooooo.."],
  },
  {
    name: "money",
    u: [0x1f4b0, 0x1f4b5, 0x1f911, 0x1f4b2, 0x1f4b8],
    art: ["....ggg....", "...ggggg...", "..gggwggg..", ".gggwwwggg.", ".gggwgggggg", "gggggwwgggg", "gggggggwggg", "ggggwwwgggg", ".ggggwggggg", ".ggggggggg.", "..ggggggg.."],
  },
];

const BY_NAME: Record<string, Emoji> = {};
const BY_CODE: Record<number, string> = {};
for (const e of EMOJI) {
  BY_NAME[e.name] = e;
  for (const c of e.u) BY_CODE[c] = e.name;
}

export const CODE = /:([a-z0-9_]+):/g;

export function emoji(name: string): Emoji | undefined {
  return BY_NAME[name];
}

/** Typed text to ASCII: known emoji become :name: codes, anything else non-ASCII is dropped. */
export function toCodes(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i) as number;
    if (c > 0xffff) i++;
    if (c >= 0x20 && c <= 0x7e) out += s[i];
    else if (BY_CODE[c]) out += `:${BY_CODE[c]}:`;
  }
  return out;
}

/** ASCII text back to typed text, for showing in an input. */
export function fromCodes(s: string): string {
  return s.replace(CODE, (m, n) => (BY_NAME[n] ? String.fromCodePoint(BY_NAME[n].u[0]) : m));
}
