using Finances.Server.Domain;

namespace Finances.Tests;

public class InvestmentMathTests
{
    private static readonly DateOnly Opening = new(2026, 1, 1);
    private static DateOnly D(int month, int day, int year = 2026) => new(year, month, day);

    private static InvestmentMove Move(InvestmentMoveKind kind, DateOnly date, long cents, ContributionOrigin? origin = null, bool toCash = false) =>
        new() { Kind = kind, Date = date, AmountCents = cents, Origin = origin, ToCash = toCash };

    private static List<(DateOnly, long)> Effects(bool countsInCash, params InvestmentMove[] moves) =>
        InvestmentMath.CashEffects(new Investment { CountsInCash = countsInCash }, moves, Opening).Select(e => (e.Date, e.AmountCents)).ToList();

    [Fact]
    public void Outside_cash_only_money_in_and_out_of_the_bank_counts()
    {
        var fx = Effects(false,
            Move(InvestmentMoveKind.Contribution, D(2, 1), 1000_00, ContributionOrigin.Cash),
            Move(InvestmentMoveKind.Contribution, D(2, 1), 500_00, ContributionOrigin.External),
            Move(InvestmentMoveKind.Contribution, D(3, 1), 20_00, ContributionOrigin.Reinvest),
            Move(InvestmentMoveKind.Valuation, D(4, 1), 1600_00),
            Move(InvestmentMoveKind.Income, D(4, 15), 30_00),
            Move(InvestmentMoveKind.Withdrawal, D(5, 1), 400_00, toCash: true),
            Move(InvestmentMoveKind.Withdrawal, D(5, 2), 100_00, toCash: false));
        Assert.Equal([(D(2, 1), -1000_00), (D(4, 15), 30_00), (D(5, 1), 400_00)], fx);
    }

    [Fact]
    public void Counting_in_cash_turns_moves_into_a_change_of_place_and_shows_the_yield()
    {
        var fx = Effects(true,
            Move(InvestmentMoveKind.Contribution, D(2, 1), 1000_00, ContributionOrigin.Cash),
            Move(InvestmentMoveKind.Valuation, D(2, 1), 1000_00), // "aportei e hoje vale isso": nada muda
            Move(InvestmentMoveKind.Valuation, D(3, 1), 1050_00),
            Move(InvestmentMoveKind.Contribution, D(3, 10), 200_00, ContributionOrigin.External),
            Move(InvestmentMoveKind.Withdrawal, D(4, 1), 300_00, toCash: true));
        Assert.Equal([(D(3, 1), 50_00), (D(3, 10), 200_00)], fx);
    }

    [Fact]
    public void History_before_the_opening_balance_lands_on_the_opening_day_only_when_counting_in_cash()
    {
        var before = new[]
        {
            Move(InvestmentMoveKind.Contribution, D(6, 1, 2025), 2000_00, ContributionOrigin.Cash),
            Move(InvestmentMoveKind.Valuation, D(12, 1, 2025), 2100_00),
        };
        // O saldo inicial informado já reflete o que saiu do banco; o que estava aplicado, não.
        Assert.Empty(Effects(false, before));
        Assert.Equal([(Opening, 2100_00)], Effects(true, before));
    }
}

public class InvestmentsApiTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(-3));
    private static string D(int days) => Today.AddDays(days).ToString("yyyy-MM-dd");

    private static object Inv(string name, bool countsInCash = false) =>
        new { name, kind = "Cdb", institution = "Banco", color = 2, countsInCash, notes = (string?)null, archived = false };

    [Fact]
    public async Task Moves_feed_the_cash_balance_and_the_toggle_switches_how()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup("Pessoal");
        await api.Put($"/w/{wid}/", new { name = "Pessoal", openingBalanceCents = 10000_00, openingBalanceDate = D(-30) });

        var iid = (await api.Post($"/w/{wid}/investments", Inv("CDB 110%"))).S("id");
        await api.Post($"/w/{wid}/investments/{iid}/moves", new { kind = "Contribution", date = D(-10), amountCents = 2000_00, origin = "Cash" });
        await api.Post($"/w/{wid}/investments/{iid}/moves", new { kind = "Valuation", date = D(-1), amountCents = 2100_00 });

        // Fora do caixa: o aporte saiu do saldo, o rendimento não aparece.
        Assert.Equal(8000_00, (await api.Get($"/w/{wid}/entries?from={D(0)}&to={D(1)}")).L("balanceBefore"));
        var window = await api.Get($"/w/{wid}/entries?from={D(-20)}&to={D(0)}");
        Assert.Equal(10000_00, window.L("balanceBefore"));
        var flow = window.A("flows").Single()!;
        Assert.Equal(D(-10), flow.S("date"));
        Assert.Equal(-2000_00, flow.L("amountCents"));

        // Contando no caixa: o aporte vira troca de lugar e o ganho de 100 entra no saldo.
        await api.Put($"/w/{wid}/investments/{iid}", Inv("CDB 110%", countsInCash: true));
        Assert.Equal(10100_00, (await api.Get($"/w/{wid}/entries?from={D(0)}&to={D(1)}")).L("balanceBefore"));

        var listed = (await api.Get($"/w/{wid}/investments")).AsArray().Single()!;
        Assert.Equal(2, listed.A("moves").Count);
        Assert.Equal("Contribution", listed.A("moves")[0]!.S("kind"));

        // Excluir a aplicação apaga o histórico e o caixa volta ao original.
        await api.Ok(HttpMethod.Delete, $"/w/{wid}/investments/{iid}");
        Assert.Equal(10000_00, (await api.Get($"/w/{wid}/entries?from={D(0)}&to={D(1)}")).L("balanceBefore"));
    }

    [Fact]
    public async Task Total_withdrawal_zeroes_the_investment_and_bad_moves_are_refused()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup("Pessoal");
        var iid = (await api.Post($"/w/{wid}/investments", Inv("Tesouro Selic"))).S("id");
        await api.Post($"/w/{wid}/investments/{iid}/moves", new { kind = "Contribution", date = D(0), amountCents = 1000_00, origin = "External" });
        await api.Post($"/w/{wid}/investments/{iid}/moves", new { kind = "Withdrawal", date = D(0), amountCents = 1010_00, toCash = true, closeOut = true });

        var moves = (await api.Get($"/w/{wid}/investments")).AsArray().Single()!.A("moves");
        Assert.Equal(3, moves.Count);
        Assert.Equal("Valuation", moves[2]!.S("kind"));
        Assert.Equal(0, moves[2]!.L("amountCents"));

        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{wid}/investments/{iid}/moves", new { kind = "Valuation", date = D(1), amountCents = 10 })).Status);
        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{wid}/investments/{iid}/moves", new { kind = "Contribution", date = D(0), amountCents = 0 })).Status);
        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{wid}/investments", Inv(" "))).Status);
    }

    [Fact]
    public async Task Cdi_is_fetched_once_cached_and_backfilled_only_for_the_missing_range()
    {
        await using var app = new TestApp();
        var api = app.Client();
        Assert.Equal(401, (await api.Send(HttpMethod.Get, $"/cdi?from={D(-10)}")).Status);
        await api.Setup("Pessoal");

        var rates = (await api.Get($"/cdi?from={D(-20)}")).AsArray();
        Assert.NotEmpty(rates);
        Assert.All(rates, r => Assert.Equal(0.04, r!["rate"]!.GetValue<double>(), 6));
        Assert.Single(app.Bcb.Requests);

        // Mesmo intervalo de novo: vem do banco local.
        await api.Get($"/cdi?from={D(-20)}");
        Assert.Single(app.Bcb.Requests);

        // Mais para trás: busca só o pedaço que falta.
        var older = (await api.Get($"/cdi?from={D(-40)}")).AsArray();
        Assert.Equal(2, app.Bcb.Requests.Count);
        Assert.Equal(Today.AddDays(-40), app.Bcb.Requests[1].From);
        Assert.True(app.Bcb.Requests[1].To < Today.AddDays(-19));
        Assert.True(older.Count > rates.Count);
    }

    [Fact]
    public async Task Goal_shows_the_current_value_of_linked_investments_as_saved()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup("Pessoal");
        var gid = (await api.Post($"/w/{wid}/goals", new { name = "Casamento", icon = "heart", color = 5, targetCents = 50000_00, targetDate = (string?)null, notes = (string?)null, archived = false })).S("id");
        var iid = (await api.Post($"/w/{wid}/investments", new { name = "CDB casamento", kind = "Cdb", color = 1, countsInCash = false, archived = false, goalId = gid })).S("id");
        await api.Post($"/w/{wid}/investments/{iid}/moves", new { kind = "Contribution", date = D(-60), amountCents = 10000_00, origin = "Cash" });
        await api.Post($"/w/{wid}/investments/{iid}/moves", new { kind = "Valuation", date = D(-1), amountCents = 10250_00 });

        Assert.Equal(10250_00, (await api.Get($"/w/{wid}/goals")).AsArray().Single()!.L("savedCents"));

        // Excluir o objetivo desliga a aplicação, não a apaga.
        await api.Ok(HttpMethod.Delete, $"/w/{wid}/goals/{gid}");
        var inv = (await api.Get($"/w/{wid}/investments")).AsArray().Single()!;
        Assert.Null(inv["goalId"]?.GetValue<string>());

        // Objetivo de outro espaço não serve.
        var other = (await api.Post("/workspaces", new { name = "Metup", kind = "Business" })).S("id");
        var foreign = (await api.Post($"/w/{other}/goals", new { name = "X", icon = "x", color = 1, targetCents = 100, targetDate = (string?)null, notes = (string?)null, archived = false })).S("id");
        Assert.Equal(400, (await api.Send(HttpMethod.Put, $"/w/{wid}/investments/{iid}", new { name = "CDB", kind = "Cdb", color = 1, countsInCash = false, archived = false, goalId = foreign })).Status);
    }

    [Fact]
    public async Task Plan_is_saved_with_the_investment_and_confirmed_by_a_contribution()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup("Pessoal");
        var plan = new { amountCents = 500_00, day = 5, start = D(-40) };
        var iid = (await api.Post($"/w/{wid}/investments", new { name = "Tesouro", kind = "TesouroSelic", color = 7, countsInCash = false, archived = false, plan })).S("id");
        await api.Post($"/w/{wid}/investments/{iid}/moves", new { kind = "Contribution", date = D(0), amountCents = 500_00, origin = "Cash", planDate = D(-3) });

        var inv = (await api.Get($"/w/{wid}/investments")).AsArray().Single()!;
        Assert.Equal(500_00, inv["plan"]!.L("amountCents"));
        Assert.Equal(5, inv["plan"]!["day"]!.GetValue<int>());
        Assert.Equal(D(-3), inv.A("moves")[0]!.S("planDate"));

        Assert.Equal(400, (await api.Send(HttpMethod.Put, $"/w/{wid}/investments/{iid}", new { name = "Tesouro", kind = "TesouroSelic", color = 7, countsInCash = false, archived = false, plan = new { amountCents = 0, day = 5, start = D(0) } })).Status);
        // Tirar o plano.
        await api.Put($"/w/{wid}/investments/{iid}", new { name = "Tesouro", kind = "TesouroSelic", color = 7, countsInCash = false, archived = false });
        Assert.Null((await api.Get($"/w/{wid}/investments")).AsArray().Single()!["plan"]);
    }

    [Fact]
    public async Task Investments_are_private_to_their_space()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var metup = await api.Setup("Metup");
        var pessoal = (await api.Post("/workspaces", new { name = "Pessoal", kind = "Personal" })).S("id");
        var iid = (await api.Post($"/w/{pessoal}/investments", Inv("FII"))).S("id");
        var mid = (await api.Post($"/w/{pessoal}/investments/{iid}/moves", new { kind = "Contribution", date = D(0), amountCents = 100_00, origin = "Cash" })).S("id");

        Assert.Empty((await api.Get($"/w/{metup}/investments")).AsArray());
        Assert.Equal(404, (await api.Send(HttpMethod.Post, $"/w/{metup}/investments/{iid}/moves", new { kind = "Valuation", date = D(0), amountCents = 10 })).Status);
        Assert.Equal(404, (await api.Send(HttpMethod.Delete, $"/w/{metup}/investments/{iid}/moves/{mid}")).Status);
        Assert.Equal(404, (await api.Send(HttpMethod.Put, $"/w/{metup}/investments/{iid}", Inv("x"))).Status);
        Assert.Empty((await api.Get($"/w/{metup}/entries?from={D(-1)}&to={D(1)}")).A("flows"));
    }
}
