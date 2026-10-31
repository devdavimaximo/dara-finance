using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Finances.Server.Api;
using Finances.Server.Data;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Tudo que precisa sobreviver a um redeploy (banco, comprovantes, chaves do cookie) mora aqui.
// Padrão local: ".data" — nunca "data", que no Windows é a mesma pasta do código em Data/.
var dataDir = Path.GetFullPath(builder.Configuration["DATA_DIR"] ?? Path.Combine(builder.Environment.ContentRootPath, ".data"));
Directory.CreateDirectory(dataDir);

builder.Services.AddDbContext<AppDb>(o => o.UseSqlite($"Data Source={Path.Combine(dataDir, "finances.db")}"));
builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<RecurrenceService>();
builder.Services.AddSingleton<Clock>();
builder.Services.AddSingleton(new DataDir(dataDir));
builder.Services.AddSingleton<PushService>();
builder.Services.AddSingleton<CdiFetchState>();
builder.Services.AddHttpClient<CdiService>(c =>
{
    c.Timeout = TimeSpan.FromSeconds(20);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("dara/1.0");
});
if (builder.Configuration["REMINDERS"] != "off")
    builder.Services.AddHostedService<DueReminderService>();

builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataDir, "keys")))
    .SetApplicationName("razao");

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "razao.auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = TimeSpan.FromDays(30);
        o.SlidingExpiration = true;
        // API: responde 401/403 em vez de redirecionar para uma página de login.
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
        // Conta desativada ou senha redefinida derruba as sessões abertas na próxima requisição.
        o.Events.OnValidatePrincipal = AuthApi.ValidateSession;
    });
builder.Services.AddAuthorization();

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = int.TryParse(builder.Configuration["LOGIN_RATE_LIMIT"], out var n) ? n : 8,
            Window = TimeSpan.FromMinutes(1),
        }));
});

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    await scope.ServiceProvider.GetRequiredService<AppDb>().Database.MigrateAsync();

app.UseForwardedHeaders();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.Use(AuthApi.EnforcePasswordChange);
app.UseAuthorization();
app.UseRateLimiter();

var api = app.MapGroup("/api");
AuthApi.Map(api);
WorkspaceApi.Map(api);
AdminApi.Map(api);
EntriesApi.Map(api, dataDir);
ImportApi.Map(api);
GoalsApi.Map(api);
InvestmentsApi.Map(api);
PushApi.Map(api);
api.MapGet("/health", () => Results.Ok(new { ok = true }));
api.MapFallback(() => Results.NotFound());

app.MapFallbackToFile("index.html");

app.Run();

/// <summary>Exposto para o WebApplicationFactory dos testes de ponta a ponta.</summary>
public partial class Program;
