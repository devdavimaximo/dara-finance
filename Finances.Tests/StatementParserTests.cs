using System.Text;
using Finances.Server.Domain;

namespace Finances.Tests;

public class StatementParserTests
{
    [Theory]
    [InlineData("R$ -1.234,56", -123456L)]
    [InlineData("-1234.56", -123456L)]
    [InlineData("1.234,56 D", -123456L)]
    [InlineData("(50,00)", -5000L)]
    [InlineData("2.500", 250000L)]
    [InlineData("89,9", 8990L)]
    [InlineData("abc", null)]
    public void Parses_brazilian_amounts(string input, long? expected) =>
        Assert.Equal(expected, StatementParser.ParseAmount(input));

    [Fact]
    public void Nubank_account_csv_uses_identifier_and_signs()
    {
        const string csv = "Data,Valor,Identificador,Descrição\n05/10/2026,-42.00,abc-1,Compra no débito - Padaria\n06/10/2026,3500.00,abc-2,Transferência recebida\n";
        var rows = StatementParser.Parse(Encoding.UTF8.GetBytes(csv), "nubank.csv");
        Assert.Equal(2, rows.Count);
        Assert.Equal(-4200, rows[0].AmountCents);
        Assert.Equal("csv:abc-1", rows[0].ExternalId);
        Assert.Equal(new DateOnly(2026, 10, 6), rows[1].Date);
    }

    [Fact]
    public void Semicolon_csv_with_debit_and_credit_columns_in_latin1()
    {
        const string csv = "Extrato conta corrente\nData;Histórico;Débito;Crédito;Saldo\n01/10/2026;TARIFA PACOTE;29,90;;1.000,00\n02/10/2026;PIX RECEBIDO;;150,00;1.150,00\n02/10/2026;PIX RECEBIDO;;150,00;1.300,00\n";
        var rows = StatementParser.Parse(Encoding.Latin1.GetBytes(csv), "itau.csv");
        Assert.Equal(3, rows.Count);
        Assert.Equal(-2990, rows[0].AmountCents);
        Assert.Equal("TARIFA PACOTE", rows[0].Description);
        Assert.Equal(15000, rows[1].AmountCents);
        // Duas linhas idênticas no mesmo dia são transações distintas.
        Assert.NotEqual(rows[1].ExternalId, rows[2].ExternalId);
    }

    [Fact]
    public void Headerless_csv_is_inferred_from_content()
    {
        const string csv = "2026-10-01,Mercado Bom Preço,-215.40\n2026-10-03,Salário,5000.00\n";
        var rows = StatementParser.ParseCsv(csv);
        Assert.Equal(2, rows.Count);
        Assert.Equal("Mercado Bom Preço", rows[0].Description);
        Assert.Equal(-21540, rows[0].AmountCents);
    }

    [Fact]
    public void Ofx_without_closing_tags()
    {
        const string ofx = "<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005<TRNAMT>-99.90<FITID>X9<NAME>NETFLIX</OFX>";
        var row = Assert.Single(StatementParser.ParseOfx(ofx));
        Assert.Equal(-9990, row.AmountCents);
        Assert.Equal("ofx:X9", row.ExternalId);
        Assert.Equal("NETFLIX", row.Description);
    }
}

public class DueDigestTests
{
    private static readonly DateOnly Today = new(2026, 10, 26);

    [Fact]
    public void Nothing_to_say_returns_null_unless_testing()
    {
        Assert.Null(DueDigest.Build([], Today));
        Assert.Equal("Tudo em dia ✓", DueDigest.Build([], Today, includeEmpty: true)!.Value.Title);
    }

    [Fact]
    public void Title_leads_with_the_nearest_bills_and_flags_overdue()
    {
        var msg = DueDigest.Build([
            new("Metup", EntryKind.Expense, "Contador", 65000, Today),
            new("Metup", EntryKind.Expense, "VPS", 18000, Today),
            new("Pessoal", EntryKind.Expense, "Aluguel", 200000, Today.AddDays(1)),
            new("Pessoal", EntryKind.Expense, "Luz", 21000, Today.AddDays(-2)),
        ], Today)!.Value;
        Assert.StartsWith("Hoje: 2 contas", msg.Title);
        Assert.Contains("Pessoal · Luz", msg.Body);       // vários espaços: prefixa o nome
        Assert.Contains("atrasada 2d", msg.Body);
        Assert.Contains("⚠ 1 atrasada(s)", msg.Body);
    }
}

public class ImportLearningTests
{
    [Fact]
    public void Key_ignores_accents_bank_noise_and_numbers()
    {
        Assert.Equal("pro labore davi", Finances.Server.Api.ImportApi.Key("PIX ENVIADO PRO-LABORE DAVI 123"));
        Assert.Equal("pro labore davi", Finances.Server.Api.ImportApi.Key("Pró-labore Davi"));
    }

    [Fact]
    public void Suggest_matches_by_prefix_of_learned_description()
    {
        var cat = Guid.NewGuid();
        var learned = new Dictionary<string, Guid> { ["Expense|figma notion"] = cat };
        Assert.Equal(cat, Finances.Server.Api.ImportApi.Suggest(learned, EntryKind.Expense, "figma notion assinatura"));
        Assert.Null(Finances.Server.Api.ImportApi.Suggest(learned, EntryKind.Income, "figma notion assinatura"));
        Assert.Null(Finances.Server.Api.ImportApi.Suggest(learned, EntryKind.Expense, "figmax"));
    }
}
