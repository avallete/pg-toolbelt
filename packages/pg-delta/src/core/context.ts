import { sql } from "@ts-safeql/sql-tag";
import { Effect } from "effect";
import type { Catalog } from "./catalog.model.ts";
import type { CatalogExtractionError } from "./errors.ts";
import type { DatabaseApi, Queryable } from "./services/database.ts";

/**
 * Context for diff operations, containing both source and target catalogs.
 */
export interface DiffContext {
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}

export async function extractVersion(pool: Queryable) {
  const { rows } = await pool.query<{ version: number }>(
    sql`select current_setting('server_version_num')::int as version`,
  );

  return rows[0].version;
}

export async function extractCurrentUser(pool: Queryable) {
  const { rows } = await pool.query<{ current_user: string }>(
    sql`select quote_ident(current_user) as current_user`,
  );
  return rows[0].current_user;
}

// ============================================================================
// Effect-native versions
// ============================================================================

export const extractVersionEffect = (
  db: DatabaseApi,
): Effect.Effect<number, CatalogExtractionError> =>
  Effect.gen(function* () {
    const { rows } = yield* db.query<{ version: number }>(
      sql`select current_setting('server_version_num')::int as version`.text,
    );
    return rows[0].version;
  });

export const extractCurrentUserEffect = (
  db: DatabaseApi,
): Effect.Effect<string, CatalogExtractionError> =>
  Effect.gen(function* () {
    const { rows } = yield* db.query<{ current_user: string }>(
      sql`select quote_ident(current_user) as current_user`.text,
    );
    return rows[0].current_user;
  });
