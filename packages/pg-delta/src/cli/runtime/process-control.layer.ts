import { Effect, Layer } from "effect";
import { ProcessControl } from "./process-control.service.ts";

interface RuntimeProcess {
  readonly argv: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
  exitCode?: number;
}

const getRuntimeProcess = (): RuntimeProcess => {
  const runtimeProcess = globalThis.process;
  if (!runtimeProcess) {
    throw new Error("pgdelta CLI runtime requires a process-like host");
  }
  return runtimeProcess as unknown as RuntimeProcess;
};

export const processControlLayer = Layer.succeed(ProcessControl, {
  args: Effect.sync(() => getRuntimeProcess().argv.slice(2)),
  env: (name: string) => Effect.sync(() => getRuntimeProcess().env[name]),
  setExitCode: (exitCode: number) =>
    Effect.sync(() => {
      getRuntimeProcess().exitCode = exitCode;
    }),
  exit: (exitCode: number) =>
    Effect.sync(() => {
      getRuntimeProcess().exitCode = exitCode;
    }),
});
