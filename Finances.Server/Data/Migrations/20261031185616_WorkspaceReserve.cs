using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Finances.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkspaceReserve : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ReserveMonths",
                table: "Workspaces",
                type: "INTEGER",
                nullable: false,
                defaultValue: 6); // espaços existentes ganham a meta padrão (0 = desligado)
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReserveMonths",
                table: "Workspaces");
        }
    }
}
