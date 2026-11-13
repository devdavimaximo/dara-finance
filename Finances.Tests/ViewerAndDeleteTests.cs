namespace Finances.Tests;

/// <summary>Observador (contador) só lê; exclusão de espaço vazio direta, com dados só confirmada.</summary>
public class ViewerAndDeleteTests
{
    [Fact]
    public async Task Viewer_reads_everything_but_cannot_write_and_can_leave()
    {
        await using var app = new TestApp();
        var admin = app.Client();
        var metup = await admin.Setup();
        await admin.Post($"/w/{metup}/entries", Api.Entry("Expense", "Aluguel", 100_00, "2026-11-10"));
        var contadorId = await admin.CreateUser("contador@teste.dev", grants: [new { workspaceId = metup, role = "Viewer" }]);

        var contador = app.Client();
        await contador.FirstLogin("contador@teste.dev");
        var me = await contador.Get("/auth/me");
        Assert.Equal("Viewer", me.A("workspaces")[0].S("role"));
        Assert.Equal(200, (await contador.Send(HttpMethod.Get, $"/w/{metup}/entries?from=2026-11-01&to=2026-11-30")).Status);

        var (status, body) = await contador.Send(HttpMethod.Post, $"/w/{metup}/entries", Api.Entry("Expense", "X", 1_00, "2026-11-10"));
        Assert.Equal(403, status);
        Assert.Contains("observador", body!.S("error"));
        Assert.Equal(403, (await contador.Send(HttpMethod.Post, $"/w/{metup}/categories", new { name = "Y", kind = "Expense" })).Status);
        Assert.Equal(403, (await contador.Send(HttpMethod.Delete, $"/w/{metup}/?force=true")).Status);

        // Sair do espaço é permitido.
        Assert.Equal(204, (await contador.Send(HttpMethod.Delete, $"/w/{metup}/members/{contadorId}")).Status);
        Assert.Empty((await contador.Get("/auth/me")).A("workspaces"));
    }

    [Fact]
    public async Task Empty_space_deletes_directly_space_with_data_needs_force()
    {
        await using var app = new TestApp();
        var admin = app.Client();
        var metup = await admin.Setup();
        var vazio = (await admin.Post("/workspaces", new { name = "Vazio", kind = "Personal" })).S("id");

        var impact = await admin.Get($"/w/{vazio}/deletion-impact");
        Assert.False(impact["hasData"]!.GetValue<bool>());
        Assert.Equal(204, (await admin.Send(HttpMethod.Delete, $"/w/{vazio}/")).Status);

        await admin.Post($"/w/{metup}/entries", Api.Entry("Expense", "Aluguel", 100_00, "2026-11-10"));
        Assert.Equal(1, (await admin.Get($"/w/{metup}/deletion-impact"))["entries"]!.GetValue<int>());
        var (status, body) = await admin.Send(HttpMethod.Delete, $"/w/{metup}/");
        Assert.Equal(409, status);
        Assert.Equal("has_data", body!.S("code"));
        Assert.Equal(204, (await admin.Send(HttpMethod.Delete, $"/w/{metup}/?force=true")).Status);
        Assert.Empty((await admin.Get("/auth/me")).A("workspaces"));
    }

    [Fact]
    public async Task Only_owner_deletes_a_space()
    {
        await using var app = new TestApp();
        var admin = app.Client();
        var metup = await admin.Setup();
        await admin.CreateUser("socio@teste.dev", grants: [new { workspaceId = metup, role = "Member" }]);
        var socio = app.Client();
        await socio.FirstLogin("socio@teste.dev");
        Assert.Equal(403, (await socio.Send(HttpMethod.Delete, $"/w/{metup}/?force=true")).Status);
        Assert.Equal(403, (await socio.Send(HttpMethod.Get, $"/w/{metup}/deletion-impact")).Status);
    }
}
