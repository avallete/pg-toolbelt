import { Layer, ManagedRuntime } from "effect";
import type { Pool } from "pg";
import type { Catalog } from "./core/catalog.model.ts";
import type { DatabaseApi } from "./core/services/database.ts";
import {
  applyDeclarativeSchema as _applyDeclarativeSchema,
  applyPlan as _applyPlan,
  createPlan as _createPlan,
  extractCatalog as _extractCatalog,
  fromPool,
} from "./effect.ts";

const runtime = ManagedRuntime.make(Layer.empty);

export * from "./effect.ts";

export const createPlan = (
  source: string | Pool | DatabaseApi | Catalog | null,
  target: string | Pool | DatabaseApi | Catalog,
  options?: Parameters<typeof _createPlan>[2],
) => runtime.runPromise(_createPlan(source, target, options));

export const applyPlan = (
  plan: Parameters<typeof _applyPlan>[0],
  source: string | Pool | DatabaseApi,
  target: string | Pool | DatabaseApi,
  options?: Parameters<typeof _applyPlan>[3],
) => runtime.runPromise(_applyPlan(plan, source, target, options));

export const applyDeclarativeSchema = (
  options: Parameters<typeof _applyDeclarativeSchema>[0],
) => runtime.runPromise(_applyDeclarativeSchema(options));

export const extractCatalog = (input: Pool | DatabaseApi) =>
  runtime.runPromise(
    _extractCatalog("withConnection" in input ? input : fromPool(input)),
  );
