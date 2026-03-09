// ============================================================================
// Effect-native exports (for Effect consumers)
// ============================================================================
export { analyzeAndSortEffect } from "./analyze-and-sort.ts";
export { ParseError, DiscoveryError, ValidationError } from "./errors.ts";
export { analyzeAndSortFromFilesEffect } from "./from-files.ts";
export { ParserService, type ParserApi } from "./services/parser.ts";
export { ParserServiceLive } from "./services/parser-live.ts";
export { validateSqlSyntaxEffect } from "./validate-sql.ts";

// ============================================================================
// Promise-based exports (backward compatible — unchanged signatures)
// ============================================================================
export { analyzeAndSort } from "./analyze-and-sort.ts";
export { analyzeAndSortFromFiles } from "./from-files.ts";
export { validateSqlSyntax } from "./validate-sql.ts";

// ============================================================================
// Type re-exports (unchanged)
// ============================================================================
export type {
  AnalyzeOptions,
  AnalyzeResult,
  AnnotationHints,
  Diagnostic,
  DiagnosticCode,
  GraphEdge,
  GraphEdgeReason,
  GraphReport,
  ObjectKind,
  ObjectRef,
  PhaseTag,
  StatementId,
  StatementNode,
} from "./model/types.ts";
