using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Finances.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class PushAndImport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "LastNotifiedOn",
                table: "Users",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NotifyDaysAhead",
                table: "Users",
                type: "INTEGER",
                nullable: false,
                defaultValue: 1); // usuários existentes: 1 dia de antecedência

            migrationBuilder.AddColumn<bool>(
                name: "NotifyEnabled",
                table: "Users",
                type: "INTEGER",
                nullable: false,
                defaultValue: true); // avisos ligados por padrão

            migrationBuilder.AddColumn<int>(
                name: "NotifyHour",
                table: "Users",
                type: "INTEGER",
                nullable: false,
                defaultValue: 8); // 08:00

            migrationBuilder.AddColumn<string>(
                name: "ExternalId",
                table: "Entries",
                type: "TEXT",
                maxLength: 120,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PushSubscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Endpoint = table.Column<string>(type: "TEXT", maxLength: 800, nullable: false),
                    P256dh = table.Column<string>(type: "TEXT", nullable: false),
                    Auth = table.Column<string>(type: "TEXT", nullable: false),
                    Device = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PushSubscriptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PushSubscriptions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Entries_WorkspaceId_ExternalId",
                table: "Entries",
                columns: new[] { "WorkspaceId", "ExternalId" });

            migrationBuilder.CreateIndex(
                name: "IX_PushSubscriptions_Endpoint",
                table: "PushSubscriptions",
                column: "Endpoint",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PushSubscriptions_UserId",
                table: "PushSubscriptions",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PushSubscriptions");

            migrationBuilder.DropIndex(
                name: "IX_Entries_WorkspaceId_ExternalId",
                table: "Entries");

            migrationBuilder.DropColumn(
                name: "LastNotifiedOn",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "NotifyDaysAhead",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "NotifyEnabled",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "NotifyHour",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "ExternalId",
                table: "Entries");
        }
    }
}
