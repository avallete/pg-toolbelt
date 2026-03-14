/**
 * PostgreSQL connection configuration.
 *
 * Low-level pool factory and type parsers live in `platform/sql/pool.ts`.
 * This module re-exports them and adds higher-level helpers (createManagedPool)
 * that depend on core modules (logging, SSL parsing).
 */

import { escapeIdentifier, type Pool } from "pg";
import { getPgDeltaLogger } from "./logging.ts";
import { parseSslConfig } from "./plan/ssl-config.ts";
import type { PgRuntimeConfigApi } from "./runtime-config.ts";

// Re-export low-level pool primitives from platform
export { createPool, endPool } from "../platform/sql/pool.ts";

import { ConfigProvider, Effect } from "effect";
// Re-import for local use
import { createPool, endPool } from "../platform/sql/pool.ts";
import { loadPgRuntimeConfig } from "./runtime-config.ts";

const logger = getPgDeltaLogger("postgres");

const getDefaultRuntimeConfig = (): PgRuntimeConfigApi =>
  Effect.runSync(loadPgRuntimeConfig(ConfigProvider.fromEnv()));

/**
 * Create a pool from a connection URL with standard session setup:
 * SSL parsing, search_path isolation, optional SET ROLE, and 57P01 suppression.
 *
 * Returns the pool and a `close` function that properly waits for all sockets
 * to close (via {@link endPool}).
 */
export async function createManagedPool(
  url: string,
  options?: { role?: string; label?: "source" | "target" },
  runtimeConfig: PgRuntimeConfigApi = getDefaultRuntimeConfig(),
): Promise<{ pool: Pool; close: () => Promise<void> }> {
  const sslConfig = await parseSslConfig(
    url,
    options?.label ?? "target",
    runtimeConfig,
  );
  const pool = createPool(
    sslConfig.cleanedUrl,
    {
      ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
      onError: (err: Error & { code?: string }) => {
        if (err.code !== "57P01") {
          logger.error("Pool error for {label} connection", {
            label: options?.label ?? "target",
            error: err,
          });
        }
      },
      onConnect: async (client) => {
        await client.query("SET search_path = ''");
        if (options?.role) {
          await client.query(`SET ROLE ${escapeIdentifier(options.role)}`);
        }
      },
    },
    runtimeConfig,
  );

  // Eagerly validate connectivity so SSL/auth failures surface immediately
  // instead of hanging on the first real query. node-pg's connectionTimeoutMillis
  // is not reliably enforced under Bun when SSL negotiation hangs.
  const label = options?.label ?? "target";
  const timeoutMs = runtimeConfig.connectTimeoutMs;
  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Connection to ${label} database timed out after ${timeoutMs}ms. ` +
                  `The server may require SSL, use an invalid certificate, or be unreachable.`,
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
    client.release();
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }

  return { pool, close: () => endPool(pool) };
}
