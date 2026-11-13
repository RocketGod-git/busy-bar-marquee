// Marquee.exe: the desktop widget as a native Windows app.
// The control panel (widget/index.html and the Marquee renderer) is embedded and shown in WebView2.
// Its /api/ calls are answered here, straight against the BUSY Bar's HTTP API: no local server.
//
// Bar address and password: BUSY_ADDR / BUSY_PASSWORD, or config.json ({"addr": "...", "password": "..."})
// in %APPDATA%\Marquee or next to Marquee.exe. Over USB the bar is 10.0.4.20 and needs no password.
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Marquee;

static class Program
{
    [STAThread]
    static void Main()
    {
        using var single = new Mutex(true, @"Local\RocketGod.Marquee.Widget", out bool first);
        if (!first)
        {
            Native.FocusOther();
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

static class Native
{
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);

    /// <summary>Brings an already running Marquee window to the front.</summary>
    public static void FocusOther()
    {
        var me = Process.GetCurrentProcess();
        foreach (var p in Process.GetProcessesByName(me.ProcessName))
        {
            if (p.Id == me.Id || p.MainWindowHandle == IntPtr.Zero) continue;
            if (IsIconic(p.MainWindowHandle)) ShowWindow(p.MainWindowHandle, 9);
            SetForegroundWindow(p.MainWindowHandle);
            return;
        }
    }
}

static class Paths
{
    public static readonly string Roaming = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Marquee");
    public static readonly string Local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marquee");
}

/// <summary>Reads and writes Marquee's settings on the bar.</summary>
sealed class Bar
{
    static readonly Dictionary<string, string> Fields = new()
    {
        ["text"] = "string", ["color"] = "color", ["color2"] = "color", ["text_fx"] = "string", ["motion"] = "string",
        ["size"] = "string", ["speed"] = "int", ["bg"] = "string", ["bg_color"] = "color", ["bg_level"] = "int",
        ["outline"] = "bool", ["alert"] = "bool",
    };

    public string Addr { get; }
    readonly string appId;
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(4) };

    public Bar(string appId)
    {
        this.appId = appId;
        var config = new JsonObject();
        foreach (var dir in new[] { AppContext.BaseDirectory, Paths.Roaming })
        {
            var file = Path.Combine(dir, "config.json");
            try
            {
                if (File.Exists(file) && JsonNode.Parse(File.ReadAllText(file)) is JsonObject o)
                    foreach (var kv in o) config[kv.Key] = kv.Value?.DeepClone();
            }
            catch { }
        }
        string Opt(string env, string key, string fallback)
        {
            var e = Environment.GetEnvironmentVariable(env);
            if (!string.IsNullOrEmpty(e)) return e;
            var v = config[key]?.ToString();
            return string.IsNullOrEmpty(v) ? fallback : v;
        }
        Addr = Opt("BUSY_ADDR", "addr", "10.0.4.20");
        var password = Opt("BUSY_PASSWORD", "password", "");
        http.BaseAddress = new Uri($"http://{Addr}/api/");
        if (password != "") http.DefaultRequestHeaders.Add("X-API-Token", password);
    }

    async Task<JsonObject> Call(HttpMethod method, string path, JsonNode? body = null)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body != null) req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var res = await http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) throw new Exception($"{(int)res.StatusCode} {text[..Math.Min(200, text.Length)]}");
        return text.Trim() == "" ? new JsonObject() : JsonNode.Parse(text) as JsonObject ?? new JsonObject();
    }

    string SettingsPath => $"apps/settings?app_id={Uri.EscapeDataString(appId)}";

    public async Task<JsonObject> State()
    {
        try
        {
            var doc = await Call(HttpMethod.Get, SettingsPath);
            return new JsonObject { ["connected"] = true, ["addr"] = Addr, ["values"] = doc["values"]?.DeepClone() ?? new JsonObject() };
        }
        catch (Exception e)
        {
            return new JsonObject { ["connected"] = false, ["addr"] = Addr, ["error"] = e.Message };
        }
    }

    public async Task Send(JsonObject values, bool launch)
    {
        var doc = await Call(HttpMethod.Get, SettingsPath);
        var merged = doc["values"] as JsonObject ?? new JsonObject();
        foreach (var (k, type) in Fields)
        {
            if (!values.TryGetPropertyValue(k, out var v) || v == null) continue;
            merged[k] = Clean(v, type);
        }
        doc["values"] = merged.DeepClone();
        await Call(HttpMethod.Put, SettingsPath, doc);
        // Launching brings Marquee to the front; skipped for live tweaks so the animation keeps going.
        if (launch) await Call(HttpMethod.Post, $"apps/launch?app_id={Uri.EscapeDataString(appId)}");
    }

    public Task Stop() => Call(HttpMethod.Post, "apps/quit");

    static JsonNode Clean(JsonNode v, string type)
    {
        var s = v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : v.ToJsonString();
        switch (type)
        {
            case "int":
                return double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? (int)Math.Round(d) : 0;
            case "bool":
                return v.GetValueKind() == JsonValueKind.True;
            case "color":
                return Regex.IsMatch(s, "^#[0-9a-fA-F]{6}$") ? s.ToUpperInvariant() : "#FFFFFF";
            default:
                var clean = Regex.Replace(s, @"[^\x20-\x7E]", "");
                return clean.Length > 200 ? clean[..200] : clean;
        }
    }
}

/// <summary>Window and app preferences, kept in %APPDATA%\Marquee\window.json.</summary>
sealed class Prefs
{
    static readonly string FilePath = Path.Combine(Paths.Roaming, "window.json");

    public string View { get; set; } = "full";
    public Dictionary<string, int[]> Bounds { get; set; } = new();
    public bool Maximized { get; set; }
    public bool TopMost { get; set; }
    public bool PinDeclined { get; set; }

    public static Prefs Load()
    {
        try
        {
            if (File.Exists(FilePath)) return JsonSerializer.Deserialize<Prefs>(File.ReadAllText(FilePath)) ?? new Prefs();
        }
        catch { }
        return new Prefs();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Paths.Roaming);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this));
        }
        catch { }
    }
}

sealed class MainForm : Form
{
    const string Origin = "https://marquee.app/";
    static readonly Color Back = Color.FromArgb(7, 8, 12);

    readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Back };
    readonly Bar bar;
    readonly Prefs prefs = Prefs.Load();
    readonly System.Windows.Forms.Timer pinWatch = new() { Interval = 1500 };
    DateTime pinWatchUntil;

    public MainForm()
    {
        var app = JsonNode.Parse(Resource("web/app.json")!)!;
        bar = new Bar(app["id"]!.GetValue<string>());
        Text = "Marquee";
        BackColor = Back;
        using (var ico = Assembly.GetExecutingAssembly().GetManifestResourceStream("marquee.ico")) if (ico != null) Icon = new Icon(ico);
        StartPosition = FormStartPosition.Manual;
        MinimumSize = new Size(LogicalToDeviceUnits(260), LogicalToDeviceUnits(130));
        TopMost = prefs.TopMost;
        PlaceFor(prefs.View, null);
        if (prefs.Maximized && prefs.View == "full") WindowState = FormWindowState.Maximized;
        Controls.Add(web);
        Load += async (_, _) => await Start();
        FormClosing += (_, _) =>
        {
            Remember();
            prefs.Save();
        };
        pinWatch.Tick += (_, _) =>
        {
            if (Taskbar.IsPinned())
            {
                pinWatch.Stop();
                Taskbar.Flash(Handle, false);
                Post(new JsonObject { ["type"] = "pinned" });
            }
            else if (DateTime.Now > pinWatchUntil)
            {
                pinWatch.Stop();
            }
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Frame.Theme(Handle);
    }

    static byte[]? Resource(string name)
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (s == null) return null;
        using var m = new MemoryStream();
        s.CopyTo(m);
        return m.ToArray();
    }

    double Dpi => DeviceDpi / 96.0;

    /// <summary>Saves where the window is for the current view.</summary>
    void Remember()
    {
        prefs.Maximized = WindowState == FormWindowState.Maximized;
        var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        if (r.Width > 0 && r.Height > 0) prefs.Bounds[prefs.View] = [r.X, r.Y, r.Width, r.Height];
    }

    /// <summary>
    /// Moves the window to the saved place for a view, or sizes it to suit the view.
    /// A suggested size is in CSS pixels; with none, the full view opens to fit the screen.
    /// </summary>
    void PlaceFor(string view, Size? suggested)
    {
        var area = (IsHandleCreated ? Screen.FromHandle(Handle) : Screen.PrimaryScreen)?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
        if (prefs.Bounds.TryGetValue(view, out var b) && b.Length == 4)
        {
            var r = new Rectangle(b[0], b[1], b[2], b[3]);
            if (r.Width >= MinimumSize.Width && r.Height >= MinimumSize.Height && Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)))
            {
                Bounds = r;
                return;
            }
        }
        var css = suggested ?? (view == "screen" ? new Size(560, 143) : view == "compact" ? new Size(760, 330) : new Size(1240, 800));
        // Window size from the page size, plus the frame.
        var frame = SizeFromClientSize(new Size(100, 100)) - new Size(100, 100);
        var w = Math.Min((int)(css.Width * Dpi) + frame.Width, (int)(area.Width * 0.9));
        var h = css.Height > 0 ? Math.Min((int)(css.Height * Dpi) + frame.Height, (int)(area.Height * 0.9)) : Height;
        if (view == "full")
        {
            w = Math.Min((int)(1240 * Dpi), (int)(area.Width * 0.86));
            h = Math.Min((int)(800 * Dpi), (int)(area.Height * 0.9));
        }
        var shown = IsHandleCreated && Visible;
        var x = shown ? Left : area.X + (area.Width - w) / 2;
        var y = shown ? Top : area.Y + (area.Height - h) / 2;
        // Keep the whole window on the screen.
        x = Math.Max(area.Left, Math.Min(x, area.Right - w));
        y = Math.Max(area.Top, Math.Min(y, area.Bottom - h));
        Bounds = new Rectangle(x, y, w, h);
    }

    void Post(JsonNode message) => web.CoreWebView2?.PostWebMessageAsJson(message.ToJsonString());

    void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonObject m;
        try
        {
            m = JsonNode.Parse(e.WebMessageAsJson) as JsonObject ?? new JsonObject();
        }
        catch
        {
            return;
        }
        int Css(string key) => m[key] is JsonValue v && v.TryGetValue<double>(out var d) ? (int)Math.Round(d) : 0;
        switch (m["type"]?.ToString())
        {
            case "hello":
                Post(new JsonObject
                {
                    ["type"] = "init",
                    ["view"] = prefs.View,
                    ["topmost"] = TopMost,
                    ["askPin"] = !prefs.PinDeclined && !Taskbar.IsPinned(),
                });
                break;
            case "view":
                var view = m["view"]?.ToString() ?? "full";
                if (view == prefs.View) break;
                Remember();
                prefs.View = view;
                if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
                var fresh = !prefs.Bounds.ContainsKey(view);
                PlaceFor(view, new Size(Css("w"), Css("h")));
                prefs.Save();
                // A view used for the first time can now size its height to its content.
                if (fresh) BeginInvoke(() => Post(new JsonObject { ["type"] = "placed", ["view"] = view }));
                break;
            case "fitHeight":
                // Only the first time a view is used; after that the window keeps the size you gave it.
                if (WindowState != FormWindowState.Normal || prefs.Bounds.ContainsKey(prefs.View)) break;
                var area = Screen.FromHandle(Handle).WorkingArea;
                var h = Math.Min((int)(Css("h") * Dpi), (int)(area.Height * 0.9));
                ClientSize = new Size(ClientSize.Width, h);
                if (Bottom > area.Bottom) Top = Math.Max(area.Top, area.Bottom - Height);
                break;
            case "topmost":
                TopMost = prefs.TopMost = m["on"]?.GetValueKind() == JsonValueKind.True;
                prefs.Save();
                break;
            case "pin":
                if (m["action"]?.ToString() == "decline")
                {
                    prefs.PinDeclined = true;
                    prefs.Save();
                }
                else
                {
                    Taskbar.Flash(Handle, true);
                    pinWatchUntil = DateTime.Now.AddMinutes(3);
                    pinWatch.Start();
                }
                break;
        }
    }

    async Task Start()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Paths.Local, "WebView2"));
            await web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this, "Marquee needs the Microsoft Edge WebView2 Runtime. Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and open Marquee again.",
                "Marquee", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }
        var core = web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = Debugger.IsAttached;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsPinchZoomEnabled = false;
        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnRequest;
        core.WebMessageReceived += OnMessage;
        // Links open in the default browser, never inside the app.
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
        };
        core.Navigate(Origin);
    }

    async void OnRequest(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var core = web.CoreWebView2;
        var deferral = e.GetDeferral();
        try
        {
            var uri = new Uri(e.Request.Uri);
            var path = uri.AbsolutePath;
            var method = e.Request.Method;
            CoreWebView2WebResourceResponse Reply(int code, string type, byte[] body) =>
                core.Environment.CreateWebResourceResponse(new MemoryStream(body), code, code == 200 ? "OK" : "Error",
                    $"Content-Type: {type}\r\nCache-Control: no-store");
            CoreWebView2WebResourceResponse Json(int code, JsonNode body) => Reply(code, "application/json", Encoding.UTF8.GetBytes(body.ToJsonString()));

            if (path.StartsWith("/api/"))
            {
                try
                {
                    switch (method, path)
                    {
                        case ("GET", "/api/state"):
                            e.Response = Json(200, await bar.State());
                            break;
                        case ("POST", "/api/send"):
                            var raw = e.Request.Content == null ? "{}" : await new StreamReader(e.Request.Content).ReadToEndAsync();
                            var req = JsonNode.Parse(raw == "" ? "{}" : raw) as JsonObject ?? new JsonObject();
                            await bar.Send(req["values"] as JsonObject ?? new JsonObject(), req["launch"]?.GetValueKind() == JsonValueKind.True);
                            e.Response = Json(200, new JsonObject { ["ok"] = true });
                            break;
                        case ("POST", "/api/stop"):
                            await bar.Stop();
                            e.Response = Json(200, new JsonObject { ["ok"] = true });
                            break;
                        default:
                            e.Response = core.Environment.CreateWebResourceResponse(null, 204, "No Content", "");
                            break;
                    }
                }
                catch (Exception err)
                {
                    e.Response = Json(502, new JsonObject { ["ok"] = false, ["error"] = err.Message });
                }
                return;
            }

            var name = path == "/" ? "index.html" : path.TrimStart('/');
            var file = Resource("web/" + name);
            if (file == null)
            {
                e.Response = Reply(404, "text/plain", Encoding.UTF8.GetBytes("not found"));
                return;
            }
            var type = Path.GetExtension(name) switch
            {
                ".html" => "text/html; charset=utf-8",
                ".js" => "text/javascript; charset=utf-8",
                ".json" => "application/json",
                _ => "application/octet-stream",
            };
            e.Response = Reply(200, type, file);
        }
        finally
        {
            deferral.Complete();
        }
    }
}

/// <summary>Colors the window frame to match the app (Windows 11; older Windows keeps its own frame).</summary>
static class Frame
{
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    static int Bgr(Color c) => c.R | (c.G << 8) | (c.B << 16);

    public static void Theme(IntPtr hwnd)
    {
        int on = 1;
        DwmSetWindowAttribute(hwnd, 20, ref on, sizeof(int)); // dark mode
        int caption = Bgr(Color.FromArgb(7, 8, 12));
        int text = Bgr(Color.FromArgb(233, 236, 244));
        int border = Bgr(Color.FromArgb(35, 40, 56));
        DwmSetWindowAttribute(hwnd, 35, ref caption, sizeof(int)); // caption color
        DwmSetWindowAttribute(hwnd, 36, ref text, sizeof(int)); // title text color
        DwmSetWindowAttribute(hwnd, 34, ref border, sizeof(int)); // border color
    }
}

/// <summary>
/// Windows doesn't let apps pin themselves, so Marquee flashes its taskbar button to show where to
/// right-click, and watches the pinned-apps folder to see when that's done.
/// </summary>
static class Taskbar
{
    [StructLayout(LayoutKind.Sequential)]
    struct FlashInfo
    {
        public uint Size;
        public IntPtr Hwnd;
        public uint Flags;
        public uint Count;
        public uint Timeout;
    }

    [DllImport("user32.dll")] static extern bool FlashWindowEx(ref FlashInfo info);

    public static void Flash(IntPtr hwnd, bool on)
    {
        var info = new FlashInfo
        {
            Size = (uint)Marshal.SizeOf<FlashInfo>(),
            Hwnd = hwnd,
            Flags = on ? 2u : 0u, // FLASHW_TRAY, or FLASHW_STOP
            Count = on ? 40u : 0u,
        };
        FlashWindowEx(ref info);
    }

    static readonly string PinnedDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar");

    /// <summary>True when a taskbar pin points at Marquee.exe.</summary>
    public static bool IsPinned()
    {
        try
        {
            var exe = Path.GetFileName(Environment.ProcessPath ?? "Marquee.exe").ToLowerInvariant();
            var ascii = Encoding.ASCII.GetBytes(exe);
            var wide = Encoding.Unicode.GetBytes(exe);
            foreach (var lnk in Directory.EnumerateFiles(PinnedDir, "*.lnk"))
            {
                var bytes = File.ReadAllBytes(lnk);
                for (var i = 0; i < bytes.Length; i++) if (bytes[i] is >= 65 and <= 90) bytes[i] += 32;
                if (bytes.AsSpan().IndexOf(ascii) >= 0 || bytes.AsSpan().IndexOf(wide) >= 0) return true;
            }
        }
        catch { }
        return false;
    }
}
