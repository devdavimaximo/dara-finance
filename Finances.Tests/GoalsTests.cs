namespace Finances.Tests;

public class GoalsTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(-3));
    private static string D(int days) => Today.AddDays(days).ToString("yyyy-MM-dd");

    private static object Expense(string description, long cents, string due, string? goalId, bool paid = false, object? repeat = null) => new
    {
        kind = "Expense", description, amountCents = cents, dueDate = due, categoryId = (string?)null, counterparty = (string?)null,
        method = (string?)null, notes = (string?)null, paid, paidDate = (string?)null, paidAmountCents = (long?)null, repeat, goalId,
    };

    [Fact]
    public async Task Goal_tracks_paid_scheduled_and_remaining_across_all_history()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup("Pessoal");
        var goal = await api.Post($"/w/{wid}/goals", new { name = "Casamento", icon = "heart", color = 5, targetCents = 8000000, targetDate = D(365), notes = (string?)null, archived = false });
        var gid = goal.S("id");

        // Pago há 2 anos (fora de qualquer janela do painel), pago recentemente, e buffet parcelado em 10x a partir de hoje.
        await api.Post($"/w/{wid}/entries", Expense("Sinal do espaço", 1000000, D(-730), gid, paid: true));
        await api.Post($"/w/{wid}/entries", Expense("Fotógrafo", 500000, D(-10), gid, paid: true));
        await api.Post($"/w/{wid}/entries", Expense("Buffet", 300000, D(0), gid, repeat: new { frequency = "Monthly", interval = 1, count = 10, endDate = (string?)null }));
        await api.Post($"/w/{wid}/entries", Expense("Mercado", 40000, D(0), null)); // não conta

        var g = (await api.Get($"/w/{wid}/goals")).AsArray().Single()!;
        Assert.Equal(1500000, g.L("paidCents"));
        Assert.Equal(3000000, g.L("scheduledCents"));
        Assert.Equal(2, g["paidCount"]!.GetValue<int>());
        Assert.Equal(10, g["openCount"]!.GetValue<int>());
        Assert.Equal(D(0), g.S("nextDue"));

        var linked = (await api.Get($"/w/{wid}/goals/{gid}/entries")).AsArray();
        Assert.Equal(12, linked.Count);
        Assert.All(linked, e => Assert.Equal(gid, e!.S("goalId")));

        // Pagar uma parcela move de "agendado" para "pago".
        var first = linked.First(e => e!.S("description") == "Buffet")!;
        await api.Post($"/w/{wid}/entries/{first.S("id")}/pay", new { paidDate = D(0) });
        g = (await api.Get($"/w/{wid}/goals")).AsArray().Single()!;
        Assert.Equal(1800000, g.L("paidCents"));
        Assert.Equal(2700000, g.L("scheduledCents"));
    }

    [Fact]
    public async Task Deleting_a_goal_keeps_the_entries_and_unlinks_them()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup("Pessoal");
        var gid = (await api.Post($"/w/{wid}/goals", new { name = "Carro", icon = "car", color = 1, targetCents = 6000000, targetDate = (string?)null, notes = (string?)null, archived = false })).S("id");
        await api.Post($"/w/{wid}/entries", Expense("Parcela carro", 150000, D(5), gid, repeat: new { frequency = "Monthly", interval = 1, count = 3, endDate = (string?)null }));

        await api.Ok(HttpMethod.Delete, $"/w/{wid}/goals/{gid}");
        var items = (await api.Get($"/w/{wid}/entries?from={D(-1)}&to={D(120)}")).A("items");
        Assert.Equal(3, items.Count);
        Assert.All(items, e => Assert.Null(e!["goalId"]?.GetValue<string>()));
        Assert.Empty((await api.Get($"/w/{wid}/goals")).AsArray());
    }

    [Fact]
    public async Task Goals_are_private_to_their_space_and_only_expenses_count()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var metup = await api.Setup("Metup");
        var pessoal = (await api.Post("/workspaces", new { name = "Pessoal", kind = "Personal" })).S("id");
        var gid = (await api.Post($"/w/{pessoal}/goals", new { name = "Casa", icon = "home", color = 3, targetCents = 50000000, targetDate = (string?)null, notes = (string?)null, archived = false })).S("id");

        // Objetivo do Pessoal não pode receber lançamento da Metup.
        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{metup}/entries", Expense("x", 100, D(0), gid))).Status);
        Assert.Equal(404, (await api.Send(HttpMethod.Get, $"/w/{metup}/goals/{gid}/entries")).Status);
        Assert.Empty((await api.Get($"/w/{metup}/goals")).AsArray());

        // Receita não conta para objetivo.
        var income = new { kind = "Income", description = "Presente", amountCents = 100000, dueDate = D(0), categoryId = (string?)null, counterparty = (string?)null,
            method = (string?)null, notes = (string?)null, paid = true, paidDate = (string?)null, paidAmountCents = (long?)null, repeat = (object?)null, goalId = gid };
        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{pessoal}/entries", income)).Status);

        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{pessoal}/goals", new { name = "Sem valor", icon = "x", color = 1, targetCents = 0, targetDate = (string?)null, notes = (string?)null, archived = false })).Status);
    }

    [Fact]
    public async Task Editing_a_series_with_scope_future_moves_the_next_installments_to_the_goal()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup("Pessoal");
        var gid = (await api.Post($"/w/{wid}/goals", new { name = "Viagem", icon = "plane", color = 7, targetCents = 1200000, targetDate = (string?)null, notes = (string?)null, archived = false })).S("id");
        await api.Post($"/w/{wid}/entries", Expense("Pacote", 200000, D(0), null, repeat: new { frequency = "Monthly", interval = 1, count = 6, endDate = (string?)null }));
        var items = (await api.Get($"/w/{wid}/entries?from={D(-1)}&to={D(200)}")).A("items").OrderBy(e => e!["sequence"]!.GetValue<int>()).ToList();

        var third = items[2]!;
        await api.Put($"/w/{wid}/entries/{third.S("id")}?scope=future", Expense("Pacote", 200000, third.S("dueDate"), gid));
        var g = (await api.Get($"/w/{wid}/goals")).AsArray().Single()!;
        Assert.Equal(4 * 200000, g.L("scheduledCents")); // parcelas 3 a 6
    }
}
