namespace Refract;

internal static class GlassPolicy
{
    public static string Normalize(string? mode) => mode is "off" or "focused" or "always" ? mode : "focused";
    public static bool Eligible(string mode, bool lowEffects, bool supported, bool highContrast) =>
        Normalize(mode) != "off" && !lowEffects && supported && !highContrast;
}

internal sealed record GlassState(bool Supported, bool Enabled, bool Requested, string Mode,
    bool Active, bool LowEffects, bool HighContrast, bool KeepActive, bool KeepSupported,
    int Backdrop, double WindowOpacity, int Hresult, int FrameResult)
{
    public long Revision { get; init; }
}
