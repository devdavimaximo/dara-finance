namespace Finances.Tests;

/// <summary>Regras de contas e de acesso: quem cria conta, senha provisória, sessões, espaços próprios, responsáveis.</summary>
public class AccessTests
{
    [Fact]
    public async Task Only_admin_creates_accounts_and_there_is_no_open_signup()
    {
        await using var app = new TestApp();
        var admin = app.Client();
        var metup = await admin.Setup();
        await admin.CreateUser("socio@teste.dev", grants: [new { workspaceId = metup, role = "Owner" }]);

        var socio = app.Client();
        await socio.FirstLogin("socio@teste.dev");
        Assert.Equal(403, (await socio.Send(HttpMethod.Get, "/admin/users")).Status);
        Assert.Equal(403, (await socio.Send(HttpMethod.Post, "/admin/users", new { name = "X", email = "x@x.dev", password = "senha12345", canCreateWorkspaces = false })).Status);

        // Responsável dá acesso só a contas que já existem.
        var (status, body) = await socio.Send(HttpMethod.Post, $"/w/{metup}/members", new { email = "ninguem@teste.dev", role = "Member" });
        Assert.Equal(400, status);
        Assert.Contains("administrador", body!.S("error"));

        Assert.Equal(409, (await app.Client().Send(HttpMethod.Post, "/auth/setup", new { name = "Y", email = "y@y.dev", password = "senha12345", workspaceName = "Y", workspaceKind = "Personal" })).Status);
        Assert.Equal(409, (await admin.Send(HttpMethod.Post, "/admin/users", new { name = "Dup", email = "SOCIO@teste.dev", password = "senha12345", canCreateWorkspaces = false })).Status);
    }

    [Fact]
    public async Task Temporary_password_blocks_everything_until_the_person_creates_their_own()
    {
        await using var app = new TestApp();
        var admin = app.Client();
        var metup = await admin.Setup();
        await admin.CreateUser("socio@teste.dev", grants: [new { workspaceId = metup, role = "Member" }]);

        var socio = app.Client();
        var me = await socio.Login("socio@teste.dev", "provisoria1");
        Assert.True(me["mustChangePassword"]!.GetValue<bool>());
        var (status, body) = await socio.Send(HttpMethod.Get, $"/w/{metup}/categories");
        Assert.Equal(403, status);
        Assert.Equal("password_change_required", body!.S("code"));
        Assert.Equal(200, (await socio.Send(HttpMethod.Get, "/auth/me")).Status);

        // Não pode "trocar" pela mesma provisória; senha nova curta também não.
        Assert.Equal(400, (await socio.Send(HttpMethod.Put, "/auth/password", new { next = "provisoria1" })).Status);
        Assert.Equal(400, (await socio.Send(HttpMethod.Put, "/auth/password", new { next = "curta" })).Status);

        var after = await socio.Put("/auth/password", new { next = "minhaSenhaForte" });
        Assert.False(after["mustChangePassword"]!.GetValue<bool>());
        Assert.Equal(200, (await socio.Send(HttpMethod.Get, $"/w/{metup}/categories")).Status); // mesma sessão segue

        // A provisória não vale mais; a nova sim. E agora trocar exige a senha atual.
        Assert.Equal(401, (await app.Client().Send(HttpMethod.Post, "/auth/login", new { email = "socio@teste.dev", password = "provisoria1" })).Status);
        await app.Client().Login("socio@teste.dev", "minhaSenhaForte");
        Assert.Equal(400, (await socio.Send(HttpMethod.Put, "/auth/password", new { next = "outraSenha99" })).Status);
    }

    [Fact]
    public async Task Partner_creates_a_personal_space_that_the_admin_cannot_see()
    {
        await using var app = new TestApp();
        var admin = app.Client();
        await admin.Setup();
        await admin.CreateUser("socio@teste.dev", canCreateWorkspaces: true);
        await admin.CreateUser("sem-permissao@teste.dev");

        var socio = app.Client();
        await socio.FirstLogin("socio@teste.dev");
        var pessoal = (await socio.Post("/workspaces", new { name = "Pessoal do sócio", kind = "Personal" })).S("id");
        await socio.Post($"/w/{pessoal}/entries", Api.Entry("Expense", "Aluguel do apê", 300000, DateOnly.FromDateTime(DateTime.Today).ToString("yyyy-MM-dd")));

        // O admin não está no espaço, não vê nos seus espaços e recebe 404 ao tentar ler.
        Assert.DoesNotContain((await admin.Get("/auth/me")).A("workspaces"), w => w!.S("id") == pessoal);
        Assert.Equal(404, (await admin.Send(HttpMethod.Get, $"/w/{pessoal}/categories")).Status);
        Assert.Equal(404, (await admin.Send(HttpMethod.Get, $"/w/{pessoal}/members")).Status);
        // Na lista de usuários, só a contagem de espaços — nada do conteúdo.
        var users = (await admin.Get("/admin/users")).AsArray();
        Assert.Equal(1, users.First(u => u!.S("email") == "socio@teste.dev")!["workspaces"]!.GetValue<int>());

        // Sem a permissão, não cria espaço.
        var outro = app.Client();
        await outro.FirstLogin("sem-permissao@teste.dev");
        Assert.Equal(403, (await outro.Send(HttpMethod.Post, "/workspaces", new { name = "X", kind = "Personal" })).Status);
    }

    [Fact]
    public async Task Admin_can_create_a_space_on_behalf_of_someone_without_joining_it()
    {
        await using var app = new TestApp();
        var admin = app.Client();
        await admin.Setup();
        var socioId = await admin.CreateUser("socio@teste.dev");

        var ws = (await admin.Post("/workspaces", new { name = "Pessoal do sócio", kind = "Personal", ownerUserId = socioId })).S("id");
        Assert.Equal(404, (await admin.Send(HttpMethod.Get, $"/w/{ws}/categories")).Status);

        var socio = app.Client();
        await socio.FirstLogin("socio@teste.dev");
        var mine = (await socio.Get("/auth/me")).A("workspaces");
        var only = Assert.Single(mine);
        Assert.Equal("Owner", only!.S("role"));
    }

    [Fact]
    public async Task Deactivating_or_resetting_password_kills_open_sessions()
    {
        await using var app = new TestApp();
        var admin = app.Client();
        var metup = await admin.Setup();
        var socioId = await admin.CreateUser("socio@teste.dev", grants: [new { workspaceId = metup, role = "Member" }]);
        var socio = app.Client();
        await socio.FirstLogin("socio@teste.dev");
        Assert.Equal(200, (await socio.Send(HttpMethod.Get, $"/w/{metup}/categories")).Status);

        // Desativar: a sessão aberta cai na próxima requisição e o login é recusado.
        await admin.Put($"/admin/users/{socioId}", new { active = false });
        Assert.Equal(401, (await socio.Send(HttpMethod.Get, $"/w/{metup}/categories")).Status);
        Assert.Equal(403, (await app.Client().Send(HttpMethod.Post, "/auth/login", new { email = "socio@teste.dev", password = "senha12345" })).Status);
        // O admin não pode se desativar.
        var adminId = (await admin.Get("/auth/me")).S("id");
        Assert.Equal(400, (await admin.Send(HttpMethod.Put, $"/admin/users/{adminId}", new { active = false })).Status);

        // Reativar + redefinir senha: sessão nova com a provisória, e troca obrigatória de novo.
        await admin.Put($"/admin/users/{socioId}", new { active = true });
        var again = app.Client();
        await again.Login("socio@teste.dev");
        await admin.Post($"/admin/users/{socioId}/reset-password", new { password = "novaProvis1" });
        Assert.Equal(401, (await again.Send(HttpMethod.Get, "/auth/me")).Status);
        var me = await again.Login("socio@teste.dev", "novaProvis1");
        Assert.True(me["mustChangePassword"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Every_space_keeps_at_least_one_owner()
    {
        await using var app = new TestApp();
        var admin = app.Client();
        var metup = await admin.Setup();
        var adminId = (await admin.Get("/auth/me")).S("id");
        var socioId = await admin.CreateUser("socio@teste.dev", grants: [new { workspaceId = metup, role = "Member" }]);

        // Único responsável: não sai nem se rebaixa.
        Assert.Equal(400, (await admin.Send(HttpMethod.Delete, $"/w/{metup}/members/{adminId}")).Status);
        Assert.Equal(400, (await admin.Send(HttpMethod.Put, $"/w/{metup}/members/{adminId}", new { role = "Member" })).Status);

        // Promove o sócio; agora o admin pode deixar de ser responsável e até sair.
        await admin.Put($"/w/{metup}/members/{socioId}", new { role = "Owner" });
        await admin.Put($"/w/{metup}/members/{adminId}", new { role = "Member" });
        Assert.Equal(403, (await admin.Send(HttpMethod.Put, $"/w/{metup}/members/{socioId}", new { role = "Member" })).Status); // membro não muda papéis
        await admin.Ok(HttpMethod.Delete, $"/w/{metup}/members/{adminId}"); // sair é sempre permitido
        Assert.Empty((await admin.Get("/auth/me")).A("workspaces"));

        var socio = app.Client();
        await socio.FirstLogin("socio@teste.dev");
        var members = (await socio.Get($"/w/{metup}/members")).AsArray();
        Assert.Equal("Owner", Assert.Single(members)!.S("role"));
    }
}
