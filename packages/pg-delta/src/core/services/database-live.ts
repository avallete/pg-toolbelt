import { Effect, Option, Schedule, type Scope } from "effect";
import type { Pool } from "pg";
import { escapeIdentifier } from "pg";
import {
  CatalogExtractionError,
  ConnectionError,
  ConnectionTimeoutError,
  SslConfigError,
} from "../errors.ts";
import { parseSslConfig } from "../plan/ssl-config.ts";
import { createPool, endPool } from "../postgres-config.ts";
import {
  makePgRuntimeConfigLayer,
  PgRuntimeConfigService,
} from "../runtime-config.ts";
import type { DatabaseApi } from "./database.ts";

const CONNECT_RETRY_BASE_DELAY = "50 millis";
const CONNECT_RETRY_TIMES = 2;

/**
 * Create a DatabaseApi backed by a scoped pg Pool.
 * The pool is automatically closed when the Scope finalizes.
 *
 * This replaces the manual try/finally pool cleanup pattern in
 * create.ts and apply.ts.
 */
export const makeScopedPoolEffect = (
  url: string,
  options?: { role?: string; label?: "source" | "target" },
): Effect.Effect<
  DatabaseApi,
  ConnectionError | ConnectionTimeoutError | SslConfigError,
  PgRuntimeConfigService | Scope.Scope
> =>
  Effect.gen(function* () {
    const label = options?.label ?? "target";
    const runtimeConfig = yield* PgRuntimeConfigService;
    const connectTimeoutMs = runtimeConfig.connectTimeoutMs;

    // Parse SSL config
    const sslConfig = yield* Effect.tryPromise({
      try: () => parseSslConfig(url, label, runtimeConfig),
      catch: (err) =>
        new SslConfigError({
          message: `SSL config failed for ${label}: ${err}`,
          cause: err,
        }),
    });

    // Create pool with acquireRelease for automatic cleanup
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createPool(
          sslConfig.cleanedUrl,
          {
            ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
            onError: (err: Error & { code?: string }) => {
              if (err.code !== "57P01") {
                console.error("Pool error:", err);
              }
            },
            onConnect: async (client) => {
              await client.query("SET search_path = ''");
              if (options?.role) {
                await client.query(
                  `SET ROLE ${escapeIdentifier(options.role)}`,
                );
              }
            },
          },
          runtimeConfig,
        ),
      ),
      (pool) => Effect.promise(() => endPool(pool)),
    );

    // Validate connectivity before handing the pool to the caller. Retries stay
    // narrowly scoped to transient connect/timeout failures and never re-run
    // SSL parsing or pool creation.
    yield* Effect.retry(
      Effect.gen(function* () {
        const connected = yield* Effect.tryPromise({
          try: async () => {
            const client = await pool.connect();
            client.release();
          },
          catch: (err) =>
            new ConnectionError({
              message: `Failed to connect to ${label} database: ${err instanceof Error ? err.message : String(err)}`,
              label,
              cause: err,
            }),
        }).pipe(Effect.timeoutOption(connectTimeoutMs));

        if (Option.isNone(connected)) {
          return yield* Effect.fail(
            new ConnectionTimeoutError({
              message: `Connection to ${label} database timed out after ${connectTimeoutMs}ms`,
              label,
              timeoutMs: connectTimeoutMs,
            }),
          );
        }
      }),
      Schedule.exponential(CONNECT_RETRY_BASE_DELAY).pipe(
        Schedule.compose(Schedule.recurs(CONNECT_RETRY_TIMES)),
      ),
    );

    return wrapPool(pool);
  });

export const makeScopedPool = (
  url: string,
  options?: { role?: string; label?: "source" | "target" },
): Effect.Effect<
  DatabaseApi,
  ConnectionError | ConnectionTimeoutError | SslConfigError,
  Scope.Scope
> =>
  makeScopedPoolEffect(url, options).pipe(
    Effect.provide(makePgRuntimeConfigLayer()),
  );

/**
 * Wrap an existing pg Pool as a DatabaseApi (no lifecycle management).
 * Used when the caller owns the pool (e.g. declarative-apply with provided pool).
 */
export const wrapPool = (pool: Pool): DatabaseApi => ({
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) =>
    Effect.tryPromise({
      try: async () => {
        const result = await pool.query(sql, values);
        return result as unknown as { rows: R[]; rowCount: number | null };
      },
      catch: (err) =>
        new CatalogExtractionError({
          message: `Query failed: ${err instanceof Error ? err.message : err}`,
          cause: err,
        }),
    }),
  getPool: () => pool,
});
