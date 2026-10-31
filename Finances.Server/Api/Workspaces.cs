using System.Security.Claims;
using Finances.Server.Data;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Api;

public record CreateWorkspaceRequest(string Name, WorkspaceKind Kind, Guid? OwnerUserId = null);
/// <param name="ReserveMonths">Meta de reserva em meses (0 = desligado; ausente = mantém).</param>
public record UpdateWorkspaceRequest(string Name, long OpeningBalanceCents, DateOnly OpeningBalanceDate, int? ReserveMonths = null);
public record AddMemberRequest(string Email, MemberRole Role);
public record ChangeRoleRequest(MemberRole Role);
public record MemberDto(Guid UserId, string Name, string Email, MemberRole Role);

/// <summary>
/// Ponto central de autorização por tenant: toda rota /w/{workspaceId}/... passa aqui.
/// Sem membership = 404 (não revela que o workspace existe).
/// </summary>
public class WorkspaceFilter(AppDb db, TenantContext tenant) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var http = ctx.HttpContext;
        if (!Guid.TryParse(http.Request.RouteValues["workspaceId"]?.ToString(), out var wid))
            return Results.NotFound();
        var userId = http.User.UserId();
        var membership = await db.Memberships.AsNoTracking()
            .FirstOrDefaultAsync(m => m.UserId == userId && m.WorkspaceId == wid);
        if (membership is null) return Results.NotFound();

        tenant.WorkspaceId = wid;
        tenant.Role = membership.Role;
        return await next(ctx);
    }
}

public static class WorkspaceApi
{
    public static async Task<Workspace> CreateWorkspace(AppDb db, TenantContext tenant, Guid ownerId, string name, WorkspaceKind kind, DateOnly? today = null)
    {
        var ws = new Workspace
        {
            Name = name.Trim(),
            Kind = kind,
            OpeningBalanceDate = today ?? DateOnly.FromDateTime(DateTime.UtcNow.AddHours(-3)),
        };
        db.Workspaces.Add(ws);
        db.Memberships.Add(new Membership { UserId = ownerId, WorkspaceId = ws.Id, Role = MemberRole.Owner });

        var previous = tenant.WorkspaceId;
        tenant.WorkspaceId = ws.Id;
        try
        {
            db.Categories.AddRange(Seed.DefaultCategories(kind));
            await db.SaveChangesAsync();
        }
        finally { tenant.WorkspaceId = previous; }
        return ws;
    }

    public static void Map(RouteGroupBuilder api)
    {
        // Quem pode criar: admin, ou usuário com "pode criar espaços". Quem cria vira o único responsável.
        // O admin pode criar já em nome de outra pessoa (OwnerUserId) — e aí ele mesmo não entra no espaço.
        api.MapPost("/workspaces", async (CreateWorkspaceRequest req, ClaimsPrincipal p, AppDb db, TenantContext tenant, Clock clock) =>
        {
            var user = await db.Users.FindAsync(p.UserId());
            if (user is null || !(user.IsAdmin || user.CanCreateWorkspaces)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.Name)) return Results.BadRequest(new { error = "Informe o nome." });

            var ownerId = user.Id;
            if (req.OwnerUserId is { } other && other != user.Id)
            {
                if (!user.IsAdmin) return Results.Forbid();
                if (!await db.Users.AnyAsync(u => u.Id == other && u.Active))
                    return Results.BadRequest(new { error = "Responsável inválido ou desativado." });
                ownerId = other;
            }
            var ws = await CreateWorkspace(db, tenant, ownerId, req.Name, req.Kind, clock.Today);
            return Results.Ok(new WorkspaceDto(ws.Id, ws.Name, ws.Kind, MemberRole.Owner, 0, ws.OpeningBalanceDate, ws.ReserveMonths));
        }).RequireAuthorization();

        var w = api.MapGroup("/w/{workspaceId:guid}").RequireAuthorization().AddEndpointFilter<WorkspaceFilter>();

        w.MapPut("/", async (Guid workspaceId, UpdateWorkspaceRequest req, AppDb db, TenantContext tenant) =>
        {
            if (tenant.Role != MemberRole.Owner) return Results.Forbid();
            var ws = await db.Workspaces.FindAsync(workspaceId);
            if (ws is null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(req.Name)) return Results.BadRequest(new { error = "Informe o nome." });
            ws.Name = req.Name.Trim();
            ws.OpeningBalanceCents = req.OpeningBalanceCents;
            ws.OpeningBalanceDate = req.OpeningBalanceDate;
            if (req.ReserveMonths is { } months) ws.ReserveMonths = Math.Clamp(months, 0, 36);
            await db.SaveChangesAsync();
            return Results.Ok(new WorkspaceDto(ws.Id, ws.Name, ws.Kind, tenant.Role, ws.OpeningBalanceCents, ws.OpeningBalanceDate, ws.ReserveMonths));
        });

        w.MapGet("/members", async (Guid workspaceId, AppDb db) =>
            await db.Memberships.Where(m => m.WorkspaceId == workspaceId)
                .Select(m => new MemberDto(m.UserId, m.User!.Name, m.User.Email, m.Role)).ToListAsync());

        // Dá acesso a uma conta que JÁ existe. Contas novas só o admin cria (Ajustes → Usuários).
        w.MapPost("/members", async (Guid workspaceId, AddMemberRequest req, AppDb db, TenantContext tenant) =>
        {
            if (tenant.Role != MemberRole.Owner) return Results.Forbid();
            var email = AuthApi.NormalizeEmail(req.Email ?? "");
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
            if (user is null || !user.Active)
                return Results.BadRequest(new { error = "Não existe conta ativa com esse e-mail. Peça ao administrador para criá-la." });
            if (await db.Memberships.AnyAsync(m => m.UserId == user.Id && m.WorkspaceId == workspaceId))
                return Results.Conflict(new { error = "Essa pessoa já tem acesso." });

            db.Memberships.Add(new Membership { UserId = user.Id, WorkspaceId = workspaceId, Role = req.Role });
            await db.SaveChangesAsync();
            return Results.Ok(new MemberDto(user.Id, user.Name, user.Email, req.Role));
        });

        // Muda o papel (membro ↔ responsável). Todo espaço precisa de ao menos um responsável.
        w.MapPut("/members/{userId:guid}", async (Guid workspaceId, Guid userId, ChangeRoleRequest req, AppDb db, TenantContext tenant) =>
        {
            if (tenant.Role != MemberRole.Owner) return Results.Forbid();
            var m = await db.Memberships.FindAsync(userId, workspaceId);
            if (m is null) return Results.NotFound();
            if (m.Role == MemberRole.Owner && req.Role != MemberRole.Owner && await IsLastOwner(db, workspaceId))
                return Results.BadRequest(new { error = LastOwnerError });
            m.Role = req.Role;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Responsável remove alguém; qualquer pessoa pode remover a si mesma (sair do espaço).
        w.MapDelete("/members/{userId:guid}", async (Guid workspaceId, Guid userId, AppDb db, TenantContext tenant, ClaimsPrincipal p) =>
        {
            var self = userId == p.UserId();
            if (!self && tenant.Role != MemberRole.Owner) return Results.Forbid();
            var m = await db.Memberships.FindAsync(userId, workspaceId);
            if (m is null) return Results.NotFound();
            if (m.Role == MemberRole.Owner && await IsLastOwner(db, workspaceId))
                return Results.BadRequest(new { error = LastOwnerError });
            db.Memberships.Remove(m);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private const string LastOwnerError = "O espaço precisa de ao menos um responsável. Promova outra pessoa antes.";

    private static async Task<bool> IsLastOwner(AppDb db, Guid workspaceId) =>
        await db.Memberships.CountAsync(m => m.WorkspaceId == workspaceId && m.Role == MemberRole.Owner) <= 1;
}
