using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Data;

/// <summary>"Hoje" no fuso do negócio (padrão America/Sao_Paulo), não no fuso do servidor.</summary>
public class Clock(IConfiguration config)
{
    private readonly TimeZoneInfo _tz = Resolve(config["TZ"] ?? "America/Sao_Paulo");

    public DateTime Now => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, _tz);
    public DateOnly Today => DateOnly.FromDateTime(Now);

    private static TimeZoneInfo Resolve(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch { return TimeZoneInfo.CreateCustomTimeZone("BRT", TimeSpan.FromHours(-3), "BRT", "BRT"); }
    }
}

/// <summary>Materializa ocorrências de séries recorrentes até o horizonte (12 meses à frente).</summary>
public class RecurrenceService(AppDb db, Clock clock)
{
    public const int HorizonMonths = 12;

    public DateOnly Horizon => clock.Today.AddMonths(HorizonMonths);

    /// <summary>Chamado antes de leituras: garante que toda série ativa tenha ocorrências até o horizonte.</summary>
    public async Task EnsureHorizonAsync(CancellationToken ct = default)
    {
        var horizon = Horizon;
        var active = await db.Recurrences.Where(r => !r.Finished).ToListAsync(ct);
        var changed = false;
        foreach (var r in active)
            changed |= Materialize(r, horizon);
        if (changed) await db.SaveChangesAsync(ct);
    }

    /// <summary>Gera as Entries pendentes da série. Retorna true se algo mudou.</summary>
    public bool Materialize(Recurrence r, DateOnly horizon, Guid? firstId = null)
    {
        var (items, exhausted) = RecurrenceMath.Expand(
            r.Frequency, r.Interval, r.StartDate, r.EndDate, r.Count, r.GeneratedCount, horizon);

        foreach (var (index, date) in items)
        {
            db.Entries.Add(new Entry
            {
                Id = index == 0 && firstId is { } id ? id : Guid.NewGuid(),
                WorkspaceId = r.WorkspaceId,
                Kind = r.Kind,
                Description = r.Description,
                AmountCents = r.AmountCents,
                DueDate = date,
                CategoryId = r.CategoryId,
                GoalId = r.GoalId,
                Counterparty = r.Counterparty,
                Method = r.Method,
                RecurrenceId = r.Id,
                Sequence = index + 1,
            });
        }
        if (items.Count > 0) r.GeneratedCount = items[^1].Index + 1;
        if (exhausted) r.Finished = true;
        return items.Count > 0 || exhausted;
    }
}

public static class Seed
{
    /// <summary>Categorias iniciais por tipo de workspace. Cores seguem a ordem fixa da paleta.</summary>
    public static IEnumerable<Category> DefaultCategories(WorkspaceKind kind)
    {
        (string Name, string Icon, int Color)[] expenses = kind == WorkspaceKind.Business
            ? [("Ferramentas & SaaS", "cpu", 1), ("Marketing & Anúncios", "megaphone", 2), ("Impostos", "landmark", 3),
               ("Pró-labore", "user", 4), ("Contador & Jurídico", "scale", 5), ("Infraestrutura", "server", 6),
               ("Freelancers", "users", 7), ("Outros", "tag", 8)]
            : [("Moradia", "home", 1), ("Alimentação", "utensils", 2), ("Transporte", "car", 3),
               ("Saúde", "heart-pulse", 4), ("Lazer", "party-popper", 5), ("Educação", "graduation-cap", 6),
               ("Assinaturas", "repeat", 7), ("Outros", "tag", 8)];

        (string Name, string Icon, int Color)[] incomes = kind == WorkspaceKind.Business
            ? [("Projetos", "briefcase", 1), ("Mensalidades", "repeat", 3), ("Consultoria", "messages-square", 7), ("Outras receitas", "plus", 4)]
            : [("Salário / Pró-labore", "wallet", 1), ("Freelas", "laptop", 3), ("Investimentos", "trending-up", 7), ("Outras receitas", "plus", 4)];

        foreach (var (n, i, c) in expenses) yield return new Category { Name = n, Icon = i, Color = c, Kind = EntryKind.Expense };
        foreach (var (n, i, c) in incomes) yield return new Category { Name = n, Icon = i, Color = c, Kind = EntryKind.Income };
    }
}
