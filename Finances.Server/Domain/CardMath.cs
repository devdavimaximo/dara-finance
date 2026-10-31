namespace Finances.Server.Domain;

/// <summary>Em qual fatura cai uma compra. Espelho de <c>web/src/lib/cards.ts</c> (o otimista do aparelho usa a mesma regra).</summary>
public static class CardMath
{
    private static DateOnly Day(int year, int month, int day) => new(year, month, Math.Min(day, DateTime.DaysInMonth(year, month)));

    /// <summary>Fechamento da fatura em que a compra entra: compra antes do dia de fechamento fica neste mês; no dia ou depois, no próximo.</summary>
    public static DateOnly ClosingFor(Card card, DateOnly purchase)
    {
        var thisMonth = Day(purchase.Year, purchase.Month, card.ClosingDay);
        if (purchase < thisMonth) return thisMonth;
        var next = purchase.AddMonths(1);
        return Day(next.Year, next.Month, card.ClosingDay);
    }

    /// <summary>Vencimento da fatura: no mês do fechamento se o dia de vencimento vem depois; senão no mês seguinte.</summary>
    public static DateOnly InvoiceDue(Card card, DateOnly purchase)
    {
        var closing = ClosingFor(card, purchase);
        var month = card.DueDay > card.ClosingDay ? closing : closing.AddMonths(1);
        return Day(month.Year, month.Month, card.DueDay);
    }
}
