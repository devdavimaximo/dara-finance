using Finances.Server.Domain;

namespace Finances.Tests;

public class CardMathTests
{
    private static readonly Card Nubank = new() { ClosingDay = 3, DueDay = 10 };
    private static readonly Card Late = new() { ClosingDay = 25, DueDay = 5 };

    [Theory]
    [InlineData("2026-10-02", "2026-10-10")] // antes do fechamento: fatura deste mês
    [InlineData("2026-10-03", "2026-11-10")] // no dia do fechamento já vai para a próxima
    [InlineData("2026-10-20", "2026-11-10")]
    [InlineData("2026-12-15", "2027-01-10")] // vira o ano
    public void Due_after_closing_in_the_same_month(string purchase, string due) =>
        Assert.Equal(DateOnly.Parse(due), CardMath.InvoiceDue(Nubank, DateOnly.Parse(purchase)));

    [Theory]
    [InlineData("2026-10-24", "2026-11-05")] // fecha dia 25, vence dia 5 do mês seguinte
    [InlineData("2026-10-25", "2026-12-05")]
    public void Due_before_closing_falls_in_the_next_month(string purchase, string due) =>
        Assert.Equal(DateOnly.Parse(due), CardMath.InvoiceDue(Late, DateOnly.Parse(purchase)));

    [Fact]
    public void Day_31_is_clamped_to_the_end_of_short_months() =>
        Assert.Equal(new DateOnly(2027, 2, 28), CardMath.InvoiceDue(new Card { ClosingDay = 20, DueDay = 31 }, new DateOnly(2027, 2, 10)));
}

public class CardsApiTests
{
    private static object Purchase(string description, long cents, string date, string cardId, object? repeat = null) => new
    {
        kind = "Expense", description, amountCents = cents, dueDate = date, categoryId = (string?)null, counterparty = (string?)null,
        method = (string?)null, notes = (string?)null, paid = false, paidDate = (string?)null, paidAmountCents = (long?)null, repeat,
        cardId, purchaseDate = date,
    };

    [Fact]
    public async Task Card_purchases_fall_on_the_invoice_due_date_including_installments()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup("Pessoal");
        var card = (await api.Post($"/w/{wid}/cards", new { name = "Nubank", closingDay = 3, dueDay = 10, color = 7, archived = false })).S("id");

        var e = await api.Post($"/w/{wid}/entries", Purchase("Mercado", 200_00, "2026-10-20", card));
        Assert.Equal("2026-11-10", e.S("dueDate"));
        Assert.Equal("2026-10-20", e.S("purchaseDate"));
        Assert.Equal("CreditCard", e.S("method"));

        await api.Post($"/w/{wid}/entries", Purchase("Notebook", 500_00, "2026-10-20", card, new { frequency = "Monthly", interval = 1, count = 3, endDate = (string?)null }));
        var items = (await api.Get($"/w/{wid}/entries?from=2026-11-01&to=2027-02-28")).A("items");
        var parcels = items.Where(x => x!.S("description") == "Notebook").Select(x => (x!.S("dueDate"), x["cardId"]?.GetValue<string>())).ToList();
        Assert.Equal([("2026-11-10", card), ("2026-12-10", card), ("2027-01-10", card)], parcels);

        // Editar a 2ª parcela (sem data da compra) não empurra para a fatura seguinte.
        var second = items.First(x => x!.S("description") == "Notebook" && x.S("dueDate") == "2026-12-10")!;
        var edited = await api.Put($"/w/{wid}/entries/{second.S("id")}", new
        {
            kind = "Expense", description = "Notebook", amountCents = 510_00, dueDate = "2026-12-10", categoryId = (string?)null, counterparty = (string?)null,
            method = "CreditCard", notes = (string?)null, paid = false, paidDate = (string?)null, paidAmountCents = (long?)null, repeat = (object?)null, cardId = card,
        });
        Assert.Equal("2026-12-10", edited.S("dueDate"));

        // Excluir o cartão desliga as compras e mantém o vencimento.
        await api.Ok(HttpMethod.Delete, $"/w/{wid}/cards/{card}");
        var after = (await api.Get($"/w/{wid}/entries/{e.S("id")}"));
        Assert.Null(after["cardId"]?.GetValue<string>());
        Assert.Equal("2026-11-10", after.S("dueDate"));
    }

    [Fact]
    public async Task Card_from_another_space_or_on_income_is_refused()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var metup = await api.Setup("Metup");
        var pessoal = (await api.Post("/workspaces", new { name = "Pessoal", kind = "Personal" })).S("id");
        var card = (await api.Post($"/w/{pessoal}/cards", new { name = "Nubank", closingDay = 3, dueDay = 10, color = 7, archived = false })).S("id");
        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{metup}/entries", Purchase("x", 100, "2026-10-01", card))).Status);
        Assert.Empty((await api.Get($"/w/{metup}/cards")).AsArray());
        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{pessoal}/cards", new { name = "X", closingDay = 0, dueDay = 10, color = 1, archived = false })).Status);
    }

    [Fact]
    public async Task Transfer_creates_expense_and_income_linked_and_requires_access_to_both()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var metup = await api.Setup("Metup");
        var pessoal = (await api.Post("/workspaces", new { name = "Pessoal", kind = "Personal" })).S("id");

        var t = await api.Post("/transfers", new { fromWorkspaceId = metup, toWorkspaceId = pessoal, description = "Pró-labore outubro", amountCents = 5000_00, date = "2026-10-05", paid = true });
        var tid = t.S("transferId");

        var outE = (await api.Get($"/w/{metup}/entries?from=2026-10-01&to=2026-10-31")).A("items").Single()!;
        var inE = (await api.Get($"/w/{pessoal}/entries?from=2026-10-01&to=2026-10-31")).A("items").Single()!;
        Assert.Equal(("Expense", "Income"), (outE.S("kind"), inE.S("kind")));
        Assert.Equal((tid, tid), (outE.S("transferId"), inE.S("transferId")));
        Assert.Equal(("Pessoal", "Metup"), (outE.S("counterparty"), inE.S("counterparty")));
        Assert.Equal("2026-10-05", inE.S("paidDate"));

        // Outra pessoa sem acesso ao Pessoal não transfere para lá.
        var other = await api.CreateUser("socio@teste.dev", grants: [new { workspaceId = metup, role = "Member" }]);
        var socio = app.Client();
        await socio.FirstLogin("socio@teste.dev");
        Assert.Equal(404, (await socio.Send(HttpMethod.Post, "/transfers", new { fromWorkspaceId = metup, toWorkspaceId = pessoal, description = "x", amountCents = 100, date = "2026-10-05", paid = false })).Status);
        Assert.Single((await api.Get($"/w/{metup}/entries?from=2026-10-01&to=2026-10-31")).A("items"));
        _ = other;
    }
}
