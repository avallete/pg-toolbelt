import * as clack from "@clack/prompts";

type RuntimeReadable = NodeJS.ReadableStream & { isTTY?: boolean };
type RuntimeWritable = NodeJS.WritableStream & { isTTY?: boolean };

interface RuntimeProcess {
  stdin: RuntimeReadable;
  stdout: RuntimeWritable;
  stderr: RuntimeWritable;
  env: Record<string, string | undefined>;
  exitCode?: number;
}

function getRuntimeProcess(): RuntimeProcess {
  const runtimeProcess = globalThis.process;
  if (!runtimeProcess) {
    throw new Error("pgdelta CLI runtime requires a process-like host");
  }
  return runtimeProcess as unknown as RuntimeProcess;
}

export function getRuntimeStdio(): {
  stdin: RuntimeReadable;
  stdout: RuntimeWritable;
  stderr: RuntimeWritable;
} {
  const runtime = getRuntimeProcess();
  return {
    stdin: runtime.stdin,
    stdout: runtime.stdout,
    stderr: runtime.stderr,
  };
}

export function getEnv(name: string): string | undefined {
  return getRuntimeProcess().env[name];
}

export function setExitCode(exitCode: number): void {
  getRuntimeProcess().exitCode = exitCode;
}

export function isInteractiveTerminal(): boolean {
  const { stdin, stdout } = getRuntimeStdio();
  return Boolean(stdin.isTTY && stdout.isTTY && !clack.isCI());
}

export function shouldStyleStderr(): boolean {
  return Boolean(getRuntimeStdio().stderr.isTTY && !clack.isCI());
}
