import { describe, expect, test } from "bun:test";
import { ConfigProvider, Effect } from "effect";
import { loadPgRuntimeConfig } from "./runtime-config.ts";

describe("loadPgRuntimeConfig", () => {
  test("loads numeric settings from an Effect config provider", async () => {
    const config = await loadPgRuntimeConfig(
      ConfigProvider.fromUnknown({
        PGDELTA_POOL_MAX: "9",
        PGDELTA_CONNECTION_TIMEOUT_MS: "4500",
        PGDELTA_CONNECT_TIMEOUT_MS: "1500",
      }),
      () => undefined,
    ).pipe(Effect.runPromise);

    expect(config.poolMax).toBe(9);
    expect(config.connectionTimeoutMs).toBe(4_500);
    expect(config.connectTimeoutMs).toBe(1_500);
  });

  test("falls back to defaults when config values are absent", async () => {
    const config = await loadPgRuntimeConfig(
      ConfigProvider.fromUnknown({}),
      () => undefined,
    ).pipe(Effect.runPromise);

    expect(config.poolMax).toBe(5);
    expect(config.connectionTimeoutMs).toBe(3_000);
    expect(config.connectTimeoutMs).toBe(2_500);
  });
});
