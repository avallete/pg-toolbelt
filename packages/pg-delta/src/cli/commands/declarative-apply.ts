/**
 * Declarative-apply command - apply a declarative SQL schema to a database
 * using pg-topo static analysis + round-based execution.
 */

import { readFile } from "node:fs/promises";
import { Command, Options } from "@effect/cli";
import chalk from "chalk";
import { Effect, Option } from "effect";
import { loadDeclarativeSchema } from "../../core/declarative-apply/discover-sql.ts";
import {
  applyDeclarativeSchema,
  type DeclarativeApplyResult,
  type RoundResult,
} from "../../core/declarative-apply/index.ts";
import { logError, logInfo, logSuccess, logWarning } from "../ui.ts";
import {
  buildDiagnosticDisplayItems,
  type DiagnosticDisplayEntry,
  formatStatementError,
  positionToLineColumn,
  requiredObjectKeyFromDiagnostic,
  resolveSqlFilePath,
} from "../utils/apply-display.ts";

const pathOpt = Options.text("path").pipe(
  Options.withAlias("p"),
  Options.withDescription(
    "Path to the declarative schema directory (containing .sql files) or a single .sql file",
  ),
);

const target = Options.text("target").pipe(
  Options.withAlias("t"),
  Options.withDescription(
    "Target database connection URL to apply the schema to",
  ),
);

const maxRounds = Options.integer("max-rounds").pipe(
  Options.withDescription(
    "Maximum number of application rounds before giving up (default: 100)",
  ),
  Options.optional,
);

const noValidateFunctions = Options.boolean("no-validate-functions").pipe(
  Options.withDescription("Skip final function body validation pass"),
  Options.withDefault(false),
);

const verbose = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withDescription("Show detailed per-round progress"),
  Options.withDefault(false),
);

const ungroupDiagnostics = Options.boolean("ungroup-diagnostics").pipe(
  Options.withDescription(
    "Show full per-diagnostic detail instead of grouped summary output",
  ),
  Options.withDefault(false),
);

export const declarativeApplyCommand = Command.make(
  "apply",
  {
    path: pathOpt,
    target,
    maxRounds,
    noValidateFunctions,
    verbose,
    ungroupDiagnostics,
  },
  (args) =>
    Effect.gen(function* () {
      const maxRoundsValue = Option.getOrUndefined(args.maxRounds);

      const onRoundComplete = args.verbose
        ? (round: RoundResult) => {
            const parts = [
              `Round ${round.round}:`,
              chalk.green(`${round.applied} applied`),
            ];
            if (round.deferred > 0) {
              parts.push(chalk.yellow(`${round.deferred} deferred`));
            }
            if (round.failed > 0) {
              parts.push(chalk.red(`${round.failed} failed`));
            }
            process.stdout.write(`${parts.join("  ")}\n`);
          }
        : undefined;

      logInfo(`Analyzing SQL files in ${args.path}...`);

      let content: Array<{ filePath: string; sql: string }>;
      try {
        content = yield* Effect.promise(() => loadDeclarativeSchema(args.path));
      } catch (error) {
        logError(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
        return;
      }

      if (content.length === 0) {
        logError(
          `No .sql files found in '${args.path}'. Pass a directory containing .sql files or a single .sql file.`,
        );
        process.exitCode = 1;
        return;
      }

      let result: DeclarativeApplyResult;
      try {
        result = yield* Effect.promise(() =>
          applyDeclarativeSchema({
            content,
            targetUrl: args.target,
            maxRounds: maxRoundsValue,
            validateFunctionBodies: !args.noValidateFunctions,
            onRoundComplete,
          }),
        );
      } catch (error) {
        logError(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
        return;
      }

      const diagnosticDisplayOrder: Record<string, number> = {
        UNKNOWN_STATEMENT_CLASS: 0,
        DUPLICATE_PRODUCER: 1,
        CYCLE_EDGE_SKIPPED: 2,
        UNRESOLVED_DEPENDENCY: 3,
      };
      const diagnosticColor: Record<string, (s: string) => string> = {
        DUPLICATE_PRODUCER: chalk.yellow,
        CYCLE_EDGE_SKIPPED: chalk.red,
        UNRESOLVED_DEPENDENCY: chalk.dim,
      };
      const verboseOnlyCodes = new Set([
        "UNRESOLVED_DEPENDENCY",
        "DUPLICATE_PRODUCER",
        "CYCLE_EDGE_SKIPPED",
      ]);
      const warnings = result.diagnostics
        .filter(
          (d) =>
            d.code !== "UNKNOWN_STATEMENT_CLASS" &&
            (args.verbose || !verboseOnlyCodes.has(d.code)),
        )
        .sort(
          (a, b) =>
            (diagnosticDisplayOrder[a.code] ?? 99) -
            (diagnosticDisplayOrder[b.code] ?? 99),
        );
      if (warnings.length > 0 && args.verbose) {
        const fileContentCache = new Map<string, string>();
        for (const diag of warnings) {
          const id = diag.statementId;
          if (
            id &&
            id.sourceOffset != null &&
            id.filePath &&
            !fileContentCache.has(id.filePath)
          ) {
            try {
              const fullPath = yield* Effect.promise(() =>
                resolveSqlFilePath(args.path, id.filePath),
              );
              const fileContent = yield* Effect.promise(() =>
                readFile(fullPath, "utf-8"),
              );
              fileContentCache.set(id.filePath, fileContent);
            } catch {
              // Fall back to statementIndex display
            }
          }
        }

        process.stderr.write(
          chalk.yellow(
            `\n${warnings.length} diagnostic(s) from static analysis:\n`,
          ),
        );
        const entries: DiagnosticDisplayEntry[] = warnings.map((diag) => {
          let location: string | undefined;
          if (diag.statementId) {
            const id = diag.statementId;
            const offset = id.sourceOffset;
            const fileContent =
              offset != null ? fileContentCache.get(id.filePath) : undefined;
            if (fileContent != null && offset != null) {
              const { line, column } = positionToLineColumn(
                fileContent,
                offset + 1,
              );
              location = `${id.filePath}:${line}:${column}`;
            } else {
              location = `${id.filePath}:${id.statementIndex}`;
            }
          }
          return {
            diagnostic: diag,
            location,
            requiredObjectKey: requiredObjectKeyFromDiagnostic(diag),
          };
        });
        const displayItems = buildDiagnosticDisplayItems(
          entries,
          !args.ungroupDiagnostics,
        );

        let lastCode = "";
        const previewLimit = 5;
        for (const item of displayItems) {
          if (item.code !== lastCode) {
            if (lastCode !== "") {
              process.stderr.write("\n");
            }
            lastCode = item.code;
          }
          const colorFn = diagnosticColor[item.code] ?? chalk.yellow;
          const location =
            item.locations.length > 0 ? ` (${item.locations[0]})` : "";
          const occurrences =
            !args.ungroupDiagnostics && item.locations.length > 1
              ? ` x${item.locations.length}`
              : "";
          process.stderr.write(
            colorFn(
              `  [${item.code}]${location}${occurrences} ${item.message}\n`,
            ),
          );
          if (!args.ungroupDiagnostics && item.requiredObjectKey) {
            process.stderr.write(
              colorFn(`    -> Object: ${item.requiredObjectKey}\n`),
            );
          }
          if (!args.ungroupDiagnostics && item.locations.length > 1) {
            for (const locationEntry of item.locations.slice(0, previewLimit)) {
              process.stderr.write(colorFn(`    at ${locationEntry}\n`));
            }
            const remaining = item.locations.length - previewLimit;
            if (remaining > 0) {
              process.stderr.write(
                colorFn(`    ... and ${remaining} more location(s)\n`),
              );
            }
          }
          if (item.suggestedFix) {
            process.stderr.write(colorFn(`    -> Fix: ${item.suggestedFix}\n`));
          }
        }
        process.stderr.write("\n");
      }

      const { apply } = result;

      // Summary
      process.stdout.write("\n");
      process.stdout.write(
        `Statements: ${result.totalStatements} total, ${apply.totalApplied} applied`,
      );
      if (apply.totalSkipped > 0) {
        process.stdout.write(`, ${apply.totalSkipped} skipped`);
      }
      process.stdout.write("\n");
      process.stdout.write(`Rounds: ${apply.totalRounds}\n`);

      switch (apply.status) {
        case "success": {
          logSuccess("All statements applied successfully.");
          if (apply.validationErrors && apply.validationErrors.length > 0) {
            logWarning(
              `${apply.validationErrors.length} function body validation error(s):`,
            );
            for (const err of apply.validationErrors) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(err, args.path),
              );
              process.stderr.write(chalk.yellow(formatted));
              process.stderr.write("\n\n");
            }
            process.exitCode = 1;
          } else {
            process.exitCode = 0;
          }
          break;
        }

        case "stuck": {
          process.stderr.write(
            chalk.red(
              `\nStuck after ${apply.totalRounds} round(s). ${apply.stuckStatements?.length ?? 0} statement(s) could not be applied:\n`,
            ),
          );
          if (apply.stuckStatements) {
            for (const stuck of apply.stuckStatements) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(stuck, args.path),
              );
              process.stderr.write(chalk.red(formatted));
              process.stderr.write("\n\n");
            }
          }
          if (apply.errors && apply.errors.length > 0) {
            process.stderr.write(
              chalk.red(
                `\nAdditionally, ${apply.errors.length} statement(s) had non-dependency errors:\n`,
              ),
            );
            for (const err of apply.errors) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(err, args.path),
              );
              process.stderr.write(chalk.red(formatted));
              process.stderr.write("\n\n");
            }
          }
          process.exitCode = 2;
          break;
        }

        case "error": {
          process.stderr.write(
            chalk.red(
              `\nCompleted with errors. ${apply.errors?.length ?? 0} statement(s) failed:\n`,
            ),
          );
          if (apply.errors) {
            for (const err of apply.errors) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(err, args.path),
              );
              process.stderr.write(chalk.red(formatted));
              process.stderr.write("\n\n");
            }
          }
          if (apply.validationErrors && apply.validationErrors.length > 0) {
            process.stderr.write(
              chalk.yellow(
                `\n${apply.validationErrors.length} function body validation error(s):\n`,
              ),
            );
            for (const err of apply.validationErrors) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(err, args.path),
              );
              process.stderr.write(chalk.yellow(formatted));
              process.stderr.write("\n\n");
            }
          }
          process.exitCode = 1;
          break;
        }
      }
    }),
);
