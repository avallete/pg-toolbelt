import { Effect, FileSystem } from "effect";
import type { Catalog } from "../../core/catalog.model.ts";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { ChangeFilter } from "../../core/integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../../core/integrations/serialize/serialize.types.ts";
import type { SqlFormatOptions } from "../../core/plan/sql-format.ts";
import { createPlan } from "../../effect.ts";
import { ChangesDetected, CliExitError } from "../errors.ts";
import { Output } from "../output/output.service.ts";
import { loadIntegrationDSL } from "../utils/integrations.ts";
import { isPostgresUrl, loadCatalogFromFile } from "../utils/resolve-input.ts";
import {
  deserializeCatalogSnapshotEffect,
  formatPlanForDisplay,
  parseJsonEffect,
  tryCliPromise,
} from "../utils.ts";

export interface PlanHandlerArgs {
  readonly source?: string;
  readonly target: string;
  readonly format?: "json" | "sql";
  readonly output?: string;
  readonly role?: string;
  readonly filter?: string;
  readonly serialize?: string;
  readonly integration?: string;
  readonly sqlFormat: boolean;
  readonly sqlFormatOptions?: string;
}

export const handlePlan = Effect.fnUntraced(function* (args: PlanHandlerArgs) {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* Output;

  const filterParsed: FilterDSL | undefined = args.filter
    ? yield* parseJsonEffect<FilterDSL>("filter", args.filter)
    : undefined;
  const serializeParsed: SerializeDSL | undefined = args.serialize
    ? yield* parseJsonEffect<SerializeDSL>("serialize", args.serialize)
    : undefined;
  const sqlFormatOptionsParsed: SqlFormatOptions | undefined =
    args.sqlFormatOptions
      ? yield* parseJsonEffect<SqlFormatOptions>(
          "SQL format",
          args.sqlFormatOptions,
        )
      : undefined;

  let filterOption: FilterDSL | ChangeFilter | undefined = filterParsed;
  let serializeOption: SerializeDSL | ChangeSerializer | undefined =
    serializeParsed;
  let integrationEmptyCatalog:
    | import("../../core/catalog.snapshot.ts").CatalogSnapshot
    | undefined;

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
    role: args.role,
    filter: filterOption,
    serialize: serializeOption,
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

  let effectiveFormat: "tree" | "json" | "sql";
  if (args.format) {
    effectiveFormat = args.format;
  } else if (args.output?.endsWith(".sql")) {
    effectiveFormat = "sql";
  } else if (args.output?.endsWith(".json")) {
    effectiveFormat = "json";
  } else {
    effectiveFormat = "tree";
  }

  const { content, label } = formatPlanForDisplay(planResult, effectiveFormat, {
    disableColors: !!args.output,
    showUnsafeFlagSuggestion: false,
    sqlFormatOptions:
      args.sqlFormat || sqlFormatOptionsParsed
        ? (sqlFormatOptionsParsed ?? {})
        : undefined,
  });

  if (args.output) {
    yield* fs.writeFileString(args.output, content).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error writing ${label.toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`,
          }),
      ),
    );
    yield* output.info(`${label} written to ${args.output}`);
  } else {
    yield* output.write(content.endsWith("\n") ? content.trimEnd() : content);
  }

  return yield* Effect.fail(
    new ChangesDetected({ message: "Changes detected" }),
  );
});
