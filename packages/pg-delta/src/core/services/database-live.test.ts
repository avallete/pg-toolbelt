import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { ConnectionTimeoutError, SslConfigError } from "../errors.ts";
import { PgRuntimeConfigService } from "../runtime-config.ts";

type MockSslConfig = {
  cleanedUrl: string;
  ssl:
    | undefined
    | {
        rejectUnauthorized: boolean;
        ca?: string;
      };
};

const parseSslConfigMock = mock(
  async (...args: unknown[]): Promise<MockSslConfig> => ({
    cleanedUrl: args[0] as string,
    ssl: undefined,
  }),
);
const endPoolMock = mock(async () => {});

let connectImpl: () => Promise<{ release: () => void }>;
const createPoolMock = mock(() => ({
  connect: () => connectImpl(),
  query: async () => ({ rows: [], rowCount: 0 }),
}));

mock.module("../plan/ssl-config.ts", () => ({
  parseSslConfig: parseSslConfigMock,
}));

mock.module("../postgres-config.ts", () => ({
  createPool: createPoolMock,
  endPool: endPoolMock,
}));

const { makeScopedPool, makeScopedPoolEffect } = await import(
  "./database-live.ts"
);

describe("makeScopedPool", () => {
  const TestRuntimeConfig = Layer.succeed(PgRuntimeConfigService, {
    poolMax: 5,
    connectionTimeoutMs: 3_000,
    connectTimeoutMs: 1,
    getEnv: () => undefined,
  });

  beforeEach(() => {
    parseSslConfigMock.mockReset();
    parseSslConfigMock.mockImplementation(async (...args: unknown[]) => ({
      cleanedUrl: args[0] as string,
      ssl: undefined,
    }));
    createPoolMock.mockClear();
    endPoolMock.mockClear();
  });

  test("retries transient connection failures before succeeding", async () => {
    let attempts = 0;
    connectImpl = async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("connection reset");
      }
      return { release: () => {} };
    };

    await Effect.scoped(makeScopedPool("postgresql://example/db")).pipe(
      Effect.runPromise,
    );

    expect(attempts).toBe(3);
    expect(createPoolMock).toHaveBeenCalledTimes(1);
    expect(endPoolMock).toHaveBeenCalledTimes(1);
  });

  test("does not retry SSL configuration failures", async () => {
    parseSslConfigMock.mockImplementationOnce(async () => {
      throw new Error("bad sslmode");
    });
    connectImpl = async () => ({ release: () => {} });

    const result = await Effect.scoped(
      makeScopedPool("postgresql://example/db", { label: "source" }),
    ).pipe(Effect.result, Effect.runPromise);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(SslConfigError);
    }
    expect(createPoolMock).not.toHaveBeenCalled();
  });

  test("passes injected runtime config through to SSL parsing", async () => {
    parseSslConfigMock.mockImplementationOnce(async (...args: unknown[]) => {
      const [url, _label, runtimeConfig] = args as [
        string,
        "source" | "target",
        { getEnv: (name: string) => string | undefined },
      ];

      return {
        cleanedUrl: url,
        ssl: {
          rejectUnauthorized: true,
          ca: runtimeConfig.getEnv("PGDELTA_SOURCE_SSLROOTCERT"),
        },
      };
    });
    connectImpl = async () => ({ release: () => {} });

    const runtimeConfig = Layer.succeed(PgRuntimeConfigService, {
      poolMax: 5,
      connectionTimeoutMs: 3_000,
      connectTimeoutMs: 100,
      getEnv: (name: string) =>
        name === "PGDELTA_SOURCE_SSLROOTCERT" ? "ca-cert-content" : undefined,
    });

    await Effect.scoped(
      makeScopedPoolEffect("postgresql://example/db", { label: "source" }),
    ).pipe(Effect.provide(runtimeConfig), Effect.runPromise);

    expect(createPoolMock).toHaveBeenCalledWith(
      "postgresql://example/db",
      expect.objectContaining({
        ssl: expect.objectContaining({
          ca: "ca-cert-content",
          rejectUnauthorized: true,
        }),
      }),
      expect.objectContaining({
        getEnv: expect.any(Function),
      }),
    );
  });

  test("retries timeouts and eventually fails with ConnectionTimeoutError", async () => {
    let attempts = 0;
    connectImpl = () => {
      attempts += 1;
      return new Promise(() => {});
    };

    const result = await Effect.scoped(
      makeScopedPoolEffect("postgresql://example/db", { label: "target" }),
    ).pipe(Effect.provide(TestRuntimeConfig), Effect.result, Effect.runPromise);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(ConnectionTimeoutError);
    }
    expect(attempts).toBe(3);
  });
});
