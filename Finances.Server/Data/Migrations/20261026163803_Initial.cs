using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Finances.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Categories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false),
                    Kind = table.Column<string>(type: "TEXT", nullable: false),
                    Color = table.Column<int>(type: "INTEGER", nullable: false),
                    Icon = table.Column<string>(type: "TEXT", nullable: false),
                    BudgetCents = table.Column<long>(type: "INTEGER", nullable: true),
                    Archived = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Categories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Recurrences",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Kind = table.Column<string>(type: "TEXT", nullable: false),
                    Description = table.Column<string>(type: "TEXT", maxLength: 140, nullable: false),
                    AmountCents = table.Column<long>(type: "INTEGER", nullable: false),
                    CategoryId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Counterparty = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    Method = table.Column<string>(type: "TEXT", nullable: true),
                    Frequency = table.Column<string>(type: "TEXT", nullable: false),
                    Interval = table.Column<int>(type: "INTEGER", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    Count = table.Column<int>(type: "INTEGER", nullable: true),
                    GeneratedCount = table.Column<int>(type: "INTEGER", nullable: false),
                    Finished = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Recurrences", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Email = table.Column<string>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    PasswordHash = table.Column<string>(type: "TEXT", nullable: false),
                    IsAdmin = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Workspaces",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Kind = table.Column<string>(type: "TEXT", nullable: false),
                    OpeningBalanceCents = table.Column<long>(type: "INTEGER", nullable: false),
                    OpeningBalanceDate = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Workspaces", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Entries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Kind = table.Column<string>(type: "TEXT", nullable: false),
                    Description = table.Column<string>(type: "TEXT", maxLength: 140, nullable: false),
                    AmountCents = table.Column<long>(type: "INTEGER", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    PaidDate = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    PaidAmountCents = table.Column<long>(type: "INTEGER", nullable: true),
                    CategoryId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Counterparty = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    Method = table.Column<string>(type: "TEXT", nullable: true),
                    Notes = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    RecurrenceId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Sequence = table.Column<int>(type: "INTEGER", nullable: true),
                    AttachmentPath = table.Column<string>(type: "TEXT", nullable: true),
                    AttachmentName = table.Column<string>(type: "TEXT", nullable: true),
                    AttachmentType = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Entries_Categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "Categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Entries_Recurrences_RecurrenceId",
                        column: x => x.RecurrenceId,
                        principalTable: "Recurrences",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Memberships",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Role = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Memberships", x => new { x.UserId, x.WorkspaceId });
                    table.ForeignKey(
                        name: "FK_Memberships_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Memberships_Workspaces_WorkspaceId",
                        column: x => x.WorkspaceId,
                        principalTable: "Workspaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Categories_WorkspaceId",
                table: "Categories",
                column: "WorkspaceId");

            migrationBuilder.CreateIndex(
                name: "IX_Entries_CategoryId",
                table: "Entries",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_Entries_RecurrenceId",
                table: "Entries",
                column: "RecurrenceId");

            migrationBuilder.CreateIndex(
                name: "IX_Entries_WorkspaceId_DueDate",
                table: "Entries",
                columns: new[] { "WorkspaceId", "DueDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Entries_WorkspaceId_PaidDate",
                table: "Entries",
                columns: new[] { "WorkspaceId", "PaidDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Memberships_WorkspaceId",
                table: "Memberships",
                column: "WorkspaceId");

            migrationBuilder.CreateIndex(
                name: "IX_Recurrences_WorkspaceId",
                table: "Recurrences",
                column: "WorkspaceId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Email",
                table: "Users",
                column: "Email",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Entries");

            migrationBuilder.DropTable(
                name: "Memberships");

            migrationBuilder.DropTable(
                name: "Categories");

            migrationBuilder.DropTable(
                name: "Recurrences");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "Workspaces");
        }
    }
}
