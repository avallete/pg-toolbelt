import { describe, expect, test } from "bun:test";
import { parseSslConfig } from "./ssl-config.ts";

describe("parseSslConfig", () => {
  test("reads CA certificate content from injected runtime config", async () => {
    const result = await parseSslConfig(
      "postgresql://example/db?sslmode=verify-ca",
      "source",
      {
        getEnv: (name) =>
          name === "PGDELTA_SOURCE_SSLROOTCERT" ? "ca-cert-content" : undefined,
      },
    );

    expect(result.cleanedUrl).toBe("postgresql://example/db");
    expect(result.ssl).not.toBe(false);
    if (result.ssl && result.ssl !== true) {
      expect(result.ssl.rejectUnauthorized).toBe(true);
      expect(result.ssl.ca).toBe("ca-cert-content");
    }
  });
});
