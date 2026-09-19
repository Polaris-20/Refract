using System.Text;
using System.Text.RegularExpressions;

namespace Refract;

public static class LyricsStore
{
    public static void Import(MusicLibrary library, Track track, string path)
    {
        var candidate = Read(path);
        Save(library, track, candidate.text, candidate.name);
    }

    public static (string text, string name) Read(string path)
    {
        var extension = Path.GetExtension(path).ToLowerInvariant();
        if (extension is not (".lrc" or ".txt" or ".json" or ".srt")) throw new Exception("请选择 LRC、TXT、JSON 或 SRT 歌词文件。");
        using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length > 512 * 1024) throw new Exception("歌词文件请小于 512 KB。");
        using var memory = new MemoryStream(); input.CopyTo(memory);
        var text = Decode(memory.ToArray()).TrimStart('\uFEFF').Replace("\r\n", "\n").Replace('\r', '\n');
        if (text.Contains('\0')) throw new Exception("文件不是可读取的文本歌词。");
        if (text.Split('\n').Length > 10000) throw new Exception("歌词请控制在 10000 行以内。");
        var content = extension == ".lrc" ? Regex.Replace(text, @"\[[a-zA-Z]+:[^\]\r\n]*\]|\[\d+:\d{2}(?:\.\d+)?\]", "") : text;
        if (string.IsNullOrWhiteSpace(content)) throw new Exception("这个文件没有歌词正文，请选择其他文件。");
        return (text, Path.GetFileName(path));
    }

    // Caller validates format before committing, so failed imports retain previous lyrics.
    public static void Save(MusicLibrary library, Track track, string text, string name)
    {
        var old = (track.LyricsText, track.LyricsName, track.LyricsRevision);
        track.LyricsText = text; track.LyricsName = name; track.LyricsRevision = Guid.NewGuid().ToString("N");
        try { library.Save(); }
        catch { (track.LyricsText, track.LyricsName, track.LyricsRevision) = old; throw; }
    }

    public static string Decode(byte[] bytes)
    {
        // Prefer strict UTF-8; legacy Chinese LRC files commonly use GBK/GB18030.
        if (bytes.AsSpan().StartsWith(new byte[] { 0xFF, 0xFE, 0, 0 })) return new UTF32Encoding(false, true, true).GetString(bytes, 4, bytes.Length - 4);
        if (bytes.AsSpan().StartsWith(new byte[] { 0, 0, 0xFE, 0xFF })) return new UTF32Encoding(true, true, true).GetString(bytes, 4, bytes.Length - 4);
        if (bytes.AsSpan().StartsWith(new byte[] { 0xFF, 0xFE })) return new UnicodeEncoding(false, true, true).GetString(bytes, 2, bytes.Length - 2);
        if (bytes.AsSpan().StartsWith(new byte[] { 0xFE, 0xFF })) return new UnicodeEncoding(true, true, true).GetString(bytes, 2, bytes.Length - 2);
        try { return new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException)
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            try { return Encoding.GetEncoding(54936, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback).GetString(bytes); }
            catch (DecoderFallbackException) { throw new Exception("无法识别歌词编码，请另存为 UTF-8 后导入。"); }
        }
    }
}
