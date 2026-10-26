using System.Text.RegularExpressions;
using Finances.Server.Data;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Api;

public record ImportMatch(Guid EntryId, string Description, DateOnly DueDate, long AmountCents);
public record ImportPreviewRow(
    string ExternalId, DateOnly Date, long AmountCents, EntryKind Kind, string Description,
    bool Duplicate, ImportMatch? Match, Guid? SuggestedCategoryId);
public record ImportRowInput(
    string ExternalId, DateOnly Date, long AmountCents, EntryKind Kind, string Description,
    Guid? CategoryId, Guid? MatchEntryId);
public record ImportCommitRequest(List<ImportRowInput> Rows);

/// <summary>
/// Importação de extrato em dois passos: preview (lê, deduplica, concilia, sugere categoria) e commit.
/// Tudo que vem do extrato já aconteceu, então entra como pago na data da transação.
/// </summary>
public static partial class ImportApi
{
    private const long MaxFile = 5 * 1024 * 1024;

    public static void Map(RouteGroupBuilder api)
    {
        var w = api.MapGroup("/w/{workspaceId:guid}/import").RequireAuthorization().AddEndpointFilter<WorkspaceFilter>();

        // invert=true: fatura de cartão em CSV costuma trazer gasto como valor positivo.
        w.MapPost("/preview", async (IFormFile file, bool? invert, AppDb db) =>
        {
            if (file.Length is 0 or > MaxFile) return Results.BadRequest(new { error = "Arquivo vazio ou maior que 5 MB." });
            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            var rows = StatementParser.Parse(ms.ToArray(), file.FileName);
            if (invert == true) rows = rows.Select(r => r with { AmountCents = -r.AmountCents }).ToList();
            if (rows.Count == 0)
                return Results.BadRequest(new { error = "Não reconheci transações nesse arquivo. Envie o OFX ou o CSV exportado pelo banco." });
            if (rows.Count > 2000) return Results.BadRequest(new { error = "Extrato grande demais (máx. 2.000 linhas). Exporte um período menor." });

            var ids = rows.Select(r => r.ExternalId).ToList();
            var existing = (await db.Entries.Where(e => e.ExternalId != null && ids.Contains(e.ExternalId)).Select(e => e.ExternalId!).ToListAsync()).ToHashSet();

            var from = rows.Min(r => r.Date).AddDays(-LateDays);
            var to = rows.Max(r => r.Date).AddDays(10);
            var open = await db.Entries.AsNoTracking()
                .Where(e => e.PaidDate == null && e.DueDate >= from && e.DueDate <= to).ToListAsync();

            var history = await db.Entries.AsNoTracking().Where(e => e.CategoryId != null)
                .OrderByDescending(e => e.DueDate).Take(800)
                .Select(e => new { e.Description, e.Counterparty, e.CategoryId, e.Kind }).ToListAsync();
            var byKey = new Dictionary<string, Guid>();
            foreach (var h in history)
            {
                foreach (var k in new[] { Key(h.Description), Key(h.Counterparty) })
                    if (k.Length >= 3) byKey.TryAdd($"{h.Kind}|{k}", h.CategoryId!.Value);
            }

            var used = new HashSet<Guid>();
            var preview = rows.Select(r =>
            {
                var kind = r.AmountCents < 0 ? EntryKind.Expense : EntryKind.Income;
                var amount = Math.Abs(r.AmountCents);
                var dup = existing.Contains(r.ExternalId);
                var match = dup ? null : BestMatch(open, used, kind, amount, r.Date);
                if (match is not null) used.Add(match.Id);
                Guid? cat = match?.CategoryId ?? Suggest(byKey, kind, Key(r.Description));
                return new ImportPreviewRow(r.ExternalId, r.Date, amount, kind, r.Description, dup,
                    match is null ? null : new ImportMatch(match.Id, match.Description, match.DueDate, match.AmountCents), cat);
            }).OrderByDescending(r => r.Date).ToList();

            return Results.Ok(new { rows = preview });
        }).DisableAntiforgery();

        w.MapPost("/commit", async (ImportCommitRequest req, AppDb db) =>
        {
            if (req.Rows is null || req.Rows.Count == 0) return Results.BadRequest(new { error = "Nada selecionado." });
            var ids = req.Rows.Select(r => r.ExternalId).ToList();
            var existing = (await db.Entries.Where(e => e.ExternalId != null && ids.Contains(e.ExternalId)).Select(e => e.ExternalId!).ToListAsync()).ToHashSet();
            var categories = await db.Categories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Kind);

            int created = 0, reconciled = 0, skipped = 0;
            foreach (var r in req.Rows)
            {
                if (r.AmountCents <= 0 || string.IsNullOrWhiteSpace(r.ExternalId) || !existing.Add(r.ExternalId)) { skipped++; continue; }
                Guid? cat = r.CategoryId is { } cid && categories.TryGetValue(cid, out var k) && k == r.Kind ? cid : null;

                if (r.MatchEntryId is { } mid && await db.Entries.FirstOrDefaultAsync(e => e.Id == mid && e.PaidDate == null) is { } entry)
                {
                    entry.PaidDate = r.Date;
                    entry.PaidAmountCents = r.AmountCents;
                    entry.ExternalId = r.ExternalId;
                    entry.CategoryId ??= cat;
                    reconciled++;
                    continue;
                }

                db.Entries.Add(new Entry
                {
                    Kind = r.Kind,
                    Description = r.Description.Trim()[..Math.Min(140, r.Description.Trim().Length)],
                    AmountCents = r.AmountCents,
                    DueDate = r.Date,
                    PaidDate = r.Date,
                    PaidAmountCents = r.AmountCents,
                    CategoryId = cat,
                    ExternalId = r.ExternalId,
                    Notes = "Importado do extrato",
                });
                created++;
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { created, reconciled, skipped });
        });
    }

    /// <summary>Conta paga com atraso ainda concilia: até 45 dias depois do vencimento.</summary>
    private const int LateDays = 45;

    /// <summary>
    /// Conta em aberto do mesmo tipo, valor até 2% de diferença, que venceu até 45 dias antes
    /// (paga atrasada) ou vence até 7 dias depois (paga adiantada) da data do extrato.
    /// </summary>
    private static Entry? BestMatch(List<Entry> open, HashSet<Guid> used, EntryKind kind, long amount, DateOnly date) =>
        open.Where(e => e.Kind == kind && !used.Contains(e.Id)
                && Math.Abs(e.AmountCents - amount) <= Math.Max(100, amount * 2 / 100)
                && e.DueDate.DayNumber - date.DayNumber is >= -LateDays and <= 7)
            .OrderBy(e => Math.Abs(e.DueDate.DayNumber - date.DayNumber) + Math.Abs(e.AmountCents - amount) / 100.0)
            .FirstOrDefault();

    /// <summary>Categoria aprendida: chave igual, ou uma chave que começa pela outra ("figma notion" ⊂ "figma notion assinatura").</summary>
    internal static Guid? Suggest(Dictionary<string, Guid> byKey, EntryKind kind, string key)
    {
        if (key.Length < 3) return null;
        if (byKey.TryGetValue($"{kind}|{key}", out var exact)) return exact;
        var prefix = $"{kind}|";
        return byKey.Where(kv => kv.Key.StartsWith(prefix))
            .Select(kv => (Key: kv.Key[prefix.Length..], kv.Value))
            .Where(x => x.Key.Length >= 4 && (key.StartsWith(x.Key + " ") || x.Key.StartsWith(key + " ")))
            .OrderByDescending(x => x.Key.Length)
            .Select(x => (Guid?)x.Value)
            .FirstOrDefault();
    }

    private static readonly HashSet<string> Noise =
        ["pix", "enviado", "recebido", "compra", "pagamento", "pag", "transf", "transferencia", "ted", "doc", "debito", "credito", "cartao", "no", "na", "de", "do", "da"];

    /// <summary>Chave de aprendizado: sem acento, minúsculas, sem números/pontuação/ruído bancário, 3 primeiras palavras.</summary>
    internal static string Key(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        var noAccents = new string(s.Normalize(System.Text.NormalizationForm.FormD)
            .Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark).ToArray());
        var clean = NonLetters().Replace(noAccents.ToLowerInvariant(), " ");
        var words = clean.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => !Noise.Contains(w)).Take(3);
        return string.Join(' ', words);
    }

    [GeneratedRegex(@"[^\p{L}]+")]
    private static partial Regex NonLetters();
}
