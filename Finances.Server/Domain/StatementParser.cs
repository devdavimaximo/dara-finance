using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Finances.Server.Domain;

/// <summary>Uma linha do extrato. Valor com sinal: negativo = saída (despesa), positivo = entrada.</summary>
public record StatementRow(DateOnly Date, long AmountCents, string Description, string ExternalId);

/// <summary>
/// Lê extratos OFX e CSV dos bancos brasileiros. Puro (sem banco), testável.
/// CSV não tem padrão: as colunas são achadas pelo nome do cabeçalho ou, sem cabeçalho, pelo conteúdo.
/// </summary>
public static partial class StatementParser
{
    public static List<StatementRow> Parse(byte[] content, string fileName)
    {
        var text = Decode(content);
        var isOfx = fileName.EndsWith(".ofx", StringComparison.OrdinalIgnoreCase)
            || fileName.EndsWith(".qfx", StringComparison.OrdinalIgnoreCase)
            || text.Contains("<OFX>", StringComparison.OrdinalIgnoreCase)
            || text.Contains("<STMTTRN>", StringComparison.OrdinalIgnoreCase);
        return isOfx ? ParseOfx(text) : ParseCsv(text);
    }

    /// <summary>UTF-8 quando válido; senão Latin-1 (muitos OFX de banco vêm em ISO-8859-1).</summary>
    public static string Decode(byte[] bytes)
    {
        try { return new UTF8Encoding(false, true).GetString(bytes).TrimStart('﻿'); }
        catch (DecoderFallbackException) { return Encoding.Latin1.GetString(bytes); }
    }

    // ------------------------------------------------------------------ OFX

    public static List<StatementRow> ParseOfx(string text)
    {
        var rows = new List<StatementRow>();
        var blocks = Regex.Split(text, "<STMTTRN>", RegexOptions.IgnoreCase).Skip(1);
        foreach (var raw in blocks)
        {
            var block = Regex.Split(raw, "</STMTTRN>", RegexOptions.IgnoreCase)[0];
            string? Tag(string name)
            {
                var m = Regex.Match(block, $"<{name}>([^<\\r\\n]*)", RegexOptions.IgnoreCase);
                return m.Success ? m.Groups[1].Value.Trim() : null;
            }
            var amount = ParseAmount(Tag("TRNAMT") ?? "");
            var dt = Tag("DTPOSTED");
            if (amount is null || dt is null || dt.Length < 8) continue;
            if (!DateOnly.TryParseExact(dt[..8], "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) continue;

            var memo = Tag("MEMO");
            var name = Tag("NAME");
            var desc = Clean(string.Join(" — ", new[] { name, memo }.Where(s => !string.IsNullOrWhiteSpace(s)).Distinct()));
            var fitid = Tag("FITID");
            rows.Add(new StatementRow(date, amount.Value, desc == "" ? "(sem descrição)" : desc,
                string.IsNullOrWhiteSpace(fitid) ? Hash("ofx", date, amount.Value, desc, 0) : $"ofx:{fitid}"));
        }
        return rows;
    }

    // ------------------------------------------------------------------ CSV

    private static readonly string[] DateHeads = ["data", "date", "dt"];
    private static readonly string[] AmountHeads = ["valor", "amount", "quantia", "montante", "value"];
    private static readonly string[] CreditHeads = ["crédito", "credito", "entrada", "credit"];
    private static readonly string[] DebitHeads = ["débito", "debito", "saída", "saida", "debit"];
    private static readonly string[] DescHeads = ["descri", "histórico", "historico", "title", "lançamento", "lancamento", "memo", "estabelecimento", "detalhe"];
    private static readonly string[] IdHeads = ["identificador", "id", "fitid", "documento", "nº doc"];

    public static List<StatementRow> ParseCsv(string text)
    {
        var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Trim().Length > 0).ToList();
        if (lines.Count == 0) return [];
        var delim = new[] { ';', ',', '\t' }.OrderByDescending(d => lines.Take(5).Sum(l => l.Count(c => c == d))).First();
        var table = lines.Select(l => SplitCsv(l, delim)).ToList();

        // Cabeçalho: a primeira das 10 linhas iniciais que tenha um nome de coluna de data.
        int headerIdx = table.Take(10).ToList().FindIndex(r => r.Any(c => Has(c, DateHeads) && !LooksLikeDate(c)));
        int dateCol, amountCol = -1, creditCol = -1, debitCol = -1, descCol, idCol = -1;
        if (headerIdx >= 0)
        {
            var h = table[headerIdx].Select(c => c.Trim().ToLowerInvariant()).ToList();
            dateCol = h.FindIndex(c => Has(c, DateHeads));
            amountCol = h.FindIndex(c => Has(c, AmountHeads));
            creditCol = h.FindIndex(c => Has(c, CreditHeads));
            debitCol = h.FindIndex(c => Has(c, DebitHeads));
            descCol = h.FindIndex(c => Has(c, DescHeads));
            idCol = h.FindIndex(c => IdHeads.Any(k => c == k || c.StartsWith(k + " ") || c == "identificador"));
            if (descCol < 0) descCol = h.FindIndex((c) => !Has(c, DateHeads) && !Has(c, AmountHeads) && !IdHeads.Contains(c));
        }
        else
        {
            // Sem cabeçalho: deduz pelo conteúdo das primeiras linhas.
            var sample = table.Take(20).ToList();
            var width = sample.Max(r => r.Count);
            int Score(Func<string, bool> ok, int col) => sample.Count(r => col < r.Count && ok(r[col]));
            dateCol = Enumerable.Range(0, width).OrderByDescending(c => Score(LooksLikeDate, c)).First();
            amountCol = Enumerable.Range(0, width).Where(c => c != dateCol).OrderByDescending(c => Score(s => ParseAmount(s) != null, c)).First();
            descCol = Enumerable.Range(0, width).Where(c => c != dateCol && c != amountCol)
                .OrderByDescending(c => sample.Sum(r => c < r.Count ? r[c].Length : 0)).DefaultIfEmpty(-1).First();
        }
        if (dateCol < 0 || (amountCol < 0 && creditCol < 0 && debitCol < 0)) return [];

        var rows = new List<StatementRow>();
        var seen = new Dictionary<string, int>();
        foreach (var r in table.Skip(headerIdx + 1))
        {
            string Cell(int i) => i >= 0 && i < r.Count ? r[i].Trim() : "";
            if (!TryParseDate(Cell(dateCol), out var date)) continue;
            long? amount = amountCol >= 0 ? ParseAmount(Cell(amountCol)) : null;
            if (amount is null && (creditCol >= 0 || debitCol >= 0))
            {
                var c = ParseAmount(Cell(creditCol)) ?? 0;
                var d = ParseAmount(Cell(debitCol)) ?? 0;
                amount = Math.Abs(c) - Math.Abs(d);
            }
            if (amount is null or 0) continue;
            var desc = Clean(Cell(descCol));
            if (desc == "") desc = "(sem descrição)";

            string ext;
            if (Cell(idCol) is { Length: > 0 } id) ext = $"csv:{id}";
            else
            {
                // Linhas idênticas no mesmo dia são transações diferentes: numera a ocorrência.
                var k = $"{date}|{amount}|{desc}";
                seen[k] = seen.GetValueOrDefault(k) + 1;
                ext = Hash("csv", date, amount.Value, desc, seen[k]);
            }
            rows.Add(new StatementRow(date, amount.Value, desc, ext));
        }
        return rows;
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>"R$ -1.234,56", "-1234.56", "1.234,56 D", "(50,00)" → centavos com sinal.</summary>
    public static long? ParseAmount(string s)
    {
        s = s.Trim();
        if (s.Length == 0) return null;
        // Sinal de menos, parênteses contábeis ou sufixo "D" (débito) como em "1.234,56 D".
        var negative = s.Contains('-') || (s.StartsWith('(') && s.EndsWith(')'))
            || (s.Length > 1 && (s[^1] is 'D' or 'd') && (char.IsDigit(s[^2]) || s[^2] == ' '));
        var digits = new string(s.Where(c => char.IsDigit(c) || c == ',' || c == '.').ToArray());
        if (digits.Length == 0 || !digits.Any(char.IsDigit)) return null;

        var lastSep = Math.Max(digits.LastIndexOf(','), digits.LastIndexOf('.'));
        long cents;
        if (lastSep >= 0 && digits.Length - lastSep - 1 is 1 or 2)
        {
            var intPart = new string(digits[..lastSep].Where(char.IsDigit).ToArray());
            var dec = digits[(lastSep + 1)..].PadRight(2, '0');
            if (!long.TryParse(intPart.Length == 0 ? "0" : intPart, out var i) || !long.TryParse(dec, out var d)) return null;
            cents = i * 100 + d;
        }
        else
        {
            if (!long.TryParse(new string(digits.Where(char.IsDigit).ToArray()), out var i)) return null;
            cents = i * 100;
        }
        return negative ? -cents : cents;
    }

    private static readonly string[] DateFormats = ["dd/MM/yyyy", "d/M/yyyy", "dd/MM/yy", "yyyy-MM-dd", "dd-MM-yyyy", "dd.MM.yyyy", "yyyy/MM/dd"];

    public static bool TryParseDate(string s, out DateOnly date)
    {
        s = s.Trim();
        if (s.Length > 10 && s[10] is ' ' or 'T') s = s[..10];
        return DateOnly.TryParseExact(s, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
    }

    private static bool LooksLikeDate(string s) => TryParseDate(s, out _);

    private static bool Has(string cell, string[] keys)
    {
        var c = cell.Trim().ToLowerInvariant();
        return keys.Any(k => c == k || c.StartsWith(k) || c.Contains(" " + k));
    }

    private static List<string> SplitCsv(string line, char delim)
    {
        var cells = new List<string>();
        var sb = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (ch == '"')
            {
                if (quoted && i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                else quoted = !quoted;
            }
            else if (ch == delim && !quoted) { cells.Add(sb.ToString()); sb.Clear(); }
            else sb.Append(ch);
        }
        cells.Add(sb.ToString());
        return cells;
    }

    private static string Clean(string s) => Spaces().Replace(s, " ").Trim();

    private static string Hash(string prefix, DateOnly date, long amount, string desc, int n)
    {
        var bytes = SHA1.HashData(Encoding.UTF8.GetBytes($"{date:yyyy-MM-dd}|{amount}|{desc.ToLowerInvariant()}|{n}"));
        return $"{prefix}#{Convert.ToHexString(bytes)[..20]}";
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
