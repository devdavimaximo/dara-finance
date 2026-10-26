using Finances.Server.Domain;
using Microsoft.EntityFrameworkCore;

namespace Finances.Server.Data;

/// <summary>
/// Tenant da requisição atual. Preenchido pelo WorkspaceFilter depois de conferir a membership.
/// Vazio = nenhum dado de negócio visível (padrão seguro).
/// </summary>
public class TenantContext
{
    public Guid WorkspaceId { get; set; }
    public MemberRole Role { get; set; }
}

public class AppDb(DbContextOptions<AppDb> options, TenantContext tenant) : DbContext(options)
{
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Entry> Entries => Set<Entry>();
    public DbSet<Recurrence> Recurrences => Set<Recurrence>();
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();
    public DbSet<Goal> Goals => Set<Goal>();

    // Lido pelo filtro global a cada consulta (EF parametriza membros do contexto).
    private Guid CurrentWorkspaceId => tenant.WorkspaceId;

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(u => u.Email).IsUnique();
        b.Entity<Membership>().HasKey(m => new { m.UserId, m.WorkspaceId });
        b.Entity<Workspace>().Property(w => w.Name).HasMaxLength(80);
        b.Entity<PushSubscription>(e =>
        {
            e.HasIndex(x => x.Endpoint).IsUnique();
            e.Property(x => x.Endpoint).HasMaxLength(800);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Category>(e =>
        {
            e.HasQueryFilter(x => x.WorkspaceId == CurrentWorkspaceId);
            e.HasIndex(x => x.WorkspaceId);
            e.Property(x => x.Name).HasMaxLength(60);
        });

        b.Entity<Entry>(e =>
        {
            e.HasQueryFilter(x => x.WorkspaceId == CurrentWorkspaceId);
            e.HasIndex(x => new { x.WorkspaceId, x.DueDate });
            e.HasIndex(x => new { x.WorkspaceId, x.PaidDate });
            e.HasIndex(x => x.RecurrenceId);
            e.HasIndex(x => new { x.WorkspaceId, x.ExternalId });
            e.Property(x => x.ExternalId).HasMaxLength(120);
            e.Property(x => x.Description).HasMaxLength(140);
            e.Property(x => x.Counterparty).HasMaxLength(100);
            e.Property(x => x.Notes).HasMaxLength(1000);
            e.HasOne(x => x.Category).WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.SetNull);
            // Excluir o objetivo não apaga os lançamentos: só desliga.
            e.HasOne(x => x.Goal).WithMany().HasForeignKey(x => x.GoalId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => x.GoalId);
            e.HasOne(x => x.Recurrence).WithMany().HasForeignKey(x => x.RecurrenceId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Goal>(e =>
        {
            e.HasQueryFilter(x => x.WorkspaceId == CurrentWorkspaceId);
            e.HasIndex(x => x.WorkspaceId);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Notes).HasMaxLength(1000);
        });

        b.Entity<Recurrence>(e =>
        {
            e.HasOne<Goal>().WithMany().HasForeignKey(x => x.GoalId).OnDelete(DeleteBehavior.SetNull);
            e.HasQueryFilter(x => x.WorkspaceId == CurrentWorkspaceId);
            e.HasIndex(x => x.WorkspaceId);
            e.Property(x => x.Description).HasMaxLength(140);
            e.Property(x => x.Counterparty).HasMaxLength(100);
        });

        // Enums como texto: legível no banco e estável se a ordem mudar.
        foreach (var entity in b.Model.GetEntityTypes())
            foreach (var prop in entity.GetProperties())
            {
                var t = Nullable.GetUnderlyingType(prop.ClrType) ?? prop.ClrType;
                if (t.IsEnum) prop.SetProviderClrType(typeof(string));
            }
    }

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        foreach (var e in ChangeTracker.Entries<IWorkspaceOwned>())
        {
            if (e.State == EntityState.Added && e.Entity.WorkspaceId == Guid.Empty)
                e.Entity.WorkspaceId = tenant.WorkspaceId;

            // Costura de segurança: nada é gravado fora do tenant da requisição.
            if (e.State is EntityState.Added or EntityState.Modified &&
                (e.Entity.WorkspaceId == Guid.Empty || e.Entity.WorkspaceId != tenant.WorkspaceId))
                throw new InvalidOperationException("Escrita fora do workspace atual.");
        }
        foreach (var e in ChangeTracker.Entries<Entry>().Where(x => x.State == EntityState.Modified))
            e.Entity.UpdatedAt = DateTime.UtcNow;

        return base.SaveChangesAsync(ct);
    }
}
