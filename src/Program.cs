using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Refract;

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (args.Length == 2 && args[0] == "--prepare-demo") { SelfTest.PrepareDemo(args[1]); return; }
        var dataArg = Array.IndexOf(args, "--data-dir");
        string root = dataArg >= 0 && dataArg + 1 < args.Length ? args[dataArg + 1] : File.Exists(Path.Combine(AppContext.BaseDirectory, "portable.flag")) ? Path.Combine(AppContext.BaseDirectory, "data") : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Refract");
        if (args.Contains("--self-test")) { Environment.ExitCode = SelfTest.Run(root); return; }
        using var singleton = new Mutex(true, "Local\\Refract-" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Path.GetFullPath(root))))[..20], out bool first);
        if (!first) { MessageBox.Show("折光已在运行。请切换到已有窗口。", "折光"); return; }
        try { Application.Run(new PlayerWindow(root, args.Contains("--ui-test") || File.Exists(Path.Combine(AppContext.BaseDirectory, "ui-test.flag")))); }
        catch (Exception e) { MessageBox.Show("无法启动折光。请确认已安装 .NET 10 Desktop Runtime 和 Microsoft Edge WebView2 Runtime。\n\n" + e.Message, "折光"); }
    }
}
public sealed class PlayerWindow : Form
{
    private readonly WebView2 view = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
    private readonly MusicLibrary library;
    private readonly bool uiTest;
    private bool busy;
    private readonly WindowModes windowModes;
    private readonly DesktopLyrics desktopLyrics;
    private string glassMode = "focused";
    private bool glassLowEffects, glassFocused, refreshingGlass, glassRefreshQueued;
    private GlassState? glassState;
    private long glassRevision;
    private GlassTestBackdrop? glassTestBackdrop;
    private const string Origin = "https://app.refract.local";
    private const string Cors = "Access-Control-Allow-Origin: https://app.refract.local\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\n";
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    public PlayerWindow(string root, bool test)
    {
        library = new MusicLibrary(root); uiTest = test;
        desktopLyrics = new DesktopLyrics(root);
        desktopLyrics.SettingsChanged += () => PushDesktopLyrics();
        desktopLyrics.Failed += message => PushDesktopLyrics(message);
        windowModes = new WindowModes(this, RefreshGlass);
        Activated += (_, _) => UpdateGlassFocus(true);
        Deactivate += (_, _) => UpdateGlassFocus(false);
        Text = "折光 · REFRACT"; ClientSize = new Size(1360, 870); MinimumSize = new Size(1040, 700);
        StartPosition = FormStartPosition.CenterScreen; BackColor = Color.FromArgb(17, 20, 22);
        FormBorderStyle = FormBorderStyle.Sizable; Controls.Add(view);
        if (File.Exists(Path.Combine(AppContext.BaseDirectory, "web", "assets", "refract.ico"))) Icon = new Icon(Path.Combine(AppContext.BaseDirectory, "web", "assets", "refract.ico"));
        HandleCreated += (_, _) => { int dark = 1; DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)); RefreshGlass(); };
        Shown += async (_, _) =>
        {
            var screen = Screen.FromControl(this).WorkingArea; float scale = DeviceDpi / 96f;
            MinimumSize = new Size(Math.Min((int)(1000 * scale), screen.Width - 30), Math.Min((int)(660 * scale), screen.Height - 30));
            ClientSize = new Size(Math.Min((int)(1280 * scale), screen.Width - 80), Math.Min((int)(820 * scale), screen.Height - 100));
            CenterToScreen();
            if (File.Exists(Path.Combine(AppContext.BaseDirectory, "glass-test.flag")))
            {
                glassTestBackdrop = new GlassTestBackdrop(Bounds); glassTestBackdrop.Show(); Activate();
            }
            RefreshGlass(); await Initialize();
        };
        FormClosed += (_, _) => { desktopLyrics.Dispose(); glassTestBackdrop?.Dispose(); };
    }
    protected override void WndProc(ref Message m)
    {
        // Keep the non-client frame visually active without changing WM_ACTIVATE or foreground ownership.
        if (m.Msg == 0x86 && glassState?.KeepActive == true) m.WParam = new IntPtr(1); // WM_NCACTIVATE
        base.WndProc(ref m);
        if (m.Msg is 0x31A or 0x320 or 0x1A) QueueGlassRefresh(); // theme, DWM, system settings
    }
    private void UpdateGlassFocus(bool active)
    {
        glassFocused = active;
        if (glassState is null || IsDisposed || Disposing) return;
        // Focus notifications update the status only; never reset the DWM material,
        // frame margins or WebView transparency during the system's transition.
        glassState = glassState with { Active = active, Revision = ++glassRevision };
        PushGlassState();
    }
    private void PushGlassState()
    {
        if (!IsDisposed && !Disposing && view.CoreWebView2 is not null)
            view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { eventName = "glass", data = glassState }, MusicLibrary.Json));
    }
    private void QueueGlassRefresh()
    {
        if (glassRefreshQueued || IsDisposed || Disposing || !IsHandleCreated) return;
        glassRefreshQueued = true;
        BeginInvoke((Action)(() => { glassRefreshQueued = false; RefreshGlass(); }));
    }
    private void RefreshGlass()
    {
        if (refreshingGlass || IsDisposed || Disposing || !IsHandleCreated) return;
        refreshingGlass = true;
        try
        {
            bool keptActive = glassState?.KeepActive == true;
            glassState = DesktopGlass.Apply(this, glassMode, glassLowEffects, glassFocused) with { Revision = ++glassRevision };
            if (keptActive != glassState.KeepActive)
                SendMessage(Handle, 0x86, glassState.KeepActive || glassFocused ? 1 : 0, 0);
            PushGlassState();
        }
        finally { refreshingGlass = false; }
    }
    private async Task Initialize()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(library.Root, "webview"));
            await view.EnsureCoreWebView2Async(env);
            var core = view.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = uiTest;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            desktopLyrics.RestoreVisibility();
            core.SetVirtualHostNameToFolderMapping("app.refract.local", Path.Combine(AppContext.BaseDirectory, "web"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith(Origin + "/", StringComparison.Ordinal)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.AddWebResourceRequestedFilter("https://media.refract.local/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += ServeMedia;
            core.WebMessageReceived += HandleMessage;
            core.NavigationCompleted += async (_, _) => { if (uiTest) await RunUiTest(); };
            core.Navigate(Origin + "/index.html");
        }
        catch (Exception e) { MessageBox.Show(this, "界面启动失败：" + e.Message, "折光"); Close(); }
    }
    private void ServeMedia(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            if (e.Request.Method == "OPTIONS") { e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, 204, "No Content", Cors); return; }
            if (e.Request.Method != "GET" && e.Request.Method != "HEAD") { e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, 405, "Method Not Allowed", Cors); return; }
            var uri = new Uri(e.Request.Uri); var parts = uri.AbsolutePath.Trim('/').Split('/');
            if (parts.Length != 2) throw new Exception();
            var t = library.Get(parts[1]); bool cover = parts[0] == "cover";
            if (!cover && parts[0] != "audio") throw new Exception();
            var file = cover ? Path.Combine(library.Root, t.Cover) : t.Path;
            if (!File.Exists(file) || (cover && t.Cover.Length == 0)) throw new Exception();
            var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            long size = stream.Length, start = 0, end = size - 1; int code = 200;
            string type = cover ? "image/png" : t.Format switch { "MP3" => "audio/mpeg", "FLAC" => "audio/flac", "WAV" => "audio/wav", "M4A" => "audio/mp4", "OGG" or "OPUS" => "audio/ogg", "AAC" => "audio/aac", _ => "application/octet-stream" };
            string headers = $"Content-Type: {type}\r\n{Cors}Accept-Ranges: bytes\r\nCache-Control: no-cache\r\n";
            if (e.Request.Headers.Contains("Range"))
            {
                var range = e.Request.Headers.GetHeader("Range");
                var match = System.Text.RegularExpressions.Regex.Match(range, @"^bytes=(\d*)-(\d*)$");
                if (!match.Success || (match.Groups[1].Value == "" && match.Groups[2].Value == "")) { stream.Dispose(); e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, 416, "Range Not Satisfiable", $"{Cors}Content-Range: bytes */{size}"); return; }
                if (match.Groups[1].Value == "") { start = Math.Max(0, size - long.Parse(match.Groups[2].Value)); }
                else { start = long.Parse(match.Groups[1].Value); if (match.Groups[2].Value != "") end = Math.Min(end, long.Parse(match.Groups[2].Value)); }
                if (start > end || start >= size) { stream.Dispose(); e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, 416, "Range Not Satisfiable", $"{Cors}Content-Range: bytes */{size}"); return; }
                code = 206; headers += $"Content-Range: bytes {start}-{end}/{size}\r\n";
            }
            if (e.Request.Method == "HEAD") { stream.Dispose(); e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, code, "OK", headers + $"Content-Length: {end - start + 1}\r\n"); return; }
            var body = new SegmentStream(stream, start, end - start + 1);
            e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(body, code, code == 206 ? "Partial Content" : "OK", headers + $"Content-Length: {end - start + 1}\r\n");
        }
        catch { e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Not Found", Cors); }
    }
    private void PushDesktopLyrics(string? error = null)
    {
        if (!IsDisposed && view.CoreWebView2 is not null)
            view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { eventName = "desktopLyrics", data = desktopLyrics.Snapshot(), error }, MusicLibrary.Json));
    }
    private void Reply(string id, object? data = null, string? error = null) => view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, data, error }, MusicLibrary.Json));
    private async void HandleMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith(Origin + "/", StringComparison.Ordinal)) return;
        string id = "";
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson); var m = doc.RootElement;
            id = m.GetProperty("id").GetString() ?? ""; string cmd = m.GetProperty("cmd").GetString() ?? "";
            var p = m.TryGetProperty("payload", out var payload) ? payload : default;
            if (busy && cmd != "window" && cmd != "glass" && !cmd.StartsWith("desktopLyrics", StringComparison.Ordinal)) throw new Exception("正在导入文件，请稍等。");
            switch (cmd)
            {
                case "init": Reply(id, new { library = library.Snapshot(), warning = library.StartupWarning, version = "0.9.1", glass = glassState, window = windowModes.Snapshot(), desktopLyrics = desktopLyrics.Snapshot() }); break;
                case "desktopLyrics": Reply(id, desktopLyrics.Configure(p)); break;
                case "desktopLyricsDocument": desktopLyrics.SetDocument(p); Reply(id, new { }); break;
                case "desktopLyricsSync": desktopLyrics.Sync(p); Reply(id, new { }); break;
                case "desktopLyricsAccent": desktopLyrics.SetAccent(p); Reply(id, new { }); break;
                case "glass":
                    glassMode = GlassPolicy.Normalize(p.GetProperty("mode").GetString());
                    glassLowEffects = p.TryGetProperty("lowEffects", out var low) && low.GetBoolean();
                    RefreshGlass();
                    Reply(id, glassState); break;
                case "importFiles":
                    using (var dialog = new OpenFileDialog { Multiselect = true, Filter = "音乐文件|*.mp3;*.flac;*.wav;*.m4a;*.ogg;*.opus;*.aac;*.aif;*.aiff;*.wma", Title = "把喜欢的音乐带进来" })
                    { if (dialog.ShowDialog(this) != DialogResult.OK) { Reply(id, new { canceled = true }); break; } await Import(id, dialog.FileNames); }
                    break;
                case "importFolder":
                    using (var dialog = new FolderBrowserDialog { Description = "选择音乐文件夹（包含子文件夹）", UseDescriptionForTitle = true })
                    { if (dialog.ShowDialog(this) != DialogResult.OK) { Reply(id, new { canceled = true }); break; } var folder = dialog.SelectedPath; await Import(id, Directory.EnumerateFiles(folder, "*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint }).Where(f => MusicLibrary.Extensions.Contains(Path.GetExtension(f)))); }
                    break;
                case "importDrop": await Import(id, e.AdditionalObjects.OfType<CoreWebView2File>().Select(f => f.Path).ToArray()); break;
                case "demo": await Import(id, Directory.EnumerateFiles(Path.Combine(AppContext.BaseDirectory, "web", "assets", "demo"), "*.wav")); break;
                case "testFormats" when uiTest:
                    var fixtures = Path.Combine(AppContext.BaseDirectory, "test-fixtures");
                    if (!Directory.Exists(fixtures)) { Reply(id, new { library = library.Snapshot(), imported = 0 }); break; }
                    await Import(id, Directory.EnumerateFiles(fixtures)); break;
                case "testCapture" when uiTest:
                    var shot = p.GetProperty("name").GetString();
                    if (shot is not ("editor" or "mini" or "immersive" or "lyrics")) throw new Exception("Unknown test capture.");
                    using (var screenshot = File.Create(Path.Combine(library.Root, shot + ".png")))
                        await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
                    Reply(id, new { captured = true }); break;
                case "edit":
                    var track = library.Get(p.GetProperty("trackId").GetString()!);
                    var title = ReadText(p, "title", true); var artist = ReadText(p, "artist"); var album = ReadText(p, "album"); var genre = ReadText(p, "genre");
                    var year = p.GetProperty("year").GetUInt32(); var number = p.GetProperty("number").GetUInt32();
                    if (year > 9999 || number > 9999) throw new Exception("年份和曲号应在 0–9999 之间。");
                    track.Title = title; track.Artist = artist; track.Album = album; track.Genre = genre; track.Year = year; track.Number = number;
                    track.Edited = true; library.Save(); Reply(id, library.Snapshot()); break;
                case "cover":
                    var coverTrack = library.Get(p.GetProperty("trackId").GetString()!);
                    using (var dialog = new OpenFileDialog { Filter = "图片|*.png;*.jpg;*.jpeg;*.bmp", Title = "选择专辑封面" })
                    { if (dialog.ShowDialog(this) != DialogResult.OK) { Reply(id, new { canceled = true }); break; } coverTrack.Cover = library.StoreCover(File.ReadAllBytes(dialog.FileName)); coverTrack.Edited = true; library.Save(); Reply(id, library.Snapshot()); }
                    break;
                case "getLyrics":
                    var lyricsTrack = library.Get(p.GetProperty("trackId").GetString()!);
                    Reply(id, new { text = lyricsTrack.LyricsText, name = lyricsTrack.LyricsName }); break;
                case "importLyrics":
                    var target = library.Get(p.GetProperty("trackId").GetString()!);
                    using (var dialog = new OpenFileDialog { Filter = "歌词文件|*.lrc;*.txt;*.json;*.srt|LRC 时间轴歌词|*.lrc|SRT 字幕歌词|*.srt|JSON 歌词|*.json|TXT 纯文本歌词|*.txt", Title = "为「" + target.Title + "」导入歌词" })
                    { if (dialog.ShowDialog(this) != DialogResult.OK) { Reply(id, new { canceled = true }); break; } await ImportLyrics(target, dialog.FileName); Reply(id, library.Snapshot()); }
                    break;
                case "importLyricsDrop":
                    var dropTarget = library.Get(p.GetProperty("trackId").GetString()!);
                    var droppedLyrics = e.AdditionalObjects.OfType<CoreWebView2File>().ToArray();
                    if (droppedLyrics.Length != 1 || e.AdditionalObjects.Count != 1) throw new Exception("一次请拖入一个歌词文件。");
                    await ImportLyrics(dropTarget, droppedLyrics[0].Path);
                    Reply(id, library.Snapshot()); break;
                case "testLyrics" when uiTest:
                    var lyricKind = p.GetProperty("kind").GetString();
                    if (lyricKind is not ("timed" or "plain")) throw new Exception("Unknown lyrics fixture.");
                    var lyricFile = Path.Combine(library.Root, lyricKind == "timed" ? "original-test.lrc" : "original-test.txt");
                    File.WriteAllText(lyricFile, lyricKind == "timed" ? "[ti:折光测试]\n[offset:500]\n[00:01.00]风从窗边经过\n[00:04.00]把夜色留给声音\n[00:04.00]Leave the night to sound\n[00:07.00]<b>文字不会执行</b>\n[00:10.00]沿着微光向前\n[00:13.00]直到城市安静\n[00:16.00]让回声慢慢散开\n[00:19.00]我们在此停留\n[00:22.00]明天再见" : "窗外的风\n[00:04.00]TXT 保留原文\n这是没有时间轴的文字");
                    await ImportLyrics(library.Get(p.GetProperty("trackId").GetString()!), lyricFile);
                    Reply(id, library.Snapshot()); break;
                case "favorite": var favorite = library.Get(p.GetProperty("trackId").GetString()!); favorite.Favorite = !favorite.Favorite; library.Save(); Reply(id, library.Snapshot()); break;
                case "remove":
                    var removed = library.Get(p.GetProperty("trackId").GetString()!); library.Data.Tracks.Remove(removed);
                    foreach (var list in library.Data.Playlists) list.TrackIds.Remove(removed.Id);
                    library.Save(); Reply(id, library.Snapshot()); break;
                case "createPlaylist": library.Data.Playlists.Add(new Playlist { Name = ReadText(p, "name", true) }); library.Save(); Reply(id, library.Snapshot()); break;
                case "playlistTrack":
                    var playlist = library.Data.Playlists.FirstOrDefault(l => l.Id == p.GetProperty("playlistId").GetString()) ?? throw new Exception("找不到歌单。");
                    var tid = library.Get(p.GetProperty("trackId").GetString()!).Id;
                    if (p.GetProperty("remove").GetBoolean()) playlist.TrackIds.Remove(tid); else if (!playlist.TrackIds.Contains(tid)) playlist.TrackIds.Add(tid);
                    library.Save(); Reply(id, library.Snapshot()); break;
                case "writeTags":
                    var writable = library.Get(p.GetProperty("trackId").GetString()!);
                    if (MessageBox.Show(this, "将曲库中的标题、歌手、专辑、年份、曲号、流派和封面写入：\n\n" + writable.Path + "\n\n原文件会在同一文件夹备份为 .refract-时间.bak。是否继续？", "写回音乐文件", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) { Reply(id, new { canceled = true }); break; }
                    var backup = library.WriteTags(writable); Reply(id, new { library = library.Snapshot(), backup }); break;
                case "window":
                    switch (p.GetProperty("action").GetString())
                    {
                        case "minimize": WindowState = FormWindowState.Minimized; break;
                        case "maximize": WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
                        case "close": Close(); return;
                        case "drag": ReleaseCapture(); SendMessage(Handle, 0xA1, 2, 0); break;
                        case "mode":
                            await windowModes.Change(p.GetProperty("mode").GetString()!, p.TryGetProperty("animate", out var animation) && animation.GetBoolean()); break;
                        case "mini":
                            await windowModes.Change(windowModes.Mode == "mini" ? "normal" : "mini", false); break;
                    }
                    Reply(id, windowModes.Snapshot()); break;
                default: throw new Exception("未知操作。");
            }
        }
        catch (Exception ex) { if (!IsDisposed) Reply(id, null, ex.Message); }
    }
    private async Task ImportLyrics(Track target, string path)
    {
        busy = true;
        try
        {
            var candidate = LyricsStore.Read(path);
            // Use the display parser to validate before committing any library changes.
            // JSON serialization protects filenames and lyrics from script interpolation.
            var script = "(() => { try { const parsed = RefractLyrics.parse(" + JsonSerializer.Serialize(candidate.text) + "," + JsonSerializer.Serialize(candidate.name) + "); if (!parsed.lines.some(line => line.text.trim())) return {error:'没有找到歌词正文。'}; return {ok:true}; } catch(e) { return {error:e.message}; } })()";
            using var validation = JsonDocument.Parse(await view.CoreWebView2.ExecuteScriptAsync(script));
            if (validation.RootElement.ValueKind != JsonValueKind.Object) throw new Exception("歌词解析器未就绪，请重新打开播放器后再试。");
            if (validation.RootElement.TryGetProperty("error", out var error)) throw new Exception(error.GetString());
            if (!validation.RootElement.TryGetProperty("ok", out var ok) || !ok.GetBoolean()) throw new Exception("未能验证歌词格式。");
            LyricsStore.Save(library, library.Get(target.Id), candidate.text, candidate.name);
        }
        finally { busy = false; }
    }
    private static string ReadText(JsonElement p, string key, bool required = false)
    {
        var value = (p.GetProperty(key).GetString() ?? "").Trim();
        if (value.Length > 500) throw new Exception("文字请控制在 500 字以内。");
        if (required && value.Length == 0) throw new Exception("名称不能为空。"); return value;
    }
    private async Task Import(string id, IEnumerable<string> files)
    {
        busy = true;
        try { var result = await Task.Run(() => library.Import(ExpandPaths(files))); Reply(id, new { library = library.Snapshot(), imported = result.imported, skipped = result.skipped, errors = result.errors }); }
        finally { busy = false; }
    }
    private static IEnumerable<string> ExpandPaths(IEnumerable<string> paths)
    {
        foreach (var path in paths)
        {
            if (Directory.Exists(path))
            {
                foreach (var file in Directory.EnumerateFiles(path, "*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint }))
                    if (MusicLibrary.Extensions.Contains(Path.GetExtension(file))) yield return file;
            }
            else yield return path;
        }
    }
    private async Task RunUiTest()
    {
        try
        {
            var result = await view.CoreWebView2.ExecuteScriptAsync("window.runNativeTests ? window.runNativeTests() : 'missing test entry'");
            // ExecuteScriptAsync cannot await a JavaScript promise; the test page posts its result to a separate DOM field.
            for (int i = 0; i < 100; i++)
            {
                await Task.Delay(200);
                result = await view.CoreWebView2.ExecuteScriptAsync("window.nativeTestResult || null");
                if (result != "null") break;
            }
            File.WriteAllText(Path.Combine(library.Root, "ui-test.json"), result);
            using var screenshot = File.Create(Path.Combine(library.Root, "ui-test.png"));
            await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
        }
        catch (Exception e) { File.WriteAllText(Path.Combine(library.Root, "ui-test-error.txt"), e.ToString()); }
    }
}
public sealed class SegmentStream : Stream
{
    private readonly Stream source; private readonly long start; private readonly long length; private long position;
    public SegmentStream(Stream source, long start, long length) { this.source = source; this.start = start; this.length = length; source.Position = start; }
    public override bool CanRead => true; public override bool CanSeek => true; public override bool CanWrite => false;
    public override long Length => length; public override long Position { get => position; set => Seek(value, SeekOrigin.Begin); }
    public override int Read(byte[] buffer, int offset, int count) { int n = source.Read(buffer, offset, (int)Math.Min(count, length - position)); position += n; return n; }
    public override long Seek(long offset, SeekOrigin origin) { long next = origin switch { SeekOrigin.Begin => offset, SeekOrigin.Current => position + offset, _ => length + offset }; if (next < 0 || next > length) throw new IOException(); source.Position = start + next; return position = next; }
    public override void Flush() { } public override void SetLength(long value) => throw new NotSupportedException(); public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    protected override void Dispose(bool disposing) { if (disposing) source.Dispose(); base.Dispose(disposing); }
}
