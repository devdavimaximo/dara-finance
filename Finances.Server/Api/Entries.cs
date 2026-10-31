using System.Globalization;
using System.Text;
using Finances.Server.Data;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Api;

public record RepeatInput(Frequency Frequency, int Interval, int? Count, DateOnly? EndDate);
public record EntryInput(
    EntryKind Kind, string Description, long AmountCents, DateOnly DueDate,
    Guid? CategoryId, string? Counterparty, PaymentMethod? Method, string? Notes,
    bool Paid, DateOnly? PaidDate, long? PaidAmountCents, RepeatInput? Repeat,
    /// <summary>Id gerado no aparelho (offline). Reenviar o mesmo id não duplica.</summary>
    Guid? Id = null,
    /// <summary>Objetivo ao qual a despesa contribui (casamento, carro…).</summary>
    Guid? GoalId = null,
    /// <summary>Pago por fora do caixa (aporte do sócio etc.): realizado, sem mexer no saldo.</summary>
    bool OffCash = false,
    /// <summary>Origem do dinheiro quando OffCash (opcional).</summary>
    string? OffCashSource = null);
public record PayInput(DateOnly? PaidDate, long? PaidAmountCents, bool OffCash = false, string? OffCashSource = null);
public record EntryDto(
    Guid Id, EntryKind Kind, string Description, long AmountCents, DateOnly DueDate,
    DateOnly? PaidDate, long? PaidAmountCents, Guid? CategoryId, string? Counterparty,
    PaymentMethod? Method, string? Notes, Guid? RecurrenceId, int? Sequence, int? SeriesCount,
    Frequency? Frequency, string? AttachmentName, Guid? GoalId, bool OffCash, string? OffCashSource);
public record RecurrenceDto(
    Guid Id, EntryKind Kind, string Description, long AmountCents, Guid? CategoryId, string? Counterparty,
    Frequency Frequency, int Interval, DateOnly StartDate, DateOnly? EndDate, int? Count, bool Finished,
    int PaidCount, int OpenCount, DateOnly? NextDue);

public static class EntriesApi
{
    private static readonly HashSet<string> AllowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
    private const long MaxUpload = 10 * 1024 * 1024;

    internal static EntryDto ToDto(Entry e) => new(
        e.Id, e.Kind, e.Description, e.AmountCents, e.DueDate, e.PaidDate, e.PaidAmountCents, e.CategoryId,
        e.Counterparty, e.Method, e.Notes, e.RecurrenceId, e.Sequence, e.Recurrence?.Count,
        e.Recurrence?.Frequency, e.AttachmentName, e.GoalId, e.OffCash, e.OffCashSource);

    public static void Map(RouteGroupBuilder api, string dataDir)
    {
        var w = api.MapGroup("/w/{workspaceId:guid}").RequireAuthorization().AddEndpointFilter<WorkspaceFilter>();

        // ---- Lançamentos ----

        // Tudo que vence OU foi pago no período, mais o saldo de caixa imediatamente antes dele.
        w.MapGet("/entries", async (Guid workspaceId, DateOnly from, DateOnly to, AppDb db, RecurrenceService rec) =>
        {
            if (to < from || to.DayNumber - from.DayNumber > 5 * 366)
                return Results.BadRequest(new { error = "Período inválido (máx. 5 anos)." });
            await rec.EnsureHorizonAsync();

            var items = await db.Entries.AsNoTracking().Include(e => e.Recurrence)
                .Where(e => (e.DueDate >= from && e.DueDate <= to) || (e.PaidDate >= from && e.PaidDate <= to))
                .OrderBy(e => e.DueDate).ThenBy(e => e.Description)
                .ToListAsync();

            return Results.Ok(new { balanceBefore = await BalanceBefore(db, workspaceId, from), items = items.Select(ToDto) });
        });

        w.MapGet("/entries/{id:guid}", async (Guid id, AppDb db) =>
            await db.Entries.AsNoTracking().Include(e => e.Recurrence).FirstOrDefaultAsync(e => e.Id == id) is { } e
                ? Results.Ok(ToDto(e)) : Results.NotFound());

        w.MapPost("/entries", async (EntryInput input, AppDb db, RecurrenceService rec, Clock clock) =>
        {
            if (input.Id is { } clientId &&
                await db.Entries.AsNoTracking().Include(e => e.Recurrence).FirstOrDefaultAsync(e => e.Id == clientId) is { } already)
                return Results.Ok(ToDto(already));
            if (await Validate(db, input) is { } err) return Results.BadRequest(new { error = err });

            if (input.Repeat is { } r)
            {
                var series = new Recurrence
                {
                    Kind = input.Kind, Description = input.Description.Trim(), AmountCents = input.AmountCents,
                    CategoryId = input.CategoryId, GoalId = input.GoalId, Counterparty = Clean(input.Counterparty), Method = input.Method,
                    Frequency = r.Frequency, Interval = Math.Clamp(r.Interval, 1, 24), StartDate = input.DueDate,
                    EndDate = r.EndDate, Count = r.Count is > 0 ? Math.Min(r.Count.Value, 600) : null,
                };
                db.Recurrences.Add(series);
                // Garante ao menos a primeira ocorrência, mesmo que comece além do horizonte.
                rec.Materialize(series, input.DueDate > rec.Horizon ? input.DueDate : rec.Horizon, input.Id);
                await db.SaveChangesAsync();

                var first = await db.Entries.Include(e => e.Recurrence)
                    .FirstAsync(e => e.RecurrenceId == series.Id && e.Sequence == 1);
                first.Notes = Clean(input.Notes);
                if (input.Paid) MarkPaid(first, input.PaidDate ?? clock.Today, input.PaidAmountCents, input.OffCash, input.OffCashSource);
                await db.SaveChangesAsync();
                return Results.Ok(ToDto(first));
            }

            var entry = new Entry { Id = input.Id ?? Guid.NewGuid(), Kind = input.Kind };
            Apply(entry, input);
            if (input.Paid) MarkPaid(entry, input.PaidDate ?? clock.Today, input.PaidAmountCents, input.OffCash, input.OffCashSource);
            db.Entries.Add(entry);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(entry));
        });

        // scope=future: aplica também à série e às próximas ocorrências em aberto.
        w.MapPut("/entries/{id:guid}", async (Guid id, EntryInput input, string? scope, AppDb db, Clock clock) =>
        {
            var entry = await db.Entries.Include(e => e.Recurrence).FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            if (await Validate(db, input) is { } err) return Results.BadRequest(new { error = err });

            var oldDue = entry.DueDate;
            Apply(entry, input);
            if (input.Paid) MarkPaid(entry, input.PaidDate ?? entry.PaidDate ?? clock.Today, input.PaidAmountCents, input.OffCash, input.OffCashSource);
            else Unpay(entry);

            if (scope == "future" && entry.Recurrence is { } series)
            {
                series.Description = entry.Description;
                series.AmountCents = entry.AmountCents;
                series.CategoryId = entry.CategoryId;
                series.GoalId = entry.GoalId;
                series.Counterparty = entry.Counterparty;
                series.Method = entry.Method;
                var next = await db.Entries.Where(e => e.RecurrenceId == series.Id && e.Id != entry.Id
                    && e.PaidDate == null && e.DueDate > oldDue).ToListAsync();
                foreach (var n in next)
                {
                    n.Description = series.Description; n.AmountCents = series.AmountCents;
                    n.CategoryId = series.CategoryId; n.GoalId = series.GoalId; n.Counterparty = series.Counterparty; n.Method = series.Method;
                }
            }
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(entry));
        });

        w.MapPost("/entries/{id:guid}/pay", async (Guid id, PayInput input, AppDb db, Clock clock) =>
        {
            var entry = await db.Entries.Include(e => e.Recurrence).FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            MarkPaid(entry, input.PaidDate ?? clock.Today, input.PaidAmountCents, input.OffCash, input.OffCashSource);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(entry));
        });

        w.MapPost("/entries/{id:guid}/unpay", async (Guid id, AppDb db) =>
        {
            var entry = await db.Entries.Include(e => e.Recurrence).FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            Unpay(entry);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(entry));
        });

        // scope=future numa ocorrência recorrente: apaga esta e as próximas em aberto e encerra a série.
        w.MapDelete("/entries/{id:guid}", async (Guid id, string? scope, AppDb db) =>
        {
            var entry = await db.Entries.Include(e => e.Recurrence).FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            var doomed = new List<Entry> { entry };
            if (scope == "future" && entry.Recurrence is { } series)
            {
                doomed.AddRange(await db.Entries.Where(e => e.RecurrenceId == series.Id && e.Id != entry.Id
                    && e.PaidDate == null && e.DueDate >= entry.DueDate).ToListAsync());
                series.Finished = true;
                series.EndDate = entry.DueDate.AddDays(-1);
            }
            foreach (var d in doomed) DeleteFile(dataDir, d.AttachmentPath);
            db.Entries.RemoveRange(doomed);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- Comprovante (recibo, nota, boleto) ----

        w.MapPost("/entries/{id:guid}/attachment", async (Guid workspaceId, Guid id, IFormFile file, AppDb db) =>
        {
            var entry = await db.Entries.FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            if (file.Length is 0 or > MaxUpload) return Results.BadRequest(new { error = "Arquivo vazio ou maior que 10 MB." });
            if (!AllowedTypes.Contains(file.ContentType)) return Results.BadRequest(new { error = "Envie imagem ou PDF." });

            var dir = Path.Combine(dataDir, "uploads", workspaceId.ToString());
            Directory.CreateDirectory(dir);
            var ext = Path.GetExtension(file.FileName) is { Length: > 0 and <= 6 } x ? x.ToLowerInvariant() : "";
            var relative = Path.Combine("uploads", workspaceId.ToString(), $"{Guid.NewGuid():N}{ext}");
            await using (var fs = File.Create(Path.Combine(dataDir, relative)))
                await file.CopyToAsync(fs);

            DeleteFile(dataDir, entry.AttachmentPath);
            entry.AttachmentPath = relative;
            entry.AttachmentName = Path.GetFileName(file.FileName)[..Math.Min(120, Path.GetFileName(file.FileName).Length)];
            entry.AttachmentType = file.ContentType;
            await db.SaveChangesAsync();
            return Results.Ok(new { name = entry.AttachmentName });
        }).DisableAntiforgery();

        w.MapGet("/entries/{id:guid}/attachment", async (Guid id, AppDb db) =>
        {
            var entry = await db.Entries.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id);
            if (entry?.AttachmentPath is null) return Results.NotFound();
            var path = Path.Combine(dataDir, entry.AttachmentPath);
            return File.Exists(path)
                ? Results.File(path, entry.AttachmentType ?? "application/octet-stream", entry.AttachmentName, enableRangeProcessing: true)
                : Results.NotFound();
        });

        w.MapDelete("/entries/{id:guid}/attachment", async (Guid id, AppDb db) =>
        {
            var entry = await db.Entries.FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            DeleteFile(dataDir, entry.AttachmentPath);
            entry.AttachmentPath = entry.AttachmentName = entry.AttachmentType = null;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- Séries recorrentes ----

        w.MapGet("/recurrences", async (AppDb db, RecurrenceService rec) =>
        {
            await rec.EnsureHorizonAsync();
            var series = await db.Recurrences.AsNoTracking().OrderBy(r => r.Finished).ThenBy(r => r.Description).ToListAsync();
            var stats = await db.Entries.AsNoTracking().Where(e => e.RecurrenceId != null)
                .GroupBy(e => e.RecurrenceId)
                .Select(g => new
                {
                    Id = g.Key,
                    Paid = g.Count(e => e.PaidDate != null),
                    Open = g.Count(e => e.PaidDate == null),
                    Next = g.Where(e => e.PaidDate == null).Min(e => (DateOnly?)e.DueDate),
                }).ToDictionaryAsync(x => x.Id!.Value);
            return series.Select(r =>
            {
                stats.TryGetValue(r.Id, out var s);
                return new RecurrenceDto(r.Id, r.Kind, r.Description, r.AmountCents, r.CategoryId, r.Counterparty,
                    r.Frequency, r.Interval, r.StartDate, r.EndDate, r.Count, r.Finished,
                    s?.Paid ?? 0, s?.Open ?? 0, s?.Next);
            });
        });

        // Interrompe: nada novo é gerado e as ocorrências em aberto depois de hoje somem.
        w.MapPost("/recurrences/{id:guid}/stop", async (Guid id, AppDb db, Clock clock) =>
        {
            var series = await db.Recurrences.FirstOrDefaultAsync(r => r.Id == id);
            if (series is null) return Results.NotFound();
            var today = clock.Today;
            series.Finished = true;
            series.EndDate = today;
            var future = await db.Entries.Where(e => e.RecurrenceId == id && e.PaidDate == null && e.DueDate > today).ToListAsync();
            foreach (var f in future) DeleteFile(dataDir, f.AttachmentPath);
            db.Entries.RemoveRange(future);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- Categorias ----

        w.MapGet("/categories", async (AppDb db) =>
            await db.Categories.AsNoTracking().OrderBy(c => c.Kind).ThenBy(c => c.Name).ToListAsync());

        w.MapPost("/categories", async (Category input, AppDb db) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest(new { error = "Informe o nome." });
            var c = new Category
            {
                Name = input.Name.Trim(), Kind = input.Kind, Color = Math.Clamp(input.Color, 1, 8),
                Icon = string.IsNullOrWhiteSpace(input.Icon) ? "tag" : input.Icon, BudgetCents = input.BudgetCents is > 0 ? input.BudgetCents : null,
            };
            db.Categories.Add(c);
            await db.SaveChangesAsync();
            return Results.Ok(c);
        });

        w.MapPut("/categories/{id:guid}", async (Guid id, Category input, AppDb db) =>
        {
            var c = await db.Categories.FirstOrDefaultAsync(x => x.Id == id);
            if (c is null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest(new { error = "Informe o nome." });
            c.Name = input.Name.Trim();
            c.Color = Math.Clamp(input.Color, 1, 8);
            c.Icon = string.IsNullOrWhiteSpace(input.Icon) ? c.Icon : input.Icon;
            c.BudgetCents = input.BudgetCents is > 0 ? input.BudgetCents : null;
            c.Archived = input.Archived;
            await db.SaveChangesAsync();
            return Results.Ok(c);
        });

        // ---- Exportação ----

        w.MapGet("/export.csv", async (DateOnly from, DateOnly to, AppDb db) =>
        {
            var cats = await db.Categories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name);
            var rows = await db.Entries.AsNoTracking()
                .Where(e => e.DueDate >= from && e.DueDate <= to).OrderBy(e => e.DueDate).ToListAsync();
            var pt = CultureInfo.GetCultureInfo("pt-BR");
            var sb = new StringBuilder("Vencimento;Tipo;Descrição;Categoria;Contraparte;Valor;Status;Pago em;Valor pago;Forma;Parcela\n");
            foreach (var e in rows)
            {
                string Q(string? s) => "\"" + (s ?? "").Replace("\"", "\"\"") + "\"";
                sb.AppendJoin(';',
                    e.DueDate.ToString("dd/MM/yyyy"), e.Kind == EntryKind.Income ? "Receita" : "Despesa", Q(e.Description),
                    Q(e.CategoryId is { } cid && cats.TryGetValue(cid, out var cn) ? cn : ""), Q(e.Counterparty),
                    (e.AmountCents / 100m).ToString("0.00", pt), e.PaidDate is null ? "Em aberto"
                        : e.OffCash ? Q(e.OffCashSource is { } src ? $"Pago fora do caixa ({src})" : "Pago fora do caixa") : "Pago",
                    e.PaidDate?.ToString("dd/MM/yyyy") ?? "", e.PaidAmountCents is { } pa ? (pa / 100m).ToString("0.00", pt) : "",
                    e.Method?.ToString() ?? "", e.Sequence?.ToString() ?? "").Append('\n');
            }
            var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
            return Results.File(bytes, "text/csv; charset=utf-8", $"dara_{from:yyyyMMdd}_{to:yyyyMMdd}.csv");
        });
    }

    /// <summary>
    /// Saldo de caixa (realizado) antes de <paramref name="date"/>: abertura + pagos desde a abertura
    /// (menos os pagos por fora do caixa).
    /// </summary>
    private static async Task<long> BalanceBefore(AppDb db, Guid workspaceId, DateOnly date)
    {
        var ws = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == workspaceId);
        if (date <= ws.OpeningBalanceDate) return ws.OpeningBalanceCents;
        var paid = db.Entries.Where(e => e.PaidDate != null && !e.OffCash && e.PaidDate >= ws.OpeningBalanceDate && e.PaidDate < date);
        var income = await paid.Where(e => e.Kind == EntryKind.Income).SumAsync(e => e.PaidAmountCents ?? e.AmountCents);
        var expense = await paid.Where(e => e.Kind == EntryKind.Expense).SumAsync(e => e.PaidAmountCents ?? e.AmountCents);
        return ws.OpeningBalanceCents + income - expense;
    }

    private static async Task<string?> Validate(AppDb db, EntryInput i)
    {
        if (string.IsNullOrWhiteSpace(i.Description)) return "Informe a descrição.";
        if (i.AmountCents <= 0) return "O valor precisa ser maior que zero.";
        if (i.AmountCents > 100_000_000_000) return "Valor alto demais.";
        if (i.CategoryId is { } cid && !await db.Categories.AnyAsync(c => c.Id == cid && c.Kind == i.Kind))
            return "Pote inválido para este tipo.";
        // O filtro global garante que só objetivos do próprio espaço são aceitos.
        if (i.GoalId is { } gid && (i.Kind != EntryKind.Expense || !await db.Goals.AnyAsync(g => g.Id == gid)))
            return "Objetivo inválido (só despesas podem contar para um objetivo).";
        if (i.Repeat is { EndDate: { } end } && end < i.DueDate) return "O fim da recorrência é antes do primeiro vencimento.";
        return null;
    }

    private static void Apply(Entry e, EntryInput i)
    {
        e.Kind = i.Kind;
        e.Description = i.Description.Trim();
        e.AmountCents = i.AmountCents;
        e.DueDate = i.DueDate;
        e.CategoryId = i.CategoryId;
        e.GoalId = i.GoalId;
        e.Counterparty = Clean(i.Counterparty);
        e.Method = i.Method;
        e.Notes = Clean(i.Notes);
    }

    private static void MarkPaid(Entry e, DateOnly date, long? amount, bool offCash, string? offCashSource)
    {
        e.PaidDate = date;
        e.PaidAmountCents = amount is > 0 ? amount : e.AmountCents;
        e.OffCash = offCash;
        e.OffCashSource = offCash && Clean(offCashSource) is { } src ? src[..Math.Min(120, src.Length)] : null;
    }

    private static void Unpay(Entry e)
    {
        e.PaidDate = null;
        e.PaidAmountCents = null;
        e.OffCash = false;
        e.OffCashSource = null;
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static void DeleteFile(string dataDir, string? relative)
    {
        if (relative is null) return;
        try { File.Delete(Path.Combine(dataDir, relative)); } catch (IOException) { }
    }
}
