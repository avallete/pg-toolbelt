import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { DatabaseApi } from "../../services/database.ts";
import { Extension, extractExtensions } from "./extension.model.ts";

describe("Extension", () => {
  test("stableId returns extension:<name>", () => {
    const ext = new Extension({
      name: "plpgsql",
      schema: "pg_catalog",
      relocatable: false,
      version: "1.0",
      owner: "postgres",
      comment: null,
      members: [],
    });
    expect(ext.stableId).toBe("extension:plpgsql");
  });

  test("identityFields returns name", () => {
    const ext = new Extension({
      name: "vector",
      schema: "extensions",
      relocatable: true,
      version: "0.7.0",
      owner: "postgres",
      comment: "vector type",
      members: ["type:extensions.vector"],
    });
    expect(ext.identityFields).toEqual({ name: "vector" });
  });

  test("dataFields returns schema, relocatable, version, owner, comment", () => {
    const ext = new Extension({
      name: "pgcrypto",
      schema: "public",
      relocatable: false,
      version: "1.3",
      owner: "postgres",
      comment: "cryptographic functions",
      members: ["procedure:public.gen_random_uuid()"],
    });
    expect(ext.dataFields).toEqual({
      schema: "public",
      relocatable: false,
      version: "1.3",
      owner: "postgres",
      comment: "cryptographic functions",
    });
  });
});

describe("extractExtensions", () => {
  test("returns empty array when db returns no rows", async () => {
    const db = {
      query: () => Effect.succeed({ rows: [], rowCount: 0 }),
    } as unknown as DatabaseApi;
    const result = await extractExtensions(db).pipe(Effect.runPromise);
    expect(result).toEqual([]);
  });

  test("returns Extension instances for valid rows", async () => {
    const db = {
      query: () =>
        Effect.succeed({
          rows: [
            {
              name: "plpgsql",
              schema: "pg_catalog",
              relocatable: false,
              version: "1.0",
              owner: "postgres",
              comment: null,
              members: [],
            },
            {
              name: "vector",
              schema: "extensions",
              relocatable: true,
              version: "0.7.0",
              owner: "postgres",
              comment: null,
              members: ["type:extensions.vector", "table:extensions.vector"],
            },
          ],
          rowCount: 2,
        }),
    } as unknown as DatabaseApi;
    const result = await extractExtensions(db).pipe(Effect.runPromise);
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(Extension);
    expect(result[0].name).toBe("plpgsql");
    expect(result[0].stableId).toBe("extension:plpgsql");
    expect(result[0].members).toEqual([]);
    expect(result[1].name).toBe("vector");
    expect(result[1].members).toEqual([
      "type:extensions.vector",
      "table:extensions.vector",
    ]);
  });
});
