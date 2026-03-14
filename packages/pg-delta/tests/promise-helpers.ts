/**
 * Promise convenience wrappers for integration tests.
 *
 * These replace the deleted *Promise functions that previously lived in core
 * files. Integration tests use these instead of depending on internal APIs.
 */

import { Effect } from "effect";
import { applyDeclarativeSchema as _applyDeclarativeSchema } from "../src/core/declarative-apply/index.ts";
import { applyPlan as _applyPlan } from "../src/core/plan/apply.ts";
import { createPlan as _createPlan } from "../src/core/plan/create.ts";

export const createPlan = (...args: Parameters<typeof _createPlan>) =>
  _createPlan(...args).pipe(Effect.runPromise);

export type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string };

export const applyPlan = async (
  ...args: Parameters<typeof _applyPlan>
): Promise<ApplyPlanResult> => {
  const result = await _applyPlan(...args).pipe(
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
        script: args[0].statements.join(";\n"),
      };
  }
};

export const applyDeclarativeSchema = (
  ...args: Parameters<typeof _applyDeclarativeSchema>
) => _applyDeclarativeSchema(...args).pipe(Effect.runPromise);
