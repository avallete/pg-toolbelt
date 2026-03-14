/**
 * Shared utilities for resolving CLI --source/--target inputs that
 * can be either a PostgreSQL connection URL or a catalog snapshot file path.
 */

import { readFile } from "node:fs/promises";
import { Effect, Option } from "effect";
import type { Catalog } from "../../core/catalog.model.ts";
import type { CatalogSnapshot } from "../../core/catalog.snapshot.ts";
import { deserializeCatalog } from "../../core/catalog.snapshot.ts";
import type { CliExitError } from "../errors.ts";
import { deserializeCatalogSnapshotEffect, tryCliPromise } from "../utils.ts";

export function isPostgresUrl(input: string): boolean {
  return input.startsWith("postgres://") || input.startsWith("postgresql://");
}

export async function loadCatalogFromFile(path: string): Promise<Catalog> {
  const json = await readFile(path, "utf-8");
  return deserializeCatalog(JSON.parse(json));
}

export const resolveSourceInput = (
  source: Option.Option<string>,
  integrationEmptyCatalog: CatalogSnapshot | undefined,
): Effect.Effect<string | Catalog | null, CliExitError> =>
  Effect.gen(function* () {
    if (Option.isSome(source)) {
      return isPostgresUrl(source.value)
        ? source.value
        : yield* tryCliPromise("Error loading source catalog", () =>
            loadCatalogFromFile(source.value),
          );
    }
    if (integrationEmptyCatalog) {
      return yield* deserializeCatalogSnapshotEffect(integrationEmptyCatalog);
    }
    return null;
  });

export const resolveTargetInput = (
  target: string,
): Effect.Effect<string | Catalog, CliExitError> =>
  isPostgresUrl(target)
    ? Effect.succeed(target)
    : tryCliPromise("Error loading target catalog", () =>
        loadCatalogFromFile(target),
      );
