import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Effect, FileSystem } from "effect";
import { analyzeAndSort, analyzeAndSortEffect } from "./analyze-and-sort.ts";
import { discoverSqlFiles, discoverSqlFilesEffect } from "./ingest/discover.ts";
import type {
  AnalyzeOptions,
  AnalyzeResult,
  Diagnostic,
} from "./model/types.ts";
import { WorkingDirectory } from "./services/working-directory.ts";

const resolveRoots = (roots: string[], cwd: string): string[] =>
  roots.map((root) => path.resolve(cwd, root));

const computeCommonBase = async (
  resolvedRoots: string[],
  cwd: string,
): Promise<string> => {
  if (resolvedRoots.length === 0) {
    return cwd;
  }

  // Normalise each root to its directory (file roots use their parent)
  const dirs: string[] = [];
  for (const root of resolvedRoots) {
    const rootStats = await stat(root).catch(() => undefined);
    dirs.push(rootStats?.isFile() ? path.dirname(root) : root);
  }

  if (dirs.length === 1) {
    return dirs[0];
  }

  const segments = dirs.map((d) => d.split(path.sep));
  const common: string[] = [];
  for (let i = 0; i < (segments[0]?.length ?? 0); i += 1) {
    const seg = segments[0]?.[i];
    if (seg !== undefined && segments.every((s) => s[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }
  return common.join(path.sep) || path.sep;
};

const toStablePath = (absolutePath: string, basePath: string): string =>
  path.relative(basePath, absolutePath).split(path.sep).join("/");

export const analyzeAndSortFromFiles = async (
  roots: string[],
  options?: AnalyzeOptions,
): Promise<AnalyzeResult> => {
  if (roots.length === 0) {
    return {
      ordered: [],
      diagnostics: [
        {
          code: "DISCOVERY_ERROR",
          message:
            "No roots provided. Pass at least one SQL file or directory root.",
        },
      ],
      graph: {
        nodeCount: 0,
        edges: [],
        cycleGroups: [],
      },
    };
  }

  const cwd = globalThis.process?.cwd?.() ?? "";
  const discovery = await discoverSqlFiles(roots, cwd);
  const discoveryDiagnostics: Diagnostic[] = [];

  for (const missingRoot of discovery.missingRoots) {
    discoveryDiagnostics.push({
      code: "DISCOVERY_ERROR",
      message: `Root does not exist: '${missingRoot}'.`,
    });
  }

  const resolvedRoots = resolveRoots(roots, cwd);
  const basePath = await computeCommonBase(resolvedRoots, cwd);

  const sqlContents: string[] = [];
  for (const filePath of discovery.files) {
    const content = await readFile(filePath, "utf-8");
    sqlContents.push(content);
  }

  const result = await analyzeAndSort(sqlContents, options);

  // Remap synthetic source labels (<input:N>) back to stable file paths
  const filePathMap = new Map<string, string>();
  for (let i = 0; i < discovery.files.length; i += 1) {
    filePathMap.set(`<input:${i}>`, toStablePath(discovery.files[i], basePath));
  }

  const remapFilePath = (filePath: string): string =>
    filePathMap.get(filePath) ?? filePath;

  const remappedOrdered = result.ordered.map((node) => ({
    ...node,
    id: {
      ...node.id,
      filePath: remapFilePath(node.id.filePath),
    },
  }));

  const remappedDiagnostics = [
    ...discoveryDiagnostics,
    ...result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      statementId: diagnostic.statementId
        ? {
            ...diagnostic.statementId,
            filePath: remapFilePath(diagnostic.statementId.filePath),
          }
        : undefined,
    })),
  ];

  const remappedGraph = {
    ...result.graph,
    edges: result.graph.edges.map((edge) => ({
      ...edge,
      from: {
        ...edge.from,
        filePath: remapFilePath(edge.from.filePath),
      },
      to: {
        ...edge.to,
        filePath: remapFilePath(edge.to.filePath),
      },
    })),
    cycleGroups: result.graph.cycleGroups.map((group) =>
      group.map((statementId) => ({
        ...statementId,
        filePath: remapFilePath(statementId.filePath),
      })),
    ),
  };

  return {
    ordered: remappedOrdered,
    diagnostics: remappedDiagnostics,
    graph: remappedGraph,
  };
};

// ============================================================================
// Effect-native version
// ============================================================================

const computeCommonBaseEffect = (
  resolvedRoots: string[],
): Effect.Effect<string, never, FileSystem.FileSystem | WorkingDirectory> =>
  Effect.gen(function* () {
    const workingDirectory = yield* WorkingDirectory;
    if (resolvedRoots.length === 0) {
      return workingDirectory.cwd;
    }

    const fs = yield* FileSystem.FileSystem;
    const dirs: string[] = [];
    for (const root of resolvedRoots) {
      const info = yield* fs
        .stat(root)
        .pipe(Effect.orElseSucceed(() => ({ type: "Directory" as const })));
      dirs.push(info.type === "File" ? path.dirname(root) : root);
    }

    if (dirs.length === 1) {
      return dirs[0];
    }

    const segments = dirs.map((d) => d.split(path.sep));
    const common: string[] = [];
    for (let i = 0; i < (segments[0]?.length ?? 0); i += 1) {
      const seg = segments[0]?.[i];
      if (seg !== undefined && segments.every((s) => s[i] === seg)) {
        common.push(seg);
      } else {
        break;
      }
    }
    return common.join(path.sep) || path.sep;
  });

const remapResult = (
  result: AnalyzeResult,
  discoveryFiles: string[],
  basePath: string,
  discoveryDiagnostics: Diagnostic[],
): AnalyzeResult => {
  const filePathMap = new Map<string, string>();
  for (let i = 0; i < discoveryFiles.length; i += 1) {
    filePathMap.set(`<input:${i}>`, toStablePath(discoveryFiles[i], basePath));
  }

  const remapFilePath = (filePath: string): string =>
    filePathMap.get(filePath) ?? filePath;

  const remappedOrdered = result.ordered.map((node) => ({
    ...node,
    id: {
      ...node.id,
      filePath: remapFilePath(node.id.filePath),
    },
  }));

  const remappedDiagnostics = [
    ...discoveryDiagnostics,
    ...result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      statementId: diagnostic.statementId
        ? {
            ...diagnostic.statementId,
            filePath: remapFilePath(diagnostic.statementId.filePath),
          }
        : undefined,
    })),
  ];

  const remappedGraph = {
    ...result.graph,
    edges: result.graph.edges.map((edge) => ({
      ...edge,
      from: {
        ...edge.from,
        filePath: remapFilePath(edge.from.filePath),
      },
      to: {
        ...edge.to,
        filePath: remapFilePath(edge.to.filePath),
      },
    })),
    cycleGroups: result.graph.cycleGroups.map((group) =>
      group.map((statementId) => ({
        ...statementId,
        filePath: remapFilePath(statementId.filePath),
      })),
    ),
  };

  return {
    ordered: remappedOrdered,
    diagnostics: remappedDiagnostics,
    graph: remappedGraph,
  };
};

export const analyzeAndSortFromFilesEffect = Effect.fnUntraced(function* (
  roots: string[],
  options?: AnalyzeOptions,
) {
  if (roots.length === 0) {
    return {
      ordered: [],
      diagnostics: [
        {
          code: "DISCOVERY_ERROR" as const,
          message:
            "No roots provided. Pass at least one SQL file or directory root.",
        },
      ],
      graph: {
        nodeCount: 0,
        edges: [],
        cycleGroups: [],
      },
    };
  }

  const fs = yield* FileSystem.FileSystem;
  const discovery = yield* discoverSqlFilesEffect(roots);
  const discoveryDiagnostics: Diagnostic[] = [];

  for (const missingRoot of discovery.missingRoots) {
    discoveryDiagnostics.push({
      code: "DISCOVERY_ERROR",
      message: `Root does not exist: '${missingRoot}'.`,
    });
  }

  const workingDirectory = yield* WorkingDirectory;
  const resolvedRoots = resolveRoots(roots, workingDirectory.cwd);
  const basePath = yield* computeCommonBaseEffect(resolvedRoots);

  const sqlContents: string[] = [];
  for (const filePath of discovery.files) {
    const content = yield* fs
      .readFileString(filePath, "utf-8")
      .pipe(Effect.orDie);
    sqlContents.push(content);
  }

  const result = yield* analyzeAndSortEffect(sqlContents, options);

  return remapResult(result, discovery.files, basePath, discoveryDiagnostics);
});
