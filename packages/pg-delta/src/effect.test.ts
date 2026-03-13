import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import * as EffectApi from "./effect.ts";

describe("@supabase/pg-delta/effect", () => {
  test("createPlan returns null for identical catalogs", async () => {
    const catalog = await EffectApi.createEmptyCatalog(17, "postgres");

    const result = await EffectApi.createPlan(catalog, catalog).pipe(
      Effect.runPromise,
    );

    expect(result).toBeNull();
  });

  test("applyDeclarativeSchema handles empty content without database access", async () => {
    const result = await EffectApi.applyDeclarativeSchema({
      content: [],
    }).pipe(Effect.runPromise);

    expect(result.totalStatements).toBe(0);
    expect(result.apply.status).toBe("success");
    expect(result.apply.totalRounds).toBe(0);
  });
});
