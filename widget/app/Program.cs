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

sealed class MainForm : Form
{
    const string Origin = "https://marquee.app/";
    static readonly string BoundsFile = Path.Combine(Paths.Roaming, "window.json");

    readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(14, 15, 20) };
    readonly Bar bar;

    public MainForm()
    {
        var app = JsonNode.Parse(Resource("web/app.json")!)!;
        bar = new Bar(app["id"]!.GetValue<string>());
        Text = "Marquee";
        BackColor = Color.FromArgb(14, 15, 20);
        using (var ico = Assembly.GetExecutingAssembly().GetManifestResourceStream("marquee.ico")) if (ico != null) Icon = new Icon(ico);
        StartPosition = FormStartPosition.Manual;
        RestoreBounds_();
        Controls.Add(web);
        Load += async (_, _) => await Start();
        FormClosing += (_, _) => SaveBounds();
    }

    static byte[]? Resource(string name)
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (s == null) return null;
        using var m = new MemoryStream();
        s.CopyTo(m);
        return m.ToArray();
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
        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnRequest;
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
                            // /api/alive keeps the Node server running; there is nothing to keep alive here.
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

    void RestoreBounds_()
    {
        var size = new Size(LogicalToDeviceUnits(760), LogicalToDeviceUnits(920));
        try
        {
            if (File.Exists(BoundsFile) && JsonNode.Parse(File.ReadAllText(BoundsFile)) is JsonObject b)
            {
                var r = new Rectangle(b["x"]!.GetValue<int>(), b["y"]!.GetValue<int>(), b["w"]!.GetValue<int>(), b["h"]!.GetValue<int>());
                // Only reuse a position that is still on a connected screen.
                if (r.Width >= 360 && r.Height >= 300 && Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)))
                {
                    Bounds = r;
                    if (b["max"]?.GetValue<bool>() == true) WindowState = FormWindowState.Maximized;
                    return;
                }
            }
        }
        catch { }
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 1000);
        size = new Size(Math.Min(size.Width, area.Width), Math.Min(size.Height, area.Height));
        Bounds = new Rectangle(area.X + (area.Width - size.Width) / 2, area.Y + (area.Height - size.Height) / 2, size.Width, size.Height);
    }

    void SaveBounds()
    {
        try
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Directory.CreateDirectory(Paths.Roaming);
            File.WriteAllText(BoundsFile, new JsonObject
            {
                ["x"] = r.X, ["y"] = r.Y, ["w"] = r.Width, ["h"] = r.Height,
                ["max"] = WindowState == FormWindowState.Maximized,
            }.ToJsonString());
        }
        catch { }
    }
}
