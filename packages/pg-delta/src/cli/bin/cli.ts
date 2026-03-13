#!/usr/bin/env node

import { createRequire } from "node:module";
import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import * as NodeStdio from "@effect/platform-node-shared/NodeStdio";
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";
import {
  configurePgDeltaLogging,
  getPgDeltaLogger,
} from "../../core/logging.ts";
import { rootCommand } from "../app.ts";
import {
  generateCompletionScript,
  isSupportedCompletionShell,
  parseCompletionShell,
} from "../completions.ts";
import { PgDeltaCliOutputLive } from "../help-formatter.ts";
import { outputLayerFor } from "../output/output.layer.ts";
import { processControlLayer } from "../runtime/process-control.layer.ts";
import { ttyLayer } from "../runtime/tty.layer.ts";

const require = createRequire(import.meta.url);
const packageJson = require("../../../package.json") as { version: string };

// The published CLI must run under plain Node. Provide the platform services
// explicitly instead of relying on Bun-specific runtime wiring.
const NodeServicesLive = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      NodeFileSystem.layer,
      NodePath.layer,
      NodeStdio.layer,
      NodeTerminal.layer,
    ),
  ),
);

await configurePgDeltaLogging({
  debug: process.env.DEBUG,
  level: process.env.PGDELTA_LOG_LEVEL,
});
const logger = getPgDeltaLogger("cli");

const args = process.argv.slice(2);
const rawCompletionMode = process.env.PGDELTA_INTERNAL_RAW_COMPLETIONS === "1";
const completionShell = rawCompletionMode
  ? undefined
  : parseCompletionShell(args);

if (!rawCompletionMode && hasMissingCompletionsShell(args)) {
  writeStderr(
    "Missing value for --completions. Supported shells: bash, zsh, fish, sh.",
  );
  process.exitCode = 1;
} else if (!rawCompletionMode && hasUnsupportedCompletionsShell(args)) {
  writeStderr(
    "Unsupported shell for --completions. Supported shells: bash, zsh, fish, sh.",
  );
  process.exitCode = 1;
} else if (completionShell) {
  const result = await generateCompletionScript(completionShell, rootCommand);
  if (result.error) {
    writeStderr(result.error);
    process.exitCode = 1;
  } else if (result.script !== undefined) {
    writeStdout(
      result.script.endsWith("\n") ? result.script.trimEnd() : result.script,
    );
  }
} else {
  Command.runWith(rootCommand, {
    version: packageJson.version,
  })(args).pipe(
    Effect.catchTags({
      CliExitError: (err: { message?: string; exitCode: number }) =>
        Effect.sync(() => {
          if (err.message) {
            writeStderr(err.message);
          }
          process.exitCode = err.exitCode;
        }),
      ChangesDetected: () =>
        Effect.sync(() => {
          process.exitCode = 2;
        }),
      UserCancelled: () =>
        Effect.sync(() => {
          process.exitCode = 2;
        }),
    }),
    Effect.catch((error: unknown) =>
      Effect.sync(() => {
        if (CliError.isCliError(error)) {
          if (error._tag === "ShowHelp") {
            process.exitCode = error.errors.length > 0 ? 1 : 0;
            return;
          }
          writeStderr(error.message);
          process.exitCode = 1;
          return;
        }

        const message = error instanceof Error ? error.message : String(error);

        writeStderr(`Unexpected CLI failure: ${message}`);
        process.exitCode = 1;

        if (logger.isEnabledFor("debug")) {
          logger.debug("CLI command failed: {error}", {
            error:
              error instanceof Error && error.stack
                ? error.stack
                : String(error),
          });
        }
      }),
    ),
    Effect.provide(PgDeltaCliOutputLive),
    Effect.provide(outputLayerFor("text")),
    Effect.provide(processControlLayer),
    Effect.provide(ttyLayer),
    Effect.provide(NodeServicesLive),
    NodeRuntime.runMain,
  );
}

function writeStdout(message: string): void {
  process.stdout.write(message.endsWith("\n") ? message : `${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
}

function hasMissingCompletionsShell(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--completions") {
      const next = argv[i + 1];
      return next === undefined || next.startsWith("-");
    }
    if (token.startsWith("--completions=")) {
      return token.slice("--completions=".length).length === 0;
    }
  }
  return false;
}

function hasUnsupportedCompletionsShell(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--completions") {
      const next = argv[i + 1];
      return (
        next !== undefined &&
        !next.startsWith("-") &&
        !isSupportedCompletionShell(next)
      );
    }
    if (token.startsWith("--completions=")) {
      const shell = token.slice("--completions=".length);
      return shell.length > 0 && !isSupportedCompletionShell(shell);
    }
  }
  return false;
}
