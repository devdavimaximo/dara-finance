namespace Finances.Server.Domain;

/// <summary>Tudo que pertence a um tenant. O AppDb filtra e carimba o WorkspaceId sozinho.</summary>
public interface IWorkspaceOwned
{
    Guid WorkspaceId { get; set; }
}

public enum WorkspaceKind { Business, Personal }
public enum MemberRole { Owner, Member }
public enum EntryKind { Expense, Income }
public enum Frequency { Weekly, Monthly, Yearly }
public enum PaymentMethod { Pix, Boleto, CreditCard, DebitCard, Transfer, Cash, Other }

/// <summary>O tenant. Metup é um workspace, a vida pessoal é outro.</summary>
public class Workspace
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public WorkspaceKind Kind { get; set; }
    /// <summary>Saldo em caixa na data de abertura; base do saldo acumulado e do runway.</summary>
    public long OpeningBalanceCents { get; set; }
    public DateOnly OpeningBalanceDate { get; set; }
    /// <summary>Meta de reserva/fôlego em meses de despesa média (0 = desligado).</summary>
    public int ReserveMonths { get; set; } = 6;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    /// <summary>Cria e administra contas. O primeiro usuário (setup) nasce admin.</summary>
    public bool IsAdmin { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Desativado não entra e perde as sessões abertas; os dados ficam.</summary>
    public bool Active { get; set; } = true;
    /// <summary>Senha provisória (definida pelo admin): no próximo login a pessoa cria a própria.</summary>
    public bool MustChangePassword { get; set; }
    /// <summary>Pode criar espaços próprios (o admin sempre pode).</summary>
    public bool CanCreateWorkspaces { get; set; }
    /// <summary>Muda ao redefinir senha/desativar: invalida todos os cookies emitidos antes.</summary>
    public string SecurityStamp { get; set; } = "";

    // Aviso de vencimento (push). Um resumo por dia, a partir da hora escolhida.
    public bool NotifyEnabled { get; set; } = true;
    public int NotifyHour { get; set; } = 8;
    /// <summary>0 = só o que vence hoje; 1 = hoje e amanhã; etc.</summary>
    public int NotifyDaysAhead { get; set; } = 1;
    public DateOnly? LastNotifiedOn { get; set; }
}

/// <summary>Um aparelho inscrito para receber push (Web Push / VAPID).</summary>
public class PushSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Endpoint { get; set; } = "";
    public string P256dh { get; set; } = "";
    public string Auth { get; set; } = "";
    public string? Device { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public User? User { get; set; }
}

public class Membership
{
    public Guid UserId { get; set; }
    public Guid WorkspaceId { get; set; }
    public MemberRole Role { get; set; }
    public User? User { get; set; }
    public Workspace? Workspace { get; set; }
}

public class Category : IWorkspaceOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    public EntryKind Kind { get; set; }
    /// <summary>Slot 1–8 da paleta categórica validada (a cor segue a entidade, nunca o ranking).</summary>
    public int Color { get; set; } = 1;
    public string Icon { get; set; } = "tag";
    /// <summary>Teto mensal opcional — alimenta "orçado × realizado".</summary>
    public long? BudgetCents { get; set; }
    public bool Archived { get; set; }
}

/// <summary>
/// Objetivo (casamento, carro, casa): uma meta em dinheiro que despesas ligadas a ele vão cumprindo.
/// Pago = despesas ligadas já pagas; agendado = ligadas em aberto; falta = meta − pago − agendado.
/// Independente do pote (categoria): a parcela do buffet pode estar no pote "Festa" e no objetivo "Casamento".
/// </summary>
public class Goal : IWorkspaceOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    public string Icon { get; set; } = "target";
    /// <summary>Slot 1–8 da paleta categórica.</summary>
    public int Color { get; set; } = 1;
    public long TargetCents { get; set; }
    public DateOnly? TargetDate { get; set; }
    public string? Notes { get; set; }
    /// <summary>Concluído/arquivado: sai da lista principal e do formulário, mas mantém o histórico.</summary>
    public bool Archived { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Uma conta a pagar ou a receber, com vencimento. Pago = PaidDate preenchido.
/// Ocorrências de séries recorrentes também são Entries (materializadas à frente).
/// </summary>
public class Entry : IWorkspaceOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public EntryKind Kind { get; set; }
    public string Description { get; set; } = "";
    public long AmountCents { get; set; }
    public DateOnly DueDate { get; set; }
    public DateOnly? PaidDate { get; set; }
    /// <summary>Valor efetivamente pago/recebido (juros, desconto). Só existe quando pago.</summary>
    public long? PaidAmountCents { get; set; }
    /// <summary>
    /// Pago/recebido por fora deste caixa (ex.: o sócio pagou a despesa da empresa com o dinheiro pessoal).
    /// Conta como realizado, mas não mexe no saldo. Só faz sentido quando pago.
    /// </summary>
    public bool OffCash { get; set; }
    /// <summary>De onde saiu/para onde foi o dinheiro quando OffCash (ex.: "Conta pessoal Nubank"). Opcional.</summary>
    public string? OffCashSource { get; set; }
    public Guid? CategoryId { get; set; }
    public Guid? GoalId { get; set; }
    public string? Counterparty { get; set; }
    public PaymentMethod? Method { get; set; }
    public string? Notes { get; set; }

    /// <summary>
    /// Compra no cartão: o vencimento é o da fatura (CardMath.InvoiceDue), então caixa e previsto caem no
    /// mês em que a fatura é paga. A fatura = compras do cartão com o mesmo vencimento. PurchaseDate = dia da compra.
    /// </summary>
    public Guid? CardId { get; set; }
    public DateOnly? PurchaseDate { get; set; }
    /// <summary>Metade de uma transferência entre espaços (despesa num, receita no outro, mesmo id).</summary>
    public Guid? TransferId { get; set; }

    public Guid? RecurrenceId { get; set; }
    /// <summary>Posição 1-based na série (ex.: parcela 3 de 10).</summary>
    public int? Sequence { get; set; }

    /// <summary>Id da transação no extrato (FITID do OFX ou hash do CSV) — evita importar duas vezes.</summary>
    public string? ExternalId { get; set; }

    public string? AttachmentPath { get; set; }
    public string? AttachmentName { get; set; }
    public string? AttachmentType { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public Category? Category { get; set; }
    public Goal? Goal { get; set; }
    public Recurrence? Recurrence { get; set; }
}

public enum InvestmentKind { Fii, Stock, Etf, Cdb, TesouroSelic, Treasury, Fund, Crypto, Other }
public enum InvestmentMoveKind { Contribution, Withdrawal, Income, Valuation }
/// <summary>De onde veio o dinheiro de um aporte.</summary>
public enum ContributionOrigin
{
    /// <summary>Saiu do caixa deste espaço.</summary>
    Cash,
    /// <summary>Dinheiro de fora (já estava investido antes do dara, outra conta).</summary>
    External,
    /// <summary>Proventos reinvestidos: rendimento, não dinheiro novo.</summary>
    Reinvest,
}

/// <summary>
/// Uma aplicação (CDB X, MXRF11, Tesouro Selic 2029). O histórico mora em <see cref="InvestmentMove"/>;
/// valor, ganho e rentabilidade são derivados dele.
/// </summary>
public class Investment : IWorkspaceOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    public InvestmentKind Kind { get; set; }
    /// <summary>Banco/corretora (opcional).</summary>
    public string? Institution { get; set; }
    /// <summary>Slot 1–8 da paleta categórica.</summary>
    public int Color { get; set; } = 1;
    /// <summary>
    /// O valor desta aplicação conta como caixa (ex.: reserva com liquidez diária). Aporte e resgate
    /// viram troca de lugar (o saldo não muda) e o rendimento aparece no saldo.
    /// </summary>
    public bool CountsInCash { get; set; }
    public string? Notes { get; set; }
    public bool Archived { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Objetivo que este dinheiro está guardando (aparece como "guardado" no objetivo).</summary>
    public Guid? GoalId { get; set; }

    // Aporte programado: todo mês, no dia PlanDay (ajustado ao fim do mês), a partir de PlanStart.
    // Não vira lançamento: aparece na projeção do caixa e é confirmado como aporte (InvestmentMove.PlanDate).
    public long? PlanAmountCents { get; set; }
    public int? PlanDay { get; set; }
    public DateOnly? PlanStart { get; set; }
}

/// <summary>Cartão de crédito: só os dias de fechamento e de vencimento da fatura.</summary>
public class Card : IWorkspaceOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Dia em que a fatura fecha (compras desse dia em diante vão para a próxima).</summary>
    public int ClosingDay { get; set; }
    public int DueDay { get; set; }
    public int Color { get; set; } = 1;
    public bool Archived { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Taxa do CDI num dia útil (% ao dia, como o Banco Central publica). Dado de referência, igual para todos.</summary>
public class CdiRate
{
    public DateOnly Date { get; set; }
    public double RatePercent { get; set; }
}

/// <summary>
/// Um fato do histórico de uma aplicação. Valuation = "hoje vale X" (AmountCents é o valor total,
/// líquido do que o banco mostra); os demais são movimentos de dinheiro.
/// </summary>
public class InvestmentMove : IWorkspaceOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public Guid InvestmentId { get; set; }
    public InvestmentMoveKind Kind { get; set; }
    public DateOnly Date { get; set; }
    public long AmountCents { get; set; }
    /// <summary>Só em aportes.</summary>
    public ContributionOrigin? Origin { get; set; }
    /// <summary>Resgate: o dinheiro voltou para o caixa deste espaço (senão foi para fora).</summary>
    public bool ToCash { get; set; }
    /// <summary>Aporte que confirmou a ocorrência do aporte programado desta data.</summary>
    public DateOnly? PlanDate { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Investment? Investment { get; set; }
}

/// <summary>
/// Molde de um lançamento que se repete. Count definido = parcelado (N vezes);
/// EndDate definido = até a data; nenhum dos dois = indefinido.
/// </summary>
public class Recurrence : IWorkspaceOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public EntryKind Kind { get; set; }
    public string Description { get; set; } = "";
    public long AmountCents { get; set; }
    public Guid? CategoryId { get; set; }
    public Guid? GoalId { get; set; }
    /// <summary>Parcelado no cartão: cada parcela cai numa fatura (StartDate = vencimento da 1ª).</summary>
    public Guid? CardId { get; set; }
    public string? Counterparty { get; set; }
    public PaymentMethod? Method { get; set; }

    public Frequency Frequency { get; set; }
    public int Interval { get; set; } = 1;
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public int? Count { get; set; }

    /// <summary>Quantas ocorrências já viraram Entry (índice da próxima).</summary>
    public int GeneratedCount { get; set; }
    /// <summary>Série encerrada (fim atingido ou interrompida).</summary>
    public bool Finished { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
