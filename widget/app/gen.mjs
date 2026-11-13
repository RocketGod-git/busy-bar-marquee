// Writes the widget's web files into app/web for embedding in Marquee.exe: index.html as is, and the
// Marquee renderer (marquee/src/fx.ts, font.ts, emoji.ts) with types stripped, so the preview runs
// the exact code the BUSY Bar runs.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "marquee", "src");
const OUT = join(HERE, "web");
mkdirSync(OUT, { recursive: true });

copyFileSync(join(HERE, "..", "index.html"), join(OUT, "index.html"));
for (const name of ["fx", "font", "emoji"]) {
  const ts = readFileSync(join(SRC, `${name}.ts`), "utf8");
  const js = stripTypeScriptTypes(ts, { mode: "strip" }).replace(/from "\.\/(\w+)\.ts"/g, 'from "./$1.js"');
  writeFileSync(join(OUT, `${name}.js`), js);
}
const manifest = JSON.parse(readFileSync(join(SRC, "appmeta", "manifest.json"), "utf8"));
writeFileSync(join(OUT, "app.json"), JSON.stringify({ id: manifest.id, version: manifest.version }));

// The bar app package, so Marquee.exe can install it with one click. Build it first with
// `npm run build` in marquee/; without it, the exe still works but can't install the bar app.
const PAYLOAD = join(HERE, "payload");
rmSync(PAYLOAD, { recursive: true, force: true });
const DIST = join(SRC, "..", "dist");
const tgz = existsSync(DIST)
  ? readdirSync(DIST).filter((f) => f.endsWith(".tgz")).map((f) => join(DIST, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  : undefined;
if (tgz) {
  mkdirSync(PAYLOAD, { recursive: true });
  copyFileSync(tgz, join(PAYLOAD, "marquee.tgz"));
} else {
  console.warn("gen.mjs: no marquee/dist/*.tgz found; Marquee.exe won't be able to install the bar app");
}
