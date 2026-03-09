---
"@supabase/pg-delta": patch
"@supabase/pg-topo": patch
---

Replace anti-Effect-TS patterns with idiomatic Effect code.

**pg-delta:**
- Replace `process.exitCode` mutations with `CliExitError` typed error + `Effect.fail`
- Replace `try/catch` in Effect.gen with `Effect.tryPromise` / `Effect.try`
- Replace throwing `parseJsonSafe`/`parseJsonFlag` with `parseJsonEffect` (Effect-native)
- Replace `process.stdout/stderr.write` in CLI commands with `logInfo`/`logWarning`/`logError`
- Read CLI version from `package.json` instead of hardcoding
- Remove mutable `exit-code.ts` module

**pg-topo:**
- Split `ParseError` into `WasmLoadError` (WASM module loading) + `ParseError` (SQL parsing)
- Route `parseSqlContent` and `validateSqlSyntax` through `ParserService` via `ManagedRuntime`
- Remove manual WASM loading singletons from `parse.ts` and `validate-sql.ts`
- Export `WasmLoadError` from package index
