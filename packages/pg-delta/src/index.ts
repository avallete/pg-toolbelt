/**
 * Root entry point for @supabase/pg-delta.
 *
 * Exports types, pure data classes, and Promise convenience wrappers.
 * For the Effect-native API, import from `@supabase/pg-delta/effect`.
 */

// Pure data classes
export { Catalog } from "./core/catalog.model.ts";
export type { CatalogSnapshot } from "./core/catalog.snapshot.ts";
export {
  deserializeCatalog,
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "./core/catalog.snapshot.ts";
// Types
export type {
  DeclarativeApplyResult,
  SqlFileEntry,
} from "./core/declarative-apply/index.ts";
// Error classes (pure Data.TaggedError — no runtime)
export {
  AlreadyAppliedError,
  CatalogExtractionError,
  ConnectionError,
  ConnectionTimeoutError,
  DeclarativeApplyError,
  FileDiscoveryError,
  FingerprintMismatchError,
  InvalidPlanError,
  PlanApplyError,
  PlanDeserializationError,
  SslConfigError,
  StuckError,
} from "./core/errors.ts";
// Pure functions (no Effect, no runtime)
export { exportDeclarativeSchema } from "./core/export/index.ts";
export type {
  DeclarativeSchemaOutput,
  FileCategory,
  FileEntry,
  FileMetadata,
} from "./core/export/types.ts";
export type { IntegrationDSL } from "./core/integrations/integration-dsl.ts";
export type { CatalogInput } from "./core/plan/create.ts";
export type { SqlFormatOptions } from "./core/plan/sql-format.ts";
export { formatSqlStatements } from "./core/plan/sql-format.ts";
export type { CreatePlanOptions, Plan } from "./core/plan/types.ts";
export type { DatabaseApi } from "./core/services/database.ts";
export type { ApplyPlanResult } from "./node.ts";
// Promise convenience wrappers
export {
  applyDeclarativeSchema,
  applyPlan,
  createPlan,
  extractCatalog,
  loadDeclarativeSchema,
} from "./node.ts";
