import { Effect, ServiceMap } from "effect";
import type { Pool } from "pg";
import type { CatalogExtractionError } from "../errors.ts";

export interface Queryable {
  readonly query: <R = Record<string, unknown>>(
    query: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ) => Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface DatabaseApi {
  /** Execute a parameterized query */
  readonly query: <R = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) => Effect.Effect<
    { rows: R[]; rowCount: number | null },
    CatalogExtractionError
  >;
  /** Access the underlying pg Pool (escape hatch for code not yet migrated) */
  readonly getPool: () => Pool;
}

/**
 * Adapt the Effect-native database service to the smaller async query surface
 * that the extractors actually need. Real `pg` pools satisfy `Queryable`
 * structurally, so the Promise-based and Effect-based paths can share the same
 * extractor implementations without pretending to be a full `Pool`.
 */
export const asQueryable = (db: DatabaseApi): Queryable => ({
  query: <R = Record<string, unknown>>(
    query: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ) =>
    db
      .query<R>(
        typeof query === "string" ? query : query.text,
        values ?? (typeof query === "string" ? undefined : query.values),
      )
      .pipe(Effect.runPromise),
});

export class DatabaseService extends ServiceMap.Service<
  DatabaseService,
  DatabaseApi
>()("@pg-delta/DatabaseService") {}
