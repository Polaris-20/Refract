using System.Runtime.InteropServices;

namespace Refract;

/// <summary>System-composited desktop acrylic; no screenshots, capture loop or global window opacity.</summary>
internal static class DesktopGlass
{
    private const int DwmwaSystemBackdropType = 38;
    private const int DwmwaWindowCornerPreference = 33;
    [StructLayout(LayoutKind.Sequential)]
    private struct Margins { public int Left, Right, Top, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct CompositionData { public int Attribute; public IntPtr Data; public nuint Size; }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate int SetCompositionAttribute(IntPtr hwnd, ref CompositionData data);
    private static readonly SetCompositionAttribute? SetComposition = LoadCompositionSetter();
    private static SetCompositionAttribute? LoadCompositionSetter()
    {
        // Retain the system module for the lifetime of its delegate.
        if (!NativeLibrary.TryLoad("user32.dll", out var module)) return null;
        if (NativeLibrary.TryGetExport(module, "SetWindowCompositionAttribute", out var address))
            return Marshal.GetDelegateForFunctionPointer<SetCompositionAttribute>(address);
        NativeLibrary.Free(module);
        return null;
    }
    private static bool ForceActiveAppearance(IntPtr handle, bool enabled)
    {
        if (SetComposition is null) return false;
        var value = Marshal.AllocHGlobal(sizeof(int));
        try
        {
            Marshal.WriteInt32(value, enabled ? 1 : 0);
            // WCA_FORCE_ACTIVEWINDOW_APPEARANCE. Changes appearance only, never input focus.
            var data = new CompositionData { Attribute = 15, Data = value, Size = sizeof(int) };
            return SetComposition(handle, ref data) != 0;
        }
        finally { Marshal.FreeHGlobal(value); }
    }
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref Margins margins);
    public static bool Supported => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22621);
    public static GlassState Apply(Form window, string mode, bool lowEffects, bool active)
    {
        mode = GlassPolicy.Normalize(mode);
        bool highContrast = SystemInformation.HighContrast;
        bool eligible = GlassPolicy.Eligible(mode, lowEffects, Supported, highContrast);
        bool keepRequested = eligible && mode == "always";
        bool keepSupported = ForceActiveAppearance(window.Handle, keepRequested);
        bool keepActive = keepRequested && keepSupported;
        // Keep the material attached while inactive. DWM owns the focus fade;
        // removing the backdrop or transparent surface would cut that animation short.
        bool enabled = eligible;
        int backdrop = enabled ? 3 : 1; // DWMSBT_TRANSIENTWINDOW / DWMSBT_NONE
        int result = Supported ? DwmSetWindowAttribute(window.Handle, DwmwaSystemBackdropType, ref backdrop, sizeof(int)) : unchecked((int)0x80004001);
        bool applied = enabled && result == 0;
        var margins = new Margins { Left = applied ? -1 : 0, Right = applied ? -1 : 0, Top = applied ? -1 : 0, Bottom = applied ? -1 : 0 };
        int frameResult = DwmExtendFrameIntoClientArea(window.Handle, ref margins);
        if (applied && frameResult != 0) { backdrop = 1; DwmSetWindowAttribute(window.Handle, DwmwaSystemBackdropType, ref backdrop, sizeof(int)); applied = false; }
        if (!applied && keepActive) { ForceActiveAppearance(window.Handle, false); keepActive = false; }
        window.BackColor = applied ? Color.Black : Color.FromArgb(17, 20, 22);
        int corners = window.FormBorderStyle == FormBorderStyle.None ? 1 : 2; DwmSetWindowAttribute(window.Handle, DwmwaWindowCornerPreference, ref corners, sizeof(int));
        DwmGetWindowAttribute(window.Handle, DwmwaSystemBackdropType, out int actual, sizeof(int));
        window.Invalidate(true);
        return new GlassState(Supported, applied, mode != "off", mode, active, lowEffects,
            highContrast, keepActive, keepSupported, actual, window.Opacity, result, frameResult);
    }
}

/// <summary>A separate, opt-in QA window to prove that live content behind the player is visible.</summary>
internal sealed class GlassTestBackdrop : Form
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 5000 };
    private bool alternate;
    public GlassTestBackdrop(Rectangle bounds)
    {
        Text = "REFRACT · 独立桌面背景测试"; Bounds = Rectangle.Inflate(bounds, 24, 24);
        DoubleBuffered = true; StartPosition = FormStartPosition.Manual;
        timer.Tick += (_, _) => { alternate = !alternate; Invalidate(); }; timer.Start();
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var left = new SolidBrush(alternate ? Color.FromArgb(25, 190, 206) : Color.FromArgb(245, 58, 111));
        using var right = new SolidBrush(alternate ? Color.FromArgb(245, 166, 46) : Color.FromArgb(28, 101, 235));
        e.Graphics.FillRectangle(left, 0, 0, ClientSize.Width / 2, ClientSize.Height);
        e.Graphics.FillRectangle(right, ClientSize.Width / 2, 0, ClientSize.Width, ClientSize.Height);
        using var pen = new Pen(Color.White, 18);
        e.Graphics.DrawEllipse(pen, ClientSize.Width / 4, ClientSize.Height / 4, ClientSize.Width / 2, ClientSize.Height / 2);
    }
    protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
}
