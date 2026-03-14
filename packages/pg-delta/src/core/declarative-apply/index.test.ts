import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import type { Pool } from "pg";
import { CatalogExtractionError } from "../errors.ts";
import type { DatabaseApi } from "../services/database.ts";
import { applyDeclarativeSchema as _applyDeclarativeSchema } from "./index.ts";

const applyDeclarativeSchema = (
  ...args: Parameters<typeof _applyDeclarativeSchema>
) => _applyDeclarativeSchema(...args).pipe(Effect.runPromise);

// Mock extractCatalogProviders to fail, simulating an early failure
// before roundApply is ever reached.
mock.module("./extract-catalog-providers.ts", () => ({
  extractCatalogProviders: () =>
    Effect.fail(
      new CatalogExtractionError({
        message: "simulated catalog extraction failure",
      }),
    ),
}));

// Track cleanup of internally-created scoped databases.
let lastScopedDbClosed = false;

mock.module("../services/database-live.ts", () => ({
  wrapPool: (_pool: Pool): DatabaseApi =>
    ({
      withConnection: (
        _fn: (
          conn: DatabaseApi["withConnection"] extends (fn: infer F) => unknown
            ? F
            : never,
        ) => unknown,
      ) => {
        throw new Error("should not call withConnection on mock");
      },
      query: () => Effect.die(new Error("should not query mock")),
    }) as unknown as DatabaseApi,
  makeScopedPool: (_url: string) =>
    Effect.acquireRelease(
      Effect.sync((): DatabaseApi => {
        lastScopedDbClosed = false;
        return {
          withConnection: () => {
            throw new Error("should not call withConnection on mock");
          },
          query: () => Effect.die(new Error("should not query mock")),
        } as unknown as DatabaseApi;
      }),
      () =>
        Effect.sync(() => {
          lastScopedDbClosed = true;
        }),
    ),
}));

function createMockPool(): Pool & { closeCalled: boolean } {
  const pool = {
    closeCalled: false,
    connect: async () => {
      throw new Error("should not connect");
    },
    end: async () => {},
    query: async () => {
      throw new Error("should not query");
    },
  } as unknown as Pool & { closeCalled: boolean };
  return pool;
}

describe("applyDeclarativeSchema", () => {
  test("caller-owned pool is NOT closed on early failure", async () => {
    const pool = createMockPool();

    await expect(
      applyDeclarativeSchema({
        content: [{ filePath: "test.sql", sql: "CREATE TABLE t(id int);" }],
        pool,
      }),
    ).rejects.toThrow("simulated catalog extraction failure");

    expect(pool.closeCalled).toBe(false);
  });

  test("internally-created pool IS closed on early failure", async () => {
    lastScopedDbClosed = false;

    await expect(
      applyDeclarativeSchema({
        content: [{ filePath: "test.sql", sql: "CREATE TABLE t(id int);" }],
        targetUrl: "postgresql://localhost/test",
      }),
    ).rejects.toThrow("simulated catalog extraction failure");

    expect(lastScopedDbClosed).toBe(true);
  });
});
