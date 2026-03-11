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
import {
  configurePgDeltaLogging,
  getPgDeltaLogger,
} from "../../core/logging.ts";
import { rootCommand } from "../app.ts";
import { getEnv, setExitCode } from "../runtime.ts";
import { logError } from "../ui.ts";

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
  debug: getEnv("DEBUG"),
  level: getEnv("PGDELTA_LOG_LEVEL"),
});
const logger = getPgDeltaLogger("cli");

rootCommand.pipe(
  Command.run({
    version: packageJson.version,
  }),
  Effect.catchTags({
    CliExitError: (err: { message?: string; exitCode: number }) =>
      Effect.sync(() => {
        if (err.message) {
          logError(err.message);
        }
        setExitCode(err.exitCode);
      }),
    ChangesDetected: () =>
      Effect.sync(() => {
        setExitCode(2);
      }),
    UserCancelled: () =>
      Effect.sync(() => {
        setExitCode(2);
      }),
  }),
  Effect.tapCause((cause) =>
    Effect.sync(() => {
      logger.error("CLI command failed: {error}", {
        error: String(cause),
      });
    }),
  ),
  Effect.provide(NodeServicesLive),
  NodeRuntime.runMain,
);
