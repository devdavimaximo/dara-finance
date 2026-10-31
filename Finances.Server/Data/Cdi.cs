using System.Globalization;
using System.Text.Json;
using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Data;

/// <summary>Estado compartilhado das buscas no Banco Central (uma por vez; recua depois de falha).</summary>
public class CdiFetchState
{
    public SemaphoreSlim Lock { get; } = new(1, 1);
    public DateTime LastTailAttempt { get; set; }
    public DateTime LastFailure { get; set; }
    /// <summary>Menor data já pedida para trás (evita repetir o pedido quando o BCB não tem nada antes).</summary>
    public DateOnly? HeadTriedFrom { get; set; }
}

/// <summary>
/// CDI diário (série SGS 12 do Banco Central, % ao dia), guardado no banco e completado sob demanda.
/// Sem rede ou com o BCB fora do ar, devolve o que já tem — a comparação com o CDI some, o app não.
/// </summary>
public class CdiService(AppDb db, HttpClient http, Clock clock, CdiFetchState state, ILogger<CdiService> log)
{
    private const string Url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial={0:dd/MM/yyyy}&dataFinal={1:dd/MM/yyyy}";
    /// <summary>A taxa do dia sai no fim da tarde: não adianta perguntar de novo antes disso.</summary>
    private static readonly TimeSpan TailEvery = TimeSpan.FromHours(6);
    private static readonly TimeSpan Backoff = TimeSpan.FromMinutes(30);
    /// <summary>O BCB limita consultas diárias a 10 anos; pedimos em blocos menores.</summary>
    private const int ChunkYears = 5;

    public async Task<List<CdiRate>> RatesFromAsync(DateOnly from, CancellationToken ct = default)
    {
        var today = clock.Today;
        if (from > today) return [];
        await state.Lock.WaitAsync(ct);
        try { await EnsureAsync(from, today, ct); }
        finally { state.Lock.Release(); }
        return await db.CdiRates.AsNoTracking().Where(r => r.Date >= from).OrderBy(r => r.Date).ToListAsync(ct);
    }

    private async Task EnsureAsync(DateOnly from, DateOnly today, CancellationToken ct)
    {
        if (DateTime.UtcNow - state.LastFailure < Backoff) return;
        var min = await db.CdiRates.MinAsync(r => (DateOnly?)r.Date, ct);
        var max = await db.CdiRates.MaxAsync(r => (DateOnly?)r.Date, ct);

        var headDone = state.HeadTriedFrom is { } tried && tried <= from;
        var tailDue = DateTime.UtcNow - state.LastTailAttempt >= TailEvery;
        var gaps = new List<(DateOnly From, DateOnly To)>();
        if (min is null || max is null)
        {
            if (!headDone || tailDue) gaps.Add((from, today));
        }
        else
        {
            if (from < min && !headDone) gaps.Add((from, min.Value.AddDays(-1)));
            if (max < today && tailDue) gaps.Add((max.Value.AddDays(1), today));
        }
        if (gaps.Count == 0) return;

        try
        {
            var fetched = new List<CdiRate>();
            foreach (var (a, b) in gaps)
                for (var start = a; start <= b; start = start.AddYears(ChunkYears))
                {
                    var end = start.AddYears(ChunkYears).AddDays(-1);
                    fetched.AddRange(await FetchAsync(start, end < b ? end : b, ct));
                }
            var known = (await db.CdiRates.Select(r => r.Date).ToListAsync(ct)).ToHashSet();
            db.CdiRates.AddRange(fetched.Where(r => known.Add(r.Date)));
            await db.SaveChangesAsync(ct);
            // Só depois de dar certo: falha não deve impedir a próxima tentativa (além do recuo).
            if (state.HeadTriedFrom is null || from < state.HeadTriedFrom) state.HeadTriedFrom = from;
            if (gaps.Any(g => g.To == today)) state.LastTailAttempt = DateTime.UtcNow;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or FormatException)
        {
            state.LastFailure = DateTime.UtcNow;
            log.LogWarning(e, "CDI: falha ao consultar o Banco Central");
        }
    }

    private async Task<List<CdiRate>> FetchAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        // O BCB recusa (400) intervalo de um dia só: recua um dia (o repetido é descartado ao gravar).
        if (from >= to) from = to.AddDays(-1);
        using var res = await http.GetAsync(string.Format(CultureInfo.InvariantCulture, Url, from.ToDateTime(TimeOnly.MinValue), to.ToDateTime(TimeOnly.MinValue)), ct);
        // 404 = nenhum dia útil no intervalo (fim de semana, feriado, hoje ainda sem taxa).
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound) return [];
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
        return doc.RootElement.EnumerateArray().Select(x => new CdiRate
        {
            Date = DateOnly.ParseExact(x.GetProperty("data").GetString()!, "dd/MM/yyyy", CultureInfo.InvariantCulture),
            RatePercent = double.Parse(x.GetProperty("valor").GetString()!, CultureInfo.InvariantCulture),
        }).ToList();
    }
}
