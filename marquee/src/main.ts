import { device } from "@shared/device";
import { loadValues } from "@shared/settings";
import type { DisplayDrawParams } from "@busy-app/busy-lib";
import manifest from "./appmeta/manifest.json";
import { Renderer, Banner, type Look, type Bg, type Motion, type TextFx } from "./fx.ts";

const APP = manifest.id;
const TAG = "marquee:";
/** 15 frames per second; the loop waits for each frame to land before sending the next. */
const FRAME_MS = 66;
const SETTINGS_MS = 2000;
/** Visible width of the message line on the back screen. */
const BACK_W = 146;
// Device font names, kept out of `font:` literals: the CLI font-maps plugin would try to bundle
// measurement maps for them (unused here) and breaks on Windows paths.
const SMALL = "small";
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

  // The back screen's message line is drawn as a bitmap so it can show emoji. Long messages
  // scroll like native text: a pause, a slide to the end, a longer pause, then back to the start.
  let banner: Banner | null = null;
  let bannerText = "";
  let backOff = 0;
  let backHold = 0;
  let backAtEnd = false;
  const backLine = (): Record<string, unknown> => ({
    id: "k_b", type: "xpmbitmap", x: 2, y: 18, align: "top_left", display: "back",
    data: banner ? banner.xpm(backOff, BACK_W) : "",
  });
  /** Advances the back scroll every other frame; true when the line moved. */
  const backStep = (frame: number) => {
    if (!banner || banner.width <= BACK_W || (frame & 1)) return false;
    if (backHold > 0) {
      backHold -= 1;
      return false;
    }
    if (backAtEnd) {
      backAtEnd = false;
      backOff = 0;
      backHold = 6;
      return true;
    }
    backOff += 2;
    if (backOff >= banner.width - BACK_W) {
      backOff = banner.width - BACK_W;
      backAtEnd = true;
      backHold = 11;
    }
    return true;
  };

  const drawBack = () => {
    const l = r.look;
    const label = (s: string) => s.toUpperCase();
    if (!banner || l.text !== bannerText) {
      bannerText = l.text;
      banner = new Banner(l.text);
      backOff = 0;
      backHold = 6;
      backAtEnd = false;
    }
    const els = [
      { id: "k_t", type: "text", x: 2, y: 1, align: "top_left", text: "NOW SHOWING", font: SMALL, color: "#FFFFFFFF" },
      { id: "k_r", type: "rectangle", x: 2, y: 11, width: 146, height: 1, align: "top_left", fill: "gradient_h", fill_colors: ["#FFFFFFFF", "#FFFFFF00"], border_width: 0 },
      { id: "k_s", type: "text", x: 2, y: 44, align: "top_left", text: `${label(l.bg)} / ${label(l.textFx)} / ${label(l.motion)}`, font: SMALL, color: "#FFFFFFA0" },
      { id: "k_h", type: "text", x: 2, y: 66, align: "top_left", text: "WHEEL: BG  OK: MOTION  START: FX", font: TINY, color: "#FFFFFF60" },
    ].map((e) => ({ ...e, display: "back" }) as Record<string, unknown>);
    els.push(backLine());
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

  let frameNo = 0;
  const frameLoop = async () => {
    while (alive) {
      frameNo += 1;
      const t0 = Date.now();
      // Everything per frame stays inside the try: one failed frame must never end the loop.
      try {
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
        if (backStep(frameNo)) elements.push(backLine());
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
