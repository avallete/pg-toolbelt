/**
 * Plan application - execute migration plans against target databases.
 */

import { Effect } from "effect";
import type { Pool } from "pg";
import { diffCatalogs } from "../catalog.diff.ts";
import { extractCatalog } from "../catalog.model.ts";
import type { DiffContext } from "../context.ts";
import {
  AlreadyAppliedError,
  type CatalogExtractionError,
  type ConnectionError,
  type ConnectionTimeoutError,
  FingerprintMismatchError,
  InvalidPlanError,
  PlanApplyError,
  type SslConfigError,
} from "../errors.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import { compileFilterDSL } from "../integrations/filter/dsl.ts";
import type { DatabaseApi } from "../services/database.ts";
import { makeScopedPool, wrapPool } from "../services/database-live.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import type { Plan } from "./types.ts";

type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string };

interface ApplyPlanOptions {
  verifyPostApply?: boolean;
}

type ConnectionInput = string | Pool | DatabaseApi;

/**
 * Check if a statement is a session configuration statement (standalone SET statements).
 * These statements should not be counted as changes.
 */
function isSessionStatement(statement: string): boolean {
  return statement.trim().startsWith("SET ");
}

/**
 * Apply a plan's SQL statements to a target database with integrity checks.
 * Validates fingerprints before and after application to ensure plan integrity.
 */

export async function applyPlanPromise(
  plan: Plan,
  source: ConnectionInput,
  target: ConnectionInput,
  options: ApplyPlanOptions = {},
): Promise<ApplyPlanResult> {
  const result = await applyPlan(plan, source, target, options).pipe(
    Effect.result,
    Effect.runPromise,
  );

  if (result._tag === "Success") {
    return {
      status: "applied",
      statements: result.success.statements,
      warnings: result.success.warnings,
    };
  }

  const error = result.failure;
  switch (error._tag) {
    case "InvalidPlanError":
      return {
        status: "invalid_plan",
        message: error.message,
      };
    case "FingerprintMismatchError":
      return {
        status: "fingerprint_mismatch",
        current: error.current,
        expected: error.expected,
      };
    case "AlreadyAppliedError":
      return { status: "already_applied" };
    case "PlanApplyError":
      return {
        status: "failed",
        error: error.cause,
        script: error.script,
      };
    default:
      return {
        status: "failed",
        error,
        script: plan.statements.join(";\n"),
      };
  }
}

type ApplyPlanSuccess = {
  statements: number;
  warnings?: string[];
};

export const applyPlan = (
  plan: Plan,
  source: ConnectionInput,
  target: ConnectionInput,
  options: ApplyPlanOptions = {},
): Effect.Effect<
  ApplyPlanSuccess,
  | InvalidPlanError
  | FingerprintMismatchError
  | AlreadyAppliedError
  | PlanApplyError
  | CatalogExtractionError
  | ConnectionError
  | ConnectionTimeoutError
  | SslConfigError
> =>
  Effect.gen(function* () {
    if (!plan.statements || plan.statements.length === 0) {
      return yield* new InvalidPlanError({
        message: "Plan contains no SQL statements to execute.",
      });
    }

    const currentDb = yield* resolveDatabase(source, "source", plan.role);
    const desiredDb = yield* resolveDatabase(target, "target", plan.role);

    const [currentCatalog, desiredCatalog] = yield* Effect.all([
      extractCatalog(currentDb),
      extractCatalog(desiredDb),
    ]);

    const changes = diffCatalogs(currentCatalog, desiredCatalog);
    const ctx: DiffContext = {
      mainCatalog: currentCatalog,
      branchCatalog: desiredCatalog,
    };

    let filteredChanges = changes;
    if (plan.filter) {
      const filterFn = compileFilterDSL(plan.filter);
      filteredChanges = filteredChanges.filter((change) => filterFn(change));
    }

    const sortedChanges = sortChanges(ctx, filteredChanges);
    if (sortedChanges.length === 0) {
      return yield* new AlreadyAppliedError();
    }

    const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
      ctx.mainCatalog,
      sortedChanges,
    );

    if (fingerprintFrom === plan.target.fingerprint) {
      return yield* new AlreadyAppliedError();
    }

    if (fingerprintFrom !== plan.source.fingerprint) {
      return yield* new FingerprintMismatchError({
        current: fingerprintFrom,
        expected: plan.source.fingerprint,
      });
    }

    const statements = plan.statements;
    const script = joinStatements(statements);

    yield* currentDb.query(script).pipe(
      Effect.mapError(
        (error) =>
          new PlanApplyError({
            cause: error,
            script,
          }),
      ),
    );

    const warnings: string[] = [];
    if (options.verifyPostApply !== false) {
      const verification = yield* extractCatalog(currentDb).pipe(Effect.result);
      if (verification._tag === "Failure") {
        warnings.push(
          `Could not verify post-apply fingerprint: ${verification.failure.message}`,
        );
      } else {
        const updatedFingerprint = hashStableIds(
          verification.success,
          stableIds,
        );
        if (updatedFingerprint !== plan.target.fingerprint) {
          warnings.push(
            "Post-apply fingerprint does not match the plan target fingerprint.",
          );
        }
      }
    }

    return {
      statements: statements.filter(
        (statement) => !isSessionStatement(statement),
      ).length,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  });

const resolveDatabase = (
  input: ConnectionInput,
  label: "source" | "target",
  role: string | undefined,
): Effect.Effect<
  DatabaseApi,
  | CatalogExtractionError
  | ConnectionError
  | ConnectionTimeoutError
  | SslConfigError
> => {
  if (typeof input === "string") {
    return Effect.scoped(
      makeScopedPool(input, {
        role,
        label,
      }),
    );
  }

  if ("withConnection" in input) {
    return Effect.succeed(input);
  }

  return Effect.succeed(wrapPool(input));
};

const joinStatements = (statements: ReadonlyArray<string>): string => {
  const joined = statements.join(";\n");
  return joined.endsWith(";") ? joined : `${joined};`;
};
