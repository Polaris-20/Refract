using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Refract;

internal sealed class DesktopLyrics : Form
{
    private sealed class Preferences
    {
        public Preferences() { }
        public bool Enabled { get; set; }
        public bool Locked { get; set; }
        public int FontSize { get; set; } = 28;
        public int? Left { get; set; }
        public int? Top { get; set; }
    }
    internal sealed record Line(double Time, double? End, string Text);
    private readonly string settingsPath;
    private readonly Preferences settings;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 100 };
    private readonly Stopwatch clock = new();
    private List<Line> lines = [];
    private string song = "", title = "折光 · REFRACT", artist = "选择一首音乐", lastDrawing = "";
    private double anchor, duration;
    private bool advancing, timed, updatingSize;
    private Color accent = Color.FromArgb(216, 243, 149);
    public event Action? SettingsChanged;
    public event Action<string>? Failed;

    public DesktopLyrics(string root)
    {
        settingsPath = Path.Combine(root, "desktop-lyrics.json");
        try { settings = JsonSerializer.Deserialize<Preferences>(File.ReadAllText(settingsPath)) ?? new(); }
        catch { settings = new(); }
        settings.FontSize = Math.Clamp(settings.FontSize, 20, 44);
        Text = "折光 · 桌面歌词"; FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual; TopMost = true; AutoScaleMode = AutoScaleMode.None;
        timer.Tick += (_, _) => RefreshDrawing();
        DpiChanged += (_, e) => { settings.Left = e.SuggestedRectangle.Left; settings.Top = e.SuggestedRectangle.Top; ResizeOverlay(false); RefreshDrawing(true); };
        VisibleChanged += (_, _) => { timer.Enabled = Visible; if (Visible) RefreshDrawing(true); };
    }
    protected override bool ShowWithoutActivation => true;
    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ExStyle |= 0x80000 | 0x80 | 0x08000000; if (settings?.Locked == true) cp.ExStyle |= 0x20; return cp; }
    }
    public object Snapshot() => new { enabled = settings.Enabled, locked = settings.Locked, fontSize = settings.FontSize };
    public void RestoreVisibility()
    {
        ResizeOverlay(false);
        if (settings.Enabled) { Show(); RefreshDrawing(true); }
    }
    public object Configure(JsonElement p)
    {
        if (p.TryGetProperty("enabled", out var enabled)) settings.Enabled = enabled.GetBoolean();
        if (p.TryGetProperty("locked", out var locked)) settings.Locked = locked.GetBoolean();
        if (p.TryGetProperty("fontSize", out var size)) settings.FontSize = Math.Clamp(size.GetInt32(), 20, 44);
        bool reset = p.TryGetProperty("reset", out var resetValue) && resetValue.GetBoolean();
        if (reset) { settings.Enabled = true; settings.Locked = false; }
        UpdateStyles(); ResizeOverlay(reset); Save();
        if (settings.Enabled) { if (!Visible) Show(); RefreshDrawing(true); } else Hide();
        SettingsChanged?.Invoke(); return Snapshot();
    }
    private void ResizeOverlay(bool reset)
    {
        if (updatingSize) return;
        updatingSize = true;
        try
        {
            var origin = !reset && settings.Left.HasValue && settings.Top.HasValue ? new Rectangle(settings.Left.Value, settings.Top.Value, 100, 100) : Screen.PrimaryScreen!.WorkingArea;
            var area = Screen.FromRectangle(origin).WorkingArea;
            float scale = DeviceDpi / 96f;
            var size = new Size(Math.Min((int)(900 * scale), area.Width), Math.Min((int)((settings.FontSize * 2.9 + 55) * scale), area.Height));
            int x = !reset && settings.Left.HasValue ? settings.Left.Value : area.Left + (area.Width - size.Width) / 2;
            int y = !reset && settings.Top.HasValue ? settings.Top.Value : area.Bottom - size.Height - (int)(38 * scale);
            Bounds = WindowModes.Fit(new Rectangle(new Point(x, y), size), area);
            settings.Left = Left; settings.Top = Top;
        }
        finally { updatingSize = false; }
    }
    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
        string temporary = settingsPath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(settings)); File.Move(temporary, settingsPath, true);
    }
    public void SetDocument(JsonElement p)
    {
        song = p.GetProperty("song").GetString() ?? "";
        title = p.GetProperty("title").GetString() ?? ""; artist = p.GetProperty("artist").GetString() ?? "";
        timed = p.GetProperty("timed").GetBoolean();
        lines = p.GetProperty("lines").EnumerateArray().Take(10000).Select(x => new Line(
            x.GetProperty("time").GetDouble(), x.TryGetProperty("end", out var end) && end.ValueKind == JsonValueKind.Number ? end.GetDouble() : null,
            Clip(x.GetProperty("text").GetString() ?? "", 4000))).Where(x => double.IsFinite(x.Time) && x.Time >= 0).OrderBy(x => x.Time).ToList();
        anchor = 0; advancing = false; clock.Restart(); RefreshDrawing(true);
    }
    public void Sync(JsonElement p)
    {
        if ((p.GetProperty("song").GetString() ?? "") != song) return;
        double time = p.GetProperty("time").GetDouble(); anchor = double.IsFinite(time) ? Math.Max(0, time) : 0;
        duration = p.GetProperty("duration").GetDouble();
        advancing = p.GetProperty("playing").GetBoolean(); clock.Restart(); RefreshDrawing();
    }
    public void SetAccent(JsonElement p)
    {
        var colors = p.GetProperty("rgb").EnumerateArray().Select(x => Math.Clamp(x.GetInt32(), 0, 255)).ToArray();
        if (colors.Length == 3) { accent = Color.FromArgb(colors[0], colors[1], colors[2]); RefreshDrawing(true); }
    }
    internal static (string First, string Second) At(IReadOnlyList<Line> lines, double time, string title, string artist)
    {
        int low = 0, high = lines.Count - 1, latest = -1;
        while (low <= high) { int mid = (low + high) / 2; if (lines[mid].Time <= time) { latest = mid; low = mid + 1; } else high = mid - 1; }
        var active = new List<string>();
        for (int i = 0; i <= latest; i++)
            if (lines[i].End is double end ? time < end : i == latest || lines[i].Time == lines[latest].Time)
                active.AddRange(lines[i].Text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        string next = latest + 1 < lines.Count ? lines[latest + 1].Text.Split('\n')[0] : "";
        return active.Count > 0 ? (active[0], active.Count > 1 ? active[1] : next) : (latest < 0 ? title : "···", next.Length > 0 ? next : artist);
    }
    private static string Clip(string text, int max) => text.Length > max ? text[..max] + "…" : text;
    private void RefreshDrawing(bool force = false)
    {
        if (!Visible || IsDisposed || !IsHandleCreated) return;
        try
        {
            double time = anchor + (advancing ? clock.Elapsed.TotalSeconds : 0);
            if (duration > 0) time = Math.Min(time, duration);
            var text = timed && lines.Count > 0 ? At(lines, time, title, artist) : (title, timed ? artist : "无同步歌词 · 可在播放器导入 LRC / SRT / JSON");
            string key = text.Item1 + "\0" + text.Item2;
            if (!force && key == lastDrawing) return;
            lastDrawing = key; DrawOverlay(Clip(text.Item1, 1000), Clip(text.Item2, 1000));
        }
        catch (Exception ex) { Hide(); settings.Enabled = false; SettingsChanged?.Invoke(); Failed?.Invoke("桌面歌词暂时无法显示：" + ex.Message); }
    }
    private Rectangle LockButton => new(Width - (int)(112 * DpiScale), 0, (int)(64 * DpiScale), (int)(32 * DpiScale));
    private Rectangle HideButton => new(Width - (int)(44 * DpiScale), 0, (int)(40 * DpiScale), (int)(32 * DpiScale));
    private float DpiScale => DeviceDpi / 96f;
    private void DrawOverlay(string first, string second)
    {
        using var bitmap = new Bitmap(Width, Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.Clear(Color.Transparent); g.SmoothingMode = SmoothingMode.AntiAlias;
            if (!settings.Locked)
            {
                using var panel = new SolidBrush(Color.FromArgb(165, 18, 23, 25)); g.FillRectangle(panel, 0, 0, Width, Height);
                using var hintFont = new Font("Microsoft YaHei UI", 10 * DpiScale, GraphicsUnit.Pixel);
                using var ink = new SolidBrush(Color.FromArgb(205, 220, 220));
                g.DrawString("拖动移动 · 锁定后在播放器设置解锁", hintFont, ink, 12 * DpiScale, 9 * DpiScale);
                g.DrawString("锁定", hintFont, ink, LockButton.Left + 10 * DpiScale, 9 * DpiScale);
                g.DrawString("×", hintFont, ink, HideButton.Left + 12 * DpiScale, 9 * DpiScale);
            }
            float fontSize = settings.FontSize * DpiScale, top = 35 * DpiScale;
            DrawText(g, first, new RectangleF(18 * DpiScale, top, Width - 36 * DpiScale, fontSize * 1.45f), fontSize, accent);
            DrawText(g, second, new RectangleF(18 * DpiScale, top + fontSize * 1.5f, Width - 36 * DpiScale, fontSize * 1.2f), fontSize * .8f, Color.FromArgb(232, 240, 242));
        }
        var screen = GetDC(IntPtr.Zero); var memory = CreateCompatibleDC(screen); var hBitmap = bitmap.GetHbitmap(Color.FromArgb(0)); var old = SelectObject(memory, hBitmap);
        try
        {
            var destination = new NativePoint(Left, Top); var source = new NativePoint(0, 0); var size = new NativeSize(Width, Height);
            var blend = new BlendFunction { SourceConstantAlpha = 255, AlphaFormat = 1 };
            if (!UpdateLayeredWindow(Handle, screen, ref destination, ref size, memory, ref source, 0, ref blend, 2)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        finally { SelectObject(memory, old); DeleteObject(hBitmap); DeleteDC(memory); ReleaseDC(IntPtr.Zero, screen); }
    }
    private static void DrawText(Graphics graphics, string text, RectangleF area, float size, Color color)
    {
        using var family = new FontFamily("Microsoft YaHei UI");
        using var path = new GraphicsPath();
        using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        path.AddString(text, family, (int)FontStyle.Bold, size, area, format);
        using var outline = new Pen(Color.FromArgb(230, 10, 14, 18), Math.Max(2, size / 11)) { LineJoin = LineJoin.Round };
        using var fill = new SolidBrush(color); graphics.DrawPath(outline, path); graphics.FillPath(fill, path);
    }
    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e); if (settings.Locked || e.Button != MouseButtons.Left) return;
        if (LockButton.Contains(e.Location)) { settings.Locked = true; UpdateStyles(); PersistInteraction(); RefreshDrawing(true); }
        else if (HideButton.Contains(e.Location)) { settings.Enabled = false; Hide(); PersistInteraction(); }
        else { ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); }
    }
    private void PersistInteraction()
    {
        try { Save(); } catch (Exception ex) { Failed?.Invoke("桌面歌词设置未能保存：" + ex.Message); }
        SettingsChanged?.Invoke();
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x21) { m.Result = new IntPtr(3); return; } // MA_NOACTIVATE
        base.WndProc(ref m);
        if (m.Msg == 0x232) { settings.Left = Left; settings.Top = Top; PersistInteraction(); }
        if (m.Msg == 0x7E && Visible) { ResizeOverlay(false); RefreshDrawing(true); }
    }
    protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
    [StructLayout(LayoutKind.Sequential)] private struct NativePoint(int x, int y) { public int X = x, Y = y; }
    [StructLayout(LayoutKind.Sequential)] private struct NativeSize(int width, int height) { public int Width = width, Height = height; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] private struct BlendFunction { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref NativePoint position, ref NativeSize size, IntPtr src, ref NativePoint origin, int colorKey, ref BlendFunction blend, int flags);
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr h, int message, IntPtr w, IntPtr l);
}
