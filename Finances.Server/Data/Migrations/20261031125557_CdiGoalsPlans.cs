using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Finances.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class CdiGoalsPlans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "GoalId",
                table: "Investments",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "PlanAmountCents",
                table: "Investments",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PlanDay",
                table: "Investments",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PlanStart",
                table: "Investments",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PlanDate",
                table: "InvestmentMoves",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CdiRates",
                columns: table => new
                {
                    Date = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    RatePercent = table.Column<double>(type: "REAL", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CdiRates", x => x.Date);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Investments_GoalId",
                table: "Investments",
                column: "GoalId");

            migrationBuilder.AddForeignKey(
                name: "FK_Investments_Goals_GoalId",
                table: "Investments",
                column: "GoalId",
                principalTable: "Goals",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Investments_Goals_GoalId",
                table: "Investments");

            migrationBuilder.DropTable(
                name: "CdiRates");

            migrationBuilder.DropIndex(
                name: "IX_Investments_GoalId",
                table: "Investments");

            migrationBuilder.DropColumn(
                name: "GoalId",
                table: "Investments");

            migrationBuilder.DropColumn(
                name: "PlanAmountCents",
                table: "Investments");

            migrationBuilder.DropColumn(
                name: "PlanDay",
                table: "Investments");

            migrationBuilder.DropColumn(
                name: "PlanStart",
                table: "Investments");

            migrationBuilder.DropColumn(
                name: "PlanDate",
                table: "InvestmentMoves");
        }
    }
}
