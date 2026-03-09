import { Effect } from "effect";
import {
  loadModule as loadPlpgsqlParserModule,
  parseSql,
} from "plpgsql-parser";
import { ValidationError } from "./errors.ts";
import { ParserService } from "./services/parser.ts";

let parserModuleLoadPromise: Promise<void> | null = null;

const ensureParserModuleLoaded = async (): Promise<void> => {
  if (!parserModuleLoadPromise) {
    parserModuleLoadPromise = loadPlpgsqlParserModule();
  }
  await parserModuleLoadPromise;
};

/**
 * Validate that a SQL string is syntactically correct using the PostgreSQL parser.
 *
 * Throws an error if the SQL cannot be parsed. This validates **syntax only**,
 * not semantic correctness (e.g. whether referenced objects exist).
 *
 * @param sql - The SQL statement to validate.
 */
export const validateSqlSyntax = async (sql: string): Promise<void> => {
  await ensureParserModuleLoaded();
  // parseSql throws on syntax errors
  parseSql(sql);
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
    yield* parser
      .parseSqlContent(sql, "<validation>")
      .pipe(
        Effect.mapError(
          (e) => new ValidationError({ message: e.message, cause: e }),
        ),
      );
  });
