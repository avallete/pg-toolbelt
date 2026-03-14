/**
 * Declarative schema apply – orchestrator.
 *
 * Accepts pre-read SQL content (file path + sql string per file), uses pg-topo
 * for static dependency analysis and topological ordering, then applies
 * statements to a target database using iterative rounds to handle any
 * remaining dependency gaps. File discovery and reading are done by the caller
 * (e.g. CLI) so I/O errors can be handled there.
 */

import type { Diagnostic, StatementNode } from "@supabase/pg-topo";
import { analyzeAndSort } from "@supabase/pg-topo";
import { Effect } from "effect";
import type { Pool } from "pg";
import { DeclarativeApplyError } from "../errors.ts";
import type { DatabaseApi } from "../services/database.ts";
import { makeScopedPool, wrapPool } from "../services/database-live.ts";
import { extractCatalogProviders } from "./extract-catalog-providers.ts";
import {
  type ApplyResult,
  type RoundResult,
  roundApplyEffect,
  type StatementEntry,
} from "./round-apply.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

import type { SqlFileEntry } from "./discover-sql.ts";

interface DeclarativeApplyOptions {
  /** Pre-read SQL files: filePath (relative) and sql content. Caller does discovery and read. */
  content: SqlFileEntry[];
  /** Target database connection URL (required if pool is not provided) */
  targetUrl?: string;
  /** Existing pool to use (caller owns it; not closed). If provided, targetUrl is ignored. */
  pool?: Pool | DatabaseApi;
  /** Max rounds before giving up (default: 100) */
  maxRounds?: number;
  /** Run final function body validation (default: true) */
  validateFunctionBodies?: boolean;
  /** Disable function body checks during rounds (default: true) */
  disableCheckFunctionBodies?: boolean;
  /** Progress callback fired after each round */
  onRoundComplete?: (round: RoundResult) => void;
}

export interface DeclarativeApplyResult {
  /** Result from the round-based apply engine */
  apply: ApplyResult;
  /** Diagnostics from pg-topo's static analysis (warnings, not fatal) */
  diagnostics: Diagnostic[];
  /** Total number of statements discovered */
  totalStatements: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert pg-topo StatementNodes into StatementEntries for the apply engine.
 */
function toStatementEntries(nodes: StatementNode[]): StatementEntry[] {
  return nodes.map((node) => ({
    id: `${node.id.filePath}:${node.id.statementIndex}`,
    sql: node.sql,
    statementClass: node.statementClass,
  }));
}

function remapStatementId(
  statementId: { filePath: string; statementIndex: number } | undefined,
  filePathMap: Map<string, string>,
): typeof statementId {
  if (!statementId) return undefined;
  return {
    ...statementId,
    filePath: filePathMap.get(statementId.filePath) ?? statementId.filePath,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Apply a declarative SQL schema to a target database.
 *
 * 1. Call pg-topo analyzeAndSort on the provided SQL strings
 * 2. Remap synthetic statement IDs to caller-provided file paths
 * 3. Apply statements round-by-round to the target database
 * 4. Optionally validate function bodies in a final pass
 */
export async function applyDeclarativeSchemaPromise(
  options: DeclarativeApplyOptions,
): Promise<DeclarativeApplyResult> {
  return applyDeclarativeSchema(options).pipe(Effect.runPromise);
}

export type { SqlFileEntry } from "./discover-sql.ts";

// Re-export file discovery for programmatic callers (e.g. Supabase CLI edge-runtime templates)
export { loadDeclarativeSchema } from "./discover-sql.ts";
// Re-export result types for callers that need them (StatementError is imported from round-apply directly where needed)
export type { ApplyResult, RoundResult } from "./round-apply.ts";

export const applyDeclarativeSchema = (
  options: DeclarativeApplyOptions,
): Effect.Effect<DeclarativeApplyResult, DeclarativeApplyError> =>
  Effect.gen(function* () {
    const {
      content,
      targetUrl,
      pool: providedPool,
      maxRounds = 100,
      validateFunctionBodies = true,
      disableCheckFunctionBodies = true,
      onRoundComplete,
    } = options;

    if (content.length === 0) {
      return emptyApplyResult([]);
    }

    const db = yield* resolveDatabase(targetUrl, providedPool);
    const externalProviders = yield* extractCatalogProviders(db).pipe(
      Effect.mapError(
        (error) =>
          new DeclarativeApplyError({
            message: error.message,
            cause: error,
          }),
      ),
    );

    const analyzeResult = yield* Effect.tryPromise({
      try: () =>
        analyzeAndSort(
          content.map((entry) => entry.sql),
          { externalProviders },
        ),
      catch: (error) =>
        new DeclarativeApplyError({
          message: `Failed to analyze declarative SQL: ${error instanceof Error ? error.message : String(error)}`,
          cause: error,
        }),
    });

    const { ordered, diagnostics } = analyzeResult;
    const filePathMap = new Map<string, string>();
    for (let i = 0; i < content.length; i += 1) {
      filePathMap.set(`<input:${i}>`, content[i].filePath);
    }

    const remappedOrdered = ordered.map((node) => ({
      ...node,
      id: {
        ...node.id,
        filePath: filePathMap.get(node.id.filePath) ?? node.id.filePath,
      },
    }));

    const remappedDiagnostics = diagnostics.map((diagnostic) => ({
      ...diagnostic,
      statementId: remapStatementId(diagnostic.statementId, filePathMap),
    }));

    if (ordered.length === 0) {
      return emptyApplyResult(remappedDiagnostics);
    }

    const applyResult = yield* roundApplyEffect(db, {
      statements: toStatementEntries(remappedOrdered),
      maxRounds,
      disableCheckFunctionBodies,
      finalValidation: validateFunctionBodies,
      onRoundComplete,
    });

    return {
      apply: applyResult,
      diagnostics: remappedDiagnostics,
      totalStatements: remappedOrdered.length,
    };
  });

const emptyApplyResult = (
  diagnostics: Diagnostic[],
): DeclarativeApplyResult => ({
  apply: {
    status: "success",
    totalRounds: 0,
    totalApplied: 0,
    totalSkipped: 0,
    rounds: [],
  },
  diagnostics,
  totalStatements: 0,
});

const resolveDatabase = (
  targetUrl: string | undefined,
  providedPool: Pool | DatabaseApi | undefined,
): Effect.Effect<DatabaseApi, DeclarativeApplyError> => {
  if (providedPool) {
    return Effect.succeed(
      "withConnection" in providedPool ? providedPool : wrapPool(providedPool),
    );
  }

  if (!targetUrl) {
    return Effect.fail(
      new DeclarativeApplyError({
        message: "Either targetUrl or pool must be provided",
      }),
    );
  }

  return Effect.scoped(makeScopedPool(targetUrl, { label: "target" })).pipe(
    Effect.mapError(
      (error) =>
        new DeclarativeApplyError({
          message: error.message,
          cause: error,
        }),
    ),
  );
};
