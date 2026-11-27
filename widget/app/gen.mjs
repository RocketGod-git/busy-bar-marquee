// Writes the widget's web files into app/web for embedding in Marquee.exe: index.html as is, and the
// Marquee renderer (marquee/src/fx.ts, font.ts, emoji.ts) with types stripped, so the preview runs
// the exact code the BUSY Bar runs.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

