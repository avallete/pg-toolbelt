import { Layer, ManagedRuntime } from "effect";
import type { Pool } from "pg";
import type { Catalog } from "./core/catalog.model.ts";
import type { DatabaseApi } from "./core/services/database.ts";
import {
  applyDeclarativeSchema as applyDeclarativeSchemaEffect,
  applyPlan as applyPlanEffect,
  createPlan as createPlanEffect,
  extractCatalog as extractCatalogEffect,
  fromPool,
} from "./effect.ts";

const runtime = ManagedRuntime.make(Layer.empty);

export * from "./effect.ts";

export const createPlan = (
  source: string | Pool | DatabaseApi | Catalog | null,
  target: string | Pool | DatabaseApi | Catalog,
  options?: Parameters<typeof createPlanEffect>[2],
) => runtime.runPromise(createPlanEffect(source, target, options));

export const applyPlan = (
  plan: Parameters<typeof applyPlanEffect>[0],
  source: string | Pool | DatabaseApi,
  target: string | Pool | DatabaseApi,
  options?: Parameters<typeof applyPlanEffect>[3],
) => runtime.runPromise(applyPlanEffect(plan, source, target, options));

export const applyDeclarativeSchema = (
  options: Parameters<typeof applyDeclarativeSchemaEffect>[0],
) => runtime.runPromise(applyDeclarativeSchemaEffect(options));

export const extractCatalog = (input: Pool | DatabaseApi) =>
  runtime.runPromise(
    extractCatalogEffect("withConnection" in input ? input : fromPool(input)),
  );
