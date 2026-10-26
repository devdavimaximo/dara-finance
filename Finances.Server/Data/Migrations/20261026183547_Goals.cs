using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Finances.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class Goals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "GoalId",
                table: "Recurrences",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "GoalId",
                table: "Entries",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Goals",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Icon = table.Column<string>(type: "TEXT", nullable: false),
                    Color = table.Column<int>(type: "INTEGER", nullable: false),
                    TargetCents = table.Column<long>(type: "INTEGER", nullable: false),
                    TargetDate = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    Notes = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    Archived = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Goals", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Recurrences_GoalId",
                table: "Recurrences",
                column: "GoalId");

            migrationBuilder.CreateIndex(
                name: "IX_Entries_GoalId",
                table: "Entries",
                column: "GoalId");

            migrationBuilder.CreateIndex(
                name: "IX_Goals_WorkspaceId",
                table: "Goals",
                column: "WorkspaceId");

            migrationBuilder.AddForeignKey(
                name: "FK_Entries_Goals_GoalId",
                table: "Entries",
                column: "GoalId",
                principalTable: "Goals",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Recurrences_Goals_GoalId",
                table: "Recurrences",
                column: "GoalId",
                principalTable: "Goals",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Entries_Goals_GoalId",
                table: "Entries");

            migrationBuilder.DropForeignKey(
                name: "FK_Recurrences_Goals_GoalId",
                table: "Recurrences");

            migrationBuilder.DropTable(
                name: "Goals");

            migrationBuilder.DropIndex(
                name: "IX_Recurrences_GoalId",
                table: "Recurrences");

            migrationBuilder.DropIndex(
                name: "IX_Entries_GoalId",
                table: "Entries");

            migrationBuilder.DropColumn(
                name: "GoalId",
                table: "Recurrences");

            migrationBuilder.DropColumn(
                name: "GoalId",
                table: "Entries");
        }
    }
}
