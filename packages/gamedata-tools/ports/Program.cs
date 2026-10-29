// Liest die Anschlüsse (Förderband- und Rohranschlüsse) aller Gebäude aus den
// Spielpaketen einer lokalen Satisfactory-Installation und schreibt sie als
// kompaktes JSON. Die Auswertung (Vererbung, Zuordnung zu Anschluss-IDs)
// übernimmt extract.ts.
//
// Aufruf: dotnet run --project packages/gamedata-tools/ports -- --game <Pfad> --out <Datei>
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

string Arg(string name, string fallback)
{
    var i = Array.IndexOf(args, $"--{name}");
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback;
}

var game = Arg("game", Environment.GetEnvironmentVariable("SATISFACTORY_DIR")
    ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".steam/steam/steamapps/common/Satisfactory"));
var outFile = Path.GetFullPath(Arg("out", "ports-game.json"));
var versionFile = Path.Combine(game, "Engine/Binaries/Win64/FactoryGameSteam-Win64-Shipping.version");
var version = File.Exists(versionFile) ? JObject.Parse(File.ReadAllText(versionFile)) : new JObject();

// Oodle (Kompression der Spielpakete) wird beim ersten Lauf neben das Programm geladen.
var oodle = Path.Combine(AppContext.BaseDirectory, OodleHelper.OodleFileName);
if (!File.Exists(oodle) && !OodleHelper.DownloadOodleDll(ref oodle)) throw new Exception("Oodle-Bibliothek nicht verfügbar");
OodleHelper.Initialize(oodle);

var usmap = Path.Combine(Path.GetTempPath(), $"satis-ports-{Environment.ProcessId}.usmap");
File.WriteAllBytes(usmap, Usmap.Patch(File.ReadAllBytes(Path.Combine(game, "CommunityResources/FactoryGame.usmap"))));

var engine = (int?)version["MinorVersion"] is int minor && Enum.TryParse<EGame>($"GAME_UE5_{minor}", out var g) ? g : EGame.GAME_UE5_6;
var provider = new DefaultFileProvider(Path.Combine(game, "FactoryGame/Content/Paks"), SearchOption.TopDirectoryOnly,
    new VersionContainer(engine), StringComparer.OrdinalIgnoreCase);
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap, StringComparer.OrdinalIgnoreCase);
provider.Initialize();
provider.Mount();
provider.SubmitKey(new FGuid(), new FAesKey(new byte[32]));
provider.PostMount();
File.Delete(usmap);

static bool IsConnection(string type) =>
    (type.Contains("FactoryConnection") || type.Contains("PipeConnection")) && !type.Contains("Power") && !type.Contains("Train");

// "Klasse'Paket:Objekt_GEN_VARIABLE'" → "Paket:Objekt" bzw. nur "Objekt"
static string Inner(string? objectName)
{
    if (objectName is null) return "";
    var a = objectName.IndexOf('\'');
    var s = a >= 0 ? objectName[(a + 1)..objectName.LastIndexOf('\'')] : objectName;
    return s.Replace("_GEN_VARIABLE", "");
}
static string Short(string? objectName) => Inner(objectName).Split(':')[^1].Split('.')[^1];

static JObject? Vec(JToken? t, params string[] keys) =>
    t is JObject o ? new JObject(keys.Select(k => new JProperty(k, Math.Round((double?)o[k] ?? 0, 3)))) : null;

var classes = new JObject();
var errors = 0;
foreach (var path in provider.Files.Keys.Where(k => k.Contains("/Buildable/") && Path.GetFileName(k).StartsWith("Build_") && k.EndsWith(".uasset")).Order())
{
    JArray exports;
    try
    {
        exports = JArray.Parse(JsonConvert.SerializeObject(provider.LoadPackage(path).GetExports()));
    }
    catch (Exception e)
    {
        Console.Error.WriteLine($"{path}: {e.Message}");
        errors++;
        continue;
    }
    var cls = exports.FirstOrDefault(e => (string?)e["Type"] == "BlueprintGeneratedClass");
    if (cls is null) continue;

    // Elternkomponente je Vorlage (SCS-Knoten); vererbte Vorlagen über den Komponentenschlüssel.
    var parents = new Dictionary<string, string>();
    foreach (var n in exports.Where(e => (string?)e["Type"] == "SCS_Node"))
        parents[Short((string?)n["Properties"]?["ComponentTemplate"]?["ObjectName"])] = (string?)n["Properties"]?["ParentComponentOrVariableName"] ?? "";

    var connections = new JArray();
    foreach (var e in exports.Where(e => IsConnection((string?)e["Type"] ?? "")))
    {
        var p = e["Properties"] as JObject ?? new JObject();
        var c = new JObject { ["name"] = Short((string?)e["Name"]), ["type"] = (string?)e["Type"] };
        if (e["Template"] is JObject t) c["template"] = Inner((string?)t["ObjectName"]);
        if (parents.TryGetValue(c.Value<string>("name")!, out var parent) && parent != "") c["parent"] = parent;
        if (Vec(p["RelativeLocation"], "X", "Y", "Z") is { } loc) c["location"] = loc;
        if (Vec(p["RelativeRotation"], "Pitch", "Yaw", "Roll") is { } rot) c["rotation"] = rot;
        if (p["mDirection"] is { } dir) c["direction"] = dir.ToString().Split("::")[^1];
        if (p["mPipeConnectionType"] is { } pct) c["pipeType"] = pct.ToString().Split("::")[^1];
        connections.Add(c);
    }
    var super = Short((string?)cls["Super"]?["ObjectName"]);
    if (connections.Count == 0 && !super.StartsWith("Build_")) continue;
    var entry = new JObject();
    if (super != "") entry["super"] = super;
    entry["connections"] = connections;
    classes[Short((string?)cls["Name"])] = entry;
}

var result = new JObject
{
    ["$comment"] = "Anschlüsse der Gebäude aus den Spielpaketen (Komponentenvorlagen der Blueprints). Einheiten wie im Spiel: cm, Grad. Erzeugt mit packages/gamedata-tools/ports.",
    ["meta"] = new JObject
    {
        ["gameVersion"] = version["GameVersion"],
        ["changelist"] = version["Changelist"],
        ["branch"] = version["BranchName"],
        ["engine"] = engine.ToString(),
    },
    ["classes"] = classes,
};
File.WriteAllText(outFile, result.ToString(Formatting.Indented) + "\n");
Console.WriteLine($"{classes.Count} Gebäudeklassen, {errors} Fehler → {outFile}");
return errors > 0 ? 1 : 0;

static class Usmap
{
    // Die mitgelieferte FactoryGame.usmap speichert OptionalProperty ohne inneren Typ;
    // CUE4Parse erwartet einen. Ergänzt wird ByteProperty (betrifft keine Gebäude).
    public static byte[] Patch(byte[] d)
    {
        var o = 0;
        var outBuf = new List<byte>();
        if (BitConverter.ToUInt16(d, 0) != 0x30C4) throw new Exception("Keine usmap-Datei");
        var version = d[2];
        o = 3;
        if (version >= 1 && BitConverter.ToInt32(d, o) != 0)
        {
            o += 4 + 8;
            var count = BitConverter.ToInt32(d, o);
            o += 4 + count * 20 + 4;
        }
        else if (version >= 1) o += 4;
        var header = o;
        if (d[o] != 0) throw new Exception("Komprimierte usmap wird nicht unterstützt");
        o += 9;

        uint U32() { var v = BitConverter.ToUInt32(d, o); outBuf.AddRange(d.AsSpan(o, 4).ToArray()); o += 4; return v; }
        ushort U16() { var v = BitConverter.ToUInt16(d, o); outBuf.AddRange(d.AsSpan(o, 2).ToArray()); o += 2; return v; }
        byte U8() { var v = d[o]; outBuf.Add(v); o += 1; return v; }
        void Raw(int n) { outBuf.AddRange(d.AsSpan(o, n).ToArray()); o += n; }
        void Prop()
        {
            var t = U8();
            switch (t)
            {
                case 9: U32(); break;               // Struct
                case 26: Prop(); U32(); break;      // Enum
                case 8: case 25: Prop(); break;     // Array, Set
                case 24: Prop(); Prop(); break;     // Map
                case 28: outBuf.Add(0); break;      // Optional ohne inneren Typ
            }
        }

        var names = U32();
        for (var i = 0; i < names; i++) Raw(U8());
        var enums = U32();
        for (var i = 0; i < enums; i++) { U32(); Raw(4 * U8()); }
        var structs = U32();
        for (var i = 0; i < structs; i++)
        {
            U32(); U32(); U16();
            var props = U16();
            for (var j = 0; j < props; j++) { U16(); U8(); U32(); Prop(); }
        }
        outBuf.AddRange(d.AsSpan(o).ToArray());

        var res = new List<byte>(d.AsSpan(0, header).ToArray()) { 0 };
        res.AddRange(BitConverter.GetBytes(outBuf.Count));
        res.AddRange(BitConverter.GetBytes(outBuf.Count));
        res.AddRange(outBuf);
        return res.ToArray();
    }
}
