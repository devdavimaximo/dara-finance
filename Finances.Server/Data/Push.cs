using System.Net;
using System.Text.Json;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;
using WebPush;

namespace Finances.Server.Data;

/// <summary>
/// Web Push com VAPID. As chaves são geradas no primeiro start e guardadas em DATA_DIR/vapid.json
/// (perder esse arquivo invalida as inscrições dos aparelhos).
/// </summary>
public class PushService
{
    private readonly VapidDetails _vapid;
    private readonly WebPushClient _client = new();
    private readonly ILogger<PushService> _log;

    public string PublicKey => _vapid.PublicKey;

    public PushService(IConfiguration config, ILogger<PushService> log, DataDir dataDir)
    {
        _log = log;
        var file = Path.Combine(dataDir.Path, "vapid.json");
        VapidKeys keys;
        if (File.Exists(file))
            keys = JsonSerializer.Deserialize<VapidKeys>(File.ReadAllText(file))!;
        else
        {
            var k = VapidHelper.GenerateVapidKeys();
            keys = new VapidKeys(k.PublicKey, k.PrivateKey);
            File.WriteAllText(file, JsonSerializer.Serialize(keys));
        }
        // Apple exige um subject válido (mailto: ou https:). Configure VAPID_SUBJECT em produção.
        _vapid = new VapidDetails(config["VAPID_SUBJECT"] ?? "mailto:razao@localhost.dev", keys.PublicKey, keys.PrivateKey);
    }

    private record VapidKeys(string PublicKey, string PrivateKey);

    /// <summary>Envia para todos os aparelhos do usuário. Inscrições mortas (404/410) são removidas.</summary>
    public async Task<int> SendAsync(AppDb db, Guid userId, string title, string body, string url = "/lancamentos", CancellationToken ct = default)
    {
        var subs = await db.PushSubscriptions.Where(s => s.UserId == userId).ToListAsync(ct);
        var payload = JsonSerializer.Serialize(new { title, body, url, tag = "razao-due" });
        var sent = 0;
        foreach (var s in subs)
        {
            try
            {
                await _client.SendNotificationAsync(new WebPush.PushSubscription(s.Endpoint, s.P256dh, s.Auth), payload, _vapid, ct);
                sent++;
            }
            catch (WebPushException ex) when (ex.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound)
            {
                db.PushSubscriptions.Remove(s);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Falha ao enviar push para {Endpoint}", s.Endpoint[..Math.Min(60, s.Endpoint.Length)]);
            }
        }
        await db.SaveChangesAsync(ct);
        return sent;
    }

    /// <summary>Itens em aberto de todos os workspaces do usuário que vencem até hoje+N (inclui atrasados).</summary>
    public static async Task<List<DueItem>> DueItemsAsync(AppDb db, TenantContext tenant, Guid userId, DateOnly today, int daysAhead, CancellationToken ct = default)
    {
        var workspaces = await db.Memberships.Where(m => m.UserId == userId)
            .Select(m => new { m.WorkspaceId, m.Workspace!.Name }).ToListAsync(ct);
        var limit = today.AddDays(Math.Clamp(daysAhead, 0, 14));
        var overdueFrom = today.AddDays(-60); // atraso muito antigo não vira lembrete diário
        var items = new List<DueItem>();
        var previous = tenant.WorkspaceId;
        try
        {
            foreach (var w in workspaces)
            {
                tenant.WorkspaceId = w.WorkspaceId;
                var rows = await db.Entries.AsNoTracking()
                    .Where(e => e.PaidDate == null && e.DueDate <= limit && e.DueDate >= overdueFrom)
                    .Select(e => new { e.Kind, e.Description, e.AmountCents, e.DueDate })
                    .ToListAsync(ct);
                items.AddRange(rows
                    .Where(e => e.Kind == EntryKind.Expense || e.DueDate >= today) // receita atrasada não vira push diário
                    .Select(e => new DueItem(w.Name, e.Kind, e.Description, e.AmountCents, e.DueDate)));
            }
        }
        finally { tenant.WorkspaceId = previous; }
        return items;
    }
}

/// <summary>Uma vez por dia, a partir da hora escolhida por cada usuário, manda o resumo de vencimentos.</summary>
public class DueReminderService(IServiceScopeFactory scopes, ILogger<DueReminderService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        do
        {
            try { await RunOnceAsync(ct); }
            catch (Exception ex) when (!ct.IsCancellationRequested) { log.LogError(ex, "Falha no lembrete de vencimentos"); }
        } while (await timer.WaitForNextTickAsync(ct));
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        var clock = scope.ServiceProvider.GetRequiredService<Clock>();
        var push = scope.ServiceProvider.GetRequiredService<PushService>();
        var today = clock.Today;
        var hour = clock.Now.Hour;

        var users = await db.Users
            .Where(u => u.NotifyEnabled && u.NotifyHour <= hour && (u.LastNotifiedOn == null || u.LastNotifiedOn < today))
            .Where(u => db.PushSubscriptions.Any(s => s.UserId == u.Id))
            .ToListAsync(ct);

        foreach (var u in users)
        {
            var items = await PushService.DueItemsAsync(db, tenant, u.Id, today, u.NotifyDaysAhead, ct);
            if (DueDigest.Build(items, today) is { } msg)
                await push.SendAsync(db, u.Id, msg.Title, msg.Body, ct: ct);
            u.LastNotifiedOn = today;
            await db.SaveChangesAsync(ct);
        }
    }
}

/// <summary>Diretório de dados resolvido no start (banco, uploads, chaves).</summary>
public record DataDir(string Path);
