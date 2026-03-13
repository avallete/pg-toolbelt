import { Effect } from "effect";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { ChangeFilter } from "../../core/integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../../core/integrations/serialize/serialize.types.ts";
import { applyPlan, createPlan } from "../../effect.ts";
import { CliExitError, UserCancelled } from "../errors.ts";
import { Output } from "../output/output.service.ts";
import { ProcessControl } from "../runtime/process-control.service.ts";
import { loadIntegrationDSL } from "../utils/integrations.ts";
import {
  formatPlanForDisplay,
  parseJsonEffect,
  tryCliPromise,
  validatePlanRisk,
} from "../utils.ts";

export interface SyncHandlerArgs {
  readonly source: string;
  readonly target: string;
  readonly yes: boolean;
  readonly unsafe: boolean;
  readonly role?: string;
  readonly filter?: string;
  readonly serialize?: string;
  readonly integration?: string;
}

export const handleSync = (args: SyncHandlerArgs) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const processControl = yield* ProcessControl;

    const filterParsed: FilterDSL | undefined = args.filter
      ? yield* parseJsonEffect<FilterDSL>("filter", args.filter)
      : undefined;
    const serializeParsed: SerializeDSL | undefined = args.serialize
      ? yield* parseJsonEffect<SerializeDSL>("serialize", args.serialize)
      : undefined;

    let filterOption: FilterDSL | ChangeFilter | undefined = filterParsed;
    let serializeOption: SerializeDSL | ChangeSerializer | undefined =
      serializeParsed;
    if (args.integration) {
      const integrationName = args.integration;
      const integrationDSL = yield* tryCliPromise(
        "Error loading integration",
        () => loadIntegrationDSL(integrationName),
      );
      filterOption = filterOption ?? integrationDSL.filter;
      serializeOption = serializeOption ?? integrationDSL.serialize;
    }

    const planResult = yield* createPlan(args.source, args.target, {
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

    const { content } = formatPlanForDisplay(planResult, "tree");
    yield* output.write(content);

    const validation = validatePlanRisk(planResult.plan, args.unsafe, {
      suppressWarning: true,
    });
    if (!validation.valid) {
      const warning = validation.warning;
      if (warning) {
        yield* output.warn(warning.title);
        for (const statement of warning.statements) {
          yield* output.warn(`- ${statement}`);
        }
        yield* output.warn(warning.suggestion);
      }
      return yield* Effect.fail(
        new CliExitError({
          exitCode: validation.exitCode,
          message: validation.message,
        }),
      );
    }

    if (!args.yes) {
      const confirmed = yield* output.confirm("Apply these changes?").pipe(
        Effect.mapError(
          (error) =>
            new CliExitError({
              exitCode: 1,
              message: error.detail,
            }),
        ),
      );
      if (!confirmed) {
        return yield* Effect.fail(
          new UserCancelled({ message: "Operation cancelled by user" }),
        );
      }
    }

    const result = yield* applyPlan(planResult.plan, args.source, args.target, {
      verifyPostApply: true,
    }).pipe(Effect.result);

    if (result._tag === "Success") {
      yield* output.info(
        `Applying ${result.success.statements} changes to database...`,
      );
      yield* output.info("Successfully applied all changes.");
      for (const warning of result.success.warnings ?? []) {
        yield* output.warn(`Warning: ${warning}`);
      }
      return;
    }

    switch (result.failure._tag) {
      case "AlreadyAppliedError":
        yield* output.info(
          "Plan already applied (target fingerprint matches desired state).",
        );
        return;
      case "FingerprintMismatchError":
        yield* output.error(
          "Target database does not match plan source fingerprint. Aborting.",
        );
        yield* processControl.setExitCode(1);
        return;
      case "InvalidPlanError":
        return yield* Effect.fail(
          new CliExitError({
            exitCode: 1,
            message: result.failure.message,
          }),
        );
      case "PlanApplyError":
        yield* output.error(
          `Failed to apply changes: ${result.failure.cause instanceof Error ? result.failure.cause.message : String(result.failure.cause)}`,
        );
        yield* output.error(`Migration script:\n${result.failure.script}`);
        yield* processControl.setExitCode(1);
        return;
      default:
        return yield* Effect.fail(
          new CliExitError({
            exitCode: 1,
            message: `Error applying plan: ${result.failure.message}`,
          }),
        );
    }
  });
