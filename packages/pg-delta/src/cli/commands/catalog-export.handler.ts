import { Effect, FileSystem } from "effect";
import {
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../../core/catalog.snapshot.ts";
import { extractCatalog, makeScopedDatabase } from "../../effect.ts";
import { CliExitError } from "../errors.ts";
import { Output } from "../output/output.service.ts";

export interface CatalogExportHandlerArgs {
  readonly target: string;
  readonly output: string;
  readonly role?: string;
}

export const handleCatalogExport = (args: CatalogExportHandlerArgs) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const output = yield* Output;

    const db = yield* makeScopedDatabase(args.target, {
      role: args.role,
      label: "target",
    }).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error connecting to target database: ${error.message}`,
          }),
      ),
    );
    const catalog = yield* extractCatalog(db).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error exporting catalog snapshot: ${error.message}`,
          }),
      ),
    );
    const snapshot = serializeCatalog(catalog);
    const json = stringifyCatalogSnapshot(snapshot);

    yield* fs.writeFileString(args.output, json).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error writing catalog snapshot: ${error instanceof Error ? error.message : String(error)}`,
          }),
      ),
    );
    yield* output.success(`Catalog snapshot written to ${args.output}`);
  }).pipe(Effect.scoped);
