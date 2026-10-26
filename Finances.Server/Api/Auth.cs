using System.Security.Claims;
using Finances.Server.Data;
using Finances.Server.Domain;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Api;

public record LoginRequest(string Email, string Password);
public record SetupRequest(string Name, string Email, string Password, string WorkspaceName, WorkspaceKind WorkspaceKind);
/// <summary>Current é dispensado quando a senha atual é provisória (troca obrigatória logo após o login).</summary>
public record ChangePasswordRequest(string? Current, string Next);
public record WorkspaceDto(Guid Id, string Name, WorkspaceKind Kind, MemberRole Role, long OpeningBalanceCents, DateOnly OpeningBalanceDate);
public record MeDto(Guid Id, string Name, string Email, bool IsAdmin, bool CanCreateWorkspaces, bool MustChangePassword, List<WorkspaceDto> Workspaces);

public static class AuthApi
{
    public static readonly PasswordHasher<User> Hasher = new();
    public const string StampClaim = "razao:stamp";
    public const int MinPassword = 8;

    public static Guid UserId(this ClaimsPrincipal p) => Guid.Parse(p.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public static string NewStamp() => Guid.NewGuid().ToString("N");

    public static void SetPassword(User user, string password)
    {
        user.PasswordHash = Hasher.HashPassword(user, password);
        user.SecurityStamp = NewStamp();
    }

    public static void Map(RouteGroupBuilder api)
    {
        var auth = api.MapGroup("/auth");

        auth.MapGet("/status", async (AppDb db) => new { needsSetup = !await db.Users.AnyAsync() });

        // Primeiro acesso: cria o admin e o primeiro workspace. Fecha-se sozinho depois.
        auth.MapPost("/setup", async (SetupRequest req, AppDb db, TenantContext tenant, HttpContext http) =>
        {
            if (await db.Users.AnyAsync()) return Results.Conflict(new { error = "Setup já realizado." });
            if (Validate(req.Email, req.Password, req.Name) is { } err) return Results.BadRequest(new { error = err });

            var user = new User { Name = req.Name.Trim(), Email = NormalizeEmail(req.Email), IsAdmin = true, CanCreateWorkspaces = true };
            SetPassword(user, req.Password);
            db.Users.Add(user);
            await WorkspaceApi.CreateWorkspace(db, tenant, user.Id, req.WorkspaceName, req.WorkspaceKind);
            await SignIn(http, user);
            return Results.Ok(await Me(db, user.Id));
        });

        auth.MapPost("/login", async (LoginRequest req, AppDb db, HttpContext http) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == NormalizeEmail(req.Email ?? ""));
            if (user is null || Hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password ?? "") == PasswordVerificationResult.Failed)
                return Results.Json(new { error = "E-mail ou senha incorretos." }, statusCode: 401);
            if (!user.Active)
                return Results.Json(new { error = "Esta conta está desativada. Fale com o administrador." }, statusCode: 403);
            await SignIn(http, user);
            return Results.Ok(await Me(db, user.Id));
        }).RequireRateLimiting("login");

        auth.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        auth.MapGet("/me", async (ClaimsPrincipal p, AppDb db) =>
            await Me(db, p.UserId()) is { } me ? Results.Ok(me) : Results.Unauthorized()).RequireAuthorization();

        auth.MapPut("/password", async (ChangePasswordRequest req, ClaimsPrincipal p, AppDb db, HttpContext http) =>
        {
            var user = await db.Users.FindAsync(p.UserId());
            if (user is null) return Results.Unauthorized();
            if (!user.MustChangePassword &&
                Hasher.VerifyHashedPassword(user, user.PasswordHash, req.Current ?? "") == PasswordVerificationResult.Failed)
                return Results.BadRequest(new { error = "Senha atual incorreta." });
            if (req.Next is null || req.Next.Length < MinPassword)
                return Results.BadRequest(new { error = $"A nova senha precisa de ao menos {MinPassword} caracteres." });
            if (Hasher.VerifyHashedPassword(user, user.PasswordHash, req.Next) != PasswordVerificationResult.Failed)
                return Results.BadRequest(new { error = "A nova senha precisa ser diferente da atual." });

            SetPassword(user, req.Next); // novo carimbo: outras sessões abertas caem
            user.MustChangePassword = false;
            await db.SaveChangesAsync();
            await SignIn(http, user);     // esta sessão continua, com o carimbo novo
            return Results.Ok(await Me(db, user.Id));
        }).RequireAuthorization();
    }

    public static string? Validate(string email, string password, string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "Informe o nome.";
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@')) return "E-mail inválido.";
        if (password is null || password.Length < MinPassword) return $"A senha precisa de ao menos {MinPassword} caracteres.";
        return null;
    }

    public static async Task<MeDto?> Me(AppDb db, Guid userId)
    {
        var user = await db.Users.FindAsync(userId);
        if (user is null) return null;
        var workspaces = await db.Memberships.Where(m => m.UserId == userId)
            .OrderBy(m => m.Workspace!.CreatedAt)
            .Select(m => new WorkspaceDto(m.WorkspaceId, m.Workspace!.Name, m.Workspace.Kind, m.Role,
                m.Workspace.OpeningBalanceCents, m.Workspace.OpeningBalanceDate))
            .ToListAsync();
        return new MeDto(user.Id, user.Name, user.Email, user.IsAdmin, user.IsAdmin || user.CanCreateWorkspaces,
            user.MustChangePassword, workspaces);
    }

    private static Task SignIn(HttpContext http, User user)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Name),
                new Claim(StampClaim, user.SecurityStamp),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme);
        return http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = true });
    }

    /// <summary>
    /// Roda a cada requisição autenticada: conta apagada, desativada ou com senha redefinida
    /// (carimbo diferente) derruba a sessão na hora. Também anota se a troca de senha é obrigatória.
    /// </summary>
    public static async Task ValidateSession(CookieValidatePrincipalContext ctx)
    {
        var id = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDb>();
        var user = Guid.TryParse(id, out var uid)
            ? await db.Users.AsNoTracking().Where(u => u.Id == uid)
                .Select(u => new { u.Active, u.SecurityStamp, u.MustChangePassword }).FirstOrDefaultAsync()
            : null;
        var stamp = ctx.Principal?.FindFirstValue(StampClaim) ?? "";
        if (user is null || !user.Active || user.SecurityStamp != stamp)
        {
            ctx.RejectPrincipal();
            await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }
        if (user.MustChangePassword) ctx.HttpContext.Items[MustChangeKey] = true;
    }

    public const string MustChangeKey = "razao:must-change-password";

    private static readonly string[] AllowedWhileMustChange = ["/api/auth/me", "/api/auth/password", "/api/auth/logout", "/api/auth/status", "/api/health"];

    /// <summary>Com senha provisória, só dá para ver o perfil, trocar a senha ou sair.</summary>
    public static async Task EnforcePasswordChange(HttpContext http, RequestDelegate next)
    {
        if (http.Items.ContainsKey(MustChangeKey) && http.Request.Path.StartsWithSegments("/api")
            && !AllowedWhileMustChange.Any(p => http.Request.Path.Equals(p, StringComparison.OrdinalIgnoreCase)))
        {
            http.Response.StatusCode = 403;
            await http.Response.WriteAsJsonAsync(new { error = "Crie sua senha antes de continuar.", code = "password_change_required" });
            return;
        }
        await next(http);
    }
}
