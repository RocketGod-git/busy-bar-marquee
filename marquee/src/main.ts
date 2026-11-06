import { device } from "@shared/device";
import { loadValues } from "@shared/settings";
import type { DisplayDrawParams } from "@busy-app/busy-lib";
import manifest from "./appmeta/manifest.json";
import { Renderer, type Look, type Bg, type Motion, type TextFx } from "./fx.ts";

const APP = manifest.id;
const TAG = "marquee:";
/** 15 frames per second; the loop waits for each frame to land before sending the next. */
const FRAME_MS = 66;
const SETTINGS_MS = 2000;
// Device font names, kept out of `font:` literals: the CLI font-maps plugin would try to bundle
// measurement maps for them (unused here) and breaks on Windows paths.
const SMALL = "small";
const XL = "extra_large";
const TINY = "tiny";

const BGS: Bg[] = ["plasma", "fire", "matrix", "warp", "rainbow", "aurora", "sparkle", "solid", "none"];
const MOTIONS: Motion[] = ["scroll", "wave", "static", "blink", "glitch", "typewriter"];
const TEXT_FX: TextFx[] = ["solid", "chrome", "rainbow", "gradient", "fire"];

const report = (err: unknown) => console.error(`${TAG} ${err instanceof Error ? err.message : String(err)}`);

function pick<T extends string>(v: unknown, list: readonly T[], d: T): T {
  return list.indexOf(v as T) >= 0 ? (v as T) : d;
}

function lookFrom(v: Record<string, unknown>): Partial<Look> & { alert: boolean } {
  const str = (k: string, d: string) => (typeof v[k] === "string" && v[k] !== "" ? String(v[k]) : d);
  const num = (k: string, d: number) => (v[k] === undefined || v[k] === "" ? d : Number(v[k]));
  const bool = (k: string, d: boolean) => (typeof v[k] === "boolean" ? (v[k] as boolean) : d);
  return {
    text: str("text", "WELCOME"),
    color: str("color", "#FFFFFF"),
    color2: str("color2", "#00E5FF"),
    textFx: pick(v.text_fx, TEXT_FX, "chrome"),
    motion: pick(v.motion, MOTIONS, "scroll"),
    size: v.size === "big" ? "big" : "normal",
    speed: num("speed", 5),
    bg: pick(v.bg, BGS, "plasma"),
    bgColor: str("bg_color", "#FF2A3C"),
    bgLevel: num("bg_level", 45),
    outline: bool("outline", true),
    alert: bool("alert", true),
  };
}

/** Settings through the documented HTTP API, with the template's runtime helper as a fallback. */
async function readSettings(): Promise<Record<string, unknown> | null> {
  try {
    const doc = (await device.AppsSettingsGet({ app_id: APP })) as { values?: Record<string, unknown> };
    if (doc && doc.values) return doc.values;
  } catch (err) {
    report(err);
  }
  return loadValues();
}

function main(): void {
  const r = new Renderer();
  let alive = true;
  let flash = 0;
  let led: string | undefined;
  let lastJson = "";
  let base: Partial<Look> = {};
  let override: Partial<Look> = {};
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const sleep = (ms: number) =>
    new Promise<void>((ok) => {
      const id = setTimeout(() => {
        timeouts.delete(id);
        ok();
      }, ms);
      timeouts.add(id);
    });

  const apply = () => r.set({ ...base, ...override });

  const drawBack = () => {
    const l = r.look;
    const label = (s: string) => s.toUpperCase();
    const els = [
      { id: "k_t", type: "text", x: 2, y: 1, align: "top_left", text: "NOW SHOWING", font: SMALL, color: "#FFFFFFFF" },
      { id: "k_r", type: "rectangle", x: 2, y: 11, width: 146, height: 1, align: "top_left", fill: "gradient_h", fill_colors: ["#FFFFFFFF", "#FFFFFF00"], border_width: 0 },
      { id: "k_m", type: "text", x: 2, y: 18, align: "top_left", text: l.text.replace(/[^\x20-\x7E]/g, "") || " ", font: XL, color: "#FFFFFFFF", width: 146, scroll_rate: 1500, scroll_start_delay: 800, scroll_repeat_delay: 1500 },
      { id: "k_s", type: "text", x: 2, y: 44, align: "top_left", text: `${label(l.bg)} / ${label(l.textFx)} / ${label(l.motion)}`, font: SMALL, color: "#FFFFFFA0" },
      { id: "k_h", type: "text", x: 2, y: 66, align: "top_left", text: "WHEEL: BG  OK: MOTION  START: FX", font: TINY, color: "#FFFFFF60" },
    ].map((e) => ({ ...e, display: "back" }));
    void device.DisplayDraw({ application_name: APP, priority: 50, elements: els as unknown as DisplayDrawParams["elements"] }).catch(report);
  };

  const syncSettings = async () => {
    const v = await readSettings();
    if (!v) return;
    const json = JSON.stringify(v);
    if (json === lastJson) return;
    const first = lastJson === "";
    lastJson = json;
    const { alert, ...look } = lookFrom(v);
    const newText = base.text !== undefined && base.text !== look.text;
    base = look;
    override = {}; // a fresh message from the widget wins over knob fiddling
    apply();
    drawBack();
    if (!first && newText && alert) {
      flash = 4;
      led = "#FFFFFFFF";
    }
  };

  const frameLoop = async () => {
    while (alive) {
      const t0 = Date.now();
      const elements: Record<string, unknown>[] = [
        { id: "fx", type: "xpmbitmap", x: 0, y: 0, align: "top_left", data: r.frame() },
      ];
      if (flash > 0) {
        // A white flash that fades out over four frames when a new message arrives.
        const alpha = ["30", "70", "B0", "F0"][flash - 1];
        elements.push({ id: "flash", type: "rectangle", x: 0, y: 0, width: 72, height: 16, align: "top_left", fill: "solid", fill_colors: [`#FFFFFF${alpha}`], border_width: 0, z_index: 9 });
        flash -= 1;
        if (flash === 0) after.push("flash");
      }
      try {
        await device.DisplayDraw({
          application_name: APP,
          priority: 50,
          elements: elements as unknown as DisplayDrawParams["elements"],
          ...(led ? { led_notification_color: led } : {}),
        });
        led = undefined;
        if (after.length) {
          await device.DisplayClear({ application_name: APP, element_ids: after.splice(0) });
        }
      } catch (err) {
        report(err);
        await sleep(1000); // back off instead of hammering a struggling server
      }
      await sleep(Math.max(5, FRAME_MS - (Date.now() - t0)));
    }
  };
  const after: string[] = [];

  const settingsTimer = setInterval(() => void syncSettings().catch(report), SETTINGS_MS);

  const cycle = <T extends string>(list: readonly T[], cur: T, d: number): T => list[(list.indexOf(cur) + d + list.length) % list.length];

  let unbind: BusyUnbind | null = null;
  const quit = () => {
    if (!alive) return;
    alive = false;
    clearInterval(settingsTimer);
    timeouts.forEach((id) => clearTimeout(id));
    timeouts.clear();
    void device.DisplayClear({ application_name: APP }).catch(report);
    if (unbind) setTimeout(unbind, 0);
  };

  unbind = listen("input", (e) => {
    if (!alive) return;
    // Knobs for playing at the bar itself; the next change from the widget resets them.
    if (e.key === "encoder") {
      override.bg = cycle(BGS, r.look.bg, e.delta);
      if (override.bg !== "none" && r.look.bgLevel === 0) override.bgLevel = 45;
    } else if (e.action !== "short") {
      return;
    } else if (e.key === "back") {
      return quit();
    } else if (e.key === "ok") {
      override.motion = cycle(MOTIONS, r.look.motion, 1);
    } else if (e.key === "start") {
      override.textFx = cycle(TEXT_FX, r.look.textFx, 1);
    }
    apply();
    drawBack();
  });

  void syncSettings()
    .catch(report)
    .then(() => {
      if (!lastJson) {
        apply();
        drawBack();
      }
      return frameLoop();
    })
    .catch(report);
}

main();
