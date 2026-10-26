namespace Finances.Server.Domain;

/// <summary>Regras puras de recorrência — sem banco, testáveis.</summary>
public static class RecurrenceMath
{
    /// <summary>
    /// Data da ocorrência n (0-based). Sempre calculada a partir do início — nunca encadeada —
    /// para que o dia 31 vire 28/29 em fevereiro e volte a 31 em março, sem deriva.
    /// </summary>
    public static DateOnly Occurrence(Frequency frequency, int interval, DateOnly start, int n)
    {
        var step = Math.Max(1, interval) * n;
        return frequency switch
        {
            Frequency.Weekly => start.AddDays(7 * step),
            Frequency.Monthly => start.AddMonths(step),
            Frequency.Yearly => start.AddMonths(12 * step),
            _ => throw new ArgumentOutOfRangeException(nameof(frequency)),
        };
    }

    /// <summary>
    /// Próximas ocorrências a materializar, a partir do índice <paramref name="from"/>, até o horizonte.
    /// <c>exhausted</c> = a série acabou (Count ou EndDate atingidos).
    /// </summary>
    public static (List<(int Index, DateOnly Date)> Items, bool Exhausted) Expand(
        Frequency frequency, int interval, DateOnly start, DateOnly? end, int? count, int from, DateOnly horizon)
    {
        var items = new List<(int, DateOnly)>();
        for (var n = from; ; n++)
        {
            if (count is { } c && n >= c) return (items, true);
            var date = Occurrence(frequency, interval, start, n);
            if (end is { } e && date > e) return (items, true);
            if (date > horizon) return (items, false);
            items.Add((n, date));
        }
    }
}
