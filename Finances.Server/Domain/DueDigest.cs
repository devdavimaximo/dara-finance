using System.Globalization;

namespace Finances.Server.Domain;

public record DueItem(string Workspace, EntryKind Kind, string Description, long AmountCents, DateOnly DueDate);

/// <summary>Monta o texto do aviso diário de vencimentos. Puro, testável.</summary>
public static class DueDigest
{
    private static readonly CultureInfo Pt = CultureInfo.GetCultureInfo("pt-BR");

    public static string Money(long cents) => (cents / 100m).ToString("C", Pt);

    private static string When(DateOnly due, DateOnly today) => (due.DayNumber - today.DayNumber) switch
    {
        < 0 and var d => $"atrasada {-d}d",
        0 => "hoje",
        1 => "amanhã",
        var d => $"em {d} dias",
    };

    /// <summary>
    /// Null quando não há nada a avisar. Itens: em aberto vencendo até today+daysAhead, inclusive atrasados.
    /// </summary>
    public static (string Title, string Body)? Build(IReadOnlyList<DueItem> items, DateOnly today, bool includeEmpty = false)
    {
        var pay = items.Where(i => i.Kind == EntryKind.Expense).ToList();
        var receive = items.Where(i => i.Kind == EntryKind.Income).ToList();
        var overdue = pay.Where(i => i.DueDate < today).ToList();
        var upcoming = pay.Where(i => i.DueDate >= today).ToList();

        if (items.Count == 0)
            return includeEmpty ? ("Tudo em dia ✓", "Nenhuma conta vencendo nos próximos dias.") : null;

        string title;
        if (upcoming.Count > 0)
        {
            var first = upcoming.Min(i => i.DueDate);
            var sameDay = upcoming.Where(i => i.DueDate == first).ToList();
            title = $"{(first == today ? "Hoje" : first == today.AddDays(1) ? "Amanhã" : $"Dia {first:dd/MM}")}: " +
                    $"{sameDay.Count} conta{(sameDay.Count > 1 ? "s" : "")} · {Money(sameDay.Sum(i => i.AmountCents))}";
        }
        else if (overdue.Count > 0)
            title = $"{overdue.Count} conta{(overdue.Count > 1 ? "s" : "")} atrasada{(overdue.Count > 1 ? "s" : "")} · {Money(overdue.Sum(i => i.AmountCents))}";
        else
            title = $"A receber: {Money(receive.Sum(i => i.AmountCents))}";

        var multi = items.Select(i => i.Workspace).Distinct().Count() > 1;
        var lines = items
            .OrderBy(i => i.DueDate).ThenByDescending(i => i.AmountCents)
            .Take(4)
            .Select(i => $"{(multi ? i.Workspace + " · " : "")}{i.Description} — " +
                         $"{(i.Kind == EntryKind.Income ? "receber " : "")}{Money(i.AmountCents)} ({When(i.DueDate, today)})")
            .ToList();
        if (items.Count > 4) lines.Add($"+{items.Count - 4} outro(s)");
        if (overdue.Count > 0 && upcoming.Count > 0)
            lines.Add($"⚠ {overdue.Count} atrasada(s): {Money(overdue.Sum(i => i.AmountCents))}");
        return (title, string.Join("\n", lines));
    }
}
