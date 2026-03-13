import * as PgClient from "@effect/sql-pg/PgClient";
import { Effect, Option, Schedule, type Scope } from "effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import type { Pool } from "pg";
import { escapeIdentifier } from "pg";
import {
  CatalogExtractionError,
  ConnectionError,
  ConnectionTimeoutError,
  SslConfigError,
} from "../../core/errors.ts";
import { parseSslConfig } from "../../core/plan/ssl-config.ts";
import { createPool, endPool } from "../../core/postgres-config.ts";
import {
  makePgRuntimeConfigLayer,
  PgRuntimeConfigService,
} from "../../core/runtime-config.ts";
import { type DatabaseApi, fromPgClient } from "./database.service.ts";

const CONNECT_RETRY_BASE_DELAY = "50 millis";
const CONNECT_RETRY_TIMES = 2;

const queryError = (error: unknown) =>
  new CatalogExtractionError({
    message: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
    cause: error,
  });

const connectionError = (
  error: unknown,
  label: "source" | "target" = "target",
) =>
  new ConnectionError({
    message: `Failed to acquire ${label} database connection: ${error instanceof Error ? error.message : String(error)}`,
    label,
    cause: error,
  });

export const fromPool = (
  pool: Pool,
  options?: { readonly label?: "source" | "target" },
): DatabaseApi => {
  const client = Effect.runSync(
    PgClient.fromPool({
      acquire: Effect.succeed(ensurePoolOptions(pool)),
      applicationName: "@supabase/pg-delta",
    }).pipe(Effect.provide(Reactivity.layer), Effect.scoped, Effect.orDie),
  );

  return fromPgClient(client, {
    queryError,
    connectionError: (error) => connectionError(error, options?.label),
  });
};

export const makeScopedSqlDatabaseEffect = (
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

    const sslConfig = yield* Effect.tryPromise({
      try: () => parseSslConfig(url, label, runtimeConfig),
      catch: (error) =>
        new SslConfigError({
          message: `SSL config failed for ${label}: ${error instanceof Error ? error.message : String(error)}`,
          cause: error,
        }),
    });

    const pool = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createPool(
          sslConfig.cleanedUrl,
          {
            ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
            onError: (error: Error & { code?: string }) => {
              if (error.code !== "57P01") {
                console.error("Pool error:", error);
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

    yield* Effect.retry(
      Effect.gen(function* () {
        const connected = yield* Effect.tryPromise({
          try: async () => {
            const client = await pool.connect();
            client.release();
          },
          catch: (error) =>
            new ConnectionError({
              message: `Failed to connect to ${label} database: ${error instanceof Error ? error.message : String(error)}`,
              label,
              cause: error,
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

    const client = yield* PgClient.fromPool({
      acquire: Effect.succeed(ensurePoolOptions(pool)),
      applicationName: "@supabase/pg-delta",
    }).pipe(
      Effect.provide(Reactivity.layer),
      Effect.mapError((error) => connectionError(error, label)),
    );

    return fromPgClient(client, {
      queryError,
      connectionError: (error) => connectionError(error, label),
    });
  });

export const makeScopedSqlDatabase = (
  url: string,
  options?: { role?: string; label?: "source" | "target" },
): Effect.Effect<
  DatabaseApi,
  ConnectionError | ConnectionTimeoutError | SslConfigError,
  Scope.Scope
> =>
  makeScopedSqlDatabaseEffect(url, options).pipe(
    Effect.provide(makePgRuntimeConfigLayer()),
  );

function ensurePoolOptions(pool: Pool): Pool {
  const candidate = pool as Pool & {
    options?: Record<string, unknown>;
  };

  if (candidate.options !== undefined) {
    return pool;
  }

  return Object.assign(candidate, {
    options: {},
  });
}
