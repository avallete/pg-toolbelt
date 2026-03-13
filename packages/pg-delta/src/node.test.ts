import { describe, expect, test } from "bun:test";
import * as NodeApi from "./node.ts";

describe("@supabase/pg-delta/node", () => {
  test("createPlan promise facade returns null for identical catalogs", async () => {
    const catalog = await NodeApi.createEmptyCatalog(17, "postgres");
    const result = await NodeApi.createPlan(catalog, catalog);

    expect(result).toBeNull();
  });

  test("bun facade matches node facade exports", async () => {
    const bunApi = await import("./bun.ts");

    expect(typeof bunApi.createPlan).toBe("function");
    expect(typeof bunApi.applyDeclarativeSchema).toBe("function");
  });
});
