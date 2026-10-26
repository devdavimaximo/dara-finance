using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Finances.Tests;

/// <summary>A API inteira em memória, com um banco SQLite novo numa pasta temporária.</summary>
public sealed class TestApp : WebApplicationFactory<Program>
{
    public string DataDir { get; } = Path.Combine(Path.GetTempPath(), "razao-tests", Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.UseSetting("DATA_DIR", DataDir);
        builder.UseSetting("REMINDERS", "off");
        builder.UseSetting("LOGIN_RATE_LIMIT", "1000");
    }

    /// <summary>Cliente com cookie próprio (cada um é uma "pessoa" logada).</summary>
    public Api Client() => new(CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true }));

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(DataDir, true); } catch (IOException) { }
    }
}

public sealed class Api(HttpClient http)
{
    public HttpClient Http => http;

    public async Task<(int Status, JsonNode? Body)> Send(HttpMethod method, string path, object? body = null)
    {
        using var req = new HttpRequestMessage(method, "/api" + path);
        if (body is not null) req.Content = JsonContent.Create(body);
        using var res = await http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        return ((int)res.StatusCode, text.Length > 0 && text.TrimStart()[0] is '{' or '[' ? JsonNode.Parse(text) : null);
    }

    public async Task<JsonNode> Ok(HttpMethod method, string path, object? body = null)
    {
        var (status, json) = await Send(method, path, body);
        Assert.True(status is >= 200 and < 300, $"{method} {path} → {status}: {json?.ToJsonString()}");
        return json ?? new JsonObject();
    }

    public Task<JsonNode> Get(string path) => Ok(HttpMethod.Get, path);
    public Task<JsonNode> Post(string path, object? body = null) => Ok(HttpMethod.Post, path, body ?? new { });
    public Task<JsonNode> Put(string path, object body) => Ok(HttpMethod.Put, path, body);

    public async Task<JsonNode> Upload(string path, string fileName, string content)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(System.Text.Encoding.UTF8.GetBytes(content)), "file", fileName);
        var res = await http.PostAsync("/api" + path, form);
        var text = await res.Content.ReadAsStringAsync();
        Assert.True(res.IsSuccessStatusCode, $"upload {path} → {(int)res.StatusCode}: {text}");
        return JsonNode.Parse(text)!;
    }

    /// <summary>Primeiro acesso: cria o admin e o workspace; devolve o id do workspace.</summary>
    public async Task<string> Setup(string workspace = "Metup", string email = "dono@teste.dev")
    {
        var me = await Post("/auth/setup", new { name = "Dono", email, password = "senha12345", workspaceName = workspace, workspaceKind = "Business" });
        return me["workspaces"]![0]!["id"]!.GetValue<string>();
    }

    public async Task<JsonNode> Login(string email, string password = "senha12345") =>
        await Post("/auth/login", new { email, password });

    /// <summary>(Admin) cria uma conta com senha provisória "provisoria1".</summary>
    public async Task<string> CreateUser(string email, bool canCreateWorkspaces = false, object[]? grants = null) =>
        (await Post("/admin/users", new { name = email.Split('@')[0], email, password = "provisoria1", canCreateWorkspaces, grants = grants ?? [] })).S("id");

    /// <summary>Primeiro login com a senha provisória e criação da senha definitiva "senha12345".</summary>
    public async Task FirstLogin(string email)
    {
        await Login(email, "provisoria1");
        await Put("/auth/password", new { next = "senha12345" });
    }

    public static object Entry(string kind, string description, long cents, string due, object? repeat = null,
        bool paid = false, string? categoryId = null, Guid? id = null) => new
    {
        kind, description, amountCents = cents, dueDate = due, categoryId, counterparty = (string?)null, method = (string?)null,
        notes = (string?)null, paid, paidDate = (string?)null, paidAmountCents = (long?)null, repeat, id,
    };
}

public static class Json
{
    public static string S(this JsonNode? n, string key) => n![key]!.GetValue<string>();
    public static long L(this JsonNode? n, string key) => n![key]!.GetValue<long>();
    public static JsonArray A(this JsonNode? n, string key) => n![key]!.AsArray();
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
