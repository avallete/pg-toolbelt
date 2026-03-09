import { Data } from "effect";

/**
 * Typed CLI exit error — commands fail with this to signal a non-zero exit code.
 * The CLI runner catches it at the boundary and sets `process.exitCode`.
 */
export class CliExitError extends Data.TaggedError("CliExitError")<{
  readonly exitCode: number;
  readonly message: string;
}> {}
