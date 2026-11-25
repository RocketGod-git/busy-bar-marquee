// Marquee desktop widget: a tiny local server for the control panel.
// - Serves index.html and the Marquee renderer (marquee/src/fx.ts, font.ts, emoji.ts, types stripped)
//   so the preview runs the exact code the BUSY Bar runs.
// - Relays to the bar: reads and writes Marquee's settings and launches the app.
// - Installs or updates the Marquee app on the bar with one click, from marquee.tgz next to this
//   file (the release zip has it) or the newest package in marquee/dist.
// - Opens itself as an app window in Microsoft Edge with --open, and exits a minute after the
//   window closes so nothing lingers.
//
// Usage: node server.mjs [--open] [--addr <host>] [--password <password>] [--port <port>]
// Each option can also come from the environment (BUSY_ADDR, BUSY_PASSWORD, PORT) or from
// widget/config.json ({"addr": "...", "password": "...", "port": 5178}). Over USB the bar is
// 10.0.4.20 and needs no password; over Wi-Fi use its IP and, if "Password protection" is on in
// the bar's web UI, its password.
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "marquee", "src");
const MANIFEST = JSON.parse(readFileSync(join(SRC, "appmeta", "manifest.json"), "utf8"));
const APP_ID = MANIFEST.id;
/** Earlier ids of Marquee. An update moves the message over and removes the old app. */
const OLD_IDS = ["app.rocketgod.marquee"];
const settingsPath = (id) => `/apps/settings?app_id=${encodeURIComponent(id)}`;

/** Marquee's apps on the bar: this id's version, and any old ids still installed. */
async function installedApps() {
  const apps = (await bar("/apps/list")).apps ?? [];
  const mine = apps.find((a) => a.id === APP_ID)?.version ?? null;
  const old = apps.filter((a) => OLD_IDS.includes(a.id)).map((a) => ({ id: a.id, version: a.version }));
  return { mine, old };
}

/** The bar app package to install, if this copy of the widget has one. */
function packagePath() {
  const here = join(HERE, "marquee.tgz");
  if (existsSync(here)) return here;
  const dist = join(SRC, "..", "dist");
  if (!existsSync(dist)) return null;
  const tgz = readdirSync(dist).filter((f) => f.endsWith(".tgz")).map((f) => join(dist, f));
  tgz.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return tgz[0] ?? null;
}

/** Compares dotted version numbers. */
function compareVersions(a, b) {
  const x = String(a).split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

function option(flag, env, key, fallback) {
  const i = process.argv.indexOf(flag);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env[env]) return process.env[env];
  const file = join(HERE, "config.json");
  if (existsSync(file)) {
    const v = JSON.parse(readFileSync(file, "utf8"))[key];
    if (v !== undefined && v !== "") return String(v);
  }
  return fallback;
}
const ADDR = option("--addr", "BUSY_ADDR", "addr", "10.0.4.20");
const PASSWORD = option("--password", "BUSY_PASSWORD", "password", "");
const PORT = Number(option("--port", "PORT", "port", "5178"));
const BAR = `http://${ADDR}/api`;
const URL_SELF = `http://localhost:${PORT}/`;

// Settings the widget may write, and their types on the bar.
const FIELDS = {
  text: "string", color: "color", color2: "color", text_fx: "string", motion: "string", size: "string",
  speed: "int", bg: "string", bg_color: "color", bg_level: "int", outline: "bool", alert: "bool",
};

/** Opens the panel as a chromeless app window (Edge or Chrome), falling back to the default browser. */
function openWindow() {
  const run = (cmd, args) => {
    const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
    p.on("error", () => {});
    p.unref();
    return p;
  };
  const app = [`--app=${URL_SELF}`, "--window-size=760,920"];
  if (process.platform === "win32") {
    run("cmd", ["/c", "start", "", "msedge", ...app]);
  } else if (process.platform === "darwin") {
    run("sh", ["-c", `open -na "Google Chrome" --args ${app.join(" ")} || open -na "Microsoft Edge" --args ${app.join(" ")} || open ${URL_SELF}`]);
  } else {
    run("sh", ["-c", `google-chrome ${app.join(" ")} || chromium ${app.join(" ")} || microsoft-edge ${app.join(" ")} || xdg-open ${URL_SELF}`]);
  }
}

/** Strips types from a renderer module and points its imports at the served .js names. */
function module(name) {
  const ts = readFileSync(join(SRC, `${name}.ts`), "utf8");
  return stripTypeScriptTypes(ts, { mode: "strip" }).replace(/from "\.\/(\w+)\.ts"/g, 'from "./$1.js"');
}

async function bar(path, init, timeout = 4000) {
  const headers = { ...(init?.headers ?? {}), ...(PASSWORD ? { "X-API-Token": PASSWORD } : {}) };
  const r = await fetch(`${BAR}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeout) });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
}

function clean(values) {
  const out = {};
  for (const [k, type] of Object.entries(FIELDS)) {
    if (!(k in values)) continue;
    const v = values[k];
    if (type === "int") out[k] = Math.round(Number(v)) || 0;
    else if (type === "bool") out[k] = Boolean(v);
    else if (type === "color") out[k] = /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : "#FFFFFF";
    else out[k] = String(v).replace(/[^\x20-\x7E]/g, "").slice(0, 200);
  }
  return out;
}

// Each open window holds an event stream; the server stays up while any stream is open.
// Timer-based check-ins aren't enough: browsers slow them to once a minute in minimized windows.
const windows = new Set();
let lastSeen = Date.now();

const server = createServer(async (req, res) => {
  const send = (code, type, body) => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };
  const json = (code, obj) => send(code, "application/json", JSON.stringify(obj));
  try {
    const url = new URL(req.url, URL_SELF);
    if (req.method === "GET" && url.pathname === "/") return send(200, "text/html; charset=utf-8", readFileSync(join(HERE, "index.html")));
    if (req.method === "GET" && ["/fx.js", "/font.js", "/emoji.js"].includes(url.pathname)) {
      return send(200, "text/javascript", module(url.pathname.slice(1, -3)));
    }
    if (req.method === "GET" && url.pathname === "/api/alive") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write("retry: 2000\n\n");
      windows.add(res);
      const beat = setInterval(() => res.write(": beat\n\n"), 20000);
      req.on("close", () => {
        clearInterval(beat);
        windows.delete(res);
        lastSeen = Date.now();
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      lastSeen = Date.now();
      let found;
      try {
        found = await installedApps();
      } catch (err) {
        return json(200, { connected: false, addr: ADDR, error: String(err.message || err) });
      }
      const { mine, old } = found;
      const installed = mine ?? old[0]?.version ?? null;
      const pkg = packagePath();
      // Offer an install when the bar doesn't have Marquee, or an update when this copy is newer
      // or the bar still has Marquee under an old id.
      const offer = !pkg ? null : !installed ? "install" : !mine || compareVersions(MANIFEST.version, mine) > 0 ? "update" : null;
      const source = mine ? APP_ID : old[0]?.id;
      let values = {};
      if (source) {
        try {
          values = (await bar(settingsPath(source))).values ?? {};
        } catch {}
      }
      return json(200, { connected: true, addr: ADDR, values, app: { installed, bundled: pkg ? MANIFEST.version : null, offer } });
    }
    if (req.method === "POST" && url.pathname === "/api/install") {
      const pkg = packagePath();
      if (!pkg) throw new Error("This copy of the widget doesn't include the bar app.");
      const { mine, old } = await installedApps();
      // An update keeps the message and look that are on the bar now, even from an old id.
      const source = mine ? APP_ID : old[0]?.id;
      let kept = null;
      if (source) {
        try {
          kept = (await bar(settingsPath(source))).values ?? null;
        } catch {}
      }
      const staged = await bar("/apps/stage", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: readFileSync(pkg) }, 120000);
      if (!staged.install_key) throw new Error(staged.error_code || "The BUSY Bar didn't accept the app.");
      await bar(`/apps/install?install_key=${encodeURIComponent(staged.install_key)}`, { method: "POST" }, 120000);
      if (kept && Object.keys(kept).length) {
        try {
          const now = await bar(settingsPath(APP_ID));
          if (JSON.stringify(now.values) !== JSON.stringify(kept)) {
            now.values = kept;
            await bar(settingsPath(APP_ID), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(now) });
          }
        } catch {}
      }
      for (const o of old) {
        try {
          await bar(`/apps?app_id=${encodeURIComponent(o.id)}`, { method: "DELETE" }, 30000);
        } catch {}
      }
      await bar(`/apps/launch?app_id=${APP_ID}`, { method: "POST" }, 15000);
      return json(200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const { values, launch } = JSON.parse(raw || "{}");
      const doc = await bar(`/apps/settings?app_id=${APP_ID}`);
      doc.values = { ...(doc.values ?? {}), ...clean(values ?? {}) };
      await bar(`/apps/settings?app_id=${APP_ID}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
      // Launching brings Marquee to the front; skipped for live tweaks so the animation keeps going.
      if (launch) await bar(`/apps/launch?app_id=${APP_ID}`, { method: "POST" });
      return json(200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/stop") {
      await bar("/apps/quit", { method: "POST" });
      return json(200, { ok: true });
    }
    send(404, "text/plain", "not found");
  } catch (err) {
    json(502, { ok: false, error: String(err.message || err) });
  }
});

server.on("error", (err) => {
  // Already running: just bring up another window.
  if (err.code === "EADDRINUSE") {
    if (process.argv.includes("--open")) openWindow();
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Marquee widget on ${URL_SELF} -> bar ${BAR}`);
  if (process.argv.includes("--open")) openWindow();
});

// With no window open for a minute, shut down.
setInterval(() => {
  if (windows.size === 0 && Date.now() - lastSeen > 60000) process.exit(0);
}, 10000);
