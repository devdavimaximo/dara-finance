using System.Text.Json.Nodes;

namespace Finances.Tests;

/// <summary>Ponta a ponta: HTTP real contra a API em memória, com cookie de login e banco novo por teste.</summary>
public class ApiTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(-3));
    private static string D(int days) => Today.AddDays(days).ToString("yyyy-MM-dd");
    private static string Range(int from, int to) => $"from={D(from)}&to={D(to)}";

    [Fact]
    public async Task Setup_happens_once_and_login_is_required()
    {
        await using var app = new TestApp();
        var anon = app.Client();
        Assert.True((await anon.Get("/auth/status"))["needsSetup"]!.GetValue<bool>());
        Assert.Equal(401, (await anon.Send(HttpMethod.Get, "/auth/me")).Status);

        var owner = app.Client();
        var wid = await owner.Setup();
        Assert.Equal(409, (await anon.Send(HttpMethod.Post, "/auth/setup", new { name = "X", email = "x@x.dev", password = "senha12345", workspaceName = "X", workspaceKind = "Personal" })).Status);
        Assert.Equal(401, (await anon.Send(HttpMethod.Get, $"/w/{wid}/categories")).Status);
        Assert.Equal(401, (await anon.Send(HttpMethod.Post, "/auth/login", new { email = "dono@teste.dev", password = "errada123" })).Status);

        var cats = (await owner.Get($"/w/{wid}/categories")).AsArray();
        Assert.Equal(12, cats.Count); // categorias padrão de empresa
        Assert.True(File.Exists(Path.Combine(app.DataDir, "finances.db")));
    }

    [Fact]
    public async Task Workspaces_are_isolated_between_people()
    {
        await using var app = new TestApp();
        var owner = app.Client();
        var metup = await owner.Setup();
        await owner.Post($"/w/{metup}/entries", Api.Entry("Expense", "Aluguel do escritório", 200000, D(3)));
        var personal = (await owner.Post("/workspaces", new { name = "Pessoal", kind = "Personal" })).S("id");
        await owner.CreateUser("outra@teste.dev", grants: [new { workspaceId = personal, role = "Member" }]);

        var other = app.Client();
        await other.FirstLogin("outra@teste.dev");
        var me = await other.Get("/auth/me");
        Assert.Single(me.A("workspaces"));
        Assert.Equal("Pessoal", me.A("workspaces")[0].S("name"));

        // Não lê, não escreve e nem descobre que a Metup existe.
        Assert.Equal(404, (await other.Send(HttpMethod.Get, $"/w/{metup}/entries?{Range(-30, 30)}")).Status);
        Assert.Equal(404, (await other.Send(HttpMethod.Post, $"/w/{metup}/entries", Api.Entry("Expense", "x", 100, D(0)))).Status);
        // Membro não administra pessoas nem cria espaços.
        Assert.Equal(403, (await other.Send(HttpMethod.Post, $"/w/{personal}/members", new { email = "dono@teste.dev", role = "Owner" })).Status);
        Assert.Equal(403, (await other.Send(HttpMethod.Post, "/workspaces", new { name = "Meu", kind = "Personal" })).Status);

        // O que é lançado no Pessoal não aparece na Metup.
        await other.Post($"/w/{personal}/entries", Api.Entry("Expense", "Mercado", 35000, D(1)));
        var metupItems = (await owner.Get($"/w/{metup}/entries?{Range(-30, 30)}")).A("items");
        Assert.Single(metupItems);
        Assert.Equal("Aluguel do escritório", metupItems[0].S("description"));
    }

    [Fact]
    public async Task Installments_are_materialized_and_series_edits_propagate()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup();

        var first = await api.Post($"/w/{wid}/entries",
            Api.Entry("Expense", "Notebook", 75000, D(0), new { frequency = "Monthly", interval = 1, count = 10, endDate = (string?)null }));
        Assert.Equal(1, first["sequence"]!.GetValue<int>());
        Assert.Equal(10, first["seriesCount"]!.GetValue<int>());

        var items = (await api.Get($"/w/{wid}/entries?{Range(-1, 400)}")).A("items")
            .Where(e => e!.S("description") == "Notebook").ToList();
        Assert.Equal(10, items.Count);

        // "Esta e as próximas": a 3ª parcela muda o valor dela e das seguintes, não das anteriores.
        var third = items.First(e => e!["sequence"]!.GetValue<int>() == 3)!;
        await api.Put($"/w/{wid}/entries/{third.S("id")}?scope=future",
            Api.Entry("Expense", "Notebook", 80000, third.S("dueDate")));
        var after = (await api.Get($"/w/{wid}/entries?{Range(-1, 400)}")).A("items").ToList();
        Assert.Equal(75000, after.First(e => e!["sequence"]!.GetValue<int>() == 2)!.L("amountCents"));
        Assert.All(after.Where(e => e!["sequence"]!.GetValue<int>() >= 3), e => Assert.Equal(80000, e!.L("amountCents")));

        // Excluir "esta e as próximas" na 8ª encerra a série com 7 parcelas.
        var eighth = after.First(e => e!["sequence"]!.GetValue<int>() == 8)!;
        await api.Ok(HttpMethod.Delete, $"/w/{wid}/entries/{eighth.S("id")}?scope=future");
        Assert.Equal(7, (await api.Get($"/w/{wid}/entries?{Range(-1, 400)}")).A("items").Count);
        var series = (await api.Get($"/w/{wid}/recurrences")).AsArray();
        Assert.True(series[0]!["finished"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Open_ended_recurrence_fills_twelve_months_and_can_be_stopped()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup();
        await api.Post($"/w/{wid}/entries", Api.Entry("Income", "Mensalidade", 350000, D(-40), new { frequency = "Monthly", interval = 1, count = (int?)null, endDate = (string?)null }));

        var items = (await api.Get($"/w/{wid}/entries?{Range(-60, 420)}")).A("items");
        Assert.InRange(items.Count, 13, 15); // ~1 mês atrás até 12 meses à frente

        var rec = (await api.Get($"/w/{wid}/recurrences")).AsArray()[0]!;
        await api.Post($"/w/{wid}/recurrences/{rec.S("id")}/stop");
        var left = (await api.Get($"/w/{wid}/entries?{Range(-60, 420)}")).A("items");
        Assert.All(left, e => Assert.True(string.CompareOrdinal(e!.S("dueDate"), D(0)) <= 0));
    }

    [Fact]
    public async Task Paying_moves_cash_balance_and_offline_creation_is_idempotent()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup();
        await api.Put($"/w/{wid}/", new { name = "Metup", openingBalanceCents = 100000, openingBalanceDate = D(-30) });

        var id = Guid.NewGuid();
        var created = await api.Post($"/w/{wid}/entries", Api.Entry("Income", "Projeto", 500000, D(-10), id: id));
        Assert.Equal(id.ToString(), created.S("id"));
        // O aparelho reenviou (conexão caiu no meio): mesmo id, nada duplica.
        await api.Post($"/w/{wid}/entries", Api.Entry("Income", "Projeto", 500000, D(-10), id: id));
        Assert.Single((await api.Get($"/w/{wid}/entries?{Range(-30, 30)}")).A("items"));

        var paid = await api.Post($"/w/{wid}/entries/{id}/pay", new { paidDate = D(-5), paidAmountCents = 480000 });
        Assert.Equal(480000, paid.L("paidAmountCents"));
        Assert.Equal(100000 + 480000, (await api.Get($"/w/{wid}/entries?{Range(0, 10)}")).L("balanceBefore"));
        Assert.Equal(100000, (await api.Get($"/w/{wid}/entries?{Range(-6, 10)}")).L("balanceBefore"));

        await api.Post($"/w/{wid}/entries/{id}/unpay");
        Assert.Equal(100000, (await api.Get($"/w/{wid}/entries?{Range(0, 10)}")).L("balanceBefore"));
    }

    [Fact]
    public async Task Validation_rejects_bad_input()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup();
        var cats = (await api.Get($"/w/{wid}/categories")).AsArray();
        var incomeCat = cats.First(c => c!.S("kind") == "Income")!.S("id");

        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{wid}/entries", Api.Entry("Expense", "x", 0, D(0)))).Status);
        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{wid}/entries", Api.Entry("Expense", " ", 100, D(0)))).Status);
        Assert.Equal(400, (await api.Send(HttpMethod.Post, $"/w/{wid}/entries", Api.Entry("Expense", "x", 100, D(0), categoryId: incomeCat))).Status);
        Assert.Equal(400, (await api.Send(HttpMethod.Get, $"/w/{wid}/entries?from={D(0)}&to={D(-1)}")).Status);
    }

    [Fact]
    public async Task Statement_import_reconciles_creates_and_never_duplicates()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup();
        var cats = (await api.Get($"/w/{wid}/categories")).AsArray();
        var tools = cats.First(c => c!.S("name").StartsWith("Ferramentas"))!.S("id");

        // Histórico ensina a categoria; conta em aberto deve ser conciliada.
        await api.Post($"/w/{wid}/entries", Api.Entry("Expense", "Figma assinatura", 42000, D(-60), paid: true, categoryId: tools));
        var open = await api.Post($"/w/{wid}/entries", Api.Entry("Expense", "Servidor VPS", 18000, D(-3)));

        string Ofx(string fitid, int days, string amount, string memo) =>
            $"<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>{Today.AddDays(days):yyyyMMdd}120000[-3:BRT]\n<TRNAMT>{amount}\n<FITID>{fitid}\n<MEMO>{memo}\n</STMTTRN>\n";
        var ofx = "OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n"
            + Ofx("A1", -2, "-180.00", "HETZNER ONLINE")
            + Ofx("A2", -1, "-420.00", "FIGMA ASSINATURA")
            + Ofx("A3", -1, "2500.00", "PIX RECEBIDO CLIENTE")
            + "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        var preview = (await api.Upload($"/w/{wid}/import/preview", "extrato.ofx", ofx)).A("rows");
        Assert.Equal(3, preview.Count);
        var vps = preview.First(r => r!.S("externalId") == "ofx:A1")!;
        Assert.Equal(open.S("id"), vps["match"]!.S("entryId"));
        var figma = preview.First(r => r!.S("externalId") == "ofx:A2")!;
        Assert.Equal(tools, figma.S("suggestedCategoryId"));
        Assert.Equal("Income", preview.First(r => r!.S("externalId") == "ofx:A3")!.S("kind"));

        var rows = preview.Select(r => new
        {
            externalId = r!.S("externalId"), date = r.S("date"), amountCents = r.L("amountCents"), kind = r.S("kind"),
            description = r.S("description"), categoryId = r["suggestedCategoryId"]?.GetValue<string>(),
            matchEntryId = r["match"]?["entryId"]?.GetValue<string>(),
        }).ToList();
        var result = await api.Post($"/w/{wid}/import/commit", new { rows });
        Assert.Equal(2, result.L("created"));
        Assert.Equal(1, result.L("reconciled"));

        var reconciled = await api.Get($"/w/{wid}/entries/{open.S("id")}");
        Assert.Equal(D(-2), reconciled.S("paidDate"));

        // Mesmo arquivo de novo: tudo marcado como duplicado, e o commit não cria nada.
        var again = (await api.Upload($"/w/{wid}/import/preview", "extrato.ofx", ofx)).A("rows");
        Assert.All(again, r => Assert.True(r!["duplicate"]!.GetValue<bool>()));
        var second = await api.Post($"/w/{wid}/import/commit", new { rows });
        Assert.Equal(0, second.L("created"));
        Assert.Equal(3, second.L("skipped"));
    }

    [Fact]
    public async Task Push_settings_and_subscription_roundtrip()
    {
        await using var app = new TestApp();
        var api = app.Client();
        await api.Setup();
        Assert.False(string.IsNullOrEmpty((await api.Get("/push/key")).S("publicKey")));

        await api.Post("/push/subscribe", new { endpoint = "https://push.example.dev/abc", keys = new { p256dh = "BKey", auth = "auth" }, device = "Teste" });
        await api.Put("/push/settings", new { enabled = true, hour = 7, daysAhead = 3, devices = 0 });
        var s = await api.Get("/push/settings");
        Assert.Equal(7, s["hour"]!.GetValue<int>());
        Assert.Equal(3, s["daysAhead"]!.GetValue<int>());
        Assert.Equal(1, s["devices"]!.GetValue<int>());

        await api.Post("/push/unsubscribe", new { endpoint = "https://push.example.dev/abc" });
        Assert.Equal(0, (await api.Get("/push/settings"))["devices"]!.GetValue<int>());
    }

    [Fact]
    public async Task Csv_export_contains_entries()
    {
        await using var app = new TestApp();
        var api = app.Client();
        var wid = await api.Setup();
        await api.Post($"/w/{wid}/entries", Api.Entry("Expense", "Contador \"mensal\"", 65000, D(1)));
        var csv = await api.Http.GetStringAsync($"/api/w/{wid}/export.csv?{Range(-5, 5)}");
        Assert.Contains("\"Contador \"\"mensal\"\"\"", csv);
        Assert.Contains("650,00", csv);
    }
}
