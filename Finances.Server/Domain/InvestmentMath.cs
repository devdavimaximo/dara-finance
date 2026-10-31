namespace Finances.Server.Domain;

/// <summary>Efeito de uma aplicação no saldo de caixa num dia.</summary>
public record CashEffect(Guid InvestmentId, DateOnly Date, long AmountCents);

/// <summary>
/// Como os movimentos de uma aplicação mexem no caixa. Espelho de <c>web/src/lib/investments.ts</c>.
///
/// Cada movimento tem duas metades: o que entrou/saiu do banco (<c>bank</c>) e quanto mudou o valor
/// da aplicação (<c>dV</c>). Aplicação fora do caixa: o caixa só vê <c>bank</c>. Aplicação que conta
/// no caixa: o caixa vê <c>bank + dV</c> (aporte do caixa = troca de lugar, rendimento = saldo maior).
/// Antes da data do saldo inicial, <c>bank</c> já está no saldo informado; o <c>dV</c> acumulado
/// (o que já estava aplicado) entra no próprio dia do saldo inicial.
/// </summary>
public static class InvestmentMath
{
    /// <summary>No mesmo dia, aportes/resgates vêm antes da atualização ("aportei 1.000 e hoje vale 1.000").</summary>
    public static IEnumerable<InvestmentMove> Ordered(IEnumerable<InvestmentMove> moves) =>
        moves.OrderBy(m => m.Date).ThenBy(m => m.Kind == InvestmentMoveKind.Valuation ? 1 : 0).ThenBy(m => m.CreatedAt);

    public static IEnumerable<CashEffect> CashEffects(Investment inv, IEnumerable<InvestmentMove> moves, DateOnly openingDate)
    {
        long value = 0, carried = 0;
        foreach (var m in Ordered(moves))
        {
            var (bank, dV) = m.Kind switch
            {
                InvestmentMoveKind.Contribution => (m.Origin == ContributionOrigin.Cash ? -m.AmountCents : 0, m.AmountCents),
                InvestmentMoveKind.Withdrawal => (m.ToCash ? m.AmountCents : 0, -m.AmountCents),
                InvestmentMoveKind.Income => (m.AmountCents, 0L),
                _ => (0L, m.AmountCents - value),
            };
            value += dV;
            var shown = inv.CountsInCash ? dV : 0;
            if (m.Date < openingDate) { carried += shown; continue; }
            if (bank + shown != 0) yield return new(inv.Id, m.Date, bank + shown);
        }
        if (carried != 0) yield return new(inv.Id, openingDate, carried);
    }
}
