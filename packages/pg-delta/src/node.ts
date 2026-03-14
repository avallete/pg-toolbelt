/**
 * Promise convenience wrappers for Node.js consumers.
 *
 * The canonical Effect-native API lives at `@supabase/pg-delta/effect`.
 * This module provides Promise-returning wrappers using a shared ManagedRuntime.
 * It does NOT re-export the Effect API — consumers who want Effect programs
 * import from `./effect.ts`.
 */

import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { Pool } from "pg";
import type { Catalog } from "./core/catalog.model.ts";
import type { Change } from "./core/change.types.ts";
import type { DiffContext } from "./core/context.ts";
import type { SqlFileEntry } from "./core/declarative-apply/discover-sql.ts";
import type { DeclarativeApplyResult } from "./core/declarative-apply/index.ts";
import type { CatalogInput } from "./core/plan/create.ts";
import type { CreatePlanOptions, Plan } from "./core/plan/types.ts";
import type { DatabaseApi } from "./core/services/database.ts";
import {
  applyDeclarativeSchema as _applyDeclarativeSchema,
  applyPlan as _applyPlan,
  createPlan as _createPlan,
  extractCatalog as _extractCatalog,
  loadDeclarativeSchema as _loadDeclarativeSchema,
  fromPool,
} from "./effect.ts";

const runtime = ManagedRuntime.make(Layer.empty);

// ---------------------------------------------------------------------------
// Promise wrappers
// ---------------------------------------------------------------------------

export const loadDeclarativeSchema = (
  schemaPath: string,
): Promise<SqlFileEntry[]> =>
  runtime.runPromise(
    _loadDeclarativeSchema(schemaPath).pipe(
      Effect.provide(NodeFileSystem.layer),
    ),
  );

export const createPlan = (
  source: CatalogInput | null,
  target: CatalogInput,
  options?: CreatePlanOptions,
): Promise<{ plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null> =>
  runtime.runPromise(_createPlan(source, target, options));

export const applyPlan = async (
  plan: Plan,
  source: string | Pool | DatabaseApi,
  target: string | Pool | DatabaseApi,
  options?: { verifyPostApply?: boolean },
): Promise<ApplyPlanResult> => {
  const result = await runtime.runPromise(
    _applyPlan(plan, source, target, options).pipe(Effect.result),
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
      return { status: "invalid_plan", message: error.message };
    case "FingerprintMismatchError":
      return {
        status: "fingerprint_mismatch",
        current: error.current,
        expected: error.expected,
      };
    case "AlreadyAppliedError":
      return { status: "already_applied" };
    case "PlanApplyError":
      return { status: "failed", error: error.cause, script: error.script };
    default:
      return {
        status: "failed",
        error,
        script: plan.statements.join(";\n"),
      };
  }
};

export const applyDeclarativeSchema = (
  options: Parameters<typeof _applyDeclarativeSchema>[0],
): Promise<DeclarativeApplyResult> =>
  runtime.runPromise(_applyDeclarativeSchema(options));

export const extractCatalog = (input: Pool | DatabaseApi): Promise<Catalog> =>
  runtime.runPromise(
    _extractCatalog("withConnection" in input ? input : fromPool(input)),
  );

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string };

export type {
  Catalog,
  CatalogInput,
  CreatePlanOptions,
  DatabaseApi,
  DeclarativeApplyResult,
  Plan,
  SqlFileEntry,
};
