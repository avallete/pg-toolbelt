import { Effect, ManagedRuntime } from "effect";
import { ValidationError } from "./errors.ts";
import { ParserService } from "./services/parser.ts";
import { ParserServiceLive } from "./services/parser-live.ts";

/**
 * Dedicated managed runtime for the strict validation API. It is intentionally
 * separate from the batch-analysis entrypoints because validation has different
 * semantics: parser diagnostics should fail the call instead of being returned.
 */
const parserRuntime = ManagedRuntime.make(ParserServiceLive);

const toValidationError = (
  sql: string,
  parsed: {
    statements: ReadonlyArray<unknown>;
    diagnostics: ReadonlyArray<{ code: string; message: string }>;
  },
): ValidationError | null => {
  const parseDiagnostic = parsed.diagnostics.find(
    (diagnostic) => diagnostic.code === "PARSE_ERROR",
  );
  if (parseDiagnostic) {
    return new ValidationError({ message: parseDiagnostic.message });
  }

  // A validation call that produced no statements is still invalid input even
  // if the underlying parser surfaced it as an empty diagnostic result.
  if (sql.trim().length > 0 && parsed.statements.length === 0) {
    return new ValidationError({
      message: "SQL did not produce any executable statements.",
    });
  }

  return null;
};

/**
 * Validate that a SQL string is syntactically correct using the PostgreSQL parser.
 *
 * Throws an error if the SQL cannot be parsed. This validates **syntax only**,
 * not semantic correctness (e.g. whether referenced objects exist).
 *
 * Routes through ParserService so WASM module loading is managed by the service layer.
 *
 * @param sql - The SQL statement to validate.
 */
export const validateSqlSyntax = async (sql: string): Promise<void> => {
  await parserRuntime.runPromise(validateSqlSyntaxEffect(sql));
};

// ============================================================================
// Effect-native version
// ============================================================================

/**
 * Validate SQL syntax using the ParserService. The WASM module loading
 * is handled by the service layer.
 */
export const validateSqlSyntaxEffect = (
  sql: string,
): Effect.Effect<void, ValidationError, ParserService> =>
  Effect.gen(function* () {
    const parser = yield* ParserService;
    const parsed = yield* parser
      .parseSqlContent(sql, "<validation>")
      .pipe(
        Effect.mapError(
          (e) => new ValidationError({ message: e.message, cause: e }),
        ),
      );
    const validationError = toValidationError(sql, parsed);
    if (validationError) {
      return yield* Effect.fail(validationError);
    }
  });
