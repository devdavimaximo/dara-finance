using System.Security.Claims;
using Finances.Server.Data;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Api;

public record PushKeys(string P256dh, string Auth);
public record SubscribeRequest(string Endpoint, PushKeys Keys, string? Device);
public record UnsubscribeRequest(string Endpoint);
public record NotifySettings(bool Enabled, int Hour, int DaysAhead, int Devices);

/// <summary>Aviso de vencimento: inscrição do aparelho e preferências (por usuário, valem para todos os espaços).</summary>
public static class PushApi
{
    public static void Map(RouteGroupBuilder api)
    {
        var p = api.MapGroup("/push").RequireAuthorization();

        p.MapGet("/key", (PushService push) => new { publicKey = push.PublicKey });

        p.MapPost("/subscribe", async (SubscribeRequest req, ClaimsPrincipal user, AppDb db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Endpoint) || !req.Endpoint.StartsWith("https://") || req.Keys is null)
                return Results.BadRequest(new { error = "Inscrição inválida." });
            var sub = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint);
            if (sub is null) db.PushSubscriptions.Add(sub = new PushSubscription { Endpoint = req.Endpoint });
            // O mesmo aparelho pode trocar de conta: a inscrição passa a ser de quem está logado.
            sub.UserId = user.UserId();
            sub.P256dh = req.Keys.P256dh;
            sub.Auth = req.Keys.Auth;
            sub.Device = req.Device?[..Math.Min(80, req.Device.Length)];
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        p.MapPost("/unsubscribe", async (UnsubscribeRequest req, ClaimsPrincipal user, AppDb db) =>
        {
            var userId = user.UserId();
            await db.PushSubscriptions.Where(s => s.Endpoint == req.Endpoint && s.UserId == userId).ExecuteDeleteAsync();
            return Results.NoContent();
        });

        p.MapGet("/settings", async (ClaimsPrincipal user, AppDb db) =>
        {
            var u = await db.Users.FindAsync(user.UserId());
            if (u is null) return Results.Unauthorized();
            var devices = await db.PushSubscriptions.CountAsync(s => s.UserId == u.Id);
            return Results.Ok(new NotifySettings(u.NotifyEnabled, u.NotifyHour, u.NotifyDaysAhead, devices));
        });

        p.MapPut("/settings", async (NotifySettings req, ClaimsPrincipal user, AppDb db) =>
        {
            var u = await db.Users.FindAsync(user.UserId());
            if (u is null) return Results.Unauthorized();
            u.NotifyEnabled = req.Enabled;
            u.NotifyHour = Math.Clamp(req.Hour, 0, 23);
            u.NotifyDaysAhead = Math.Clamp(req.DaysAhead, 0, 14);
            u.LastNotifiedOn = null; // permite receber hoje com a nova configuração
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Manda agora o resumo que chegaria no horário — serve para testar o aparelho.
        p.MapPost("/test", async (ClaimsPrincipal user, AppDb db, TenantContext tenant, PushService push, Clock clock) =>
        {
            var u = await db.Users.FindAsync(user.UserId());
            if (u is null) return Results.Unauthorized();
            var items = await PushService.DueItemsAsync(db, tenant, u.Id, clock.Today, u.NotifyDaysAhead);
            var msg = DueDigest.Build(items, clock.Today, includeEmpty: true)!.Value;
            var sent = await push.SendAsync(db, u.Id, msg.Title, msg.Body);
            return sent > 0 ? Results.Ok(new { sent, msg.Title, msg.Body }) : Results.BadRequest(new { error = "Nenhum aparelho inscrito recebeu o aviso." });
        });
    }
}
