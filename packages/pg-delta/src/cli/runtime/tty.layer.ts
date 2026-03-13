import * as clack from "@clack/prompts";
import { Layer } from "effect";
import { Tty } from "./tty.service.ts";

type RuntimeReadable = NodeJS.ReadableStream & { isTTY?: boolean };
type RuntimeWritable = NodeJS.WritableStream & { isTTY?: boolean };

interface RuntimeProcess {
  readonly stdin: RuntimeReadable;
  readonly stdout: RuntimeWritable;
  readonly stderr: RuntimeWritable;
}

const getRuntimeProcess = (): RuntimeProcess => {
  const runtimeProcess = globalThis.process;
  if (!runtimeProcess) {
    throw new Error("pgdelta CLI runtime requires a process-like host");
  }
  return runtimeProcess as unknown as RuntimeProcess;
};

export const ttyLayer = Layer.succeed(Tty, {
  stdinIsTty: Boolean(getRuntimeProcess().stdin.isTTY),
  stdoutIsTty: Boolean(getRuntimeProcess().stdout.isTTY),
  stderrIsTty: Boolean(getRuntimeProcess().stderr.isTTY),
  isCi: clack.isCI(),
});
