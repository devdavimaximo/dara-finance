using Finances.Server.Data;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Api;

/// <summary>Aporte programado: os três campos juntos, ou nenhum.</summary>
public record PlanInput(long AmountCents, int Day, DateOnly Start);
public record InvestmentInput(
    string Name, InvestmentKind Kind, string? Institution, int Color, bool CountsInCash, string? Notes, bool Archived,
    Guid? GoalId = null, PlanInput? Plan = null);
public record MoveInput(
    InvestmentMoveKind Kind, DateOnly Date, long AmountCents, ContributionOrigin? Origin = null, bool ToCash = true, string? Notes = null,
    /// <summary>Resgate de tudo: grava também "vale 0" no mesmo dia (a aplicação zera e o ganho fecha).</summary>
    bool CloseOut = false,
    /// <summary>Aporte que confirma a ocorrência do aporte programado desta data.</summary>
    DateOnly? PlanDate = null);
public record MoveDto(Guid Id, InvestmentMoveKind Kind, DateOnly Date, long AmountCents, ContributionOrigin? Origin, bool ToCash, string? Notes, DateOnly? PlanDate);
/// <summary>A aplicação com o histórico inteiro: valor, ganho e rentabilidade saem dele no front (investments.ts).</summary>
public record InvestmentDto(
    Guid Id, string Name, InvestmentKind Kind, string? Institution, int Color, bool CountsInCash, string? Notes, bool Archived,
    Guid? GoalId, PlanInput? Plan, IEnumerable<MoveDto> Moves);

public static class InvestmentsApi
{
    public static void Map(RouteGroupBuilder api)
    {
        var w = api.MapGroup("/w/{workspaceId:guid}/investments").RequireAuthorization().AddEndpointFilter<WorkspaceFilter>();

        w.MapGet("/", async (AppDb db) =>
        {
            var list = await db.Investments.AsNoTracking().OrderBy(i => i.Archived).ThenBy(i => i.CreatedAt).ToListAsync();
            var moves = (await db.InvestmentMoves.AsNoTracking().ToListAsync()).ToLookup(m => m.InvestmentId);
            return list.Select(i => ToDto(i, moves[i.Id]));
        });

        w.MapPost("/", async (InvestmentInput input, AppDb db) =>
        {
            if (await Validate(db, input) is { } err) return Results.BadRequest(new { error = err });
            var inv = new Investment();
            Apply(inv, input);
            db.Investments.Add(inv);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(inv, []));
        });

        w.MapPut("/{id:guid}", async (Guid id, InvestmentInput input, AppDb db) =>
        {
            var inv = await db.Investments.FirstOrDefaultAsync(x => x.Id == id);
            if (inv is null) return Results.NotFound();
            if (await Validate(db, input) is { } err) return Results.BadRequest(new { error = err });
            Apply(inv, input);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(inv, await db.InvestmentMoves.AsNoTracking().Where(m => m.InvestmentId == id).ToListAsync()));
        });

        // Some com o histórico; o caixa volta a ser como se a aplicação nunca tivesse existido.
        w.MapDelete("/{id:guid}", async (Guid id, AppDb db) =>
        {
            var inv = await db.Investments.FirstOrDefaultAsync(x => x.Id == id);
            if (inv is null) return Results.NotFound();
            await db.InvestmentMoves.Where(m => m.InvestmentId == id).ExecuteDeleteAsync();
            db.Investments.Remove(inv);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        w.MapPost("/{id:guid}/moves", async (Guid id, MoveInput input, AppDb db, Clock clock) =>
        {
            if (!await db.Investments.AnyAsync(x => x.Id == id)) return Results.NotFound();
            if (Validate(input, clock.Today) is { } err) return Results.BadRequest(new { error = err });
            var move = new InvestmentMove { InvestmentId = id };
            Apply(move, input);
            db.InvestmentMoves.Add(move);
            if (input is { Kind: InvestmentMoveKind.Withdrawal, CloseOut: true })
                db.InvestmentMoves.Add(new InvestmentMove { InvestmentId = id, Kind = InvestmentMoveKind.Valuation, Date = input.Date, AmountCents = 0, Notes = "Resgate total" });
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(move));
        });

        w.MapPut("/{id:guid}/moves/{moveId:guid}", async (Guid id, Guid moveId, MoveInput input, AppDb db, Clock clock) =>
        {
            var move = await db.InvestmentMoves.FirstOrDefaultAsync(m => m.Id == moveId && m.InvestmentId == id);
            if (move is null) return Results.NotFound();
            if (Validate(input, clock.Today) is { } err) return Results.BadRequest(new { error = err });
            Apply(move, input);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(move));
        });

        w.MapDelete("/{id:guid}/moves/{moveId:guid}", async (Guid id, Guid moveId, AppDb db) =>
        {
            var n = await db.InvestmentMoves.Where(m => m.Id == moveId && m.InvestmentId == id).ExecuteDeleteAsync();
            return n == 0 ? Results.NotFound() : Results.NoContent();
        });

        // CDI diário desde `from` (referência pública, igual para todos os espaços). Máx. 15 anos.
        api.MapGet("/cdi", async (DateOnly from, CdiService cdi, Clock clock) =>
        {
            var min = clock.Today.AddYears(-15);
            var rates = await cdi.RatesFromAsync(from < min ? min : from);
            return rates.Select(r => new { date = r.Date, rate = r.RatePercent });
        }).RequireAuthorization();
    }

    /// <summary>Todos os efeitos das aplicações do espaço atual no caixa (ver <see cref="InvestmentMath"/>).</summary>
    internal static async Task<List<CashEffect>> CashEffectsAsync(AppDb db, DateOnly openingDate)
    {
        var list = await db.Investments.AsNoTracking().ToListAsync();
        if (list.Count == 0) return [];
        var moves = (await db.InvestmentMoves.AsNoTracking().ToListAsync()).ToLookup(m => m.InvestmentId);
        return list.SelectMany(i => InvestmentMath.CashEffects(i, moves[i.Id], openingDate)).ToList();
    }

    private static MoveDto ToDto(InvestmentMove m) => new(m.Id, m.Kind, m.Date, m.AmountCents, m.Origin, m.ToCash, m.Notes, m.PlanDate);

    private static InvestmentDto ToDto(Investment i, IEnumerable<InvestmentMove> moves) => new(
        i.Id, i.Name, i.Kind, i.Institution, i.Color, i.CountsInCash, i.Notes, i.Archived, i.GoalId,
        i is { PlanAmountCents: { } a, PlanDay: { } d, PlanStart: { } s } ? new PlanInput(a, d, s) : null,
        InvestmentMath.Ordered(moves).Select(ToDto));

    private static async Task<string?> Validate(AppDb db, InvestmentInput i)
    {
        if (string.IsNullOrWhiteSpace(i.Name)) return "Dê um nome à aplicação.";
        // O filtro global garante que só objetivos do próprio espaço são aceitos.
        if (i.GoalId is { } gid && !await db.Goals.AnyAsync(g => g.Id == gid)) return "Objetivo inválido.";
        if (i.Plan is { } p)
        {
            if (p.AmountCents <= 0 || p.AmountCents > 100_000_000_000) return "Informe o valor do aporte programado.";
            if (p.Day is < 1 or > 31) return "Dia do aporte programado inválido.";
        }
        return null;
    }

    private static string? Validate(MoveInput i, DateOnly today)
    {
        if (i.Kind == InvestmentMoveKind.Valuation ? i.AmountCents < 0 : i.AmountCents <= 0) return "Informe um valor maior que zero.";
        if (i.AmountCents > 100_000_000_000) return "Valor alto demais.";
        // Futuro não existe para investimento: o valor de amanhã ninguém sabe.
        if (i.Date > today) return "A data não pode ser no futuro.";
        return null;
    }

    private static void Apply(Investment inv, InvestmentInput i)
    {
        inv.Name = i.Name.Trim()[..Math.Min(80, i.Name.Trim().Length)];
        inv.Kind = i.Kind;
        inv.Institution = Clean(i.Institution, 80);
        inv.Color = Math.Clamp(i.Color, 1, 8);
        inv.CountsInCash = i.CountsInCash;
        inv.Notes = Clean(i.Notes, 1000);
        inv.Archived = i.Archived;
        inv.GoalId = i.GoalId;
        inv.PlanAmountCents = i.Plan?.AmountCents;
        inv.PlanDay = i.Plan?.Day;
        inv.PlanStart = i.Plan?.Start;
    }

    private static void Apply(InvestmentMove m, MoveInput i)
    {
        m.Kind = i.Kind;
        m.Date = i.Date;
        m.AmountCents = i.AmountCents;
        m.Origin = i.Kind == InvestmentMoveKind.Contribution ? i.Origin ?? ContributionOrigin.Cash : null;
        m.ToCash = i.Kind == InvestmentMoveKind.Withdrawal && i.ToCash;
        m.PlanDate = i.Kind == InvestmentMoveKind.Contribution ? i.PlanDate : null;
        m.Notes = Clean(i.Notes, 300);
    }

    private static string? Clean(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Trim()[..Math.Min(max, s.Trim().Length)];
}
