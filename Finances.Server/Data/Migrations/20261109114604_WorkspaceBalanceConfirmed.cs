using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Finances.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkspaceBalanceConfirmed : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "BalanceConfirmed",
                table: "Workspaces",
                type: "INTEGER",
                nullable: false,
                defaultValue: true); // espaços que já existem não recebem a pergunta; os novos nascem com false (C#)
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BalanceConfirmed",
                table: "Workspaces");
        }
    }
}
