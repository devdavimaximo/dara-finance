using System.Security.Claims;
using Finances.Server.Data;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Api;

public record WorkspaceGrant(Guid WorkspaceId, MemberRole Role);
public record CreateUserRequest(string Name, string Email, string Password, bool CanCreateWorkspaces, List<WorkspaceGrant>? Grants);
public record UpdateUserRequest(bool? Active, bool? CanCreateWorkspaces);
public record ResetPasswordRequest(string Password);
/// <summary>O admin vê quem existe e quantos espaços cada um tem — nunca o conteúdo dos espaços dos outros.</summary>
public record UserDto(Guid Id, string Name, string Email, bool IsAdmin, bool Active, bool CanCreateWorkspaces,
    bool MustChangePassword, int Workspaces, DateTime CreatedAt);

/// <summary>Contas de usuário. Só o admin cria contas — não existe cadastro aberto.</summary>
public static class AdminApi
{
    private class AdminOnly(AppDb db) : IEndpointFilter
    {
        public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
        {
            var id = ctx.HttpContext.User.UserId();
            return await db.Users.AnyAsync(u => u.Id == id && u.IsAdmin && u.Active) ? await next(ctx) : Results.Forbid();
        }
    }

    public static void Map(RouteGroupBuilder api)
    {
        var a = api.MapGroup("/admin/users").RequireAuthorization().AddEndpointFilter<AdminOnly>();

        a.MapGet("/", async (AppDb db) =>
            await db.Users.OrderByDescending(u => u.IsAdmin).ThenBy(u => u.Name)
                .Select(u => new UserDto(u.Id, u.Name, u.Email, u.IsAdmin, u.Active, u.IsAdmin || u.CanCreateWorkspaces,
                    u.MustChangePassword, db.Memberships.Count(m => m.UserId == u.Id), u.CreatedAt))
                .ToListAsync());

        // Conta nova com senha provisória: no primeiro login a pessoa é obrigada a criar a dela.
        a.MapPost("/", async (CreateUserRequest req, ClaimsPrincipal me, AppDb db) =>
        {
            if (AuthApi.Validate(req.Email ?? "", req.Password ?? "", req.Name ?? "") is { } err)
                return Results.BadRequest(new { error = err });
            var email = AuthApi.NormalizeEmail(req.Email!);
            if (await db.Users.AnyAsync(u => u.Email == email))
                return Results.Conflict(new { error = "Já existe uma conta com esse e-mail." });

            // Só dá para conceder acesso a espaços onde o próprio admin é responsável.
            var adminId = me.UserId();
            var grants = req.Grants ?? [];
            var owned = await db.Memberships.Where(m => m.UserId == adminId && m.Role == MemberRole.Owner)
                .Select(m => m.WorkspaceId).ToListAsync();
            if (grants.Any(g => !owned.Contains(g.WorkspaceId)))
                return Results.BadRequest(new { error = "Você só pode dar acesso a espaços em que é responsável." });

            var user = new User { Name = req.Name!.Trim(), Email = email, CanCreateWorkspaces = req.CanCreateWorkspaces, MustChangePassword = true };
            AuthApi.SetPassword(user, req.Password!);
            db.Users.Add(user);
            foreach (var g in grants.DistinctBy(g => g.WorkspaceId))
                db.Memberships.Add(new Membership { UserId = user.Id, WorkspaceId = g.WorkspaceId, Role = g.Role });
            await db.SaveChangesAsync();
            return Results.Ok(new UserDto(user.Id, user.Name, user.Email, false, true, user.CanCreateWorkspaces, true, grants.Count, user.CreatedAt));
        });

        a.MapPut("/{id:guid}", async (Guid id, UpdateUserRequest req, ClaimsPrincipal me, AppDb db) =>
        {
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            if (req.Active is false && (user.Id == me.UserId() || user.IsAdmin))
                return Results.BadRequest(new { error = "O administrador não pode ser desativado." });
            if (req.Active is { } active && active != user.Active)
            {
                user.Active = active;
                if (!active) user.SecurityStamp = AuthApi.NewStamp(); // derruba as sessões abertas
            }
            if (req.CanCreateWorkspaces is { } can && !user.IsAdmin) user.CanCreateWorkspaces = can;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Esqueceu a senha: o admin define uma provisória; sessões abertas caem e a pessoa cria outra ao entrar.
        a.MapPost("/{id:guid}/reset-password", async (Guid id, ResetPasswordRequest req, AppDb db) =>
        {
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            if (req.Password is null || req.Password.Length < AuthApi.MinPassword)
                return Results.BadRequest(new { error = $"A senha provisória precisa de ao menos {AuthApi.MinPassword} caracteres." });
            AuthApi.SetPassword(user, req.Password);
            user.MustChangePassword = true;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
