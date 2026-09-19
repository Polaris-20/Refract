using System.Text.Json;
using System.Drawing.Imaging;

namespace Refract;

public sealed class Track
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Path { get; set; } = "";
    public string Title { get; set; } = "";
    public string Artist { get; set; } = "";
    public string Album { get; set; } = "";
    public string Genre { get; set; } = "";
    public uint Year { get; set; }
    public uint Number { get; set; }
    public double Duration { get; set; }
    public int Bitrate { get; set; }
    public int SampleRate { get; set; }
    public string Format { get; set; } = "";
    public string Cover { get; set; } = "";
    public string LyricsText { get; set; } = "";
    public string LyricsName { get; set; } = "";
    public string LyricsRevision { get; set; } = "";
    public bool Favorite { get; set; }
    public bool Edited { get; set; }
    public DateTime Added { get; set; } = DateTime.UtcNow;
}
public sealed class Playlist
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public List<string> TrackIds { get; set; } = [];
}
public sealed class LibraryData
{
    public int Version { get; set; } = 1;
    public List<Track> Tracks { get; set; } = [];
    public List<Playlist> Playlists { get; set; } = [];
}
public sealed class MusicLibrary
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    public static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".mp3", ".flac", ".wav", ".m4a", ".ogg", ".opus", ".aac", ".aif", ".aiff", ".wma" };
    public string Root { get; }
    public LibraryData Data { get; private set; } = new();
    public string StartupWarning { get; private set; } = "";
    public MusicLibrary(string root)
    {
        Root = System.IO.Path.GetFullPath(root);
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(System.IO.Path.Combine(Root, "covers"));
        var file = System.IO.Path.Combine(Root, "library.json");
        if (System.IO.File.Exists(file))
        {
            try { Data = JsonSerializer.Deserialize<LibraryData>(System.IO.File.ReadAllText(file), Json) ?? throw new Exception("空曲库"); }
            catch { var backup = file + ".unreadable-" + DateTime.Now.ToString("yyyyMMddHHmmss"); System.IO.File.Copy(file, backup); StartupWarning = "曲库记录无法读取，原记录已保留为 .unreadable 备份。可以重新导入音乐。"; }
        }
    }
    public void Save()
    {
        var file = System.IO.Path.Combine(Root, "library.json");
        System.IO.File.WriteAllText(file + ".tmp", JsonSerializer.Serialize(Data, Json));
        System.IO.File.Move(file + ".tmp", file, true);
    }
    public Track Get(string id) => Data.Tracks.FirstOrDefault(t => t.Id == id) ?? throw new Exception("歌曲不在曲库中。");
    public object Snapshot() => new { tracks = Data.Tracks.Select(t => new { t.Id, t.Title, t.Artist, t.Album, t.Genre, t.Year, t.Number, t.Duration, t.Bitrate, t.SampleRate, t.Format, t.Favorite, t.Edited, t.Added, t.LyricsName, t.LyricsRevision, hasLyrics = t.LyricsText.Length > 0, fileName = System.IO.Path.GetFileName(t.Path), missing = !System.IO.File.Exists(t.Path), cover = t.Cover.Length > 0 ? "https://media.refract.local/cover/" + t.Id + "?v=" + System.IO.File.GetLastWriteTimeUtc(System.IO.Path.Combine(Root, t.Cover)).Ticks : "", src = "https://media.refract.local/audio/" + t.Id }), playlists = Data.Playlists };
    public (int imported, int skipped, List<string> errors) Import(IEnumerable<string> paths)
    {
        int imported = 0, skipped = 0;
        List<string> errors = [];
        var known = new HashSet<string>(Data.Tracks.Select(t => t.Path), StringComparer.OrdinalIgnoreCase);
        foreach (var input in paths)
        {
            var path = System.IO.Path.GetFullPath(input);
            if (!Extensions.Contains(System.IO.Path.GetExtension(path))) { skipped++; continue; }
            if (!known.Add(path)) { skipped++; continue; }
            try
            {
                using var media = TagLib.File.Create(path);
                if (media.Properties.Duration.TotalSeconds <= 0) throw new Exception("没有可播放的音轨");
                var tag = media.Tag;
                var t = new Track { Path = path, Title = string.IsNullOrWhiteSpace(tag.Title) ? System.IO.Path.GetFileNameWithoutExtension(path) : tag.Title, Artist = string.Join(" / ", tag.Performers), Album = tag.Album ?? "", Genre = string.Join(" / ", tag.Genres), Year = tag.Year, Number = tag.Track, Duration = media.Properties.Duration.TotalSeconds, Bitrate = media.Properties.AudioBitrate, SampleRate = media.Properties.AudioSampleRate, Format = System.IO.Path.GetExtension(path).TrimStart('.').ToUpperInvariant() };
                if (tag.Pictures.Length > 0)
                    try { t.Cover = StoreCover(tag.Pictures[0].Data.Data); } catch { /* Invalid artwork must not hide playable music. */ }
                Data.Tracks.Add(t); imported++;
            }
            catch (Exception e) { errors.Add(System.IO.Path.GetFileName(path) + "：" + e.Message); }
        }
        Save(); return (imported, skipped, errors);
    }
    public string StoreCover(byte[] bytes)
    {
        if (bytes.Length > 20 * 1024 * 1024) throw new Exception("封面请小于 20 MB。");
        using var input = new MemoryStream(bytes);
        using var img = Image.FromStream(input);
        var scale = Math.Min(1, 900.0 / Math.Max(img.Width, img.Height));
        using var resized = new Bitmap(Math.Max(1, (int)(img.Width * scale)), Math.Max(1, (int)(img.Height * scale)));
        using (var g = Graphics.FromImage(resized)) { g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic; g.DrawImage(img, 0, 0, resized.Width, resized.Height); }
        string relative = "covers/" + Guid.NewGuid().ToString("N") + ".png";
        resized.Save(System.IO.Path.Combine(Root, relative), ImageFormat.Png);
        return relative;
    }
    public string WriteTags(Track t)
    {
        if (!System.IO.File.Exists(t.Path)) throw new Exception("找不到原文件，请恢复文件原来的位置。");
        if (!new[] { "MP3", "FLAC", "M4A", "OGG", "WAV", "AIF", "AIFF" }.Contains(t.Format)) throw new Exception("此格式第一版仅支持编辑曲库记录。");
        var backup = t.Path + ".refract-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")[..6] + ".bak";
        System.IO.File.Copy(t.Path, backup, false);
        try
        {
            using var media = TagLib.File.Create(t.Path);
            media.Tag.Title = t.Title; media.Tag.Performers = string.IsNullOrWhiteSpace(t.Artist) ? [] : t.Artist.Split(" / ");
            media.Tag.Album = t.Album; media.Tag.Genres = string.IsNullOrWhiteSpace(t.Genre) ? [] : t.Genre.Split(" / ");
            media.Tag.Year = t.Year; media.Tag.Track = t.Number;
            if (t.Cover.Length > 0) media.Tag.Pictures = [new TagLib.Picture(new TagLib.ByteVector(System.IO.File.ReadAllBytes(System.IO.Path.Combine(Root, t.Cover)))) { Type = TagLib.PictureType.FrontCover, MimeType = "image/png" }];
            media.Save();
        }
        catch { System.IO.File.Copy(backup, t.Path, true); throw; }
        t.Edited = false; Save(); return backup;
    }
}
