import chalk from "chalk";
import { Effect, FileSystem } from "effect";
import { loadDeclarativeSchema } from "../../core/declarative-apply/discover-sql.ts";
import type { RoundResult } from "../../core/declarative-apply/index.ts";
import { applyDeclarativeSchema } from "../../effect.ts";
import { CliExitError } from "../errors.ts";
import { Output } from "../output/output.service.ts";
import {
  buildDiagnosticDisplayItems,
  type DiagnosticDisplayEntry,
  formatStatementError,
  positionToLineColumn,
  requiredObjectKeyFromDiagnostic,
  resolveSqlFilePath,
} from "../utils/apply-display.ts";

export interface DeclarativeApplyHandlerArgs {
  readonly path: string;
  readonly target: string;
  readonly maxRounds?: number;
  readonly skipFunctionValidation: boolean;
  readonly verbose: boolean;
  readonly ungroupDiagnostics: boolean;
}

export const handleDeclarativeApply = Effect.fnUntraced(function* (
  args: DeclarativeApplyHandlerArgs,
) {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* Output;

  const roundResults: RoundResult[] = [];
  const onRoundComplete = args.verbose
    ? (round: RoundResult) => {
        roundResults.push(round);
      }
    : undefined;

  yield* output.info(`Analyzing SQL files in ${args.path}...`);

  const content = yield* Effect.tryPromise({
    try: () => loadDeclarativeSchema(args.path),
    catch: (error) =>
      new CliExitError({
        exitCode: 1,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

  if (content.length === 0) {
    return yield* Effect.fail(
      new CliExitError({
        exitCode: 1,
        message: `No .sql files found in '${args.path}'. Pass a directory containing .sql files or a single .sql file.`,
      }),
    );
  }

  const result = yield* applyDeclarativeSchema({
    content,
    targetUrl: args.target,
    maxRounds: args.maxRounds,
    validateFunctionBodies: !args.skipFunctionValidation,
    onRoundComplete,
  }).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Error: ${error.message}`,
        }),
    ),
  );

  for (const round of roundResults) {
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
    yield* output.info(parts.join("  "));
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
      (diagnostic) =>
        diagnostic.code !== "UNKNOWN_STATEMENT_CLASS" &&
        (args.verbose || !verboseOnlyCodes.has(diagnostic.code)),
    )
    .sort(
      (left, right) =>
        (diagnosticDisplayOrder[left.code] ?? 99) -
        (diagnosticDisplayOrder[right.code] ?? 99),
    );

  if (warnings.length > 0 && args.verbose) {
    const fileContentCache = new Map<string, string>();
    for (const diagnostic of warnings) {
      const statementId = diagnostic.statementId;
      if (
        statementId &&
        statementId.sourceOffset != null &&
        statementId.filePath &&
        !fileContentCache.has(statementId.filePath)
      ) {
        yield* Effect.tryPromise(() =>
          resolveSqlFilePath(args.path, statementId.filePath),
        ).pipe(
          Effect.flatMap((fullPath) =>
            fs
              .readFileString(fullPath)
              .pipe(
                Effect.tap((fileContent) =>
                  Effect.sync(() =>
                    fileContentCache.set(statementId.filePath, fileContent),
                  ),
                ),
              ),
          ),
          Effect.ignore,
        );
      }
    }

    const entries: DiagnosticDisplayEntry[] = warnings.map((diagnostic) => {
      let location: string | undefined;
      if (diagnostic.statementId) {
        const statementId = diagnostic.statementId;
        const offset = statementId.sourceOffset;
        const fileContent =
          offset != null
            ? fileContentCache.get(statementId.filePath)
            : undefined;
        if (fileContent != null && offset != null) {
          const { line, column } = positionToLineColumn(
            fileContent,
            offset + 1,
          );
          location = `${statementId.filePath}:${line}:${column}`;
        } else {
          location = `${statementId.filePath}:${statementId.statementIndex}`;
        }
      }
      return {
        diagnostic,
        location,
        requiredObjectKey: requiredObjectKeyFromDiagnostic(diagnostic),
      };
    });
    const displayItems = buildDiagnosticDisplayItems(
      entries,
      !args.ungroupDiagnostics,
    );

    const diagnosticLines: string[] = [
      `\n${warnings.length} diagnostic(s) from static analysis:\n`,
    ];

    let lastCode = "";
    const previewLimit = 5;
    for (const item of displayItems) {
      if (item.code !== lastCode) {
        if (lastCode !== "") {
          diagnosticLines.push("\n");
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
      diagnosticLines.push(
        colorFn(`  [${item.code}]${location}${occurrences} ${item.message}\n`),
      );

      if (!args.ungroupDiagnostics && item.requiredObjectKey) {
        diagnosticLines.push(
          colorFn(`    -> Object: ${item.requiredObjectKey}\n`),
        );
      }
      if (!args.ungroupDiagnostics && item.locations.length > 1) {
        for (const locationEntry of item.locations.slice(0, previewLimit)) {
          diagnosticLines.push(colorFn(`    at ${locationEntry}\n`));
        }
        const remaining = item.locations.length - previewLimit;
        if (remaining > 0) {
          diagnosticLines.push(
            colorFn(`    ... and ${remaining} more location(s)\n`),
          );
        }
      }
      if (item.suggestedFix) {
        diagnosticLines.push(colorFn(`    -> Fix: ${item.suggestedFix}\n`));
      }
    }

    yield* output.warn(diagnosticLines.join(""));
  }

  const { apply } = result;
  const summaryParts: string[] = [
    `Statements: ${result.totalStatements} total, ${apply.totalApplied} applied`,
  ];
  if (apply.totalSkipped > 0) {
    summaryParts.push(`, ${apply.totalSkipped} skipped`);
  }
  yield* output.info(summaryParts.join(""));
  yield* output.info(`Rounds: ${apply.totalRounds}`);

  switch (apply.status) {
    case "success": {
      yield* output.success("All statements applied successfully.");
      if (apply.validationErrors && apply.validationErrors.length > 0) {
        const errorLines: string[] = [
          `${apply.validationErrors.length} function body validation error(s):`,
        ];
        for (const error of apply.validationErrors) {
          const formatted = yield* Effect.tryPromise({
            try: () => formatStatementError(error, args.path),
            catch: () =>
              new CliExitError({
                exitCode: 1,
                message: `Error formatting statement: ${error.message}`,
              }),
          });
          errorLines.push(chalk.yellow(formatted));
          errorLines.push("");
        }
        yield* output.warn(errorLines.join("\n"));
        return yield* Effect.fail(
          new CliExitError({
            exitCode: 1,
            message: `${apply.validationErrors.length} function body validation error(s)`,
          }),
        );
      }
      return;
    }
    case "stuck": {
      const errorLines: string[] = [
        `\nStuck after ${apply.totalRounds} round(s). ${apply.stuckStatements?.length ?? 0} statement(s) could not be applied:`,
      ];
      if (apply.stuckStatements) {
        for (const stuck of apply.stuckStatements) {
          const formatted = yield* Effect.tryPromise({
            try: () => formatStatementError(stuck, args.path),
            catch: () =>
              new CliExitError({
                exitCode: 1,
                message: `Error formatting statement: ${stuck.message}`,
              }),
          });
          errorLines.push(chalk.red(formatted));
          errorLines.push("");
        }
      }
      if (apply.errors && apply.errors.length > 0) {
        errorLines.push(
          `\nAdditionally, ${apply.errors.length} statement(s) had non-dependency errors:`,
        );
        for (const error of apply.errors) {
          const formatted = yield* Effect.tryPromise({
            try: () => formatStatementError(error, args.path),
            catch: () =>
              new CliExitError({
                exitCode: 1,
                message: `Error formatting statement: ${error.message}`,
              }),
          });
          errorLines.push(chalk.red(formatted));
          errorLines.push("");
        }
      }
      yield* output.error(errorLines.join("\n"));
      return yield* Effect.fail(
        new CliExitError({
          exitCode: 2,
          message: `Stuck after ${apply.totalRounds} round(s) with ${apply.stuckStatements?.length ?? 0} unresolvable statement(s)`,
        }),
      );
    }
    case "error": {
      const errorLines: string[] = [
        `\nCompleted with errors. ${apply.errors?.length ?? 0} statement(s) failed:`,
      ];
      if (apply.errors) {
        for (const error of apply.errors) {
          const formatted = yield* Effect.tryPromise({
            try: () => formatStatementError(error, args.path),
            catch: () =>
              new CliExitError({
                exitCode: 1,
                message: `Error formatting statement: ${error.message}`,
              }),
          });
          errorLines.push(chalk.red(formatted));
          errorLines.push("");
        }
      }
      if (apply.validationErrors && apply.validationErrors.length > 0) {
        errorLines.push(
          `\n${apply.validationErrors.length} function body validation error(s):`,
        );
        for (const error of apply.validationErrors) {
          const formatted = yield* Effect.tryPromise({
            try: () => formatStatementError(error, args.path),
            catch: () =>
              new CliExitError({
                exitCode: 1,
                message: `Error formatting statement: ${error.message}`,
              }),
          });
          errorLines.push(chalk.yellow(formatted));
          errorLines.push("");
        }
      }
      yield* output.error(errorLines.join("\n"));
      return yield* Effect.fail(
        new CliExitError({
          exitCode: 1,
          message: `Declarative apply completed with ${apply.errors?.length ?? 0} error(s)`,
        }),
      );
    }
  }
});
