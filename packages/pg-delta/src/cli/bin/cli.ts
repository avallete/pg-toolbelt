#!/usr/bin/env node

import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import {
  configurePgDeltaLogging,
  getPgDeltaLogger,
} from "../../core/logging.ts";
import { rootCommand } from "../app.ts";
import { getCommandExitCode } from "../exit-code.ts";

await configurePgDeltaLogging({
  debug: process.env.DEBUG,
  level: process.env.PGDELTA_LOG_LEVEL,
});
const logger = getPgDeltaLogger("cli");

const cli = Command.run(rootCommand, {
  name: "pgdelta",
  version: "1.0.0-alpha.4",
});

cli(process.argv).pipe(
  Effect.tapErrorCause((cause) =>
    Effect.sync(() => {
      const error = cause.toJSON();
      if (error && typeof error === "object" && "error" in error) {
        logger.error("CLI command failed: {error}", {
          error: String(error.error),
        });
      } else {
        logger.error("CLI command failed: {error}", {
          error: String(cause),
        });
      }
    }),
  ),
  Effect.ensuring(
    Effect.sync(() => {
      const code = getCommandExitCode();
      if (code !== undefined) {
        process.exitCode = code;
      }
    }),
  ),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain,
);
