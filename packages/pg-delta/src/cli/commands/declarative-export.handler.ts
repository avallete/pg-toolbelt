import path from "node:path";
import chalk from "chalk";
import { Effect, FileSystem } from "effect";
import type { Catalog } from "../../core/catalog.model.ts";
import type { CatalogSnapshot } from "../../core/catalog.snapshot.ts";
import { exportDeclarativeSchema } from "../../core/export/index.ts";
import type { Grouping, GroupingPattern } from "../../core/export/types.ts";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { ChangeFilter } from "../../core/integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../../core/integrations/serialize/serialize.types.ts";
import type { SqlFormatOptions } from "../../core/plan/sql-format.ts";
import { createPlan } from "../../effect.ts";
import { CliExitError } from "../errors.ts";
import { Output } from "../output/output.service.ts";
import {
  assertSafePath,
  buildFileTree,
  computeFileDiff,
  formatExportSummary,
} from "../utils/export-display.ts";
import { loadIntegrationDSL } from "../utils/integrations.ts";
import { isPostgresUrl, loadCatalogFromFile } from "../utils/resolve-input.ts";
import {
  deserializeCatalogSnapshotEffect,
  parseJsonEffect,
  tryCliPromise,
} from "../utils.ts";

export interface DeclarativeExportHandlerArgs {
  readonly source?: string;
  readonly target: string;
  readonly output: string;
  readonly integration?: string;
  readonly filter?: string;
  readonly serialize?: string;
  readonly groupingMode?: "single-file" | "subdirectory";
  readonly groupPatterns?: string;
  readonly flatSchemas?: string;
  readonly formatOptions?: string;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly diffFocus: boolean;
  readonly verbose: boolean;
}

export const handleDeclarativeExport = Effect.fnUntraced(function* (
  args: DeclarativeExportHandlerArgs,
) {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* Output;
  const { compileSerializeDSL } = yield* tryCliPromise(
    "Error loading serialize DSL support",
    () => import("../../core/integrations/serialize/dsl.ts"),
  );

  const filterParsed: FilterDSL | undefined = args.filter
    ? yield* parseJsonEffect<FilterDSL>("filter", args.filter)
    : undefined;
  const serializeParsed: SerializeDSL | undefined = args.serialize
    ? yield* parseJsonEffect<SerializeDSL>("serialize", args.serialize)
    : undefined;
  const groupPatternsParsed: GroupingPattern[] | undefined = args.groupPatterns
    ? yield* parseJsonEffect<GroupingPattern[]>(
        "group-patterns",
        args.groupPatterns,
      ).pipe(
        Effect.flatMap((parsed) =>
          Array.isArray(parsed)
            ? Effect.succeed(parsed)
            : Effect.fail(
                new CliExitError({
                  exitCode: 1,
                  message: "group-patterns must be a JSON array",
                }),
              ),
        ),
      )
    : undefined;
  const formatOptionsParsed: SqlFormatOptions | undefined = args.formatOptions
    ? yield* parseJsonEffect<SqlFormatOptions>(
        "format-options",
        args.formatOptions,
      )
    : undefined;

  let filterOption: FilterDSL | ChangeFilter | undefined = filterParsed;
  let serializeOption: SerializeDSL | ChangeSerializer | undefined =
    serializeParsed;
  let integrationEmptyCatalog: CatalogSnapshot | undefined;
  if (args.integration) {
    const integrationName = args.integration;
    const integrationDSL = yield* tryCliPromise(
      "Error loading integration",
      () => loadIntegrationDSL(integrationName),
    );
    filterOption = filterOption ?? integrationDSL.filter;
    serializeOption = serializeOption ?? integrationDSL.serialize;
    integrationEmptyCatalog = integrationDSL.emptyCatalog;
  }

  let resolvedSource: string | Catalog | null;
  if (args.source) {
    const sourceInput = args.source;
    resolvedSource = isPostgresUrl(args.source)
      ? args.source
      : yield* tryCliPromise("Error loading source catalog", () =>
          loadCatalogFromFile(sourceInput),
        );
  } else if (integrationEmptyCatalog) {
    resolvedSource = yield* deserializeCatalogSnapshotEffect(
      integrationEmptyCatalog,
    );
  } else {
    resolvedSource = null;
  }

  const resolvedTarget = isPostgresUrl(args.target)
    ? args.target
    : yield* tryCliPromise("Error loading target catalog", () =>
        loadCatalogFromFile(args.target),
      );

  const planResult = yield* createPlan(resolvedSource, resolvedTarget, {
    filter: filterOption,
    serialize: serializeOption,
    skipDefaultPrivilegeSubtraction: true,
  }).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Error creating plan: ${error.message}`,
        }),
    ),
  );

  if (!planResult) {
    yield* output.info("No changes detected.");
    return;
  }

  const hasGrouping =
    args.groupingMode !== undefined ||
    (groupPatternsParsed !== undefined && groupPatternsParsed.length > 0) ||
    (args.flatSchemas !== undefined && args.flatSchemas.length > 0);

  let grouping: Grouping | undefined;
  if (hasGrouping) {
    grouping = {
      mode: args.groupingMode ?? "single-file",
      groupPatterns: groupPatternsParsed,
      autoGroupPartitions: true,
      flatSchemas:
        args.flatSchemas !== undefined
          ? args.flatSchemas
              .split(",")
              .map((schemaName) => schemaName.trim())
              .filter(Boolean)
          : undefined,
    };
  }

  const serializeFn =
    serializeOption !== undefined
      ? compileSerializeDSL(serializeOption)
      : undefined;

  const exportWarnings: string[] = [];
  const exportOutput = exportDeclarativeSchema(planResult, {
    integration:
      serializeFn !== undefined ? { serialize: serializeFn } : undefined,
    formatOptions: formatOptionsParsed ?? undefined,
    grouping,
    onWarning: (message) => {
      exportWarnings.push(message);
    },
  });

  for (const warning of exportWarnings) {
    yield* output.warn(`Warning: ${warning}`);
  }

  const outputDir = path.resolve(args.output);
  const applyTip = (dir: string) =>
    `\nTip: To apply this schema to an empty database, run:\n  pgdelta declarative apply --path ${dir} --target <database_url>`;
  const diff = yield* tryCliPromise("Error comparing output directory", () =>
    computeFileDiff(outputDir, exportOutput.files),
  );

  const treeOutput = buildFileTree(
    exportOutput.files.map((file) => file.path),
    path.basename(outputDir) || outputDir,
    { diff, diffFocus: args.diffFocus },
  );
  yield* output.write(treeOutput);
  yield* output.write(
    `${chalk.green("+")} created   ${chalk.yellow("~")} updated   ${chalk.red("-")} deleted`,
  );

  const summary = formatExportSummary(diff, args.dryRun);
  if (summary) {
    yield* output.info(summary);
  }

  const totalChanges = planResult.sortedChanges.length;
  const totalStatements = exportOutput.files.reduce(
    (sum, file) => sum + file.statements,
    0,
  );
  yield* output.info(
    `Changes: ${totalChanges} | Files: ${exportOutput.files.length} | Statements: ${totalStatements}`,
  );

  if (args.dryRun) {
    yield* output.info(chalk.dim("\n(dry-run: no files written)"));
    yield* output.info(chalk.cyan(applyTip(outputDir)));
    return;
  }

  if (args.force) {
    yield* fs
      .remove(outputDir, { recursive: true })
      .pipe(Effect.orElseSucceed(() => undefined));
    yield* fs.makeDirectory(outputDir, { recursive: true });
  } else if (diff.deleted.length > 0) {
    yield* output.warn(
      `Warning: ${diff.deleted.length} existing file(s) will no longer be present. Use --force to replace the output directory.`,
    );
  }

  for (const file of exportOutput.files) {
    assertSafePath(file.path, outputDir);
    const filePath = path.join(outputDir, file.path);
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error creating export subdirectory: ${error instanceof Error ? error.message : String(error)}`,
          }),
      ),
    );
    yield* fs.writeFileString(filePath, file.sql).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error writing ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
          }),
      ),
    );
  }

  yield* output.success(
    `Wrote ${exportOutput.files.length} file(s) to ${outputDir}`,
  );
  yield* output.info(applyTip(outputDir).trim());
});
