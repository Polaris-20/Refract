using System.Diagnostics;

namespace Refract;

internal sealed class WindowModes
{
    private readonly Form window;
    private readonly Action refreshGlass;
    private readonly SemaphoreSlim gate = new(1, 1);
    private Placement? normal, small;
    public string Mode { get; private set; } = "normal";
    private sealed record Placement(Rectangle Bounds, Size Minimum, FormBorderStyle Border, FormWindowState State, bool TopMost);

    public WindowModes(Form window, Action refreshGlass)
    {
        this.window = window; this.refreshGlass = refreshGlass;
        // Fullscreen covers the taskbar while active, but does not trap Alt+Tab behind it.
        window.Activated += (_, _) => { if (Mode == "immersive") window.TopMost = true; };
        window.Deactivate += (_, _) => { if (Mode == "immersive") window.TopMost = false; };
    }
    public object Snapshot() => new { mode = Mode, mini = Mode == "mini", immersive = Mode == "immersive" };
    private Placement Capture() => new(window.WindowState == FormWindowState.Normal ? window.Bounds : window.RestoreBounds,
        window.MinimumSize, window.FormBorderStyle, window.WindowState == FormWindowState.Maximized ? FormWindowState.Maximized : FormWindowState.Normal, window.TopMost);

    public async Task Change(string target, bool animate)
    {
        if (target is not ("normal" or "mini" or "immersive")) throw new Exception("未知窗口模式。");
        await gate.WaitAsync();
        var previous = Capture();
        var previousMode = Mode;
        try
        {
            if (target == Mode || window.IsDisposed) return;
            if (Mode == "normal") normal = Capture();
            if (Mode == "mini") small = Capture();
            var screen = Screen.FromControl(window);
            var saved = target == "normal" ? normal : target == "mini" ? small : null;
            var start = window.Bounds;
            window.MinimumSize = Size.Empty;
            window.WindowState = FormWindowState.Normal;
            Mode = target;
            window.FormBorderStyle = target == "immersive" ? FormBorderStyle.None : saved?.Border ?? FormBorderStyle.Sizable;
            window.TopMost = target == "immersive" || target == "mini" || (saved?.TopMost ?? false);
            window.Bounds = start;

            Rectangle finish;
            if (target == "immersive") finish = screen.Bounds; // Bounds includes the taskbar; WorkingArea does not.
            else if (saved is not null)
            {
                var area = Screen.FromRectangle(saved.Bounds).WorkingArea;
                finish = saved.State == FormWindowState.Maximized ? area : Fit(saved.Bounds, area);
            }
            else
            {
                float scale = window.DeviceDpi / 96f;
                var size = new Size((int)(640 * scale), (int)(240 * scale));
                finish = Fit(new Rectangle(start.Left, start.Bottom - size.Height, size.Width, size.Height), screen.WorkingArea);
            }
            refreshGlass();
            await AnimateBounds(start, finish, animate && SystemInformation.IsMinimizeRestoreAnimationEnabled);
            if (window.IsDisposed) return;
            if (target != "immersive")
            {
                var area = Screen.FromRectangle(finish).WorkingArea;
                float scale = window.DeviceDpi / 96f;
                var minimum = saved?.Minimum ?? new Size((int)(520 * scale), (int)(200 * scale));
                window.MinimumSize = new Size(Math.Min(minimum.Width, area.Width), Math.Min(minimum.Height, area.Height));
                window.Bounds = finish;
                if (saved?.State == FormWindowState.Maximized)
                {
                    // Preserve the normal restore rectangle when returning to a maximized window.
                    window.Bounds = Fit(saved.Bounds, area);
                    window.WindowState = FormWindowState.Maximized;
                }
            }
            refreshGlass();
        }
        catch
        {
            Mode = previousMode;
            if (!window.IsDisposed)
            {
                window.MinimumSize = Size.Empty;
                window.WindowState = FormWindowState.Normal;
                window.FormBorderStyle = previous.Border;
                window.Bounds = previous.Bounds;
                window.MinimumSize = previous.Minimum;
                window.TopMost = previous.TopMost;
                window.WindowState = previous.State;
                refreshGlass();
            }
            throw;
        }
        finally { gate.Release(); }
    }
    private async Task AnimateBounds(Rectangle start, Rectangle finish, bool animate)
    {
        if (!animate) { window.Bounds = finish; return; }
        var clock = Stopwatch.StartNew();
        while (!window.IsDisposed && clock.ElapsedMilliseconds < 260)
        {
            double t = Math.Clamp(clock.Elapsed.TotalMilliseconds / 260, 0, 1);
            double eased = 1 - Math.Pow(1 - t, 3);
            int Mix(int a, int b) => (int)Math.Round(a + (b - a) * eased);
            window.Bounds = new Rectangle(Mix(start.X, finish.X), Mix(start.Y, finish.Y), Mix(start.Width, finish.Width), Mix(start.Height, finish.Height));
            await Task.Delay(15);
        }
        if (!window.IsDisposed) window.Bounds = finish;
    }
    internal static Rectangle Fit(Rectangle desired, Rectangle area)
    {
        int width = Math.Min(Math.Max(desired.Width, 1), area.Width), height = Math.Min(Math.Max(desired.Height, 1), area.Height);
        return new Rectangle(Math.Clamp(desired.X, area.Left, area.Right - width), Math.Clamp(desired.Y, area.Top, area.Bottom - height), width, height);
    }
}
