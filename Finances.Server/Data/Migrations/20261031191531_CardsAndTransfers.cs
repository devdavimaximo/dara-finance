using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Finances.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class CardsAndTransfers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CardId",
                table: "Recurrences",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CardId",
                table: "Entries",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PurchaseDate",
                table: "Entries",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TransferId",
                table: "Entries",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Cards",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false),
                    ClosingDay = table.Column<int>(type: "INTEGER", nullable: false),
                    DueDay = table.Column<int>(type: "INTEGER", nullable: false),
                    Color = table.Column<int>(type: "INTEGER", nullable: false),
                    Archived = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Cards", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Recurrences_CardId",
                table: "Recurrences",
                column: "CardId");

            migrationBuilder.CreateIndex(
                name: "IX_Entries_CardId",
                table: "Entries",
                column: "CardId");

            migrationBuilder.CreateIndex(
                name: "IX_Entries_TransferId",
                table: "Entries",
                column: "TransferId");

            migrationBuilder.CreateIndex(
                name: "IX_Entries_WorkspaceId_CardId_DueDate",
                table: "Entries",
                columns: new[] { "WorkspaceId", "CardId", "DueDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Cards_WorkspaceId",
                table: "Cards",
                column: "WorkspaceId");

            migrationBuilder.AddForeignKey(
                name: "FK_Entries_Cards_CardId",
                table: "Entries",
                column: "CardId",
                principalTable: "Cards",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Recurrences_Cards_CardId",
                table: "Recurrences",
                column: "CardId",
                principalTable: "Cards",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Entries_Cards_CardId",
                table: "Entries");

            migrationBuilder.DropForeignKey(
                name: "FK_Recurrences_Cards_CardId",
                table: "Recurrences");

            migrationBuilder.DropTable(
                name: "Cards");

            migrationBuilder.DropIndex(
                name: "IX_Recurrences_CardId",
                table: "Recurrences");

            migrationBuilder.DropIndex(
                name: "IX_Entries_CardId",
                table: "Entries");

            migrationBuilder.DropIndex(
                name: "IX_Entries_TransferId",
                table: "Entries");

            migrationBuilder.DropIndex(
                name: "IX_Entries_WorkspaceId_CardId_DueDate",
                table: "Entries");

            migrationBuilder.DropColumn(
                name: "CardId",
                table: "Recurrences");

            migrationBuilder.DropColumn(
                name: "CardId",
                table: "Entries");

            migrationBuilder.DropColumn(
                name: "PurchaseDate",
                table: "Entries");

            migrationBuilder.DropColumn(
                name: "TransferId",
                table: "Entries");
        }
    }
}
