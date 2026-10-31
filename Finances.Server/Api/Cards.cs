using System.Security.Claims;
using Finances.Server.Data;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Api;

public record CardInput(string Name, int ClosingDay, int DueDay, int Color, bool Archived);
public record CardDto(Guid Id, string Name, int ClosingDay, int DueDay, int Color, bool Archived);

/// <summary>
/// Transferência entre espaços (ex.: pró-labore Metup → Pessoal): despesa na origem e receita no destino,
/// criadas juntas e ligadas pelo mesmo TransferId. Depois disso cada lado vive por conta própria.
/// </summary>
public record TransferInput(
    Guid FromWorkspaceId, Guid ToWorkspaceId, string Description, long AmountCents, DateOnly Date, bool Paid,
    Guid? FromCategoryId = null, Guid? ToCategoryId = null);

public static class CardsApi
{
    public static void Map(RouteGroupBuilder api)
    {
        var w = api.MapGroup("/w/{workspaceId:guid}/cards").RequireAuthorization().AddEndpointFilter<WorkspaceFilter>();

        w.MapGet("/", async (AppDb db) =>
            (await db.Cards.AsNoTracking().OrderBy(c => c.Archived).ThenBy(c => c.Name).ToListAsync()).Select(ToDto));

        w.MapPost("/", async (CardInput input, AppDb db) =>
        {
            if (Validate(input) is { } err) return Results.BadRequest(new { error = err });
            var c = new Card();
            Apply(c, input);
            db.Cards.Add(c);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(c));
        });

        // Mudar fechamento/vencimento vale para compras novas; as já lançadas ficam na fatura em que estão.
        w.MapPut("/{id:guid}", async (Guid id, CardInput input, AppDb db) =>
        {
            var c = await db.Cards.FirstOrDefaultAsync(x => x.Id == id);
            if (c is null) return Results.NotFound();
            if (Validate(input) is { } err) return Results.BadRequest(new { error = err });
            Apply(c, input);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(c));
        });

        // As compras continuam existindo (com o mesmo vencimento); só deixam de ser "do cartão".
        w.MapDelete("/{id:guid}", async (Guid id, AppDb db) =>
        {
            var c = await db.Cards.FirstOrDefaultAsync(x => x.Id == id);
            if (c is null) return Results.NotFound();
            await db.Entries.Where(e => e.CardId == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.CardId, (Guid?)null));
            await db.Recurrences.Where(r => r.CardId == id).ExecuteUpdateAsync(s => s.SetProperty(r => r.CardId, (Guid?)null));
            db.Cards.Remove(c);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapPost("/transfers", async (TransferInput input, ClaimsPrincipal p, AppDb db, TenantContext tenant, Clock clock) =>
        {
            if (input.FromWorkspaceId == input.ToWorkspaceId) return Results.BadRequest(new { error = "Escolha dois espaços diferentes." });
            if (string.IsNullOrWhiteSpace(input.Description)) return Results.BadRequest(new { error = "Informe a descrição." });
            if (input.AmountCents is <= 0 or > 100_000_000_000) return Results.BadRequest(new { error = "Informe o valor." });

            var userId = p.UserId();
            var spaces = await db.Memberships.AsNoTracking().Include(m => m.Workspace)
                .Where(m => m.UserId == userId && (m.WorkspaceId == input.FromWorkspaceId || m.WorkspaceId == input.ToWorkspaceId))
                .ToDictionaryAsync(m => m.WorkspaceId, m => m.Workspace!.Name);
            // Sem acesso a algum dos dois = 404 (não revela que o espaço existe).
            if (spaces.Count != 2) return Results.NotFound();

            var transferId = Guid.NewGuid();
            var previous = tenant.WorkspaceId;
            try
            {
                var created = new List<Entry>();
                foreach (var (wid, kind, categoryId, other) in new[]
                {
                    (input.FromWorkspaceId, EntryKind.Expense, input.FromCategoryId, input.ToWorkspaceId),
                    (input.ToWorkspaceId, EntryKind.Income, input.ToCategoryId, input.FromWorkspaceId),
                })
                {
                    // Cada lado é gravado dentro do seu espaço: filtro e guarda do AppDb valem normalmente.
                    tenant.WorkspaceId = wid;
                    if (categoryId is { } cid && !await db.Categories.AnyAsync(c => c.Id == cid && c.Kind == kind))
                        return Results.BadRequest(new { error = "Pote inválido para este espaço." });
                    var e = new Entry
                    {
                        Kind = kind, Description = input.Description.Trim()[..Math.Min(140, input.Description.Trim().Length)],
                        AmountCents = input.AmountCents, DueDate = input.Date, CategoryId = categoryId,
                        Counterparty = spaces[other], Method = PaymentMethod.Transfer, TransferId = transferId,
                    };
                    if (input.Paid) { e.PaidDate = input.Date <= clock.Today ? input.Date : clock.Today; e.PaidAmountCents = input.AmountCents; }
                    db.Entries.Add(e);
                    await db.SaveChangesAsync();
                    created.Add(e);
                }
                return Results.Ok(new { transferId, entries = created.Select(EntriesApi.ToDto) });
            }
            finally { tenant.WorkspaceId = previous; }
        }).RequireAuthorization();
    }

    private static CardDto ToDto(Card c) => new(c.Id, c.Name, c.ClosingDay, c.DueDay, c.Color, c.Archived);

    private static string? Validate(CardInput i)
    {
        if (string.IsNullOrWhiteSpace(i.Name)) return "Dê um nome ao cartão.";
        if (i.ClosingDay is < 1 or > 31 || i.DueDay is < 1 or > 31) return "Dias de fechamento e vencimento vão de 1 a 31.";
        return null;
    }

    private static void Apply(Card c, CardInput i)
    {
        c.Name = i.Name.Trim()[..Math.Min(60, i.Name.Trim().Length)];
        c.ClosingDay = i.ClosingDay;
        c.DueDay = i.DueDay;
        c.Color = Math.Clamp(i.Color, 1, 8);
        c.Archived = i.Archived;
    }
}
