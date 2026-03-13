import type { Pool } from "pg";
import type { Catalog } from "./core/catalog.model.ts";
import type { DatabaseApi } from "./core/services/database.ts";

export {
  Catalog,
  createEmptyCatalog,
  extractCatalogEffect as extractCatalog,
} from "./core/catalog.model.ts";
export type { CatalogSnapshot } from "./core/catalog.snapshot.ts";
export {
  deserializeCatalog,
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "./core/catalog.snapshot.ts";
export { loadDeclarativeSchemaEffect as loadDeclarativeSchema } from "./core/declarative-apply/discover-sql.ts";
export type {
  DeclarativeApplyResult,
  SqlFileEntry,
} from "./core/declarative-apply/index.ts";
export { applyDeclarativeSchemaEffect as applyDeclarativeSchema } from "./core/declarative-apply/index.ts";
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
export { exportDeclarativeSchema } from "./core/export/index.ts";
export type {
  DeclarativeSchemaOutput,
  FileCategory,
  FileEntry,
  FileMetadata,
} from "./core/export/types.ts";
export type { IntegrationDSL } from "./core/integrations/integration-dsl.ts";
export { applyPlanEffect as applyPlan } from "./core/plan/apply.ts";
export type { CatalogInput } from "./core/plan/create.ts";
export { createPlanEffect as createPlan } from "./core/plan/create.ts";
export type { SqlFormatOptions } from "./core/plan/sql-format.ts";
export { formatSqlStatements } from "./core/plan/sql-format.ts";
export type { CreatePlanOptions, Plan } from "./core/plan/types.ts";
export type {
  DatabaseApi,
  DatabaseConnectionApi,
} from "./core/services/database.ts";
export { DatabaseService } from "./core/services/database.ts";
export {
  makeScopedPool as makeScopedDatabase,
  wrapPool as fromPool,
} from "./core/services/database-live.ts";

export type EffectCatalogInput = string | Pool | Catalog | DatabaseApi;
