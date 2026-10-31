using Finances.Server.Data;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Api;

public record GoalInput(string Name, string? Icon, int Color, long TargetCents, DateOnly? TargetDate, string? Notes, bool Archived);
/// <summary>
/// Objetivo com os totais de TODO o histórico (não só da janela do painel):
/// pago = ligadas já pagas (pelo valor pago); agendado = ligadas em aberto; atrasado ⊂ agendado.
/// </summary>
/// <remarks>SavedCents = valor atual das aplicações ligadas (dinheiro guardado para pagar o que falta).</remarks>
public record GoalDto(
    Guid Id, string Name, string Icon, int Color, long TargetCents, DateOnly? TargetDate, string? Notes, bool Archived,
    long PaidCents, long ScheduledCents, long OverdueCents, int PaidCount, int OpenCount, DateOnly? NextDue, DateOnly? LastDue,
    long SavedCents);

public static class GoalsApi
{
    public static void Map(RouteGroupBuilder api)
    {
        var w = api.MapGroup("/w/{workspaceId:guid}/goals").RequireAuthorization().AddEndpointFilter<WorkspaceFilter>();

        w.MapGet("/", async (AppDb db, Clock clock, RecurrenceService rec) =>
        {
            await rec.EnsureHorizonAsync();
            var goals = await db.Goals.AsNoTracking().OrderBy(g => g.Archived).ThenBy(g => g.CreatedAt).ToListAsync();
            var stats = await Stats(db, clock.Today);
            var saved = await Saved(db);
            return goals.Select(g => ToDto(g, stats.GetValueOrDefault(g.Id), saved.GetValueOrDefault(g.Id)));
        });

        // Todas as despesas ligadas, de qualquer época, para a tela do objetivo.
        w.MapGet("/{id:guid}/entries", async (Guid id, AppDb db) =>
        {
            if (!await db.Goals.AnyAsync(g => g.Id == id)) return Results.NotFound();
            var items = await db.Entries.AsNoTracking().Include(e => e.Recurrence)
                .Where(e => e.GoalId == id).OrderBy(e => e.DueDate).ToListAsync();
            return Results.Ok(items.Select(EntriesApi.ToDto));
        });

        w.MapPost("/", async (GoalInput input, AppDb db) =>
        {
            if (Validate(input) is { } err) return Results.BadRequest(new { error = err });
            var g = new Goal();
            Apply(g, input);
            db.Goals.Add(g);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(g, null, 0));
        });

        w.MapPut("/{id:guid}", async (Guid id, GoalInput input, AppDb db, Clock clock) =>
        {
            var g = await db.Goals.FirstOrDefaultAsync(x => x.Id == id);
            if (g is null) return Results.NotFound();
            if (Validate(input) is { } err) return Results.BadRequest(new { error = err });
            Apply(g, input);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(g, (await Stats(db, clock.Today)).GetValueOrDefault(g.Id), (await Saved(db)).GetValueOrDefault(g.Id)));
        });

        // Os lançamentos continuam existindo; só deixam de contar para o objetivo.
        w.MapDelete("/{id:guid}", async (Guid id, AppDb db) =>
        {
            var g = await db.Goals.FirstOrDefaultAsync(x => x.Id == id);
            if (g is null) return Results.NotFound();
            await db.Entries.Where(e => e.GoalId == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.GoalId, (Guid?)null));
            await db.Recurrences.Where(r => r.GoalId == id).ExecuteUpdateAsync(s => s.SetProperty(r => r.GoalId, (Guid?)null));
            await db.Investments.Where(i => i.GoalId == id).ExecuteUpdateAsync(s => s.SetProperty(i => i.GoalId, (Guid?)null));
            db.Goals.Remove(g);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private record Agg(long Paid, long Scheduled, long Overdue, int PaidCount, int OpenCount, DateOnly? NextDue, DateOnly? LastDue);

    private static async Task<Dictionary<Guid, Agg>> Stats(AppDb db, DateOnly today)
    {
        var rows = await db.Entries.AsNoTracking().Where(e => e.GoalId != null && e.Kind == EntryKind.Expense)
            .Select(e => new { GoalId = e.GoalId!.Value, e.AmountCents, e.PaidAmountCents, e.PaidDate, e.DueDate })
            .ToListAsync();
        return rows.GroupBy(r => r.GoalId).ToDictionary(g => g.Key, g =>
        {
            var open = g.Where(r => r.PaidDate == null).ToList();
            return new Agg(
                g.Where(r => r.PaidDate != null).Sum(r => r.PaidAmountCents ?? r.AmountCents),
                open.Sum(r => r.AmountCents),
                open.Where(r => r.DueDate < today).Sum(r => r.AmountCents),
                g.Count(r => r.PaidDate != null),
                open.Count,
                open.Where(r => r.DueDate >= today).Select(r => (DateOnly?)r.DueDate).Min(),
                g.Max(r => (DateOnly?)r.DueDate));
        });
    }

    /// <summary>Valor atual somado das aplicações ligadas a cada objetivo.</summary>
    private static async Task<Dictionary<Guid, long>> Saved(AppDb db)
    {
        var linked = await db.Investments.AsNoTracking().Where(i => i.GoalId != null).Select(i => new { i.Id, GoalId = i.GoalId!.Value }).ToListAsync();
        if (linked.Count == 0) return [];
        var ids = linked.Select(i => i.Id).ToList();
        var moves = (await db.InvestmentMoves.AsNoTracking().Where(m => ids.Contains(m.InvestmentId)).ToListAsync()).ToLookup(m => m.InvestmentId);
        return linked.GroupBy(i => i.GoalId).ToDictionary(g => g.Key, g => g.Sum(i => Math.Max(0, InvestmentMath.CurrentValue(moves[i.Id]))));
    }

    private static GoalDto ToDto(Goal g, Agg? s, long saved) => new(
        g.Id, g.Name, g.Icon, g.Color, g.TargetCents, g.TargetDate, g.Notes, g.Archived,
        s?.Paid ?? 0, s?.Scheduled ?? 0, s?.Overdue ?? 0, s?.PaidCount ?? 0, s?.OpenCount ?? 0, s?.NextDue, s?.LastDue, saved);

    private static string? Validate(GoalInput i)
    {
        if (string.IsNullOrWhiteSpace(i.Name)) return "Dê um nome ao objetivo.";
        if (i.TargetCents <= 0) return "Informe quanto o objetivo custa no total.";
        if (i.TargetCents > 100_000_000_000) return "Valor alto demais.";
        return null;
    }

    private static void Apply(Goal g, GoalInput i)
    {
        g.Name = i.Name.Trim()[..Math.Min(80, i.Name.Trim().Length)];
        g.Icon = string.IsNullOrWhiteSpace(i.Icon) ? "target" : i.Icon;
        g.Color = Math.Clamp(i.Color, 1, 8);
        g.TargetCents = i.TargetCents;
        g.TargetDate = i.TargetDate;
        g.Notes = string.IsNullOrWhiteSpace(i.Notes) ? null : i.Notes.Trim();
        g.Archived = i.Archived;
    }
}
