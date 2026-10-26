using Finances.Server.Domain;

namespace Finances.Tests;

public class RecurrenceMathTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);

    [Fact]
    public void Monthly_on_31st_clamps_and_recovers_without_drift()
    {
        var dates = Enumerable.Range(0, 4).Select(n => RecurrenceMath.Occurrence(Frequency.Monthly, 1, D(2027, 1, 31), n)).ToArray();
        Assert.Equal([D(2027, 1, 31), D(2027, 2, 28), D(2027, 3, 31), D(2027, 4, 30)], dates);
    }

    [Fact]
    public void Installments_stop_at_count()
    {
        var (items, exhausted) = RecurrenceMath.Expand(Frequency.Monthly, 1, D(2026, 10, 10), null, 3, 0, D(2030, 1, 1));
        Assert.Equal(3, items.Count);
        Assert.True(exhausted);
        Assert.Equal(D(2026, 12, 10), items[^1].Date);
    }

    [Fact]
    public void Open_ended_series_stops_at_horizon_and_resumes_from_index()
    {
        var (first, done) = RecurrenceMath.Expand(Frequency.Weekly, 2, D(2026, 1, 1), null, null, 0, D(2026, 1, 31));
        Assert.False(done);
        Assert.Equal([0, 1, 2], first.Select(i => i.Index));
        var (next, _) = RecurrenceMath.Expand(Frequency.Weekly, 2, D(2026, 1, 1), null, null, 3, D(2026, 2, 28));
        Assert.Equal(D(2026, 2, 12), next[0].Date);
    }

    [Fact]
    public void End_date_is_inclusive()
    {
        var (items, exhausted) = RecurrenceMath.Expand(Frequency.Yearly, 1, D(2026, 3, 1), D(2028, 3, 1), null, 0, D(2040, 1, 1));
        Assert.Equal(3, items.Count);
        Assert.True(exhausted);
    }
}
