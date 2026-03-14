/**
 * Bun keeps the same public contract as the Node convenience layer. The
 * implementation stays thin on purpose so the shared Effect programs remain the
 * single source of behavior.
 */

export type {
  ApplyPlanResult,
  Catalog,
  CatalogInput,
  CreatePlanOptions,
  DatabaseApi,
  DeclarativeApplyResult,
  Plan,
  SqlFileEntry,
} from "./node.ts";
export {
  applyDeclarativeSchema,
  applyPlan,
  createPlan,
  extractCatalog,
  loadDeclarativeSchema,
} from "./node.ts";
