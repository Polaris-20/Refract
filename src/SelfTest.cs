using System.Text.Json;
namespace Refract;
public static class SelfTest
{
    public static int Run(string root)
    {
        Directory.CreateDirectory(root);
        var results = new List<object>();
        void Check(string name, bool passed) { results.Add(new { name, passed }); if (!passed) throw new Exception(name); }
        try
        {
            var lib = new MusicLibrary(Path.Combine(root, "test-library-" + Guid.NewGuid().ToString("N")));
            var sample = Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "web", "assets", "demo"), "*.wav")[0];
            var copy = Path.Combine(lib.Root, "test-copy.wav"); System.IO.File.Copy(sample, copy);
            var beforeHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.IO.File.ReadAllBytes(copy)));
            var imported = lib.Import([copy]); Check("imports WAV metadata", imported.imported == 1 && lib.Data.Tracks[0].Duration > 15);
            var duplicate = lib.Import([copy]); Check("deduplicates file paths", duplicate.imported == 0 && duplicate.skipped == 1);
            var t = lib.Data.Tracks[0]; t.Title = "中文标题 <test>"; t.Artist = "REFRACT TEST"; t.Year = 2026; t.Album = "测试专辑"; t.Edited = true; lib.Save();
            Check("library edits leave source untouched", beforeHash == Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.IO.File.ReadAllBytes(copy))));
            var reload = new MusicLibrary(lib.Root); Check("metadata persists after reopening library", reload.Data.Tracks[0].Title == "中文标题 <test>");
            var lyricsFile = Path.Combine(lib.Root, "中文.lrc");
            System.IO.File.WriteAllText(lyricsFile, "[00:01.00]风经过窗边\n[00:04.00]灯光留在纸上", new System.Text.UTF8Encoding(true));
            LyricsStore.Import(lib, t, lyricsFile);
            Check("UTF8 BOM lyrics imported", t.LyricsText.StartsWith("[00:01.00]风") && t.LyricsName == "中文.lrc");
            System.IO.File.Delete(lyricsFile);
            Check("lyrics survive original removal and library reopen", new MusicLibrary(lib.Root).Get(t.Id).LyricsText == t.LyricsText);
            var snapshot = JsonSerializer.Serialize(lib.Snapshot(), MusicLibrary.Json);
            Check("library snapshot excludes lyrics body", !snapshot.Contains("lyricsText") && snapshot.Contains("hasLyrics"));
            System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
            System.IO.File.WriteAllBytes(lyricsFile, System.Text.Encoding.GetEncoding(54936).GetBytes("[00:01.00]中文旧编码歌词"));
            LyricsStore.Import(lib, t, lyricsFile); Check("GB18030 lyrics decode", t.LyricsText.Contains("中文旧编码歌词"));
            System.IO.File.WriteAllText(lyricsFile, "[00:02.00]另一种中文编码", System.Text.Encoding.Unicode);
            LyricsStore.Import(lib, t, lyricsFile); Check("UTF16 BOM lyrics decode", t.LyricsText.Contains("另一种中文编码"));
            var revision = t.LyricsRevision; System.IO.File.WriteAllText(lyricsFile, "[ti:空文件]\n[00:01.00]");
            bool emptyRejected = false; try { LyricsStore.Import(lib, t, lyricsFile); } catch { emptyRejected = true; }
            Check("empty import preserves existing lyrics", emptyRejected && t.LyricsRevision == revision);
            System.IO.File.WriteAllBytes(lyricsFile, new byte[512 * 1024 + 1]);
            bool oversizedRejected = false; try { LyricsStore.Import(lib, t, lyricsFile); } catch { oversizedRejected = true; }
            Check("oversized import preserves existing lyrics", oversizedRejected && t.LyricsRevision == revision);
            Check("lyrics import leaves source music untouched", beforeHash == Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.IO.File.ReadAllBytes(copy))));
            var backup = lib.WriteTags(t); Check("writeback creates byte-exact original backup", beforeHash == Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.IO.File.ReadAllBytes(backup))));
            using (var tagged = TagLib.File.Create(copy)) { Check("written metadata readable from source", tagged.Tag.Title == t.Title && tagged.Tag.Performers[0] == t.Artist && tagged.Tag.Year == 2026); Check("writeback preserves duration", Math.Abs(tagged.Properties.Duration.TotalSeconds - t.Duration) < .1); }
            var invalid = Path.Combine(lib.Root, "broken.mp3"); System.IO.File.WriteAllText(invalid, "invalid"); var mixed = lib.Import([invalid]); Check("corrupt music reports per-file error", mixed.errors.Count == 1 && mixed.imported == 0);
            using (var stream = new SegmentStream(new MemoryStream(Enumerable.Range(0, 100).Select(n => (byte)n).ToArray()), 20, 12)) { var b = new byte[30]; Check("range stream respects bounds", stream.Read(b, 0, b.Length) == 12 && b[0] == 20 && b[11] == 31 && stream.Read(b, 0, 1) == 0); stream.Seek(-2, SeekOrigin.End); Check("range stream can seek", stream.ReadByte() == 30); }
            var corruptRoot = Path.Combine(lib.Root, "corrupt-store"); Directory.CreateDirectory(corruptRoot); System.IO.File.WriteAllText(Path.Combine(corruptRoot, "library.json"), "{bad"); var recovery = new MusicLibrary(corruptRoot); Check("unreadable library is preserved with visible warning", recovery.StartupWarning.Length > 0 && Directory.GetFiles(corruptRoot, "*.unreadable-*").Length == 1);
            System.IO.File.WriteAllText(Path.Combine(root, "self-test.json"), JsonSerializer.Serialize(new { passed = true, checks = results }, MusicLibrary.Json)); return 0;
        }
        catch (Exception e) { System.IO.File.WriteAllText(Path.Combine(root, "self-test.json"), JsonSerializer.Serialize(new { passed = false, checks = results, error = e.ToString() }, MusicLibrary.Json)); return 1; }
    }
    public static void PrepareDemo(string webRoot)
    {
        string[] names = ["漂浮坐标", "夜航信号", "薄雾回声"];
        for (int i = 0; i < 3; i++)
        {
            using var file = TagLib.File.Create(Path.Combine(webRoot, "assets", "demo", $"{i + 1:00}.wav"));
            file.Tag.Title = names[i]; file.Tag.Performers = ["REFRACT"]; file.Tag.Album = "Light Studies · Vol. 01"; file.Tag.Year = 2026; file.Tag.Track = (uint)i + 1; file.Tag.Genres = ["Ambient"];
            file.Tag.Pictures = [new TagLib.Picture(new TagLib.ByteVector(System.IO.File.ReadAllBytes(Path.Combine(webRoot, "assets", $"cover-{i + 1}.png")))) { Type = TagLib.PictureType.FrontCover, MimeType = "image/png" }];
            file.Save();
        }
    }
}
